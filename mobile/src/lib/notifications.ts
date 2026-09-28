/**
 * Notification controller — wires the existing WebSocket to local notifications.
 *
 * One place decides when the device gets paged:
 *  - a realtime attention frame arrives while the app is NOT in the foreground;
 *  - the socket reconnects and `/api/mobile/pending` reveals approvals that
 *    opened while we were offline;
 *  - the user backgrounds the app while an approval is still open (so walking
 *    away from a pending card pages them).
 *
 * While the app is active we stay quiet: the session UI shows the approval and a
 * global attention pill covers other sessions, so a system notification on top
 * would be noise. The dedup ledger in `notify.ts` guarantees an approval seen by
 * any of these paths is paged at most once.
 *
 * Navigation is injected (`onOpenAction`) so this module stays free of React and
 * is unit-testable; the app passes a callback that drives React Navigation.
 */

import { AppState, type AppStateStatus } from 'react-native'
import { socket } from './socket'
import { mobileApi } from './api'
import { useStore } from '../store'
import {
  ensureNotificationSetup,
  notificationForFrame,
  notificationForPending,
  onNotificationTap,
  present,
  type NotificationData,
} from './notify'

let teardown: (() => void) | null = null
let appActive = AppState.currentState === 'active'

function sessionName(sessionId: string): string {
  return useStore.getState().sessions.find((s) => s.id === sessionId)?.name ?? 'A session'
}

/**
 * Start listening. Idempotent — returns a teardown that stops everything.
 * Call once from the app root after the store has started.
 */
export function startNotifications(onOpenAction: (data: NotificationData) => void): () => void {
  if (teardown) return teardown
  void ensureNotificationSetup()

  const appSub = AppState.addEventListener('change', (status: AppStateStatus) => {
    const nowActive = status === 'active'
    const wentToBackground = appActive && !nowActive
    appActive = nowActive
    // The user just walked away: page anything still open that we have not
    // already paged. Best-effort — iOS gives a few seconds before suspending.
    if (wentToBackground) void syncPending()
  })

  // Realtime attention frames.
  const offFrame = socket.onFrame((frame) => {
    const notification = notificationForFrame(frame, sessionName)
    if (!notification) return
    if (appActive) return // the UI is showing it
    void present(notification)
  })

  // Reconnect sync: reconcile anything missed while offline.
  let wasConnected = false
  const offState = socket.onState((state) => {
    const connected = state === 'connected'
    if (connected && !wasConnected) void syncPending()
    wasConnected = connected
  })

  // Tap routing — opens the session/approval; never resolves it.
  const offTap = onNotificationTap((data) => onOpenAction(data))

  teardown = () => {
    appSub.remove()
    offFrame()
    offState()
    offTap()
    teardown = null
  }
  return teardown
}

/**
 * Pull the currently-open approvals/questions and page any we have not already
 * paged. Suppressed while the app is active (the UI shows them). Every id goes
 * through the same dedup ledger as the realtime path, so an approval discovered
 * here and one that arrived live are never double-paged.
 */
export async function syncPending(): Promise<void> {
  if (appActive) return
  try {
    const { pending } = await mobileApi.pending()
    for (const action of pending) {
      await present(notificationForPending(action))
    }
  } catch {
    // Unpaired or offline — nothing to reconcile; the next connect retries.
  }
}

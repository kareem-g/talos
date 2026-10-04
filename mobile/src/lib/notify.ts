/**
 * Local notifications — the on-device half of "page me when an agent needs me".
 *
 * This is deliberately NOT remote push. There is no APNs, no FCM, no relay, no
 * Apple Developer account: the daemon's existing WebSocket delivers the event,
 * and `expo-notifications` raises a local notification on the device. That works
 * with zero notification-service cost, which is the whole point.
 *
 * The honest ceiling, stated plainly: a local notification can only be raised
 * while JavaScript is running. iOS suspends the app (and tears down the socket)
 * seconds after it leaves the foreground, and without APNs there is nothing to
 * wake it — so an agent that finishes while the app is fully suspended or
 * terminated produces no notification until the user next opens the app, at which
 * point the reconnect sync (`/api/mobile/pending`) surfaces anything still open.
 * We do not hack background execution to pretend otherwise.
 *
 * Design notes:
 *  - Dedup: every notification carries a stable id (the approval/question id, or
 *    the frame's event id). A persisted ledger of already-notified ids means a
 *    replayed frame, a reconnect, or a duplicate broadcast never double-pages.
 *  - Foreground: when the app is active the UI already shows the approval (and a
 *    global attention pill covers other sessions), so the caller suppresses local
 *    notifications; this module only raises them when asked.
 *  - Tap safety: a tap routes to the session; it never resolves an approval. The
 *    approval screen re-fetches state from the backend and the user must act.
 */

import { Linking, Platform } from 'react-native'
import type { IncomingFrame } from '@/types/protocol'
import { readStringSet, writeStringSet } from './storage'
import { palette } from '@app/design/tokens'

// expo-notifications removed remote push from Expo Go (SDK 53+ on Android) and
// its module now THROWS during evaluation there — before any guard below could
// run, taking the whole app down on the splash screen. So the module is
// required lazily once: a runtime that cannot provide it gets `null`, and
// every entry point degrades to "notifications unavailable" (the permission
// and tap paths report undetermined / no-op, nothing is scheduled). A dev
// build or a real install gets the real module and identical behavior.
const Notifications: typeof import('expo-notifications') | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as typeof import('expo-notifications')
  } catch {
    if (__DEV__) {
      console.warn('[qai] expo-notifications unavailable in this runtime — alerts will not be presented.')
    }
    return null
  }
})()

const DEDUP_KEY = 'qai-notified-ids'
const CHANNEL_ID = 'agent-attention'
const CATEGORY_ID = 'qai-attention'

// How a notification presents if the app is foregrounded when one slips through.
// We mostly suppress in the foreground (the UI is right there), but a banner is
// the right fallback rather than dropping it silently.
// Notifications are a nicety here; nothing else in the app depends on this
// having been registered.
try {
  Notifications?.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
} catch {
  if (__DEV__) {
    console.warn('[qai] Notification handler unavailable in this runtime — alerts will not be presented.')
  }
}

/** Data attached to a notification, read back when the user taps it. */
export interface NotificationData {
  sessionId: string
  /** The approval/question id to focus, when the notification is for one. */
  approvalId?: string
  kind: 'approval' | 'question' | 'completed' | 'error' | string
}

/** A notification ready to present. */
export interface AttentionNotification {
  /** Stable dedup key. */
  id: string
  title: string
  body: string
  data: NotificationData
}

export type PermissionState = 'granted' | 'denied' | 'undetermined'

/* ── Dedup ledger ────────────────────────────────────────────────────────── */

let notified: Set<string> = readStringSet(DEDUP_KEY)

function remember(id: string): void {
  if (notified.has(id)) return
  notified.add(id)
  writeStringSet(DEDUP_KEY, notified)
}

/** True if this id was already paged. Exported for tests and reconnect sync. */
export function alreadyNotified(id: string): boolean {
  return notified.has(id)
}

/** Forget all dedup state (e.g. the user re-pairs to a different daemon). */
export function resetDedup(): void {
  notified = new Set()
  writeStringSet(DEDUP_KEY, notified)
}

/* ── Setup + permissions ─────────────────────────────────────────────────── */

/** Create the Android channel and the iOS category once, at app start. */
export async function ensureNotificationSetup(): Promise<void> {
  if (!Notifications) return
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Agent attention',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: palette.accent,
    })
  }
  // A single "View" action that routes into the app. It never resolves the
  // approval — that requires the user to act in the session, against fresh state.
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    { identifier: 'view', buttonTitle: 'View' },
  ])
}

export async function permissionState(): Promise<PermissionState> {
  if (!Notifications) return 'undetermined'
  const { status } = await Notifications.getPermissionsAsync()
  return normalize(status)
}

/**
 * Ask for permission. Call from an explicit user action with a why-explainer
 * shown first (the settings screen), not on cold launch — iOS only allows the
 * prompt once, and burning it before the user understands why is wasteful.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (!Notifications) return 'undetermined'
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  })
  return normalize(status)
}

function normalize(status: string): PermissionState {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/**
 * Open the system settings for this app, so a user who denied (or later revoked)
 * notification permission has a one-tap route to fix it. Permission denial must
 * never block the app — everything still works, alerts just stay in-app.
 */
export async function openSystemNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings()
  } catch {
    // Some platforms/versions lack openSettings; fall back to the general app
    // settings deep link rather than throwing into the UI.
    try {
      if (Platform.OS === 'ios') await Linking.openURL('app-settings:')
    } catch {
      // Nothing more we can do; the user can find Settings manually.
    }
  }
}

/* ── Presenting ──────────────────────────────────────────────────────────── */

/**
 * Raise a local notification, unless it was already paged or permission is not
 * granted. Returns whether one was actually scheduled.
 *
 * `force` bypasses the dedup ledger — used by the explicit "send test" path,
 * which should always fire so the user gets confirmation.
 */
export async function present(n: AttentionNotification, force = false): Promise<boolean> {
  if (!Notifications) return false
  // Permission check is async, so do it FIRST, then check-and-claim the dedup id
  // synchronously. Claiming after the await means two concurrent calls for the
  // same id (a replayed/duplicate frame, or a realtime event racing a reconnect
  // sync) cannot both slip past the ledger: the first claims it before the second
  // resumes from its own await.
  if ((await permissionState()) !== 'granted') return false
  if (!force) {
    if (alreadyNotified(n.id)) return false
    remember(n.id)
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.body,
      data: n.data as unknown as Record<string, unknown>,
      categoryIdentifier: CATEGORY_ID,
      sound: true,
    },
    // null trigger = deliver immediately.
    trigger: null,
    ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
  } as import('expo-notifications').NotificationRequestInput)
  return true
}

/* ── Mapping events → notifications ──────────────────────────────────────── */

function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars.slice(0, max - 1).join('')}…`
}

/**
 * Map a realtime frame to the notification it should page with, or null when the
 * frame is not an attention event. Extensible: add a case to cover a new kind of
 * intervention (auth required, merge conflict, …) without touching the caller.
 *
 * Wording mirrors the backend's `summarize_event` so an alert reads the same
 * whether it arrived by local notification or another channel.
 */
export function notificationForFrame(
  frame: IncomingFrame,
  sessionName: (sessionId: string) => string,
): AttentionNotification | null {
  if (frame.type === 'AgentEvent') {
    const event = frame.payload.event
    const sessionId = event.session_id
    const name = sessionName(sessionId)
    const payload = event.payload as Record<string, unknown>
    const str = (key: string): string | undefined =>
      typeof payload[key] === 'string' ? (payload[key] as string) : undefined
    const eventId = String(frame.event_id ?? event.event_id ?? `${event.kind}-${sessionId}`)

    switch (event.kind) {
      case 'permission_required': {
        const id = str('id') ?? eventId
        const tool = str('tool_name')
        const prompt = str('prompt')
        const detail = tool
          ? `Approval needed for \`${tool}\``
          : prompt
            ? truncate(prompt, 120)
            : 'Approval needed'
        return {
          id,
          title: 'Approval needed',
          body: `${name}: ${detail}`,
          data: { sessionId, approvalId: id, kind: 'approval' },
        }
      }
      case 'question_started': {
        const id = str('question_id') ?? eventId
        const question = str('question') ?? str('title')
        return {
          id,
          title: 'Agent has a question',
          body: `${name}: ${question ? truncate(question, 120) : 'The agent is asking a question.'}`,
          data: { sessionId, approvalId: id, kind: 'question' },
        }
      }
      case 'agent_completed':
        return {
          id: eventId,
          title: 'Task finished',
          body: `${name} finished its turn.`,
          data: { sessionId, kind: 'completed' },
        }
      case 'agent_error':
        return {
          id: eventId,
          title: 'Agent stopped',
          body: `${name} hit an error and stopped.`,
          data: { sessionId, kind: 'error' },
        }
      default:
        return null
    }
  }

  // A failed turn also arrives as an `error` StateChange (some backends emit the
  // state without an agent_error event).
  if (frame.type === 'StateChange' && frame.payload.state.startsWith('error')) {
    const sessionId = frame.payload.session_id
    return {
      id: `error-${frame.event_id ?? sessionId}`,
      title: 'Agent stopped',
      body: `${sessionName(sessionId)} hit an error and stopped.`,
      data: { sessionId, kind: 'error' },
    }
  }

  return null
}

/**
 * Map a pending action (from `GET /api/mobile/pending`) to a notification, for
 * the reconnect sync. Shares the dedup ledger with the realtime path, so an
 * approval seen live and then re-discovered on reconnect is paged once.
 */
export function notificationForPending(pending: {
  session_id: string
  session_name: string
  kind: string
  id: string
  title: string
  prompt: string | null
  tool_name: string | null
}): AttentionNotification {
  const isQuestion = pending.kind === 'question'
  const detail = pending.tool_name
    ? `Approval needed for \`${pending.tool_name}\``
    : pending.prompt
      ? truncate(pending.prompt, 120)
      : ''
  return {
    id: pending.id,
    title: pending.title || (isQuestion ? 'Agent has a question' : 'Approval needed'),
    body: detail ? `${pending.session_name}: ${detail}` : pending.session_name,
    data: {
      sessionId: pending.session_id,
      approvalId: pending.id,
      kind: isQuestion ? 'question' : 'approval',
    },
  }
}

/** Subscribe to notification taps. The caller routes to the session/approval. */
export function onNotificationTap(
  handler: (data: NotificationData) => void,
): () => void {
  if (!Notifications) return () => undefined
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as unknown as NotificationData | undefined
    if (data && typeof data.sessionId === 'string') handler(data)
  })
  return () => sub.remove()
}

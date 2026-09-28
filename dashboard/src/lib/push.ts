/**
 * Web Push registration — the browser half of background notifications.
 *
 * `notify.ts` raises a notification from the page, which only works while the
 * page's JavaScript is alive. On a phone that window is seconds wide: lock the
 * screen and the webview is suspended, then discarded. To page the user when
 * the app is *closed*, the daemon has to be the sender — and for that it needs
 * a push subscription from each browser that wants alerts.
 *
 * This module owns that handshake:
 *   permission → service worker → PushManager.subscribe (with the daemon's
 *   VAPID key) → POST the subscription to the daemon.
 *
 * The native Capacitor shell is excluded: a WKWebView has no push service, so
 * `pushSupported()` is false there and the shell keeps using the local
 * notifications in `notify.ts`. Web Push also needs a secure context, so over
 * plain LAN HTTP (not localhost) it is unavailable and we say so rather than
 * failing opaquely.
 */

import { pushApi } from './api'
import { isNativeApp } from './native'

export type PushSupport = 'supported' | 'native' | 'insecure' | 'unsupported'

/** Whether this environment can register for Web Push at all. */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  // The shell ships its own bundle and has no push service; local notifications
  // (notify.ts) are its path instead.
  if (isNativeApp()) return 'native'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported'
  // Service workers — and therefore push — require a secure context. localhost
  // is exempt; a LAN IP over http is not.
  const secure =
    window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  if (!secure) return 'insecure'
  return 'supported'
}

/** Decode a base64url string (the VAPID key) to the bytes PushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  // An explicitly ArrayBuffer-backed view: `applicationServerKey` rejects a
  // SharedArrayBuffer-backed one, which is what a bare `Uint8Array` widens to
  // under TS 5.7+'s generic typed-array types.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** The active service worker registration, ensuring one is registered first. */
async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const existing = await navigator.serviceWorker.getRegistration()
    if (existing) return existing
    // pwa.ts registers on load, but a push toggle clicked before that (or after
    // a hard reload) needs the registration now.
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

/**
 * Subscribe this browser to push and register the subscription with the daemon.
 *
 * Assumes notification permission is already granted (the toggle requests it
 * first). Idempotent: if a subscription already exists it is re-posted to the
 * daemon rather than duplicated, which also resyncs after a daemon DB reset.
 * Returns true when the daemon now holds a live subscription.
 */
export async function enablePush(): Promise<boolean> {
  if (pushSupport() !== 'supported') return false
  if (Notification.permission !== 'granted') return false

  const registration = await swRegistration()
  if (!registration) return false

  try {
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      const { publicKey } = await pushApi.key()
      if (!publicKey) return false
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    }
    await pushApi.subscribe(subscription.toJSON())
    return true
  } catch {
    // Subscribe can throw if the user revoked permission mid-flow, the push
    // service is unreachable, or the VAPID key fetch failed. The toggle falls
    // back to "off" and the in-app cue still works while the page is open.
    return false
  }
}

/**
 * Drop the local subscription and tell the daemon to forget it.
 *
 * Best-effort on both sides: a browser may have already cleared the
 * subscription, and the daemon prunes dead endpoints on its own when a send
 * comes back 404/410, so neither failing here leaves the user stuck.
 */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      const endpoint = subscription.endpoint
      await subscription.unsubscribe()
      if (endpoint) await pushApi.unsubscribe(endpoint).catch(() => {})
    }
  } catch {
    // Nothing to undo.
  }
}

/**
 * Re-post an existing subscription to the daemon on app start.
 *
 * Browsers can rotate a push endpoint, and the daemon's database can be reset
 * independently of the browser. Syncing on load keeps the two in step so a
 * subscription that already exists keeps working without the user re-toggling.
 * Silent and non-fatal — if there is no subscription or the post fails, the app
 * is exactly as functional as before.
 *
 * Returns whether this browser now has a subscription registered with the
 * daemon, so the UI can reflect the real state on mount.
 */
export async function syncPushSubscription(): Promise<boolean> {
  if (pushSupport() !== 'supported') return false
  if (Notification.permission !== 'granted') return false
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return false
    await pushApi.subscribe(subscription.toJSON())
    return true
  } catch {
    // Resync is an optimization, not a requirement; a subscription may still
    // exist locally even if the post failed, so report what we can see.
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      return Boolean(await registration?.pushManager.getSubscription())
    } catch {
      return false
    }
  }
}

/** Fire a test push to confirm end-to-end delivery; returns devices reached. */
export async function sendTestPush(): Promise<number> {
  try {
    const { delivered } = await pushApi.test()
    return delivered
  } catch {
    return 0
  }
}

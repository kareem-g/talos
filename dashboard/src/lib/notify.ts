/**
 * Browser notifications — the phone-side "push" without an app.
 *
 * The remote control lives in a browser tab, which means it competes with every
 * other tab for attention. When the device is backgrounded and an agent starts
 * waiting for an approval or finishes, a system notification is the only thing
 * that gets the user back in time.
 *
 * Deliberately minimal: no service-worker push (that needs a relay server);
 * these are local notifications shown while the app is not on screen. The
 * permission is requested only from an explicit user toggle — never on load.
 */

import { isNativeApp } from './native'

export type NotificationSupport = 'granted' | 'denied' | 'default' | 'unsupported'

/** Local notifications in the native shell; null everywhere else. */
async function nativeNotifications() {
  if (!isNativeApp()) return null
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    return LocalNotifications
  } catch {
    return null
  }
}

export function notificationState(): NotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as NotificationSupport
}

/** Ask the platform for permission. Resolves to the resulting state. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  const native = await nativeNotifications()
  if (native) {
    try {
      const result = await native.requestPermissions()
      return result.display === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'unsupported'
    }
  }
  if (!('Notification' in window)) return 'unsupported'
  try {
    const result = await Notification.requestPermission()
    return result as NotificationSupport
  } catch {
    // Older browsers take a callback; a rejection here is just "denied".
    return 'denied'
  }
}

/**
 * Fire a notification if allowed and the app cannot see the moment itself.
 *
 * In the shell this goes through LocalNotifications — the web Notification API
 * is inert in a WKWebView. Worth knowing the ceiling: iOS suspends the webview
 * shortly after backgrounding, so nothing here can fire while suspended. True
 * background delivery needs APNs (a paid developer account plus a sender).
 *
 * Returns whether one was dispatched, so callers can decide whether to add an
 * in-app cue instead.
 */
export function notifyOnBackground(title: string, body?: string): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false

  if (isNativeApp()) {
    void (async () => {
      const native = await nativeNotifications()
      if (!native) return
      try {
        const permission = await native.checkPermissions()
        if (permission.display !== 'granted') return
        await native.schedule({
          notifications: [
            {
              // Millisecond clock keeps ids unique per event without state.
              id: Math.floor(Date.now() % 2147483647),
              title,
              body: body ?? '',
              schedule: { at: new Date(Date.now() + 250) },
            },
          ],
        })
      } catch {
        // Scheduling refused — the in-app cue still shows on return.
      }
    })()
    return true
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  try {
    // `renotify` (Chrome) lets the same `tag` alert again instead of silently
    // no-opping; not in the TS DOM lib yet, hence the cast.
    const notification = new Notification(title, {
      body,
      tag: 'agentdeck-attention',
      silent: false,
      ...( { renotify: true } as NotificationOptions & { renotify?: boolean }),
    })
    notification.addEventListener('click', () => {
      window.focus()
      notification.close()
    })
    return true
  } catch {
    // Android Chrome requires a service worker for `new Notification`; skip
    // quietly rather than crash — the in-app banner still shows on return.
    return false
  }
}

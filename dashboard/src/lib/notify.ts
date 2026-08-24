/**
 * Browser notifications — the phone-side "push" without an app.
 *
 * The remote control lives in a browser tab, which means it competes with every
 * other tab for attention. When the device is backgrounded and an agent starts
 * waiting for an approval or finishes, a system notification is the only thing
 * that gets the user back in time.
 *
 * Deliberately minimal: no service-worker push (that needs a relay server);
 * these are local notifications shown while the tab is hidden. The permission
 * is requested only from an explicit user toggle — never on page load.
 */

export type NotificationSupport = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationState(): NotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as NotificationSupport
}

/** Ask the browser for permission. Resolves to the resulting state. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
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
 * Fire a notification if allowed and the page cannot see it.
 *
 * Returns whether one was actually shown, so callers can decide whether to add
 * an in-app cue instead. Clicking focuses the tab; navigation is handled by
 * whatever is listening (the SPA keeps its own route).
 */
export function notifyOnBackground(title: string, body?: string): boolean {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false
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

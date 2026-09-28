/**
 * AgentDeck service worker — an installed remote control that survives flaky
 * connections between you and your home machine.
 *
 * Strategy, deliberately boring:
 *  - Never intercept /api or /ws. Live agent data is only ever as fresh as the
 *    network allows; caching it would show sessions that no longer exist.
 *  - Cache-first for hashed build assets (they are immutable).
 *  - Network-first for navigations, falling back to the cached shell when the
 *    daemon is unreachable — so a dead tunnel still opens the UI, which can
 *    then explain what happened instead of showing a browser error page.
 */

const CACHE = 'agentdeck-shell-v2'
const SHELL = ['/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return

  // Immutable build output: serve from cache without waiting on the network.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
    return
  }

  // Navigations and everything else: network first, cached shell as the
  // offline answer.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (request.mode === 'navigate' && response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
        }
        return response
      })
      .catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match('/')).then(
          (hit) =>
            hit ??
            new Response('AgentDeck is offline.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            }),
        ),
      ),
  )
})

/**
 * Web Push — the daemon pages the device when an agent finishes, needs an
 * approval, or errors, even with the app closed. This is the only place that
 * can fire once the page's JavaScript is gone: a backgrounded phone suspends
 * the webview within seconds, so nothing driven from the page survives. The
 * daemon does the sending; the service worker just decides whether to show it.
 *
 * The payload is encrypted end-to-end by the browser (RFC 8291) before this
 * handler ever sees it, so `event.data.json()` is plaintext only because the
 * push service already decrypted it with keys this browser holds.
 */
self.addEventListener('push', (event) => {
  let data = {}
  if (event.data) {
    try {
      data = event.data.json()
    } catch {
      // A malformed or empty body still deserves a generic ping rather than
      // dropping the notification on the floor — the user was paged for a
      // reason, even if we cannot name it.
      data = { title: 'AgentDeck', body: event.data.text() }
    }
  }

  const title = data.title || 'AgentDeck'
  const options = {
    body: data.body || '',
    tag: data.tag || 'agentdeck',
    // Replace an older notification with the same tag rather than stacking —
    // a second "needs approval" for one session supersedes the first.
    renotify: true,
    icon: '/favicon.svg',
    badge: '/icon-maskable.svg',
    data: { url: data.url || '/', session_id: data.session_id || null },
  }

  event.waitUntil(
    // Do not page the user about something they are already looking at. If a
    // client is visible and focused, the in-app cue (App.tsx) handles it and a
    // system notification on top would be noise. `includeUncontrolled` catches
    // windows this worker does not yet control (freshly opened tabs).
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const looking = clientList.some((client) => client.visibilityState === 'visible')
        if (looking) return undefined
        return self.registration.showNotification(title, options)
      }),
  )
})

/**
 * A tap on the notification brings the app to the relevant session. Reuse an
 * open window when there is one (navigating it) rather than spawning a second
 * instance of the remote control.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          // Best-effort deep link: tell the open window where to go, then focus
          // it. postMessage is fire-and-forget; the page routes on receipt.
          try {
            client.postMessage({ type: 'agentdeck-push-navigate', url: target })
          } catch {
            // An uncontrolled or cross-origin window may refuse; focusing still
            // gets the user back into the app.
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

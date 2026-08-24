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

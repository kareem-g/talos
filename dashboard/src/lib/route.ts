/**
 * URL routing.
 *
 * The session id belongs in the URL: a session is a shareable, bookmarkable
 * thing, browser back/forward should work, and a phone that reloads should land
 * back where it was. Previously the selection lived only in component state, so
 * a refresh dropped you at the list.
 *
 * Deliberately hand-rolled rather than pulling in a router. There are three
 * routes and no nesting, layouts, or loaders — a router would be more code to
 * read, not less.
 *
 *   /                        the session list
 *   /session/<id>            one session
 *   /?offer=…&secret=…       pairing (the QR target; the daemon serves the SPA
 *                            for any path, so this is what the phone lands on)
 */

import { useCallback, useEffect, useState } from 'react'

export type Route =
  | { name: 'list' }
  | { name: 'session'; sessionId: string }
  | { name: 'pair'; offerId: string; secret: string }

/** Parse the current location. Unknown paths fall back to the list. */
export function parseRoute(): Route {
  const params = new URLSearchParams(window.location.search)
  const offerId = params.get('offer')
  const secret = params.get('secret')
  // Pairing credentials take precedence wherever they appear: the QR encodes a
  // path chosen by the daemon, which may not be `/`.
  if (offerId && secret) return { name: 'pair', offerId, secret }

  const match = /^\/session\/([^/?#]+)/.exec(window.location.pathname)
  if (match) return { name: 'session', sessionId: decodeURIComponent(match[1]) }

  return { name: 'list' }
}

function routeToPath(route: Route): string {
  switch (route.name) {
    case 'session':
      return `/session/${encodeURIComponent(route.sessionId)}`
    case 'pair':
    case 'list':
      return '/'
  }
}

/**
 * The current route, kept in sync with the address bar.
 *
 * `navigate` pushes history so back returns to the previous screen; `replace`
 * is for corrections that should not add an entry — clearing pairing
 * credentials, or dropping a session id that no longer exists.
 */
export function useRoute(): {
  route: Route
  navigate: (route: Route) => void
  replace: (route: Route) => void
} {
  const [route, setRoute] = useState<Route>(() => parseRoute())

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: Route) => {
    const path = routeToPath(next)
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', path)
    }
    setRoute(next)
  }, [])

  const replace = useCallback((next: Route) => {
    window.history.replaceState(null, '', routeToPath(next))
    setRoute(next)
  }, [])

  return { route, navigate, replace }
}

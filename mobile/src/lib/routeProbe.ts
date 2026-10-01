/**
 * Route probing — how long each advertised origin actually takes to answer.
 *
 * The phone can be paired over several routes at once (LAN, Tailscale, a
 * tunnel), and the list in Device is otherwise just three URLs the user has no
 * way to choose between. A round-trip time turns that list into a decision.
 *
 * This deliberately does NOT go through `lib/api`: that client always talks to
 * the *active* origin, and the whole point here is to measure the others. So it
 * is a raw, timeboxed `fetch` against `/api/mobile/me` — the cheapest
 * authenticated endpoint the daemon exposes, which proves both reachability and
 * that the stored token is still good for that route.
 */

import { deviceRoutes } from './native'
import { deviceToken } from './api'

export interface RouteProbe {
  route: string
  /** Round-trip milliseconds, or null when the route did not answer in time. */
  ms: number | null
}

/** Past this, a route is reported as unreachable rather than "slow". */
const DEFAULT_TIMEOUT = 2500

export async function probeRoute(route: string, timeoutMs = DEFAULT_TIMEOUT): Promise<RouteProbe> {
  const token = deviceToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch(`${route.replace(/\/+$/, '')}/api/mobile/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    })
    // A 401 still proves the route is reachable — it answered. That distinction
    // matters: "wrong token" and "host is down" are different problems and the
    // user fixes them in different places.
    return { route, ms: response.ok || response.status === 401 ? Date.now() - started : null }
  } catch {
    return { route, ms: null }
  } finally {
    clearTimeout(timer)
  }
}

/** Probe every advertised route in parallel. One slow route never blocks another. */
export function probeRoutes(routes: string[] = deviceRoutes()): Promise<RouteProbe[]> {
  return Promise.all(routes.map((route) => probeRoute(route)))
}

/** Format a probe for a mono readout: `4ms` · `380ms` · `—`. */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
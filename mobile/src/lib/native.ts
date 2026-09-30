/**
 * Native-client bridge.
 *
 * The React Native app is always the "native" client: it is never served by the
 * daemon, so every request must be prefixed with the paired daemon's origin and
 * the socket must target that origin too. This mirrors the web `lib/native.ts`
 * contract (isNativeApp / deviceBaseUrl / resolveApiUrl / socketOrigin /
 * parsePairingLink) so the ported logic that depends on it behaves identically,
 * but drops the browser-only `window.location` fallbacks — in RN the base URL is
 * always explicit, set when the device pairs.
 */

// Provides URL/URLSearchParams on Hermes, which parsePairingLink needs.
import 'react-native-url-polyfill/auto'
import { storage } from './storage'

export const BASE_URL_KEY = 'qai-device-base-url'
/** Ordered origins the daemon advertised, so the socket can fail over. */
export const ROUTES_KEY = 'qai-device-routes'

/** Always true here — this module only ships in the native app. */
export function isNativeApp(): boolean {
  return true
}

/** The paired daemon origin, e.g. `http://100.94.122.121:9120`. `''` = unpaired. */
export function deviceBaseUrl(): string {
  return storage.getString(BASE_URL_KEY) ?? ''
}

export function setDeviceBaseUrl(baseUrl: string | null): void {
  const trimmed = (baseUrl ?? '').replace(/\/+$/, '')
  if (!trimmed) storage.delete(BASE_URL_KEY)
  else storage.set(BASE_URL_KEY, trimmed)
}

/**
 * Every origin this device can reach the daemon on, active route first. The
 * pairing QR carries them; the socket walks the list when the active one stops
 * answering. Falls back to the single active origin so pairings made before the
 * route list existed still work.
 */
export function deviceRoutes(): string[] {
  const stored = storage.getJSON<string[]>(ROUTES_KEY)
  const routes = Array.isArray(stored) ? stored.filter((route) => typeof route === 'string') : []
  const active = deviceBaseUrl()
  if (!active) return routes
  return [active, ...routes.filter((route) => route !== active)]
}

export function setDeviceRoutes(routes: string[] | null): void {
  const clean = (routes ?? [])
    .map((route) => route.replace(/\/+$/, ''))
    .filter((route) => /^https?:\/\//i.test(route))
  const unique = Array.from(new Set(clean))
  if (unique.length === 0) storage.delete(ROUTES_KEY)
  else storage.setJSON(ROUTES_KEY, unique)
}

/** Prefix a relative API path with the paired daemon origin. */
export function resolveApiUrl(path: string): string {
  const base = deviceBaseUrl()
  if (!base || /^https?:\/\//i.test(path)) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** WebSocket origin for `/ws/mobile`, derived from the stored base. */
export function socketOrigin(): string {
  const base = deviceBaseUrl()
  // No window.location fallback in RN: if unpaired there is nothing to connect
  // to yet, and the caller gates connect() on pairing anyway.
  return base ? base.replace(/^http/i, 'ws') : ''
}

/**
 * Parse a pairing payload (`<base>/mobile/pair?offer=…&secret=…`, or the bare
 * `offer=…&secret=…` a QR may encode) into the parts the pairing screen needs.
 * Mirrors the web parser so a QR shown by the daemon pairs the same way.
 *
 * `baseUrls` is the scanned origin followed by every `alt=` origin the daemon
 * listed. The daemon advertises routes in preference order and a phone cannot
 * always use the first one — a tailnet `.ts.net` name does not resolve when the
 * phone's Tailscale has MagicDNS off, even though the tailnet IP and the home
 * LAN address both work. Attempting only `baseUrl` is what made the tailnet
 * route fail while the LAN route succeeded.
 */
export function parsePairingLink(
  text: string,
): { baseUrl: string; baseUrls: string[]; offerId: string; secret: string } | null {
  const trimmed = text.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const offer = url.searchParams.get('offer')
  const secret = url.searchParams.get('secret')
  if (!offer || !secret) return null
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/mobile/pair')) return null
  const base = `${url.protocol}//${url.host}`
  return { baseUrl: base, baseUrls: withAlternates(base, url.searchParams.get('alt')), offerId: offer, secret }
}

/**
 * The scanned origin first, then each advertised alternate, in the daemon's
 * order and without duplicates. Any entry that is not a plain http(s) origin is
 * dropped rather than allowed to poison the fallback list.
 */
function withAlternates(primary: string, alt: string | null): string[] {
  const routes = [primary]
  for (const candidate of (alt ?? '').split(',')) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    const origin = `${url.protocol}//${url.host}`
    if (!routes.includes(origin)) routes.push(origin)
  }
  return routes
}

/**
 * Native-shell (Capacitor) bridge.
 *
 * The web app is normally *served by the daemon*, so every REST call is a
 * relative path and the socket targets `window.location.host`. Inside a native
 * shell the bundle is loaded from `capacitor://localhost`, which is not the
 * daemon — so the paired daemon's origin has to be remembered and prefixed.
 *
 * Both behaviours coexist: with no stored base URL the app is byte-identical
 * to the PWA (relative paths, current host). Only the native build stores one,
 * when it pairs.
 */

const BASE_URL_KEY = 'agentdeck-device-base-url'

/** True when running inside the Capacitor shell rather than a browser tab. */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor
  if (capacitor?.isNativePlatform) {
    try {
      return capacitor.isNativePlatform()
    } catch {
      return false
    }
  }
  // Fallback for older bridges / debugging: the shell serves from this scheme.
  return window.location.protocol === 'capacitor:' || window.location.protocol === 'ionic:'
}

/** The paired daemon origin, e.g. `http://100.94.122.121:9120`. `''` = same-origin. */
export function deviceBaseUrl(): string {
  try {
    return localStorage.getItem(BASE_URL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setDeviceBaseUrl(baseUrl: string | null): void {
  try {
    const trimmed = (baseUrl ?? '').replace(/\/+$/, '')
    if (!trimmed) localStorage.removeItem(BASE_URL_KEY)
    else localStorage.setItem(BASE_URL_KEY, trimmed)
  } catch {
    // Non-fatal — the app still works for this page load without persistence.
  }
}

/** Prefix a relative API path with the paired daemon origin when present. */
export function resolveApiUrl(path: string): string {
  const base = deviceBaseUrl()
  if (!base || /^https?:\/\//i.test(path)) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** WebSocket origin for `/ws/mobile`, derived from the stored base or the page. */
export function socketOrigin(): string {
  const base = deviceBaseUrl()
  if (base) return base.replace(/^http/i, 'ws')
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}`
}

/**
 * Parse a pairing link (`<base>/mobile/pair?offer=…&secret=…`) into the parts
 * the native pairing screen needs. Mirrors the backend's QR payload shape and
 * the iOS app's parser.
 */
export function parsePairingLink(
  text: string,
): { baseUrl: string; offerId: string; secret: string } | null {
  let url: URL
  try {
    url = new URL(text.trim())
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
  return { baseUrl: base, offerId: offer, secret }
}

/**
 * Pairing persistence abstraction.
 *
 * Wraps `api.ts` token storage so callers don't touch localStorage directly.
 * Future native wrapper (SecureStore / Keychain) swaps this one file.
 * Fingerprint formatting stays here — not duplicated in UI.
 */

import { deviceToken, setDeviceToken } from './api'
import { deviceBaseUrl, setDeviceBaseUrl } from './native'

export const TOKEN_KEY = 'agentdeck-device-token'

export function getPairingToken(): string | null {
  return deviceToken()
}

export function setPairingToken(token: string | null): void {
  setDeviceToken(token)
}

/** The daemon origin this device is paired with (native shell); `''` = same-origin. */
export function getPairingBaseUrl(): string {
  return deviceBaseUrl()
}

export function clearPairing(): void {
  setDeviceToken(null)
  // Drop the daemon origin too, so re-pairing can point at a different machine.
  setDeviceBaseUrl(null)
}

export function isPaired(): boolean {
  const token = deviceToken()
  return token !== null && token.length >= 32
}

/** Format fingerprint `abcd 1234 …` for display — input is hex without spaces. */
export function formatFingerprint(fingerprint: string): string {
  const clean = fingerprint.replace(/\s+/g, '').toLowerCase()
  // group 4
  return clean.replace(/(.{4})/g, '$1 ').trim()
}

/** Build pairing URL for QR — already provided by backend `qr_data`, but helper keeps shape stable. */
export function pairingUrlFromOffer(offerId: string, secret: string, baseUrl?: string): string {
  const base = baseUrl ?? window.location.origin
  return `${base.replace(/\/+$/, '')}/mobile/pair?offer=${encodeURIComponent(offerId)}&secret=${encodeURIComponent(secret)}`
}

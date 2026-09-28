/**
 * Pairing facade — the phone side of "scan the desktop's QR, get a token".
 *
 * Wraps the credential storage (MMKV live copy + Keychain mirror) and a stable
 * per-device identity, so the pairing screen deals in `savePairing`/`isPaired`
 * rather than storage keys. Mirrors the web `lib/pairing.ts` contract.
 */

import { Platform } from 'react-native'
import * as Device from 'expo-device'
import { deviceToken } from './api'
import { deviceBaseUrl, deviceRoutes, setDeviceBaseUrl } from './native'
import {
  persistBaseUrl,
  persistRoutes,
  persistToken,
  clearCredentials,
  hydrateCredentials,
} from './secureStore'
import { storage } from './storage'

const DEVICE_KEY_STORAGE = 'agentdeck-device-key'

/** True once a token long enough to be real is stored. */
export function isPaired(): boolean {
  const token = deviceToken()
  return !!token && token.length >= 32
}

export function getPairingBaseUrl(): string {
  return deviceBaseUrl()
}

export { deviceRoutes }

/**
 * Pick the next advertised origin to dial after `failedOrigin` stopped
 * answering, skipping everything already tried during this outage.
 *
 * `attempted` is the socket's record of the origins it has dialled since the
 * last successful connection; the caller appends `failedOrigin` to it. Tracking
 * the whole set rather than just the current position matters because the active
 * origin moves as we rotate: a purely positional "next" bounces straight back to
 * a route that has already failed, and the device never reaches the third one.
 *
 * Returns the origin to dial (now active), or `null` when every advertised
 * route has been ruled out — at which point the caller should back off rather
 * than spin.
 */
export function advanceRoute(failedOrigin: string, attempted: string[] = []): string | null {
  const tried = new Set([...attempted, failedOrigin, deviceBaseUrl()])
  const next = deviceRoutes().find((route) => !tried.has(route))
  if (!next) return null
  setDeviceBaseUrl(next)
  return next
}

/**
 * An opaque, stable per-device key the daemon stores alongside the token. It is
 * not a secret in the auth sense (the token is), just a device identity; a random
 * uuid generated once and persisted is enough.
 */
export function deviceKey(): string {
  let key = storage.getString(DEVICE_KEY_STORAGE)
  if (!key) {
    key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`
    storage.set(DEVICE_KEY_STORAGE, key)
  }
  return key
}

/** A human device name for the desktop's paired-devices list. */
export function deviceName(): string {
  const name = Device.deviceName || Device.modelName
  if (name) return name
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android device' : 'Mobile'
}

/**
 * Persist a successful pairing: the daemon origin, the bearer token, and — when
 * the QR carried them — the other advertised origins to fail over to.
 */
export async function savePairing(baseUrl: string, token: string, routes?: string[]): Promise<void> {
  const ordered = [baseUrl, ...(routes ?? [])].map((route) => route.replace(/\/+$/, ''))
  const unique = Array.from(new Set(ordered.filter(Boolean)))
  await persistBaseUrl(baseUrl)
  await persistRoutes(unique.length > 1 ? unique : null)
  await persistToken(token)
}

export async function clearPairing(): Promise<void> {
  await clearCredentials()
}

export { hydrateCredentials }

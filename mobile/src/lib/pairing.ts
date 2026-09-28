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
import { deviceBaseUrl } from './native'
import { persistBaseUrl, persistToken, clearCredentials, hydrateCredentials } from './secureStore'
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

/** Persist a successful pairing: the daemon origin and the bearer token. */
export async function savePairing(baseUrl: string, token: string): Promise<void> {
  await persistBaseUrl(baseUrl)
  await persistToken(token)
}

export async function clearPairing(): Promise<void> {
  await clearCredentials()
}

export { hydrateCredentials }

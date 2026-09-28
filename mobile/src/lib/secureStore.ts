/**
 * Credential storage: iOS Keychain / Android Keystore via expo-secure-store.
 *
 * The device token and paired daemon URL are the two secrets that unlock the
 * backend. They live in MMKV as the fast synchronous copy the API/socket read on
 * every call, and are mirrored here so a reinstall or an MMKV clear can restore
 * them, and so they are protected by the platform keystore at rest.
 *
 * Hydration is async (the keystore is), so it runs once at app start before the
 * first request; the MMKV copies are authoritative for synchronous reads after
 * that. Every write updates both, so the two never diverge.
 */

import * as SecureStore from 'expo-secure-store'
import { storage } from './storage'
import { setDeviceBaseUrl } from './native'

/** MMKV key for the device token (mirrors the web app's localStorage key). */
export const TOKEN_KEY = 'agentdeck-device-token'

const SECURE_TOKEN = 'ad_device_token'
const SECURE_BASE = 'ad_device_base_url'

async function safeSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value)
  } catch {
    // Keystore unavailable (some simulators/first run) — the MMKV copy still
    // works for this install; we just lose cross-reinstall restore.
  }
}

async function safeDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch {
    // Nothing to remove.
  }
}

/** Pull the persisted secrets into the synchronous MMKV copies. Call at startup. */
export async function hydrateCredentials(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(SECURE_TOKEN)
    if (token) storage.set(TOKEN_KEY, token)
  } catch {
    // ignore — MMKV copy (if any) remains
  }
  try {
    const base = await SecureStore.getItemAsync(SECURE_BASE)
    if (base) setDeviceBaseUrl(base)
  } catch {
    // ignore
  }
}

export async function persistToken(token: string | null): Promise<void> {
  if (token === null || token === '') {
    storage.delete(TOKEN_KEY)
    await safeDelete(SECURE_TOKEN)
    return
  }
  storage.set(TOKEN_KEY, token)
  await safeSet(SECURE_TOKEN, token)
}

export async function persistBaseUrl(baseUrl: string | null): Promise<void> {
  const trimmed = (baseUrl ?? '').replace(/\/+$/, '')
  setDeviceBaseUrl(trimmed || null)
  if (!trimmed) {
    await safeDelete(SECURE_BASE)
    return
  }
  await safeSet(SECURE_BASE, trimmed)
}

export async function clearCredentials(): Promise<void> {
  await persistToken(null)
  await persistBaseUrl(null)
}

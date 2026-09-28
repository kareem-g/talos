/**
 * Synchronous key-value storage backed by MMKV.
 *
 * The web app uses `localStorage`, which is synchronous — and the ported store
 * relies on that to initialize preferences (starred, timeline detail) at module
 * load. MMKV is also synchronous, so it is a drop-in replacement that keeps that
 * pattern working; AsyncStorage is async and would force an awkward hydrate.
 *
 * Secrets (device token, paired base URL) live here as the fast live copy and are
 * mirrored into the iOS Keychain / Android Keystore by `secureStore.ts`.
 */

import { MMKV } from 'react-native-mmkv'

export const mmkv = new MMKV({ id: 'agentdeck' })

export const storage = {
  getString(key: string): string | null {
    return mmkv.getString(key) ?? null
  },
  set(key: string, value: string): void {
    mmkv.set(key, value)
  },
  delete(key: string): void {
    mmkv.delete(key)
  },
  getJSON<T>(key: string): T | null {
    const raw = mmkv.getString(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },
  setJSON(key: string, value: unknown): void {
    mmkv.set(key, JSON.stringify(value))
  },
}

/** A `Set` persisted as JSON — used for the notification dedup ledger. */
export function readStringSet(key: string): Set<string> {
  const arr = storage.getJSON<string[]>(key)
  return new Set(Array.isArray(arr) ? arr : [])
}

export function writeStringSet(key: string, set: Set<string>): void {
  // Bound the ledger so it cannot grow without limit across a long-lived install.
  const arr = Array.from(set).slice(-2000)
  storage.setJSON(key, arr)
}

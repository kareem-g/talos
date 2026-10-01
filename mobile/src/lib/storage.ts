/**
 * Synchronous key-value storage, backed by MMKV when it is available.
 *
 * The web app uses `localStorage`, which is synchronous — and the ported store
 * relies on that to initialize preferences (starred, timeline detail) at module
 * load. MMKV is also synchronous, so it is a drop-in replacement that keeps that
 * pattern working; AsyncStorage is async and would force an awkward hydrate.
 *
 * WHY THERE IS A FALLBACK
 * -----------------------
 * MMKV is a native module and is not bundled by Expo Go, which is how this app
 * gets reviewed on a phone. Constructing it there threw at *module load* — the
 * declaration below runs on import, so the app died on the splash rather than
 * the first write — which made the whole app untestable without a custom build.
 *
 * So the backend is chosen at runtime: MMKV when the native module answers, an
 * in-memory map when it does not. A dev build gets the real thing and real
 * persistence; Expo Go gets a working app whose preferences reset on reload.
 * The fallback announces itself once, because silently losing persistence is
 * the kind of thing that wastes an afternoon.
 *
 * Secrets (device token, paired base URL) live here as the fast live copy and
 * are mirrored into the iOS Keychain / Android Keystore by `secureStore.ts`.
 */

interface KvBackend {
  getString(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
}

function memoryBackend(): KvBackend {
  const map = new Map<string, string>()
  return {
    getString: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    delete: (key) => void map.delete(key),
  }
}

const { backend: kv, persistent } = ((): { backend: KvBackend; persistent: boolean } => {
  try {
    // Required lazily: the import itself is fine, but `new MMKV()` throws when
    // the native module is missing, and this file is imported at boot.
    const mmkvModule = require('react-native-mmkv') as typeof import('react-native-mmkv')
    return { backend: new mmkvModule.MMKV({ id: 'qai' }), persistent: true }
  } catch {
    if (__DEV__) {
      console.warn(
        '[qai] MMKV is unavailable (Expo Go does not bundle it) — falling back to ' +
          'in-memory storage. Preferences will reset when the app reloads. ' +
          'Use a development build for real persistence.',
      )
    }
    return { backend: memoryBackend(), persistent: false }
  }
})()

/** False when running without the native MMKV (i.e. under Expo Go). */
export const isPersistentStorage = persistent

export const storage = {
  getString(key: string): string | null {
    return kv.getString(key) ?? null
  },
  set(key: string, value: string): void {
    kv.set(key, value)
  },
  delete(key: string): void {
    kv.delete(key)
  },
  getJSON<T>(key: string): T | null {
    const raw = kv.getString(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },
  setJSON(key: string, value: unknown): void {
    kv.set(key, JSON.stringify(value))
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
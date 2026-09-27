/**
 * Keychain-backed credential storage for the native shell.
 *
 * The pairing token is a bearer credential for the whole daemon API, so on a
 * real device it belongs in the Keychain rather than only in web storage.
 * `localStorage` stays the runtime source of truth because the request layer
 * and the socket read it synchronously on every call — this module mirrors
 * those two values into (and back out of) the Keychain:
 *
 *   launch  → hydrate:  Keychain → localStorage, before the first render
 *   pair    → persist:  localStorage → Keychain (synchronous write)
 *   unpair  → clear:    both sides
 *
 * Writes pass `sync: true` so the credential is on disk before the app can be
 * killed, and the origin is stored alongside the token so re-pairing to a
 * different machine can never half-restore.
 */

import { isNativeApp } from './native'
import { TOKEN_KEY } from './api'
import { BASE_URL_KEY } from './native'

const KEYS = [TOKEN_KEY, BASE_URL_KEY] as const

type SecureStorageModule = {
  get: (key: string, convertDate?: boolean, sync?: boolean) => Promise<unknown>
  set: (key: string, data: string, convertDate?: boolean, sync?: boolean) => Promise<void>
  remove: (key: string, sync?: boolean) => Promise<boolean>
}

async function store(): Promise<SecureStorageModule | null> {
  try {
    const module = await import('@aparajita/capacitor-secure-storage')
    return module.SecureStorage as unknown as SecureStorageModule
  } catch {
    return null
  }
}

/**
 * Pull Keychain values into web storage when web storage has none.
 *
 * Only fills gaps: if web storage already holds a value it wins, so a user who
 * cleared the Keychain is not resurrected by a stale copy. Resolves to whether
 * anything was actually restored — callers use that to decide if a render that
 * already happened needs to be redone.
 *
 * Never rejects, and callers must not block rendering on it: a Keychain read can
 * stall (device locked at launch, plugin not answering), and a stalled promise
 * awaiting before the first render is a black screen.
 */
export async function hydrateCredentials(): Promise<boolean> {
  if (!isNativeApp()) return false
  const secure = await store()
  if (!secure) return false
  let restored = false
  for (const key of KEYS) {
    try {
      if (localStorage.getItem(key)) continue
      const value = await secure.get(key)
      if (typeof value === 'string' && value.length > 0) {
        localStorage.setItem(key, value)
        restored = true
      }
    } catch {
      // Locked keychain or a first launch: nothing to restore.
    }
  }
  return restored
}

/** Mirror the current web-storage credentials into the Keychain. */
export async function persistCredentials(): Promise<void> {
  if (!isNativeApp()) return
  const secure = await store()
  if (!secure) return
  for (const key of KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value === null) {
        await secure.remove(key, true)
      } else {
        await secure.set(key, value, false, true)
      }
    } catch {
      // Non-fatal: web storage still holds the live value for this session.
    }
  }
}

/** Drop both copies — used when the desktop revokes the device or on unpair. */
export async function clearCredentials(): Promise<void> {
  if (!isNativeApp()) return
  const secure = await store()
  if (!secure) return
  for (const key of KEYS) {
    try {
      await secure.remove(key, true)
    } catch {
      // Nothing to remove.
    }
  }
}

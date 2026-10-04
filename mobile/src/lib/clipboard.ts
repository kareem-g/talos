/**
 * The clipboard, with a backend that survives Expo Go.
 *
 * `@react-native-clipboard/clipboard` wraps a native module (`RNCClipboard`)
 * that Expo Go does not bundle. Importing the package — or even `require`-ing it
 * inside a `try` — is not survivable there: the missing module is a
 * `getEnforcing` invariant, which the module registry reports as a fatal error,
 * so a `try/catch` around the `require` does not contain it and the whole app
 * goes down on load.
 *
 * The fix is to never load that package. `TurboModuleRegistry.get` is the
 * non-throwing form of the same lookup: it returns `null` when the module is not
 * in the binary. So the native module is resolved directly, once per call, and a
 * runtime without it degrades to a no-op with a warning rather than a crash.
 * A development or standalone build (where the module is autolinked) gets the
 * real clipboard.
 */

import { TurboModuleRegistry } from 'react-native'

interface NativeClipboard {
  setString(value: string): void
  getString(): Promise<string>
}

function nativeClipboard(): NativeClipboard | null {
  try {
    return (TurboModuleRegistry.get('RNCClipboard') as unknown as NativeClipboard | null) ?? null
  } catch {
    return null
  }
}

/** Whether this runtime bundles the native clipboard module. */
export function clipboardAvailable(): boolean {
  return nativeClipboard() !== null
}

export function setClipboardString(value: string): void {
  const clipboard = nativeClipboard()
  if (!clipboard) {
    if (__DEV__) {
      console.warn('[qai] Clipboard is unavailable in this runtime — nothing was copied.')
    }
    return
  }
  try {
    clipboard.setString(value)
  } catch {
    if (__DEV__) {
      console.warn('[qai] Clipboard write failed.')
    }
  }
}

/** Read the clipboard, or `null` where the module is not in this runtime. */
export async function getClipboardString(): Promise<string | null> {
  const clipboard = nativeClipboard()
  if (!clipboard) {
    if (__DEV__) {
      console.warn('[qai] Clipboard is unavailable in this runtime — nothing was pasted.')
    }
    return null
  }
  try {
    return await clipboard.getString()
  } catch {
    if (__DEV__) {
      console.warn('[qai] Clipboard read failed.')
    }
    return null
  }
}
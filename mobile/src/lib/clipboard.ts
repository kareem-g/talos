/**
 * The clipboard, with a backend that survives Expo Go.
 *
 * `@react-native-clipboard/clipboard` is a native module and is not bundled by
 * Expo Go, so importing it directly means every screen that offers a Copy
 * button — the session header, the drawer's device token, the copy affordance in
 * the primitive kit — fails to load there.
 *
 * Copying is a convenience, never a step in a flow, so the honest degradation is
 * a no-op with a warning rather than a crash. A development build gets the real
 * clipboard; so does anything running on a platform where the module resolves.
 */

export function setClipboardString(value: string): void {
  try {
    const mod = require('@react-native-clipboard/clipboard') as
      | { default?: { setString(v: string): void }; setString?: (v: string) => void }
      | undefined
    const clipboard = mod?.default ?? (mod as unknown as { setString(v: string): void } | undefined)
    clipboard?.setString(value)
  } catch {
    if (__DEV__) {
      console.warn('[qai] Clipboard is unavailable in this runtime — nothing was copied.')
    }
  }
}
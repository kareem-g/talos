/**
 * The command emitter — a module-level channel, not a React context.
 *
 * Same reasoning as `lib/newTask` and `lib/drawer`: the Command sheet is app
 * chrome, mounted once at the root by `CommandHost` and opened from the raised
 * action in the tab bar through a plain function call. A sheet owned by a
 * navigator would be swallowed by whatever screen happened to be focused.
 */

type Listener = () => void

let listener: Listener | null = null

/** Open the Command sheet from anywhere. */
export function openCommand(): void {
  listener?.()
}

/** Owned by `CommandHost`; nothing else should call this. */
export function setCommandListener(next: Listener | null): void {
  listener = next
}
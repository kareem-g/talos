/**
 * The drawer emitter — a module-level channel, not a React context.
 *
 * Same reasoning as `lib/newTask`: the navigation drawer is app chrome. It is
 * mounted once at the root by `DrawerHost` and opened from any screen's top
 * bar through a plain function call, so no screen has to own it and no
 * navigator state can swallow it.
 */

type Listener = () => void

let listener: Listener | null = null

/** Open the navigation drawer from anywhere. */
export function openDrawer(): void {
  listener?.()
}

/** Owned by `DrawerHost`; nothing else should call this. */
export function setDrawerListener(next: Listener | null): void {
  listener = next
}

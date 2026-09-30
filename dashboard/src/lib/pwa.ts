/**
 * PWA wiring — the browser app installs like an app, because it is one.
 *
 * "Remote control from your pocket" only works if the phone keeps QAI a
 * tap away and doesn't treat it as just another tab: installed to the home
 * screen, standalone display, its own icon, service worker for offline shell.
 *
 * `registerSW` is called once from main.tsx; failures are non-fatal (private
 * browsing, unsupported browsers) because everything else still works.
 */

import { isNativeApp } from './native'

export function registerSW(): void {
  // A native shell ships its bundle inside the app, so a service worker can
  // only ever serve a *stale* copy of it — and because the shell's origin is
  // `capacitor://localhost`, the localhost exemption below would otherwise let
  // it register. Unregister anything left over from an earlier build.
  if (isNativeApp()) {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((registration) => void registration.unregister()))
        .catch(() => {})
    }
    return
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    // Service workers need a secure context. Over LAN HTTP the app still works
    // as a normal page — pairing over Tailscale HTTPS gets installability.
    return
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal: no offline shell, nothing else breaks.
    })
  })
}

/** True when this page runs installed-and-standalone rather than in a tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

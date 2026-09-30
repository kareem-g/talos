import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerSW } from './lib/pwa'
import { initTheme } from './lib/theme'
import { initNativeUX } from './lib/nativeUX'
import { hydrateCredentials } from './lib/secureStore'
import './index.css'

// Theme is applied pre-paint by the inline script in index.html; this re-applies
// stored prefs (and the system-mode listener) once the app owns the document.
initTheme()

// No-op in the browser; sets up status bar/zoom/haptics in the native shell.
void initNativeUX()

const root = document.getElementById('root')!

// A crash during mount would otherwise leave a blank page with the reason only
// in the devtools console — which is unreachable on a phone, the primary client.
window.addEventListener('error', (errorEvent) => {
  if (root.childElementCount > 0) return
  root.textContent = `Startup error: ${errorEvent.message}\n\n${errorEvent.error?.stack ?? ''}`
})

// Same reason, for a start that hangs instead of throwing: the page would sit on
// `body`'s background — a black screen with nothing to act on. The timer is
// cleared the moment React mounts.
const watchdog = window.setTimeout(() => {
  if (root.childElementCount > 0) return
  root.textContent =
    'QAI could not start. Close and reopen the app. If it keeps happening, re-pair this device.'
}, 6000)

registerSW()

/**
 * Mount first, restore credentials after.
 *
 * Rendering must not wait on a native call: the Keychain read can stall (device
 * locked at launch, plugin not answering), and an unrendered page is a black
 * screen with no way out. So the app paints immediately from web storage, and
 * the Keychain is consulted in the background.
 *
 * If that background read turns out to hold credentials the first paint could
 * not see, the app reloads once so it starts paired instead of showing the
 * pairing screen. It cannot loop: the next pass finds the values already in web
 * storage and restores nothing.
 */
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
window.clearTimeout(watchdog)

void hydrateCredentials()
  .then((restored) => {
    if (restored) window.location.reload()
  })
  .catch(() => {})

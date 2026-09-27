import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell around the dashboard bundle.
 *
 * The same React app ships in two forms from one source:
 *   - PWA: served by the daemon at `http://<host>:9120` (unchanged).
 *   - Native (this config): the bundle is compiled into the app, so the daemon
 *     is reached over the network instead. The paired daemon origin is stored
 *     at pairing time and prefixed onto every request (`src/lib/native.ts`).
 *
 * A distinct bundle id keeps the shell installable side by side with the
 * SwiftUI companion (`com.agentdeck.ios`).
 */
const config: CapacitorConfig = {
  appId: 'com.agentdeck.mobile',
  appName: 'AgentDeck',
  webDir: 'dist',
  ios: {
    // The app draws its own safe-area padding (see index.html / theme.ts).
    contentInset: 'never',
    backgroundColor: '#131315',
  },
}

export default config

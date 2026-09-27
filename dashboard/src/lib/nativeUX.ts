/**
 * Native-shell behaviour.
 *
 * Everything here is a no-op in the browser, so the same bundle serves both
 * clients while the native build picks up the platform affordances a webview
 * does not provide by default: a status bar that matches the theme, no
 * pinch-zoom or rubber-band hints, and haptics on the actions that matter.
 */

import { isNativeApp } from './native'

/** Resolved theme the app is currently painted in. */
function resolvedTheme(): 'dark' | 'light' {
  const attr = document.documentElement.dataset.theme
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Canvas colour per theme — keep in sync with `--canvas` in index.css. */
const CANVAS = { dark: '#131315', light: '#f8f8fa' } as const

let statusBarReady = false

/**
 * Called once at startup. Guarded so importing native plugins never runs in a
 * browser (where the modules exist but throw on use).
 */
export async function initNativeUX(): Promise<void> {
  if (!isNativeApp()) return

  document.documentElement.classList.add('native-shell')

  // A bundled app is not a web page: pinch-zoom and double-tap-zoom read as
  // bugs, and the safe-area insets still need `viewport-fit=cover`.
  const viewport = document.querySelector('meta[name="viewport"]')
  viewport?.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
  )

  await syncStatusBar()
  // Re-apply when the user flips light/dark (theme.ts writes the attribute).
  new MutationObserver(() => void syncStatusBar()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  statusBarReady = true
}

async function syncStatusBar(): Promise<void> {
  try {
    const [{ StatusBar, Style }, { Keyboard, KeyboardStyle }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/keyboard'),
    ])
    const theme = resolvedTheme()
    // `Style.Light` = light status-bar *content*, for a dark background.
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark })
    try {
      await StatusBar.setBackgroundColor({ color: CANVAS[theme] })
    } catch {
      // iOS drives this from the plist; Android only.
    }
    try {
      await Keyboard.setStyle({
        style: theme === 'dark' ? KeyboardStyle.Dark : KeyboardStyle.Light,
      })
    } catch {
      // Style is config-driven on some platforms.
    }
  } catch {
    // Plugins missing (older native build) — the app still works.
  }
}

/** True once the native shell applied its platform styling. */
export function isNativeUXReady(): boolean {
  return statusBarReady
}

/**
 * Fire-and-forget haptics. Called from interaction handlers; silently does
 * nothing on the web, so call sites stay free of platform checks.
 */
export function haptic(kind: 'tap' | 'success' | 'warning' | 'error' = 'tap'): void {
  if (!isNativeApp()) return
  void (async () => {
    try {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
      if (kind === 'tap') {
        await Haptics.impact({ style: ImpactStyle.Light })
        return
      }
      const type =
        kind === 'success'
          ? NotificationType.Success
          : kind === 'warning'
            ? NotificationType.Warning
            : NotificationType.Error
      await Haptics.notification({ type })
    } catch {
      // No haptics available (simulator, web) — not an error worth surfacing.
    }
  })()
}

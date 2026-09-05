/**
 * Theme system — light / dark / system + a customizable accent color.
 *
 * Mechanism: `data-theme="dark|light"` on <html> selects a CSS-variable
 * palette (index.css); a custom accent overrides the `--accent*` family via
 * inline style properties, so no Tailwind rebuild is ever needed.
 *
 * Persistence is local per device (`agentdeck-theme`, `agentdeck-accent`),
 * matching the app's other local prefs. index.html runs a tiny inline script
 * that applies the stored theme before first paint to avoid a flash.
 */

export type ThemeMode = 'system' | 'dark' | 'light'

const THEME_KEY = 'agentdeck-theme'
const ACCENT_KEY = 'agentdeck-accent'

export const ACCENT_PRESETS: Array<{ name: string; hex: string }> = [
  { name: 'Blue', hex: '#5b8def' },
  { name: 'Green', hex: '#4fae7c' },
  { name: 'Violet', hex: '#9d7ce0' },
  { name: 'Rose', hex: '#d96a8a' },
  { name: 'Amber', hex: '#e3a15d' },
]

export function readStoredTheme(): { mode: ThemeMode; accent?: string } {
  let mode: ThemeMode = 'system'
  let accent: string | undefined
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') mode = stored
    accent = localStorage.getItem(ACCENT_KEY) ?? undefined
  } catch {
    /* storage may be unavailable */
  }
  return { mode, accent }
}

function resolveMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/* ── Accent derivation ─────────────────────────────────────────────────── */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

function mix(base: [number, number, number], target: [number, number, number], amount: number): [number, number, number] {
  return [
    base[0] + (target[0] - base[0]) * amount,
    base[1] + (target[1] - base[1]) * amount,
    base[2] + (target[2] - base[2]) * amount,
  ]
}

/** Derived accent family for a base accent + theme: hover (lighter), a
 *  contrasting ink that sits on the accent, a tint, and a deeper shade. */
function accentFamily(hex: string, light: boolean) {
  const base = parseHex(hex)
  if (!base) return null
  const white: [number, number, number] = [255, 255, 255]
  const black: [number, number, number] = [20, 16, 12]
  return {
    accent: toHex(...base),
    hover: toHex(...mix(base, white, light ? -0 + 0.12 : 0.12)),
    ink: toHex(...(light ? black : [33, 23, 17] as [number, number, number])),
    tint: `rgba(${base.map((v) => Math.round(v)).join(',')}, ${light ? 0.14 : 0.12})`,
    second: toHex(...mix(base, black, light ? 0.25 : 0.12)),
  }
}

/* ── Applying ───────────────────────────────────────────────────────────── */

let systemListener: ((event: MediaQueryListEvent) => void) | null = null

/** Apply (and persist) a theme mode + optional custom accent. */
export function applyTheme(mode: ThemeMode, accent?: string) {
  try {
    localStorage.setItem(THEME_KEY, mode)
    if (accent) localStorage.setItem(ACCENT_KEY, accent)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    /* storage may be unavailable */
  }
  applyToDocument(mode, accent)

  // Keep 'system' live: follow OS changes until an explicit mode is chosen.
  if (systemListener) {
    window.matchMedia('(prefers-color-scheme: light)').removeEventListener('change', systemListener)
    systemListener = null
  }
  if (mode === 'system' && window.matchMedia) {
    systemListener = () => applyToDocument('system', accent)
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', systemListener)
  }
}

function applyToDocument(mode: ThemeMode, accent?: string) {
  const resolved = resolveMode(mode)
  const root = document.documentElement
  root.dataset.theme = resolved
  // Clear any previous inline accent overrides first.
  for (const key of ['--accent', '--accent-hover', '--accent-ink', '--accent-tint', '--accent-2']) {
    root.style.removeProperty(key)
  }
  if (accent) {
    const family = accentFamily(accent, resolved === 'light')
    if (family) {
      root.style.setProperty('--accent', family.accent)
      root.style.setProperty('--accent-hover', family.hover)
      root.style.setProperty('--accent-ink', family.ink)
      root.style.setProperty('--accent-tint', family.tint)
      root.style.setProperty('--accent-2', family.second)
    }
  }
  // The OS/PWA chrome paints its safe areas with the page's theme-color —
  // keep it equal to the resolved canvas so installed light mode has no
  // dark band.
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim() || '#141210'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas)
  window.dispatchEvent(new CustomEvent('agentdeck-theme-change', { detail: { resolved, accent } }))
}

/** One-time boot: apply stored prefs (also mirrored by the index.html
 *  pre-paint script; this covers SPA-internal navigation safety). */
export function initTheme() {
  const { mode, accent } = readStoredTheme()
  applyTheme(mode, accent)
}

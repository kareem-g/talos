/** @type {import('tailwindcss').Config} */
// iOS 26 design system — dark-only, liquid-glass-first.
// Tokens are evolved from the desktop dashboard to feel native on iPhone:
// warmer canvas, softer hairlines, larger radii, and a surface ramp that
// reads as physical layers under glass chrome.
module.exports = {
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Surfaces ──────────────────────────────────────────────────────
        // Warmer dark base than the desktop (#131315 → #0f0f11) so glass
        // chrome has a richer ground to float above.
        canvas: '#0f0f11',
        sidebar: '#141417',
        inset: '#18181c',
        field: '#1e1e23',
        surface: '#252529',
        hover: '#2c2c32',
        'hover-2': '#222227',

        // ── Text ──────────────────────────────────────────────────────────
        // Slightly higher contrast for legibility over glass.
        ink: '#f5f5f7',
        'ink-2': '#b5b5bc',
        'ink-3': '#86868e',

        // ── Hairlines ─────────────────────────────────────────────────────
        // Softer dividers that recede under glass materials.
        line: 'rgba(255,255,255,0.08)',
        'line-strong': 'rgba(255,255,255,0.14)',

        // ── Accent ────────────────────────────────────────────────────────
        // Shifted slightly warmer to complement the warmer canvas.
        accent: '#5e9eff',
        'accent-hover': '#72acff',
        'accent-ink': '#0a1628',
        'accent-tint': 'rgba(94,158,255,0.14)',
        'accent-2': '#4d8ae0',

        // ── Status ────────────────────────────────────────────────────────
        green: '#4cd964',
        'green-tint': 'rgba(76,217,100,0.14)',
        red: '#ff453a',
        'red-tint': 'rgba(255,69,58,0.14)',
        orange: '#ff9f0a',
        'orange-tint': 'rgba(255,159,10,0.14)',
        'green-border': 'rgba(76,217,100,0.30)',
        'red-border': 'rgba(255,69,58,0.30)',
        'orange-border': 'rgba(255,159,10,0.30)',

        // ── Agent identity hues ───────────────────────────────────────────
        'agent-green': '#4fae7c',
        'agent-purple': '#a78bfa',
        'agent-blue': '#6396cc',
        'agent-orange': '#e07a5f',
        'agent-yellow': '#45b8c2',
        'agent-pink': '#d96a8a',

        // ── Terminal ──────────────────────────────────────────────────────
        'term-bg': '#141416',
        'term-fg': '#e8e8eb',
      },
      borderRadius: {
        // iOS-native radii: cards get 20px (matching iOS sheet corners),
        // controls stay fully rounded for pill affordances.
        card: '20px',
        control: '999px',
        chip: '999px',
      },
      fontFamily: {
        mono: ['Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

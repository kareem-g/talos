/** @type {import('tailwindcss').Config} */
// Dark-theme tokens mirrored one-for-one from dashboard/src/index.css so the
// mobile app is the same control station on a smaller screen: the same canvas /
// inset / field / surface ramp, the same ink and line hairlines, the same accent
// and status hues, and the same radii (card 16px, control/chip fully rounded).
// Additions over the desktop set are noted inline. Light theming via CSS vars is
// a desktop concern; the native app is dark-only, matching the desktop default.
module.exports = {
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces. `sidebar` is the nav rail colour, distinct from canvas.
        canvas: '#131315',
        sidebar: '#17171b',
        inset: '#19191c',
        field: '#202024',
        surface: '#26262b',
        hover: '#2e2e34',
        'hover-2': '#222226',
        // Text
        ink: '#f2f2f3',
        'ink-2': '#b0b0b6',
        'ink-3': '#7e7e86',
        // Hairlines
        line: '#34343a',
        'line-strong': '#42424a',
        // Accent
        accent: '#5b8def',
        'accent-hover': '#6f9bf2',
        'accent-ink': '#0d1322',
        'accent-tint': 'rgba(91,141,239,0.12)',
        'accent-2': '#4a76d1',
        // Status
        green: '#57ab5a',
        'green-tint': 'rgba(87,171,90,0.12)',
        red: '#f85149',
        'red-tint': 'rgba(248,81,73,0.12)',
        orange: '#db6d28',
        'orange-tint': 'rgba(219,109,40,0.12)',
        'green-border': 'rgba(87,171,90,0.30)',
        'red-border': 'rgba(248,81,73,0.30)',
        'orange-border': 'rgba(219,109,40,0.30)',
        // Agent identity hues — hashed per agent id on the desktop, so a
        // provider keeps one colour everywhere.
        'agent-green': '#4fae7c',
        'agent-purple': '#a78bfa',
        'agent-blue': '#6396cc',
        'agent-orange': '#e07a5f',
        'agent-yellow': '#45b8c2',
        'agent-pink': '#d96a8a',
        // Terminal
        'term-bg': '#161618',
        'term-fg': '#e6e6e9',
      },
      borderRadius: {
        // Desktop radii, verbatim.
        card: '16px',
        control: '999px',
        chip: '999px',
      },
      fontFamily: {
        // The desktop pairs IBM Plex Sans with JetBrains Mono. Those faces are
        // not bundled on device, so `font-mono` falls back to the platform mono
        // (see Mono in components/ui.tsx, which resolves it per-platform).
        mono: ['Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
// Dark-theme tokens mirrored from dashboard/src/index.css so the mobile app
// looks like the desktop control station. Light/accent theming via CSS vars is
// a later-phase concern; the dark palette is concrete here so screens can be
// built against real values now.
module.exports = {
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#131315',
        inset: '#19191c',
        field: '#202024',
        surface: '#26262b',
        hover: '#2e2e34',
        'hover-2': '#222226',
        ink: '#f2f2f3',
        'ink-2': '#b0b0b6',
        'ink-3': '#7e7e86',
        line: '#34343a',
        'line-strong': '#42424a',
        accent: '#5b8def',
        'accent-hover': '#6f9bf2',
        'accent-ink': '#0d1322',
        'accent-tint': 'rgba(91,141,239,0.12)',
        'accent-2': '#4a76d1',
        green: '#57ab5a',
        'green-tint': 'rgba(87,171,90,0.12)',
        red: '#f85149',
        'red-tint': 'rgba(248,81,73,0.12)',
        orange: '#db6d28',
        'orange-tint': 'rgba(219,109,40,0.12)',
        'green-border': 'rgba(87,171,90,0.30)',
        'red-border': 'rgba(248,81,73,0.30)',
        'orange-border': 'rgba(219,109,40,0.30)',
        'term-bg': '#161618',
        'term-fg': '#e6e6e9',
      },
      borderRadius: {
        card: '16px',
        control: '999px',
        chip: '999px',
      },
    },
  },
  plugins: [],
}

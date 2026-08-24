/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Color tokens matching the premium dark Grok×Apple design system.
       */
      colors: {
        canvas: 'var(--canvas)',
        inset: 'var(--inset)',
        field: 'var(--field)',
        surface: 'var(--surface)',
        hover: 'var(--hover)',
        'hover-2': 'var(--hover-2)',

        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',

        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',

        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        'accent-tint': 'var(--accent-tint)',

        green: 'var(--green)',
        'green-tint': 'var(--green-tint)',
        red: 'var(--red)',
        'red-tint': 'var(--red-tint)',
        orange: 'var(--orange)',
        'orange-tint': 'var(--orange-tint)',
        'green-border': 'var(--green-border)',
        'red-border': 'var(--red-border)',
        'orange-border': 'var(--orange-border)',

        'term-bg': 'var(--term-bg)',
        'term-fg': 'var(--term-fg)',
      },
      borderRadius: {
        card: '16px',
        control: '999px',
        chip: '999px',
      },
      boxShadow: {
        btn: 'var(--shadow-btn)',
        hairline: 'var(--shadow-hairline)',
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
      },
      spacing: {
        '4.5': '1.125rem',
        '5.5': '1.375rem',
        '6.5': '1.625rem',
        '7.5': '1.875rem',
        '8.5': '2.125rem',
        '11.5': '2.875rem',
        '15': '3.75rem',
        '30': '7.5rem',
        '37': '9.25rem',
        '68': '17rem',
        '78': '19.5rem',
        '86': '21.5rem',
        '95': '23.75rem',
      },
      maxWidth: {
        '80': '20rem',
        '86': '21.5rem',
        '95': '23.75rem',
      },
      fontFamily: {
        sans: [
          'IBM Plex Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'Cascadia Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

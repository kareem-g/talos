/**
 * Build a Tailwind color value from a CSS-variable token. Solid usage returns
 * the raw var; an opacity modifier (e.g. `bg-surface/90`) returns a browser-
 * supported `color-mix()`. This is what lets `/NN` variants work on hex vars.
 */
const tone = (name) => ({ opacityValue }) => {
  // Tailwind calls a color function with `opacityValue` in two shapes:
  //   - solid class  -> the string `var(--tw-bg-opacity, 1)` (not numeric)
  //   - `/95` class  -> the string `"0.95"` (a decimal)
  // Only the decimal is a real alpha; anything non-numeric must fall back to
  // the raw var, otherwise solid classes emit `color-mix(... NaN%, ...)`.
  const n = Number(opacityValue)
  if (!Number.isFinite(n)) return `var(--${name})`
  // Defensive: some callers pass an integer percent ("95") instead of a
  // decimal ("0.95"). Clamp both to a percentage.
  const percent = n > 1 ? Math.round(n) : Math.round(n * 100)
  return `color-mix(in srgb, var(--${name}) ${percent}%, transparent)`
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * Color tokens matching the premium dark Grok×Apple design system.
       *
       * Each is a function so an opacity modifier (e.g. `bg-surface/90`) emits a
       * valid `color-mix(...)`. Plugging `var(--surface)` directly makes Tailwind
       * drop `/NN` variants (it can't alpha a hex var), leaving transparent
       * surfaces — so we wrap the hex var in color-mix for alpha.
       */
      colors: {
        canvas: tone('canvas'),
        inset: tone('inset'),
        field: tone('field'),
        surface: tone('surface'),
        hover: tone('hover'),
        'hover-2': tone('hover-2'),

        ink: tone('ink'),
        'ink-2': tone('ink-2'),
        'ink-3': tone('ink-3'),

        line: tone('line'),
        'line-strong': tone('line-strong'),

        accent: tone('accent'),
        'accent-ink': tone('accent-ink'),
        'accent-tint': tone('accent-tint'),

        green: tone('green'),
        'green-tint': tone('green-tint'),
        red: tone('red'),
        'red-tint': tone('red-tint'),
        orange: tone('orange'),
        'orange-tint': tone('orange-tint'),
        'green-border': tone('green-border'),
        'red-border': tone('red-border'),
        'orange-border': tone('orange-border'),

        'term-bg': tone('term-bg'),
        'term-fg': tone('term-fg'),
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

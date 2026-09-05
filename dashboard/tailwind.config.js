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
        'accent-hover': tone('accent-hover'),
        'accent-ink': tone('accent-ink'),
        'accent-tint': tone('accent-tint'),
        'accent-2': tone('accent-2'),

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

        /*
         * Default palette overrides for the warm system — var-backed so the
         * ramps flip with the theme (dark warm studio / light warm paper).
         * `emerald` is NOT a green anymore: the app's emerald literals are
         * running/active marks, so the ramp maps to warm amber. Values come
         * from --{color}-{step} CSS variables defined per theme in index.css;
         * steps without a var fall back to the dark hex.
         */
        zinc: {
          50: tone('zinc-50'),
          100: tone('zinc-100'),
          200: tone('zinc-200'),
          300: tone('zinc-300'),
          400: tone('zinc-400'),
          500: tone('zinc-500'),
          600: tone('zinc-600'),
          700: tone('zinc-700'),
          800: tone('zinc-800'),
          900: tone('zinc-900'),
          950: tone('zinc-950'),
        },
        emerald: {
          50: '#fdf4e6',
          100: '#fae7cc',
          200: '#f5d2a3',
          300: tone('emerald-300'),
          400: tone('emerald-400'),
          500: tone('emerald-500'),
          600: tone('emerald-600'),
          700: tone('emerald-700'),
          800: '#6b3f24',
          900: '#4a2b18',
        },
        amber: {
          50: '#fdf3e2',
          100: '#fbead3',
          200: '#f6d7ab',
          300: tone('amber-300'),
          400: tone('amber-400'),
          500: tone('amber-500'),
          600: tone('amber-600'),
          700: tone('amber-700'),
          800: '#6a3d1f',
          900: '#492915',
        },
        orange: {
          50: '#fdf0e8',
          100: '#fae4d5',
          200: '#f5cdb6',
          300: tone('orange-300'),
          400: tone('orange-400'),
          500: tone('orange-500'),
          600: tone('orange-600'),
          700: tone('orange-700'),
          800: '#6f3b28',
          900: '#4d2919',
        },
        red: {
          50: '#fdf0ee',
          100: '#f9e1dd',
          200: '#f2c0ba',
          300: tone('red-300'),
          400: tone('red-400'),
          500: tone('red-500'),
          600: tone('red-600'),
          700: tone('red-700'),
          800: '#7a322b',
          900: '#54221d',
        },
        /* Informational blue (rare metadata, link hover) — muted, warm-adjacent. */
        sky: {
          50: '#eef3f5',
          100: '#dbe6eb',
          200: '#c2d3db',
          300: tone('sky-300'),
          400: tone('sky-400'),
          500: tone('sky-500'),
          600: tone('sky-600'),
          700: tone('sky-700'),
          800: '#3b4d59',
          900: '#2b3942',
        },
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

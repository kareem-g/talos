/**
 * Tailwind config — generated from `src/design/tokens.ts`, not hand-written.
 *
 * Every colour and radius below is read from the token module. That is the whole
 * point: a token is defined once, and both the class names (`text-ink-2`) and
 * the raw values components hand to icons (`palette.ink2`) come from the same
 * source. The previous version of this file duplicated the palette while the
 * components separately hardcoded 174 hex values, which is how the app ended up
 * with three different greys all meaning "muted".
 *
 * If you want a new colour, add it to `tokens.ts`. It appears here
 * automatically. Do not add it here.
 *
 * @type {import('tailwindcss').Config}
 */
const { palette, radius } = require('./src/design/tokens')

/** `palette.okSoft` → the `bg-ok-soft` / `border-ok-border` colour slots. */
const status = {
  ok: palette.ok,
  'ok-soft': palette.okSoft,
  'ok-border': palette.okBorder,
  wait: palette.wait,
  'wait-soft': palette.waitSoft,
  'wait-border': palette.waitBorder,
  danger: palette.danger,
  'danger-soft': palette.dangerSoft,
  'danger-border': palette.dangerBorder,
  info: palette.info,
  'info-soft': palette.infoSoft,
  'info-border': palette.infoBorder,
}

module.exports = {
  // The app is dark-only by design: the tokens are a dark ramp, and a light
  // theme would need a second full set rather than a flip.
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Surfaces — a single lightness ramp, see tokens.ts. */
        canvas: palette.canvas,
        chrome: palette.chrome,
        surface: palette.surface,
        raised: palette.raised,
        field: palette.field,
        pressed: palette.pressed,
        selected: palette.selected,

        /* Ink — three steps only. */
        ink: palette.ink,
        'ink-2': palette.ink2,
        'ink-3': palette.ink3,

        /* The single accent. */
        accent: palette.accent,
        'accent-hover': palette.accentHover,
        'accent-ink': palette.accentInk,
        'accent-soft': palette.accentSoft,
        'accent-border': palette.accentBorder,

        /* Status — the only colours that carry meaning. */
        ...status,

        /* Hairlines: alpha white, never grey. */
        line: palette.line,
        'line-strong': palette.lineStrong,
        scrim: palette.scrim,

        /* Code wells. */
        code: palette.code,
        'code-ink': palette.codeInk,
      },
      borderRadius: {
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        pill: `${radius.pill}px`,
      },
      fontFamily: {
        // System faces. Shipping a custom face would cost ~200KB of binary for
        // a tool whose text is mostly ids and paths, where a system mono is
        // already familiar and renders at the right optical size.
        mono: ['Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

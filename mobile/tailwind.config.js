/**
 * Tailwind config — generated from `src/design/tokens`, not hand-written.
 *
 * Every colour and radius below is read from the token module. That is the whole
 * point: a token is defined once, and both the class names (`text-ink-2`) and
 * the raw values components hand to icons (`palette.ink2`) come from the same
 * source. A previous version of this file duplicated the palette while the
 * components separately hardcoded 174 hex values, which is how the app ended up
 * with three different greys all meaning "muted".
 *
 * If you want a new colour, add it to `tokens.ts`. It appears here
 * automatically. Do not add it here.
 *
 * @type {import('tailwindcss').Config}
 */
const { palette, radius, diffAddSoft, diffDelSoft } = require('./src/design/tokens')

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
  // The app is dark-only by design: "signal deck" is a near-black ramp where
  // elevation is a lift toward the lamp, and a light theme would need a second
  // full set rather than a flip.
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Surfaces — one monotonic dark ramp: code < well < canvas < chrome <
           surface < raised, with `field` (typing wells) recessed below the
           card and `hover` ABOVE `raised` because a dark deck brightens under
           a finger. See the header of tokens.ts. */
        well: palette.well,
        canvas: palette.canvas,
        chrome: palette.chrome,
        surface: palette.surface,
        raised: palette.raised,
        hover: palette.hover,
        selected: palette.selected,
        field: palette.field,

        /* Ink — four steps, one job each. */
        ink: palette.ink,
        'ink-2': palette.ink2,
        'ink-3': palette.ink3,
        'ink-4': palette.ink4,

        /* The single accent. */
        accent: palette.accent,
        'accent-hover': palette.accentHover,
        'accent-pressed': palette.accentPressed,
        'accent-ink': palette.accentInk,
        'accent-soft': palette.accentSoft,
        'accent-soft-strong': palette.accentSoftStrong,
        'accent-border': palette.accentBorder,
        'badge-ink': palette.badgeInk,
        viewfinder: palette.viewfinder,

        /* Status — the only colours that carry meaning. */
        ...status,

        /* Hairlines: alpha ink, never grey. */
        line: palette.line,
        'line-strong': palette.lineStrong,
        scrim: palette.scrim,
        'scrim-soft': palette.scrimSoft,

        /* Machine plates — the near-black wells, and the lighter twins of the
           status hues for text ON the plate (diffs, exit codes, terminal
           output). The plate has its own status ink because the deck-tuned
           hues read heavier at 11px inside it. */
        code: palette.code,
        'code-ink': palette.codeInk,
        'code-dim': palette.codeDim,
        'code-ok': palette.codeOk,
        'code-wait': palette.codeWait,
        'code-danger': palette.codeDanger,
        'code-info': palette.codeInfo,
        'diff-add-soft': diffAddSoft,
        'diff-del-soft': diffDelSoft,
      },
      borderRadius: {
        xs: `${radius.xs}px`,
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
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

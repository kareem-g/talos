/**
 * Tailwind config — a view over `src/design/tokens`, which carries the
 * approved mockups' vocabulary (`design/shared.css` + per-screen styles).
 *
 * Every key below must exist on the token object it reads. A missing one
 * produces an empty rule, and an empty rule is invisible: the view keeps its
 * transparent background and the text keeps its inherited colour. That is a
 * silent failure — it looks like a styling opinion rather than a bug — so the
 * mapping is kept explicit and one-to-one, and `scripts/check-tokens.mjs`
 * guards it.
 */
const { PALETTE, TEXT_SIZES, LINE_HEIGHT, SPACING, radius, size, space } = require('./src/design/tokens')

module.exports = {
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: PALETTE,
      borderRadius: {
        chip: radius.chip,
        control: radius.control,
        row: radius.row,
        field: radius.field,
        card: radius.card,
        bubble: radius.bubble,
        sheet: radius.sheet,
        pill: radius.pill,
        // Legacy aliases the screens still speak.
        sm: radius.chip,
        md: radius.control,
        lg: radius.card,
        xl: radius.card,
        '2xl': radius.card,
      },
      fontSize: TEXT_SIZES,
      lineHeight: LINE_HEIGHT,
      // Replaces Tailwind's rem scale outright: see SPACING in the theme for
      // why 16 has to mean 16 here.
      spacing: {
        ...SPACING,
        gutter: space.gutter,
        'gutter-x2': space.gutter * 2,
        section: space.xxl,
      },
      height: {
        'btn-sm': size.btnSm,
        'btn-md': size.btnMd,
        'btn-lg': size.btnLg,
        ico: size.ico,
        pill: size.pill,
        chip: size.chip,
        search: size.search,
        field: size.field,
      },
      fontFamily: {
        // The sans ramp is the platform system face — no family to name.
        mono: ['JetBrainsMono-Regular'],
        'mono-semibold': ['JetBrainsMono-SemiBold'],
      },
    },
  },
  plugins: [],
}
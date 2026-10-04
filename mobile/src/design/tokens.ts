/**
 * theme — the phone's one design vocabulary.
 *
 * Every value here is transcribed from the approved HTML reference
 * (`design/shared.css` plus each screen's `<style>` block). Nothing in this
 * file is invented: the names, the numbers and the ramp are the mockups'.
 *
 * `tailwind.config.js` reads this file, so a token defined here becomes a
 * class name there (`color.card` → `bg-card`, `font.body` → `text-body`). The
 * two must stay in step: a class whose token is missing renders as *nothing at
 * all*, which is how the app previously lost every card background and half
 * its ink ramp.
 */

/* ── Color ────────────────────────────────────────────────────────────────── */

export const color = {
  // Surfaces — the mockup's `.screen` / `.card` / `.card-2` / `.fill` layers.
  bg: '#000000',
  card: '#1c1c1e',
  raised: '#2c2c2e',
  field: 'rgba(255, 255, 255, 0.08)',
  fill: 'rgba(255, 255, 255, 0.14)',
  wash: 'rgba(255, 255, 255, 0.04)',
  option: 'rgba(255, 255, 255, 0.05)',
  chrome: 'rgba(22, 22, 24, 0.72)',
  pane: 'rgba(22, 22, 24, 0.9)',
  plate: '#101012',
  scrim: 'rgba(0, 0, 0, 0.6)',
  finder: '#050505',

  // Ink — the iOS label ramp.
  ink: '#ffffff',
  ink2: 'rgba(235, 235, 245, 0.6)',
  ink3: 'rgba(235, 235, 245, 0.32)',
  ink4: 'rgba(235, 235, 245, 0.18)',

  // Hairlines.
  line: 'rgba(255, 255, 255, 0.11)',
  lineSoft: 'rgba(255, 255, 255, 0.07)',
  edge: 'rgba(255, 255, 255, 0.22)',

  // Accent — one blue.
  accent: '#0a84ff',
  accentPress: '#3a9bff',
  accentInk: '#ffffff',
  accentWash: 'rgba(10, 132, 255, 0.16)',
  accentEdge: 'rgba(10, 132, 255, 0.4)',

  // Traffic lights.
  green: '#30d158',
  greenWash: 'rgba(48, 209, 88, 0.15)',
  greenEdge: 'rgba(48, 209, 88, 0.35)',
  orange: '#ff9f0a',
  orangeWash: 'rgba(255, 159, 10, 0.15)',
  orangeEdge: 'rgba(255, 159, 10, 0.35)',
  red: '#ff453a',
  redWash: 'rgba(255, 69, 58, 0.14)',
  redEdge: 'rgba(255, 69, 58, 0.35)',
  redCard: 'rgba(255, 69, 58, 0.07)',
  sky: '#64d2ff',
  skyWash: 'rgba(100, 210, 255, 0.14)',
  skyEdge: 'rgba(100, 210, 255, 0.35)',
  // Skills. The desktop marks a `$skill` purple; the palette had every other
  // trigger colour but this one.
  purple: '#bf5af2',
  purpleWash: 'rgba(191, 90, 242, 0.16)',
  purpleEdge: 'rgba(191, 90, 242, 0.35)',

  // Agent identity hues.
  agent: ['#bf5af2', '#40cbe0', '#30d158', '#64d2ff', '#ff9f0a', '#ff375f'] as string[],
} as const

/* ── Radius — `.card` 16, controls 12, `.sheet` 22 ───────────────────────── */

export const radius = {
  chip: 6,
  control: 12,
  row: 14,
  field: 14,
  card: 16,
  bubble: 20,
  bubbleTail: 6,
  sheet: 22,
  pill: 999,
} as const

/* ── Space — the mockup's gutters on a 2-point grid ──────────────────────── */

export const space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  ten: 10,
  lg: 12,
  xl: 14,
  gutter: 16,
  lg2: 18,
  xl2: 20,
  xxl: 26,
  huge: 40,
} as const

/* ── Spacing, in px ───────────────────────────────────────────────────────── */
/**
 * Tailwind's spacing scale is expressed in `rem`, and NativeWind resolves `rem`
 * to **14**, not 16 — so every scale utility (`px-4`, `gap-2`, `h-9`, `mt-3`)
 * lands 12.5% tighter than the mockup it came from. A 16pt gutter drew at 14,
 * a 36pt tap target at 31.5. That is small enough to read as "the spacing is
 * off" and too small to spot in code.
 *
 * Publishing the scale as plain pixels makes `p-4` mean 16 again, so the
 * numbers in the Tailwind classes are the numbers in the design.
 */
export const SPACING = {
  px: 1,
  0: 0,
  '0.5': 2,
  1: 4,
  '1.5': 6,
  2: 8,
  '2.5': 10,
  3: 12,
  '3.5': 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
  28: 112,
  32: 128,
  36: 144,
  40: 160,
  44: 176,
  48: 192,
  52: 208,
  56: 224,
  60: 240,
  64: 256,
  72: 288,
  80: 320,
  96: 384,
} as const

/* ── Type ramp — `.large-title` / `.t-*` / `.section-head` ────────────────── */

export const font = {
  largeTitle: 33,
  sheetTitle: 16.5,
  pageTitle: 17,
  section: 13, // .section-head .s-title
  sectionCount: 12, // .section-head .s-count
  body: 15.5, // .t-body
  rowTitle: 15.5, // .row .r-title
  bubble: 15.5,
  sub: 13, // .t-sub
  meta: 12, // .t-meta
  cap: 11.5, // .t-cap
  pill: 11.5,
  monoBody: 12,
  monoSmall: 11.5,
  monoCap: 10.5,
  btnSm: 12.5,
  btnMd: 13.5,
  btnLg: 15.5,
} as const

/* ── Controls — `.btn`, `.icobtn`, `.pill`, `.chip`, `.search` ───────────── */

export const size = {
  btnSm: 30,
  btnMd: 36,
  btnLg: 50,
  btnPadSm: 13,
  btnPadMd: 16,
  btnPadLg: 22,
  ico: 36,
  icoSm: 30,
  pill: 22,
  pillMini: 19,
  chip: 30,
  search: 38,
  field: 44,
  fieldMulti: 88,
  seg: 32,
  send: 34,
  row: 52,
  rowTall: 56,
} as const

/* ── Class vocabulary ─────────────────────────────────────────────────────── */

/**
 * The `text-*` namespace is shared by two different properties: font size and
 * colour. NativeWind tells them apart by looking the value up in the theme,
 * but `cn()` merges through tailwind-merge, which does not read the Tailwind
 * config — it guesses. A guess that lands wrong silently deletes a class:
 * `cn('text-ink', 'text-pill')` reads as two colours, so the white is dropped
 * and the label renders in the platform default (black) on a dark pill.
 *
 * Publishing the two lists from the theme lets the config and the merge
 * function read the same vocabulary, so the guesswork is gone.
 */
export const TEXT_SIZES = {
  'large-title': font.largeTitle,
  'page-title': font.pageTitle,
  'sheet-title': font.sheetTitle,
  section: font.section,
  'section-count': font.sectionCount,
  body: font.body,
  'row-title': font.rowTitle,
  bubble: font.bubble,
  sub: font.sub,
  meta: font.meta,
  cap: font.cap,
  pill: font.pill,
  'mono-body': font.monoBody,
  'mono-small': font.monoSmall,
  'mono-cap': font.monoCap,
  'btn-sm': font.btnSm,
  'btn-md': font.btnMd,
  'btn-lg': font.btnLg,
} as const

/**
 * Line heights are separate on purpose. Tailwind's `fontSize` accepts a
 * `[size, { lineHeight }]` tuple, but NativeWind turns that into a line box
 * far taller than the text — glyphs then sit outside a fixed-height control
 * (a 22pt pill renders empty, a paragraph renders 170pt tall). A plain size
 * plus an explicit `leading-*` class behaves.
 */
export const LINE_HEIGHT = {
  'large-title': 37,
  'page-title': 22,
  'sheet-title': 21,
  section: 18,
  'section-count': 16,
  body: 23,
  'row-title': 21,
  bubble: 22,
  sub: 19,
  meta: 17,
  cap: 16,
  pill: 15,
  'mono-body': 18,
  'mono-small': 17,
  'mono-cap': 15,
  'btn-sm': 16,
  'btn-md': 18,
  'btn-lg': 20,
} as const

/**
 * Colour class names → values, including the aliases the screens speak
 * (`surface`, `canvas`, `accent-tint`, …). One table, read by the Tailwind
 * config and by the class merger.
 */
export const PALETTE = {
  canvas: color.bg,
  bg: color.bg,
  card: color.card,
  surface: color.card,
  sidebar: color.card,
  inset: color.plate,
  well: color.plate,
  code: color.plate,
  plate: color.plate,
  raised: color.raised,
  field: color.field,
  fill: color.fill,
  wash: color.wash,
  option: color.option,
  hover: color.wash,
  'hover-2': color.field,
  chrome: color.chrome,
  pane: color.pane,
  scrim: color.scrim,

  ink: color.ink,
  'ink-2': color.ink2,
  'ink-3': color.ink3,
  'ink-4': color.ink4,

  line: color.line,
  'line-soft': color.lineSoft,
  'line-strong': color.edge,
  edge: color.edge,

  accent: color.accent,
  'accent-hover': color.accentPress,
  'accent-pressed': color.accentPress,
  'accent-press': color.accentPress,
  'accent-ink': color.accentInk,
  'accent-tint': color.accentWash,
  'accent-wash': color.accentWash,
  'accent-border': color.accentEdge,
  'accent-2': color.accentPress,

  green: color.green,
  'green-tint': color.greenWash,
  'green-wash': color.greenWash,
  'green-border': color.greenEdge,
  red: color.red,
  'red-tint': color.redWash,
  'red-wash': color.redWash,
  'red-border': color.redEdge,
  'red-card': color.redCard,
  orange: color.orange,
  'orange-tint': color.orangeWash,
  'orange-wash': color.orangeWash,
  'orange-border': color.orangeEdge,
  info: color.sky,
  'info-tint': color.skyWash,
  'info-border': color.skyEdge,
  sky: color.sky,
  'sky-tint': color.skyWash,
  'sky-border': color.skyEdge,
  purple: color.purple,
  'purple-tint': color.purpleWash,
  'purple-border': color.purpleEdge,

  'term-fg': color.ink,
  'term-dim': color.ink3,
  'term-ok': color.green,
} as const

/* ── Motion — the sheet spring ────────────────────────────────────────────── */

export const motion = {
  overlay: { damping: 30, stiffness: 300, mass: 0.9, overshootClamping: false },
} as const

/* ── Agent identity — one hue per engine id ───────────────────────────────── */

export function agentHue(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return color.agent[hash % color.agent.length]
}

/** Aliases for callers that speak the older `palette` / `type` names. */
export const palette = color
export const type = {
  hero: font.largeTitle,
  headline: 20,
  title: font.pageTitle,
  body: font.body,
  secondary: 14,
  caption: font.sub,
  mono: font.monoBody,
} as const

/* ── Shadows — the platform reads these as raw strings ────────────────────── */

export const shadowThumb = {
  shadowColor: '#000000',
  shadowOpacity: 0.4,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const

export const shadowLayer = {
  shadowColor: '#000000',
  shadowOpacity: 0.62,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 16 },
  elevation: 24,
} as const
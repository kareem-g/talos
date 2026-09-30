/**
 * The design tokens — QAI's single source of truth for colour, type, spacing,
 * radius and motion on mobile.
 *
 * THE PALETTE — "warm studio", ported 1:1 from the desktop
 * --------------------------------------------------------
 * The mobile app wears the desktop's own theme (dashboard/src/index.css):
 * deep charcoal surfaces with warm brown undertones, parchment ink, a soft
 * blue accent reserved for emphasis, and warm muted status hues. Porting the
 * values verbatim is the point: a session opened on the phone and the browser
 * is the same product in the same light, not two designs sharing a backend.
 *
 * The rules that make it work:
 *
 *   1. **The surfaces are a monotonic warm ramp, and elevation is a lift.**
 *
 *        code < well  <  canvas  <  chrome  <  field  <  surface  <  raised
 *
 *      `code` is the terminal plate. `well` is a recess. `canvas` is the page.
 *      `chrome` is the sidebar/navigation tone. `field` is a typing slot.
 *      `surface` is a card, lighter than the page. `raised` is a filled
 *      control or card-on-card. `hover` brightens under a finger.
 *
 *   2. **Ink is a three-step parchment ramp with a fixed job per step.**
 *      `ink` is body copy (≈15:1 on canvas), `ink2` is secondary prose and
 *      labels (≈7:1), `ink3` is metadata and timestamps (≈4.5:1), `ink4` is
 *      disabled-only.
 *
 *   3. **Exactly ONE accent.** Soft blue — reserved for the primary action,
 *      the active destination, selection, links, live marks, progress, the
 *      brand. Never decoration.
 *
 *   4. **Status is warm and muted, and never the only channel.** green =
 *      alive, orange/copper = needs a human, red = failed, sky = held/info.
 *      Every status surface ships a word beside its dot.
 *
 *   5. **The terminal plate gets its own ink.** `codeInk`/`codeDim` and the
 *      `code*` status twins are tuned for `#161618`, the desktop's editor
 *      dark, so diffs and tool output read the same on both surfaces.
 */

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export const palette = {
  /** The machine plate — terminal output, diffs, tool results. */
  code: '#161618',
  /** A hole in the page — recesses, quoted blocks, inline wells. */
  well: '#19191C',
  /** The page itself. Warm charcoal. Everything else is a lift off this. */
  canvas: '#131315',
  /** Navigation chrome: top bars, drawer, tab bar. The desktop's sidebar tone. */
  chrome: '#17171B',
  /** A resting card, list row, or sheet. */
  surface: '#26262B',
  /** A card on a card: nested grouping, filled buttons, selected rows. */
  raised: '#2C2C33',
  /** Pressed / hovered state — the deck brightens under a finger. */
  hover: '#34343B',

  /** A selected row: the surface washed toward the accent. */
  selected: '#232A3D',
  /** The tappable body of an input sitting on `surface` — a typing slot. */
  field: '#202024',

  /** Scrim behind a sheet, dialog or drawer. The desktop's black/65. */
  scrim: 'rgba(0,0,0,0.65)',
  /** A lighter scrim for stacked overlays (a picker over a sheet). */
  scrimSoft: 'rgba(0,0,0,0.45)',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Warm parchment on charcoal. Ratios measured against `canvas` (#131315). */
  ink: '#F2F2F3',
  ink2: '#B0B0B6',
  ink3: '#7E7E86',
  /** Disabled / placeholder only. Never for information. */
  ink4: '#5B5B63',

  /* ── Accent ──────────────────────────────────────────────────────────────
   * Soft blue. The desktop's --accent family, verbatim. */
  accent: '#5B8DEF',
  accentHover: '#6F9BF2',
  accentPressed: '#4A76D1',
  /**
   * Text drawn ON `accent`. The desktop's --accent-ink: a deep blue-black, so
   * a label on the fill reads as part of it rather than punched through it.
   */
  accentInk: '#0D1322',
  /** A wash of accent — selected rows, quiet emphasis. */
  accentSoft: 'rgba(91,141,239,0.12)',
  accentSoftStrong: 'rgba(91,141,239,0.20)',
  accentBorder: 'rgba(91,141,239,0.35)',

  /* ── Status ──────────────────────────────────────────────────────────────
   * The only colours that carry meaning. Warm and muted, per the desktop:
   * success = green, attention = copper, failure = terracotta red, held =
   * sky. Each pairs with a distinct word, so colour is never the sole
   * channel. */
  ok: '#57AB5A',
  okSoft: 'rgba(87,171,90,0.12)',
  okBorder: 'rgba(87,171,90,0.30)',

  /** "Needs you" — a human is blocking the run. The app's most important state. */
  wait: '#DB6D28',
  waitSoft: 'rgba(219,109,40,0.12)',
  waitBorder: 'rgba(219,109,40,0.30)',

  danger: '#F85149',
  dangerSoft: 'rgba(248,81,73,0.12)',
  dangerBorder: 'rgba(248,81,73,0.30)',

  /** Informational — queued, paused, or otherwise held but not broken. */
  info: '#6396CC',
  infoSoft: 'rgba(99,150,204,0.12)',
  infoBorder: 'rgba(99,150,204,0.30)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Warm brown rules, exactly the desktop's --line family. */
  line: '#34343A',
  lineStrong: '#42424A',

  /* ── Machine plate ink ────────────────────────────────────────────────────
   * Text colours for use ON `palette.code` only. */
  codeInk: '#E6E6E9',
  /** The gutter / line-number column inside a diff. */
  codeDim: '#7E7E86',

  /* ── Machine status ink ───────────────────────────────────────────────────
   * The plate twins of the status hues, from the desktop's ramps. */
  codeOk: '#6FBC7F',
  codeWait: '#E0884E',
  codeDanger: '#F4736C',
  codeInfo: '#7FA8D8',

  /** The shimmer band that runs across a skeleton while it loads. */
  shimmer: 'rgba(255,255,255,0.06)',

  /**
   * The camera viewfinder behind the pairing scanner.
   *
   * Genuinely pure black, and deliberately not a step on the surface ramp: a
   * viewfinder is not part of the app's visual system, and putting it on
   * `canvas` would tint the live image the user is trying to read a QR code
   * out of. It is the one place a black outside the ramp is correct.
   */
  viewfinder: '#000000',

  /**
   * Ink for a badge drawn on a *saturated* fill (danger count). Paper white,
   * very slightly greyed so a count does not buzz against a red fill the way
   * pure white does.
   */
  badgeInk: '#F6F6F7',
} as const

/* ── Diff ──────────────────────────────────────────────────────────────────────
 * Diff rows render INSIDE a machine plate, so their tints are tuned for the
 * terminal dark: a green or red wash at low alpha over #161618, from the
 * desktop's --emerald-300/--red-300 ramp. */

export const diffAddSoft = 'rgba(111,188,127,0.13)'
export const diffDelSoft = 'rgba(244,115,108,0.12)'

/* ── Elevation ────────────────────────────────────────────────────────────────
 * The app has exactly one shadow, and overlays get it — the desktop's
 * `shadow-overlay` translated to RN. Content cards elevate with a lighter
 * surface plus a hairline, never a cast shadow; only sheets, dialogs, toasts
 * and the attention pill genuinely float, so only they cast.
 *
 * These are `ViewStyle` shadows, so `shadowColor` has to be a raw colour; a
 * token name there is a string the platform will try to parse as a colour and
 * render nothing. They are the only place a shadow colour is written by hand,
 * and they live here so `check-colors.mjs` can allow the one file. */

export const shadowOverlay = {
  shadowColor: '#000000',
  shadowOpacity: 0.6,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 16 },
  elevation: 24,
} as const

/** A lighter version for things that float over an already-raised surface. */
export const shadowFloating = {
  shadowColor: '#000000',
  shadowOpacity: 0.5,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 10,
} as const

export type PaletteKey = keyof typeof palette

/* ── Tone mapping ─────────────────────────────────────────────────────────────
 * The six semantic states the whole app colours by. Every status component
 * takes a `Tone` and looks up here, so a status colour is defined once. */

export type Tone = 'ok' | 'wait' | 'danger' | 'info' | 'accent' | 'muted'

/** Text / icon colour for a tone — the deck tuning, for use on light-on-dark surfaces. */
export const toneColor: Record<Tone, string> = {
  ok: palette.ok,
  wait: palette.wait,
  danger: palette.danger,
  info: palette.info,
  accent: palette.accent,
  muted: palette.ink3,
}

/** The machine-plate twin: text / icon colour for a tone ON `palette.code`. */
export const toneColorOnCode: Record<Tone, string> = {
  ok: palette.codeOk,
  wait: palette.codeWait,
  danger: palette.codeDanger,
  info: palette.codeInfo,
  accent: palette.codeInfo,
  muted: palette.codeDim,
}

/** Translucent fill for a tone — selected rows, badges, soft containers. */
export const toneSoft: Record<Tone, string> = {
  ok: palette.okSoft,
  wait: palette.waitSoft,
  danger: palette.dangerSoft,
  info: palette.infoSoft,
  accent: palette.accentSoft,
  muted: 'rgba(176,176,182,0.08)',
}

/** Border colour for a tone — where a soft fill alone is too quiet. */
export const toneBorder: Record<Tone, string> = {
  ok: palette.okBorder,
  wait: palette.waitBorder,
  danger: palette.dangerBorder,
  info: palette.infoBorder,
  accent: palette.accentBorder,
  muted: palette.lineStrong,
}

/**
 * Tailwind class names per tone.
 *
 * These exist because NativeWind resolves a class name at build time, so a
 * `style={{ color: toneColor[tone] }}` and a `className` cannot be
 * interchangeable — the tint/border classes have to be spelled out. Keeping the
 * map next to `toneColor` is what stops the two from drifting.
 */
export const toneClass = {
  text: {
    ok: 'text-ok',
    wait: 'text-wait',
    danger: 'text-danger',
    info: 'text-info',
    accent: 'text-accent',
    muted: 'text-ink-3',
  } as Record<Tone, string>,
  soft: {
    ok: 'bg-ok-soft',
    wait: 'bg-wait-soft',
    danger: 'bg-danger-soft',
    info: 'bg-info-soft',
    accent: 'bg-accent-soft',
    muted: 'bg-ink-3/10',
  } as Record<Tone, string>,
  border: {
    ok: 'border-ok-border',
    wait: 'border-wait-border',
    danger: 'border-danger-border',
    info: 'border-info-border',
    accent: 'border-accent-border',
    muted: 'border-line-strong',
  } as Record<Tone, string>,
  /** The machine-plate twins: text ON `palette.code`. */
  onCode: {
    ok: 'text-code-ok',
    wait: 'text-code-wait',
    danger: 'text-code-danger',
    info: 'text-code-info',
    accent: 'text-code-info',
    muted: 'text-code-dim',
  } as Record<Tone, string>,
} as const

/* ── Radii ───────────────────────────────────────────────────────────────────
 * The desktop's own geometry: `rounded-control` and `rounded-chip` are 999px
 * — buttons, rows and chips are FULL PILLS — `rounded-card` is 16px, sheets
 * top out at 16-20. Roundness is the desktop's touchability signal, so the
 * mobile app inherits it verbatim. */

export const radius = {
  /** Inline code, tiny tags, the desktop's `Chip`. */
  xs: 6,
  /** Small controls, the desktop's `rounded-lg`. */
  sm: 10,
  /** Inputs, the desktop's `rounded-xl`. */
  md: 12,
  /** Cards and panels — the desktop's `rounded-card`. */
  lg: 16,
  /** Sheets, dialogs — the desktop Layer's `rounded-t-2xl` and up. */
  xl: 20,
  /** Full pill — the desktop's `rounded-control`: buttons, rows, chips, FABs. */
  pill: 999,
} as const

/* ── Spacing ─────────────────────────────────────────────────────────────────
 * A 4pt scale. Tailwind's default scale is what components use via class
 * names; these exist for `style` props and for documenting the rhythm. The
 * page gutter is 16, the card gutter 16, the tight gap 8. */

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 30,
} as const

/* ── Type ────────────────────────────────────────────────────────────────────
 * The desktop's dense scale, nudged up half a step for arm's-length reading:
 * 13px section titles, 12.5px controls, 11.5px secondary, uppercase
 * micro-labels with wide tracking. A control surface reads like an instrument,
 * not like an article.
 *
 * `size`/`height` are RN fontSize/lineHeight; `weight` is the RN fontWeight;
 * `track` is letterSpacing in px. */

export const type = {
  /** Screen hero title. 24/30, -0.5. */
  display: { size: 24, height: 30, weight: '700' as const, track: -0.5 },
  /** Section title. 17/22, -0.3. */
  title: { size: 17, height: 22, weight: '700' as const, track: -0.3 },
  /** App-bar title, card title. The desktop's 13px medium header. */
  heading: { size: 14, height: 19, weight: '600' as const, track: -0.15 },
  /** Body / list row primary. 13.5/20. */
  body: { size: 13.5, height: 20, weight: '400' as const, track: 0 },
  /** List row primary, emphasised. 13/18, 500. */
  label: { size: 13, height: 18, weight: '500' as const, track: -0.1 },
  /** Secondary body, descriptions. 12/17. */
  caption: { size: 12, height: 17, weight: '400' as const, track: 0 },
  /** Metadata. 11/15. */
  small: { size: 11, height: 15, weight: '400' as const, track: 0 },
  /** Dense labels, tool rows, chips. 10.5/14, +0.1. */
  micro: { size: 10.5, height: 14, weight: '500' as const, track: 0.1 },
  /** Monospace body — paths, diffs, code, ids. */
  mono: { size: 12, height: 17, weight: '400' as const, track: 0 },
  /** Dense monospace metadata — counters, durations, timestamps. */
  monoSmall: { size: 10.5, height: 14, weight: '500' as const, track: 0 },
  /** The uppercase section label. 10/13, +1.1. */
  eyebrow: { size: 10, height: 13, weight: '600' as const, track: 1.1 },
} as const

export type TypeRole = keyof typeof type

/* ── Motion ───────────────────────────────────────────────────────────────────
 * Two kinds of motion, with different jobs.
 *
 *  - `duration.*` is for *state changes* on elements that are already on
 *    screen: a selection, a highlight, a toast arriving. Linear-ish and short;
 *    a state change that takes 400ms reads as lag.
 *
 *  - `spring.*` is for *physical* motion: anything a finger is touching or that
 *    has mass. A sheet is a physical object, so it decelerates; nothing that
 *    decelerates should use a duration curve.
 *
 * Every one of these is consumed through `components/motion.tsx`, which owns
 * the `Animated.Value` lifecycle, so a screen cannot invent a timing.
 */

export const duration = {
  /** Press feedback. Must land inside ~90ms or the control feels broken. */
  instant: 90,
  /** State change: selection, highlight, cross-fade. */
  fast: 170,
  /** Enter/exit of an overlay. */
  normal: 260,
  /** Deliberate, large movement. */
  slow: 380,
  /** The streaming caret and other "the agent is typing" loops. */
  loop: 1100,
} as const

/** Spring configs for `Animated.spring`. */
export const spring = {
  /** Press feedback and other small, immediate returns. */
  snappy: { damping: 24, stiffness: 420, mass: 0.7, overshootClamping: false },
  /** Sheets, dialogs, drawers: arrives fast, never overshoots. */
  overlay: { damping: 30, stiffness: 300, mass: 0.9, overshootClamping: false },
  /** Dismissal: slightly heavier, so a sheet feels like it has mass. */
  dismiss: { damping: 34, stiffness: 240, mass: 1, overshootClamping: false },
  /** Layout: expanding sections, list reordering. */
  layout: { damping: 26, stiffness: 220, mass: 0.9, overshootClamping: false },
  /** A value that settles without any wobble — progress bars, tab underlines. */
  smooth: { damping: 40, stiffness: 200, mass: 1, overshootClamping: true },
} as const

/** Velocity (px/s) past which a dragged sheet is dismissed rather than snapped back. */
export const DISMISS_VELOCITY = 900

/* ── Agent identity ────────────────────────────────────────────────────────────
 * A separate, deliberately narrow hue set — the desktop's warm agent six,
 * verbatim. These identify WHICH agent is running, not what STATE it is in,
 * and none of them is the accent: identity must never read as actionable. */

export const agentHue = {
  claude: '#E07A5F',
  codex: '#A78BFA',
  opencode: '#4FAE7C',
  grok: '#8B8B93',
  gemini: '#6396CC',
  copilot: '#D96A8A',
  kimi: '#45B8C2',
} as const

/** The hashed cycle for agents the daemon reports that we do not know by name. */
const AGENT_CYCLE = ['#E07A5F', '#A78BFA', '#4FAE7C', '#6396CC', '#D96A8A', '#45B8C2']

/**
 * A stable hue for an agent id, so unknown agents still look owned.
 *
 * Never `Math.random`: a session's colour must not change between renders,
 * between screens, or between the phone and the browser.
 */
export function agentColor(id: string): string {
  const key = id.toLowerCase() as keyof typeof agentHue
  if (key in agentHue) return agentHue[key]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AGENT_CYCLE[hash % AGENT_CYCLE.length]
}

/** A translucent wash of the agent's hue, for avatars and soft chips. */
export function agentSoft(id: string): string {
  const hex = agentColor(id)
  return `${hex}26`
}

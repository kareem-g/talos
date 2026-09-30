/**
 * The design tokens — QAI's single source of truth for colour, type, spacing,
 * radius and motion on mobile.
 *
 * THE PALETTE — "signal deck"
 * ---------------------------
 * A dark command-centre language: a near-black cool deck, luminous ink, and
 * one signal-cyan accent. QAI is a control surface for coding agents running
 * on a desktop, so the page recedes and the *state* glows: what is running,
 * what is blocked, what just changed. Machine output — code, terminals, diffs,
 * logs — sits in plates darker than the page, so "the agent is speaking" and
 * "the app is speaking" are distinguishable without a single label.
 *
 * The rules that make it work:
 *
 *   1. **The surfaces are a monotonic dark ramp, and elevation is a lift.**
 *
 *        code < well  <  canvas  <  chrome  <  surface  <  raised
 *
 *      `code` is the machine plate — the darkest thing on screen, output not
 *      control. `well` is a recess. `canvas` is the page. `surface` is a card,
 *      lighter than the page. `raised` is a card on a card or a filled
 *      control. `field` is the body of an input — a well you type into.
 *      `hover` inverts the light-theme instinct: a press on a dark deck
 *      BRIGHTENS, so it sits above `raised`.
 *
 *   2. **Ink is a four-step cool-grey ramp with a fixed job per step.** `ink`
 *      is body copy, `ink2` is secondary prose and labels, `ink3` is metadata,
 *      `ink4` is disabled-only. `ink`/`ink2` clear WCAG AA on every surface;
 *      `ink3` clears the large-text bar on both the deck and the code plate.
 *
 *   3. **Exactly ONE accent.** Signal cyan — the live wire. Reserved for:
 *      the primary action, the active tab, selection, links, a live mark,
 *      progress, the brand. Never decoration — with four status hues in the
 *      app, every decorative colour competes with a meaning.
 *
 *   4. **Status is the only place colour carries meaning, and never the only
 *      channel.** Bright hues tuned for the dark deck: `ok` = alive, `wait` =
 *      needs a human, `danger` = failed, `info` = held, not broken. Dots vary
 *      size as well as hue and every status surface ships a word.
 *
 *   5. **The machine plate gets its own status ink.** Inside `code` wells the
 *      deck hues sit on a near-black field; the `codeOk`/`codeWait`/
 *      `codeDanger`/`codeInfo` twins are nudged lighter so diffs, terminal
 *      output and tool exit codes stay legible at 11px. Two contexts, two
 *      tunings, one meaning each.
 */

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export const palette = {
  /** The machine plate — code, diffs, terminal output. The darkest surface. */
  code: '#06080C',
  /** A hole in the page — recesses, quoted blocks, inline wells. */
  well: '#0B0E13',
  /** The page itself. Near-black, cool. Everything else is a lift off this. */
  canvas: '#0A0D12',
  /** Navigation chrome and headers: tab bar, app bar, sticky sub-bars. */
  chrome: '#0E1218',
  /** A resting card, list row, or sheet. */
  surface: '#12161D',
  /** A card on a card: nested grouping, filled buttons, selected rows. */
  raised: '#1A202A',
  /** Pressed / hovered state for a `raised` surface — the deck brightens. */
  hover: '#232B38',

  /** A selected row: the surface washed toward the signal accent. */
  selected: '#10262E',
  /** The tappable body of an input sitting on `surface` — a typing well. */
  field: '#0D1117',

  /** Scrim behind a sheet, dialog or drawer. */
  scrim: 'rgba(3,5,8,0.68)',
  /** A lighter scrim for stacked overlays (a picker over a sheet). */
  scrimSoft: 'rgba(3,5,8,0.46)',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Luminous type on the deck. Measured against `canvas` (#0A0D12). */
  ink: '#E9EDF4',
  ink2: '#A9B2C0',
  ink3: '#727D8D',
  /** Disabled / placeholder only. Never for information. */
  ink4: '#4A5361',

  /* ── Accent ──────────────────────────────────────────────────────────────
   * Signal cyan. Bright enough to read as "live" on the deck, dark enough to
   * carry near-black labels as a fill. */
  accent: '#22D3EE',
  accentHover: '#47DCF2',
  accentPressed: '#12B0CC',
  /**
   * Text drawn ON `accent`. Near-black with a faint cyan cast, so a label on
   * the signal reads as part of it rather than punched through it.
   */
  accentInk: '#03151A',
  /** A wash of accent — selected rows, quiet emphasis. */
  accentSoft: 'rgba(34,211,238,0.10)',
  accentSoftStrong: 'rgba(34,211,238,0.18)',
  accentBorder: 'rgba(34,211,238,0.38)',

  /* ── Status ──────────────────────────────────────────────────────────────
   * The only colours that carry meaning. Bright hues for the dark deck: each
   * clears 4.5:1 on `canvas` AND on its own soft fill. Each pairs with a
   * distinct dot size and a word, so colour is never the sole channel. */
  ok: '#34D399',
  okSoft: 'rgba(52,211,153,0.12)',
  okBorder: 'rgba(52,211,153,0.34)',

  /** "Needs you" — a human is blocking the run. The app's most important state. */
  wait: '#FBBF24',
  waitSoft: 'rgba(251,191,36,0.12)',
  waitBorder: 'rgba(251,191,36,0.34)',

  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.12)',
  dangerBorder: 'rgba(248,113,113,0.34)',

  /** Informational — queued, paused, or otherwise held but not broken. */
  info: '#60A5FA',
  infoSoft: 'rgba(96,165,250,0.12)',
  infoBorder: 'rgba(96,165,250,0.34)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Cool alpha ink on the deck, never a warm grey: a ruled line under a lamp. */
  line: 'rgba(148,163,184,0.14)',
  lineStrong: 'rgba(148,163,184,0.26)',

  /* ── Machine plate ink ────────────────────────────────────────────────────
   * Text colours for use ON `palette.code` only. */
  codeInk: '#DCE3EE',
  /** The gutter / line-number column inside a diff. */
  codeDim: '#79849A',

  /* ── Machine status ink ───────────────────────────────────────────────────
   * The plate twins of the status hues, nudged lighter for near-black. */
  codeOk: '#4ADE80',
  codeWait: '#FCD34D',
  codeDanger: '#FCA5A5',
  codeInfo: '#93C5FD',

  /** The shimmer band that runs across a skeleton while it loads. */
  shimmer: 'rgba(255,255,255,0.07)',

  /**
   * The camera viewfinder behind the pairing scanner.
   *
   * Genuinely pure black, and deliberately not a step on the surface ramp: a
   * viewfinder is not part of the app's visual system, and putting it on
   * `canvas` would tint the live image the user is trying to read a QR code out
   * of. It is the one place a black outside the ramp is correct.
   */
  viewfinder: '#000000',

  /**
   * Ink for a badge drawn on a *saturated* fill (danger count, accent pill).
   * Paper white, very slightly greyed so a count does not buzz against a
   * red or cyan fill the way pure white does.
   */
  badgeInk: '#F5F8FC',
} as const

/* ── Diff ──────────────────────────────────────────────────────────────────────
 * Diff rows render INSIDE a machine plate, so their tints are tuned for the
 * near-black field: a green or red wash at low alpha over #06080C. The diff's
 * *signalling* colours are `codeOk` / `codeDanger` — the machine twins of
 * `ok` / `danger` — never the deck hues, which read heavier on the plate. */

export const diffAddSoft = 'rgba(74,222,128,0.13)'
export const diffDelSoft = 'rgba(252,165,165,0.12)'

/* ── Elevation ────────────────────────────────────────────────────────────────
 * The app has exactly one shadow, and overlays get it. A shadow on a content
 * card is a lie about depth on a dark deck — elevation there is a lighter
 * surface plus a hairline, which is what `surface`/`raised` already encode.
 * Overlays — sheets, dialogs, toasts, the attention pill — genuinely are above
 * the content, so they are the only things that cast. On the deck the shadow
 * is pure depth-black, tight and dense rather than diffuse.
 *
 * These are `ViewStyle` shadows, so `shadowColor` has to be a raw colour; a
 * token name there is a string the platform will try to parse as a colour and
 * render nothing. They are the only place a shadow colour is written by hand,
 * and they live here so `check-colors.mjs` can allow the one file. */

export const shadowOverlay = {
  shadowColor: '#000205',
  shadowOpacity: 0.55,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 14 },
  elevation: 24,
} as const

/** A lighter version for things that float over an already-raised surface. */
export const shadowFloating = {
  shadowColor: '#000205',
  shadowOpacity: 0.45,
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
  muted: 'rgba(148,163,184,0.08)',
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
 * Six steps, each with a job. The signal-deck language is precise and cut:
 * instrument panels with a tight edge, pills only where a thumb lands. */

export const radius = {
  /** Inline code, tiny tags, 1px-ish affordances. */
  xs: 4,
  /** Badges, chips, small controls. */
  sm: 7,
  /** Buttons, inputs, list rows. The workhorse. */
  md: 10,
  /** Cards and panels. */
  lg: 13,
  /** Sheets, dialogs, the tab bar's floating elements. */
  xl: 18,
  /** Full pill — segmented controls, FABs, chips. */
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
 * A mobile scale tuned for the signal-deck language: dense but legible body,
 * tall line-heights on prose, tight tracking on large display text, uppercase
 * mono eyebrows for section labels. A command centre reads at arm's length,
 * often one-handed, often at a glance.
 *
 * `size`/`height` are RN fontSize/lineHeight; `weight` is the RN fontWeight;
 * `track` is letterSpacing in px. */

export const type = {
  /** Screen hero title (large-title headers). 28/34, -0.6. */
  display: { size: 28, height: 34, weight: '700' as const, track: -0.6 },
  /** Section title. 20/26, -0.4. */
  title: { size: 20, height: 26, weight: '700' as const, track: -0.4 },
  /** App-bar title, card title. 16/21, -0.2. */
  heading: { size: 16, height: 21, weight: '600' as const, track: -0.2 },
  /** Body / list row primary. 14.5/21, 0. */
  body: { size: 14.5, height: 21, weight: '400' as const, track: 0 },
  /** List row primary, emphasised. 14.5/21, 500. */
  label: { size: 14.5, height: 21, weight: '500' as const, track: -0.1 },
  /** Secondary body, descriptions. 13/18, 0. */
  caption: { size: 13, height: 18, weight: '400' as const, track: 0 },
  /** Metadata. 11.5/15, 0. */
  small: { size: 11.5, height: 15, weight: '400' as const, track: 0 },
  /** Dense labels, tool rows, chips. 11/14, +0.1. */
  micro: { size: 11, height: 14, weight: '500' as const, track: 0.1 },
  /** Monospace body — paths, diffs, code, ids. */
  mono: { size: 12.5, height: 18, weight: '400' as const, track: 0 },
  /** Dense monospace metadata — counters, durations, timestamps. */
  monoSmall: { size: 11, height: 15, weight: '500' as const, track: 0 },
  /** The uppercase mono eyebrow. 10/13, +1.2. */
  eyebrow: { size: 10, height: 13, weight: '600' as const, track: 1.2 },
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
 * A separate, deliberately narrow hue set. These identify WHICH agent is
 * running, not what STATE it is in — so they are allowed to be colourful where
 * the status palette is not, and they never appear on a status control. Lit on
 * the deck: mid-bright hues that hold their own against the dark ramp without
 * going neon, and none of them the accent — identity must never read as
 * "actionable". */

export const agentHue = {
  claude: '#F0884D',
  codex: '#A78BFA',
  opencode: '#2DD4BF',
  grok: '#94A3B8',
  gemini: '#60A5FA',
  copilot: '#F472B6',
  kimi: '#FBBF24',
} as const

/** The hashed cycle for agents the daemon reports that we do not know by name. */
const AGENT_CYCLE = ['#F0884D', '#A78BFA', '#2DD4BF', '#60A5FA', '#F472B6', '#FBBF24']

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

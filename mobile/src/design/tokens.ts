/**
 * The design tokens — QAI's single source of truth for colour, type, spacing,
 * radius and motion on mobile.
 *
 * THE PALETTE — the desktop's own "warm studio", 1:1
 * ---------------------------------------------------
 * The mobile app wears the desktop's theme verbatim (dashboard/src/index.css):
 * warm charcoal surfaces with brown undertones, parchment ink, the desktop's
 * soft blue accent, and hairline rules. Porting the values verbatim is the
 * point — a session opened on the phone and in the browser is the same product
 * in the same light, not two designs sharing a backend.
 *
 * The rules that make it work:
 *
 *   1. **Elevation is a lift, not a shadow.**
 *
 *        canvas < code < chrome < well < field < surface < raised < hover
 *
 *      `canvas` is the page; `code` is the machine plate; `well` is a recess;
 *      `chrome` is navigation; `field` is a typing slot; `surface` is a card;
 *      `raised` is a filled control or card-on-card; `hover` brightens under a
 *      finger. Only overlays cast (`shadowOverlay`/`shadowFloating`).
 *
 *   2. **Ink is a three-step parchment ramp with a fixed job per step.**
 *      `ink` is body copy, `ink2` is secondary prose and labels, `ink3` is
 *      metadata and timestamps, `ink4` is disabled-only.
 *
 *   3. **Exactly ONE accent — soft blue.** Primary action, the active
 *      destination, selection, links, live marks, progress, the brand. Never
 *      decoration.
 *
 *   4. **No green, no yellow, no orange in the chrome.** This is the rule that
 *      shapes everything else. A state is carried by **inversion and words**,
 *      not by spending a hue on it:
 *
 *        - a human is required (`wait`)  → PAPER INK: a white rail, a white
 *          pill, a lifted card. The only inverted surface in the app.
 *        - the machine is working (`accent`) → the accent blue.
 *        - failure (`danger`) → the desktop's red.
 *        - held / queued (`info`) → a desaturated sky, never a second accent.
 *        - finished (`muted`) → grey. Completed work recedes.
 *
 *      The single deliberate exception is the diff plate: additions stay
 *      conventionally green because a unified diff without it is materially
 *      harder to review. That is content on a machine plate, not chrome.
 *
 *   5. **The machine plate gets its own ink.** `codeInk`/`codeDim` and the
 *      `code*` status twins are tuned for `#161618`, the desktop's editor dark,
 *      so diffs and tool output read the same on both surfaces.
 *
 *   6. **Geometry is the instrument's.** Rectilinear and hairline-framed —
 *      4pt tags, 8pt controls, 10pt cards, 18pt sheet tops — with `pill`
 *      reserved for genuinely pill-shaped things (a switch, a status chip's
 *      capsule, a progress thumb).
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
  raised: '#2E2E34',
  /** Pressed / hovered state — the deck brightens under a finger. */
  hover: '#39393F',

  /** A selected row: the surface washed toward the accent. */
  selected: '#1D2433',
  /** The tappable body of an input sitting on `surface` — a typing slot. */
  field: '#202024',

  /** Scrim behind a sheet, dialog or drawer. The desktop's black/65. */
  scrim: 'rgba(0,0,0,0.65)',
  /** A lighter scrim for stacked overlays (a picker over a sheet). */
  scrimSoft: 'rgba(0,0,0,0.45)',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Warm parchment on charcoal. */
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
  accentBorder: 'rgba(91,141,239,0.34)',

  /* ── State ───────────────────────────────────────────────────────────────
   * Four outcomes, none of them a new hue in the chrome. See rule 4. */

  /**
   * "Needs you" — a human is blocking the run. Deliberately NOT a colour:
   * paper ink, so the treatment is inversion (white rail, white pill, lifted
   * card) and it can never be confused with a decorative tint. `waitSoft` and
   * `waitBorder` are the accent wash the attention card sits on.
   */
  wait: '#F2F2F3',
  waitSoft: 'rgba(91,141,239,0.12)',
  waitBorder: 'rgba(91,141,239,0.42)',

  /** Completed / verified / connected. The accent itself, so success is calm. */
  ok: '#5B8DEF',
  okSoft: 'rgba(91,141,239,0.12)',
  okBorder: 'rgba(91,141,239,0.30)',

  danger: '#F85149',
  dangerSoft: 'rgba(248,81,73,0.13)',
  dangerBorder: 'rgba(248,81,73,0.34)',

  /** Informational — queued, paused, or otherwise held but not broken. */
  info: '#6396CC',
  infoSoft: 'rgba(99,150,204,0.13)',
  infoBorder: 'rgba(99,150,204,0.32)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Warm rules, the desktop's --line family. */
  line: '#34343A',
  lineStrong: '#42424A',

  /* ── Machine plate ink ────────────────────────────────────────────────────
   * Text colours for use ON `palette.code` only. */
  codeInk: '#E6E6E9',
  /** The gutter / line-number column inside a diff. */
  codeDim: '#7E7E86',

  /* ── Machine status ink ───────────────────────────────────────────────────
   * The plate twins, from the desktop's ramps. `codeOk` is the one green in
   * the app and it only ever draws a diff addition. */
  codeOk: '#6FBC7F',
  codeWait: '#8FA8C8',
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
 * terminal dark. This is the app's one sanctioned green: an addition has to be
 * green or the diff stops being a diff. */

export const diffAddSoft = 'rgba(111,220,158,0.13)'
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
 * takes a `Tone` and looks up here, so a status colour is defined once.
 *
 * `wait` resolving to paper ink is the load-bearing part of rule 4: a component
 * that draws `toneColor.wait` on a dark surface gets white, and a component
 * that draws it INSIDE an inverted surface inverts it again (see
 * `StatusPill`/`Badge` in ui.tsx). */

export type Tone = 'ok' | 'wait' | 'danger' | 'info' | 'accent' | 'muted'

/** Text / icon colour for a tone — for use on dark surfaces. */
export const toneColor: Record<Tone, string> = {
  ok: palette.ok,
  wait: palette.ink,
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
 * The instrument's geometry: rectilinear and hairline-framed. The old language
 * was full pills everywhere; here `pill` is reserved for the few shapes that
 * are genuinely capsules (a switch, a status chip, a progress thumb, the FAB). */

export const radius = {
  /** Inline code, tiny tags, status chips. */
  xs: 4,
  /** Small controls, filter chips, a segmented item. */
  sm: 6,
  /** Inputs, icon buttons, wells. */
  md: 8,
  /** Cards and panels. */
  lg: 10,
  /** Sheets and dialogs (top corners). */
  xl: 18,
  /** A real capsule — switch, brand tile, FAB. */
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
 * A dense instrument scale: a 27px screen hero, 19px section titles, 13.5px
 * body, 10px uppercase micro-labels with wide tracking.
 *
 * `size`/`height` are RN fontSize/lineHeight; `weight` is the RN fontWeight;
 * `track` is letterSpacing in px. */

export const type = {
  /** Screen hero title. 27/33, -0.8. */
  display: { size: 27, height: 33, weight: '700' as const, track: -0.8 },
  /** Section title. 19/24, -0.45. */
  title: { size: 19, height: 24, weight: '700' as const, track: -0.45 },
  /** App-bar title, card title. 15/20, -0.25. */
  heading: { size: 15, height: 20, weight: '600' as const, track: -0.25 },
  /** Body / list row primary. 13.5/20. */
  body: { size: 13.5, height: 20, weight: '400' as const, track: 0 },
  /** List row primary, emphasised. 13/18, 500. */
  label: { size: 13, height: 18, weight: '500' as const, track: -0.1 },
  /** Secondary body, descriptions. 12/17. */
  caption: { size: 12, height: 17, weight: '400' as const, track: 0 },
  /** Metadata. 11/15. */
  small: { size: 11, height: 15, weight: '400' as const, track: 0 },
  /** Dense labels, tool rows, chips. 10/14, 600, +0.6. */
  micro: { size: 10, height: 14, weight: '600' as const, track: 0.6 },
  /** Monospace body — paths, diffs, code, ids. */
  mono: { size: 12, height: 17, weight: '400' as const, track: 0 },
  /** Dense monospace metadata — counters, durations, timestamps. */
  monoSmall: { size: 10.5, height: 14, weight: '500' as const, track: 0.2 },
  /** The uppercase section label. 10/13, +1.5. */
  eyebrow: { size: 10, height: 13, weight: '600' as const, track: 1.5 },
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
 * Which agent is running, not what state it is in. A deliberately cool set: it
 * stays clear of the accent's hue where it can, and it contains no green,
 * yellow or orange, so an identity chip can never be mistaken for a state.
 *
 * The letters in the avatar carry the identity at a glance; the hue only has to
 * stop two rows looking identical. */

export const agentHue = {
  claude: '#A78BFA',
  codex: '#6FAEE8',
  opencode: '#E08FC0',
  gemini: '#8C9BF5',
  grok: '#8B93A3',
  copilot: '#C08CF0',
  kimi: '#6F86C8',
} as const

/** The hashed cycle for agents the daemon reports that we do not know by name. */
const AGENT_CYCLE = ['#A78BFA', '#6FAEE8', '#E08FC0', '#8C9BF5', '#C08CF0', '#6F86C8']

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
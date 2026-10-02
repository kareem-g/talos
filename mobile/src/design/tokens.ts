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
  code: '#050506',
  /** A hole in the page — recesses, quoted blocks, inline wells. */
  well: '#0E0E10',
  /** The page. True black, so an OLED phone's chrome disappears into the glass. */
  canvas: '#000000',
  /** Navigation chrome: bars, drawer, sheets. */
  chrome: '#0B0B0C',
  /** A resting card, list row, or sheet — Apple's secondarySystemBackground. */
  surface: '#1C1C1E',
  /** A card on a card: nested grouping, a filled control, a selected row. */
  raised: '#2C2C2E',
  /** Pressed / hovered state — the surface lifts under a finger. */
  hover: '#3A3A3C',

  /** A selected row: the surface washed very slightly toward the accent. */
  selected: '#12253C',
  /** The tappable body of an input — the composer's grey well on black. */
  field: '#1C1C1E',

  /** Scrim behind a sheet, dialog or drawer. */
  scrim: 'rgba(0,0,0,0.7)',
  /** A lighter scrim for stacked overlays (a picker over a sheet). */
  scrimSoft: 'rgba(0,0,0,0.5)',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Apple's label ramp. Pure white for primary, then the three system greys. */
  ink: '#FFFFFF',
  ink2: '#AEAEB2',
  ink3: '#8E8E93',
  /** Disabled / placeholder only. Never for information. */
  ink4: '#636366',

  /* ── Accent ──────────────────────────────────────────────────────────────
   * One blue, used the way iOS uses it: links, selection, live marks — never a
   * fill for a primary action. The primary action is a LIGHT pill (see
   * `Button`), which is what keeps the chrome monochrome. */
  accent: '#0A84FF',
  accentHover: '#3D9BFF',
  accentPressed: '#0069D9',
  /** Text drawn on the accent fill. */
  accentInk: '#FFFFFF',
  accentSoft: 'rgba(10,132,255,0.14)',
  accentSoftStrong: 'rgba(10,132,255,0.22)',
  accentBorder: 'rgba(10,132,255,0.36)',

  /* ── State ───────────────────────────────────────────────────────────────
   * Deliberately almost colourless. A screen full of amber and green chips is
   * what made the app read as noisy; here a state is carried by a word, by the
   * fill of a pill, and by inversion — and only failure gets a colour. */

  /** "Needs you" — paper ink, drawn as inversion rather than as a hue. */
  wait: '#FFFFFF',
  waitSoft: 'rgba(255,255,255,0.08)',
  waitBorder: 'rgba(255,255,255,0.22)',

  /** Completed / verified / connected. The accent, so success stays quiet. */
  ok: '#0A84FF',
  okSoft: 'rgba(10,132,255,0.14)',
  okBorder: 'rgba(10,132,255,0.30)',

  /** The one state that earns a colour: something broke. */
  danger: '#FF453A',
  dangerSoft: 'rgba(255,69,58,0.14)',
  dangerBorder: 'rgba(255,69,58,0.34)',

  /**
   * Held / queued / paused — a grey, because nothing is being asked of you.
   * Deliberately one step brighter than `muted`: "queued" is still something,
   * and the two must not collapse into the same swatch.
   */
  info: '#AEAEB2',
  infoSoft: 'rgba(174,174,178,0.14)',
  infoBorder: 'rgba(174,174,178,0.30)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Apple's separator greys. */
  line: '#2C2C2E',
  lineStrong: '#3A3A3C',

  /* ── Machine plate ink ────────────────────────────────────────────────────
   * Text colours for use ON `palette.code` only. */
  codeInk: '#E5E5E7',
  /** The gutter / line-number column inside a diff. */
  codeDim: '#8E8E93',

  /* ── Machine status ink ───────────────────────────────────────────────────
   * The plate twins. `codeOk` is the one green in the app and it only ever
   * draws a diff addition — a diff without it stops being a diff. */
  codeOk: '#6FBC7F',
  codeWait: '#AEAEB2',
  codeDanger: '#FF6961',
  codeInfo: '#8E8E93',

  /** The shimmer band that runs across a skeleton while it loads. */
  shimmer: 'rgba(255,255,255,0.07)',

  /**
   * The camera viewfinder behind the pairing scanner. Genuinely pure black —
   * a viewfinder is not part of the app's visual system and tinting it would
   * change the live image the user is reading a QR code out of.
   */
  viewfinder: '#000000',

  /** Ink for a badge drawn on a saturated fill (danger count). */
  badgeInk: '#FFFFFF',
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
  /** Inline code, small tags. */
  xs: 6,
  /** Small chips, segmented items. */
  sm: 10,
  /** Inputs, icon buttons, wells — the composer's rounded box. */
  md: 14,
  /** Cards, panels, grouped lists — Apple's grouped-list corner. */
  lg: 18,
  /** Sheets and dialogs (top corners). */
  xl: 22,
  /** A capsule. Buttons, filter chips, rows, the floating action. */
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
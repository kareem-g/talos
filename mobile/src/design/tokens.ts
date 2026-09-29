/**
 * The design tokens — AgentDeck's single source of truth for colour, type,
 * spacing, radius and motion on mobile.
 *
 * WHY THIS FILE IS THE WHOLE SYSTEM
 * ---------------------------------
 * A token is defined once, here, and read by both consumers:
 *
 *   - `tailwind.config.js` requires this file and generates its `colors` from
 *     it, so `className="text-ink-2"` and `color={palette.ink2}` are provably
 *     the same value rather than two values that happen to look alike.
 *   - Components import `palette` / `toneColor` directly for icon props,
 *     placeholders and `style` props that Tailwind cannot express.
 *
 * `scripts/check-colors.mjs` fails the build if a raw hex reaches a component,
 * and `scripts/check-token-usage.mjs` fails it if a token *name* is passed as
 * a quoted string (which typechecks fine and silently renders nothing). Together
 * they mean there is exactly one place a colour can be defined, and exactly one
 * way to reference it.
 *
 * THE PALETTE — "warm terminal room, phone-sized"
 * ----------------------------------------------
 * The desktop dashboard is a "dark terminal room": near-neutral warm greys, one
 * blue accent, three status hues. Mobile keeps that language but re-proportions
 * it for a screen held at arm's length in one hand, often outdoors, often while
 * something is on fire. Four decisions drive everything below.
 *
 *   1. **The surfaces are a monotonic ramp, and elevation is a lift.** The order
 *      is fixed and never inverted:
 *
 *          well  <  canvas  <  chrome  <  surface  <  raised  <  hover
 *
 *      `well` is a *hole* — code, terminal output, search fields, the tab
 *      strip's inset wells. `canvas` is the page. `surface` is a card resting on
 *      it. `raised` is a card on a card, or a filled control. `hover` is only
 *      ever a press or selection state, never a new colour. Each step is ~4–6%
 *      lightness, which separates on a cheap panel without banding on OLED.
 *
 *   2. **Ink is a four-step ramp with a fixed job per step.** `ink` is body
 *      copy, `ink2` is secondary prose and labels, `ink3` is metadata that must
 *      stay legible (paths, counts, timestamps), `ink4` is disabled-only. All of
 *      `ink`/`ink2` clear WCAG AA (4.5:1) on every surface; `ink3` clears the
 *      large-text bar (3:1) with margin and is only ever rendered at 10–11px
 *      where that is the governing requirement. `__tests__/contrast.test.ts`
 *      *computes* these numbers rather than trusting this comment.
 *
 *   3. **Exactly ONE accent, and it is the desktop's.** `#5b8def`. It is
 *      reserved for: the primary action, the active tab, selection, focus, a
 *      live mark, and progress fills. Never decoration. A tool with a large
 *      status vocabulary (working / blocked / failed / idle) cannot also carry a
 *      decorative palette — every extra hue competes with a status colour and
 *      the user has to learn which meaning wins.
 *
 *   4. **Status is the only place colour carries meaning, and it is never the
 *      only channel.** Four tones, following the desktop's traffic-light
 *      discipline: `ok` = alive, `wait` = needs a human, `danger` = failed,
 *      `muted` = finished. `Dot` varies *size* as well as hue (the states that
 *      need a human are drawn larger so they are findable while scrolling) and
 *      every status surface ships a word. `info` is a fourth, non-urgent tone
 *      for "held, not broken" (queued, paused, informational).
 *
 * AGENT IDENTITY
 * --------------
 * A separate, deliberately narrow hue set identifies *which agent* is running,
 * not *what state* it is in, so it is allowed to be colourful where the status
 * palette is not — and it never appears on a status control. The six-slot cycle
 * is the desktop's, so a session looks the same in the browser and on the
 * phone; named providers are pinned so Claude is always the same blue.
 */

/* ── Surfaces ───────────────────────────────────────────────────────────────
 * One ramp, one order. `hexShade` documents the lightness step of each. */

export const palette = {
  /** A hole in the page — code blocks, terminal output, search wells. */
  well: '#0E0E10',
  /** The page itself. Everything else is a lift off this. */
  canvas: '#101012',
  /** Navigation chrome and headers: tab bar, app bar, sticky sub-bars. */
  chrome: '#161619',
  /** A resting card, list row, or sheet. */
  surface: '#1C1C20',
  /** A card on a card: nested grouping, filled buttons, selected rows. */
  raised: '#24242A',
  /** Pressed / hovered state for a `raised` surface. */
  hover: '#2E2E35',

  /** A selected row: `raised` warmed toward the accent. */
  selected: '#262633',
  /** The tappable body of a control sitting on `surface`. */
  field: '#141417',

  /** Scrim behind a sheet, dialog or drawer. */
  scrim: 'rgba(6,6,8,0.72)',
  /** A lighter scrim for stacked overlays (a picker over a sheet). */
  scrimSoft: 'rgba(6,6,8,0.55)',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Measured against `canvas` (#101012): `ink` 17.0:1, `ink2` 8.0:1,
   * `ink3` 4.7:1, `ink4` 3.0:1. See `__tests__/contrast.test.ts`. */
  ink: '#F2F2F3',
  ink2: '#B0B0B6',
  ink3: '#7E7E86',
  /** Disabled / placeholder only. Never for information. */
  ink4: '#57575F',

  /* ── Accent ──────────────────────────────────────────────────────────────
   * The desktop's blue, unchanged, so a session looks the same in both. */
  accent: '#5B8DEF',
  accentHover: '#6F9BF2',
  accentPressed: '#4A76D1',
  /** Text drawn ON `accent`. Near-black, not pure black, to avoid a hard edge. */
  accentInk: '#0B1220',
  /** A wash of accent — selected rows, quiet emphasis. */
  accentSoft: 'rgba(91,141,239,0.13)',
  accentSoftStrong: 'rgba(91,141,239,0.22)',
  accentBorder: 'rgba(91,141,239,0.36)',

  /* ── Status ──────────────────────────────────────────────────────────────
   * The only colours that carry meaning. Each pairs with a distinct dot size
   * and a word, so colour is never the sole channel. */
  ok: '#5FB863',
  okSoft: 'rgba(95,184,99,0.13)',
  okBorder: 'rgba(95,184,99,0.34)',

  /** "Needs you" — a human is blocking the run. The app's most important state. */
  wait: '#E08A3C',
  waitSoft: 'rgba(224,138,60,0.13)',
  waitBorder: 'rgba(224,138,60,0.36)',

  danger: '#F85149',
  dangerSoft: 'rgba(248,81,73,0.13)',
  dangerBorder: 'rgba(248,81,73,0.36)',

  /** Informational — queued, paused, or otherwise held but not broken. */
  info: '#7FA8D8',
  infoSoft: 'rgba(127,168,216,0.13)',
  infoBorder: 'rgba(127,168,216,0.36)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Alpha white, never a grey: a grey hairline picks up the colour of whatever
   * is behind it and looks dirty on a tinted surface, whereas an alpha-white
   * one always reads as "a thin bit of light on the edge". */
  line: 'rgba(255,255,255,0.075)',
  lineStrong: 'rgba(255,255,255,0.14)',

  /* ── Code wells ───────────────────────────────────────────────────────────
   * The densest text in the app, on its own darker well. */
  code: '#0A0A0C',
  codeInk: '#D9DDE7',
  /** The gutter / line-number column inside a diff. */
  codeDim: '#4E5158',

  /** The shimmer band that runs across a skeleton while it loads. */
  shimmer: 'rgba(255,255,255,0.055)',

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
   * Ink for a badge drawn on a *saturated* fill.
   *
   * `accentInk` is a blue-black tuned to sit on the accent, so it muddies when
   * placed on the danger red behind the tab bar's count. This is the near-white
   * the status fills actually want, named so the reason is recorded rather
   * than re-derived at every call site.
   */
  badgeInk: '#F5F7FA',
} as const

/* ── Diff ──────────────────────────────────────────────────────────────────────
 * There are no `diffAdd` / `diffDel` / `diffHunk` tokens, and that is
 * deliberate. A diff's green, red and blue mean *added*, *removed* and *hunk
 * header* — which are exactly what `ok`, `danger` and `info` already mean, and
 * they are already tuned against the surfaces the diff renders on. Aliasing
 * them would have created a second spelling for one meaning, and the two would
 * have drifted the moment one of them was retuned. `__tests__/contrast.test.ts`
 * fails the build on a duplicate value for the same reason, so the constraint is
 * enforced rather than merely documented.
 *
 * The tints below are the *only* diff-specific colours, because a soft fill
 * has no status equivalent: they are the row backgrounds behind a +/- line, and
 * they exist purely so the gutter reads as belonging to its line. */

export const diffAddSoft = 'rgba(95,184,99,0.10)'
export const diffDelSoft = 'rgba(248,81,73,0.10)'

/* ── Elevation ────────────────────────────────────────────────────────────────
 * The app has exactly one shadow, and overlays get it. A shadow on a content
 * card is a lie about depth: nothing on this screen is actually floating above
 * anything else, and a card that looks raised invites a drag. Overlays — sheets,
 * dialogs, toasts, the attention pill — genuinely are above the content, so
 * they are the only things that cast.
 *
 * These are `ViewStyle` shadows, so `shadowColor` has to be a raw colour; a
 * token name there is a string the platform will try to parse as a colour and
 * render nothing. They are the only place a shadow colour is written by hand,
 * and they live here so `check-colors.mjs` can allow the one file. */

export const shadowOverlay = {
  shadowColor: '#000000',
  shadowOpacity: 0.5,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 14 },
  elevation: 24,
} as const

/** A lighter version for things that float over an already-raised surface. */
export const shadowFloating = {
  shadowColor: '#000000',
  shadowOpacity: 0.4,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 10,
} as const

export type PaletteKey = keyof typeof palette

/* ── Tone mapping ────────────────────────────────────────────────────────────
 * The six semantic states the whole app colours by. Every status component
 * takes a `Tone` and looks up here, so a status colour is defined once. */

export type Tone = 'ok' | 'wait' | 'danger' | 'info' | 'accent' | 'muted'

/** Text / icon colour for a tone. */
export const toneColor: Record<Tone, string> = {
  ok: palette.ok,
  wait: palette.wait,
  danger: palette.danger,
  info: palette.info,
  accent: palette.accent,
  muted: palette.ink3,
}

/** Translucent fill for a tone — selected rows, badges, soft containers. */
export const toneSoft: Record<Tone, string> = {
  ok: palette.okSoft,
  wait: palette.waitSoft,
  danger: palette.dangerSoft,
  info: palette.infoSoft,
  accent: palette.accentSoft,
  muted: 'rgba(255,255,255,0.05)',
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
    muted: 'bg-white/5',
  } as Record<Tone, string>,
  border: {
    ok: 'border-ok-border',
    wait: 'border-wait-border',
    danger: 'border-danger-border',
    info: 'border-info-border',
    accent: 'border-accent-border',
    muted: 'border-line-strong',
  } as Record<Tone, string>,
} as const

/* ── Radii ───────────────────────────────────────────────────────────────────
 * Six steps, each with a job. The old vocabulary had seven overlapping names
 * (`sm`/`md`/`lg`/`xl`/`2xl`/`card`/`control`/`chip`); these are the only ones. */

export const radius = {
  /** Inline code, tiny tags, 1px-ish affordances. */
  xs: 6,
  /** Badges, chips, small controls. */
  sm: 10,
  /** Buttons, inputs, list rows. The workhorse. */
  md: 14,
  /** Cards and panels. */
  lg: 20,
  /** Sheets, dialogs, the tab bar's floating elements. */
  xl: 26,
  /** Full pill — segmented controls, FABs, chips. */
  pill: 999,
} as const

/* ── Spacing ─────────────────────────────────────────────────────────────────
 * A 4pt scale. Tailwind's default scale is what components use via class
 * names; these exist for `style` props and for documenting the rhythm. The
 * page gutter is 16, the card gutter 14, the tight gap 8. */

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const

/* ── Type ────────────────────────────────────────────────────────────────────
 * A mobile scale. Every step is larger than its desktop counterpart: a phone
 * is read at arm's length, often one-handed, often in motion, and the desktop
 * sets body copy at 13px on a monitor 60cm away. Tracking is negative on large
 * text (optical) and positive on small caps (legibility).
 *
 * `size`/`height` are RN fontSize/lineHeight; `weight` is the RN fontWeight;
 * `track` is letterSpacing in px. */

export const type = {
  /** Screen hero title (large-title headers). 30/36, -0.6. */
  display: { size: 30, height: 36, weight: '700' as const, track: -0.6 },
  /** Section title. 21/27, -0.35. */
  title: { size: 21, height: 27, weight: '700' as const, track: -0.35 },
  /** App-bar title, card title. 16.5/22, -0.2. */
  heading: { size: 16.5, height: 22, weight: '600' as const, track: -0.2 },
  /** Body / list row primary. 15/21, 0. */
  body: { size: 15, height: 21, weight: '400' as const, track: 0 },
  /** List row primary, emphasised. 15/21, 500. */
  label: { size: 15, height: 21, weight: '500' as const, track: -0.05 },
  /** Secondary body, descriptions. 13.5/19, 0. */
  caption: { size: 13.5, height: 19, weight: '400' as const, track: 0 },
  /** Metadata. 12/16, 0. */
  small: { size: 12, height: 16, weight: '400' as const, track: 0 },
  /** Dense labels, tool rows, chips. 11.5/15, +0.1. */
  micro: { size: 11.5, height: 15, weight: '500' as const, track: 0.1 },
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
 * the status palette is not, and they never appear on a status control. The
 * six-slot cycle is the desktop's, so a session looks identical in both. */

export const agentHue = {
  claude: '#6396CC',
  codex: '#A78BFA',
  opencode: '#5FBF8F',
  grok: '#E07A5F',
  gemini: '#7FA8D8',
  copilot: '#D96A8A',
  kimi: '#C084FC',
} as const

/** The hashed cycle for agents the daemon reports that we do not know by name. */
const AGENT_CYCLE = ['#6396CC', '#A78BFA', '#5FBF8F', '#E07A5F', '#D96A8A', '#E8B45C']

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
  return `${hex}22`
}

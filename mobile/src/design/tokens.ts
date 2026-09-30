/**
 * The design tokens — AgentDeck's single source of truth for colour, type,
 * spacing, radius and motion on mobile.
 *
 * THE PALETTE — "midnight studio"
 * -------------------------------
 * The v3 visual language. Where the previous palette was a warm terminal room,
 * this one is a calm, near-black studio: a cool graphite ramp with almost no
 * chroma, one electric-blue accent used only for what is actionable, and four
 * status hues that are never decoration. It is modelled on the chat surfaces
 * people already trust (ChatGPT, Linear, Zed): content reads as luminous type
 * floating on true darkness, chrome disappears until it is needed, and every
 * container is a soft-cornered sheet with a hairline rather than a border-heavy
 * box. The rules that make it work:
 *
 *   1. **The surfaces are a monotonic ramp, and elevation is a lift.**
 *
 *        well  <  canvas  <  chrome  <  surface  <  raised  <  hover
 *
 *      `well` is a hole (code, terminal, search fields). `canvas` is the page.
 *      `surface` is a card. `raised` is a card on a card or a filled control.
 *      `hover` is only ever a press state. Each step is ~5% lightness — enough
 *      to separate on a cheap panel, small enough to never band on OLED.
 *
 *   2. **Ink is a four-step ramp with a fixed job per step.** `ink` is body
 *      copy, `ink2` is secondary prose and labels, `ink3` is metadata, `ink4`
 *      is disabled-only. `ink`/`ink2` clear WCAG AA on every surface; `ink3`
 *      clears the large-text bar; `__tests__/contrast.test.ts` computes the
 *      ratios rather than trusting this comment.
 *
 *   3. **Exactly ONE accent.** An electric periwinkle-blue, the desktop's hue
 *      pushed brighter so it glows against near-black. Reserved for: the
 *      primary action, the active tab, selection, links, a live mark, progress.
 *      Never decoration — with four status hues in the app, every decorative
 *      colour competes with a meaning.
 *
 *   4. **Status is the only place colour carries meaning, and never the only
 *      channel.** `ok` = alive, `wait` = needs a human, `danger` = failed,
 *      `info` = held, not broken. Dots vary size as well as hue and every
 *      status surface ships a word.
 */

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export const palette = {
  /** A hole in the page — code blocks, terminal output, search wells. */
  well: '#08080A',
  /** The page itself. Everything else is a lift off this. */
  canvas: '#0C0C0E',
  /** Navigation chrome and headers: tab bar, app bar, sticky sub-bars. */
  chrome: '#121215',
  /** A resting card, list row, or sheet. */
  surface: '#17171B',
  /** A card on a card: nested grouping, filled buttons, selected rows. */
  raised: '#1F1F25',
  /** Pressed / hovered state for a `raised` surface. */
  hover: '#2A2A32',

  /** A selected row: `raised` cooled toward the accent. */
  selected: '#191C2A',
  /** The tappable body of a control sitting on `surface`. */
  field: '#0E0E11',

  /** Scrim behind a sheet, dialog or drawer. */
  scrim: 'rgba(4,4,6,0.66)',
  /** A lighter scrim for stacked overlays (a picker over a sheet). */
  scrimSoft: 'rgba(4,4,6,0.5)',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Measured against `canvas` (#0C0C0E): `ink` 17.6:1, `ink2` 8.8:1,
   * `ink3` 4.6:1, `ink4` 2.2:1. See `__tests__/contrast.test.ts`. */
  ink: '#F3F3F5',
  ink2: '#ABAEB8',
  ink3: '#7A7A86',
  /** Disabled / placeholder only. Never for information. */
  ink4: '#4E4E58',

  /* ── Accent ──────────────────────────────────────────────────────────────
   * The desktop's blue, pushed brighter for near-black surfaces. */
  accent: '#7A9BFF',
  accentHover: '#8FABFF',
  accentPressed: '#6689F2',
  /** Text drawn ON `accent`. Near-black with the accent's cast. */
  accentInk: '#0A1024',
  /** A wash of accent — selected rows, quiet emphasis. */
  accentSoft: 'rgba(122,155,255,0.13)',
  accentSoftStrong: 'rgba(122,155,255,0.22)',
  accentBorder: 'rgba(122,155,255,0.38)',

  /* ── Status ──────────────────────────────────────────────────────────────
   * The only colours that carry meaning. Each pairs with a distinct dot size
   * and a word, so colour is never the sole channel. */
  ok: '#52C58B',
  okSoft: 'rgba(82,197,139,0.13)',
  okBorder: 'rgba(82,197,139,0.36)',

  /** "Needs you" — a human is blocking the run. The app's most important state. */
  wait: '#E8A03E',
  waitSoft: 'rgba(232,160,62,0.13)',
  waitBorder: 'rgba(232,160,62,0.38)',

  danger: '#F45B66',
  dangerSoft: 'rgba(244,91,102,0.13)',
  dangerBorder: 'rgba(244,91,102,0.38)',

  /** Informational — queued, paused, or otherwise held but not broken. */
  info: '#74B6E8',
  infoSoft: 'rgba(116,182,232,0.13)',
  infoBorder: 'rgba(116,182,232,0.36)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Alpha white, never a grey: a grey hairline picks up the colour of whatever
   * is behind it and looks dirty on a tinted surface, whereas an alpha-white
   * one always reads as "a thin bit of light on the edge". */
  line: 'rgba(255,255,255,0.065)',
  lineStrong: 'rgba(255,255,255,0.13)',

  /* ── Code wells ───────────────────────────────────────────────────────────
   * The densest text in the app, on its own darker well. */
  code: '#0A0A0D',
  codeInk: '#DCE0EA',
  /** The gutter / line-number column inside a diff. */
  codeDim: '#54555E',

  /** The shimmer band that runs across a skeleton while it loads. */
  shimmer: 'rgba(255,255,255,0.05)',

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
   * Near-white, tuned for dark text-on-fill legibility at small sizes.
   */
  badgeInk: '#F5F7FC',
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

export const diffAddSoft = 'rgba(82,197,139,0.10)'
export const diffDelSoft = 'rgba(244,91,102,0.10)'

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
  shadowOpacity: 0.55,
  shadowRadius: 32,
  shadowOffset: { width: 0, height: 16 },
  elevation: 26,
} as const

/** A lighter version for things that float over an already-raised surface. */
export const shadowFloating = {
  shadowColor: '#000000',
  shadowOpacity: 0.45,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 7 },
  elevation: 12,
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
 * Six steps, each with a job. The v3 language is soft: containers read as
 * sheets of glass on the page, so cards and controls are one step rounder
 * than the previous vocabulary. */

export const radius = {
  /** Inline code, tiny tags, 1px-ish affordances. */
  xs: 7,
  /** Badges, chips, small controls. */
  sm: 11,
  /** Buttons, inputs, list rows. The workhorse. */
  md: 15,
  /** Cards and panels. */
  lg: 20,
  /** Sheets, dialogs, the tab bar's floating elements. */
  xl: 28,
  /** Full pill — segmented controls, FABs, chips. */
  pill: 999,
} as const

/* ── Spacing ─────────────────────────────────────────────────────────────────
 * A 4pt scale. Tailwind's default scale is what components use via class
 * names; these exist for `style` props and for documenting the rhythm. The
 * page gutter is 18, the card gutter 16, the tight gap 8. */

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 30,
} as const

/* ── Type ────────────────────────────────────────────────────────────────────
 * A mobile scale tuned for the v3 language: generous body sizes, tall
 * line-heights on prose, tight tracking on large display text. A phone is read
 * at arm's length, often one-handed, often in motion.
 *
 * `size`/`height` are RN fontSize/lineHeight; `weight` is the RN fontWeight;
 * `track` is letterSpacing in px. */

export const type = {
  /** Screen hero title (large-title headers). 30/36, -0.7. */
  display: { size: 30, height: 36, weight: '700' as const, track: -0.7 },
  /** Section title. 21/27, -0.4. */
  title: { size: 21, height: 27, weight: '700' as const, track: -0.4 },
  /** App-bar title, card title. 16.5/22, -0.2. */
  heading: { size: 16.5, height: 22, weight: '600' as const, track: -0.2 },
  /** Body / list row primary. 15.5/22, 0. */
  body: { size: 15.5, height: 22, weight: '400' as const, track: 0 },
  /** List row primary, emphasised. 15.5/22, 500. */
  label: { size: 15.5, height: 22, weight: '500' as const, track: -0.1 },
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

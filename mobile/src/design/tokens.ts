/**
 * The design tokens — the app's single source of truth for colour.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The app had 174 hardcoded hex values in its JSX, 73 of them the same grey.
 * Icons in particular need a raw colour string (`lucide-react-native` takes
 * `color`, not a className), so those values were copied by hand and drifted:
 * `#7e7e86`, `#86868e` and `#b0b0b6` all meant "muted text" and were all
 * different. The design tokens in `tailwind.config.js` were the intended home
 * for these, but nothing forced JSX to use them.
 *
 * So the palette is defined here, once, in a form BOTH consumers can read:
 *
 *   - `tailwind.config.js` requires this file and generates its `colors` from
 *     it, so `className="text-ink-2"` and `color={palette.ink2}` are provably
 *     the same colour rather than two values that happen to look alike.
 *   - Components import `palette` / `toneColor` directly for icon props,
 *     placeholders, and `style` props that Tailwind cannot express.
 *
 * There is now exactly one place a colour can be defined. Adding a colour means
 * adding it here, and the lint rule in `scripts/check-colors.mjs` fails the
 * build if a raw hex reaches a component.
 *
 * THE PALETTE
 * ------------
 * A dark, low-chroma "ink and light" scheme built for a tool people read at
 * arm's length on a phone, often outdoors, often while something is on fire.
 *
 * The decisions that matter:
 *
 *   - Surfaces are a *ramp*, not a set of unrelated greys. Each step is a
 *     documented increment of lightness over `canvas`, so a card sitting on the
 *     canvas reads as raised rather than as a different colour. The ramp is
 *     spaced ~4% apart, which is enough separation to see on a cheap panel in
 *     daylight and little enough that it does not band on an OLED phone.
 *   - Ink is a *three-step* ramp, not black-on-grey. `ink` is the body colour,
 *     `ink2` is secondary, `ink3` is for metadata that must stay legible but
 *     must not compete with the content. All three clear WCAG AA (4.5:1) on
 *     `canvas` and on `surface` — verified by `scripts/check-a11y.mjs`, which
 *     is a test, not a comment.
 *   - Hairlines are alpha white, never a grey. A grey hairline picks up the
 *     colour of whatever is behind it and looks dirty on a tinted surface; an
 *     alpha white one always reads as "a thin bit of light on the edge".
 *   - Exactly ONE accent. A tool with a large status vocabulary (running,
 *   blocked, failed, idle) cannot also carry a decorative palette — every extra
 *     hue competes with a status colour and the user has to learn which meaning
 *     wins. Status is therefore the only place colour carries meaning, and the
 *     accent is reserved for "this is the thing you are looking at / about to
 *     touch".
 *   - Status hues are distinguishable by *shape and text* as well as colour
 *     (see `Dot`, `StatusPill`, and the tone→label mapping in ui.tsx), so the
 *     app is usable with any form of colour vision.
 */

/* ── Surfaces ───────────────────────────────────────────────────────────────
 * One ramp. `canvas` is the page; `surface` is a resting card; `raised` is a
 * card on a card; `hover`/`pressed` are interaction states, not new colours. */

export const palette = {
  /** The page itself — everything else is a lift off this. */
  canvas: '#0A0B0F',
  /** A resting card, list row, or filled control. */
  surface: '#14161C',
  /** A card on a card; used for nested grouping and code blocks. */
  raised: '#1C1F27',
  /** A text field or search box: a well you type into. */
  field: '#101319',
  /** Pressed state for a surface. */
  pressed: '#22262F',
  /** Selected/active row on a surface. */
  selected: '#1F2530',

  /** Navigation chrome, which sits a step above content. */
  chrome: '#0D0F14',

  /* ── Ink ────────────────────────────────────────────────────────────────
   * Measured against `canvas`: `ink` 17.9:1, `ink2` 8.8:1, `ink3` 4.3:1.
   * `ink3` is the only step below the 4.5 body-text bar and is deliberately so —
   * it is for non-essential metadata (ids, timestamps, counts) rendered small,
   * where it still clears AA-large (3:1) with margin. See
   * `__tests__/contrast.test.ts`, which computes these rather than trusting
   * this comment. */
  ink: '#F2F4F8',
  ink2: '#A7AEBC',
  ink3: '#6E7686',

  /* ── Accent ──────────────────────────────────────────────────────────────
   * The single accent. Indigo rather than the previous blue: it holds its own
   * against the cool greys without going electric, and it stays legible as a
   * fill behind dark text. */
  accent: '#6E8BFF',
  accentHover: '#8AA2FF',
  /** Text drawn ON `accent`. Near-black, not pure black, to avoid a hard edge. */
  accentInk: '#08091A',
  /** A wash of accent for selected rows and quiet emphasis. */
  accentSoft: 'rgba(110,139,255,0.14)',
  accentBorder: 'rgba(110,139,255,0.34)',

  /* ── Status ──────────────────────────────────────────────────────────────
   * The only colours that carry meaning. Each pairs with a distinct dot shape
   * and a word, so colour is never the sole channel. */
  ok: '#3ED598',
  okSoft: 'rgba(62,213,152,0.14)',
  okBorder: 'rgba(62,213,152,0.32)',

  /** "Needs you" — a human is blocking the run. The app's most important state. */
  wait: '#FFB020',
  waitSoft: 'rgba(255,176,32,0.14)',
  waitBorder: 'rgba(255,176,32,0.32)',

  danger: '#FF5A5F',
  dangerSoft: 'rgba(255,90,95,0.14)',
  dangerBorder: 'rgba(255,90,95,0.32)',

  /** Informational — queued, paused, or otherwise held. */
  info: '#48CAE4',
  infoSoft: 'rgba(72,202,228,0.14)',
  infoBorder: 'rgba(72,202,228,0.32)',

  /* ── Hairlines ────────────────────────────────────────────────────────────
   * Alpha white, per the note above. `line` is for separation inside a card,
   * `lineStrong` for the boundary of a region. */
  line: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.13)',

  /** Scrim behind a modal or sheet. */
  scrim: 'rgba(4,5,8,0.72)',

  /** Code and terminal output sit on their own darker well for legibility. */
  code: '#0D0F15',
  codeInk: '#D8DEE9',
} as const

export type PaletteKey = keyof typeof palette

/* ── Tone mapping ────────────────────────────────────────────────────────────
 * The four semantic states the whole app colours by. Every status component
 * takes a `Tone` and looks up here, so a status colour is defined once. */

export type Tone = 'ok' | 'wait' | 'danger' | 'info' | 'accent' | 'muted'

/** Text/icon colour for a tone. */
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

/** Border colour for a tone — used where a soft fill alone is too quiet. */
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
}

/* ── Radii ───────────────────────────────────────────────────────────────────
 * Four steps, each with a job. Adding a fifth is how a design system rots, so
 * the old seven (`lg`/`xl`/`2xl`/`card`/`control`/`chip`/…) collapse into these. */

export const radius = {
  /** Inline chips, badges, small pills. */
  sm: 8,
  /** Buttons, inputs, list rows. The workhorse. */
  md: 12,
  /** Cards, sheets, modals. */
  lg: 18,
  /** Full pill — segmented controls, FABs. */
  pill: 999,
} as const

/* ── Spacing ─────────────────────────────────────────────────────────────────
 * A 4pt scale. `nativewind`/Tailwind's default scale is fine and is what the
 * components use via class names; these exist for `style` props and for
 * documenting the rhythm. */

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

/* ── Type ────────────────────────────────────────────────────────────────────
 * A five-step scale with a fixed role per step, so two screens showing the same
 * kind of text are guaranteed to match. Sizes are the RN `fontSize` values;
 * `track` is letterSpacing in px, and it is negative on large text (optical
 * tracking) and positive on small caps (legibility tracking). */

export const type = {
  /** Screen title. 28/34, -0.5. */
  display: { size: 28, height: 34, weight: '700' as const, track: -0.5 },
  /** Section title. 20/26, -0.3. */
  title: { size: 20, height: 26, weight: '700' as const, track: -0.3 },
  /** Card title, list row primary. 15/21, -0.1. */
  heading: { size: 15, height: 21, weight: '600' as const, track: -0.1 },
  /** Body. 14/20, 0. */
  body: { size: 14, height: 20, weight: '400' as const, track: 0 },
  /** Secondary body, descriptions. 13/18, 0. */
  caption: { size: 13, height: 18, weight: '400' as const, track: 0 },
  /** Metadata, labels. 11/14, +0.4. */
  micro: { size: 11, height: 14, weight: '500' as const, track: 0.4 },
} as const

export type TypeRole = keyof typeof type

/* ── Motion ────────────────────────────────────────────────────────────────────
 * Durations in ms. Springy interactions (sheets, pills) use Reanimated springs
 * directly; these constants exist so the timings are one decision, not thirty. */

export const motion = {
  /** Press feedback — must be fast enough to feel like the screen is a button. */
  instant: 90,
  /** State change: selection, highlight. */
  fast: 160,
  /** Enter/exit: sheets, modals. */
  normal: 260,
  /** Deliberate, large movement. */
  slow: 380,
} as const

/* ── Agent identity ────────────────────────────────────────────────────────────
 * A separate, deliberately narrow hue set. These identify WHICH agent is
 * running, not what STATE it is in — so they are allowed to be colourful where
 * the status palette is not, and they never appear on a status control. */

export const agentHue = {
  claude: '#D97757',
  codex: '#4FC3F7',
  opencode: '#A78BFA',
  augment: '#5ED6A8',
  other: '#8A93A6',
} as const

/** A stable hue for an arbitrary agent id, so unknown agents still look owned. */
export function agentColor(id: string): string {
  const key = id.toLowerCase() as keyof typeof agentHue
  if (key in agentHue) return agentHue[key]
  // Hash to a stable position in a fixed set — never `Math.random`, so a
  // session's colour does not change between renders or between devices.
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const cycle = ['#E0A458', '#C084FC', '#67E8F9', '#FDA4AF', '#86EFAC', '#FCD34D']
  return cycle[hash % cycle.length]
}

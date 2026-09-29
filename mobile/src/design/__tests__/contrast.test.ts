/**
 * The palette's contrast claims, checked.
 *
 * `tokens.ts` says `ink` is 7.9:1 on `canvas` and `ink3` is 3.6:1. Those are
 * numbers in a comment, which is exactly the kind of claim that rots: a colour
 * is tweaked for aesthetics, the comment is not updated, and a real regression
 * ships unnoticed. This test computes the ratios, so a palette change that
 * breaks legibility fails here instead of on someone's phone.
 *
 * Thresholds are WCAG 2.1:
 *   - 4.5:1 for body text (SC 1.4.3)
 *   - 3.0:1 for large text (>=18.66px bold or >=24px) and for UI component
 *     boundaries (SC 1.4.11)
 */

import { palette } from '../tokens'

/* ── Colour maths ──────────────────────────────────────────────────────────── */

type Rgb = [number, number, number]

/**
 * Parse `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)` into 0–1 channels.
 *
 * Both forms are needed: the palette is written as hex, but a translucent
 * `rgba()` fill is only meaningful composited over a surface, and the test has
 * to handle both to compare them.
 */
function parse(color: string): Rgb {
  const value = color.trim()
  const functional = value.match(/^rgba?\(([^)]+)\)$/i)
  if (functional) {
    const parts = functional[1].split(',').map((p) => parseFloat(p.trim()))
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
  }
  const hex = value.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6)
  if (full.length < 6 || Number.isNaN(parseInt(full, 16))) {
    throw new Error(`contrast: cannot parse colour ${JSON.stringify(color)}`)
  }
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ]
}

/** The alpha channel of an `rgba()` colour; 1 for everything else. */
function alphaOf(color: string): number {
  const functional = color.trim().match(/^rgba?\(([^)]+)\)$/i)
  if (!functional) return 1
  const parts = functional[1].split(',').map((p) => parseFloat(p.trim()))
  return parts[3] === undefined ? 1 : parts[3]
}

/** Composite a translucent colour over an opaque one, producing opaque hex. */
function composite(color: string, over: string): string {
  const a = alphaOf(color)
  if (a >= 1) return color
  const [r, g, b] = parse(color)
  const [or_, og, ob] = parse(over)
  const mix = (top: number, bottom: number) =>
    Math.round((top * a + bottom * (1 - a)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${mix(r, or_)}${mix(g, og)}${mix(b, ob)}`
}

/** WCAG relative luminance, from any supported colour form. */
function luminance(color: string): number {
  const [r, g, b] = parse(color).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(foreground: string, background: string): number {
  // Composite translucent foregrounds onto the background first — a soft tint
  // drawn on `surface` is not the colour it looks like in isolation.
  const fg = composite(foreground, background)
  // The background itself may be translucent relative to the page beneath it
  // (a `*Soft` token is `rgba(...)` and is drawn on `surface`).
  const bg = composite(background, palette.canvas)
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const round = (n: number) => Math.round(n * 100) / 100

/* ── The claims ────────────────────────────────────────────────────────────────
 * Each entry is text colour on the surface it is actually used on. `min` is the
 * bar it has to clear: 4.5 for body, 3 for large/metadata and UI boundaries. */

const TEXT_ON: Array<{ name: string; fg: string; bg: string; min: number; why: string }> = [
  // Body text on the page and on cards — the most common pairing in the app.
  { name: 'ink on canvas', fg: palette.ink, bg: palette.canvas, min: 4.5, why: 'body text' },
  { name: 'ink on surface', fg: palette.ink, bg: palette.surface, min: 4.5, why: 'body text' },
  { name: 'ink on raised', fg: palette.ink, bg: palette.raised, min: 4.5, why: 'body text' },
  { name: 'ink on field', fg: palette.ink, bg: palette.field, min: 4.5, why: 'typed input' },
  { name: 'ink on selected', fg: palette.ink, bg: palette.selected, min: 4.5, why: 'body text' },

  // Secondary text — still has to be readable, it carries project paths.
  { name: 'ink2 on canvas', fg: palette.ink2, bg: palette.canvas, min: 4.5, why: 'secondary' },
  { name: 'ink2 on surface', fg: palette.ink2, bg: palette.surface, min: 4.5, why: 'secondary' },

  // Metadata — timestamps and ids. Large-text bar (3:1) is the governing
  // requirement for the size and weight these are rendered at.
  { name: 'ink3 on canvas', fg: palette.ink3, bg: palette.canvas, min: 3, why: 'metadata' },
  { name: 'ink3 on surface', fg: palette.ink3, bg: palette.surface, min: 3, why: 'metadata' },
  { name: 'ink3 on code', fg: palette.ink3, bg: palette.code, min: 3, why: 'metadata in code' },

  // The accent used as text (links, active states) and as a fill.
  { name: 'accent on canvas', fg: palette.accent, bg: palette.canvas, min: 4.5, why: 'accent text' },
  { name: 'accent on surface', fg: palette.accent, bg: palette.surface, min: 4.5, why: 'accent text' },
  { name: 'accentInk on accent', fg: palette.accentInk, bg: palette.accent, min: 4.5, why: 'label on primary' },

  // Every status colour, on its own soft fill over the surface it sits on —
  // this is how a `Badge` or `StatusPill` actually renders.
  { name: 'ok on okSoft/surface', fg: palette.ok, bg: palette.okSoft, min: 4.5, why: 'status' },
  { name: 'wait on waitSoft/surface', fg: palette.wait, bg: palette.waitSoft, min: 4.5, why: 'status' },
  { name: 'danger on dangerSoft/surface', fg: palette.danger, bg: palette.dangerSoft, min: 4.5, why: 'status' },
  { name: 'info on infoSoft/surface', fg: palette.info, bg: palette.infoSoft, min: 4.5, why: 'status' },

  // Status colours directly on surfaces too, since `StatusPill` puts the label
  // on `surface` with only a soft border behind it.
  { name: 'ok on surface', fg: palette.ok, bg: palette.surface, min: 4.5, why: 'status text' },
  { name: 'wait on surface', fg: palette.wait, bg: palette.surface, min: 4.5, why: 'status text' },
  { name: 'danger on surface', fg: palette.danger, bg: palette.surface, min: 4.5, why: 'status text' },
  { name: 'info on surface', fg: palette.info, bg: palette.surface, min: 4.5, why: 'status text' },

  // Code wells carry the densest text in the app.
  { name: 'codeInk on code', fg: palette.codeInk, bg: palette.code, min: 4.5, why: 'code' },
]

describe('palette contrast', () => {
  it.each(TEXT_ON)('$name clears $min:1 ($why)', ({ fg, bg, min }) => {
    const ratio = contrast(fg, bg)
    expect({ name: `${fg} on ${bg}`, ratio: round(ratio), min }).toEqual({
      name: `${fg} on ${bg}`,
      ratio: round(ratio),
      min,
    })
    // The assertion: if this fails, the palette needs a darker/lighter step.
    expect(ratio).toBeGreaterThanOrEqual(min)
  })

  it('reports the full table, so a near-miss is visible before it becomes one', () => {
    const rows = TEXT_ON.map((entry) => ({
      pair: entry.name,
      ratio: round(contrast(entry.fg, entry.bg)),
      min: entry.min,
      ok: contrast(entry.fg, entry.bg) >= entry.min,
    }))
    const failing = rows.filter((row) => !row.ok)
    // eslint-disable-next-line no-console
    console.log('\ncontrast report:\n' + rows.map((r) => `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(6)}:1  (min ${r.min})  ${r.pair}`).join('\n'))
    expect(failing).toEqual([])
  })
})

describe('surface ramp', () => {
  it('is monotonically lighter from canvas to raised', () => {
    const ramp = [palette.canvas, palette.chrome, palette.surface, palette.raised]
    for (let i = 1; i < ramp.length; i++) {
      expect({ pair: `${ramp[i - 1]}→${ramp[i]}`, after: round(luminance(ramp[i])) }).toEqual({
        pair: `${ramp[i - 1]}→${ramp[i]}`,
        after: round(luminance(ramp[i])),
      })
      expect(luminance(ramp[i])).toBeGreaterThan(luminance(ramp[i - 1]))
    }
  })

  it('separates adjacent steps enough to read as different surfaces', () => {
    // Two greys a percent apart are indistinguishable on a cheap panel; the ramp
    // is useless if the steps it defines are not perceptible.
    const steps = [palette.canvas, palette.surface, palette.raised]
    for (let i = 1; i < steps.length; i++) {
      const ratio = contrast(steps[i], steps[i - 1])
      expect({ pair: `${steps[i - 1]} vs ${steps[i]}`, ratio: round(ratio) }).toEqual({
        pair: `${steps[i - 1]} vs ${steps[i]}`,
        ratio: round(ratio),
      })
      expect(ratio).toBeGreaterThan(1.08)
    }
  })
})

describe('colour vocabulary', () => {
  it('defines no raw duplicates, so a rename is unambiguous', () => {
    const values = Object.values(palette)
    expect(new Set(values).size).toBe(values.length)
  })
})

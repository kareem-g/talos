/**
 * Touch → pointer mapping. These pin the maths that decides where a finger
 * lands on the remote screen: if the fit/centre/zoom transform is wrong, every
 * click misses, and the bug is invisible until someone is looking at the
 * desktop. Kept pure so it is testable without a device.
 */

import { clampPan, computeViewport, fitScale, screenToFrame, scrollFromDrag } from '../touch'

describe('fitScale', () => {
  it('contains the frame preserving aspect', () => {
    expect(fitScale({ width: 400, height: 800 }, { width: 1600, height: 900 })).toBeCloseTo(0.25)
    // A small frame is scaled up to fill the screen (contain), keeping aspect.
    expect(fitScale({ width: 1600, height: 900 }, { width: 400, height: 300 })).toBe(3)
  })

  it('is total for a degenerate container or frame', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(1)
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1)
  })
})

describe('computeViewport', () => {
  it('centres the frame and applies zoom', () => {
    const viewport = computeViewport({ width: 400, height: 800 }, { width: 800, height: 400 }, 1, 0, 0)
    // Contain scale is 0.5, so the drawn frame is 400×200, centred vertically.
    expect(viewport.drawWidth).toBe(400)
    expect(viewport.drawHeight).toBe(200)
    expect(viewport.offsetX).toBe(0)
    expect(viewport.offsetY).toBe(300)
  })
})

describe('screenToFrame', () => {
  it('round-trips a screen point to a frame pixel', () => {
    const viewport = computeViewport({ width: 400, height: 800 }, { width: 800, height: 400 }, 1, 0, 0)
    // The centre of the screen is the centre of the frame.
    expect(screenToFrame(viewport, { width: 800, height: 400 }, 200, 400)).toEqual({ x: 400, y: 200 })
  })

  it('clamps to the frame instead of producing an out-of-range click', () => {
    const viewport = computeViewport({ width: 400, height: 800 }, { width: 800, height: 400 }, 1, 0, 0)
    expect(screenToFrame(viewport, { width: 800, height: 400 }, -500, -500)).toEqual({ x: 0, y: 0 })
    expect(screenToFrame(viewport, { width: 800, height: 400 }, 9999, 9999)).toEqual({ x: 799, y: 399 })
  })
})

describe('clampPan', () => {
  it('keeps the frame on screen', () => {
    const viewport = computeViewport({ width: 400, height: 800 }, { width: 800, height: 400 }, 2, 0, 0)
    const clamped = clampPan(viewport, 10_000, -10_000)
    expect(clamped.x).toBeLessThan(10_000)
    expect(clamped.y).toBeGreaterThan(-10_000)
  })
})

describe('scrollFromDrag', () => {
  it('passes the delta through with its sign (trackpad convention)', () => {
    expect(scrollFromDrag(3, 7)).toEqual({ dx: 3, dy: 7 })
  })
})
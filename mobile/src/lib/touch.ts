/**
 * Touch → pointer math.
 *
 * The frame is drawn "contain"-fit inside the viewport at `zoom`, centred, then
 * panned. These helpers convert a screen touch into frame-local coordinates so
 * the same gesture means the same pixel on the remote screen regardless of
 * zoom, rotation or how the phone's letterboxing falls. Kept pure so the
 * mapping is unit-testable without a device.
 */

export interface Size {
  width: number
  height: number
}

export interface Viewport {
  /** Display scale: fit scale times zoom. */
  scale: number
  /** Top-left of the drawn frame in screen coordinates. */
  offsetX: number
  offsetY: number
  /** The drawn frame size in screen coordinates. */
  drawWidth: number
  drawHeight: number
}

/** The aspect-preserving scale that fits `frame` inside `container` (contain).
 *  May upscale a small window so it fills the screen; the 1:1 control pins it
 *  back to one frame pixel per screen point. */
export function fitScale(container: Size, frame: Size): number {
  if (frame.width <= 0 || frame.height <= 0 || container.width <= 0 || container.height <= 0) return 1
  return Math.min(container.width / frame.width, container.height / frame.height)
}

/**
 * Where the frame lands on screen. `zoom` multiplies the fit scale; `panX/panY`
 * are screen-space offsets applied after centring.
 */
export function computeViewport(
  container: Size,
  frame: Size,
  zoom: number,
  panX: number,
  panY: number,
): Viewport {
  const scale = fitScale(container, frame) * Math.max(0.25, zoom)
  const drawWidth = frame.width * scale
  const drawHeight = frame.height * scale
  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (container.width - drawWidth) / 2 + panX,
    offsetY: (container.height - drawHeight) / 2 + panY,
  }
}

/** Screen point → frame-local pixel, clamped to the frame. */
export function screenToFrame(
  viewport: Viewport,
  frame: Size,
  x: number,
  y: number,
): { x: number; y: number } {
  const fx = (x - viewport.offsetX) / viewport.scale
  const fy = (y - viewport.offsetY) / viewport.scale
  return {
    x: Math.max(0, Math.min(frame.width - 1, fx)),
    y: Math.max(0, Math.min(frame.height - 1, fy)),
  }
}

/** Clamp pan so the frame cannot be dragged entirely out of view. */
export function clampPan(
  viewport: Viewport,
  panX: number,
  panY: number,
  slack = 40,
): { x: number; y: number } {
  const maxX = Math.max(0, (viewport.drawWidth - 0) / 2 - slack)
  const maxY = Math.max(0, (viewport.drawHeight - 0) / 2 - slack)
  return {
    x: Math.max(-maxX, Math.min(maxX, panX)),
    y: Math.max(-maxY, Math.min(maxY, panY)),
  }
}

/** Scroll distance from a two-finger drag (screen pixels).
 *
 * Trackpad convention: dragging two fingers down scrolls the content down, so
 * the delta passes through with its sign. The screen scales it to pixels.
 */
export function scrollFromDrag(dxScreen: number, dyScreen: number): { dx: number; dy: number } {
  return { dx: dxScreen, dy: dyScreen }
}
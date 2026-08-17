import { useEffect, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

export interface TerminalDimensions {
  cols: number
  rows: number
}

export function isValidTerminalDimensions(dimensions: TerminalDimensions): boolean {
  return Number.isInteger(dimensions.cols)
    && Number.isInteger(dimensions.rows)
    && dimensions.cols > 0
    && dimensions.rows > 0
}

export function terminalDimensionsChanged(previous: TerminalDimensions | null, next: TerminalDimensions): boolean {
  return isValidTerminalDimensions(next)
    && (previous === null || previous.cols !== next.cols || previous.rows !== next.rows)
}

export function useTerminalResize(
  terminal: Terminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  onResize?: (dimensions: TerminalDimensions) => void,
) {
  const callbackRef = useRef(onResize)
  callbackRef.current = onResize
  const lastDimensionsRef = useRef<TerminalDimensions | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!terminal || !fit || !container) return

    const emit = () => {
      frameRef.current = null
      const rect = container.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return

      try {
        fit.fit()
      } catch {
        return
      }

      const dimensions = { cols: terminal.cols, rows: terminal.rows }
      if (!terminalDimensionsChanged(lastDimensionsRef.current, dimensions)) return
      lastDimensionsRef.current = dimensions
      callbackRef.current?.(dimensions)
    }

    const schedule = () => {
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(emit)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    schedule()

    return () => {
      observer.disconnect()
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      lastDimensionsRef.current = null
    }
  }, [container, fit, terminal])
}

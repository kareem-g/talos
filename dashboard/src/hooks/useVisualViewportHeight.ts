import { useEffect, useState } from 'react'

/**
 * Tracks the visual viewport height in pixels.
 *
 * The visual viewport is what the user can actually see: it shrinks when the
 * mobile software keyboard opens, when the browser URL bar collapses, and when
 * split-screen multitasking changes the window. `100vh`/`100dvh` alone do not
 * track all of those on every platform, so the mobile terminal locks its root
 * height to this value to guarantee the terminal, input bar, and command bar
 * are always exactly on screen (never cut off, never scrolled behind the
 * keyboard).
 */
export function useVisualViewportHeight(): number {
  const [height, setHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight)

  useEffect(() => {
    const update = () => setHeight(window.visualViewport?.height ?? window.innerHeight)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    update()
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return height
}

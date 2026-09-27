/**
 * Viewport class, as a hook.
 *
 * The shell decides layout from `min-width: 1024px` (AppShell). Leaf components
 * that need to differ — a control that belongs in the composer on desktop but in
 * the header on a phone — should ask the same question the same way, rather than
 * inventing a second breakpoint.
 */

import { useEffect, useState } from 'react'

const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia(DESKTOP_QUERY)
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    setIsDesktop(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}

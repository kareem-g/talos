import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query (e.g. `(min-width: 1024px)`).
 *
 * Used to decide which shell of the responsive root application to mount.
 * This is viewport-based (the same signal CSS media queries use) — never
 * user-agent sniffing — so the same URL serves desktop and mobile layouts.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

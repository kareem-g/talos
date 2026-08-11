import { useEffect, useState } from 'react'

/**
 * Pixel-grid loader adapted from Beautiful UI's "Loading State" (Drive/Dots/Orbit).
 * Runs a local elapsed timer and a shimmering label — used whenever a long-running
 * AI operation is in flight (starting a session, thinking, stopping an agent).
 */

const chevron = Array.from({ length: 9 }, (_, index) => {
  const r = Math.floor(index / 3)
  const c = index % 3
  return (c + Math.abs(r - 1)) * 90
})

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const orbit = Array.from({ length: 9 }, (_, index) => {
  const k = ORBIT_ORDER.indexOf(index)
  return k === -1 ? null : k * 110
})

type LoaderVariant = 'drive' | 'dots' | 'orbit'

const PATTERNS: Record<LoaderVariant, { delays: (number | null)[]; dur: number; round: boolean }> = {
  drive: { delays: chevron, dur: 650, round: false },
  dots: { delays: chevron, dur: 650, round: true },
  orbit: { delays: orbit, dur: 950, round: false },
}

function useElapsed() {
  const [ds, setDs] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setDs((value) => value + 1), 100)
    return () => clearInterval(timer)
  }, [])
  const total = ds / 10
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
}

export function Loader({
  label = 'Working',
  variant = 'drive',
  showElapsed = true,
}: {
  label?: string
  variant?: LoaderVariant
  showElapsed?: boolean
}) {
  const elapsed = useElapsed()
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.drive

  return (
    <div className="flex w-fit items-center gap-2.5" aria-live="polite" data-ai-anim>
      <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((delay, index) => (
          <span
            key={index}
            className={`size-[4px] bg-text ${round ? 'rounded-full' : 'rounded-[1px]'}`}
            style={{
              opacity: delay === null ? 0.07 : 0.15,
              animation: delay === null ? 'none' : `ai-pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span className="ai-shimmer-text text-[13px] font-medium">{label}</span>
      {showElapsed && <span className="font-mono text-[12px] tabular-nums text-text-dim">{elapsed}</span>}
    </div>
  )
}
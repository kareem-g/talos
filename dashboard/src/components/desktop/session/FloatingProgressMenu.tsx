/**
 * FloatingProgressMenu — the floating contexture menu over the timeline.
 *
 * Wraps `ProgressCard` as an absolutely-positioned overlay anchored to the
 * top-right of the transcript. The outer layer is pointer-transparent so the
 * timeline keeps scrolling; only the card itself is interactive. Its pin toggles
 * the list collapsed (progress card handles that), so it can sit as a slim pill
 * or the full checklist.
 */

import { ProgressCard } from './ProgressCard'
import type { Session } from '@/types/session'

export function FloatingProgressMenu({ session }: { session: Session }) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 w-[280px] max-w-[82%]">
      <div className="pointer-events-auto">
        <ProgressCard session={session} />
      </div>
    </div>
  )
}

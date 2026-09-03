/**
 * RoomAvatars — identity marks for rooms and their workers.
 *
 * Every worker gets a stable, name-derived hue and an initial tile; a room is
 * represented by a stack of its workers' tiles (its roster is its face). A
 * status ring on the worker tile carries live state: pulsing green while
 * working, orange while blocked on an approval, red on failure, dim when idle.
 */

import { cn } from '@/lib/format'
import type { PanelStatus } from '@/lib/rooms'

export type WorkerState = 'working' | 'done' | 'failed' | 'blocked' | 'idle'

const RING: Record<WorkerState, string> = {
  working: 'ring-emerald-400/80 animate-pulse',
  blocked: 'ring-orange-400',
  failed: 'ring-red-400',
  done: 'ring-zinc-500',
  idle: 'ring-zinc-700',
}

/** Stable hue (0–359) from a name, so identities survive reloads and syncs. */
export function nameHue(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

/** Map a run panel status onto the ring set. */
export function ringFor(status: PanelStatus | 'idle' | undefined): string {
  switch (status) {
    case 'working':
      return RING.working
    case 'blocked':
      return RING.blocked
    case 'failed':
      return RING.failed
    case 'done':
    case 'idle':
      return RING.done
    default:
      return RING.idle
  }
}

/** One worker's identity tile: initial on a name-hued ground, status ring. */
export function WorkerAvatar({
  name,
  status,
  size = 18,
  ring,
}: {
  name: string
  status?: PanelStatus | 'idle'
  size?: number
  ring?: boolean
}) {
  const hue = nameHue(name)
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        ring && 'ring-1',
        ring && status && ringFor(status),
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: `hsl(${hue} 42% 24%)`,
        color: `hsl(${hue} 75% 70%)`,
        fontSize: Math.max(8, Math.round(size * 0.45)),
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** A room's face: its workers' tiles overlapping, newest roster on top. When
 * `statuses` is given, each tile carries its live panel status ring — a run in
 * flight reads as a pulsing stack of who is working. */
export function RoomAvatarStack({
  names,
  size = 24,
  overlap = 7,
  max = 4,
  statuses,
}: {
  names: string[]
  size?: number
  overlap?: number
  max?: number
  /** Per-worker run status, keyed by exact roster name. */
  statuses?: Record<string, PanelStatus>
}) {
  const shown = names.slice(0, max)
  const overflow = names.length - shown.length
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((name, index) => (
        <span
          key={name}
          className="rounded-full ring-2 ring-[#0a0a0c]"
          style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: shown.length - index }}
        >
          <WorkerAvatar
            name={name}
            size={size}
            status={statuses?.[name]}
            ring={Boolean(statuses?.[name])}
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="flex items-center justify-center rounded-full bg-white/[0.07] font-mono text-[9px] text-zinc-500 ring-2 ring-[#0a0a0c]"
          style={{ width: size, height: size, marginLeft: -overlap }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  )
}

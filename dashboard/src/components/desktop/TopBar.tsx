/**
 * TopBar — the single 40px status row across the top of the workspace.
 *
 * Left:  identity (brand + project + branch) and the primary action (New Session).
 * Right: the live read-out — status pill, runtime timer, connection — and the
 *        settings affordance. Everything the user needs to orient themselves and
 *        see, at a glance, whether the agent is working.
 *
 * The runtime timer ticks only while the session is live (see `useNowTick`),
 * matching the per-session activity indicator — a stopped session does not keep
 * counting.
 */

import { PanelLeft, PanelRight, Settings } from 'lucide-react'
import { Button, IconButton, StatusPill } from '../ui'
import { cn } from '@/lib/format'
import type { UIState, UIStateDisplay } from '@/lib/sessionState'
import type { ConnectionState } from '@/types/protocol'
import type { Session } from '@/types/session'

export function TopBar({
  session,
  uiState,
  connection,
  runtime,
  onNewSession,
  onBack,
  onOpenSettings,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}: {
  session: Session
  uiState: UIState
  connection: ConnectionState
  runtime: string
  onNewSession: () => void
  onBack: () => void
  onOpenSettings?: () => void
  /** Sidebar visibility (collapsible sidebars). */
  leftOpen?: boolean
  rightOpen?: boolean
  onToggleLeft?: () => void
  onToggleRight?: () => void
}) {
  const display: UIStateDisplay = uiStateDisplay(uiState)

  const project = session.project
  const projectName = project ? (project.split('/').pop() ?? project) : null

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line/60 bg-canvas px-3">
      {/* ── Left: identity + primary action ─────────────────────────────── */}
      <IconButton label="Back to Mission Control" onClick={onBack} className="-ml-1 size-8">
        <ChevronLeft />
      </IconButton>
      <span className="h-5 w-px bg-line" aria-hidden />

      <span className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15">
          <span className="font-mono text-[11px] font-bold text-accent-ink">A</span>
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Plumb</span>
      </span>

      <Button variant="ghost" onClick={onNewSession} className="min-h-7 gap-1.5 px-2.5 text-[11.5px]">
        <PlusIcon /> New Session
      </Button>

      {projectName ? (
        <>
          <span className="h-4 w-px bg-line" aria-hidden />
          <span className="max-w-[200px] truncate font-mono text-[11.5px] text-ink-2" title={project ?? undefined}>
            {projectName}
          </span>
        </>
      ) : null}

      {session.branch ? (
        <span className="hidden items-center gap-1 rounded-chip bg-field px-1.5 font-mono text-[10.5px] text-ink-2 sm:inline-flex">
          <BranchIcon size={10} className="text-ink-3" />
          {session.branch}
        </span>
      ) : null}

      {/* Spacer pushes the rest to the right. */}
      <span className="min-w-0 flex-1" />

      {/* ── Right: sidebar toggles + live read-out ───────────────────────── */}
      {onToggleLeft ? (
        <IconButton
          label={leftOpen ? 'Hide left sidebar' : 'Show left sidebar'}
          onClick={onToggleLeft}
          className={cn('size-8', !leftOpen && 'text-ink-3')}
        >
          <PanelLeft size={15} strokeWidth={1.8} />
        </IconButton>
      ) : null}
      {onToggleRight ? (
        <IconButton
          label={rightOpen ? 'Hide right sidebar' : 'Show right sidebar'}
          onClick={onToggleRight}
          className={cn('size-8', !rightOpen && 'text-ink-3')}
        >
          <PanelRight size={15} strokeWidth={1.8} />
        </IconButton>
      ) : null}

      <StatusPill label={display.label} tone={display.tone} pulse={display.pulse} />
      <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-ink-3 sm:inline">{runtime}</span>

      <span
        role="status"
        title={connection === 'connected' ? 'Connected' : connection}
        className={cn(
          'size-2 shrink-0 rounded-full',
          connection === 'connected'
            ? 'bg-green'
            : connection === 'reconnecting' || connection === 'connecting'
              ? 'bg-orange breathe'
              : 'bg-red',
        )}
        aria-hidden
      />

      {onOpenSettings ? (
        <IconButton label="Settings" onClick={onOpenSettings} className="size-8">
          <Settings size={15} strokeWidth={1.8} />
        </IconButton>
      ) : null}
    </header>
  )
}

/** Map a UIState to its pill copy/tone. Kept local so TopBar is self-contained. */
function uiStateDisplay(uiState: UIState): UIStateDisplay {
  switch (uiState) {
    case 'reconnecting':
      return { label: 'Reconnecting', tone: 'orange', pulse: true }
    case 'offline':
      return { label: 'Offline', tone: 'red', pulse: false }
    case 'approval':
      return { label: 'Needs approval', tone: 'orange', pulse: false }
    case 'input':
      return { label: 'Waiting for you', tone: 'orange', pulse: false }
    case 'starting':
      return { label: 'Starting', tone: 'green', pulse: true }
    case 'working':
      return { label: 'Working', tone: 'green', pulse: true }
    case 'paused':
      return { label: 'Paused', tone: 'orange', pulse: false }
    case 'resuming':
      return { label: 'Resuming', tone: 'green', pulse: true }
    case 'failed':
      return { label: 'Failed', tone: 'red', pulse: false }
    case 'ended':
      return { label: 'Ended', tone: 'dim', pulse: false }
    case 'archived':
      return { label: 'Archived', tone: 'dim', pulse: false }
    case 'ready':
      return { label: 'Ready', tone: 'dim', pulse: false }
  }
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function BranchIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size ?? 14} height={size ?? 14} className={className} aria-hidden>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

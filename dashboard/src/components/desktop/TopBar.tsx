/**
 * TopBar — the 44px command row across the top of the workspace.
 *
 * Left:   back + breadcrumb (project › session › open file) — where you are.
 * Right:  primary action (New Session), live read-out (status + runtime +
 *         connection), and the panel toggles grouped as one segmented
 *         control. Everything orients at a glance: place, state, controls.
 *
 * The runtime timer ticks only while the session is live (see `useNowTick`),
 * matching the per-session activity indicator — a stopped session does not
 * keep counting.
 */

import { FileCode2, Folder, PanelLeft, PanelRight, Plus, Settings } from 'lucide-react'
import { IconButton, StatusPill } from '../ui'
import { useOpenFile } from '@/lib/fileViewer'
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
  const openFile = useOpenFile()

  const project = session.project
  const projectName = project ? (project.split('/').pop() ?? project) : null

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line/60 bg-inset/60 px-2.5 backdrop-blur">
      {/* ── Left: back + breadcrumb ─────────────────────────────────────── */}
      <IconButton label="Back to Mission Control" onClick={onBack} className="-ml-1 size-8">
        <ChevronLeft />
      </IconButton>

      <nav aria-label="Where you are" className="flex min-w-0 flex-1 items-center gap-1.5">
        {projectName ? (
          <span
            className="flex min-w-0 shrink-0 items-center gap-1.5 text-[12px] font-medium text-ink-2"
            title={project ?? undefined}
          >
            <Folder size={12} className="shrink-0 text-ink-3" />
            <span className="max-w-[140px] truncate">{projectName}</span>
          </span>
        ) : (
          <span className="shrink-0 text-[12px] font-medium text-ink-3">Inbox</span>
        )}
        <span aria-hidden className="shrink-0 text-[11px] text-ink-3/60">›</span>
        <span className="min-w-0 max-w-[220px] truncate text-[12.5px] font-semibold tracking-[-0.01em] text-ink" title={session.name}>
          {session.name}
        </span>
        {session.branch ? (
          <span className="hidden shrink-0 items-center gap-1 rounded-full border border-line/50 bg-surface/60 px-1.5 py-px font-mono text-[10px] text-ink-2 md:inline-flex" title={`Branch ${session.branch}`}>
            <BranchIcon size={9} className="text-ink-3" />
            <span className="max-w-[120px] truncate">{session.branch}</span>
          </span>
        ) : null}
        {openFile ? (
          <>
            <span aria-hidden className="hidden shrink-0 text-[11px] text-ink-3/60 sm:inline">›</span>
            <span
              className="hidden min-w-0 max-w-[200px] items-center gap-1 truncate font-mono text-[11px] text-accent-ink sm:flex"
              title={openFile.path}
            >
              <FileCode2 size={11} className="shrink-0" />
              <span className="truncate">{openFile.name}</span>
            </span>
          </>
        ) : null}
      </nav>

      {/* ── Right: action + live read-out + panels ──────────────────────── */}
      <button
        type="button"
        onClick={onNewSession}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[11.5px] font-semibold text-accent-ink transition hover:bg-accent-hover active:scale-[0.98]"
      >
        <Plus size={13} strokeWidth={2.4} />
        <span className="hidden sm:inline">New Session</span>
        <span className="sm:hidden">New</span>
      </button>

      <span className="h-5 w-px shrink-0 bg-line/70" aria-hidden />

      <span className="flex shrink-0 items-center gap-2">
        <StatusPill label={display.label} tone={display.tone} pulse={display.pulse} />
        <span className="hidden font-mono text-[10px] tabular-nums text-ink-3 lg:inline">{runtime}</span>
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
      </span>

      {onToggleLeft || onToggleRight ? (
        <>
          <span className="h-5 w-px shrink-0 bg-line/70" aria-hidden />
          <span
            role="group"
            aria-label="Side panels"
            className="flex shrink-0 items-center gap-px rounded-lg border border-line/60 bg-surface/50 p-0.5"
          >
            {onToggleLeft ? (
              <button
                type="button"
                onClick={onToggleLeft}
                title={leftOpen ? 'Hide left sidebar' : 'Show left sidebar'}
                aria-label={leftOpen ? 'Hide left sidebar' : 'Show left sidebar'}
                aria-pressed={leftOpen}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md transition-colors',
                  leftOpen ? 'bg-white/[0.09] text-ink' : 'text-ink-3 hover:bg-hover-2 hover:text-ink-2',
                )}
              >
                <PanelLeft size={13} strokeWidth={1.8} />
              </button>
            ) : null}
            {onToggleRight ? (
              <button
                type="button"
                onClick={onToggleRight}
                title={rightOpen ? 'Hide right panel' : 'Show right panel'}
                aria-label={rightOpen ? 'Hide right panel' : 'Show right panel'}
                aria-pressed={rightOpen}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md transition-colors',
                  rightOpen ? 'bg-white/[0.09] text-ink' : 'text-ink-3 hover:bg-hover-2 hover:text-ink-2',
                )}
              >
                <PanelRight size={13} strokeWidth={1.8} />
              </button>
            ) : null}
          </span>
        </>
      ) : null}

      {onOpenSettings ? (
        <IconButton label="Settings" onClick={onOpenSettings} className="size-7">
          <Settings size={14} strokeWidth={1.8} />
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

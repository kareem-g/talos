/**
 * App shell — one control station, two surfaces.
 *
 * Desktop: a HomeSidebar beside the home page; a session opens into the
 * two-pane workspace. Mobile: same content under a header and a home page
 * that fills the screen — there are no sub-screens anymore, every section
 * lives on the home page.
 *
 * The redesign rule this shell enforces: the *home screen* is a control
 * station (what's running, what needs me), not a file manager for sessions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PairingScreen } from './components/Pairing'
import { StationHome } from './components/home/StationHome'
import { HomeSidebar } from './components/home/HomeSidebar'
import { AddToHomeButton } from './components/home/AddToHomeButton'
import { SessionView } from './components/SessionView'
import { SessionWorkspace } from './components/desktop/SessionWorkspace'
import { Dot } from './components/ui'
import LoadingState from './components/LoadingState'
import { useRoute } from './lib/route'
import { roomOpenApproval, useRooms } from './lib/rooms'
import { getConversation, useStore } from './store'
import { sessionUIState } from './lib/sessionState'
import { ensureSessionLoaded } from './lib/rooms'
import { cn } from './lib/format'
import { notifyOnBackground } from './lib/notify'
import { socket } from './lib/socket'
import type { ConnectionState } from '@/types/protocol'

/** Matches Tailwind's `lg` breakpoint. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const onChange = (queryEvent: MediaQueryListEvent) => setIsDesktop(queryEvent.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15">
        <span className="font-mono text-[12px] font-bold text-accent-ink">A</span>
      </span>
      {compact ? null : (
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Plumb</span>
      )}
    </span>
  )
}

/**
 * Connection indicator. Every state is named; `reconnecting` stays distinct
 * from `connecting` because during a reconnect the UI still shows its state.
 */
function ConnectionPill({ state }: { state: ConnectionState }) {
  const labels: Record<ConnectionState, string> = {
    idle: 'Offline',
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
    offline: 'Offline',
    unauthorized: 'Not paired',
    error: 'Connection error',
  }
  const tone =
    state === 'connected' ? 'green' : state === 'connecting' || state === 'reconnecting' ? 'orange' : 'red'
  const pulse = state === 'connecting' || state === 'reconnecting'
  return (
    <span
      role="status"
      title={labels[state]}
      className="inline-flex items-center gap-1.5 rounded-full border border-line/50 bg-surface/80 px-2.5 py-1 text-[11px] text-ink-2"
    >
      <Dot tone={tone} pulse={pulse} />
      {labels[state]}
    </span>
  )
}

/** Floating cue when any agent is blocked on you — the station's pager. */
function AttentionPill({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)
  // Transcript streams mutate conversations in place — subscribe so room card
  // scans below recompute as approvals arrive and resolve.
  const revisions = useStore((state) => state.revisions)
  const rooms = useRooms()
  // Derive outside the selector: `.filter` in a zustand v5 selector returns a
  // fresh array every call, which useSyncExternalStore reads as "changed" on
  // every render — an infinite update loop. Selecting the stable `sessions`
  // reference and filtering here renders exactly once per real change.
  // Include transcript-level approvals: a session can hold a permission card
  // while status is still `running`.
  const blocked = useMemo(
    () =>
      sessions.filter((session) => {
        const uiState = sessionUIState(session, getConversation(session.id), connection)
        return uiState === 'approval' || uiState === 'input' || uiState === 'failed'
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, revisions],
  )
  // Room channels and workers never appear in the workspace lists, so their
  // approval cards are unreachable through `blocked` — page them by room.
  const roomNeeds = useMemo(
    () =>
      rooms
        .map((room) => ({ room, approval: roomOpenApproval(room) }))
        .filter((entry): entry is { room: (typeof rooms)[number]; approval: { sessionId: string; requestId: string } } =>
          entry.approval !== null,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, revisions],
  )
  if (blocked.length === 0 && roomNeeds.length === 0) return null
  const label =
    blocked.length === 1
      ? blocked[0].name
      : blocked.length > 1
        ? `${blocked.length} agents need you`
        : roomNeeds.length === 1
          ? `${roomNeeds[0].room.name} needs review`
          : `${roomNeeds.length} rooms need review`
  const target = blocked.length > 0 ? blocked[0].id : roomNeeds[0].approval.sessionId
  return (
    <button
      type="button"
      onClick={() => onOpen(target)}
      className={cn(
        'animate-up fixed bottom-20 left-1/2 z-30 max-w-[calc(100vw-2rem)] -translate-x-1/2 lg:bottom-5 lg:left-auto lg:right-5 lg:translate-x-0 lg:max-w-none',
        'inline-flex min-h-12 items-center gap-2.5 rounded-full bg-surface border border-line px-5 py-2.5',
        'text-[13px] font-semibold text-ink shadow-overlay backdrop-blur-xl',
        'transition-transform duration-150 active:scale-[0.97]',
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-accent breathe" aria-hidden />
      <span className="min-w-0 max-w-40 truncate sm:max-w-56">{label}</span>
      <span className="hidden shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] opacity-60 sm:inline">
        Tap to open
      </span>
    </button>
  )
}

export default function App() {
  const { route, navigate, replace } = useRoute()
  const start = useStore((state) => state.start)
  const connection = useStore((state) => state.connection)
  const sessions = useStore((state) => state.sessions)
  const sessionsLoading = useStore((state) => state.sessionsLoading)
  const isDesktop = useIsDesktop()
  const [homeSearch, setHomeSearch] = useState('')
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [homeNewTaskTick, setHomeNewTaskTick] = useState(0)

  useEffect(() => {
    function onPaletteKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowCommandPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onPaletteKey)
    return () => window.removeEventListener('keydown', onPaletteKey)
  }, [])

  useEffect(() => {
    if (route.name === 'pair') return
    start()
  }, [start, route.name])

  /** System alerts while backgrounded: approvals and completions page you. */
  useEffect(() => {
    return socket.onFrame((frame) => {
      const nameFor = (sessionId: string) =>
        useStore.getState().sessions.find((session) => session.id === sessionId)?.name ?? 'A session'
      if (frame.type === 'ApprovalRequest') {
        notifyOnBackground('Approval needed', frame.payload.request.prompt.slice(0, 120))
      } else if (frame.type === 'StateChange') {
        if (frame.payload.state === 'waiting_for_approval') {
          notifyOnBackground('Approval needed', nameFor(frame.payload.session_id))
        } else if (frame.payload.state === 'completed') {
          notifyOnBackground('Task finished', nameFor(frame.payload.session_id))
        }
      }
    })
  }, [])

  // Global keyboard shortcut: Cmd/Ctrl+N starts a session from anywhere.
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        const state = useStore.getState()
        const prov = state.providers.find((p) => p.state === 'ready') ?? state.providers[0]
        if (!prov) return
        void state.createSession({ agent: prov.id }).then((s) =>
          navigate({ name: 'session', sessionId: s.id }),
        )
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [navigate])

  // Route → home: opening a session from anywhere lands on its view.
  const openSessionFrom = useCallback(
    (sessionId: string) => navigate({ name: 'session', sessionId }),
    [navigate],
  )

  const selectedId = route.name === 'session' ? route.sessionId : undefined
  // Look the session up live so updates re-render with fresh data.
  const selected = sessions.find((session) => session.id === selectedId)
  // True while we try to resolve a route naming a session the list doesn't
  // know (room channels and workers are `hidden`, so a deep link or reload
  // needs a one-off fetch before it can open — never bounce straight home).
  const [resolvingHidden, setResolvingHidden] = useState(false)

  // A URL naming a missing session must not blank-screen or bounce to home:
  // first try loading it directly (it may be a hidden room/worker session),
  // and only redirect when the id genuinely no longer exists.
  useEffect(() => {
    if (!selectedId || selected) return
    if (sessionsLoading) return
    let cancelled = false
    setResolvingHidden(true)
    void ensureSessionLoaded(selectedId).then((loaded) => {
      if (cancelled) return
      setResolvingHidden(false)
      if (!loaded) replace({ name: 'list' })
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, selected, sessionsLoading, replace])

  /* ── Pairing takeover ──────────────────────────────────────────────────── */
  if (route.name === 'pair') {
    return (
      <PairingScreen
        offerId={route.offerId}
        secret={route.secret}
        onPaired={() => replace({ name: 'list' })}
      />
    )
  }

  /* ── Session screens ───────────────────────────────────────────────────── */
  if (route.name === 'session' && selected) {
    if (!isDesktop) {
      return (
        <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
          <SessionView
            key={selected.id}
            session={selected}
            onBack={() => navigate({ name: 'list' })}
          />
        </div>
      )
    }
    return (
      // A session is a full-screen takeover: no shell chrome, the whole
      // viewport is the workspace. Switching sessions happens inside its own
      // left rail, not by leaving to the dashboard.
      <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
        <SessionWorkspace
          key={selected.id}
          session={selected}
          onBack={() => navigate({ name: 'list' })}
          onOpenSession={(id) => navigate({ name: 'session', sessionId: id })}
        />
      </div>
    )
  }
  if (route.name === 'session' && sessionsLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <LoadingState label="Opening session" variant="Drive" />
      </div>
    )
    // A stale id falls through to the shell while the effect redirects.
  }
  if (route.name === 'session' && resolvingHidden && !selected) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <LoadingState label="Opening session" variant="Drive" />
      </div>
    )
  }

  /* ── Home shell ──────────────────────────────────────────────────────────
   *  One page, two shapes. Desktop: a sidebar beside the home. Mobile: a
   *  compact top bar (brand + connection pill) above the home. The home
   *  itself owns the Sessions / Pair / Automations / Skills / Settings
   *  sections via the anchor strip. */
  const homeProps = {
    onOpenSession: (session: { id: string }) => openSessionFrom(session.id),
    searchQuery: homeSearch,
    onSearchQueryChange: setHomeSearch,
    newTaskTick: homeNewTaskTick,
  } as const

  if (isDesktop) {
    return (
      <div className="home-scope flex h-dvh overflow-hidden bg-canvas text-ink">
        <HomeSidebar
          onNewTask={() => setHomeNewTaskTick((x) => x + 1)}
          onSearch={() => setShowCommandPalette(true)}
          onSelectSession={(id) => navigate({ name: 'session', sessionId: id })}
          selectedId={selectedId}
          searchQuery={homeSearch}
        />
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          <StationHome {...homeProps} />
        </main>
        <AttentionPill onOpen={openSessionFrom} />
        {showCommandPalette ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh] backdrop-blur-sm" onClick={() => setShowCommandPalette(false)}>
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-hover-2 p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <input autoFocus placeholder="Search sessions, projects, agents…" value={homeSearch} onChange={(e) => setHomeSearch(e.target.value)} className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-zinc-500" />
              <p className="px-2 py-1 text-[11px] text-zinc-500">Type to filter • Esc to close</p>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="home-scope flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <header
        className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <BrandMark compact />
        <div className="flex items-center gap-1.5">
          <AddToHomeButton />
          <ConnectionPill state={connection} />
        </div>
      </header>

      {route.name === 'session' && !selected && sessionsLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingState label="Opening session" variant="Drive" />
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          <StationHome {...homeProps} />
        </main>
      )}

      <HomeSidebar
        onNewTask={() => setHomeNewTaskTick((value) => value + 1)}
        onSearch={() => setShowCommandPalette(true)}
        onSelectSession={(id) => navigate({ name: 'session', sessionId: id })}
        selectedId={selectedId}
        searchQuery={homeSearch}
      />

      <AttentionPill onOpen={openSessionFrom} />

      {showCommandPalette ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm" onClick={() => setShowCommandPalette(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-hover-2 p-2 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <input autoFocus type="search" placeholder="Search sessions, projects, agents..." value={homeSearch} onChange={(event) => setHomeSearch(event.target.value)} className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-zinc-500" />
            <p className="px-2 py-1 text-[11px] text-zinc-500">Type to filter. Press Esc to close.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * App shell — one control station, three surfaces.
 *
 * Desktop: a slim icon rail (Sessions · Remote · Settings) beside full-height
 * screens; a session opens into the two-pane workspace. Mobile: same screens
 * under a bottom tab bar, with a session taking over the whole screen and the
 * bar hidden — thumb reach beats navigation chrome there.
 *
 * The redesign rule this shell enforces: the *home screen* is a control
 * station (what's running, what needs me), not a file manager for sessions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe2, LayoutGrid, Settings2, Sparkles, Workflow } from 'lucide-react'
import { PairingScreen } from './components/Pairing'
import { StationHome } from './components/home/StationHome'
import { HomeSidebar } from './components/home/HomeSidebar'
import { AutomationsScreen } from './components/automations/AutomationsScreen'
import { SkillsScreen } from './components/skills/SkillsScreen'
import { RemoteScreen } from './components/remote/RemoteScreen'
import { SettingsScreen } from './components/settings/SettingsScreen'
import { SessionView } from './components/SessionView'
import { SessionWorkspace } from './components/desktop/SessionWorkspace'
import { Dot, IconButton } from './components/ui'
import LoadingState from './components/LoadingState'
import { useRoute } from './lib/route'
import { getConversation, useStore } from './store'
import { sessionUIState } from './lib/sessionState'
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

type Screen = 'home' | 'automations' | 'skills' | 'remote' | 'settings'

const SCREENS: Array<{ id: Screen; label: string; icon: typeof LayoutGrid }> = [
  { id: 'home', label: 'Sessions', icon: LayoutGrid },
  { id: 'automations', label: 'Automations', icon: Workflow },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'remote', label: 'Remote', icon: Globe2 },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15">
        <span className="font-mono text-[12px] font-bold text-accent-ink">A</span>
      </span>
      {compact ? null : (
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">AgentDeck</span>
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
    [sessions, connection],
  )
  if (blocked.length === 0) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(blocked[0].id)}
      className={cn(
        'animate-up fixed bottom-20 left-1/2 z-30 max-w-[calc(100vw-2rem)] -translate-x-1/2 lg:bottom-5 lg:left-auto lg:right-5 lg:translate-x-0 lg:max-w-none',
        'inline-flex min-h-12 items-center gap-2.5 rounded-full bg-surface border border-line px-5 py-2.5',
        'text-[13px] font-semibold text-ink shadow-overlay backdrop-blur-xl',
        'transition-transform duration-150 active:scale-[0.97]',
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-accent breathe" aria-hidden />
      <span className="min-w-0 max-w-40 truncate sm:max-w-56">
        {blocked.length === 1 ? blocked[0].name : `${blocked.length} agents need you`}
      </span>
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
  const [screen, setScreen] = useState<Screen>('home')
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

  // Route → screen sync: opening a session from anywhere lands on its view.
  const openSessionFrom = useCallback(
    (sessionId: string) => navigate({ name: 'session', sessionId }),
    [navigate],
  )

  const selectedId = route.name === 'session' ? route.sessionId : undefined
  // Look the session up live so updates re-render with fresh data.
  const selected = sessions.find((session) => session.id === selectedId)

  // A URL naming a missing session must not blank-screen; wait for first load.
  useEffect(() => {
    if (selectedId && !selected && !sessionsLoading && sessions.length > 0) {
      replace({ name: 'list' })
    }
  }, [selectedId, selected, sessionsLoading, sessions.length, replace])

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

  /* ── Screens shell ─────────────────────────────────────────────────────── */
  const body =
    screen === 'automations' ? (
      <AutomationsScreen />
    ) : screen === 'skills' ? (
      <SkillsScreen />
    ) : screen === 'remote' ? (
      <RemoteScreen />
    ) : screen === 'settings' ? (
      <SettingsScreen />
    ) : (
      <StationHome
        onOpenSession={(session) => openSessionFrom(session.id)}
        searchQuery={homeSearch}
        onSearchQueryChange={setHomeSearch}
        newTaskTick={homeNewTaskTick}
      />
    )

  if (isDesktop) {
    if (screen === 'home') {
      return (
        <div className="home-scope flex h-dvh overflow-hidden bg-canvas text-ink">
          <HomeSidebar
            onNewTask={() => setHomeNewTaskTick((x) => x + 1)}
            onSearch={() => setShowCommandPalette(true)}
            onSelectSession={(id) => navigate({ name: 'session', sessionId: id })}
            onNavigate={setScreen}
            selectedId={selectedId}
            searchQuery={homeSearch}
          />
          <main className="flex min-w-0 flex-1 flex-col bg-[#0f0f10]">{body}</main>
          <AttentionPill onOpen={openSessionFrom} />
          {showCommandPalette ? (
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh] backdrop-blur-sm" onClick={() => setShowCommandPalette(false)}>
              <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1a1a1c] p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <input autoFocus placeholder="Search sessions, projects, agents…" value={homeSearch} onChange={(e) => setHomeSearch(e.target.value)} className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-zinc-500" />
                <p className="px-2 py-1 text-[11px] text-zinc-500">Type to filter • Esc to close</p>
              </div>
            </div>
          ) : null}
        </div>
      )
    }
    return (
      <div className="home-scope flex h-dvh overflow-hidden bg-canvas text-ink">
        <Rail screen={screen} onScreen={setScreen} connection={connection} />
        <main className="flex min-w-0 flex-1 flex-col">{body}</main>
        <AttentionPill onOpen={openSessionFrom} />
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
        <ConnectionPill state={connection} />
      </header>

      {route.name === 'session' && !selected && sessionsLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingState label="Opening session" variant="Drive" />
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">{body}</main>
      )}

      {screen === 'home' ? (
        <HomeSidebar
          onNewTask={() => setHomeNewTaskTick((value) => value + 1)}
          onSearch={() => setShowCommandPalette(true)}
          onSelectSession={(id) => navigate({ name: 'session', sessionId: id })}
          onNavigate={setScreen}
          selectedId={selectedId}
          searchQuery={homeSearch}
        />
      ) : null}

      <AttentionPill onOpen={openSessionFrom} />

      {showCommandPalette ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm" onClick={() => setShowCommandPalette(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1a1a1c] p-2 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <input autoFocus type="search" placeholder="Search sessions, projects, agents..." value={homeSearch} onChange={(event) => setHomeSearch(event.target.value)} className="w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-zinc-500" />
            <p className="px-2 py-1 text-[11px] text-zinc-500">Type to filter. Press Esc to close.</p>
          </div>
        </div>
      ) : null}

      {/* Bottom tab bar */}
      <nav
        aria-label="Main"
        className="z-30 flex shrink-0 items-stretch border-t border-line/60 bg-canvas/95 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {SCREENS.map((entry) => {
          const Glyph = entry.icon
          const active = screen === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setScreen(entry.id)}
              className={cn(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-100',
                active ? 'text-accent-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <Glyph size={22} strokeWidth={1.8} />
              <span className="text-[10px] font-medium">{entry.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/** Desktop icon rail — brand up top, screens mid, connection low. */
function Rail({
  screen,
  onScreen,
  connection,
}: {
  screen: Screen
  onScreen: (screen: Screen) => void
  connection: ConnectionState
}) {
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line/60 bg-canvas py-3">
      <button
        type="button"
        aria-label="Sessions"
        onClick={() => onScreen('home')}
        className="mb-3 transition-transform duration-150 hover:scale-105 active:scale-95"
      >
        <BrandMark compact />
      </button>

      <div className="flex flex-1 flex-col items-center gap-1">
        {SCREENS.map((entry) => {
          const Glyph = entry.icon
          const active = screen === entry.id
          return (
            <IconButton
              key={entry.id}
              label={entry.label}
              onClick={() => onScreen(entry.id)}
              tone={active ? 'accent' : 'ghost'}
              className={cn(active && 'glow-accent')}
            >
              <Glyph size={22} strokeWidth={1.8} />
            </IconButton>
          )
        })}
      </div>

      {/* Compact connection dot — the pill overflows the 56px rail */}
      <span
        role="status"
        title={
          (
            {
              idle: 'Offline',
              connecting: 'Connecting',
              connected: 'Connected',
              reconnecting: 'Reconnecting',
              disconnected: 'Disconnected',
              offline: 'Offline',
              unauthorized: 'Not paired',
              error: 'Connection error',
            } as const
          )[connection]
        }
        className="flex size-7 items-center justify-center rounded-full bg-surface border border-line/40"
      >
        <Dot
          tone={
            connection === 'connected'
              ? 'green'
              : connection === 'connecting' || connection === 'reconnecting'
                ? 'orange'
                : 'red'
          }
          pulse={connection === 'connecting' || connection === 'reconnecting'}
        />
      </span>
    </aside>
  )
}

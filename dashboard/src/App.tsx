/**
 * App shell — desktop two-screen architecture.
 *
 * Mobile: list *or* session (dvh, single tree). Desktop: Screen 1 (Management)
 * with 240–280px sidebar + sessions dashboard, Screen 2 (Session Workspace)
 * with collapsible 260–320 left, flexible center, 280–360 right.
 * `route` drives Screen 1 → Screen 2; back preserves filters via localStorage.
 */

import { useEffect, useState } from 'react'
import { PairButton, PairDeviceLayerContent, PairingScreen } from './components/Pairing'
import { SessionList } from './components/SessionList'
import { SessionView } from './components/SessionView'
import { Dot, Dots, EmptyState, Layer } from './components/ui'
import { ManagementSidebar } from './components/desktop/ManagementSidebar'
import { SessionsDashboard } from './components/desktop/SessionsDashboard'
import { SessionWorkspace } from './components/desktop/SessionWorkspace'
import { useRoute } from './lib/route'
import { useStore } from './store'
import { cn } from './lib/format'
import type { ConnectionState } from './types/protocol'

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

type ManagementNav = 'sessions' | 'settings' | 'help'

/**
 * Connection indicator. Every state is named, and `reconnecting` is distinct
 * from `connecting`: during a reconnect the UI keeps its state, so calling it
 * "Connecting" would misrepresent what is happening.
 */
function ConnectionPill({ state, compact }: { state: ConnectionState; compact?: boolean }) {
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
    state === 'connected'
      ? 'green'
      : state === 'connecting' || state === 'reconnecting'
        ? 'orange'
        : 'red'
  const pulse = state === 'connecting' || state === 'reconnecting'

  if (compact) {
    // Collapsed sidebar: the dot alone, with the state in its tooltip.
    return (
      <span role="status" title={labels[state]} className="flex items-center justify-center py-1">
        <Dot tone={tone} pulse={pulse} />
      </span>
    )
  }

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-chip bg-surface px-2 py-1',
        'text-[11px] text-ink-2 shadow-btn',
      )}
    >
      <Dot tone={tone} pulse={pulse} />
      {labels[state]}
    </span>
  )
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-accent-tint">
        <span className="font-mono text-[11px] font-medium text-accent-ink">A</span>
      </span>
      {compact ? null : (
        <span className="text-[13px] font-medium tracking-[-0.01em] text-ink">AgentDeck</span>
      )}
    </span>
  )
}

export default function App() {
  const { route, navigate, replace } = useRoute()
  const start = useStore((state) => state.start)
  const connection = useStore((state) => state.connection)
  const sessions = useStore((state) => state.sessions)
  const sessionsLoading = useStore((state) => state.sessionsLoading)
  const isDesktop = useIsDesktop()
  const [managementNav, setManagementNav] = useState<ManagementNav>('sessions')
  const [pairing, setPairing] = useState(false)

  useEffect(() => {
    if (route.name === 'pair') return
    start()
  }, [start, route.name])

  // Desktop global keyboard shortcuts: Cmd/Ctrl+N new session (works on both screens)
  useEffect(() => {
    if (!isDesktop) return
    function onGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        const state = useStore.getState()
        const prov = state.providers.find((p) => p.state === 'ready') ?? state.providers[0]
        if (!prov) return
        void state.createSession({ agent: prov.id, name: 'New Session' }).then((s) => navigate({ name: 'session', sessionId: s.id }))
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [isDesktop, navigate])

  const selectedId = route.name === 'session' ? route.sessionId : undefined
  // Look the session up by id every render, so a live update re-renders with
  // fresh data rather than a copy captured at click time.
  const selected = sessions.find((session) => session.id === selectedId)

  // A URL naming a session that does not exist (deleted, or a stale bookmark)
  // must not leave a blank screen. Wait for the first load before deciding.
  useEffect(() => {
    if (selectedId && !selected && !sessionsLoading && sessions.length > 0) {
      replace({ name: 'list' })
    }
  }, [selectedId, selected, sessionsLoading, sessions.length, replace])

  if (route.name === 'pair') {
    return (
      <PairingScreen
        offerId={route.offerId}
        secret={route.secret}
        onPaired={() => {
          // Clear the credentials from the URL so they are not left in history.
          replace({ name: 'list' })
        }}
      />
    )
  }

  const pairLayer = (
    <Layer open={pairing} onClose={() => setPairing(false)} title="Pair a device" size="sm">
      <PairDeviceLayerContent />
    </Layer>
  )

  if (isDesktop) {
    // Screen 2 — Session Workspace (collapsible left 260–320, center flexible, right 280–360)
    if (route.name === 'session') {
      if (selected) {
        return (
          <>
            <SessionWorkspace key={selected.id} session={selected} onBack={() => navigate({ name: 'list' })} />
            {pairLayer}
          </>
        )
      }
      if (sessionsLoading) {
        return (
          <div className="flex h-dvh items-center justify-center bg-canvas">
            <Dots label="Opening session…" />
          </div>
        )
      }
      // stale id handled by effect -> list, but show fallback while redirecting
      return (
        <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
          <ManagementSidebar active={managementNav} onNavigate={setManagementNav} onPair={() => setPairing(true)} />
          <div className="flex flex-1 items-center justify-center">
            <EmptyState title="Session not found" description="It may have been deleted." />
          </div>
          {pairLayer}
        </div>
      )
    }

    // Screen 1 — Sessions & App Management (sidebar 240–280 + dashboard)
    return (
      <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
        <ManagementSidebar active={managementNav} onNavigate={setManagementNav} onPair={() => setPairing(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* subtle connection bar */}
          <div className="flex h-6 shrink-0 items-center justify-end gap-2 border-b border-line bg-inset px-6">
            <ConnectionPill state={connection} />
          </div>
          {managementNav === 'sessions' ? (
            <SessionsDashboard />
          ) : managementNav === 'settings' ? (
            <div className="flex flex-1 flex-col bg-inset p-6">
              <h2 className="text-[15px] font-medium text-ink">Settings</h2>
              <p className="mt-2 max-w-[640px] text-[13px] leading-[1.6] text-ink-3">
                App settings, provider configuration, and workspace preferences. Provider and model management is available via the sessions dashboard. Full settings UI is coming soon.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPairing(true)}
                  className="rounded-control border border-line bg-surface px-3 py-2 text-[12.5px] text-ink hover:bg-hover"
                >
                  Pair a phone
                </button>
                <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-3">
                  {sessions.length} sessions
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col bg-inset p-6">
              <h2 className="text-[15px] font-medium text-ink">Help</h2>
              <p className="mt-2 max-w-[640px] text-[13px] leading-[1.6] text-ink-3">
                AgentDeck runs coding agents on this machine. Create a session, watch the agent stream tool calls and terminal output, and approve actions when prompted. Use the command palette or keyboard shortcuts for quick navigation.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">
                <li>
                  <span className="font-mono text-[11px] bg-field rounded px-1.5 py-0.5">Cmd+N</span> New session
                </li>
                <li>
                  <span className="font-mono text-[11px] bg-field rounded px-1.5 py-0.5">Cmd+K</span> Focus search
                </li>
                <li>
                  <span className="font-mono text-[11px] bg-field rounded px-1.5 py-0.5">Esc</span> Close panel / back
                </li>
              </ul>
            </div>
          )}
        </div>
        {pairLayer}
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      {selected ? (
        <SessionView
          key={selected.id}
          session={selected}
          onBack={() => navigate({ name: 'list' })}
        />
      ) : selectedId && sessionsLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Dots label="Opening session…" />
        </div>
      ) : (
        <>
          <header
            className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5"
            style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}
          >
            <Brand />
            <span className="flex items-center gap-1.5">
              <ConnectionPill state={connection} />
              <PairButton onOpen={() => setPairing(true)} />
            </span>
          </header>
          <SessionList
            selectedId={selectedId}
            onSelect={(session) => navigate({ name: 'session', sessionId: session.id })}
          />
        </>
      )}
      {pairLayer}
    </div>
  )
}

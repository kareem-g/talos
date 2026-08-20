/**
 * App shell.
 *
 * One component tree, two layouts. Mobile shows the list *or* a session; desktop
 * shows both, with a collapsible sidebar. Both render the same `SessionList` and
 * `SessionView` — layout and navigation are the only difference, which is the
 * point: logic is not duplicated per form factor.
 *
 * `dvh` throughout, so mobile browser chrome and the software keyboard cannot
 * push the composer off-screen.
 */

import { useEffect, useState } from 'react'
import { PairButton, PairDeviceLayerContent, PairingScreen } from './components/Pairing'
import { SessionList } from './components/SessionList'
import { SessionView } from './components/SessionView'
import { ChevronLeft, Dot, Dots, EmptyState, IconButton, Layer } from './components/ui'
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

const SIDEBAR_KEY = 'agentdeck-sidebar-collapsed'

/** Sidebar collapse state, persisted so it survives a reload. */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCollapsed((previous) => {
      const next = !previous
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
      } catch {
        // Non-fatal: the preference just will not persist.
      }
      return next
    })
  }
  return [collapsed, toggle]
}

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
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const [pairing, setPairing] = useState(false)

  useEffect(() => {
    if (route.name === 'pair') return
    start()
  }, [start, route.name])

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
    return (
      <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-line bg-canvas',
            'transition-[width] duration-200',
            collapsed ? 'w-14' : 'w-78',
          )}
        >
          <header
            className={cn(
              'flex shrink-0 items-center gap-2 py-2.5',
              collapsed ? 'flex-col px-2' : 'justify-between px-3',
            )}
          >
            <Brand compact={collapsed} />
            <span className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
              {collapsed ? null : <PairButton onOpen={() => setPairing(true)} />}
              <IconButton
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={toggleCollapsed}
              >
                <ChevronLeft
                  size={15}
                  className="transition-transform duration-200"
                  style={collapsed ? { transform: 'rotate(180deg)' } : undefined}
                />
              </IconButton>
            </span>
          </header>

          {collapsed ? (
            <>
              <ConnectionPill state={connection} compact />
              {/* Collapsed, the sidebar is a rail: the list is unreadable at
                  56px, so it is replaced by an affordance to expand. */}
              <button
                type="button"
                onClick={toggleCollapsed}
                title={`${sessions.length} sessions`}
                className="mx-2 mt-2 flex flex-col items-center gap-0.5 rounded-control py-2 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
              >
                <span className="text-[13px] font-medium tabular-nums">{sessions.length}</span>
                <span className="text-[9px] uppercase tracking-wide">open</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-3 pb-2.5">
                <ConnectionPill state={connection} />
              </div>
              <SessionList
                selectedId={selectedId}
                onSelect={(session) => navigate({ name: 'session', sessionId: session.id })}
              />
            </>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <SessionView key={selected.id} session={selected} />
          ) : selectedId && sessionsLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Dots label="Opening session…" />
            </div>
          ) : (
            <EmptyState
              title="Select a session"
              description="Agents run on this machine. Pick a session to watch it work, or start a new one."
            />
          )}
        </main>

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

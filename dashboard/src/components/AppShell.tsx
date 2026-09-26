/**
 * AppShell — the redesigned app: ONE unified screen on desktop, two on mobile.
 *
 * Desktop is a three-pane grid — AppNav rail / center pane / tool panel —
 * where the center pane is either a session's chat or a nav destination
 * (Home, Agents, Browsers, History, Usage, Configuration). The session id
 * lives in the URL, so a session is bookmarkable and back/forward works;
 * nav destinations are shell state and keep the URL clean.
 *
 * Mobile gets two screens: the dashboard (top bar + drawer nav over
 * StationHome) and the chat screen (SessionView pushes over it).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import LoadingState from './LoadingState'
import { AppNav, type NavPage } from './AppNav'
import { SessionChat } from './SessionChat'
import { RightRail, type RightRailHandle } from './desktop/session/RightRail'
import { SessionView } from './SessionView'
import { StationHome } from './home/StationHome'
import { SettingsSection } from './home/SettingsSection'
import { AgentsPage } from './views/AgentsPage'
import { BrowsersPage } from './views/BrowsersPage'
import { HistoryPage } from './views/HistoryPage'
import { UsagePage } from './views/UsagePage'
import { ensureSessionLoaded } from '@/lib/rooms'
import { useStore } from '@/store'
import type { Route } from '@/lib/route'
import type { Session } from '@/types/session'

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

export function AppShell({
  route,
  navigate,
  replace,
}: {
  route: Route
  navigate: (route: Route) => void
  replace: (route: Route) => void
}) {
  const sessions = useStore((state) => state.sessions)
  const sessionsLoading = useStore((state) => state.sessionsLoading)
  const isDesktop = useIsDesktop()

  const [page, setPage] = useState<NavPage>('home')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem('agentdeck-panel-open') !== 'false'
    } catch {
      return true
    }
  })
  const rightRailRef = useRef<RightRailHandle>(null)

  const sessionRoute = route.name === 'session' ? route.sessionId : undefined
  const selected = sessions.find((session) => session.id === sessionRoute)
  const inSession = Boolean(sessionRoute && selected)

  /* ── Route sync ────────────────────────────────────────────────────────
   * A URL naming a session the list doesn't know (a hidden room/worker
   * channel) must not blank-screen: try loading it once before falling
   * back to the dashboard. */
  const [resolvingHidden, setResolvingHidden] = useState(false)
  useEffect(() => {
    if (!sessionRoute || selected || sessionsLoading) return
    let cancelled = false
    setResolvingHidden(true)
    void ensureSessionLoaded(sessionRoute).then((loaded) => {
      if (cancelled) return
      setResolvingHidden(false)
      if (!loaded) replace({ name: 'list' })
    })
    return () => {
      cancelled = true
    }
  }, [sessionRoute, selected, sessionsLoading, replace])

  const openSession = useCallback(
    (sessionId: string) => {
      setPage('home') // back from a session always returns to the dashboard
      setDrawerOpen(false)
      navigate({ name: 'session', sessionId })
    },
    [navigate],
  )

  const exitSession = useCallback(() => {
    setPage('home')
    replace({ name: 'list' })
  }, [replace])

  const goPage = useCallback(
    (next: NavPage) => {
      setPage(next)
      setDrawerOpen(false)
      if (route.name !== 'list') replace({ name: 'list' })
    },
    [route.name, replace],
  )

  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      const next = !open
      try {
        localStorage.setItem('agentdeck-panel-open', String(next))
      } catch {
        /* noop */
      }
      return next
    })
  }, [])

  /** The rail's "+ New task": first ready provider, then straight into it. */
  const newTask = useCallback(() => {
    const state = useStore.getState()
    const provider = state.providers.find((candidate) => candidate.state === 'ready') ?? state.providers[0]
    if (!provider) return
    void state.createSession({ agent: provider.id }).then((session) => {
      setPage('home')
      navigate({ name: 'session', sessionId: session.id })
    })
  }, [navigate])

  /* ── Center pane content ─────────────────────────────────────────────── */
  const center = inSession && selected ? (
    <SessionChat
      key={selected.id}
      session={selected}
      onOpenSession={openSession}
      onExitSession={exitSession}
      panelOpen={panelOpen}
      onTogglePanel={togglePanel}
      onRevealTab={(tab) => rightRailRef.current?.openTab(tab)}
    />
  ) : inSession && sessionsLoading ? (
    <LoadingState label="Opening session" variant="Drive" />
  ) : inSession && resolvingHidden ? (
    <LoadingState label="Opening session" variant="Drive" />
  ) : (
    <PageView page={page} onOpenSession={openSession} />
  )

  /* ── Desktop: the unified three-pane screen ──────────────────────────── */
  if (isDesktop) {
    return (
      <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
        <aside className="hidden w-56 shrink-0 border-r border-line/50 bg-sidebar lg:block">
          <AppNav
            selection={inSession ? 'session' : page}
            onNavigate={goPage}
            onOpenSession={openSession}
            onNewTask={newTask}
            activeSessionId={sessionRoute}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{center}</main>

        {inSession && selected && panelOpen ? (
          <aside className="hidden w-[400px] shrink-0 border-l border-line/50 p-3 lg:block">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-card">
              <RightRail
                ref={rightRailRef}
                session={selected}
                onOpenSession={openSession}
                notify={(message, tone) => {
                  if (tone === 'error') {
                    useStore.setState((state) => ({
                      notices: { ...state.notices, [selected.id]: message },
                    }))
                  }
                }}
                fill
                bare
              />
            </div>
          </aside>
        ) : null}
      </div>
    )
  }

  /* ── Mobile: dashboard screen, then chat screen ──────────────────────── */
  if (inSession && selected) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
        <div className="flex min-h-0 flex-1 flex-col">
          <SessionView key={selected.id} session={selected} onBack={exitSession} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex h-14 shrink-0 items-center border-b border-line/50 px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            <Menu size={16} />
          </button>
          <BrandMark compact />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{center}</main>

      {/* Nav drawer — the rail's destinations as an overlay sheet. The device
          card at its bottom carries the connection state. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="animate-up absolute inset-y-0 left-0 w-64 border-r border-line/50 bg-sidebar shadow-overlay">
            <AppNav
              selection={page}
              onNavigate={goPage}
              onOpenSession={openSession}
              onNewTask={newTask}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** The center pane when no session is open: the selected nav destination. */
function PageView({
  page,
  onOpenSession,
}: {
  page: NavPage
  onOpenSession: (sessionId: string) => void
}) {
  switch (page) {
    case 'home':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <StationHome onOpenSession={(session: Session) => onOpenSession(session.id)} anchorTop="top-0" />
        </div>
      )
    case 'agents':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <AgentsPage />
        </div>
      )
    case 'browsers':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <BrowsersPage />
        </div>
      )
    case 'history':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <HistoryPage onOpenSession={onOpenSession} />
        </div>
      )
    case 'usage':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <UsagePage onOpenSession={onOpenSession} />
        </div>
      )
    case 'config':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <SettingsSection page />
        </div>
      )
  }
}

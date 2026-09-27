/**
 * App — the shell host. All layout lives in AppShell; this file owns the
 * global route, the background notification wiring, and the two overlays
 * that float above any screen: the ⌘K command palette and the attention
 * pager (the "an agent is blocked on you" cue).
 */

import { useEffect, useMemo, useState } from 'react'
import { PairingScreen } from './components/Pairing'
import { NativePairingGate } from './components/NativePairing'
import { AppShell } from './components/AppShell'
import { useRoute } from './lib/route'
import { isNativeApp } from './lib/native'
import { isPaired } from './lib/pairing'
import { roomOpenApproval, useRooms } from './lib/rooms'
import { getConversation, useStore } from './store'
import { sessionUIState } from './lib/sessionState'
import { notifyOnBackground } from './lib/notify'
import { socket } from './lib/socket'
import { cn } from './lib/format'

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

/** ⌘K palette — jump to a session by name. */
function CommandPalette({
  open,
  onClose,
  onOpenSession,
}: {
  open: boolean
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}) {
  const sessions = useStore((state) => state.sessions)
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = sessions.filter(
      (session) => session.status !== 'archived' && (!needle || session.name.toLowerCase().includes(needle)),
    )
    return list.slice(0, 8)
  }, [sessions, query])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-2 shadow-overlay"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          type="search"
          placeholder="Search sessions…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches.length > 0) {
              onOpenSession(matches[0].id)
              onClose()
            }
          }}
          className="w-full rounded-xl bg-inset px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <div className="mt-1 max-h-64 overflow-y-auto scroll-thin">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-ink-3">No sessions match.</p>
          ) : (
            matches.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  onOpenSession(session.id)
                  onClose()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
              >
                <span className="min-w-0 flex-1 truncate">{session.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-3">{session.agent}</span>
              </button>
            ))
          )}
        </div>
        <p className="px-2 py-1 text-[11px] text-ink-3">Enter opens the first match · Esc to close</p>
      </div>
    </div>
  )
}

export default function App() {
  const { route, navigate, replace } = useRoute()
  const start = useStore((state) => state.start)
  const [showPalette, setShowPalette] = useState(false)

  useEffect(() => {
    if (route.name === 'pair') return
    start()
  }, [start, route.name])

  useEffect(() => {
    function onPaletteKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onPaletteKey)
    return () => window.removeEventListener('keydown', onPaletteKey)
  }, [])

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

  /* ── Pairing takeover ──────────────────────────────────────────────────── */
  // The native shell is bundled rather than served by the daemon, so it cannot
  // arrive on a `/mobile/pair` URL — it asks for the link instead.
  if (isNativeApp() && !isPaired()) {
    return <NativePairingGate onPaired={() => replace({ name: 'list' })} />
  }

  if (route.name === 'pair') {
    return (
      <PairingScreen
        offerId={route.offerId}
        secret={route.secret}
        onPaired={() => replace({ name: 'list' })}
      />
    )
  }

  const openSession = (sessionId: string) => navigate({ name: 'session', sessionId })

  return (
    <>
      <AppShell route={route} navigate={navigate} replace={replace} />
      <AttentionPill onOpen={openSession} />
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} onOpenSession={openSession} />
    </>
  )
}

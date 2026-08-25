import { useEffect, useMemo, useRef, useState } from 'react'
import { Dot, IconButton, Notice, Segmented, StatusPill } from '../ui'
import { getConversation, useConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import { sessionUIState, uiStateDisplay, uiStateRank } from '@/lib/sessionState'
import { Timeline } from '../Timeline'
import { StateZone } from '../StateZone'
import { TerminalView } from '../TerminalView'
import { SessionPanels } from '../SessionPanels'

const LEFT_KEY = 'agentdeck-desktop-left-collapsed'
const RIGHT_KEY = 'agentdeck-desktop-right-collapsed'
const NOTES_PREFIX = 'agentdeck-notes-'
const TERMINAL_TAB_PREFIX = 'agentdeck-terminal-tab-'

/** Right-panel tab: existing context column, or a live terminal. */
type RightTab = 'context' | 'terminal'

function loadTerminalTab(sessionId: string): RightTab {
  try {
    return localStorage.getItem(TERMINAL_TAB_PREFIX + sessionId) === 'terminal' ? 'terminal' : 'context'
  } catch {
    return 'context'
  }
}

const AGENT_HUES = ['#3fae6e', '#8057c8', '#377fe6', '#e78531', '#d9b515', '#d84f8b']

function hueFor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return AGENT_HUES[hash % AGENT_HUES.length]
}

/** Seconds tick for the header runtime while the session is live. */
function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function formatRuntime(ms: number): string {
  if (ms < 0) ms = 0
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '<1m'
  const secs = Math.floor((ms % 60000) / 1000)
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, '0')}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

export function SessionWorkspace({
  session,
  onBack,
  onOpenSession,
}: {
  session: Session
  onBack: () => void
  /** Switch to another session without leaving the workspace. */
  onOpenSession?: (sessionId: string) => void
}) {
  const conversation = useConversation(session.id)
  const config = useStore((s) => s.configs[session.id])
  const notice = useStore((s) => s.notices[session.id])
  const connection = useStore((s) => s.connection)
  const providers = useStore((s) => s.providers)
  const sessions = useStore((s) => s.sessions)
  const openSession = useStore((s) => s.openSession)
  const sendPrompt = useStore((s) => s.sendPrompt)
  const setConfig = useStore((s) => s.setConfig)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const deleteSession = useStore((s) => s.deleteSession)
  const toggleStar = useStore((s) => s.toggleStar)
  const starred = useStore((s) => s.isStarred(session.id))
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  const [rightTab, setRightTab] = useState<RightTab>(() => loadTerminalTab(session.id))
  // Remember the last right-panel tab per session.
  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_TAB_PREFIX + session.id, rightTab)
    } catch {
      /* storage may be unavailable */
    }
  }, [rightTab, session.id])

  // Keyboard shortcut: Cmd/Ctrl+` toggles the right panel's terminal/context tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault()
        setRightCollapsed(false)
        setRightTab((current) => (current === 'terminal' ? 'context' : 'terminal'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keyboard shortcut: Cmd/Ctrl+D toggles star
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleStar(session.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session.id, toggleStar])

  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    try {
      // The switcher is valuable on wide screens; keep it open by default.
      return localStorage.getItem(LEFT_KEY) === '1'
    } catch {
      return false
    }
  })
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(RIGHT_KEY)
      if (v !== null) return v === '1'
      // default collapsed on 1024–1280 per spec
      return window.matchMedia('(max-width: 1280px)').matches
    } catch {
      return false
    }
  })
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.name)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(NOTES_PREFIX + session.id) ?? ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(LEFT_KEY, leftCollapsed ? '1' : '0')
    } catch {
      /* storage may be unavailable */
    }
  }, [leftCollapsed])
  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_KEY, rightCollapsed ? '1' : '0')
    } catch {
      /* storage may be unavailable */
    }
  }, [rightCollapsed])
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_PREFIX + session.id, notes)
    } catch {
      /* storage may be unavailable */
    }
  }, [notes, session.id])

  useEffect(() => {
    void openSession(session.id)
  }, [session.id, openSession])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  // Click-outside closes the overflow menu.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const provider = useMemo(() => providers.find((p) => p.id === session.agent), [providers, session.agent])
  const uiState = sessionUIState(session, conversation, connection)
  const stateDisplay = uiStateDisplay(uiState)

  // Live detail for the status pill: what the agent is doing right now.
  const activityDetail = conversation.activity?.detail

  // Header runtime ticks only while something is actually happening.
  const live = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const now = useNowTick(live)
  const runtime = useMemo(() => {
    const start = new Date(session.created_at).getTime()
    const end = live ? now : new Date(session.updated_at).getTime()
    return formatRuntime(Math.max(0, end - start))
  }, [session.created_at, session.updated_at, live, now])

  // Outline: one entry per message, recomputed each render. Deliberately NOT
  // useMemo'd on `conversation.messages` — that array is mutated in place by
  // the reducer, so its reference never changes and a memo here captured the
  // empty array forever ("No sections yet." with a full transcript).
  const outline = conversation.messages.map((m, idx) => {
    const preview =
      m.parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ')
        .slice(0, 48) || m.role
    return { idx, role: m.role, preview: preview || `Section ${idx + 1}` }
  })

  const centerRef = useRef<HTMLDivElement>(null)
  const scrollToSection = (idx: number) => {
    const host = centerRef.current
    if (!host) return
    const scroller = host.querySelector('.scroll-thin') as HTMLElement | null
    const target = scroller ?? host
    const max = target.scrollHeight - target.clientHeight
    const ratio = conversation.messages.length > 1 ? idx / (conversation.messages.length - 1) : 0
    target.scrollTo({ top: ratio * Math.max(0, max), behavior: 'smooth' })
  }

  // Keyboard: Esc closes panels (right first then left)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!rightCollapsed) setRightCollapsed(true)
        else if (!leftCollapsed) setLeftCollapsed(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leftCollapsed, rightCollapsed])

  /**
   * Workspace-scoped switcher: only sessions from the same project (workspace)
   * as the current session. This keeps the sidebar focused — the image reference
   * shows each workspace's own session list, not the whole app. Inbox sessions
   * (project == null) only see other inbox sessions.
   */
  const switcherSessions = useMemo(() => {
    const currentProject = session.project ?? null
    return sessions
      .filter((s) => s.status !== 'archived' && (s.project ?? null) === currentProject)
      .map((s) => ({ session: s, uiState: sessionUIState(s, getConversation(s.id), connection) }))
      .sort(
        (a, b) =>
          uiStateRank(a.uiState) - uiStateRank(b.uiState) ||
          b.session.updated_at.localeCompare(a.session.updated_at),
      )
  }, [sessions, connection, session.project])

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col bg-canvas text-ink">
      {/* ── Header: one compact row ─────────────────────────────────────── */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line/60 bg-canvas px-2">
        <IconButton label="Back to Mission Control" onClick={onBack} className="-ml-1 size-8">
          <BackIcon />
        </IconButton>
        <span className="h-5 w-px bg-line" aria-hidden />
        {/* Agent identity dot + provider name */}
        <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hueFor(session.agent) }} aria-hidden />
          <span className="shrink-0 text-[12px] font-medium text-ink-2">{provider?.name ?? session.agent}</span>
          <span className="text-[11px] text-ink-3">·</span>
        </span>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingTitle(false)
                if (e.key === 'Escape') {
                  setTitleDraft(session.name)
                  setEditingTitle(false)
                }
              }}
              className="w-full max-w-[320px] rounded-control border border-line bg-field px-2 py-0.5 text-[12px] font-medium outline-none focus:border-line-strong"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                title="Rename session"
                className="truncate text-left text-[12.5px] font-medium tracking-[-0.01em] hover:underline"
              >
                {session.name}
              </button>
              {session.project ? (
                <span className="hidden truncate font-mono text-[10.5px] text-ink-3 md:inline">
                  {session.project.split('/').pop() ?? session.project}
                  {session.branch ? ` : ${session.branch}` : ''}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <StatusPill
          label={stateDisplay.label}
          tone={stateDisplay.tone}
          pulse={stateDisplay.pulse}
          detail={activityDetail}
        />
        <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-ink-3 lg:inline">{runtime}</span>
        {/* Connection: a named dot, tooltip carries the state */}
        <span
          role="status"
          title={connection === 'connected' ? 'Connected' : connectionLabelShort(connection)}
          className={cn('size-2 shrink-0 rounded-full', connection === 'connected' ? 'bg-green' : connection === 'reconnecting' || connection === 'connecting' ? 'bg-orange breathe' : 'bg-red')}
          aria-hidden
        />
        <div className="flex items-center gap-0.5">
          <IconButton label={leftCollapsed ? 'Show session list' : 'Hide session list'} onClick={() => setLeftCollapsed((v) => !v)} className="size-8">
            <PanelLeftIcon collapsed={leftCollapsed} />
          </IconButton>
          <IconButton label={rightCollapsed ? 'Show context panel' : 'Hide context panel'} onClick={() => setRightCollapsed((v) => !v)} className="size-8">
            <PanelRightIcon collapsed={rightCollapsed} />
          </IconButton>
          <IconButton
            label={starred ? 'Unstar session' : 'Star session'}
            onClick={() => toggleStar(session.id)}
            className={cn('size-8', starred ? 'text-orange' : '')}
          >
            {starred ? <StarFilled /> : <StarOutline />}
          </IconButton>
          {/* Overflow menu keeps destructive/rare actions reachable but quiet. */}
          <div ref={menuRef} className="relative">
            <IconButton label="More actions" onClick={() => setMenuOpen((v) => !v)} className={cn('size-8', menuOpen ? 'bg-hover-2 text-ink' : '')}>
              <DotsIcon />
            </IconButton>
            {menuOpen ? (
              <div
                role="menu"
                className="animate-up absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
              >
                <MenuButton label="Copy link" onClick={() => {
                  setMenuOpen(false)
                  void navigator.clipboard?.writeText(window.location.href)
                }} />
                <MenuButton label="Export JSON" onClick={() => {
                  setMenuOpen(false)
                  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${session.name}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }} />
                <div className="border-t border-line" aria-hidden />
                <MenuButton label="Delete session" destructive onClick={async () => {
                  setMenuOpen(false)
                  if (confirm(`Delete "${session.name}"?`)) {
                    await deleteSession(session.id)
                    onBack()
                  }
                }} />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {notice ? <Notice message={notice} onDismiss={() => dismissNotice(session.id)} /> : null}

      <div className="flex min-h-0 flex-1">
        {/* ── Left rail — session switcher ──────────────────────────────── */}
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-line/60 bg-canvas transition-[width] duration-200 motion-reduce:transition-none',
            leftCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[248px]',
          )}
          aria-hidden={leftCollapsed}
        >
          <SwitcherRail
            current={session.id}
            entries={switcherSessions}
            onSelect={(id) => onOpenSession?.(id)}
          />
        </aside>

        {/* ── Center ─────────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          <div className="flex shrink-0 items-center gap-2 border-b border-line/40 bg-inset px-3 py-1.5">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'chat', label: 'Chat' },
                { value: 'terminal', label: 'Terminal' },
              ]}
            />
            {tab === 'chat' && outline.length > 0 ? (
              <select
                aria-label="Jump to section"
                value=""
                onChange={(e) => {
                  const idx = Number(e.target.value)
                  if (!Number.isNaN(idx)) scrollToSection(idx)
                }}
                className="scroll-thin ml-auto max-w-[220px] cursor-pointer rounded-control border border-line bg-field px-2 py-1 text-[11px] text-ink-2 outline-none hover:text-ink"
              >
                <option value="" disabled>
                  Jump to… ({outline.length})
                </option>
                {outline.map((s) => (
                  <option key={s.idx} value={s.idx}>
                    {s.role === 'user' ? 'You: ' : 'Agent: '}
                    {s.preview}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div ref={centerRef} className="flex min-h-0 flex-1 flex-col bg-canvas">
            {tab === 'chat' ? (
              <>
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                  <Timeline conversation={conversation} onRespond={(id, d) => useStore.getState().respondToApproval(session.id, id, d)} />
                </div>
                {/* One state-aware surface: composer, resume, retry, or pointer. */}
                <StateZone
                  session={session}
                  conversation={conversation}
                  connection={connection}
                  config={config}
                  provider={provider}
                  onSend={(t) => sendPrompt(session.id, t)}
                  onSetConfig={(id, v) => void setConfig(session.id, id, v)}
                />
              </>
            ) : (
              <TerminalView
                output={conversation.terminal}
                interactive={config?.interactiveTerminal === true}
                transport={config?.transport}
                connectionState={connection}
                fontSize={13}
                onInput={(d) => socket.sendTerminalInput(session.id, d)}
                onResize={(c, r) => socket.resizeTerminal(session.id, c, r)}
              />
            )}
          </div>
        </main>

        {/* ── Right panel — Context / Terminal ───────────────────────────── */}
        <aside className={cn('flex shrink-0 flex-col border-l border-line/60 bg-inset transition-[width] duration-200 motion-reduce:transition-none', rightCollapsed ? 'w-0 overflow-hidden border-l-0' : 'w-[320px]')}>
          {!rightCollapsed ? (
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5" role="tablist" aria-label="Right panel">
              {(['context', 'terminal'] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={rightTab === name}
                  onClick={() => setRightTab(name)}
                  className={cn(
                    'rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors',
                    rightTab === name ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  {name === 'terminal' ? 'Terminal' : 'Context'}
                </button>
              ))}
              <span className="ml-auto font-mono text-[10px] text-ink-3">⌃`</span>
            </div>
          ) : null}

          {rightTab === 'terminal' && !rightCollapsed ? (
            /* Terminal tab — lazy-mounted only while active; unmount disposes xterm. */
            <WorkspaceTerminal session={session} connection={connection} />
          ) : (
            <div className="scroll-thin flex-1 overflow-y-auto px-0 py-3">
              {!rightCollapsed ? (
                <div className="px-4 pb-4">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes (local only)…"
                    rows={2}
                    className="w-full resize-none rounded-[8px] border border-line bg-field px-2.5 py-2 text-[11.5px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
                  />
                </div>
              ) : null}
              <SessionPanels
                sessionId={session.id}
                facts={{
                  createdAt: session.created_at,
                  updatedAt: session.updated_at,
                  project: session.project,
                  branch: session.branch,
                  agentName: provider?.name ?? session.agent,
                  statusLabel: stateDisplay.label,
                  modelValue: config?.options.find((o) => o.id === 'model' || o.category === 'model')?.currentValue ?? undefined,
                  worktreePath: session.worktree_path ?? null,
                }}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/* ── Left rail: session switcher ─────────────────────────────────────────── */

/**
 * Fast session switching without leaving the workspace. Ranked like the
 * dashboard (needs-you → live → rest), searchable, with per-state dots so an
 * approval elsewhere is visible while you read this transcript.
 */
function SwitcherRail({
  current,
  entries,
  onSelect,
}: {
  current: string
  entries: Array<{ session: Session; uiState: ReturnType<typeof sessionUIState> }>
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? entries.filter(
        ({ session }) =>
          session.name.toLowerCase().includes(needle) ||
          session.agent.toLowerCase().includes(needle) ||
          (session.project ?? '').toLowerCase().includes(needle),
      )
    : entries

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">Sessions</span>
        <span className="font-mono text-[10px] text-ink-3">{entries.length}</span>
      </div>
      <div className="px-3 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter sessions"
          className="h-7 w-full rounded-control border border-line bg-field px-2.5 text-[11.5px] outline-none placeholder:text-ink-3 focus:border-line-strong"
        />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.map(({ session, uiState }) => {
          const display = uiStateDisplay(uiState)
          const attention = uiState === 'approval' || uiState === 'failed' || uiState === 'input'
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              aria-current={session.id === current}
              className={cn(
                'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors',
                session.id === current ? 'bg-accent-tint' : 'hover:bg-hover-2',
              )}
            >
              <Dot tone={display.tone} pulse={display.pulse} />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[12px]', session.id === current ? 'font-semibold text-accent-ink' : 'font-medium text-ink')}>
                  {session.name}
                </span>
                <span className="block truncate text-[10.5px] text-ink-3">
                  {display.label}
                  {session.project ? ` · ${session.project.split('/').pop()}` : ''}
                </span>
              </span>
              {attention ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-orange" aria-hidden /> : null}
            </button>
          )
        })}
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-3">No sessions match.</p>
        ) : null}
      </div>
    </>
  )
}

/* ── Small shared bits ───────────────────────────────────────────────────── */

function MenuButton({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors',
        destructive ? 'text-red hover:bg-red-tint' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

function connectionLabelShort(state: string): string {
  switch (state) {
    case 'idle':
    case 'offline':
      return 'Offline'
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return 'Reconnecting…'
    case 'disconnected':
      return 'Disconnected'
    case 'unauthorized':
      return 'Not paired'
    case 'error':
      return 'Connection error'
    default:
      return 'Connected'
  }
}

/**
 * Terminal tab for the right panel.
 *
 * Wraps `TerminalView` with a desktop toolbar: session badge, re-fit, and font
 * size controls. Mounts only while the tab is active; unmounting disposes
 * xterm via TerminalView's own cleanup.
 */
function WorkspaceTerminal({
  session,
  connection,
}: {
  session: Session
  connection: string
}) {
  const conversation = useConversation(session.id)
  const config = useStore((s) => s.configs[session.id])
  const [fontSize, setFontSize] = useState(12)
  const [fitNonce, setFitNonce] = useState(0)
  const interactive = config?.interactiveTerminal === true
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 py-1.5">
        <span className="truncate rounded-chip bg-field px-2 py-0.5 text-[10.5px] font-medium text-ink-2">{session.name}</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFitNonce((n) => n + 1)}
            title="Re-fit terminal"
            aria-label="Re-fit terminal"
            className="rounded-control bg-field px-1.5 py-1 font-mono text-[10.5px] text-ink-2 shadow-hairline hover:bg-hover hover:text-ink"
          >
            ⤢
          </button>
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.max(9, f - 1))}
            title="Smaller font"
            aria-label="Smaller terminal font"
            className="rounded-control bg-field px-1.5 py-1 font-mono text-[10.5px] text-ink-2 shadow-hairline hover:bg-hover hover:text-ink"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.min(20, f + 1))}
            title="Larger font"
            aria-label="Larger terminal font"
            className="rounded-control bg-field px-1.5 py-1 font-mono text-[10.5px] text-ink-2 shadow-hairline hover:bg-hover hover:text-ink"
          >
            A+
          </button>
          <span
            className={cn('ml-1 size-2 rounded-full', connection === 'connected' ? 'bg-green' : 'bg-red')}
            title={connection === 'connected' ? 'Connected' : 'Disconnected — output may buffer locally'}
            aria-hidden
          />
        </span>
      </div>
      <div key={`${fontSize}-${fitNonce}`} className="relative flex min-h-0 flex-1 flex-col">
        <TerminalView
          output={conversation.terminal}
          interactive={interactive}
          transport={config?.transport}
          connectionState={connection as never}
          fontSize={fontSize}
          onInput={(d) => socket.sendTerminalInput(session.id, d)}
          onResize={(c, r) => socket.resizeTerminal(session.id, c, r)}
        />
      </div>
    </div>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function PanelLeftIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={collapsed ? 'M9 3v18' : 'M9 3v18M9 8l-2 2 2 2'} />
    </svg>
  )
}

function PanelRightIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={collapsed ? 'M15 3v18' : 'M15 3v18M15 8l2 2-2 2'} />
    </svg>
  )
}

function StarOutline() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function StarFilled() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

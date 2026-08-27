import { useEffect, useMemo, useRef, useState } from 'react'
import { IconButton, Notice, Segmented, StatusPill } from '../ui'
import { useConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { Timeline } from '../Timeline'
import { StateZone } from '../StateZone'
import { TerminalView } from '../TerminalView'
import { RightRail, RIGHT_TABS, TAB_ICONS, type RightTab } from './session/RightRail'
import { WorkspaceSwitcher } from './session/WorkspaceSwitcher'

const RIGHT_TAB_KEY = 'agentdesk-right-tab'

const LEFT_KEY = 'agentdeck-desktop-left-collapsed'
const RIGHT_KEY = 'agentdeck-desktop-right-collapsed'

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
  const openSession = useStore((s) => s.openSession)
  const sendPrompt = useStore((s) => s.sendPrompt)
  const setConfig = useStore((s) => s.setConfig)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const deleteSession = useStore((s) => s.deleteSession)
  const toggleStar = useStore((s) => s.toggleStar)
  const starred = useStore((s) => s.isStarred(session.id))
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  // Keyboard shortcut: Cmd/Ctrl+` toggles the right panel's terminal/context tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault()
        setRightCollapsed(false)
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
  const [restartingForConfig, setRestartingForConfig] = useState(false)

  /** Apply a pending (next-run) config immediately: restart the agent. */
  async function restartForConfig() {
    setRestartingForConfig(true)
    try {
      await useStore.getState().resumeSession(session.id)
      dismissNotice(session.id)
    } finally {
      setRestartingForConfig(false)
    }
  }

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

      {notice ? (
        <Notice
          message={notice}
          onDismiss={() => dismissNotice(session.id)}
          action={
            /applies the next|next time this session|next run/i.test(notice)
              ? { label: 'Restart now', onClick: () => void restartForConfig(), busy: restartingForConfig }
              : undefined
          }
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* ── Left rail — workspaces-style switcher ──────────────────────── */}
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-white/[0.07] bg-[#0a0a0c] text-zinc-100 transition-[width] duration-200 motion-reduce:transition-none',
            leftCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[264px]',
          )}
          aria-hidden={leftCollapsed}
        >
          <WorkspaceSwitcher session={session} onSelect={(id) => onOpenSession?.(id)} />
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
                  <Timeline conversation={conversation} onRespond={(id, d, m) => useStore.getState().respondToApproval(session.id, id, d, m)} />
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

        {/* ── Right rail — icon tabs + main panel (desktop) ──────────────── */}
        <aside
          className={cn(
            'hidden shrink-0 overflow-hidden border-l border-white/[0.07] bg-[#0a0a0c] text-zinc-100 transition-[width] duration-200 motion-reduce:transition-none md:block',
            rightCollapsed ? 'w-0 border-l-0' : '',
          )}
          aria-hidden={rightCollapsed}
          style={{ width: rightCollapsed ? 0 : undefined }}
        >
          {!rightCollapsed ? (
            <RightRail session={session} onOpenSession={(id) => onOpenSession?.(id)} />
          ) : null}
        </aside>
      </div>

      {/* ── Mobile: right sidebar collapses into a bottom sheet ─────────── */}
      <MobileCommandSheet session={session} onOpenSession={onOpenSession} />
    </div>
  )
}

/** Small-screen variant: a drag-up bottom sheet with a horizontal icon tab bar. */
function MobileCommandSheet({
  session,
  onOpenSession,
}: {
  session: Session
  onOpenSession?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<RightTab>(() => {
    try {
      const saved = localStorage.getItem(RIGHT_TAB_KEY) as RightTab | null
      return saved && RIGHT_TABS.some((t) => t.id === saved) ? saved : 'sessions'
    } catch {
      return 'sessions'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_TAB_KEY, tab)
    } catch {
      /* storage may be unavailable */
    }
  }, [tab])

  return (
    <div className="md:hidden">
      {/* Handle bar pinned above the composer area */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="fixed inset-x-0 bottom-0 z-[60] flex h-6 items-center justify-center border-t border-white/[0.07] bg-[#0a0a0c]/95 backdrop-blur"
        aria-label={open ? 'Close command sheet' : 'Open command sheet'}
      >
        <span className="h-1 w-10 rounded-full bg-zinc-600" aria-hidden />
      </button>

      {open ? (
        <div
          className="animate-up fixed inset-x-0 bottom-0 z-[61] flex h-[70dvh] flex-col rounded-t-xl border-t border-white/10 bg-[#0d0d10] text-zinc-100 shadow-overlay"
          role="dialog"
          aria-label="Agent command center"
        >
          {/* Horizontal icon tab bar */}
          <div className="flex shrink-0 items-center justify-around gap-1 border-b border-white/[0.07] px-2 py-2">
            {RIGHT_TABS.map((entry) => {
              const Icon = TAB_ICONS[entry.id]
              const active = tab === entry.id
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  aria-label={entry.label}
                  className={cn(
                    'flex size-11 items-center justify-center rounded-xl transition',
                    active ? 'bg-white/10 text-white' : 'text-zinc-500',
                  )}
                >
                  <Icon size={19} strokeWidth={1.7} />
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="ml-auto rounded-lg p-2 text-zinc-500"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <RightRail session={session} onOpenSession={(id) => onOpenSession?.(id)} initialTab={tab} onTabChange={setTab} />
          </div>
        </div>
      ) : null}
    </div>
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

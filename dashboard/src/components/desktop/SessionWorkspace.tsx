/**
 * SessionWorkspace — the OpenCode-style 4-zone agentic IDE layout.
 *
 *   TopBar (40px)  — identity, project, status, timer, connection.
 *   LeftSidebar    — project selector, branch+stats, session navigator (~280px).
 *   Center         — Chat|Terminal tabs, the conversation, the composer.
 *   RightGitPanel  — always-visible git tools (~380px).
 *
 * The whole thing is a single grid. The center column is fluid; the sidebars
 * are fixed. Every data source here is real and daemon-backed — git state,
 * session state, conversation events, terminal bytes. Nothing is mocked.
 *
 * State that drives the surface (tab, editing title, runtime tick, outline,
 * scroll-to-section, keyboard shortcuts) is preserved from the prior version;
 * only the layout scaffold changed.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Segmented } from '../ui'
import { useConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import { sessionUIState } from '@/lib/sessionState'
import { Timeline } from '../Timeline'
import { StateZone } from '../StateZone'
import { TerminalView } from '../TerminalView'
import { TopBar } from './TopBar'
import { LeftSidebar } from './LeftSidebar'
import { RightGitPanel } from './RightGitPanel'

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

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.name)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [restartingForConfig, setRestartingForConfig] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

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

  // Live runtime tick.
  const live = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const now = useNowTick(live)
  const runtime = useMemo(() => {
    const start = new Date(session.created_at).getTime()
    const end = live ? now : new Date(session.updated_at).getTime()
    return formatRuntime(Math.max(0, end - start))
  }, [session.created_at, session.updated_at, live, now])

  // Outline: one entry per message.
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

  // Keyboard: Cmd/Ctrl+` focuses the terminal tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault()
        setTab((t) => (t === 'chat' ? 'terminal' : 'chat'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keyboard: Cmd/Ctrl+D toggles star.
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

  function handleNewSession() {
    const state = useStore.getState()
    const prov = state.providers.find((p) => p.state === 'ready') ?? state.providers[0]
    if (!prov) return
    void state.createSession({ agent: prov.id }).then((s) => onOpenSession?.(s.id))
  }

  function focusComposer() {
    setTab('chat')
    // The composer textarea is rendered by StateZone → Composer. Query it after the tab flips.
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
      ta?.focus()
    })
  }

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col bg-canvas text-ink">
      {/* ── Notice banner ─────────────────────────────────────────────────── */}
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

      {/* ── Top bar (40px) ────────────────────────────────────────────────── */}
      <TopBar
        session={session}
        uiState={uiState}
        connection={connection}
        runtime={runtime}
        onNewSession={handleNewSession}
        onBack={onBack}
      />

      {/* ── 4-zone body ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar (~280px) */}
        <LeftSidebar
          session={session}
          onSelect={(id) => onOpenSession?.(id)}
          searchRef={searchRef}
        />

        {/* Center — fluid */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
          {/* Session title row + tabs */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line/40 bg-inset px-3 py-1.5">
            {/* Agent identity dot + provider name */}
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hueFor(session.agent) }} aria-hidden />
              <span className="shrink-0 text-[12px] font-medium text-ink-2">{provider?.name ?? session.agent}</span>
            </span>

            {/* Editable session title */}
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
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="Rename session"
                  className="truncate text-left text-[12.5px] font-medium tracking-[-0.01em] hover:underline"
                >
                  {session.name}
                </button>
              )}
            </div>

            {/* Star + overflow menu */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => toggleStar(session.id)}
                title={starred ? 'Unstar session' : 'Star session'}
                className={cn('flex size-7 items-center justify-center rounded-full transition-colors', starred ? 'text-orange' : 'text-ink-3 hover:bg-hover-2 hover:text-ink')}
              >
                {starred ? <StarFilled /> : <StarOutline />}
              </button>
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  title="More actions"
                  className={cn('flex size-7 items-center justify-center rounded-full transition-colors', menuOpen ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover-2 hover:text-ink')}
                >
                  <DotsIcon />
                </button>
                {menuOpen ? (
                  <div role="menu" className="animate-up absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
                    <MenuButton
                      label="Copy link"
                      onClick={() => {
                        setMenuOpen(false)
                        void navigator.clipboard?.writeText(window.location.href)
                      }}
                    />
                    <MenuButton
                      label="Export JSON"
                      onClick={() => {
                        setMenuOpen(false)
                        const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${session.name}.json`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    />
                    <div className="border-t border-line" aria-hidden />
                    <MenuButton
                      label="Delete session"
                      destructive
                      onClick={async () => {
                        setMenuOpen(false)
                        if (confirm(`Delete "${session.name}"?`)) {
                          await deleteSession(session.id)
                          onBack()
                        }
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Tab switcher + jump-to */}
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

          {/* Chat / terminal surface */}
          <div ref={centerRef} className="flex min-h-0 flex-1 flex-col bg-canvas">
            {tab === 'chat' ? (
              <>
                <Timeline
                  conversation={conversation}
                  onRespond={(id, d, m) => useStore.getState().respondToApproval(session.id, id, d, m)}
                  project={session.project ?? undefined}
                  sessionId={session.id}
                />
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

        {/* Right git panel (~380px, always visible) */}
        <RightGitPanel
          session={session}
          notify={(message, tone) => {
            // Surface git errors as session notices so they reach the user even
            // if the panel is scrolled. Ok messages are transient (the panel
            // re-renders on success), so we don't spam the notice banner.
            if (tone === 'error') {
              useStore.setState((state) => ({ notices: { ...state.notices, [session.id]: message } }))
            }
          }}
          onFocusComposer={focusComposer}
          onFocusSearch={() => searchRef.current?.focus()}
        />
      </div>
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

/** Dismissible inline notice. */
function Notice({
  message,
  onDismiss,
  action,
}: {
  message: string
  onDismiss: () => void
  action?: { label: string; onClick: () => void; busy?: boolean }
}) {
  return (
    <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-orange/20 bg-orange/[0.04] px-3.5 py-2 text-[11.5px] leading-[1.6] text-ink">
      <AlertIcon size={13} className="mt-[2px] shrink-0 text-orange" />
      <span className="min-w-0 flex-1">{message}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.busy}
          className="-m-1 shrink-0 rounded-md bg-ink px-2 py-0.5 text-[11px] font-medium text-canvas transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {action.busy ? 'Restarting…' : action.label}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 shrink-0 p-1 text-ink-3 transition-colors hover:text-ink">
        <Close size={12} />
      </button>
    </div>
  )
}

function AlertIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  )
}

function Close({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

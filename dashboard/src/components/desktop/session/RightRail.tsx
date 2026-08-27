/**
 * Right sidebar for the session workspace: a 48px vertical icon tab bar
 * (Sessions / Subagents / Terminals / Browser / Tasks / Git) + main panel,
 * styled after the homepage workspaces sidebar (zinc on #0a0a0c).
 *
 * Everything here is daemon-backed:
 *  - Sessions  — live sessions from the store, click to switch, close to kill
 *  - Subagents — provider launcher + this workspace's roster (was "Agents")
 *  - Terminals — real PTY shells via /api/terminals + WS TerminalInput
 *  - Browser   — iframe webview of any URL
 *  - Tasks     — progress from real conversation state; New Task / Search wired
 *  - Git       — real branches, diffstat, commit+push with error surfacing
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  Check,
  ListChecks,
  MessagesSquare,
  Plus,
  SquareTerminal,
  X,
} from 'lucide-react'
import { terminalsApi, type StandaloneTerminal } from '@/lib/api'
import { getConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState } from '@/lib/sessionState'
import { TerminalView } from '@/components/TerminalView'
import { SubagentsPanel } from './SessionSidePanels'
import { GitToolsCard } from './GitToolsCard'
import { AutomationsPanel, ProgressWidget } from './TasksAndExecution'
import type { Session } from '@/types/session'

export const RIGHT_TABS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'subagents', label: 'Agents' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'browser', label: 'Browser' },
  { id: 'tasks', label: 'Tasks / Automations' },
  { id: 'git', label: 'Git Tools' },
] as const

export type RightTab = (typeof RIGHT_TABS)[number]['id']

const TAB_KEY = 'agentdesk-right-tab'

/* ── Toasts ──────────────────────────────────────────────────────────────── */

interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error'
}

let toastSeq = 1

/** Lightweight toast stack. Errors stay up until dismissed; ok fades in 4s. */
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = toastSeq++
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    if (tone === 'ok') {
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4000)
    }
  }, [])
  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((t) => t.id !== id)),
    [],
  )
  return { toasts, push, dismiss }
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-50 flex w-[92%] -translate-x-1/2 flex-col gap-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'animate-up pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug shadow-lg backdrop-blur',
            toast.tone === 'error'
              ? 'border-red-500/30 bg-red-950/80 text-red-200'
              : 'border-white/10 bg-zinc-900/90 text-zinc-200',
          )}
        >
          <span className="min-w-0 flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
            className="shrink-0 text-current opacity-60 hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── Rail shell ──────────────────────────────────────────────────────────── */

export function RightRail({
  session,
  onOpenSession,
  onNewTask,
  initialTab,
  onTabChange,
}: {
  session: Session
  /** Switch to another session without leaving the workspace. */
  onOpenSession?: (sessionId: string) => void
  /** Open the new-task flow (wired by the parent app). */
  onNewTask?: () => void
  /** Controlled tab (mobile sheet drives it); falls back to localStorage state. */
  initialTab?: RightTab
  onTabChange?: (tab: RightTab) => void
}) {
  const connection = useStore((s) => s.connection)
  const [tab, setTabState] = useState<RightTab>(() => {
    if (initialTab && RIGHT_TABS.some((t) => t.id === initialTab)) return initialTab
    try {
      const saved = localStorage.getItem(TAB_KEY) as RightTab | null
      return saved && RIGHT_TABS.some((t) => t.id === saved) ? saved : 'sessions'
    } catch {
      return 'sessions'
    }
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const { toasts, push, dismiss } = useToasts()

  const setTab = useCallback(
    (next: RightTab) => {
      setTabState(next)
      onTabChange?.(next)
    },
    [onTabChange],
  )

  // Persist the active tab.
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* storage may be unavailable */
    }
  }, [tab])

  // Ctrl/Cmd+Shift+1..6 switches tabs directly.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if (!/^[1-6]$/.test(e.key)) return
      e.preventDefault()
      setTab(RIGHT_TABS[Number(e.key) - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full min-h-0">
      {/* 48px icon rail */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-white/[0.07] bg-[#0a0a0c] py-2">
        {RIGHT_TABS.map((entry, idx) => {
          const Icon = TAB_ICONS[entry.id]
          const active = tab === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-label={entry.label}
              aria-current={active ? 'page' : undefined}
              title={`${entry.label} · Ctrl+Shift+${idx + 1}`}
              className={cn(
                'flex size-10 items-center justify-center rounded-xl transition',
                active
                  ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]'
                  : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200',
              )}
            >
              <Icon size={19} strokeWidth={1.7} />
            </button>
          )
        })}
        <span className="mt-auto size-2 rounded-full" aria-hidden
          title={connection}
          style={{
            backgroundColor:
              connection === 'connected'
                ? '#34d399'
                : connection === 'connecting' || connection === 'reconnecting'
                  ? '#fb923c'
                  : '#f87171',
          }}
        />
      </div>

      {/* Main panel — fade between views */}
      <div className="relative flex min-w-0 flex-1 flex-col bg-[#0d0d10]">
        <div key={tab} className="animate-fade flex min-h-0 flex-1 flex-col">
          {tab === 'sessions' ? (
            <RailSessions session={session} onOpenSession={onOpenSession} searchRef={searchRef} />
          ) : null}
          {tab === 'subagents' ? (
            <SubagentsPanel session={session} onOpenSession={(id) => onOpenSession?.(id)} />
          ) : null}
          {tab === 'terminals' ? <RailTerminals session={session} notify={push} /> : null}
          {tab === 'browser' ? <RailBrowser /> : null}
          {tab === 'tasks' ? <RailTasks session={session} onNewTask={onNewTask} searchRef={searchRef} /> : null}
          {tab === 'git' ? <RailGit session={session} notify={push} /> : null}
        </div>
        {/* Bottom action bar: permission mode + model switcher + stop */}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    </div>
  )
}

export const TAB_ICONS: Record<RightTab, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  sessions: MessagesSquare,
  subagents: BotIcon,
  terminals: SquareTerminal,
  browser: AppWindow,
  tasks: ListChecks,
  git: GitBranchIcon,
}

function BotIcon(props: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden>
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  )
}

function GitBranchIcon(props: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" width={props.size ?? 24} height={props.size ?? 24} className={props.className} aria-hidden>
      <line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

/* ── Shared panel bits ───────────────────────────────────────────────────── */

function RailHeader({
  eyebrow,
  right,
}: {
  eyebrow: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">{eyebrow}</span>
      {right}
    </div>
  )
}

function RailButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'primary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition',
        tone === 'primary'
          ? 'bg-white text-black hover:bg-zinc-200'
          : 'text-zinc-300 hover:bg-white/[0.06]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  )
}

/* ── Sessions tab ────────────────────────────────────────────────────────── */

function RailSessions({
  session,
  onOpenSession,
}: {
  session: Session
  onOpenSession?: (id: string) => void
  searchRef?: React.RefObject<HTMLInputElement | null>
}) {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const deleteSession = useStore((s) => s.deleteSession)

  const entries = useMemo(() => {
    const currentProject = session.project ?? null
    return sessions
      .filter((s) => s.status !== 'archived' && (s.project ?? null) === currentProject)
      .map((s) => ({ session: s, uiState: sessionUIState(s, getConversation(s.id), connection) }))
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
  }, [sessions, connection, session.project])

  async function close(id: string) {
    try {
      await deleteSession(id)
    } catch {
      /* already gone */
    }
  }

  return (
    <>
      <RailHeader eyebrow={`Sessions · ${entries.length}`} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="px-2 py-5 text-[11px] leading-relaxed text-zinc-500">No sessions yet.</p>
        ) : (
          entries.map(({ session: s, uiState }) => {
            const active = s.id === session.id
            return (
              <div key={s.id} className="group relative mb-0.5 flex items-center">
                <button
                  type="button"
                  onClick={() => onOpenSession?.(s.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-2 pr-7 text-left transition',
                    active ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      ['working', 'starting', 'resuming'].includes(uiState)
                        ? 'bg-emerald-400'
                        : ['approval', 'input', 'paused'].includes(uiState)
                          ? 'bg-orange-400'
                          : uiState === 'failed'
                            ? 'bg-red-400'
                            : 'bg-zinc-600',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{s.name}</span>
                  <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                    {relativeTime(s.updated_at).replace(' ago', '')}
                  </span>
                </button>
                {!active ? (
                  <button
                    type="button"
                    onClick={() => void close(s.id)}
                    title="Stop session"
                    aria-label={`Stop ${s.name}`}
                    className="absolute right-1 hidden rounded p-1 text-zinc-600 hover:text-red-400 group-hover:block"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

/* ── Terminals tab: real PTYs ────────────────────────────────────────────── */

function RailTerminals({
  session,
  notify,
}: {
  session: Session
  notify: (message: string, tone?: 'ok' | 'error') => void
}) {
  const [terminals, setTerminals] = useState<StandaloneTerminal[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(11)
  const config = useStore((s) => s.configs[session.id])
  const connection = useStore((s) => s.connection)
  // Standalone terminals are not agent sessions: the store ignores their
  // TerminalOutput frames (no conversation). Buffer bytes locally per id.
  const buffersRef = useRef<Map<string, string>>(new Map())
  const [, forceTick] = useState(0)

  useEffect(() => {
    return socket.onFrame((frame) => {
      if (frame.type !== 'TerminalOutput') return
      const id = (frame.payload as { session_id?: string }).session_id
      if (!id?.startsWith('term-')) return
      const buffers = buffersRef.current
      const combined = (buffers.get(id) ?? '') + (frame.payload as { data?: string }).data
      buffers.set(id, combined.length > 512 * 1024 ? combined.slice(-512 * 1024) : combined)
      forceTick((n) => n + 1)
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const result = await terminalsApi.list()
      setTerminals(result.terminals)
      setActiveId((current) =>
        current && result.terminals.some((t) => t.id === current)
          ? current
          : (result.terminals[0]?.id ?? null),
      )
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), 'error')
    }
  }, [notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async () => {
    try {
      const created = await terminalsApi.create(session.project ?? undefined)
      setTerminals((current) => [...current, created])
      setActiveId(created.id)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), 'error')
    }
  }, [session.project, notify])

  const close = useCallback(
    async (id: string) => {
      try {
        await terminalsApi.close(id)
        setTerminals((current) => {
          const next = current.filter((t) => t.id !== id)
          setActiveId((active) => (active === id ? (next[0]?.id ?? null) : active))
          return next
        })
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : String(cause), 'error')
      }
    },
    [notify],
  )

  const active = terminals.find((t) => t.id === activeId) ?? null

  return (
    <>
      <RailHeader
        eyebrow="Terminals"
        right={
          <RailButton tone="primary" onClick={() => void create()}>
            <Plus size={13} /> New
          </RailButton>
        }
      />
      {terminals.length > 0 ? (
        <div className="scroll-thin flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.07] px-2 py-1.5">
          {terminals.map((terminal, idx) => (
            <span key={terminal.id} className="group relative">
              <button
                type="button"
                onClick={() => setActiveId(terminal.id)}
                className={cn(
                  'rounded-md px-2 py-1 font-mono text-[10px] transition',
                  terminal.id === activeId ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:bg-white/[0.05]',
                )}
              >
                tty{idx + 1}
              </button>
              <button
                type="button"
                onClick={() => void close(terminal.id)}
                aria-label={`Close tty${idx + 1}`}
                className="absolute -right-1 -top-1 hidden rounded-full bg-zinc-800 p-0.5 text-zinc-400 hover:text-red-400 group-hover:block"
              >
                <X size={9} />
              </button>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-0.5 pr-1">
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.max(9, f - 1))}
              aria-label="Smaller font"
              className="rounded px-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-200"
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.min(18, f + 1))}
              aria-label="Larger font"
              className="rounded px-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-200"
            >
              A+
            </button>
          </span>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {active ? (
          <TerminalView
            output={buffersRef.current.get(active.id) ?? ''}
            interactive={true}
            transport={config?.transport}
            connectionState={connection as never}
            fontSize={fontSize}
            onInput={(d: string) => socket.sendTerminalInput(active.id, d)}
            onResize={(c: number, r: number) => socket.resizeTerminal(active.id, c, r)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <SquareTerminal size={22} className="text-zinc-700" />
            <p className="max-w-[220px] text-[11px] leading-relaxed text-zinc-500">
              No terminals open. New spawns a real PTY shell in this workspace.
            </p>
            <RailButton tone="primary" onClick={() => void create()}>
              <Plus size={13} /> New terminal
            </RailButton>
          </div>
        )}
      </div>
    </>
  )
}

/* ── Browser tab ─────────────────────────────────────────────────────────── */

function RailBrowser() {
  const [url, setUrl] = useState('')
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const draft = useRef('')

  function navigate(target: string) {
    let value = target.trim()
    if (!value) return
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`
    setFrameUrl(value)
    setUrl(value)
  }

  return (
    <>
      <RailHeader eyebrow="Browser" />
      <form
        className="flex shrink-0 gap-1 border-b border-white/[0.07] px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(draft.current)
        }}
      >
        <input
          type="text"
          defaultValue={url}
          onChange={(e) => (draft.current = e.target.value)}
          placeholder="URL…"
          aria-label="Browser URL"
          className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 font-mono text-[10.5px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
        />
        <button
          type="submit"
          className="rounded-md bg-white px-2 py-1 text-[10.5px] font-medium text-black hover:bg-zinc-200"
        >
          Go
        </button>
      </form>
      <div className="min-h-0 flex-1 bg-white">
        {frameUrl ? (
          <iframe src={frameUrl} title="Browser panel" className="size-full border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#0d0d10] p-6 text-center">
            <AppWindow size={22} className="text-zinc-700" />
            <p className="max-w-[220px] text-[11px] leading-relaxed text-zinc-500">
              Enter a URL to browse inline. Sites that block embedding will stay blank.
            </p>
          </div>
        )}
      </div>
    </>
  )
}

/* ── Tasks tab: real progress from conversation state ────────────────────── */

interface TaskItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Tasks come from the agent's real plan parts (kind: 'plan' with live
 * per-step status). The newest plan wins; agents replace their plan each turn.
 */
function tasksFromConversation(sessionId: string): TaskItem[] {
  const conversation = getConversation(sessionId)
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    for (const part of [...conversation.messages[i].parts].reverse()) {
      if (part.kind !== 'plan') continue
      const plan = part as { steps: string[]; entries?: Array<{ content: string; status?: string }> }
      return plan.steps.map((step, idx) => {
        const entry = plan.entries?.find((e) => e.content === step)
        const raw = entry?.status
        const status: TaskItem['status'] =
          raw === 'completed' ? 'completed' : raw === 'in_progress' ? 'in_progress' : 'pending'
        return { id: `${i}-${idx}`, title: step, status }
      })
    }
  }
  return []
}

function RailTasks({
  session,
  onNewTask,
  searchRef,
}: {
  session: Session
  onNewTask?: () => void
  searchRef?: React.RefObject<HTMLInputElement | null>
}) {
  const conversation = useStore((s) => s.revisions[session.id]) // re-render tick
  void conversation
  const [query, setQuery] = useState('')
  const tasks = useMemo(() => tasksFromConversation(session.id), [session.id, conversation])
  const filtered = query.trim()
    ? tasks.filter((task) => task.title.toLowerCase().includes(query.trim().toLowerCase()))
    : tasks

  return (
    <>
      <RailHeader
        eyebrow="Tasks"
        right={
          <span className="flex items-center gap-1">
            <RailButton onClick={() => onNewTask?.()}>
              <Plus size={13} /> New Task
            </RailButton>
          </span>
        }
      />
      {/* Step-by-step progress checklist from real plan state */}
      {tasks.length > 0 ? (
        <div className="border-b border-white/[0.07] px-2 pt-2">
          <ProgressWidget session={session} />
        </div>
      ) : null}
      {/* Search over the live plan steps */}
      {tasks.length > 0 ? (
        <div className="border-b border-white/[0.07] px-2 py-1.5">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="h-7 w-full rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
          />
        </div>
      ) : null}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="px-4 py-5 text-[11px] leading-relaxed text-zinc-500">
            No task list yet. Ask an agent to plan work and its todos appear here live.
          </p>
        ) : (
          filtered.length > 0 && (
            <div className="p-1">
              {filtered.map((task) => (
                <div key={task.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                  <span
                    className={cn(
                      'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                      task.status === 'completed'
                        ? 'border-emerald-400 bg-emerald-400/15 text-emerald-400'
                        : task.status === 'in_progress'
                          ? 'border-orange-400 text-orange-400'
                          : 'border-zinc-600',
                    )}
                  >
                    {task.status === 'completed' ? <Check size={9} strokeWidth={3} /> : task.status === 'in_progress' ? <span className="size-1.5 rounded-full bg-orange-400 breathe" /> : null}
                  </span>
                  <span className={cn('text-[11px] leading-snug', task.status === 'completed' ? 'text-zinc-600 line-through' : 'text-zinc-300')}>
                    {task.title}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
        {/* Idle-time + scheduled automation templates */}
        <AutomationsPanel session={session} />
      </div>
    </>
  )
}

/* ── Git tab: real branches, diffstat, commit/push ───────────────────────── */


/* ── Git tab: Git Tools card command center ──────────────────────────────── */

function RailGit({
  session,
  notify,
}: {
  session: Session
  notify: (message: string, tone?: 'ok' | 'error') => void
}) {
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <RailHeader eyebrow={`git · ${session.project?.split('/').filter(Boolean).pop() ?? 'workspace'}`} />
      <GitToolsCard session={session} notify={notify} />
    </div>
  )
}

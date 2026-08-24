/**
 * StationHome — Mission Control (premium dark redesign).
 *
 * Answers, in order of urgency:
 *   1. What needs me?     → Attention rows with inline actions
 *   2. What is running?   → Active cards with live status
 *   3. Everything else    → The roster, newest first
 *
 * Grok × Apple design language: deep surfaces, cool blue accent,
 * generous whitespace, subtle borders, no bright green.
 */

import { useEffect, useMemo, useState } from 'react'
import { NewSessionLayer } from '../SessionList'
import { SyncIcon, SyncLayer } from '../SyncSessions'
import { Button, Dot, Dots, EmptyState, Plus, Search, StatusPill, TextField } from '../ui'
import { getConversation, useConversation, useStore } from '@/store'
import { basename, cn, relativeTime } from '@/lib/format'
import { sessionUIState, uiStateDisplay, uiStateRank } from '@/lib/sessionState'
import { describeApproval } from '@/lib/approvals'
import type { Conversation } from '@/types/conversation'
import type { Provider } from '@/types/provider'
import type { Session } from '@/types/session'

type Filter = 'all' | 'active' | 'attention' | 'starred'

/* ── Conversation-derived helpers ────────────────────────────────────────── */

function previewFor(sessionId: string): string | undefined {
  const conversation = getConversation(sessionId)
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    for (const part of message.parts) {
      if (part.kind === 'text' && part.text.trim()) return part.text.trim().slice(0, 88)
      if (part.kind === 'reasoning' && part.text.trim()) return part.text.trim().slice(0, 72)
    }
  }
  return undefined
}

/** The user's opening prompt — the session's task line. */
function taskFor(sessionId: string): string | undefined {
  const conversation = getConversation(sessionId)
  for (const message of conversation.messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.kind === 'text' && part.text.trim()) {
        const text = part.text.trim()
        if (text.startsWith('/')) continue
        return text.slice(0, 96)
      }
    }
  }
  return undefined
}

/** Newest error message, for failed-session headlines. */
function lastErrorOf(conversation: Conversation): string | undefined {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    for (let p = conversation.messages[index].parts.length - 1; p >= 0; p -= 1) {
      const part = conversation.messages[index].parts[p]
      if (part.kind === 'error') return part.message
    }
  }
  return undefined
}

/** The newest unanswered approval part, or undefined. */
function openApprovalOf(conversation: Conversation) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    for (let p = conversation.messages[index].parts.length - 1; p >= 0; p -= 1) {
      const part = conversation.messages[index].parts[p]
      if (part.kind === 'approval' && part.decision === undefined) return part
    }
  }
  return undefined
}

const AGENT_HUES = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#facc15', '#f472b6']

function hueFor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return AGENT_HUES[hash % AGENT_HUES.length]
}

/**
 * Seconds tick for live surfaces.
 */
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
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

function Chevron() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3" aria-hidden>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

/* ── Attention strip ─────────────────────────────────────────────────────── */

const ATTENTION_TONES = {
  approval: { dot: 'bg-orange', tint: 'border-l-orange bg-orange/[0.04]' },
  failed: { dot: 'bg-red', tint: 'border-l-red bg-red/[0.04]' },
  input: { dot: 'bg-accent', tint: 'border-l-accent bg-accent/[0.04]' },
} as const

function AttentionRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  useConversation(session.id)
  const connection = useStore((state) => state.connection)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const resumeSession = useStore((state) => state.resumeSession)
  const [retrying, setRetrying] = useState(false)
  const providers = useStore((state) => state.providers)
  const provider = providers.find((candidate) => candidate.id === session.agent)

  const conversation = getConversation(session.id)
  const uiState = sessionUIState(session, conversation, connection)
  const tones = ATTENTION_TONES[uiState as keyof typeof ATTENTION_TONES] ?? ATTENTION_TONES.input
  const connected = connection === 'connected'

  const approval = uiState === 'approval' ? openApprovalOf(conversation) : undefined
  const approvalView = approval ? describeApproval(approval.prompt, approval.options) : undefined
  const allowOption = approvalView?.options.find((o) => o.kind === 'allow') ?? approvalView?.options[0]

  const headline =
    uiState === 'failed'
      ? lastErrorOf(conversation) ?? 'The agent hit an error'
      : uiState === 'input'
        ? 'Waiting for your reply'
        : approvalView?.context ?? approvalView?.question ?? 'Approval requested'

  const retry = () => {
    setRetrying(true)
    void resumeSession(session.id).finally(() => setRetrying(false))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && onOpen()}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3.5 border-l-2 px-4 py-3 text-left transition-all duration-150 hover:bg-hover',
        tones.tint,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', tones.dot)} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold text-ink">{session.name}</span>
          <span className="hidden shrink-0 truncate text-[10.5px] text-ink-3 sm:inline">
            {provider?.name ?? session.agent}
            {session.project ? ` · ${basename(session.project)}` : ''}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[11px] leading-[1.4] text-ink-3">{headline}</span>
        </span>
      </span>
      {uiState === 'failed' ? (
        <button
          type="button"
          onClick={(clickEvent) => { clickEvent.stopPropagation(); retry() }}
          disabled={retrying || !connected}
          className={cn(
            'inline-flex h-7 shrink-0 items-center rounded-full bg-surface border border-line px-3.5 text-[11.5px] font-medium text-ink',
            'transition-all duration-150 active:scale-[0.97] disabled:opacity-40',
            'hover:bg-hover-2 hover:border-line-strong',
          )}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      ) : approval && allowOption ? (
        <button
          type="button"
          onClick={(clickEvent) => {
            clickEvent.stopPropagation()
            respondToApproval(session.id, approval.requestId, allowOption.value)
          }}
          disabled={!connected}
          className={cn(
            'inline-flex h-7 shrink-0 items-center rounded-full bg-accent px-3.5 text-[11.5px] font-semibold text-canvas',
            'transition-all duration-150 active:scale-[0.97] disabled:opacity-40',
            'hover:bg-accent-ink',
          )}
        >
          {allowOption.label}
        </button>
      ) : (
        <span className="hidden shrink-0 items-center gap-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-3 group-hover:flex">
          Open <Chevron />
        </span>
      )}
    </div>
  )
}

/* ── Active agent card ───────────────────────────────────────────────────── */

function ActiveCard({ session, onOpen }: { session: Session; onOpen: () => void }) {
  useConversation(session.id)
  useNowTick(true)
  const providers = useStore((state) => state.providers)
  const provider = providers.find((candidate) => candidate.id === session.agent)
  const hue = hueFor(session.agent)

  const conversation = getConversation(session.id)
  const uiState = sessionUIState(session, conversation, 'connected')
  const display = uiStateDisplay(uiState)

  const activity = conversation.activity
  const startedMs = new Date(session.created_at).getTime()
  const runtime = formatRuntime(Date.now() - startedMs)
  const task = taskFor(session.id)
  const attention = uiState === 'approval' || uiState === 'input'

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left',
        'transition-all duration-150 hover:bg-hover-2',
        attention
          ? 'border-orange/20 bg-orange/[0.03]'
          : 'border-line/60 bg-surface/80 hover:border-line-strong',
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hue }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{session.name}</span>
        <StatusPill label={display.label} tone={display.tone} pulse={display.pulse} className="h-5 px-1.5 text-[10px]" />
      </span>
      <span className="w-full truncate font-mono text-[10.5px] text-ink-3">
        {session.project ? basename(session.project) : 'no project'}
        {' · '}
        {provider?.name ?? session.agent}
      </span>
      {task ? <span className="line-clamp-2 text-[11.5px] leading-[1.45] text-ink-2">{task}</span> : null}
      <span className="flex w-full min-w-0 items-center gap-1.5 pt-1 border-t border-line/40">
        {activity ? (
          <>
            <Dots />
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-3">
              {activity.detail ?? activity.label}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-3">idle turn</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-ink-3">{runtime}</span>
      </span>
    </button>
  )
}

/* ── Roster row ──────────────────────────────────────────────────────────── */

function RosterRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  useConversation(session.id)
  const providers = useStore((state) => state.providers)
  const connection = useStore((state) => state.connection)
  const starred = useStore((state) => state.isStarred(session.id))
  const toggleStar = useStore((state) => state.toggleStar)
  const provider = providers.find((candidate) => candidate.id === session.agent)
  const hue = hueFor(session.agent)
  const conversation = getConversation(session.id)
  const live =
    session.status === 'running' || session.status === 'starting' || session.status === 'resuming'
  useNowTick(live)

  const uiState = sessionUIState(session, conversation, connection)
  const display = uiStateDisplay(uiState)
  const preview = previewFor(session.id)
  const attention = uiState === 'approval' || uiState === 'failed'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && onOpen()}
      className={cn(
        'group grid cursor-pointer grid-cols-[8px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 px-4 py-3',
        'border-b border-line/40 transition-all duration-150 hover:bg-hover/60 md:grid-cols-[minmax(0,2.4fr)_120px_minmax(0,1fr)_70px_28px]',
        attention && 'border-l-2 border-l-orange bg-orange/[0.02]',
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full md:hidden"
        style={{ backgroundColor: display.tone === 'green' ? '#34d399' : display.tone === 'orange' ? '#fb923c' : display.tone === 'red' ? '#f87171' : '#686878' }}
        aria-hidden
      />

      {/* Name + status + preview */}
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{session.name}</span>
          <StatusPill label={display.label} tone={display.tone} pulse={display.pulse} className="hidden h-5 px-1.5 text-[10px] md:inline-flex" />
          <button
            type="button"
            aria-label={starred ? 'Unstar' : 'Star'}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation()
              toggleStar(session.id)
            }}
            className={cn(
              'shrink-0 text-ink-3 transition-opacity hover:text-orange',
              starred ? 'text-orange opacity-100' : 'opacity-30 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100',
            )}
          >
            ★
          </button>
        </span>
        {preview ? (
          <span className="hidden truncate font-mono text-[11px] leading-none text-ink-3 md:block">{preview}</span>
        ) : session.project ? (
          <span className="hidden truncate font-mono text-[11px] leading-none text-ink-3 md:block">{basename(session.project)}</span>
        ) : null}
        <span className="truncate font-mono text-[11px] text-ink-3 md:hidden">
          {preview ?? (session.project ? basename(session.project) : display.label)}
        </span>
      </span>

      {/* Agent */}
      <span className="hidden min-w-0 items-center gap-1.5 md:flex">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hue }} aria-hidden />
        <span className="truncate text-[11.5px] text-ink-2">{provider?.name ?? session.agent}</span>
      </span>

      {/* Project + branch */}
      <span className="hidden truncate font-mono text-[11px] text-ink-3 md:block">
        {session.project ? basename(session.project) : '—'}
        {session.branch ? <span className="text-ink-3/60"> · {session.branch}</span> : null}
      </span>

      {/* Last activity */}
      <span className="hidden shrink-0 text-right text-[11px] tabular-nums text-ink-3 md:block">
        {relativeTime(session.updated_at)}
      </span>

      <span className="hidden justify-end md:flex">
        <Chevron />
      </span>
    </div>
  )
}

/* ── Token usage summary ─────────────────────────────────────────────────── */

/** Compute total input + output tokens across all sessions. */
function TotalUsage({ sessions }: { sessions: Session[] }) {
  const totalIn = sessions.reduce((sum, s) => {
    const conv = getConversation(s.id)
    let t = 0
    for (const msg of conv.messages) {
      for (const p of msg.parts) {
        if (p.kind === 'usage') t += (p.inputTokens ?? 0)
        if (p.kind === 'turn_summary') t += (p.inputTokens ?? 0)
      }
    }
    return sum + t
  }, 0)
  const totalOut = sessions.reduce((sum, s) => {
    const conv = getConversation(s.id)
    let t = 0
    for (const msg of conv.messages) {
      for (const p of msg.parts) {
        if (p.kind === 'usage') t += (p.outputTokens ?? 0)
        if (p.kind === 'turn_summary') t += (p.outputTokens ?? 0)
      }
    }
    return sum + t
  }, 0)
  const totalCost = sessions.reduce((sum, s) => {
    const conv = getConversation(s.id)
    let t = 0
    for (const msg of conv.messages) {
      for (const p of msg.parts) {
        if (p.kind === 'turn_summary' && p.costUsd !== undefined) t += p.costUsd
        if (p.kind === 'usage' && p.costUsd !== undefined) t += p.costUsd
      }
    }
    return sum + t
  }, 0)

  if (totalIn === 0 && totalOut === 0) return null
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }

  return (
    <div className="flex items-center gap-3 text-[10.5px] tabular-nums text-ink-3">
      <span>↑ {fmt(totalIn)}</span>
      <span>↓ {fmt(totalOut)}</span>
      {totalCost > 0 && (
        <span className="text-accent/80">${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}</span>
      )}
    </div>
  )
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export function StationHome({
  onOpenSession,
}: {
  onOpenSession: (session: Session) => void
}) {
  const sessions = useStore((state) => state.sessions)
  const loading = useStore((state) => state.sessionsLoading)
  const providers = useStore((state) => state.providers)
  const starred = useStore((state) => state.starred)
  const createSession = useStore((state) => state.createSession)
  const connection = useStore((state) => state.connection)

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [launchError, setLaunchError] = useState<string>()

  const starredSet = useMemo(() => new Set(starred), [starred])
  const readyProviders = useMemo(
    () => providers.filter((p) => p.state === 'ready'),
    [providers],
  )

  const openSession = useStore((state) => state.openSession)
  useEffect(() => {
    for (const session of sessions) {
      if (session.status !== 'waiting_for_approval' && session.status !== 'waiting_for_input' && session.status !== 'error') continue
      if (getConversation(session.id).messages.length > 0) continue
      void openSession(session.id)
    }
  }, [sessions, openSession])

  const withStates = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== 'archived')
        .map((session) => ({
          session,
          uiState: sessionUIState(session, getConversation(session.id), connection),
        })),
    [sessions, connection],
  )

  const counts = useMemo(() => {
    let running = 0
    let attention = 0
    let ended = 0
    for (const { uiState: u } of withStates) {
      if (u === 'working' || u === 'starting' || u === 'resuming') running += 1
      if (u === 'approval' || u === 'input' || u === 'failed') attention += 1
      if (u === 'ended' || u === 'paused') ended += 1
    }
    return { running, attention, ended, total: withStates.length }
  }, [withStates])

  const attentionList = useMemo(
    () =>
      withStates
        .filter(({ uiState: u }) => u === 'approval' || u === 'failed' || u === 'input')
        .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at)),
    [withStates],
  )

  const activeList = useMemo(
    () =>
      withStates
        .filter(({ uiState: u }) => u === 'working' || u === 'starting' || u === 'resuming')
        .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at)),
    [withStates],
  )

  const filtered = useMemo(() => {
    let list = [...withStates]
    if (filter === 'active') {
      list = list.filter(({ uiState: u }) => u === 'working' || u === 'starting' || u === 'resuming' || u === 'approval' || u === 'input')
    } else if (filter === 'attention') {
      list = list.filter(({ uiState: u }) => u === 'approval' || u === 'failed' || u === 'input')
    } else if (filter === 'starred') list = list.filter(({ session }) => starredSet.has(session.id))

    const needle = search.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        ({ session: s }) =>
          s.name.toLowerCase().includes(needle) ||
          s.agent.toLowerCase().includes(needle) ||
          (s.project ?? '').toLowerCase().includes(needle) ||
          (previewFor(s.id) ?? '').toLowerCase().includes(needle),
      )
    }

    return list.sort(
      (a, b) =>
        uiStateRank(a.uiState) - uiStateRank(b.uiState) ||
        b.session.updated_at.localeCompare(a.session.updated_at),
    )
  }, [withStates, filter, search, starredSet])

  function quickLaunch(provider: Provider) {
    setLaunchError(undefined)
    void createSession({ agent: provider.id })
      .then(onOpenSession)
      .catch((cause) =>
        setLaunchError(cause instanceof Error ? cause.message : `Could not start ${provider.name}`),
      )
  }

  useEffect(() => {
    function onKey(keyEvent: KeyboardEvent) {
      if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === 'k') {
        keyEvent.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'active', label: counts.running > 0 ? `Active · ${counts.running}` : 'Active' },
    { id: 'attention', label: counts.attention > 0 ? `Attention · ${counts.attention}` : 'Attention' },
    { id: 'starred', label: 'Starred' },
  ]

  const showAttention = attentionList.length > 0
  const showActive = activeList.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin">
      {/* ── Hero header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-line/60 bg-canvas/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-5 sm:px-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">
                AgentDeck
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-line px-2.5 py-0.5 text-[10.5px] font-medium text-ink-2">
                <Dot tone={connection === 'connected' ? 'green' : connection === 'connecting' || connection === 'reconnecting' ? 'orange' : 'red'} pulse={connection === 'reconnecting'} />
                {connection === 'connected' ? 'Online' : 'Offline'}
              </span>
            </div>
            <p className="text-[12.5px] text-ink-3">
              {counts.running} running · {counts.attention} need you · {counts.total} total
              <span className="mx-1.5 text-ink-3/40">·</span>
              <TotalUsage sessions={sessions} />
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)} className="shrink-0">
            <Plus />
            New session
          </Button>
        </div>
        {/* Launch rail */}
        {readyProviders.length > 0 ? (
          <div className="scroll-thin flex items-center gap-2 overflow-x-auto border-t border-line/40 px-6 py-2.5 sm:px-8" aria-label="Quick launch">
            <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">Launch</span>
            {readyProviders.map((provider) => {
              const hue = hueFor(provider.id)
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => quickLaunch(provider)}
                  title={`Launch ${provider.name}`}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface/80 pl-1.5 pr-3',
                    'text-[11.5px] font-medium text-ink-2 transition-all duration-150',
                    'hover:border-line-strong hover:bg-hover hover:text-ink active:scale-[0.97]',
                  )}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: hue }} aria-hidden />
                  {provider.name}
                </button>
              )
            })}
          </div>
        ) : null}
      </header>

      {launchError ? (
        <div role="alert" className="flex items-start gap-2 border-b border-red/20 bg-red/[0.04] px-6 py-2.5 text-[11.5px] sm:px-8">
          <span className="min-w-0 flex-1">{launchError}</span>
          <button type="button" onClick={() => setLaunchError(undefined)} aria-label="Dismiss" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      ) : null}

      {/* ── Attention ───────────────────────────────────────────────────── */}
      {showAttention ? (
        <section aria-label="Needs your attention" className="shrink-0 px-6 sm:px-8">
          <div className="flex items-center justify-between gap-2 border-b border-line/40 pb-1 pt-5">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-orange">
              Needs you · {attentionList.length}
            </h2>
          </div>
          <div className="flex flex-col">
            {attentionList.map(({ session }) => (
              <AttentionRow key={session.id} session={session} onOpen={() => onOpenSession(session)} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Active agents ──────────────────────────────────────────────── */}
      {showActive ? (
        <section aria-label="Active agents" className="shrink-0 px-6 pt-5 sm:px-8">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-accent/80">
            Running now · {activeList.length}
          </h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {activeList.map(({ session }) => (
              <ActiveCard key={session.id} session={session} onOpen={() => onOpenSession(session)} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Roster ─────────────────────────────────────────────────────── */}
      <section aria-label="Sessions" className="min-h-0 shrink-0 pb-6">
        <div className="flex items-center gap-2 px-6 pb-1 pt-5 sm:px-8">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
            Sessions{filter === 'all' && !search ? '' : ` · ${filtered.length}`}
          </h2>
          <div role="tablist" aria-label="Filter sessions" className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {filters.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                className={cn(
                  'h-6 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] transition-all duration-150 sm:text-[11.5px]',
                  filter === entry.id ? 'bg-surface border border-line-strong text-ink' : 'text-ink-3 hover:bg-hover-2 hover:text-ink-2',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="hidden w-56 shrink-0 sm:block">
            <TextField
              value={search}
              onChange={(changeEvent) => setSearch(changeEvent.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              leading={<Search size={12} />}
            />
          </div>
        </div>
        <div className="sm:px-4">
          {filtered.length > 0 ? (
            <div className="sticky top-[57px] z-10 hidden grid-cols-[minmax(0,2.4fr)_120px_minmax(0,1fr)_70px_28px] gap-x-3 border-b border-line/40 bg-canvas/95 px-4 py-1.5 text-[9.5px] uppercase tracking-[0.14em] text-ink-3 backdrop-blur-sm md:grid">
              <span>Session</span>
              <span>Agent</span>
              <span>Project</span>
              <span className="text-right">Activity</span>
              <span />
            </div>
          ) : null}
          {loading && sessions.length === 0 ? (
            <div className="py-16 text-center">
              <Dots label="Loading sessions…" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={sessions.length === 0 ? 'No sessions' : 'Nothing here'}
              description={
                sessions.length === 0
                  ? 'Launch an agent above, or import the sessions your CLIs already have.'
                  : 'Try another filter.'
              }
              action={
                sessions.length === 0 ? (
                  <Button onClick={() => setSyncing(true)}>
                    <SyncIcon size={12} />
                    Import from CLIs
                  </Button>
                ) : undefined
              }
            />
          ) : (
            filtered.map(({ session }) => (
              <RosterRow key={session.id} session={session} onOpen={() => onOpenSession(session)} />
            ))
          )}
        </div>
      </section>

      <NewSessionLayer open={creating} onClose={() => setCreating(false)} onCreated={onOpenSession} />
      <SyncLayer open={syncing} onClose={() => setSyncing(false)} />
    </div>
  )
}

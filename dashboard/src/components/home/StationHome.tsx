/**
 * StationHome — Mission Control, rebuilt as a deep module.
 *
 * Subject: a solo dev's fleet of 3-15 concurrent agents.
 * Job: triage — what needs you now, what's moving, what's next.
 * Audience: the dev, not the agent.
 *
 * Deep module: all ranking/headline/preview logic lives in
 * `dashboard/src/lib/homeView.ts` (one public function). This file
 * is the visual adapter: it maps HomeView → JSX and owns layout
 * and interaction, not derivation.
 *
 * Visual thesis: the fleet's state is the hero. A single large
 * "need you" number + a compact system strip tells the truth
 * faster than a paragraph. The signature is the *triage timeline*:
 * a vertical rule with state-colored dots and left-border tints
 * that lets the eye scan for orange/red without reading.
 *
 * Tokens: deep navy canvas #080A0F, surface #11131A, field #171A23,
 * ink #F1F1F3 / #9AA0AE / #6B7280, accent #3B82F6 (interactive),
 * signal #F59E0B (attention), success #10B981, danger #EF4444.
 * Type: IBM Plex Sans 600 for hero, 500 for names, JetBrains Mono
 * for projects/ids/metrics. One motion: the live dot breathes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, RotateCcw, Settings } from 'lucide-react'
import { NewSessionLayer } from '../SessionList'
import { SyncLayer } from '../SyncSessions'
import { Button, ChevronDown, Dot, Dots, DropdownList, EmptyState, Plus, Search, StatusPill, TextField } from '../ui'
import { workspaceApi } from '@/lib/api'
import LoadingState, { LoadingStateMini } from '../LoadingState'
import { getConversation, useStore } from '@/store'
import { basename, cn, relativeTime } from '@/lib/format'
import { uiStateDisplay } from '@/lib/sessionState'
import { describeApproval } from '@/lib/approvals'
import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import type { Session } from '@/types/session'
import type { Provider } from '@/types/provider'

const AGENT_HUES = ['#8eadbf', '#a78bfa', '#c7a56a', '#e3a15d', '#d9b554', '#f472b6']
function hueFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AGENT_HUES[h % AGENT_HUES.length]
}

function useSharedNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function Chevron() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3" aria-hidden>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

// Re-use helpers that are still visual-only
function openApprovalOf(sessionId: string) {
  const conv = getConversation(sessionId)
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    for (let p = conv.messages[i].parts.length - 1; p >= 0; p--) {
      const part = conv.messages[i].parts[p] as { kind: string; decision?: string; requestId?: string; prompt?: string; options?: unknown[] }
      if (part.kind === 'approval' && part.decision === undefined) return part as { requestId: string; prompt: string; options: unknown[] }
    }
  }
  return undefined
}

export function StationHome({
  onOpenSession,
  searchQuery,
  onSearchQueryChange,
  newTaskTick,
}: {
  onOpenSession: (s: Session) => void
  searchQuery?: string
  onSearchQueryChange?: (v: string) => void
  newTaskTick?: number
}) {
  const sessions = useStore((s) => s.sessions)
  const loading = useStore((s) => s.sessionsLoading)
  const providers = useStore((s) => s.providers)
  const starred = useStore((s) => s.starred)
  const connection = useStore((s) => s.connection)
  const notices = useStore((s) => s.notices)
  const revisions = useStore((s) => s.revisions)
  const createSession = useStore((s) => s.createSession)
  const openSession = useStore((s) => s.openSession)
  const respondToApproval = useStore((s) => s.respondToApproval)
  const resumeSession = useStore((s) => s.resumeSession)
  const toggleStar = useStore((s) => s.toggleStar)
  const archiveSession = useStore((s) => s.archiveSession)
  const restoreSession = useStore((s) => s.restoreSession)

  const [filter, setFilter] = useState<HomeFilter>('all')
  const [internalSearch, setInternalSearch] = useState('')
  const search = searchQuery ?? internalSearch
  const setSearch = onSearchQueryChange ?? setInternalSearch
  const [creating, setCreating] = useState(false)
  const [createProject, setCreateProject] = useState<string | undefined>(undefined)
  const [syncing, setSyncing] = useState(false)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launchError, setLaunchError] = useState<string>()
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const starredSet = useMemo(() => new Set(starred), [starred])
  const readyProviders = useMemo(() => providers.filter((p) => p.state === 'ready'), [providers])
  const providerNameFor = useMemo(() => {
    const m = new Map(providers.map((p) => [p.id, p.name] as const))
    return (id: string) => m.get(id) ?? id
  }, [providers])

  // Hydrate conversations that are in attention but empty
  useEffect(() => {
    for (const s of sessions) {
      if (s.status !== 'waiting_for_approval' && s.status !== 'waiting_for_input' && s.status !== 'error' && s.status !== 'needs_resume') continue
      if (getConversation(s.id).messages.length > 0) continue
      void openSession(s.id)
    }
  }, [sessions, openSession])

  // Subscribe to conversation revisions so headlines/previews stay live
  // (deriveHomeView reads getConversation, which is mutated in place)
  const revisionTick = useMemo(() => Object.values(revisions).join(','), [revisions])
  // Deep module derives everything in one call
  const nowTick = useSharedNow(true) // always tick for idleFor; cheap (1 interval)
  const view = useMemo(
    () =>
      deriveHomeView({
        sessions,
        connection,
        search,
        filter,
        starredSet,
        getConversation,
        providerNameFor,
        notices,
        now: nowTick,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, search, filter, starredSet, providerNameFor, notices, nowTick, revisionTick],
  )

  // Separate tick for active cards (shared) — reuse nowTick to keep one interval

  function quickLaunch(p: Provider) {
    setLaunchError(undefined)
    void createSession({ agent: p.id })
      .then(onOpenSession)
      .catch((e) => setLaunchError(e instanceof Error ? e.message : `Could not start ${p.name}`))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (newTaskTick && newTaskTick > 0) setCreating(true)
  }, [newTaskTick])

  const filters: Array<{ id: HomeFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'active', label: view.counts.running ? `Active · ${view.counts.running}` : 'Active' },
    { id: 'attention', label: view.counts.attention ? `Attention · ${view.counts.attention}` : 'Attention' },
    { id: 'starred', label: 'Starred' },
    { id: 'archived', label: view.counts.archived ? `Archived · ${view.counts.archived}` : 'Archived' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin bg-[#191613]">
      {/* Distinctive top bar — control deck header, not a hero */}
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#191613]/90 backdrop-blur-xl">
        <div className="relative overflow-hidden">
          {/* Subtle grid signature — faint, not decorative */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)`, backgroundSize: '24px 24px' }} aria-hidden />
          <div className="relative flex items-center gap-3 px-4 py-3.5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-lg bg-white text-[12px] font-bold tracking-[-0.02em] text-black">◐</span>
              <div className="flex flex-col">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Control Deck</span>
                <span className="hidden text-[13px] font-semibold tracking-[-0.01em] text-white sm:block">
                  {view.workspaces[0]?.name ?? 'Workspaces'} <span className="font-normal text-zinc-500">· {view.workspaces.length} projects · {view.counts.total} sessions</span>
                </span>
              </div>
              <span className="ml-2 hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] sm:inline-flex">
                <span className={cn('size-1.5 rounded-full', view.counts.attention > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500')} />
                <span className={view.counts.attention > 0 ? 'font-medium text-amber-400' : 'text-zinc-400'}>{view.counts.attention > 0 ? `${view.counts.attention} need you` : 'all clear'}</span>
                <span className="text-white/20">·</span>
                <span className="text-zinc-400">{view.counts.running} live</span>
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-1.5 text-[11px] text-zinc-500 sm:inline-flex">
                <Dot tone={connection === 'connected' ? 'green' : 'red'} pulse={connection === 'reconnecting'} />
                {connection === 'connected' ? 'Live' : 'Offline'}
              </span>
              <button
                type="button"
                onClick={() => setLaunchOpen(true)}
                className="hidden h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/10 active:scale-[0.98] sm:inline-flex"
              >
                Quick launch
                <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] leading-none text-black">{readyProviders.length}</span>
              </button>
              <Button
                variant="primary"
                onClick={() => {
                  setCreateProject(undefined)
                  setCreating(true)
                }}
                className="h-8 min-h-0 gap-1.5 bg-white px-3.5 text-[12px] font-semibold text-black hover:bg-zinc-200 active:scale-[0.98]"
              >
                <Plus size={12} /> New
              </Button>
            </div>
          </div>
        </div>
        {/* Subtle filter bar — not a hero, just context */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] bg-white/[0.02] px-4 py-2 sm:px-6">
          <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">
            {view.counts.total} sessions · {view.counts.paused > 0 ? `${view.counts.paused} paused · ` : ''}press <kbd className="rounded bg-white/10 px-1 py-0.5 font-mono text-[10px]">⌘K</kbd> to filter
          </span>
          <span className="font-mono text-[11px] text-zinc-500 sm:hidden">{view.workspaces.length} workspaces</span>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
            <span className="size-1.5 rounded-full bg-emerald-500/60" /> system live
          </span>
        </div>
        {launchError ? (
          <div role="alert" className="flex items-center gap-2 border-t border-red/20 bg-red/10 px-4 py-2 text-[12px] text-red sm:px-6 lg:px-8">
            <span className="flex-1">{launchError}</span>
            <button type="button" onClick={() => setLaunchError(undefined)} className="rounded p-1 hover:bg-red/10">
              ✕
            </button>
          </div>
        ) : null}
      </header>

      {/* Body: 12-col grid — left triage, right detail */}
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-12 gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Left: triage timeline */}
        <div className="col-span-12 lg:col-span-5">
          <div className="sticky top-[168px] space-y-6">
            <section aria-label="Needs your attention">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Triage — needs you</h2>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-600">{view.attention.length}</span>
              </div>
              {view.attention.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface/30 p-6 text-center">
                  <p className="text-[13px] font-medium text-ink">All clear</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-3">No sessions need you right now.</p>
                </div>
              ) : (
                <div className="relative rounded-xl border border-line bg-surface/50">
                  {/* vertical rule */}
                  <div className="pointer-events-none absolute bottom-4 left-[19px] top-4 w-px bg-line/60" aria-hidden />
                  <ul className="divide-y divide-line/40">
                    {view.attention.map(({ session, uiState, headline, providerName, idleFor }) => {
                      const isPaused = uiState === 'paused'
                      const isFailed = uiState === 'failed'
                      const tone = isFailed ? 'bg-red' : isPaused ? 'bg-amber-500' : 'bg-orange'
                      const isBusy = !!busyMap[session.id]
                      const approval = uiState === 'approval' ? openApprovalOf(session.id) : undefined
                      const viewApproval = approval ? describeApproval(approval.prompt, approval.options as unknown as string[]) : undefined
                      const allow = (viewApproval as { options?: Array<{ kind: string; label: string; value: string }> } | undefined)?.options?.find((o) => o.kind === 'allow')
                      return (
                        <li key={session.id} className="relative flex gap-3 p-4">
                          <span className={cn('relative mt-1 size-2 shrink-0 rounded-full ring-4 ring-canvas', tone)} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-ink">{session.name}</span>
                              <span className="hidden truncate font-mono text-[11px] text-ink-3 sm:inline">
                                · {providerName} {session.project ? `· ${basename(session.project)}` : ''}
                              </span>
                              <StatusPill label={uiStateDisplay(uiState).label} tone={uiStateDisplay(uiState).tone} pulse={uiStateDisplay(uiState).pulse} className="h-5 px-1.5 text-[10px]" />
                            </div>
                            <p className="mt-1 line-clamp-2 font-mono text-[11.5px] leading-[1.45] text-ink-3" title={headline}>
                              {headline}
                            </p>
                            {idleFor && (isPaused || isFailed) ? <p className="mt-1 font-mono text-[10px] text-ink-3/80">{idleFor} ago</p> : null}
                          </div>
                          <div className="ml-2 flex shrink-0 flex-col gap-1.5">
                            {isFailed ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setBusyMap((m) => ({ ...m, [session.id]: true }))
                                  void resumeSession(session.id).finally(() => setBusyMap((m) => ({ ...m, [session.id]: false })))
                                }}
                                className="inline-flex h-8 items-center justify-center rounded-full border border-line bg-canvas px-3 text-[11px] font-medium hover:bg-hover disabled:opacity-40"
                              >
                                {isBusy ? 'Retrying…' : 'Retry'}
                              </button>
                            ) : isPaused ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setBusyMap((m) => ({ ...m, [session.id]: true }))
                                  void resumeSession(session.id).finally(() => setBusyMap((m) => ({ ...m, [session.id]: false })))
                                }}
                                className="inline-flex h-8 items-center justify-center rounded-full bg-accent px-4 text-[11px] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40"
                              >
                                {isBusy ? 'Resuming…' : 'Resume'}
                              </button>
                            ) : approval && allow ? (
                              <button
                                type="button"
                                onClick={() => respondToApproval(session.id, approval.requestId, allow.value)}
                                className="inline-flex h-8 items-center justify-center rounded-full bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent-hover"
                              >
                                {allow.label}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => onOpenSession(session)}
                              className="inline-flex h-7 items-center justify-center rounded-full bg-surface px-3 text-[11px] font-medium text-ink-2 ring-1 ring-line hover:bg-hover hover:text-ink"
                            >
                              Open <Chevron />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </section>

            {/* Active now — compact, same timeline */}
            <section aria-label="Active">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Active — {view.active.length} running</h2>
              {view.active.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line bg-surface/30 p-4 text-center font-mono text-[11px] text-ink-3">No agents running.</p>
              ) : (
                <div className="grid gap-2">
                  {view.active.map(({ session, task, runtime }) => {
                    const conv = getConversation(session.id)
                    const act = conv.activity
                    const provider = providers.find((p) => p.id === session.agent)
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => onOpenSession(session)}
                        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-line-strong hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink">{session.name}</span>
                          <span className="block truncate font-mono text-[11px] text-ink-3">
                            {provider?.name ?? session.agent} · {session.project ? basename(session.project) : 'no project'}
                          </span>
                          {task ? <span className="mt-1 line-clamp-1 block font-mono text-[11px] text-ink-3">{task}</span> : null}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <LoadingStateMini label={act?.label ?? 'Working'} variant="Dots" />
                          <span className="font-mono text-[10px] tabular-nums text-ink-3">{act?.detail ?? runtime}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Right: workspaces — grouped sessions */}
        <div className="col-span-12 lg:col-span-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
              Workspaces · {view.workspaces.length} <span className="font-normal text-ink-3">· {view.filtered.length} sessions</span>
            </h2>
            <div className="flex items-center gap-2">
              <div role="tablist" className="flex items-center gap-1 rounded-full bg-inset p-1 ring-1 ring-line">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      'rounded-full px-3 py-1 text-[11px] font-medium transition',
                      filter === f.id ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3">
            <TextField
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces, sessions, agents…"
              aria-label="Search sessions"
              leading={<Search size={14} />}
            />
          </div>

          <div className="mt-4 space-y-4">
            {loading && sessions.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface/40 p-8 text-center">
                <div className="flex justify-center">
                  <LoadingState label="Loading workspaces" variant="Drive" />
                </div>
              </div>
            ) : view.workspaces.length === 0 ? (
              <EmptyState
                title={sessions.length === 0 ? 'No workspaces yet' : 'No matches'}
                description={sessions.length === 0 ? 'Create a workspace by launching an agent in a project folder.' : 'Try another filter or clear search.'}
                action={
                  sessions.length === 0 ? (
                    <Button onClick={() => setSyncing(true)}>
                      <Search size={12} /> Import from CLIs
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              view.workspaces.map((ws) => {
                const isCollapsed = !!collapsed[ws.id]
                return (
                  <div key={ws.id} className="overflow-hidden rounded-xl border border-line bg-surface/40">
                    {/* Workspace header — collapsible */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setCollapsed((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))}
                      onKeyDown={(e) => e.key === 'Enter' && setCollapsed((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))}
                      aria-expanded={!isCollapsed}
                      className="flex w-full cursor-pointer items-center gap-3 bg-inset/60 px-4 py-3 text-left transition hover:bg-hover/20"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface ring-1 ring-line">
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-ink-3" aria-hidden>
                          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-ink">{ws.name}</span>
                          <span className="hidden rounded-full bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-3 ring-1 ring-line sm:inline">{ws.counts.total} sessions</span>
                          {ws.counts.attention > 0 ? <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-600">{ws.counts.attention} need you</span> : null}
                          {ws.counts.running > 0 ? <span className="hidden items-center gap-1 rounded-full bg-green/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-green sm:inline-flex"><span className="size-1 rounded-full bg-accent animate-pulse" /> {ws.counts.running} running</span> : null}
                        </div>
                        <p className="truncate font-mono text-[11px] text-ink-3">{ws.project ?? 'No folder — inbox'}</p>
                      </div>
                      <span className="hidden shrink-0 items-center gap-2 sm:flex">
                        <WorkspaceMenuButton project={ws.project} />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCreateProject(ws.project ?? undefined)
                            setCreating(true)
                          }}
                          className="rounded-full border border-line bg-canvas px-3 py-1 text-[11px] font-medium text-ink-2 transition hover:bg-hover hover:text-ink active:scale-[0.98]"
                        >
                          + New session
                        </button>
                        <span className={cn('rounded p-1 text-ink-3 transition-transform', isCollapsed && 'rotate-180')}>
                          <ChevronDown size={14} />
                        </span>
                      </span>
                      {/* Mobile chevron only */}
                      <span className={cn('ml-auto shrink-0 rounded p-1 text-ink-3 transition-transform sm:hidden', isCollapsed && 'rotate-180')}>
                        <ChevronDown size={14} />
                      </span>
                    </div>
                    {/* Sessions inside workspace — collapsible */}
                    {!isCollapsed ? (
                      <ul className="divide-y divide-line/40 animate-fade">
                        {ws.sessions.map(({ session, uiState }) => {
                          const conv = getConversation(session.id)
                          const provider = providers.find((p) => p.id === session.agent)
                          const preview = (() => {
                            for (let i = conv.messages.length - 1; i >= 0; i--) {
                              for (const part of conv.messages[i].parts) {
                                if (part.kind === 'text' && part.text.trim()) return part.text.trim().slice(0, 64)
                              }
                            }
                            return undefined
                          })()
                          const isStarred = starredSet.has(session.id)
                          return (
                            <li key={session.id}>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => onOpenSession(session)}
                                onKeyDown={(e) => e.key === 'Enter' && onOpenSession(session)}
                                className="group flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-hover/40"
                              >
                                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hueFor(session.agent) }} aria-hidden />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5">
                                    <span className="truncate text-[13px] font-medium text-ink">{session.name}</span>
                                    <StatusPill label={uiStateDisplay(uiState).label} tone={uiStateDisplay(uiState).tone} pulse={uiStateDisplay(uiState).pulse} className="h-5 px-1.5 text-[10px]" />
                                    <button
                                      type="button"
                                      aria-label={isStarred ? 'Unstar' : 'Star'}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        toggleStar(session.id)
                                      }}
                                      className={cn('rounded p-1 text-ink-3 hover:text-amber-500', isStarred ? 'text-amber-500 opacity-100' : 'opacity-30 group-hover:opacity-100')}
                                    >
                                      ★
                                    </button>
                                    {filter === 'archived' ? (
                                      <button
                                        type="button"
                                        aria-label={`Restore ${session.name}`}
                                        title="Restore from archive"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void restoreSession(session.id).catch(() => {})
                                        }}
                                        className="rounded p-1 text-ink-3 opacity-30 transition hover:bg-hover-2 hover:text-ink group-hover:opacity-100"
                                      >
                                        <RotateCcw size={12} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        aria-label={`Archive ${session.name}`}
                                        title="Archive session"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void archiveSession(session.id).catch(() => {})
                                        }}
                                        className="rounded p-1 text-ink-3 opacity-30 transition hover:bg-hover-2 hover:text-ink group-hover:opacity-100"
                                      >
                                        <Archive size={12} />
                                      </button>
                                    )}
                                  </span>
                                  <span className="block truncate font-mono text-[11px] text-ink-3">{preview ?? uiStateDisplay(uiState).label}</span>
                                </span>
                                <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[11px] text-ink-2 sm:flex">
                                  <span className="size-1.5 rounded-full" style={{ backgroundColor: hueFor(session.agent) }} /> {provider?.name ?? session.agent}
                                </span>
                                <span className="hidden shrink-0 font-mono text-[11px] text-ink-3 sm:block">{relativeTime(session.updated_at)}</span>
                                <Chevron />
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Quick launch popup — replaces the old rail */}
      {launchOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={() => setLaunchOpen(false)} className="absolute inset-0 bg-canvas/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="text-[13px] font-semibold text-ink">Quick launch</h3>
                <p className="font-mono text-[11px] text-ink-3">Pick an agent to start in this workspace</p>
              </div>
              <button type="button" onClick={() => setLaunchOpen(false)} className="rounded-full p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {readyProviders.length === 0 ? (
                <p className="p-4 font-mono text-[12px] text-ink-3">No agent is ready. Install a CLI first.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {readyProviders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setLaunchOpen(false)
                        quickLaunch(p)
                      }}
                      className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3 text-left transition hover:border-accent/30 hover:bg-hover active:scale-[0.99]"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 ring-1 ring-accent/15">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: hueFor(p.id) }} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-ink">{p.name}</span>
                        <span className="block truncate font-mono text-[11px] text-ink-3">{p.id} · {p.version ?? 'ready'}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-ink">Launch</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="font-mono text-[11px] text-ink-3">{readyProviders.length} agents available</span>
                <Button variant="ghost" onClick={() => { setLaunchOpen(false); setCreating(true) }}>
                  Advanced… <Chevron />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <NewSessionLayer open={creating} onClose={() => { setCreating(false); setCreateProject(undefined) }} onCreated={onOpenSession} initialProject={createProject} />
      <SyncLayer open={syncing} onClose={() => setSyncing(false)} />
    </div>
  )
}

/** Workspace menu: a gear button opening the workspace-level settings,
 *  currently the Workspace Memory toggle. Positioned on the workspace card
 *  header next to "+ New session". */
function WorkspaceMenuButton({ project }: { project: string | null }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="Workspace settings"
        title="Workspace settings"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
      >
        <Settings size={13} />
      </button>
      {open ? (
        <DropdownList anchorRef={anchorRef} onClose={() => setOpen(false)} width={280}>
          <div className="flex flex-col gap-3 p-3">
            <div>
              <p className="text-[12.5px] font-semibold text-ink">Workspace Memory</p>
              <p className="mt-0.5 text-[11px] leading-[1.6] text-ink-3">
                Save and reuse long-term context in workspaces. Applies to new
                sessions and may increase model requests and token costs.
              </p>
            </div>
            {project ? (
              <WorkspaceMemoryToggle project={project} />
            ) : (
              <p className="text-[11px] text-ink-3">
                Memory is available once the workspace has a project folder.
              </p>
            )}
          </div>
        </DropdownList>
      ) : null}
    </>
  )
}

/** The Workspace Memory on/off switch. Reads and writes the per-project
 *  `.agentdeck/memory.toml` setting through the daemon. */
function WorkspaceMemoryToggle({ project }: { project: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    workspaceApi
      .memoryConfig(project)
      .then((config) => {
        if (!cancelled) setEnabled(config.enabled)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load')
      })
    return () => {
      cancelled = true
    }
  }, [project])

  const toggle = async (next: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      await workspaceApi.setMemoryConfig(project, next)
      setEnabled(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (enabled === null) {
    return <Dots />
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Workspace memory"
        disabled={busy}
        onClick={() => void toggle(!enabled)}
        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-2.5 py-2 text-left transition-colors hover:bg-hover/40 disabled:opacity-60"
      >
        <span className="text-[12px] font-medium text-ink">
          {enabled ? 'On — context is remembered' : 'Off — no cross-session recall'}
        </span>
        <span
          aria-hidden
          className={cn(
            'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150',
            enabled ? 'bg-accent' : 'bg-line-strong',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-3 rounded-full bg-white transition-all duration-150',
              enabled ? 'left-3.5' : 'left-0.5',
            )}
          />
        </span>
      </button>
      {error ? <p className="text-[10.5px] text-red">{error}</p> : null}
    </div>
  )
}

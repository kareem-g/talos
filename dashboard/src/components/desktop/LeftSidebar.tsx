/**
 * LeftSidebar — the session navigator, ~280px fixed.
 *
 * Top-to-bottom information hierarchy (the OpenCode layout order):
 *   1. Project selector dropdown — which workspace's sessions + branches show.
 *   2. Active branch + change stats (+added −removed) + uncommitted count.
 *   3. Sessions in this workspace — "+ New task" button, then a scrollable
 *      list of session rows (name + relative time + status dot).
 *   4. Search bar — filters the session list, pinned above it.
 *
 * Branch data comes from /api/git/branches; session data from the store. Both
 * are real daemon-backed sources, never hardcoded.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Folder, GitBranch as GitBranchIcon, MessagesSquare, Plus, RefreshCw, Search } from 'lucide-react'
import { gitApi, type GitBranch } from '@/lib/api'
import { getConversation, useStore } from '@/store'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState, isInternalSession } from '@/lib/sessionState'
import { NewSessionLayer } from '@/components/SessionList'
import { RoomsSection } from './RoomsSection'
import type { Session } from '@/types/session'

interface BranchStats {
  current?: string
  changed: number
  added: number
  removed: number
}

/** A branch as rendered in the sidebar, with refs normalized and deduped. */
interface BranchEntry {
  /** Clean display name (no refs/heads/, refs/remotes/ or stray ref/ prefixes). */
  name: string
  /** Original name from the API — what checkout actually needs. */
  raw: string
  current: boolean
  origin: boolean
}

/**
 * Normalize a ref name for display, stripping each known prefix exactly once.
 * Guards against the ref/ref/… double-prefix bug: if the daemon ever hands back
 * a full ref ("refs/heads/x") or a half-stripped one ("ref/refs/heads/x"),
 * the display stays clean.
 */
function normalizeBranchName(raw: string): string {
  let name = raw.trim()
  name = name.replace(/^refs\/(heads|remotes|tags)\//, '')
  name = name.replace(/^refs\//, '')
  name = name.replace(/^ref\//, '')
  return name
}

/** Collapse local + remote-tracking views of the same branch into one row. */
function dedupeBranches(branches: GitBranch[]): BranchEntry[] {
  const byName = new Map<string, BranchEntry>()
  for (const branch of branches) {
    const name = normalizeBranchName(branch.name)
    const origin =
      /^refs\/remotes\//.test(branch.name) || branch.name.startsWith('origin/')
    const existing = byName.get(name)
    // Prefer the current branch, then local over remote, then first-seen.
    if (existing && (existing.current || (!origin && existing.origin))) continue
    byName.set(name, { name, raw: branch.name, current: branch.current ?? false, origin })
  }
  return [...byName.values()].sort((a, b) => {
    if (a.current) return -1
    if (b.current) return 1
    return a.name.localeCompare(b.name)
  })
}

export function LeftSidebar({
  session,
  onSelect,
  searchRef,
}: {
  session: Session
  onSelect: (id: string) => void
  /** Ref for the search input, so the right-panel Search icon can focus it. */
  searchRef?: React.RefObject<HTMLInputElement | null>
}) {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const deleteSession = useStore((s) => s.deleteSession)

  /* ── Project (workspace) selector ─────────────────────────────────────── */
  const [activeWorkspace, setActiveWorkspace] = useState<string>(session.project ?? '__inbox__')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const workspaces = useMemo(() => {
    const grouped = new Map<string, Session[]>()
    for (const s of sessions) {
      if (s.status === 'archived' || isInternalSession(s)) continue
      const key = s.project ?? '__inbox__'
      grouped.set(key, [...(grouped.get(key) ?? []), s])
    }
    return [...grouped.entries()].map(([key, items]) => ({
      key,
      name: key === '__inbox__' ? 'Inbox' : (key.split('/').pop() ?? key),
      count: items.length,
    }))
  }, [sessions])

  useEffect(() => {
    setActiveWorkspace(session.project ?? '__inbox__')
  }, [session.project])

  const activeMeta = workspaces.find((w) => w.key === activeWorkspace)
  const projectPath = activeWorkspace === '__inbox__' ? '' : activeWorkspace

  /* ── Search ──────────────────────────────────────────────────────────── */
  const [query, setQuery] = useState('')

  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sessions
      .filter((s) => s.status !== 'archived' && !isInternalSession(s) && (s.project ?? '__inbox__') === activeWorkspace)
      .filter(
        (s) =>
          !needle ||
          [s.name, s.agent, s.project ?? ''].some((v) => v.toLowerCase().includes(needle)),
      )
      .map((s) => ({ session: s, uiState: sessionUIState(s, getConversation(s.id), connection) }))
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
  }, [sessions, connection, activeWorkspace, query])

  /* ── Branch state for this workspace ──────────────────────────────────── */
  const [branchStats, setBranchStats] = useState<BranchStats | null>(null)
  const [branches, setBranches] = useState<BranchEntry[]>([])
  const [gitBusy, setGitBusy] = useState(false)

  const refreshBranch = useCallback(async () => {
    if (!projectPath) {
      setBranchStats(null)
      setBranches([])
      return
    }
    setGitBusy(true)
    try {
      const data = await gitApi.branches(projectPath)
      setBranchStats({ current: data.current, changed: data.changed_count, added: data.added, removed: data.removed })
      setBranches(dedupeBranches(data.branches ?? []))
    } catch {
      setBranchStats(null)
      setBranches([])
    } finally {
      setGitBusy(false)
    }
  }, [projectPath])

  useEffect(() => {
    void refreshBranch()
  }, [refreshBranch])

  const checkoutBranch = useCallback(
    async (branch: BranchEntry) => {
      if (!projectPath || branch.current || gitBusy) return
      setGitBusy(true)
      try {
        await gitApi.checkout(projectPath, branch.raw)
        await refreshBranch()
      } catch {
        /* best effort — the branch simply stays where it is */
      } finally {
        setGitBusy(false)
      }
    },
    [projectPath, gitBusy, refreshBranch],
  )

  /* ── New session ─────────────────────────────────────────────────────── */
  const [creating, setCreating] = useState(false)

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line/60 bg-[#0a0a0c] text-zinc-100">
      {/* 0. Plumb wordmark — the rail's identity header */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.05] px-3 pb-2.5 pt-2.5">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] ring-1 ring-inset ring-white/[0.1]"
        >
          <svg width="11" height="15" viewBox="0 0 11 15" fill="none" aria-hidden>
            <line x1="5.5" y1="1" x2="5.5" y2="8.5" stroke="#7dd3fc" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="5.5" cy="11.5" r="2.7" fill="#34d399" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] text-zinc-100">
          Plumb
        </span>
        <span
          aria-hidden
          title={connection === 'connected' ? 'Connected' : connection}
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            connection === 'connected' ? 'bg-emerald-400' : 'animate-pulse bg-orange-400',
          )}
        />
      </div>

      {/* 1. Project selector */}
      <div className="relative px-3 pb-2 pt-2.5">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          className="flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-left transition hover:border-white/[0.14] hover:bg-white/[0.07]"
        >
          <Folder size={13} className="shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-200">
            {activeMeta?.name ?? 'Inbox'}
          </span>
          <ChevronDown size={13} className={cn('shrink-0 text-zinc-500 transition-transform', dropdownOpen && 'rotate-180')} />
        </button>
        {dropdownOpen ? (
          <div role="listbox" aria-label="Workspaces" className="absolute left-3 right-3 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/[0.1] bg-[#141417] shadow-2xl">
            {workspaces.map((workspace) => (
              <button
                key={workspace.key}
                type="button"
                role="option"
                aria-selected={workspace.key === activeWorkspace}
                onClick={() => {
                  setActiveWorkspace(workspace.key)
                  setDropdownOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-2 text-left transition',
                  workspace.key === activeWorkspace ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.05]',
                )}
              >
                <Folder size={12} className="shrink-0 text-zinc-600" />
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{workspace.name}</span>
                <span className="font-mono text-[10px] text-zinc-600">{workspace.count}</span>
                {workspace.key === activeWorkspace ? <Check size={12} className="shrink-0 text-emerald-400" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 2. Search (pinned above sessions) */}
      <div className="px-3 py-2">
        <div className="flex h-7 items-center gap-1.5 rounded-xl border border-white/[0.07] bg-black/40 px-2 transition-colors focus-within:border-white/[0.18]">
          <Search size={12} className="shrink-0 text-zinc-600" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
      </div>

      {/* 3. Rooms — channels of workers the orchestrator fans tasks out to.
          Pinned above the session list (channel-first order). Clicking a room
          opens its channel as a native chat in the center. */}
      <RoomsSection session={{ id: session.id }} onSelect={onSelect} />

      {/* 4. Sessions header + new task */}
      <div className="flex items-center justify-between px-3 pb-1">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
          <MessagesSquare size={11} className="text-zinc-500" />
          Sessions{visibleSessions.length ? ` · ${visibleSessions.length}` : ''}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
          title="New task"
        >
          <Plus size={12} /> New task
        </button>
      </div>

      {/* 4. Session list */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visibleSessions.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-zinc-500">
            {query ? 'No sessions match.' : 'No sessions yet.'}
          </p>
        ) : (
          visibleSessions.map(({ session: s, uiState }) => {
            const active = s.id === session.id
            const attention = uiState === 'approval' || uiState === 'failed' || uiState === 'input'
            return (
              <div key={s.id} className="group relative mb-0.5 flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-xl py-2 pl-2 pr-7 text-left transition',
                      active
                        ? 'bg-white/[0.1] text-white ring-1 ring-inset ring-white/[0.08]'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
                    )}
                  >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      uiState === 'failed'
                        ? 'bg-red-400'
                        : ['working', 'starting', 'resuming'].includes(uiState)
                          ? 'bg-emerald-400'
                          : attention
                            ? 'bg-orange-400'
                            : 'bg-zinc-600',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{s.name}</span>
                  <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                    {relativeTime(s.updated_at).replace(' ago', '')}
                  </span>
                </button>
                {attention && !active ? (
                  <span className="absolute right-1 size-1.5 animate-pulse rounded-full bg-orange-400" aria-hidden />
                ) : null}
                {!active ? (
                  <button
                    type="button"
                    onClick={() => void deleteSession(s.id)}
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

      {/* 5. Git branch list — deduped, current branch with live diffstat */}
      {projectPath ? (
        <div className="shrink-0 border-t border-white/[0.07]">
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              <GitBranchIcon size={11} className="text-zinc-500" />
              Git branch
            </p>
            <button
              type="button"
              onClick={() => void refreshBranch()}
              disabled={gitBusy}
              title="Refresh branches"
              aria-label="Refresh branches"
              className="rounded-md p-1 text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-50"
            >
              <RefreshCw size={11} className={cn(gitBusy && 'animate-spin')} />
            </button>
          </div>
          <div className="scroll-thin max-h-[34%] min-h-0 overflow-y-auto px-2 pb-2">
            {branches.length === 0 ? (
              <p className="px-2 py-2 text-[10px] text-zinc-600">
                {branchStats ? 'No branches yet.' : 'Loading…'}
              </p>
            ) : (
              branches.map((branch) => {
                const active = branch.current
                return (
                  <button
                    key={branch.raw}
                    type="button"
                    onClick={() => void checkoutBranch(branch)}
                    disabled={active || gitBusy}
                    title={active ? 'Current branch' : `Check out ${branch.name}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
                      active
                        ? 'bg-white/[0.07] text-zinc-100'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        active ? 'bg-emerald-400' : branch.origin ? 'bg-zinc-600' : 'bg-zinc-700',
                      )}
                      aria-hidden
                    />
                    <span className={cn('min-w-0 flex-1 truncate font-mono text-[11px]', !active && 'text-zinc-400')}>
                      {branch.name}
                    </span>
                    {active && branchStats ? (
                      <span className="shrink-0 font-mono text-[9.5px] tabular-nums">
                        <span className="text-emerald-400">+{branchStats.added.toLocaleString()}</span>{' '}
                        <span className="text-red-400">−{branchStats.removed.toLocaleString()}</span>
                      </span>
                    ) : null}
                  </button>
                )
              })
            )}
            {branchStats && branchStats.changed > 0 ? (
              <p className="px-2 pb-1 pt-1.5 text-[10px] text-zinc-500">
                {branchStats.changed} uncommitted change{branchStats.changed === 1 ? '' : 's'}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* New session layer */}
      {creating ? (
        <NewSessionLayer
          open
          initialProvider={session.agent}
          initialProject={session.project ?? undefined}
          initialStep={2}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false)
            onSelect(created.id)
          }}
        />
      ) : null}
    </aside>
  )
}

function X({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

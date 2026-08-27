/**
 * Left sidebar for the session workspace, restyled after the homepage
 * workspaces sidebar: workspace dropdown + live search + real git branches.
 *
 * Branch data comes from /api/git/branches; clicking a branch really checks it
 * out (git checkout), and failures surface as an inline error row — never
 * silently.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Folder, GitBranch as GitBranchIcon, Plus, Search } from 'lucide-react'
import { gitApi, type GitBranch } from '@/lib/api'
import { getConversation, useStore } from '@/store'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState } from '@/lib/sessionState'
import { NewSessionLayer } from '@/components/SessionList'
import type { Session } from '@/types/session'

export function WorkspaceSwitcher({
  session,
  onSelect,
}: {
  session: Session
  onSelect: (id: string) => void
}) {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const [creating, setCreating] = useState(false)

  // Workspace = project directory. The dropdown switches which group's
  // sessions + branches are shown.
  const [activeWorkspace, setActiveWorkspace] = useState<string>(session.project ?? '__inbox__')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [query, setQuery] = useState('')

  const workspaces = useMemo(() => {
    const grouped = new Map<string, Session[]>()
    for (const s of sessions) {
      if (s.status === 'archived') continue
      const key = s.project ?? '__inbox__'
      grouped.set(key, [...(grouped.get(key) ?? []), s])
    }
    return [...grouped.entries()].map(([key, items]) => ({
      key,
      name: key === '__inbox__' ? 'Inbox' : (key.split('/').pop() ?? key),
      count: items.length,
    }))
  }, [sessions])

  // Keep the active workspace honest when the session itself switches.
  useEffect(() => {
    setActiveWorkspace(session.project ?? '__inbox__')
  }, [session.project])

  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sessions
      .filter((s) => s.status !== 'archived' && (s.project ?? '__inbox__') === activeWorkspace)
      .filter(
        (s) =>
          !needle ||
          [s.name, s.agent, s.project ?? ''].some((v) => v.toLowerCase().includes(needle)),
      )
      .map((s) => ({ session: s, uiState: sessionUIState(s, getConversation(s.id), connection) }))
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
  }, [sessions, connection, activeWorkspace, query])

  const activeMeta = workspaces.find((w) => w.key === activeWorkspace)
  const projectPath = activeWorkspace === '__inbox__' ? '' : activeWorkspace

  return (
    <>
      {/* Header: brand row */}
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">AgentDeck</span>
        <span className="font-mono text-[10px] text-zinc-600">{visibleSessions.length}</span>
      </div>

      {/* Workspace dropdown */}
      <div className="relative px-3 pb-2">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-2 text-left transition hover:bg-white/[0.07]"
        >
          <Folder size={13} className="shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-200">
            {activeMeta?.name ?? 'Inbox'}
          </span>
          <ChevronDown size={13} className={cn('shrink-0 text-zinc-500 transition-transform', dropdownOpen && 'rotate-180')} />
        </button>
        {dropdownOpen ? (
          <div
            role="listbox"
            aria-label="Workspaces"
            className="absolute left-3 right-3 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/[0.1] bg-[#141417] shadow-2xl"
          >
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

      {/* Live search */}
      <div className="px-3 pb-2">
        <div className="flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/40 px-2">
          <Search size={12} className="shrink-0 text-zinc-600" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
      </div>

      {/* Real branch switcher for this workspace */}
      {projectPath ? <BranchList project={projectPath} /> : null}

      {/* New task action */}
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">Sessions</p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
          title="New task"
        >
          <Plus size={12} /> New task
        </button>
      </div>

      {/* Sessions in this workspace */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-1 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">Sessions</p>
        {visibleSessions.map(({ session: s }) => {
          const state = sessionUIState(s, getConversation(s.id), connection)
          const attention = state === 'approval' || state === 'failed' || state === 'input'
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={s.id === session.id ? 'true' : undefined}
              className={cn(
                'group mb-0.5 flex w-full items-center gap-2 rounded-lg py-2 pl-2 pr-7 text-left transition',
                s.id === session.id ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
              )}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  ['working', 'starting', 'resuming'].includes(state)
                    ? 'bg-emerald-400'
                    : ['approval', 'input', 'paused'].includes(state)
                      ? 'bg-orange-400'
                      : state === 'failed'
                        ? 'bg-red-400'
                        : 'bg-zinc-600',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[11px]">{s.name}</span>
              <span className="shrink-0 font-mono text-[9px] text-zinc-600">{relativeTime(s.updated_at).replace(' ago', '')}</span>
              {attention ? <span className="absolute right-1 size-1.5 animate-pulse rounded-full bg-orange-400" /> : null}
            </button>
          )
        })}
        {visibleSessions.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-zinc-500">No sessions match.</p>
        ) : null}
      </div>

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
    </>
  )
}

/** Real local branches for the workspace, click to check out. */
function BranchList({ project }: { project: string }) {
  const [state, setState] = useState<{ current?: string; changed: number; added: number; removed: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [branches, setBranches] = useState<GitBranch[]>([])

  const refresh = useCallback(async () => {
    try {
      const data = await gitApi.branches(project)
      setBranches(data.branches ?? [])
      setState({ current: data.current, changed: data.changed_count, added: data.added, removed: data.removed })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function checkout(branch: GitBranch) {
    if (branch.current || busy) return
    setBusy(true)
    setError(null)
    try {
      await gitApi.checkout(project, branch.name)
      await refresh()
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''))
    } finally {
      setBusy(false)
    }
  }

  async function createBranch() {
    if (!newBranch.trim()) return
    setBusy(true)
    setError(null)
    try {
      await gitApi.createBranch(project, newBranch.trim())
      setNewBranch('')
      setCreating(false)
      await refresh()
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const visible = expanded
    ? branches.filter((b) => !branchFilter.trim() || b.name.toLowerCase().includes(branchFilter.trim().toLowerCase()))
    : branches.slice(0, 4)

  return (
    <div className="border-y border-white/[0.07] px-2 py-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1.5 text-left transition hover:bg-white/[0.05]"
      >
        <ChevronRight size={12} className={cn('shrink-0 text-zinc-600 transition-transform', expanded && 'rotate-90')} />
        <GitBranchIcon size={12} className="shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-200">{state?.current ?? '…'}</span>
        <span className="shrink-0 font-mono text-[9.5px]" title={`${state?.added ?? 0} added · ${state?.removed ?? 0} removed`}>
          <span className="text-emerald-400">+{state?.added ?? 0}</span>{' '}
          <span className="text-red-400">−{state?.removed ?? 0}</span>
        </span>
      </button>

      {/* Uncommitted changes count, from git status */}
      {typeof state?.changed === 'number' && state.changed > 0 ? (
        <p className="px-1 pb-1 pl-6 text-[10px] text-zinc-500">
          Uncommitted changes: {state.changed} files
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mx-1 rounded-md border border-red-500/25 bg-red-500/10 px-2 py-1 text-[10px] leading-snug text-red-300">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <div className="pl-4">
          <input
            type="search"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter branches"
            className="mb-1 h-6 w-full rounded-md border border-white/[0.08] bg-black/40 px-2 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
          />
          {creating ? (
            <form
              className="mb-1 flex gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                void createBranch()
              }}
            >
              <input
                autoFocus
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="new-branch"
                aria-label="New branch name"
                className="h-6 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
              />
              <button type="submit" disabled={!newBranch.trim()} className="rounded-md bg-white px-1.5 text-[10px] font-medium text-black disabled:opacity-50">
                +
              </button>
            </form>
          ) : null}
          {visible.map((branch) => (
            <button
              key={branch.name}
              type="button"
              onClick={() => void checkout(branch)}
              disabled={branch.current || busy}
              title={branch.current ? 'Current branch' : `Checkout ${branch.name}`}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition',
                branch.current ? 'text-emerald-300' : 'font-mono text-[10.5px] text-zinc-400 hover:bg-white/[0.06]',
              )}
            >
              {branch.current ? <Check size={10} className="shrink-0" /> : <GitBranchIcon size={10} className="shrink-0 text-zinc-700" />}
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
            </button>
          ))}
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[10.5px] text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200"
            >
              <Plus size={10} /> Create and switch to new branch
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * RightGitPanel — the always-visible Git tools panel, ~380px fixed.
 *
 * Two columns:
 *   - A slim (~48px) vertical icon toolbar on the left edge (chat / git /
 *     files / search). Git is the default active view; the others are quick
 *     navigation affordances.
 *   - The main git panel: branch selector, diffstat, changed-files list with
 *     per-file diff links, and the commit/push/create-branch/git-graph modals.
 *
 * All data is real daemon-backed git state via /api/git/branches and
 * /api/workspace/overview (which returns changed_files + per-file diffs; see
 * backend/src/workspace.rs). The branch menu, commit modal, and diff overlay
 * are reused from GitToolsCard — only the layout changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Files,
  GitBranch as GitBranchIcon,
  GitGraph,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { gitApi, workspaceApi, type GitBranch, type WorkspaceOverview } from '@/lib/api'
import { cn } from '@/lib/format'
import { FilesPanel } from '@/components/desktop/session/SessionSidePanels'
import type { Session } from '@/types/session'
import {
  ChangedFilesSection,
  DiffLayer,
  GitHeaderActions,
  GitSummary,
  PanelScroll,
  WorktreeSection,
} from '@/components/shared/GitComponents'

type Notify = (message: string, tone?: 'ok' | 'error') => void

/* ── Commit modal ─────────────────────────────────────────────────────────── */

function CommitModal({
  project,
  branchName,
  added,
  removed,
  changedCount,
  onClose,
  notify,
  onCommitted,
}: {
  project: string
  branchName: string
  added: number
  removed: number
  changedCount: number
  onClose: () => void
  notify: Notify
  onCommitted: () => void
}) {
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(true)
  const [busy, setBusy] = useState<'commit' | 'push' | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = useCallback(
    async (push: boolean) => {
      if (!message.trim()) return
      setBusy(push ? 'push' : 'commit')
      try {
        const result = await gitApi.commit(project, message.trim(), push)
        notify(`Committed ${result.head ?? ''}${result.pushed ? ' and pushed' : ''}`)
        if (result.push_error) notify(`Push failed: ${result.push_error}`, 'error')
        setMessage('')
        onCommitted()
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : String(cause), 'error')
      } finally {
        setBusy(null)
      }
    },
    [project, message, notify, onCommitted],
  )

  function generateMessage() {
    setMessage(`Update ${changedCount} file${changedCount === 1 ? '' : 's'} (+${added.toLocaleString()} −${removed.toLocaleString()})`)
    notify('Draft message filled — edit before committing.')
  }

  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0c] shadow-overlay">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
            <GitBranchIcon size={13} className="text-zinc-500" />
            <span className="font-mono text-[12px] text-zinc-300">{branchName}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="font-mono text-[11px]">
            <span className="text-emerald-400">+{added.toLocaleString()}</span>{' '}
            <span className="text-rose-500">−{removed.toLocaleString()}</span>{' '}
            <span className="text-zinc-500">· {changedCount} files changed</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-black/40 focus-within:border-white/25">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[10px] uppercase tracking-[0.1em] text-zinc-500 hover:text-zinc-300"
            >
              Commit message
              <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
            </button>
            {expanded ? (
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Describe what changed…"
                aria-label="Commit message"
                className="block w-full resize-none bg-transparent px-2.5 pb-2 text-[11.5px] leading-snug text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            ) : null}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">{changedCount} file{changedCount === 1 ? '' : 's'}</span>
            <button type="button" onClick={generateMessage} title="Auto-generate a draft commit message" aria-label="Auto-generate commit message" className="rounded-lg p-1.5 text-amber-300 transition hover:bg-white/[0.06]">
              <Sparkles size={14} />
            </button>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void run(false)}
              disabled={busy !== null || !message.trim()}
              className="rounded-lg bg-white px-3 py-1.5 text-[11.5px] font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'commit' ? 'Committing…' : 'Commit'}
            </button>
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={busy !== null || !message.trim()}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'push' ? 'Pushing…' : 'Commit & push'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Git graph modal (compact reuse of GitToolsCard.GitGraphModal) ────────── */

function formatGraphDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return (
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

function GitGraphModal({ project, onClose }: { project: string; onClose: () => void }) {
  const [commits, setCommits] = useState<Array<{ hash: string; short: string; author: string; date: string; message: string; refs?: string[] }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await gitApi.log(project, 200)
      setCommits(data.commits ?? [])
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''))
    } finally {
      setBusy(false)
    }
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0c] shadow-overlay">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
            <GitGraph size={14} /> Git Graph
          </h2>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh history" title="Refresh" className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200">
              <RefreshCw size={13} className={cn(busy && 'animate-spin')} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200">
              ✕
            </button>
          </span>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="p-4 text-[11.5px] leading-relaxed text-red-400">{error}</p>
          ) : commits === null ? (
            <p className="p-4 text-[11.5px] text-zinc-500">Loading history…</p>
          ) : commits.length === 0 ? (
            <p className="p-4 text-[11.5px] text-zinc-500">No commits yet.</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-[#0a0a0c]">
                <tr className="border-b border-white/[0.07] font-mono text-[9.5px] uppercase tracking-[0.1em] text-zinc-600">
                  <th className="w-8 px-3 py-2" aria-label="Graph" />
                  <th className="px-2 py-2 font-normal">Commit</th>
                  <th className="w-28 px-2 py-2 font-normal">Date</th>
                  <th className="w-32 px-2 py-2 font-normal">Author</th>
                  <th className="w-20 px-2 py-2 font-normal">Hash</th>
                </tr>
              </thead>
              <tbody>
                {commits.map((commit) => (
                  <tr key={commit.hash} className="group border-b border-white/[0.04] align-top hover:bg-white/[0.03]">
                    <td className="relative px-3 py-2.5">
                      <span className="absolute left-[19px] top-0 h-full w-px bg-white/[0.09]" aria-hidden />
                      <span className="absolute left-[15.5px] top-1/2 size-2 -translate-y-1/2 rounded-full border-2 border-emerald-400/80 bg-[#0a0a0c]" aria-hidden />
                    </td>
                    <td className="min-w-[220px] px-2 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-zinc-200">{commit.message}</span>
                        {(commit.refs ?? []).map((ref) => (
                          <span
                            key={ref}
                            className={cn(
                              'shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide',
                              ref.startsWith('HEAD') || !ref.startsWith('origin/') ? 'bg-emerald-400/15 text-emerald-400' : 'bg-sky-400/10 text-sky-400',
                            )}
                          >
                            {ref}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[10px] text-zinc-500">{formatGraphDate(commit.date)}</td>
                    <td className="truncate px-2 py-2.5 text-[11px] text-zinc-400">{commit.author}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[10px] text-zinc-500 group-hover:text-zinc-300">{commit.short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main panel ─────────────────────────────────────────────────────────── */

type RightView = 'git' | 'files'

export function RightGitPanel({
  session,
  notify,
  onFocusComposer,
  onFocusSearch,
}: {
  session: Session
  notify: (message: string, tone?: 'ok' | 'error') => void
  onFocusComposer?: () => void
  /** Focus the session search bar in the left sidebar (the Search icon). */
  onFocusSearch?: () => void
}) {
  const project = session.project
  const repoName = project?.split('/').filter(Boolean).pop() ?? 'workspace'
  const [view, setView] = useState<RightView>('git')

  const [branches, setBranches] = useState<GitBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | undefined>()
  const [diffstat, setDiffstat] = useState<{ added: number; removed: number; changed: number }>({ added: 0, removed: 0, changed: 0 })
  const [busy, setBusy] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [commitOpen, setCommitOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [overview, setOverview] = useState<WorkspaceOverview | undefined>(undefined)
  const [openDiff, setOpenDiff] = useState<{ path: string; diff: string } | null>(null)

  const branchMenuRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!project) return
    setBusy(true)
    try {
      const data = await gitApi.branches(project)
      setBranches(data.branches ?? [])
      setCurrentBranch(data.current)
      setDiffstat({ added: data.added ?? 0, removed: data.removed ?? 0, changed: data.changed_count ?? 0 })
    } catch {
      /* keep stale state */
    }
    try {
      setOverview(await workspaceApi.overview(project))
    } catch {
      setOverview(undefined)
    }
    setBusy(false)
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function checkout(branch: GitBranch) {
    if (!project || branch.current || busy) return
    setBusy(true)
    try {
      await gitApi.checkout(project, branch.name)
      notify(`Switched to ${branch.name}`)
      setBranchMenuOpen(false)
      await refresh()
    } catch (cause) {
      notify(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function createBranch() {
    if (!project || !newBranchName.trim()) return
    setBusy(true)
    try {
      await gitApi.createBranch(project, newBranchName.trim())
      notify(`Created and switched to ${newBranchName.trim()}`)
      setNewBranchName('')
      setCreatingBranch(false)
      await refresh()
    } catch (cause) {
      notify(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Click-outside closes the branch menu.
  useEffect(() => {
    if (!branchMenuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setBranchMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [branchMenuOpen])

  const needle = branchFilter.trim().toLowerCase()
  const visibleBranches = needle ? branches.filter((b) => b.name.toLowerCase().includes(needle)) : branches

  // The overview API returns `files` (not `changed_files`) — mirror the home
  // page's fallback so both panels read the same payload.
  const changedFiles = overview?.changed_files ?? (overview as (WorkspaceOverview & { files?: Array<{ path: string; status?: string; diff?: string }> }) | undefined)?.files ?? []

  if (!project) {
    return (
      <aside className="hidden w-[380px] shrink-0 flex-col border-l border-line/60 bg-[#0a0a0c] lg:flex">
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <GitBranchIcon size={22} className="text-zinc-700" />
          <p className="max-w-[220px] text-[11px] leading-relaxed text-zinc-500">
            This session has no workspace, so there is no repository context.
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden w-[380px] shrink-0 flex-col border-l border-line/60 bg-[#0a0a0c] lg:flex">
      <div className="flex h-full min-h-0">
        {/* ── Slim icon toolbar (left edge) ─────────────────────────────── */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-white/[0.07] bg-[#0a0a0c] py-2">
          <IconTab icon={MessageSquare} label="Chat" onClick={onFocusComposer} />
          <IconTab icon={GitBranchIcon} label="Git" active={view === 'git'} onClick={() => setView('git')} />
          <IconTab icon={Files} label="Files" active={view === 'files'} onClick={() => setView('files')} />
          <IconTab icon={Search} label="Search" onClick={onFocusSearch} />
          <span className="mt-auto size-2 rounded-full bg-emerald-400" aria-hidden title="Git ready" />
        </div>

        {/* ── Main panel ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
              {view === 'git' ? `git · ${repoName}` : 'files'}
            </span>
            {view === 'git' ? (
              <GitHeaderActions loading={busy} onRefresh={() => void refresh()} onPopOut={() => setGraphOpen(true)} />
            ) : (
              <button type="button" onClick={() => setView('git')} aria-label="Back to Git" title="Back to Git" className="rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200">
                <GitBranchIcon size={13} />
              </button>
            )}
          </div>

          {view === 'files' ? (
            <FilesPanel session={session} />
          ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Scrollable git body — shared layout with the home-page Git panel */}
            <PanelScroll>
              <div className="flex flex-col gap-3">
                {/* Branch selector */}
                <div ref={branchMenuRef} className="relative px-1">
                  <button
                    type="button"
                    onClick={() => {
                      setBranchMenuOpen((v) => !v)
                      setBranchFilter('')
                    }}
                    aria-expanded={branchMenuOpen}
                    aria-haspopup="listbox"
                    className="flex w-full items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
                  >
                    <GitBranchIcon size={12} className="shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-zinc-100">{currentBranch ?? '…'}</span>
                    <ChevronDown size={12} className={cn('shrink-0 text-zinc-500 transition-transform', branchMenuOpen && 'rotate-180')} />
                  </button>

                  {branchMenuOpen ? (
                    <div role="listbox" className="absolute left-1 right-1 top-full z-40 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#141417] shadow-overlay">
                      <div className="border-b border-white/[0.07] p-1.5">
                        <div className="flex items-center gap-1.5 rounded-md bg-black/40 px-2">
                          <Search size={11} className="shrink-0 text-zinc-600" />
                          <input autoFocus value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} placeholder="Search branches…" aria-label="Search branches" className="h-7 min-w-0 flex-1 bg-transparent text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600" />
                        </div>
                      </div>
                      <div className="scroll-thin max-h-56 overflow-y-auto p-1">
                        {visibleBranches.map((branch) => (
                          <button
                            key={branch.name}
                            type="button"
                            role="option"
                            aria-selected={branch.current}
                            onClick={() => void checkout(branch)}
                            disabled={busy}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
                              branch.current ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]',
                            )}
                          >
                            <Check size={12} strokeWidth={2.6} className={cn('shrink-0', branch.current ? 'text-emerald-400' : 'text-transparent')} />
                            <span className={cn('min-w-0 flex-1 truncate font-mono text-[11px]', branch.current ? 'text-white' : 'text-zinc-400')}>{branch.name}</span>
                          </button>
                        ))}
                        {visibleBranches.length === 0 ? <p className="px-2 py-3 text-[11px] text-zinc-600">No branches match.</p> : null}
                      </div>
                      <div className="border-t border-white/[0.07] p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setBranchMenuOpen(false)
                            setCreatingBranch(true)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 transition hover:bg-white/[0.06]"
                        >
                          <Plus size={12} /> Create and switch to new branch…
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBranchMenuOpen(false)
                            setGraphOpen(true)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 transition hover:bg-white/[0.06]"
                        >
                          <GitGraph size={12} /> Git Graph
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {creatingBranch ? (
                    <form
                      className="mt-1 flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void createBranch()
                      }}
                    >
                      <input
                        autoFocus
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        placeholder="new-branch"
                        aria-label="New branch name"
                        className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
                      />
                      <button type="submit" disabled={!newBranchName.trim()} className="rounded-md bg-white px-1.5 text-[10px] font-medium text-black disabled:opacity-50">
                        +
                      </button>
                    </form>
                  ) : null}
                </div>

                {/* Stat summary — shared GitSummary component */}
                <div className="px-1">
                  <GitSummary overview={overview} files={changedFiles} />
                </div>

                {/* Changed files — shared ChangedFilesSection component */}
                <div className="px-1">
                  <ChangedFilesSection
                    files={changedFiles}
                    overview={overview}
                    onOpenDiff={(path, diff) => setOpenDiff({ path, diff })}
                  />
                </div>

                {/* Worktrees — shared WorktreeSection component */}
                <WorktreeSection worktrees={overview?.worktrees ?? []} />
              </div>
            </PanelScroll>

            {/* Commit / push action */}
            <div className="shrink-0 border-t border-white/[0.07] p-2">
              <button
                type="button"
                onClick={() => setCommitOpen(true)}
                disabled={busy || diffstat.changed === 0}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11.5px] font-medium transition',
                  diffstat.changed === 0
                    ? 'cursor-not-allowed border-white/[0.04] text-zinc-600'
                    : 'border-white/[0.08] text-zinc-200 hover:border-white/20 hover:bg-white/[0.05]',
                )}
              >
                <Check size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {diffstat.changed === 0 ? 'Working tree clean' : `Commit & push ${diffstat.changed} file${diffstat.changed === 1 ? '' : 's'}`}
                </span>
              </button>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Modals + overlays */}
      {commitOpen ? (
        <CommitModal
          project={project}
          branchName={currentBranch ?? repoName}
          added={diffstat.added}
          removed={diffstat.removed}
          changedCount={diffstat.changed}
          onClose={() => setCommitOpen(false)}
          notify={notify}
          onCommitted={() => {
            setCommitOpen(false)
            void refresh()
          }}
        />
      ) : null}
      {graphOpen ? <GitGraphModal project={project} onClose={() => setGraphOpen(false)} /> : null}
      {openDiff ? <DiffLayer path={openDiff.path} diff={openDiff.diff} onClose={() => setOpenDiff(null)} /> : null}
    </aside>
  )
}

/* ── Icon tab (slim toolbar button) ──────────────────────────────────────── */

function IconTab({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
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
}


/**
 * GitToolsCard — the Git Tools tab as a floating card command center.
 *
 * Real daemon-backed state throughout:
 *  - Branch selector popover: search, switch, uncommitted counts, Git Graph
 *  - Create-branch modal (from current HEAD only — backend enforces this)
 *  - Commit & Push modal (Ctrl+Enter commit, AI draft message)
 *  - Git Graph modal (full-screen log table with graph column + ref badges)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  GitBranch as GitBranchIcon,
  GitGraph,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { gitApi, workspaceApi, type GitBranch, type GitCommitEntry, type WorkspaceOverview } from '@/lib/api'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'

type Notify = (message: string, tone?: 'ok' | 'error') => void

interface GitStateLocal {
  branches: GitBranch[]
  changedCount: number
  added: number
  removed: number
}

/* ── Modal shell ─────────────────────────────────────────────────────────── */

function ModalShell({
  title,
  onClose,
  children,
  wide,
  headerRight,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  headerRight?: React.ReactNode
}) {
  // Esc closes any open modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0c] shadow-overlay',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-zinc-100">{title}</h2>
          <span className="flex items-center gap-1">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <X size={14} />
            </button>
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalButton({
  children,
  onClick,
  tone = 'ghost',
  disabled,
  type = 'button',
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  tone?: 'primary' | 'ghost'
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition',
        tone === 'primary'
          ? 'bg-white text-black hover:bg-zinc-200'
          : 'border border-white/10 text-zinc-300 hover:bg-white/[0.06]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  )
}

const inputClass =
  'w-full rounded-md border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25'

/* ── Diff viewer (shared with the homepage Git tab) ─────────────────────── */

function DiffLayer({ path, diff, onClose }: { path: string; diff: string; onClose: () => void }) {
  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-2 backdrop-blur-sm sm:items-center sm:p-8"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#19191b] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-200">{path}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-white"
          >
            Close
          </button>
        </div>
        <pre className="scroll-thin min-h-0 flex-1 overflow-auto p-3 font-mono text-[10px] leading-[1.6] text-zinc-300">
          {diff.split('\n').map((line, index) => (
            <span
              key={index}
              className={cn(
                'block',
                line.startsWith('+') && 'bg-emerald-500/[0.08] text-emerald-300',
                line.startsWith('-') && 'bg-red-500/[0.08] text-red-300',
                line.startsWith('@@') && 'text-sky-300',
              )}
            >
              {line || ' '}
            </span>
          ))}
        </pre>
      </div>
    </div>
  )
}

/* ── Branch creation modal ──────────────────────────────────────────────── */

function CreateBranchModal({
  project,
  onClose,
  notify,
  onCreated,
}: {
  project: string
  onClose: () => void
  notify: Notify
  onCreated: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await gitApi.createBranch(project, name.trim())
      notify(`Created and switched to ${name.trim()}`)
      onCreated(name.trim())
    } catch (cause) {
      notify(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell title="Create new branch" onClose={onClose}>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <p className="text-[11.5px] leading-relaxed text-zinc-400">
          Create a new local branch from the current HEAD and switch to it.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">Branch name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="feature/git-branch-switcher"
            aria-label="Branch name"
            className={inputClass}
          />
        </label>
        <p className="text-[10.5px] text-zinc-600">Supports creating and switching from the current HEAD only.</p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton type="submit" tone="primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create and switch'}
          </ModalButton>
        </div>
      </form>
    </ModalShell>
  )
}

/* ── Commit & push modal ─────────────────────────────────────────────────── */

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
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [busy, setBusy] = useState<'commit' | 'push' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

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
        notify(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''), 'error')
      } finally {
        setBusy(null)
      }
    },
    [project, message, notify, onCommitted],
  )

  // Ctrl+Enter commits.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void run(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  /** Draft a message from the diff shape — real numbers, no fabrication. */
  function generateMessage() {
    setMessage(
      `Update ${changedCount} file${changedCount === 1 ? '' : 's'} (+${added.toLocaleString()} −${removed.toLocaleString()})`,
    )
    notify('Draft message filled — edit before committing.')
  }

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-2">
          <GitBranchIcon size={13} className="text-zinc-500" />
          <span className="font-mono text-[12px] text-zinc-300">{branchName}</span>
        </span>
      }
      onClose={onClose}
    >
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
              ref={textareaRef}
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
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={includeUnstaged}
              onChange={(e) => setIncludeUnstaged(e.target.checked)}
              className="accent-emerald-400"
            />
            Include unstaged changes ({changedCount} files)
          </label>
          <button
            type="button"
            onClick={generateMessage}
            title="Auto-generate a draft commit message"
            aria-label="Auto-generate commit message"
            className="rounded-lg p-1.5 text-amber-300 transition hover:bg-white/[0.06]"
          >
            <Sparkles size={14} />
          </button>
        </div>

        <div className="mt-1 flex items-center justify-end gap-2">
          <ModalButton
            onClick={() => void run(false)}
            tone="primary"
            disabled={busy !== null || !message.trim()}
            title="Ctrl+Enter"
          >
            {busy === 'commit' ? 'Committing…' : 'Commit'}
          </ModalButton>
          <ModalButton
            onClick={() => void run(true)}
            tone="primary"
            disabled={busy !== null || !message.trim()}
          >
            {busy === 'push' ? 'Pushing…' : 'Commit and push'}
          </ModalButton>
          <ModalButton onClick={onClose}>Cancel</ModalButton>
        </div>
      </div>
    </ModalShell>
  )
}

/* ── Git graph modal ────────────────────────────────────────────────────── */

function formatGraphDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function GitGraphModal({ project, onClose }: { project: string; onClose: () => void }) {
  const [commits, setCommits] = useState<GitCommitEntry[] | null>(null)
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
    <ModalShell
      wide
      title={<span className="flex items-center gap-2"><GitGraph size={14} /> Git Graph</span>}
      onClose={onClose}
      headerRight={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          aria-label="Refresh history"
          title="Refresh"
          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <RefreshCw size={13} className={cn(busy && 'animate-spin')} />
        </button>
      }
    >
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
              {commits.map((commit, idx) => (
                <tr key={commit.hash} className="group border-b border-white/[0.04] align-top hover:bg-white/[0.03]">
                  <td className="relative px-3 py-2.5">
                    {/* Simple first-parent rail: vertical line + node per row */}
                    <span className="absolute left-[19px] top-0 h-full w-px bg-white/[0.09]" aria-hidden />
                    {idx > 0 ? null : null}
                    <span
                      className="absolute left-[15.5px] top-1/2 size-2 -translate-y-1/2 rounded-full border-2 border-emerald-400/80 bg-[#0a0a0c]"
                      aria-hidden
                    />
                  </td>
                  <td className="min-w-[220px] px-2 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11.5px] text-zinc-200">{commit.message}</span>
                      {(commit.refs ?? []).map((ref) => (
                        <span
                          key={ref}
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide',
                            ref.startsWith('HEAD') || !ref.startsWith('origin/')
                              ? 'bg-emerald-400/15 text-emerald-400'
                              : 'bg-sky-400/10 text-sky-400',
                          )}
                        >
                          {ref}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[10px] text-zinc-500">
                    {formatGraphDate(commit.date)}
                  </td>
                  <td className="truncate px-2 py-2.5 text-[11px] text-zinc-400">{commit.author}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[10px] text-zinc-500 group-hover:text-zinc-300">
                    {commit.short}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalShell>
  )
}

/* ── Main card ──────────────────────────────────────────────────────────── */

export function GitToolsCard({ session, notify }: { session: Session; notify: Notify }) {
  const project = session.project
  const [state, setState] = useState<GitStateLocal | null>(null)
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')
  const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false)
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
  const [isGitGraphOpen, setIsGitGraphOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [openDiff, setOpenDiff] = useState<{ path: string; diff: string }>()

  const branchMenuRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Click-outside closes popovers.
  useEffect(() => {
    if (!isBranchMenuOpen && !menuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (isBranchMenuOpen && branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setIsBranchMenuOpen(false)
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isBranchMenuOpen, menuOpen])

  const refresh = useCallback(async () => {
    if (!project) return
    setBusy(true)
    try {
      const data = await gitApi.branches(project)
      setState({
        branches: data.branches ?? [],
        changedCount: data.changed_count ?? 0,
        added: data.added ?? 0,
        removed: data.removed ?? 0,
      })
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), 'error')
    } finally {
      setBusy(false)
    }
    // Changed-files + diffs for the homepage-style Changes list. Independent of
    // the branches call, so a failure here does not block the branch UI.
    try {
      setOverview(await workspaceApi.overview(project))
    } catch {
      setOverview(null)
    }
  }, [project, notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function checkout(branch: GitBranch) {
    if (!project || branch.current) return
    setBusy(true)
    try {
      await gitApi.checkout(project, branch.name)
      notify(`Switched to ${branch.name}`)
      setIsBranchMenuOpen(false)
      await refresh()
    } catch (cause) {
      notify(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''), 'error')
    } finally {
      setBusy(false)
    }
  }

  const repoName = project?.split('/').filter(Boolean).pop() ?? 'workspace'
  const current = useMemo(() => state?.branches.find((b) => b.current), [state])
  const needle = branchFilter.trim().toLowerCase()
  const visibleBranches = useMemo(
    () =>
      state?.branches.filter(
        (b) =>
          !needle ||
          b.name.toLowerCase().includes(needle),
      ) ?? [],
    [state, needle],
  )

  if (!project) {
    return (
      <section className="m-2 rounded-xl border border-white/[0.07] bg-[#0a0a0c] p-3">
        <header className="mb-1 flex items-center justify-between">
          <h2 className="text-[12px] font-semibold text-zinc-100">Git tools</h2>
        </header>
        <p className="py-2 text-[11px] leading-relaxed text-zinc-500">
          This session has no workspace, so there is no repository context.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="m-2 rounded-xl border border-white/[0.07] bg-[#0a0a0c] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.03)]">
        {/* Header: title · diff stats · overflow · pop-out */}
        <header className="mb-2.5 flex items-center gap-2">
          <h2 className="text-[12px] font-semibold text-zinc-100">Git tools</h2>
          <span className="ml-auto shrink-0 font-mono text-[10.5px]" title={`${state?.added ?? 0} additions, ${state?.removed ?? 0} deletions`}>
            <span className="text-emerald-400">+{(state?.added ?? 0).toLocaleString()}</span>{' '}
            <span className="text-rose-500">−{(state?.removed ?? 0).toLocaleString()}</span>
          </span>
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More git actions"
              className={cn(
                'rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200',
                menuOpen && 'bg-white/[0.06] text-zinc-200',
              )}
            >
              <Ellipsis size={14} />
            </button>
            {menuOpen ? (
              <div role="menu" className="animate-up absolute right-0 top-7 z-40 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#141417] shadow-overlay">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void refresh()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]"
                >
                  <RefreshCw size={11} className={cn(busy && 'animate-spin')} /> Refresh status
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setIsGitGraphOpen(true)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]"
                >
                  <GitGraph size={11} /> Open Git Graph
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setIsGitGraphOpen(true)}
            aria-label="Pop out Git Graph"
            title="Expand — open Git Graph"
            className="shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <ExternalLink size={13} />
          </button>
        </header>

        {/* Branch selector dropdown trigger */}
        <div ref={branchMenuRef} className="relative mb-2">
          <button
            type="button"
            onClick={() => {
              setIsBranchMenuOpen((v) => !v)
              setBranchFilter('')
            }}
            aria-expanded={isBranchMenuOpen}
            aria-haspopup="listbox"
            className="flex w-full items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
          >
            <GitBranchIcon size={12} className="shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-zinc-100">
              {current?.name ?? '…'}
            </span>
            <ChevronDown size={12} className={cn('shrink-0 text-zinc-500 transition-transform', isBranchMenuOpen && 'rotate-180')} />
          </button>

          {isBranchMenuOpen ? (
            <div
              role="listbox"
              className="animate-up absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#141417] shadow-overlay"
            >
              <div className="border-b border-white/[0.07] p-1.5">
                <div className="flex items-center gap-1.5 rounded-md bg-black/40 px-2">
                  <Search size={11} className="shrink-0 text-zinc-600" />
                  <input
                    autoFocus
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    placeholder="Search branches..."
                    aria-label="Search branches"
                    className="h-7 min-w-0 flex-1 bg-transparent text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
                  />
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
                    <span className={cn('min-w-0 flex-1 truncate font-mono text-[11px]', branch.current ? 'text-white' : 'text-zinc-400')}>
                      {branch.name}
                    </span>
                    {branch.current && (state?.changedCount ?? 0) > 0 ? (
                      <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                        Uncommitted changes: {state?.changedCount} files
                      </span>
                    ) : branch.head ? (
                      <span className="shrink-0 font-mono text-[9px] text-zinc-600">{branch.head.slice(0, 7)}</span>
                    ) : null}
                  </button>
                ))}
                {visibleBranches.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-zinc-600">
                    {state ? 'No branches match.' : 'Loading…'}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col border-t border-white/[0.07] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsBranchMenuOpen(false)
                    setIsCreateBranchOpen(true)
                  }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 transition hover:bg-white/[0.06]"
                >
                  <Plus size={12} /> Create and switch to new branch...
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsBranchMenuOpen(false)
                    setIsGitGraphOpen(true)
                  }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 transition hover:bg-white/[0.06]"
                >
                  <GitGraph size={12} /> Git Graph
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Changes — homepage Git tab parity: changed files with click-to-open diffs */}
        {(() => {
          const files =
            overview?.changed_files ??
            (overview as (WorkspaceOverview & { files?: Array<{ path: string; status?: string; diff?: string }> }) | null)?.files ??
            []
          if (files.length === 0) return null
          return (
            <div className="mb-2">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                Changes{files.length ? ` · ${files.length}` : ''}
              </p>
              <div className="space-y-1">
                {files.map((file) => {
                  const diff =
                    'diff' in file && typeof file.diff === 'string'
                      ? file.diff
                      : overview?.diffs?.[file.path]
                  return (
                    <button
                      key={file.path}
                      type="button"
                      disabled={!diff}
                      onClick={() => diff && setOpenDiff({ path: file.path, diff })}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.05] disabled:cursor-default"
                    >
                      <span
                        className={cn(
                          'font-mono text-[10px] font-semibold',
                          file.status?.includes('M') ? 'text-orange-400' : file.status?.includes('A') ? 'text-emerald-400' : 'text-zinc-500',
                        )}
                      >
                        {file.status ?? '·'}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">{file.path}</span>
                      {diff ? <span className="shrink-0 text-[10px] text-zinc-500">diff</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Commit / push action row → opens the modal */}
        <button
          type="button"
          onClick={() => setIsCommitModalOpen(true)}
          disabled={busy || (state?.changedCount ?? 0) === 0}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-white/[0.08] px-2.5 py-2 text-left text-[11.5px] font-medium transition',
            (state?.changedCount ?? 0) === 0
              ? 'cursor-not-allowed border-white/[0.04] text-zinc-600'
              : 'text-zinc-200 hover:border-white/20 hover:bg-white/[0.05]',
          )}
        >
          <Check size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {(state?.changedCount ?? 0) === 0 ? 'Working tree clean' : `Commit & push ${state?.changedCount} file${state?.changedCount === 1 ? '' : 's'}`}
          </span>
          {busy ? <RefreshCw size={12} className="animate-spin shrink-0" /> : null}
        </button>
      </section>

      {isCreateBranchOpen ? (
        <CreateBranchModal
          project={project}
          onClose={() => setIsCreateBranchOpen(false)}
          notify={notify}
          onCreated={() => {
            setIsCreateBranchOpen(false)
            void refresh()
          }}
        />
      ) : null}

      {isCommitModalOpen ? (
        <CommitModal
          project={project}
          branchName={current?.name ?? repoName}
          added={state?.added ?? 0}
          removed={state?.removed ?? 0}
          changedCount={state?.changedCount ?? 0}
          onClose={() => setIsCommitModalOpen(false)}
          notify={notify}
          onCommitted={() => {
            setIsCommitModalOpen(false)
            void refresh()
          }}
        />
      ) : null}

      {isGitGraphOpen ? (
        <GitGraphModal project={project} onClose={() => setIsGitGraphOpen(false)} />
      ) : null}

      {openDiff ? <DiffLayer path={openDiff.path} diff={openDiff.diff} onClose={() => setOpenDiff(undefined)} /> : null}
    </>
  )
}

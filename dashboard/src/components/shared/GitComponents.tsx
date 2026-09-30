/**
 * Shared Git UI components — used by both the home-page Git panel
 * (WorkspacePanels) and the session right-rail Git panel (RightGitPanel).
 *
 * Extracted here so both surfaces render git state the same way: the same
 * stat summary, the same changed-file rows, the same diff overlay, the same
 * worktree list. One source of truth for "what git looks like" in QAI.
 */

import { AlertCircle, ChevronDown, ExternalLink, FolderGit2, GitBranch, RefreshCw } from 'lucide-react'
import { Chip, IconButton } from '../ui'
import { cn } from '@/lib/format'
import type { WorkspaceOverview } from '@/lib/api'

/* ── Status-letter coloring ──────────────────────────────────────────────── */

const STATUS_TONES: Record<string, string> = {
  M: 'text-orange',
  A: 'text-green',
  '??': 'text-green',
  D: 'text-red',
  R: 'text-blue',
}

export function statusTone(status?: string): string {
  if (!status) return 'text-zinc-500'
  const key = status.trim().split(/\s+/)[0] ?? ''
  return STATUS_TONES[key] ?? 'text-zinc-500'
}

/* ── Diff overlay ─────────────────────────────────────────────────────────── */

export function DiffLayer({ path, diff, onClose }: { path: string; diff: string; onClose: () => void }) {
  return (
    <div
      className="animate-fade fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-2 backdrop-blur-sm sm:items-center sm:p-8"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-overlay">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-200">{path}</span>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-white">
            Close
          </button>
        </div>
        <pre className="scroll-thin min-h-0 flex-1 overflow-auto p-3 font-mono text-[10px] leading-[1.6] text-zinc-300">
          {diff.split('\n').map((line, index) => (
            <span
              key={index}
              className={cn(
                'block whitespace-pre-wrap break-words',
                line.startsWith('+') && !line.startsWith('+++') && 'bg-emerald-500/[0.08] text-emerald-300',
                line.startsWith('-') && !line.startsWith('---') && 'bg-red-500/[0.08] text-red-300',
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

/* ── Stat summary ─────────────────────────────────────────────────────────── */

interface ChangedFile {
  path: string
  status?: string
  diff?: string
  [key: string]: unknown
}

export function GitSummary({ overview, files }: { overview?: WorkspaceOverview; files: Array<ChangedFile> }) {
  const added = files.filter((file) => file.status?.includes('A') || file.status?.includes('?')).length
  const modified = files.filter((file) => file.status?.includes('M')).length
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <div className="rounded-lg bg-white/[0.04] p-2">
        <p className="font-mono text-[9px] uppercase text-zinc-600">Branch</p>
        <p className="mt-1 truncate font-mono text-[10px] text-zinc-300">
          {(overview as (WorkspaceOverview & { branch?: string }) | undefined)?.branch ?? 'detached'}
        </p>
      </div>
      <div className="rounded-lg bg-white/[0.04] p-2">
        <p className="font-mono text-[9px] uppercase text-zinc-600">Added</p>
        <p className="mt-1 font-mono text-[12px] text-emerald-400">+{added}</p>
      </div>
      <div className="rounded-lg bg-white/[0.04] p-2">
        <p className="font-mono text-[9px] uppercase text-zinc-600">Modified</p>
        <p className="mt-1 font-mono text-[12px] text-orange">{modified}</p>
      </div>
    </div>
  )
}

/* ── Section wrapper ──────────────────────────────────────────────────────── */

export function GitSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">{title}</h3>
      {children}
    </section>
  )
}

/* ── Changed-file rows ───────────────────────────────────────────────────── */

interface ChangedFileRowProps {
  file: ChangedFile
  overview?: WorkspaceOverview
  onOpenDiff: (path: string, diff: string) => void
}

export function ChangedFileRow({ file, overview, onOpenDiff }: ChangedFileRowProps) {
  const diff =
    'diff' in file && typeof file.diff === 'string' ? file.diff : overview?.diffs?.[file.path]
  return (
    <button
      type="button"
      disabled={!diff}
      onClick={() => diff && onOpenDiff(file.path, diff)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.05] disabled:cursor-default"
    >
      <span className={cn('font-mono text-[10px] font-semibold', statusTone(file.status))}>
        {file.status ?? '·'}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">{file.path}</span>
      {diff ? (
        <span className="text-[10px] text-zinc-500">diff</span>
      ) : null}
    </button>
  )
}

/* ── Worktree list ────────────────────────────────────────────────────────── */

export function WorktreeSection({ worktrees }: { worktrees: Array<{ path?: string; branch?: string; name?: string; [key: string]: unknown }> }) {
  if (worktrees.length === 0) return null
  return (
    <GitSection title={`Worktrees · ${worktrees.length}`}>
      <div className="space-y-1">
        {worktrees.map((tree, index) => (
          <div key={tree.path ?? index} className="rounded-lg border border-white/[0.07] bg-black/20 px-2 py-2">
            <div className="flex items-center gap-2">
              <FolderGit2 size={12} className="text-zinc-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">{tree.branch ?? tree.name ?? 'worktree'}</span>
              {index === 0 ? <Chip tone="green">main</Chip> : null}
            </div>
            {tree.path ? <p className="mt-1 truncate font-mono text-[9px] text-zinc-600">{tree.path}</p> : null}
          </div>
        ))}
      </div>
    </GitSection>
  )
}

/* ── Changed-files section ────────────────────────────────────────────────── */

interface ChangedFilesSectionProps {
  files: Array<ChangedFile>
  overview?: WorkspaceOverview
  onOpenDiff: (path: string, diff: string) => void
}

export function ChangedFilesSection({ files, overview, onOpenDiff }: ChangedFilesSectionProps) {
  return (
    <GitSection title={`Changes${files.length ? ` · ${files.length}` : ''}`}>
      {files.length === 0 ? (
        <p className="text-[10px] text-zinc-500">Working tree clean.</p>
      ) : (
        <div className="space-y-1">
          {files.map((file) => (
            <ChangedFileRow key={file.path} file={file} overview={overview} onOpenDiff={onOpenDiff} />
          ))}
        </div>
      )}
    </GitSection>
  )
}

/* ── Project selector (shared) ────────────────────────────────────────────── */

interface ProjectSelectorProps {
  projects: string[]
  project: string
  onChange: (project: string) => void
}

export function ProjectSelector({ projects, project, onChange }: ProjectSelectorProps) {
  if (projects.length === 0) {
    return <p className="px-2 py-2 text-[10px] text-zinc-500">No session has a project folder yet.</p>
  }
  return (
    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <GitBranch size={13} className="text-zinc-500" />
      <select
        aria-label="Git project"
        value={project}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-zinc-300 outline-none"
      >
        {projects.map((item) => (
          <option key={item} value={item} className="bg-zinc-900">
            {item}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="text-zinc-500" />
    </label>
  )
}

/* ── Panel header (shared) ────────────────────────────────────────────────── */

export function PanelHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="border-b border-white/[0.07] px-3 pb-3 pt-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">{eyebrow}</p>
          <h2 className="mt-1 text-[14px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
          {detail ? <p className="mt-1 text-[11px] leading-[1.5] text-zinc-500">{detail}</p> : null}
        </div>
        {action}
      </div>
    </div>
  )
}

export function PanelScroll({ children }: { children: React.ReactNode }) {
  return <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
}

/* ── Git header actions (refresh + pop-out) ───────────────────────────────── */

export function GitHeaderActions({
  loading,
  onRefresh,
  onPopOut,
}: {
  loading?: boolean
  onRefresh: () => void
  onPopOut?: () => void
}) {
  return (
    <span className="flex items-center gap-1">
      <IconButton label="Refresh git state" onClick={onRefresh} className="size-8">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </IconButton>
      {onPopOut ? (
        <IconButton label="Pop out Git Graph" onClick={onPopOut} className="size-8">
          <ExternalLink size={14} />
        </IconButton>
      ) : null}
    </span>
  )
}

/* ── Error banner ─────────────────────────────────────────────────────────── */

export function GitError({ message }: { message: string }) {
  return (
    <div className="mb-2 flex gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-2 text-[10px] text-red-300">
      <AlertCircle size={13} className="shrink-0" />
      {message}
    </div>
  )
}

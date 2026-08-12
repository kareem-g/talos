import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, File, FolderOpen, X } from 'lucide-react'
import { api, type WorkspaceOverview, type WorkspaceFile } from '../lib/api'
import DiffTable, { type DiffLine } from './beautiful/DiffTable'
import CodeBlock from './beautiful/CodeBlock'
import LoadingState from './beautiful/LoadingState'

/**
 * Context panel — the spec's right-side / full-screen panel for changed
 * files, diffs, code and worktrees.
 *
 * On mobile it opens as a full-screen sheet over the chat (chat state is
 * preserved underneath); on desktop it is a right-side panel. The data is
 * the real git state of the session project from /api/workspace/overview —
 * never demo data.
 */

function parseDiff(diff: string): DiffLine[] {
  if (!diff) return []
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .slice(0, 200)
    .map((line) => ({
      type: line.startsWith('+') ? 'add' as const : 'remove' as const,
      text: line.slice(1),
    }))
}

function statusLabel(status: string): { label: string; tint: string } {
  const code = status.trim()
  if (code === '??') return { label: 'New', tint: 'bg-green-tint text-green' }
  if (code.startsWith('A')) return { label: 'Added', tint: 'bg-green-tint text-green' }
  if (code.startsWith('D')) return { label: 'Deleted', tint: 'bg-red-tint text-red' }
  if (code.startsWith('R')) return { label: 'Renamed', tint: 'bg-orange-tint text-orange' }
  if (code.startsWith('M') || code.endsWith('M')) return { label: 'Modified', tint: 'bg-accent-tint text-accent' }
  return { label: code || 'Changed', tint: 'bg-accent-tint text-accent' }
}

export function MobileContextPanel({
  project,
  open,
  onClose,
}: {
  project: string
  open: boolean
  onClose: () => void
}) {
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<WorkspaceFile | null>(null)
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [loadingFile, setLoadingFile] = useState(false)

  useEffect(() => {
    if (!open || !project) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelected(null)
    api.workspace.overview(project)
      .then((data) => { if (!cancelled) setOverview(data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load files.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, project])

  const staged = useMemo(() => (overview?.files ?? []).filter((file) => file.staged), [overview])
  const unstaged = useMemo(() => (overview?.files ?? []).filter((file) => !file.staged), [overview])

  const selectFile = async (file: WorkspaceFile) => {
    setSelected(file)
    if (fileContents[file.path]) return
    setLoadingFile(true)
    try {
      const data = await api.workspace.file(project, file.path)
      setFileContents((current) => ({ ...current, [file.path]: data.contents }))
    } catch {
      setFileContents((current) => ({ ...current, [file.path]: '// Could not load file' }))
    } finally {
      setLoadingFile(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-canvas">
      {/* panel header */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface px-3 pb-2 pt-[calc(env(safe-area-inset-top)+10px)]">
        <button onClick={onClose} className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors active:bg-hover" aria-label="Back to chat">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13.5px] font-semibold text-ink">Files & changes</h2>
          <p className="truncate text-[10px] text-ink-3">{overview?.branch || project}</p>
        </div>
        <button onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors active:bg-hover" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="ai-scroll-thin flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-4 pt-6 text-[12px] text-ink-2">
            <LoadingState label="Loading files" variant="Dots" showElapsed={false} />
          </div>
        )}
        {error && <p className="px-4 pt-6 text-[12px] text-red">{error}</p>}

        {/* file list */}
        {!loading && overview && (
          <div className="flex flex-col gap-4 px-4 pb-8 pt-4">
            {staged.length > 0 && (
              <Section title="Staged" icon={<FolderOpen className="h-3.5 w-3.5" />} count={staged.length}>
                {staged.map((file) => (
                  <FileRow key={`s-${file.path}`} file={file} active={selected?.path === file.path} onSelect={() => selectFile(file)} />
                ))}
              </Section>
            )}
            {unstaged.length > 0 && (
              <Section title="Changes" icon={<File className="h-3.5 w-3.5" />} count={unstaged.length}>
                {unstaged.map((file) => (
                  <FileRow key={`u-${file.path}`} file={file} active={selected?.path === file.path} onSelect={() => selectFile(file)} />
                ))}
              </Section>
            )}
            {overview.files.length === 0 && (
              <p className="py-8 text-center text-[12px] text-ink-3">No changes — the working tree is clean.</p>
            )}

            {/* diff + contents for the selected file */}
            {selected && (
              <div className="flex flex-col gap-3">
                <h3 className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-ink">
                  <code className="truncate font-mono">{selected.path}</code>
                  <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-medium ${statusLabel(selected.status).tint}`}>
                    {statusLabel(selected.status).label}
                  </span>
                </h3>
                {selected.diff ? (
                  <DiffTable title={selected.path} lines={parseDiff(selected.diff)} />
                ) : (
                  <p className="text-[11px] text-ink-3">No diff available.</p>
                )}
                <CodeBlock
                  filename={selected.path}
                  code={fileContents[selected.path] ?? (loadingFile ? '// Loading…' : '// Select to load')}
                  streaming={false}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-card border border-line bg-surface">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-ink-3" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-3" />}
        {icon}
        <span className="text-[11.5px] font-medium text-ink">{title}</span>
        <span className="ml-auto rounded-chip bg-hover px-1.5 py-0.5 text-[10px] text-ink-2">{count}</span>
      </button>
      {open && <div className="flex flex-col gap-0.5 border-t border-line px-1 py-1">{children}</div>}
    </div>
  )
}

function FileRow({ file, active, onSelect }: { file: WorkspaceFile; active: boolean; onSelect: () => void }) {
  const { label, tint } = statusLabel(file.status)
  return (
    <button onClick={onSelect} className={`flex items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors ${active ? 'bg-hover' : 'hover:bg-hover'}`}>
      <File className="h-3.5 w-3.5 shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{file.path}</span>
      <span className={`shrink-0 rounded-chip px-1.5 py-0.5 text-[10px] font-medium ${tint}`}>{label}</span>
    </button>
  )
}

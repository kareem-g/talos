/**
 * Real, daemon-backed side panels for the session workspace right column:
 *
 *  - GitPanel     — live worktrees + changed files + diffs (`/api/workspace/overview`)
 *  - FilesPanel   — directory browser + text-file preview (`/api/workspace/dirs|file`)
 *  - SubagentsPanel — provider launcher + this workspace's running sessions
 *
 * Every piece of data comes from the local daemon; nothing here is mocked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { workspaceApi } from '@/lib/api'
import type { DirListing, WorkspaceOverview } from '@/lib/api'
import { useStore } from '@/store'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'

/* ── shared bits ─────────────────────────────────────────────────────────── */

function PanelHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 pt-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">{title}</span>
      {right}
    </div>
  )
}

function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Refresh"
      className={cn(
        'rounded-control bg-field px-1.5 py-0.5 font-mono text-[10px] text-ink-2 shadow-hairline transition-colors',
        busy ? 'opacity-50' : 'hover:bg-hover hover:text-ink',
      )}
    >
      {busy ? '…' : '⟳'}
    </button>
  )
}

function PanelError({ message }: { message: string }) {
  return (
    <p className="mx-3 rounded-control border border-red/30 bg-red-tint px-2 py-1.5 text-[11px] leading-relaxed text-red">
      {message}
    </p>
  )
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-3 text-[11px] leading-relaxed text-ink-3">{children}</p>
}

/* ── Git ─────────────────────────────────────────────────────────────────── */

const FILE_STATUS_TONES: Record<string, string> = {
  M: 'text-orange',
  A: 'text-green',
  '??': 'text-green',
  D: 'text-red',
  R: 'text-blue',
}

function statusTone(status?: string): string {
  if (!status) return 'text-ink-3'
  const key = status.trim().split(/\s+/)[0] ?? ''
  return FILE_STATUS_TONES[key] ?? 'text-ink-3'
}

/** Live git picture for the session's workspace: worktrees, changed files, diffs. */
export function GitPanel({ session }: { session: Session }) {
  const project = session.project
  const [data, setData] = useState<WorkspaceOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!project) return
    setBusy(true)
    setError(null)
    try {
      setData(await workspaceApi.overview(project))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!project) {
    return <EmptyText>This session isn't tied to a workspace, so there is no git context.</EmptyText>
  }

  const changed = data?.changed_files ?? []
  const worktrees = data?.worktrees ?? []
  const repoName = project.split('/').filter(Boolean).pop() ?? project

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        title={`git · ${repoName}`}
        right={<RefreshButton onClick={() => void refresh()} busy={busy} />}
      />
      {error ? <PanelError message={error} /> : null}
      {!error && !data && !busy ? <EmptyText>Loading workspace state…</EmptyText> : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
        {/* Branches / worktrees */}
        {worktrees.length > 0 ? (
          <section className="px-3 pb-2">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-3">Worktrees</span>
            {worktrees.map((wt, idx) => (
              <div key={wt.path ?? idx} className="flex items-center gap-2 rounded-control px-1.5 py-1 hover:bg-hover-2">
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{wt.branch ?? wt.name ?? wt.path}</span>
                {typeof wt.head === 'string' && wt.head ? (
                  <span className="shrink-0 font-mono text-[9.5px] text-ink-3">{wt.head.slice(0, 7)}</span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {/* Changed files with inline diffs */}
        <section className="px-3">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-3">
            Changed files{changed.length > 0 ? ` (${changed.length})` : ''}
          </span>
          {changed.length === 0 ? (
            <p className="px-1.5 py-1 text-[11px] text-ink-3">Working tree clean.</p>
          ) : (
            changed.map((file) => {
              const open = openFile === file.path
              const diff = data?.diffs?.[file.path]
              return (
                <div key={file.path}>
                  <button
                    type="button"
                    onClick={() => setOpenFile(open ? null : file.path)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-left hover:bg-hover-2"
                  >
                    <span className="w-3 shrink-0 text-center text-[10px] text-ink-3">{open ? '▾' : '▸'}</span>
                    <span className={cn('shrink-0 font-mono text-[10px]', statusTone(file.status))}>{file.status ?? '·'}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">{file.path}</span>
                  </button>
                  {open ? (
                    diff ? (
                      <pre className="scroll-thin mx-1.5 mb-1.5 max-h-56 overflow-auto rounded-control border border-line bg-field p-2 font-mono text-[10px] leading-[1.5] text-ink-2">
                        {diff}
                      </pre>
                    ) : (
                      <p className="px-4 pb-1.5 text-[10.5px] text-ink-3">No diff available.</p>
                    )
                  ) : null}
                </div>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}

/* ── Files ───────────────────────────────────────────────────────────────── */

/** Directory browser rooted at the session's workspace (falls back to HOME). */
export function FilesPanel({ session }: { session: Session }) {
  const [cwd, setCwd] = useState(session.project ?? '')
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ name: string; contents: string } | null>(null)
  const previewRef = useRef<HTMLPreElement>(null)

  const load = useCallback(async (path: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await workspaceApi.dirs(path || undefined)
      setListing(result)
      if (result.exists) setCwd(result.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(session.project ?? '')
  }, [load, session.project])

  const openFile = useCallback(
    async (entry: { name: string; path: string }) => {
      setError(null)
      try {
        const parentDir = cwd || listing?.path || ''
        const result = await workspaceApi.file(parentDir, entry.name)
        if (result.error) throw new Error(result.error)
        setPreview({ name: entry.name, contents: result.contents })
        previewRef.current?.scrollTo({ top: 0 })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [cwd, listing?.path],
  )

  const crumbs = useMemo(() => {
    if (!listing?.path) return []
    const parts = listing.path.split('/').filter(Boolean)
    return parts.map((part, idx) => ({
      name: part,
      path: '/' + parts.slice(0, idx + 1).join('/'),
    }))
  }, [listing?.path])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        title="files"
        right={<RefreshButton onClick={() => void load(cwd)} busy={busy} />}
      />
      {error ? <PanelError message={error} /> : null}

      {preview ? (
        <div className="mx-3 mb-2 rounded-card border border-line bg-field">
          <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1">
            <span className="truncate font-mono text-[10.5px] text-ink-2">{preview.name}</span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Close preview"
              className="rounded-control px-1.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
            >
              ✕
            </button>
          </div>
          <pre ref={previewRef} className="scroll-thin max-h-64 overflow-auto p-2 font-mono text-[10px] leading-[1.5] text-ink-2">
            {preview.contents}
          </pre>
        </div>
      ) : null}

      {/* Breadcrumbs */}
      <div className="scroll-thin flex shrink-0 items-center gap-0.5 overflow-x-auto px-3 pb-1.5 font-mono text-[10px] text-ink-3">
        <button type="button" onClick={() => void load('')} className="rounded px-1 py-0.5 hover:bg-hover-2 hover:text-ink">
          ~
        </button>
        {crumbs.map((crumb, idx) => (
          <span key={crumb.path} className="flex items-center gap-0.5">
            <span aria-hidden>/</span>
            <button
              type="button"
              onClick={() => void load(crumb.path)}
              className="max-w-[110px] truncate rounded px-1 py-0.5 hover:bg-hover-2 hover:text-ink"
              title={crumb.path}
            >
              {crumb.name}
            </button>
            {idx === crumbs.length - 1 && listing ? <span className="text-ink">/</span> : null}
          </span>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {listing?.exists && listing.parent ? (
          <button
            type="button"
            onClick={() => void load(listing.parent!)}
            className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-hover-2"
          >
            <span className="w-4 shrink-0 text-center text-[11px] text-ink-3">↑</span>
            <span className="truncate font-mono text-[11.5px] text-ink-2">..</span>
          </button>
        ) : null}
        {(listing?.entries ?? []).map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => (entry.dir ? void load(entry.path) : void openFile(entry))}
            className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-hover-2"
          >
            <span className="w-4 shrink-0 text-center text-[11px]" aria-hidden>
              {entry.dir ? <span className="text-accent">▸</span> : <span className="text-ink-3">·</span>}
            </span>
            <span className={cn('min-w-0 flex-1 truncate font-mono text-[11.5px]', entry.dir ? 'text-ink' : 'text-ink-2')}>
              {entry.name}
            </span>
          </button>
        ))}
        {listing && listing.entries.length === 0 ? <EmptyText>Empty directory.</EmptyText> : null}
        {!listing && !error && !busy ? <EmptyText>Loading directory…</EmptyText> : null}
      </div>
    </div>
  )
}

/* ── Agents ──────────────────────────────────────────────────────────────── */

/**
 * Launcher + roster: every installed provider CLI with its live state, one
 * click to start an agent (or a raw shell via the bundled `cmd` provider),
 * plus the sessions already running in this workspace.
 */
export function SubagentsPanel({
  session,
  onOpenSession,
}: {
  session: Session
  onOpenSession?: (sessionId: string) => void
}) {
  const providers = useStore((s) => s.providers)
  const sessions = useStore((s) => s.sessions)
  const createSession = useStore((s) => s.createSession)
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const here = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.status !== 'archived' &&
          (s.project ?? null) === (session.project ?? null) &&
          !(s.status === 'exited' && s.id !== session.id),
      ),
    [sessions, session.project, session.id],
  )

  const start = useCallback(
    async (agentId: string) => {
      setStarting(agentId)
      setError(null)
      try {
        const created = await createSession({
          agent: agentId,
          project: session.project ?? undefined,
          prompt: ' ',
        })
        onOpenSession?.(created.id)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStarting(null)
      }
    },
    [createSession, session.project, onOpenSession],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="subagents" />
      {error ? <PanelError message={error} /> : null}

      {/* Installed CLIs — click to launch in this workspace */}
      <section className="px-3 pb-2">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-3">Launch</span>
        {providers.map((provider) => {
          const ready = provider.state === 'ready'
          const busyHere = starting === provider.id
          return (
            <button
              key={provider.id}
              type="button"
              disabled={!ready || busyHere}
              onClick={() => void start(provider.id)}
              title={
                ready
                  ? `Start ${provider.name} in ${session.project ? session.project.split('/').pop() : 'inbox'}`
                  : `${provider.name}: ${provider.remedy ?? provider.state}`
              }
              className={cn(
                'flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors',
                ready && !busyHere ? 'hover:bg-hover-2' : 'cursor-not-allowed opacity-55',
              )}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  ready ? 'bg-green' : provider.state === 'not_installed' ? 'bg-red' : 'bg-orange breathe',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{provider.name}</span>
              <span className="shrink-0 font-mono text-[9.5px] uppercase text-ink-3">
                {provider.transport}
              </span>
              <span className={cn('shrink-0 font-mono text-[9.5px]', busyHere ? 'text-orange' : 'text-ink-3')}>
                {busyHere ? 'starting…' : ready ? 'start' : provider.state}
              </span>
            </button>
          )
        })}
        {providers.length === 0 ? <EmptyText>No agent CLIs detected yet.</EmptyText> : null}
      </section>

      {/* Sessions in this workspace */}
      <section className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-3">
          This workspace ({here.length})
        </span>
        {here.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpenSession?.(s.id)}
            aria-current={s.id === session.id}
            className={cn(
              'flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors',
              s.id === session.id ? 'bg-accent-tint' : 'hover:bg-hover-2',
            )}
          >
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                s.status === 'running' ? 'bg-green breathe' : ['failed', 'error'].includes(s.status) ? 'bg-red' : 'bg-ink-3/60',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{s.name}</span>
            <span className="shrink-0 font-mono text-[9.5px] text-ink-3">{s.agent}</span>
          </button>
        ))}
        {here.length === 0 ? <EmptyText>No other sessions in this workspace.</EmptyText> : null}
      </section>
    </div>
  )
}

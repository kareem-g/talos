/**
 * SessionPanels — the right-side content shared by desktop's context column
 * and mobile's details sheet: session metadata, git worktrees, and changed
 * files with rendered diffs.
 *
 * Data comes straight from the daemon's git integration, so what you see is
 * the repository's truth, never a client-side reconstruction.
 */

import { useEffect, useMemo, useState } from 'react'
import { Chip, Dots } from './ui'
import { sessionWorkspaceApi, type WorktreeInfo, type WorkspaceOverview } from '@/lib/api'
import { cn } from '@/lib/format'
import { getConversation } from '@/store'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">{title}</h3>
      {children}
    </section>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="shrink-0 text-[11px] text-ink-3">{label}</span>
      <span className={cn('min-w-0 truncate text-right text-[11px] text-ink', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

export interface PanelSessionFacts {
  createdAt: string
  updatedAt: string
  project?: string | null
  branch?: string | null
  agentName: string
  statusLabel: string
  modelValue?: string
  worktreePath?: string | null
}

/** Metadata + worktrees + changes, composed by the caller's shell. */
export function SessionPanels({
  sessionId,
  facts,
}: {
  sessionId: string
  facts: PanelSessionFacts
}) {
  const [overview, setOverview] = useState<WorkspaceOverview>()
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>()
  const [loading, setLoading] = useState(true)
  const [openDiff, setOpenDiff] = useState<{ path: string; diff: string }>()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      sessionWorkspaceApi.overview(sessionId),
      facts.project ? sessionWorkspaceApi.worktrees(facts.project) : Promise.resolve(undefined),
    ]).then(([overviewResult, worktreeResult]) => {
      if (cancelled) return
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
      if (worktreeResult.status === 'fulfilled' && worktreeResult.value)
        setWorktrees(worktreeResult.value.worktrees ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, facts.project])

  const duration = useMemoDuration(facts.createdAt, facts.updatedAt)
  const changed = overview?.changed_files ?? []
  const conversation = getConversation(sessionId)

  // Aggregate token usage across all turns.
  const usage = useMemo(() => {
    let input = 0, output = 0, turns = 0
    for (const msg of conversation.messages) {
      for (const p of msg.parts) {
        if (p.kind === 'usage') {
          input += p.inputTokens ?? 0
          output += p.outputTokens ?? 0
        }
        if (p.kind === 'turn_summary') {
          input += p.inputTokens ?? 0
          output += p.outputTokens ?? 0
          turns += 1
        }
      }
    }
    return { input, output, turns }
  }, [conversation])
  const fmtTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }

  return (
    <div className="px-3 pb-2">
      <Section title="Details">
        <MetaRow label="Created" value={new Date(facts.createdAt).toLocaleString()} />
        <MetaRow label="Active" value={duration} />
        <MetaRow label="Agent" value={facts.agentName} />
        {facts.modelValue ? <MetaRow label="Model" value={facts.modelValue} /> : null}
        <MetaRow label="Status" value={facts.statusLabel} />
        {facts.branch ? <MetaRow label="Branch" value={facts.branch} mono /> : null}
        {facts.project ? <MetaRow label="Project" value={facts.project} mono /> : null}
        {facts.worktreePath ? <MetaRow label="Worktree" value={facts.worktreePath} mono /> : null}
      </Section>

      {usage.input > 0 || usage.output > 0 ? (
        <Section title="Usage">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line/40 bg-surface/60 px-2.5 py-2">
              <p className="text-[10px] text-ink-3">Input tokens</p>
              <p className="font-mono text-[13px] font-medium text-ink tabular-nums">{fmtTokens(usage.input)}</p>
            </div>
            <div className="rounded-lg border border-line/40 bg-surface/60 px-2.5 py-2">
              <p className="text-[10px] text-ink-3">Output tokens</p>
              <p className="font-mono text-[13px] font-medium text-ink tabular-nums">{fmtTokens(usage.output)}</p>
            </div>
            <div className="rounded-lg border border-line/40 bg-surface/60 px-2.5 py-2">
              <p className="text-[10px] text-ink-3">Turns</p>
              <p className="font-mono text-[13px] font-medium text-ink tabular-nums">{usage.turns}</p>
            </div>

          </div>
        </Section>
      ) : null}

      <Section title={`Changes${changed.length > 0 ? ` · ${changed.length}` : ''}`}>
        {loading && !overview ? (
          <Dots />
        ) : changed.length === 0 ? (
          <p className="text-[11px] leading-[1.6] text-ink-3">
            No uncommitted changes in this project.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {changed.map((file) => {
              const diff = overview?.diffs?.[file.path]
              return (
                <button
                  key={file.path}
                  type="button"
                  disabled={!diff}
                  onClick={() => diff && setOpenDiff({ path: file.path, diff })}
                  className={cn(
                    'flex min-h-9 items-center gap-2 rounded-control px-2 py-1.5 text-left',
                    'transition-colors duration-100',
                    diff ? 'hover:bg-hover-2' : '',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[10px] font-semibold',
                      file.status === 'M' ? 'text-orange' : file.status === 'A' ? 'text-green' : 'text-ink-3',
                    )}
                  >
                    {file.status || '·'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">
                    {file.path}
                  </span>
                  {diff ? <span className="shrink-0 text-[10px] text-accent-ink">diff</span> : null}
                </button>
              )
            })}
          </div>
        )}
      </Section>

      {worktrees && worktrees.length > 0 ? (
        <Section title="Worktrees">
          <div className="flex flex-col gap-1">
            {worktrees.map((tree, index) => (
              <div key={tree.path ?? index} className="rounded-control border border-line bg-inset px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[11px] text-ink-2">
                    {tree.branch ?? tree.name ?? 'worktree'}
                  </span>
                  {index === 0 ? <Chip tone="green">main</Chip> : null}
                </div>
                {tree.path ? (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3">{tree.path}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Diff overlay */}
      {openDiff ? (              <div
                role="dialog"
                aria-modal="true"
                className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-[3px] sm:items-center sm:p-8"
                onClick={() => setOpenDiff(undefined)}
              >
                <div
                  className="animate-sheet flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-overlay sm:rounded-2xl"
                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                >
                  <header className="flex shrink-0 items-center gap-2 border-b border-line/40 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-ink">{openDiff.path}</span>
                    <button
                      type="button"
                      onClick={() => setOpenDiff(undefined)}
                      aria-label="Close diff"
                      className="rounded-lg px-2.5 py-1 text-[12px] text-ink-3 hover:bg-hover-2 hover:text-ink transition-colors"
                    >
                      Close
                    </button>
                  </header>
                  <pre className="scroll-thin min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-[1.6]">
                    {openDiff.diff.split('\n').map((line, index) => (
                      <div
                        key={index}
                        className={cn(
                          line.startsWith('+') && 'bg-green/[0.06] text-green',
                          line.startsWith('-') && 'bg-red/[0.06] text-red',
                          line.startsWith('@@') && 'text-accent/70',
                        )}
                      >
                        {line || '\u00A0'}
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
      ) : null}
    </div>
  )
}

function useMemoDuration(created: string, updated: string): string {
  const start = new Date(created).getTime()
  const end = new Date(updated).getTime()
  const mins = Math.floor(Math.max(0, end - start) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/**
 * FloatingHud — the floating contexture menu over the timeline.
 *
 * A stacked, scrollable card (Git tools → Plans → Progress → Agents), each
 * section a small gray header with icon+label rows and hairline dividers — no
 * tab switcher. The header row carries the panel controls: ⋯ opens the Git diff
 * tab in the right panel, ✕ collapses the HUD to a pill.
 *
 * Git tools rows open inline submenus instead of navigating the right panel:
 * the branch row expands a branch list (search/checkout/create) and "Commit or
 * push" expands the commit form — the same real git actions as the Git tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  FileText,
  GitBranch as GitBranchIcon,
  GitCommit,
  ListTodo,
  Loader2,
  Map as MapIcon,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { getConversation } from '@/store'
import { cn } from '@/lib/format'
import { gitApi, type GitBranch } from '@/lib/api'
import {
  deriveSubagents,
  useAgentSummaries,
  useWorkspaceStats,
} from './workspaceData'
import type { PlanPart } from '@/types/conversation'
import type { Session } from '@/types/session'
import type { RightTabType } from './rightTabs'

export function FloatingHud({
  session,
  onSelectTab,
}: {
  session: Session
  onSelectTab: (tab: RightTabType) => void
}) {
  const stats = useWorkspaceStats(session)
  const conversation = getConversation(session.id)
  const { primary } = useAgentSummaries(session)
  // Real subagents the agent spawned in THIS session (from AI events) — the
  // workspace's other sessions are not agents and are not listed here.
  const derived = deriveSubagents(conversation.messages)
  // Start collapsed to the pill: the simpler view keeps the timeline
  // unobstructed; the pill still shows what the agent is working on.
  const [collapsed, setCollapsed] = useState(true)

  const done = stats.done
  const total = stats.todos.length

  // The active step: the one in progress, else the first pending one. Shown in
  // the collapsed pill so the user always sees what the agent is working on.
  const activeTodo = useMemo(() => {
    const active =
      stats.todos.find((t) => t.status === 'in_progress' || t.status === 'blocked' || t.status === 'failed') ??
      stats.todos.find((t) => t.status === 'pending')
    return active
  }, [stats.todos])

  /** Every plan the agent produced, oldest first. */
  const plans = useMemo(() => {
    const out: Array<{ id: string; title: string; steps: number }> = []
    for (const message of conversation.messages) {
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.kind !== 'plan') continue
        const plan = part as PlanPart
        out.push({
          id: `${message.id ?? 'm'}-${out.length}`,
          title: plan.title ?? 'Plan',
          steps: plan.steps?.length ?? 0,
        })
      }
    }
    return out
  }, [conversation.messages])

  if (collapsed) {
    return (
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex justify-end">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand HUD"
          className="pointer-events-auto flex max-w-[320px] items-center gap-1.5 rounded-full border border-line/60 bg-hover px-2.5 py-1 text-[10.5px] text-ink-2 shadow-overlay transition-colors hover:text-ink"
        >
          <MapIcon size={12} className="shrink-0 text-ink-3" />
          <span className="shrink-0 font-mono tabular-nums text-green">{done}/{total}</span>
          {activeTodo ? (
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink">
              {stripMarkdown(activeTodo.title)}
            </span>
          ) : (
            <span className="shrink-0">{derived.length} agent{derived.length === 1 ? '' : 's'}</span>
          )}
          <X size={10} className="shrink-0 text-ink-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 w-[300px] max-w-[84%]">
      <div className="pointer-events-auto flex max-h-[70vh] flex-col overflow-hidden rounded-card border border-line/70 bg-hover shadow-overlay">
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {/* ── Git tools ─────────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 px-3 pb-0.5 pt-2.5">
              <span className="min-w-0 flex-1 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Git tools</span>
              <button
                type="button"
                onClick={() => onSelectTab('git-diff')}
                aria-label="More git actions"
                title="Open git diff"
                className="flex size-5 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
              >
                <MoreHorizontal size={13} />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse HUD"
                title="Collapse HUD"
                className="flex size-5 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>

            <div className="px-2 pb-1.5 pt-1">
              <HudRow
                icon={<FileText size={13} className="text-ink-3" />}
                label="Changes"
                onClick={() => onSelectTab('git-diff')}
                right={
                  stats.git.changed > 0 ? (
                    <span className="font-mono tabular-nums text-[10.5px]">
                      <span className="text-green">+{stats.git.added.toLocaleString()}</span>{' '}
                      <span className="text-red">−{stats.git.removed.toLocaleString()}</span>
                    </span>
                  ) : undefined
                }
              />
              <BranchSubmenu
                project={session.project}
                branch={stats.git.branch}
              />
              <CommitSubmenu
                project={session.project}
                branch={stats.git.branch}
                added={stats.git.added}
                removed={stats.git.removed}
                changed={stats.git.changed}
              />
            </div>
          </section>

          {plans.length > 0 ? (
            <>
              <div className="border-t border-line/50" />
              <section>
                <h3 className="px-3 pb-1 pt-2.5 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Plans</h3>
                <div className="px-2 pb-1.5 pt-1">
                  {plans.map((plan) => (
                    <HudRow
                      key={plan.id}
                      icon={<ListTodo size={13} className="text-ink-3" />}
                      label={stripMarkdown(plan.title)}
                      onClick={() => onSelectTab('plan')}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {total > 0 ? (
            <>
              <div className="border-t border-line/50" />
              <section>
                <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                  <h3 className="min-w-0 flex-1 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Progress</h3>
                  <span className="shrink-0 font-mono tabular-nums text-[10.5px] text-green">{done}/{total}</span>
                </div>
                <div className="px-2 pb-1.5 pt-1">
                  {stats.todos.slice(0, 8).map((todo) => {
                    const complete = todo.status === 'completed'
                    const active = todo.status === 'in_progress' || todo.status === 'blocked' || todo.status === 'failed'
                    return (
                      <HudRow
                        key={todo.id}
                        icon={
                          complete ? (
                            <CheckCircle2 size={13} className="shrink-0 text-green" />
                          ) : active ? (
                            <CircleDot size={13} className="shrink-0 text-orange" />
                          ) : (
                            <Circle size={13} className="shrink-0 text-ink-3" />
                          )
                        }
                        label={stripMarkdown(todo.title)}
                        onClick={() => onSelectTab('plan')}
                        muted={complete}
                      />
                    )
                  })}
                </div>
              </section>
            </>
          ) : null}

          <div className="border-t border-line/50" />
          <section>
            <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
              <h3 className="min-w-0 flex-1 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Agents</h3>
              <span className="shrink-0 font-mono tabular-nums text-[10.5px] text-ink-3">{derived.length} subagent{derived.length === 1 ? '' : 's'}</span>
            </div>
            <div className="px-2 pb-2 pt-1">
              <HudRow
                icon={<Bot size={13} className={cn('shrink-0', stats.running > 0 ? 'text-green' : 'text-ink-3')} />}
                label={primary.name}
                onClick={() => onSelectTab('agents')}
                right={<span className="shrink-0 font-mono text-[9.5px] uppercase text-ink-3">{primary.status}</span>}
              />
              {derived.slice(0, 5).map((agent) => (
                <HudRow
                  key={agent.id}
                  icon={
                    <span className={cn('size-1.5 shrink-0 rounded-full', agent.status === 'working' ? 'bg-green breathe' : agent.status === 'failed' ? 'bg-red' : 'bg-ink-3/60')} aria-hidden />
                  }
                  label={agent.name}
                  onClick={() => onSelectTab('agents')}
                  right={<span className="shrink-0 font-mono text-[9.5px] uppercase text-ink-3">{agent.status}</span>}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/* ── Git tools: branch submenu ─────────────────────────────────────────────── */

function BranchSubmenu({
  project,
  branch,
}: {
  project?: string | null
  branch?: string
}) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [current, setCurrent] = useState<string | undefined>(branch)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!project) return
    try {
      const data = await gitApi.branches(project)
      setBranches(data.branches ?? [])
      setCurrent(data.current ?? branch)
    } catch {
      /* keep stale state */
    }
  }, [project, branch])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  // Click-outside closes the submenu.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function checkout(name: string) {
    if (!project || name === current || busy) return
    setBusy(true)
    setError(null)
    try {
      await gitApi.checkout(project, name)
      setCurrent(name)
      setOpen(false)
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''))
    } finally {
      setBusy(false)
    }
  }

  async function createBranch() {
    if (!project || !newName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await gitApi.createBranch(project, newName.trim())
      setNewName('')
      setCreating(false)
      setOpen(false)
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const needle = filter.trim().toLowerCase()
  const visible = needle ? branches.filter((b) => b.name.toLowerCase().includes(needle)) : branches

  return (
    <div ref={ref} className="relative">
      <HudRow
        icon={<GitBranchIcon size={13} className="text-ink-3" />}
        label={current ?? branch ?? 'no repo'}
        onClick={() => setOpen((v) => !v)}
        right={<ChevronDown size={12} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />}
      />
      {open ? (
        <div className="mt-0.5 overflow-hidden rounded-lg border border-line/60 bg-surface shadow-overlay">
          <div className="flex items-center gap-1.5 border-b border-line/40 px-2 py-1.5">
            <Search size={11} className="shrink-0 text-ink-3" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find branch…"
              aria-label="Find branch"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <div className="scroll-thin max-h-[150px] overflow-y-auto py-0.5">
            {visible.length === 0 ? (
              <p className="px-2.5 py-2 text-[10.5px] text-ink-3">No branches match.</p>
            ) : (
              visible.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  disabled={busy}
                  onClick={() => void checkout(b.name)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                    b.name === current ? 'bg-hover-2' : 'hover:bg-hover-2',
                  )}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', b.name === current ? 'bg-green' : 'bg-ink-3/40')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink">{b.name}</span>
                  {b.name === current ? <Check size={11} className="shrink-0 text-green" /> : null}
                </button>
              ))
            )}
          </div>
          {creating ? (
            <div className="flex items-center gap-1.5 border-t border-line/40 px-2 py-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createBranch()
                }}
                placeholder="New branch name…"
                aria-label="New branch name"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                onClick={() => void createBranch()}
                disabled={busy || !newName.trim()}
                className="shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-medium text-black transition hover:bg-zinc-200 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 border-t border-line/40 px-2.5 py-1.5 text-left text-[10.5px] text-ink-2 transition-colors hover:bg-hover-2"
            >
              <Plus size={11} className="text-ink-3" />
              New branch
            </button>
          )}
          {error ? <p className="border-t border-line/40 px-2.5 py-1.5 text-[10px] text-red">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/* ── Git tools: commit submenu ─────────────────────────────────────────────── */

function CommitSubmenu({
  project,
  branch,
  added,
  removed,
  changed,
}: {
  project?: string | null
  branch?: string
  added: number
  removed: number
  changed: number
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'commit' | 'push' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Click-outside closes the submenu.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function run(push: boolean) {
    if (!project || !message.trim() || busy) return
    setBusy(push ? 'push' : 'commit')
    setError(null)
    setOk(null)
    try {
      const result = await gitApi.commit(project, message.trim(), push)
      setOk(`Committed ${result.head ?? ''}${result.pushed ? ' and pushed' : ''}`)
      if (result.push_error) setError(`Push failed: ${result.push_error}`)
      setMessage('')
      setTimeout(() => setOpen(false), 900)
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).replace(/^ApiError: /, ''))
    } finally {
      setBusy(null)
    }
  }

  function generateMessage() {
    setMessage(`Update ${changed} file${changed === 1 ? '' : 's'} (+${added.toLocaleString()} −${removed.toLocaleString()})`)
  }

  return (
    <div ref={ref} className="relative">
      <HudRow
        icon={<GitCommit size={13} className="text-ink-3" />}
        label="Commit or push"
        onClick={() => setOpen((v) => !v)}
        right={<ChevronDown size={12} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />}
      />
      {open ? (
        <div className="mt-0.5 overflow-hidden rounded-lg border border-line/60 bg-surface shadow-overlay">
          <div className="flex items-center justify-between gap-2 border-b border-line/40 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">{branch ?? 'no repo'}</span>
            <span className="shrink-0 font-mono text-[10px]">
              <span className="text-green">+{added.toLocaleString()}</span>{' '}
              <span className="text-red">−{removed.toLocaleString()}</span>{' '}
              <span className="text-ink-3">· {changed}</span>
            </span>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Describe what changed…"
            aria-label="Commit message"
            autoFocus
            className="block w-full resize-none bg-transparent px-2.5 py-2 text-[11.5px] leading-snug text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-between gap-2 border-t border-line/40 px-2.5 py-1.5">
            <button
              type="button"
              onClick={generateMessage}
              title="Auto-generate a draft commit message"
              aria-label="Auto-generate commit message"
              className="shrink-0 rounded-md p-1 text-amber-300 transition hover:bg-hover-2"
            >
              <Sparkles size={12} />
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void run(false)}
              disabled={busy !== null || !message.trim()}
              className="rounded-md bg-white px-2.5 py-1 text-[10.5px] font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'commit' ? <Loader2 size={11} className="inline animate-spin" /> : null}
              Commit
            </button>
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={busy !== null || !message.trim()}
              className="rounded-md border border-line-strong px-2.5 py-1 text-[10.5px] font-medium text-ink-2 transition hover:bg-hover-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'push' ? <Loader2 size={11} className="inline animate-spin" /> : null}
              Commit &amp; push
            </button>
          </div>
          {ok ? <p className="border-t border-line/40 px-2.5 py-1.5 text-[10px] text-green">{ok}</p> : null}
          {error ? <p className="border-t border-line/40 px-2.5 py-1.5 text-[10px] text-red">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Strip common Markdown markers so labels read cleanly in the HUD. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
}

function HudRow({
  icon,
  label,
  right,
  onClick,
  muted,
}: {
  icon: React.ReactNode
  label: string
  right?: React.ReactNode
  onClick?: () => void
  /** Dim the label (e.g. completed todos). */
  muted?: boolean
}) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const [truncated, setTruncated] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Detect truncation after mount / label change.
  useEffect(() => {
    const span = textRef.current
    if (span) setTruncated(span.scrollHeight > span.clientHeight)
  }, [label])

  // Anchor the tooltip to the row's left edge (the HUD hugs the screen's right
  // edge, so right-anchored tips would clip off-screen).
  function showTip() {
    const el = buttonRef.current
    if (!el || !truncated) return
    const rect = el.getBoundingClientRect()
    // Position the tooltip's right edge 8px left of the row, vertically centered.
    setTip({ x: rect.left - 8, y: rect.top + rect.height / 2 })
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className={cn(
        'flex relative w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left transition-colors',
        onClick ? 'hover:bg-hover-2' : 'cursor-default',
      )}
      onMouseEnter={showTip}
      onMouseLeave={() => setTip(null)}
      onFocus={showTip}
      onBlur={() => setTip(null)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span
        ref={textRef}
        className={cn('line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-snug', muted ? 'text-ink-3' : 'text-ink')}
      >
        {label}
      </span>
      {right}
      {tip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-[280px] rounded-lg border border-line/60 bg-surface px-2.5 py-1.5 text-[11.5px] leading-snug text-ink shadow-overlay"
          style={{ right: window.innerWidth - tip.x, top: tip.y, transform: 'translateY(-50%)' }}
        >
          {label}
        </span>
      ) : null}
    </button>
  )
}

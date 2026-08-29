/**
 * RightRailViews — the content views for the multi-tab right panel.
 *
 *   Plan         — the agent's live todos/plan steps (structured plan parts or
 *                  a markdown `# Plan:` fallback), with a local toggle.
 *   Agents       — primary agent + the subagents the agent spawned + activity.
 *   Git diff     — full git workflow with inline diffs (GitWorkspaceView).
 *   Git files    — changed-file list (overlay diff on click).
 *   Browser      — inline iframe webview with its own address bar.
 *   Goal         — session objective + plan progress.
 *   Sub-sessions — the other sessions in this workspace (switch here).
 *
 * Everything reads real daemon state via `workspaceData`; nothing is hardcoded
 * to one CLI.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity as ActivityIcon,
  FileText,
  Flag,
  Globe2,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useStore, getConversation, useConversation } from '@/store'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import { GitWorkspaceView } from './GitWorkspaceView'
import { PlanStepList } from './ProgressCard'
import { Timeline } from '@/components/Timeline'
import { Composer } from '@/components/Composer'
import {
  deriveAgentActivity,
  deriveSubagents,
  latestPlanInfo,
  latestUserPrompt,
  timeAgo,
  useAgentSummaries,
  useTodos,
  type AgentStatus,
} from './workspaceData'
import { Button } from '@/components/ui'

type Notify = (message: string, tone?: 'ok' | 'error') => void

/* ── Shared view header ───────────────────────────────────────────────────── */

function ViewHeader({ eyebrow, right }: { eyebrow: string; right?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line/40 bg-inset px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{eyebrow}</span>
      {right}
    </div>
  )
}

/* ── 1. Plan ───────────────────────────────────────────────────────────────── */

export function PlanView({ session, onNewTask }: { session: Session; onNewTask?: () => void }) {
  const { todos, toggle } = useTodos(session)
  const sendPrompt = useStore((s) => s.sendPrompt)
  const done = todos.filter((t) => t.status === 'completed').length
  const total = todos.length
  const active = todos.filter((t) => t.status !== 'completed').length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow="Plan"
        right={
          <span className="flex items-center gap-1">
            {onNewTask ? (
              <RailButton onClick={onNewTask} label="New task">
                <Plus size={12} /> New task
              </RailButton>
            ) : null}
            <span className="font-mono text-[10px] tabular-nums text-ink-3">{done}/{total}</span>
          </span>
        }
      />
      {/* Progress bar */}
      <div className="border-b border-line/40 px-3 py-2">
        <div className="h-1 min-w-0 overflow-hidden rounded-full bg-field">
          <div
            className="h-full rounded-full bg-accent-2 transition-all duration-500"
            style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[9.5px] text-ink-3">
          <span>{active} remaining</span>
          <span>{done} done</span>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        <PlanStepList todos={todos} onToggle={toggle} onRetry={(title) => void sendPrompt(session.id, `Retry step: ${title}`)} />
      </div>
    </div>
  )
}

/* ── 2. Agents ─────────────────────────────────────────────────────────────── */

const AGENT_STATUS_META: Record<AgentStatus, { label: string; tone: 'green' | 'orange' | 'red' | 'dim'; pulse?: boolean }> = {
  thinking: { label: 'Thinking', tone: 'green', pulse: true },
  working: { label: 'Working', tone: 'green', pulse: true },
  waiting: { label: 'Waiting', tone: 'orange' },
  blocked: { label: 'Blocked', tone: 'orange' },
  failed: { label: 'Failed', tone: 'red' },
  completed: { label: 'Completed', tone: 'green' },
  paused: { label: 'Paused', tone: 'orange' },
  idle: { label: 'Idle', tone: 'dim' },
}

const STATUS_TEXT: Record<'green' | 'orange' | 'red' | 'dim', string> = {
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red',
  dim: 'text-ink-3',
}

export function AgentsView({
  session,
}: {
  session: Session
}) {
  const { primary } = useAgentSummaries(session)
  const derived = deriveSubagents(getConversation(session.id).messages)
  const activity = deriveAgentActivity(getConversation(session.id).messages, 16)
  const totalSubagents = derived.length
  const [activeId, setActiveId] = useState<string>('primary')
  const activeDerived = derived.find((a) => a.id === activeId)
  const activeAgent = activeId === 'primary' || !activeDerived
    ? { id: 'primary', name: primary.name, kind: primary.agentType, task: primary.currentTask, status: primary.status }
    : { id: activeDerived.id, name: activeDerived.name, kind: activeDerived.kind || 'subagent', task: activeDerived.name, status: activeDerived.status }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader eyebrow="Agents" right={<span className="font-mono text-[10px] text-ink-3">{totalSubagents} subagent{totalSubagents === 1 ? '' : 's'}</span>} />

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* Agent list — click to view that agent's real-time progress */}
        <div className="border-b border-line/40 px-3 py-2">
          <AgentListRow
            name={primary.name}
            kind={`${primary.agentType} · primary`}
            status={primary.status}
            active={activeAgent.id === 'primary'}
            onSelect={() => setActiveId('primary')}
          />
          {derived.map((agent) => (
            <AgentListRow
              key={agent.id}
              name={agent.name}
              kind={agent.kind || 'subagent'}
              status={agent.status}
              active={activeAgent.id === agent.id}
              onSelect={() => setActiveId(agent.id)}
            />
          ))}
        </div>

        {/* Live timeline of the selected agent's real events */}
        <section className="px-3 pb-3 pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wide text-ink-3">Live timeline · {activeAgent.name}</h3>
            <span className={cn('shrink-0 font-mono text-[9px]', STATUS_TEXT[AGENT_STATUS_META[activeAgent.status as AgentStatus]?.tone ?? 'dim'])}>
              {AGENT_STATUS_META[activeAgent.status as AgentStatus]?.label ?? activeAgent.status}
            </span>
          </div>
          {activeAgent.task ? (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-line/40 bg-inset px-2 py-1.5 text-[11px] leading-snug text-ink-2">
              <ActivityIcon size={11} className="mt-0.5 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">{activeAgent.task}</span>
            </p>
          ) : null}
          {activity.length === 0 ? (
            <p className="text-[11px] text-ink-3">No activity yet — agent events stream here in real time.</p>
          ) : (
            <ol className="relative space-y-1 border-l border-line/40 pl-3">
              {activity.map((event, idx) => {
                const active = idx === 0
                return (
                  <li key={`${event.timestamp}-${idx}`} className="relative">
                    <span className={cn('absolute -left-[15.5px] top-1 flex size-2.5 items-center justify-center rounded-full border border-line/50 bg-surface text-ink-3', active && event.kind !== 'error' && 'text-green')} aria-hidden>
                      <span className={cn('size-1 rounded-full', event.kind === 'error' ? 'bg-red' : active ? 'bg-green breathe' : 'bg-current')} />
                    </span>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-[11px]', event.kind === 'error' ? 'text-red' : active ? 'font-medium text-ink' : 'text-ink-2')}>{event.label}</span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-3">{timeAgo(event.timestamp, Date.now())}</span>
                    </div>
                    {event.detail ? <p className="truncate font-mono text-[9.5px] text-ink-3">{event.detail}</p> : null}
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

function AgentListRow({
  name,
  kind,
  status,
  active,
  onSelect,
}: {
  name: string
  kind: string
  status: string
  active: boolean
  onSelect: () => void
}) {
  const meta = AGENT_STATUS_META[status as AgentStatus] ?? AGENT_STATUS_META.idle
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={name}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-1.5 py-1.5 text-left transition-colors',
        active ? 'bg-hover' : 'hover:bg-hover-2',
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', meta.tone === 'green' ? 'bg-green' : meta.tone === 'orange' ? 'bg-orange' : meta.tone === 'red' ? 'bg-red' : 'bg-ink-3/60')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] text-ink">{name}</span>
        <span className="block truncate font-mono text-[9px] uppercase text-ink-3">{kind}</span>
      </span>
      <span className={cn('shrink-0 font-mono text-[9.5px]', STATUS_TEXT[meta.tone])}>{meta.label}</span>
    </button>
  )
}

/* ── 3. Git diff / Git files ───────────────────────────────────────────────── */

export function GitDiffView({ session, notify, refreshKey }: { session: Session; notify: Notify; refreshKey?: number }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GitWorkspaceView session={session} notify={notify} inlineDiff refreshKey={refreshKey} />
    </div>
  )
}

export function GitFilesView({ session, notify, refreshKey }: { session: Session; notify: Notify; refreshKey?: number }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GitWorkspaceView session={session} notify={notify} refreshKey={refreshKey} />
    </div>
  )
}

/* ── 4. Browser ────────────────────────────────────────────────────────────── */

export function BrowserView({ session }: { session?: Session }) {
  const [draft, setDraft] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [browserRunning, setBrowserRunning] = useState(false)
  const [browserTabs, setBrowserTabs] = useState<Array<{ id: string; url: string; title: string }>>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const screenshotRef = useRef(0)

  const sessionId = session?.id
  // Live AI-cursor position from WS `browser_cursor_*` events.
  const aiCursor = useStore((s) => (sessionId ? s.browserCursors[sessionId] : undefined))
  // The screenshot is letterboxed (object-contain); map page coordinates
  // (1280x900 CSS px, the CDP viewport) onto the image's actual rendered box.
  const browserBoxRef = useRef<HTMLDivElement>(null)
  const browserImgRef = useRef<HTMLImageElement>(null)
  const [cursorOverlay, setCursorOverlay] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const img = browserImgRef.current
    const box = browserBoxRef.current
    if (!aiCursor || !img || !box) {
      setCursorOverlay(null)
      return
    }
    const rect = img.getBoundingClientRect()
    const host = box.getBoundingClientRect()
    setCursorOverlay({
      left: rect.left - host.left + (aiCursor.x / 1280) * rect.width,
      top: rect.top - host.top + (aiCursor.y / 900) * rect.height,
    })
  }, [aiCursor, browserRunning, activeTab])

  // Poll browser state: auto-detects the agent's running browser (daemon- or
  // agent-spawned — the daemon proxies both) and keeps tabs fresh. Mirror mode
  // turns on as soon as a tab exists, no "Start CDP" click needed.
  useEffect(() => {
    if (!sessionId) return
    let stopped = false
    const poll = async () => {
      try {
        const { browserApi } = await import('@/lib/api')
        const data = await browserApi.state(sessionId)
        if (stopped) return
        if (data.ok && data.tabs) {
          setBrowserTabs(data.tabs)
          if (data.tabs.length > 0) {
            setBrowserRunning(true)
            if (!activeTab || !data.tabs.some((t) => t.id === activeTab)) {
              setActiveTab(data.tabs[0].id)
            }
          }
        } else if (browserRunning) {
          // Browser went away (agent finished, instance stopped).
          setBrowserRunning(false)
          setBrowserTabs([])
          setActiveTab(null)
        }
      } catch {
        // Transient error — keep the button available, don't flap.
      }
    }
    void poll()
    const interval = setInterval(poll, 2000)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [sessionId, activeTab, browserRunning])

  // The live mirror refreshes when the agent actually acts — a `browser_step`
  // lands (navigate/click/type/…) — with a slow idle fallback for pages that
  // change without steps. Never remount the <img> or rebuild its URL on every
  // render: that made the mirror look like it was "constantly reloading".
  const revision = useStore((s) => (sessionId ? s.revisions[sessionId] : 0))
  const lastBrowserStep = useMemo(() => {
    const conv = sessionId ? getConversation(sessionId) : undefined
    if (!conv) return ''
    for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
      for (const part of conv.messages[i].parts) {
        if (part.kind === 'browser') return `${part.id}:${part.status}`
      }
    }
    return ''
  }, [revision, sessionId])

  useEffect(() => {
    if (!browserRunning) return
    // Refresh on real activity…
    if (lastBrowserStep) screenshotRef.current += 1
    // …and as a slow fallback so a page that changes without agent steps
    // (animations, timers, streams) still stays live.
    const interval = setInterval(() => { screenshotRef.current += 1 }, 5000)
    return () => clearInterval(interval)
  }, [browserRunning, lastBrowserStep])

  async function startBrowser() {
    if (!sessionId) return
    setBrowserError(null)
    try {
      const { browserApi } = await import('@/lib/api')
      const result = await browserApi.start(sessionId)
      if (result.ok) {
        setBrowserRunning(true)
      } else {
        setBrowserError(result.error ?? 'Failed to start browser')
      }
    } catch (e) {
      setBrowserError(String(e))
    }
  }

  async function stopBrowser() {
    if (!sessionId) return
    try {
      const { browserApi } = await import('@/lib/api')
      await browserApi.stop(sessionId)
      setBrowserRunning(false)
      setBrowserTabs([])
      setActiveTab(null)
      setBrowserError(null)
    } catch { /* ignore */ }
  }

  const navigate = () => {
    const v = draft.trim()
    if (!v) return
    setUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    setReloadKey((k) => k + 1)
    setLoading(true)
  }

  // CDP mirror mode
  if (browserRunning && activeTab) {
    const screenshotUrl = `/api/browser/${encodeURIComponent(sessionId ?? '')}/screenshot/${encodeURIComponent(activeTab)}`
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewHeader
          eyebrow="Browser"
          right={
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-green">CDP</span>
              {aiCursor ? <span className="font-mono text-[9px] text-ink-3">AI cursor {aiCursor.x},{aiCursor.y}</span> : null}
              {browserTabs.length > 1 ? browserTabs.map((t) => (
                <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                  className={cn('rounded px-1 py-0.5 font-mono text-[9px]', t.id === activeTab ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover-2')}
                >{t.title.slice(0, 12)}</button>
              )) : null}
              <button type="button" onClick={stopBrowser} className="rounded-md px-1.5 py-0.5 text-[10px] text-red hover:bg-hover-2">Stop</button>
            </span>
          }
        />
        <div ref={browserBoxRef} className="relative min-h-0 flex-1 bg-white">
          <img ref={browserImgRef} src={`${screenshotUrl}?t=${screenshotRef.current}`} alt="Browser page" className="size-full object-contain" />
          {cursorOverlay ? (
            <div
              className="pointer-events-none absolute z-20 transition-[left,top] duration-150 ease-out"
              style={{ left: cursorOverlay.left, top: cursorOverlay.top, transform: 'translate(-50%,-50%)' }}
            >
              <AiCursorPointer pressed={aiCursor?.pressed === true} />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (!url) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewHeader eyebrow="Browser" right={
          <span className="flex items-center gap-1.5">
            {sessionId ? (
              browserRunning ? (
                <button type="button" onClick={stopBrowser} className="rounded-md px-1.5 py-0.5 text-[10px] text-red hover:bg-hover-2">Stop</button>
              ) : (
                <button type="button" onClick={() => void startBrowser()} className="rounded-md px-1.5 py-0.5 text-[10px] text-green hover:bg-hover-2">Start CDP</button>
              )
            ) : null}
            <span className="font-mono text-[10px] text-ink-3">webview</span>
          </span>
        } />
        {browserError ? <p className="px-3 py-2 text-[11px] text-red">{browserError}</p> : null}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-2xl border border-line/50 bg-surface text-ink-3"><Globe2 size={20} /></span>
          <p className="mt-1 text-[13px] font-medium text-ink">{browserRunning ? 'Browser running' : 'No page open'}</p>
          <p className="max-w-[240px] text-[11.5px] leading-[1.6] text-ink-3">
            {browserRunning ? 'The CDP browser is ready. The agent will open pages through MCP tools.' : 'Enter a URL below to browse inline, or start the CDP browser for automation.'}
          </p>
          {!browserRunning ? (
            <div className="mt-2 flex w-full max-w-[280px] items-center gap-1.5 rounded-lg border border-line/50 bg-field px-2 py-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate() }}
                placeholder="https://example.com"
                aria-label="Address"
                className="h-6 min-w-0 flex-1 bg-transparent font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-3"
              />
              <Button variant="surface" className="min-h-6 rounded-md px-2 py-0 text-[11px]" onClick={navigate}>Go</Button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow="Browser"
        right={
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setReloadKey((k) => k + 1); setLoading(true) }}
              aria-label="Reload"
              className="rounded-md p-1 text-ink-3 hover:bg-hover-2 hover:text-ink"
            >
              <RefreshCw size={12} />
            </button>
            <span className="max-w-[160px] truncate font-mono text-[10px] text-ink-3">{url}</span>
          </span>
        }
      />
      <div className="relative min-h-0 flex-1 bg-white">
        {loading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-canvas">
            <Loader2 size={18} className="animate-spin text-ink-3" />
            <p className="text-[11px] text-ink-3">Loading page…</p>
          </div>
        ) : null}
        <iframe key={`${url}-${reloadKey}`} src={url} title="Browser page" className="size-full border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" onLoad={() => setLoading(false)} />
      </div>
    </div>
  )
}

/* ── AI cursor overlay pointer ────────────────────────────────────────────── */

/** Small visible pointer the AI drives over the mirrored browser page. */
function AiCursorPointer({ pressed }: { pressed: boolean }) {
  return (
    <div className={cn('relative flex size-5 items-center justify-center transition-transform duration-100', pressed ? 'scale-150' : 'scale-100')}>
      {/* Outer ring */}
      <div className={cn(
        'absolute inset-0 rounded-full opacity-70',
        pressed ? 'border-2 border-red-500 bg-red-500/20' : 'border-2 border-blue-500 bg-blue-500/20',
      )} />
      {/* Inner dot */}
      <div className={cn(
        'size-2 rounded-full shadow-md',
        pressed ? 'bg-red-500' : 'bg-blue-500',
      )} />
    </div>
  )
}

/* ── 5. Goal ───────────────────────────────────────────────────────────────── */

export function GoalView({ session }: { session: Session }) {
  const conversation = getConversation(session.id)
  const objective = latestUserPrompt(conversation.messages)
  const plan = latestPlanInfo(conversation.messages)
  const { todos } = useTodos(session)
  const done = todos.filter((t) => t.status === 'completed').length
  const total = todos.length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader eyebrow="Goal" right={<span className="font-mono text-[10px] text-ink-3">{done}/{total} steps</span>} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <h2 className="text-[12.5px] font-semibold text-ink">{plan?.title ?? session.name}</h2>
        {objective ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-line/40 bg-inset px-2 py-2">
            <Flag size={12} className="mt-0.5 shrink-0 text-ink-3" />
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[11.5px] leading-[1.6] text-ink-2">{objective}</p>
          </div>
        ) : (
          <p className="mt-2 text-[11.5px] text-ink-3">No objective recorded yet — send the agent a message to set one.</p>
        )}

        <div className="mt-3">
          <div className="flex items-center justify-between font-mono text-[10px] text-ink-3">
            <span>Progress</span><span>{done}/{total}</span>
          </div>
          <div className="mt-1 h-1 min-w-0 overflow-hidden rounded-full bg-field">
            <div className="h-full rounded-full bg-accent-2 transition-all duration-500" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>
        </div>

        {plan && plan.relatedFiles.length > 0 ? (
          <div className="mt-3">
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">Related files</h3>
            <div className="flex flex-wrap items-center gap-1">
              {plan.relatedFiles.map((path) => (
                <span key={path} className="inline-flex items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 font-mono text-[9.5px] text-ink-2">
                  <FileText size={10} className="text-ink-3" /> {path.split('/').pop()}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ── 6. Sub-sessions ───────────────────────────────────────────────────────── */

export function SubSessionsView({
  session,
  onOpenSession,
}: {
  session: Session
  onOpenSession?: (sessionId: string) => void
}) {
  const { here } = useAgentSummaries(session)
  const currentId = session.id

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader eyebrow="Sub-sessions" right={<span className="font-mono text-[10px] text-ink-3">{here.length} in workspace</span>} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {here.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">No sessions in this workspace yet.</p>
        ) : (
          <ol className="space-y-0.5">
            {here.map((s) => {
              const isCurrent = s.id === currentId
              const active = s.status === 'running' || s.status === 'starting'
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSession?.(s.id)}
                    disabled={isCurrent}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors',
                      isCurrent ? 'bg-hover text-ink' : 'hover:bg-hover-2 hover:text-ink',
                    )}
                  >
                    <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-green breathe' : s.status === 'waiting_for_approval' || s.status === 'waiting_for_input' ? 'bg-orange' : 'bg-ink-3/60')} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{s.name}</span>
                    <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">{s.agent}</span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-3">{s.status.replace(/_/g, ' ')}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/* ── 7. Side session ───────────────────────────────────────────────────────── */

const SIDE_KEY = (project?: string | null) => `agentdeck-side-session-${project ?? 'default'}`

export function getSideSessionId(project?: string | null): string | null {
  try {
    return localStorage.getItem(SIDE_KEY(project))
  } catch {
    return null
  }
}

export function setSideSessionId(project: string | null | undefined, id: string) {
  try {
    localStorage.setItem(SIDE_KEY(project), id)
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * A mini chat bound to a "side" session — a parallel conversation the user
 * opened with `/side <prompt>` (and pings with `/btw <message>`) without
 * leaving the main session. Same project/context, independent thread.
 */
export function SideSessionView({
  session,
  onNewSide,
}: {
  session: Session
  onNewSide?: () => void
}) {
  const sideId = getSideSessionId(session.project)
  const connection = useStore((s) => s.connection)
  const sendPrompt = useStore((s) => s.sendPrompt)
  const openSession = useStore((s) => s.openSession)
  const sideSess = useStore((s) => s.sessions.find((x) => x.id === sideId))
  const conv = useConversation(sideId ?? session.id)

  useEffect(() => {
    if (sideId) void openSession(sideId)
  }, [sideId, openSession])

  if (!sideId) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewHeader eyebrow="Side session" right={<span className="font-mono text-[10px] text-ink-3">off</span>} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-2xl border border-line/50 bg-surface text-ink-3">
            <MessagesSquare size={20} />
          </span>
          <p className="mt-1 text-[13px] font-medium text-ink">No side session</p>
          <p className="max-w-[240px] text-[11.5px] leading-[1.6] text-ink-3">
            Type <code className="text-ink-2">/side &lt;prompt&gt;</code> in the main composer to open a side session you can chat with in parallel — ping it anytime with <code className="text-ink-2">/btw</code>.
          </p>
          {onNewSide ? (
            <Button variant="surface" className="mt-2 min-h-7 rounded-lg px-2.5 text-[11.5px]" onClick={onNewSide}>
              <Plus size={12} /> Open a side session
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow="Side session"
        right={
          <span className="flex items-center gap-2">
            {sideSess ? (
              <span className="max-w-[140px] truncate font-mono text-[10px] text-ink-3">{sideSess.name}</span>
            ) : null}
            <span className={cn('size-1.5 shrink-0 rounded-full', sideSess?.status === 'running' ? 'bg-green breathe' : 'bg-ink-3/60')} aria-hidden />
          </span>
        }
      />
      <Timeline
        conversation={conv}
        onRespond={(id, d, m) => useStore.getState().respondToApproval(sideId, id, d, m)}
        project={session.project ?? undefined}
        sessionId={sideId}
      />
      <Composer
        wide
        onSend={(text) => sendPrompt(sideId, text)}
        onStop={() => void useStore.getState().stopSession(sideId)}
        working={sideSess?.status === 'running'}
        disabled={connection !== 'connected'}
        placeholder="Message the side session…"
      />
    </div>
  )
}

/* ── Small shared button ───────────────────────────────────────────────────── */

function RailButton({ children, onClick, label }: { children: React.ReactNode; onClick?: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-ink-3 transition hover:bg-hover-2 hover:text-ink">
      {children}
    </button>
  )
}

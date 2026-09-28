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
  ChevronRight,
  FileText,
  Flag,
  Folder,
  Globe2,
  Loader2,
  MessagesSquare,
  Play,
  Plus,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useStore, getConversation, useConversation } from '@/store'
import { serveApi, workspaceApi } from '@/lib/api'
import { closeFile, openFile, useOpenFile } from '@/lib/fileViewer'
import { basename, cn, relativeTime } from '@/lib/format'
import { mentionedWorkers, useActiveRoomId, useRooms, runRoomTask } from '@/lib/rooms'
import { getSideSessionId } from '@/lib/sideSession'
import { RoomAvatarStack, WorkerAvatar } from '../RoomAvatars'
import { FileExplorer } from '../FileExplorer'
import { isInternalSession } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { GitWorkspaceView } from './GitWorkspaceView'
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
  const conversation = useConversation(session.id)
  const plan = latestPlanInfo(conversation.messages)
  const planText = plan?.text?.trim() ?? ''

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow="Plan"
        right={
          onNewTask ? (
            <RailButton onClick={onNewTask} label="New task">
              <Plus size={12} /> New task
            </RailButton>
          ) : null
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* Full plan body the agent wrote. The todo checklist lives in the HUD
            Progress section; this surface is for reading the plan in full. */}
        {planText ? (
          <div className="px-3.5 py-3">
            {planText
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((line, index) => {
                const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line)
                if (headingMatch) {
                  const level = headingMatch[1].length
                  const text = headingMatch[2]
                  const size = level === 1 ? 'text-[15px]' : level === 2 ? 'text-[13.5px]' : 'text-[12.5px]'
                  return (
                    <h3
                      key={index}
                      className={cn(
                        'font-semibold text-ink first:mt-0',
                        'mt-3.5',
                        size,
                        level === 1 && 'pb-1.5',
                      )}
                    >
                      {text}
                    </h3>
                  )
                }
                const bullet = /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)
                const clean = line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '')
                return (
                  <p
                    key={index}
                    className={cn(
                      'whitespace-pre-wrap break-words leading-[1.65]',
                      bullet ? 'ml-3 flex gap-1.5 text-[12px] text-ink-2' : 'mt-1.5 text-[12.5px] text-ink-2',
                    )}
                  >
                    {bullet ? <span className="shrink-0 text-ink-3">•</span> : null}
                    <span className="min-w-0 flex-1">{clean}</span>
                  </p>
                )
              })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-3.5 py-14 text-center">
            <p className="text-[12.5px] font-medium text-ink-2">No plan yet</p>
            <p className="max-w-[36ch] text-[11.5px] leading-[1.6] text-ink-3">
              The agent will write its plan here when it has one. Until then, the HUD Progress section shows the live todo checklist.
            </p>
          </div>
        )}

        {/* Related files (when the agent produced the plan alongside edits). */}
        {plan?.relatedFiles && plan.relatedFiles.length > 0 ? (
          <div className="mt-2 border-t border-line/40 px-3.5 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Related files</p>
            <ul className="mt-1 flex flex-col">
              {plan.relatedFiles.map((path) => (
                <li key={path} className="truncate font-mono text-[11px] text-ink-2">{path}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
                      <span className={cn('size-1 rounded-full', event.kind === 'error' ? 'bg-red' : active ? 'bg-accent breathe' : 'bg-current')} />
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

export function BrowserView({
  session,
  onEngineActive,
}: {
  session?: Session
  /** Fired once when the agent's CDP engine goes live (tab detected). */
  onEngineActive?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [browserRunning, setBrowserRunning] = useState(false)
  const [browserTabs, setBrowserTabs] = useState<Array<{ id: string; url: string; title: string }>>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const [screenshotFailed, setScreenshotFailed] = useState(false)
  const [mirrorNavPending, setMirrorNavPending] = useState(false)
  const [mirrorTick, setMirrorTick] = useState(0)
  // Engine viewport (CSS px the CDP page renders at) + profile mode, reported
  // by /state. Coordinate mapping must use these, not hardcoded 1280x900.
  const [viewport, setViewport] = useState({ width: 1280, height: 900 })
  const [profileSaved, setProfileSaved] = useState(false)
  // Fire `onEngineActive` once per engine start, not on every 2s poll.
  const engineNotifiedRef = useRef(false)
  // Throttle mirror wheel-scroll driving (one CDP wheel event per 180ms max).
  const lastWheelRef = useRef(0)

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
      left: rect.left - host.left + (aiCursor.x / viewport.width) * rect.width,
      top: rect.top - host.top + (aiCursor.y / viewport.height) * rect.height,
    })
  }, [aiCursor, browserRunning, activeTab, viewport])

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
          if (data.viewport?.width && data.viewport?.height) {
            setViewport({ width: data.viewport.width, height: data.viewport.height })
          }
          setProfileSaved(data.persistent === true)
          if (data.tabs.length > 0) {
            setBrowserRunning(true)
            // Auto-open the Browser tab the first time the agent's CDP engine
            // goes live — browsing should surface itself, not hide behind the
            // tab picker.
            if (!engineNotifiedRef.current) {
              engineNotifiedRef.current = true
              onEngineActive?.()
            }
            if (!activeTab || !data.tabs.some((t) => t.id === activeTab)) {
              setActiveTab(data.tabs[0].id)
            }
          }
        } else if (browserRunning) {
          // Browser went away (agent finished, instance stopped).
          setBrowserRunning(false)
          setBrowserTabs([])
          setActiveTab(null)
          engineNotifiedRef.current = false
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
  }, [sessionId, activeTab, browserRunning, onEngineActive])

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

  // The live mirror refreshes as real state: every `browser_step` (navigate /
  // click / type / … — agent OR your own takeover clicks below) bumps the
  // tick, so the <img> URL actually changes and the frame reloads. Between
  // steps a interval keeps it live: fast while the agent is acting, slow at
  // idle (pages still animate without steps). This is state-driven — unlike
  // the old ref-only bump, which never re-rendered and left idle frames stale.
  useEffect(() => {
    if (!browserRunning) return
    if (lastBrowserStep) setMirrorTick((t) => t + 1)
    const actingNow = lastBrowserStep.length > 0 && lastBrowserStep.endsWith(':running')
    const interval = setInterval(() => setMirrorTick((t) => t + 1), actingNow ? 2500 : 8000)
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

  /* ── Workspace app server ("run this app") ──────────────────────────── */
  const project = session?.project ?? null
  const [serving, setServing] = useState<{ port: number; command: string } | null>(null)
  const [serveBusy, setServeBusy] = useState(false)
  const [serveError, setServeError] = useState<string | null>(null)
  const [serveCommand, setServeCommand] = useState('')
  const [hasPackageJson, setHasPackageJson] = useState(false)

  // Serving state + a package.json hint, refreshed with the project and
  // re-polled: the port changes on every restart (by you, the agent, or
  // another client), and a one-shot read goes stale — the stale :port chip
  // is what sent agents sleuthing with lsof.
  useEffect(() => {
    if (!project) {
      setServing(null)
      setHasPackageJson(false)
      return
    }
    let cancelled = false
    const refreshServing = () => {
      serveApi
        .status(project)
        .then((status) => {
          if (!cancelled && status.running && status.port) {
            setServing({ port: status.port, command: status.command ?? '' })
          } else if (!cancelled) {
            setServing(null)
          }
        })
        .catch(() => {
          if (!cancelled) setServing(null)
        })
    }
    refreshServing()
    const interval = setInterval(refreshServing, 5000)
    workspaceApi
      .dirs(project, true)
      .then((listing) => {
        if (!cancelled) {
          setHasPackageJson((listing.entries ?? []).some((entry) => !entry.dir && entry.name === 'package.json'))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [project])

  /** One-tap commands for common stacks — {port} is wired automatically. */
  const SERVE_PRESETS: Array<{ label: string; command: string }> = [
    { label: 'Static', command: '' },
    { label: 'npm run dev', command: 'npm run dev -- --port {port} --host 127.0.0.1' },
    { label: 'Vite', command: 'npx vite --port {port} --host 127.0.0.1 --strictPort' },
    { label: 'Next.js', command: 'npx next dev -p {port} -H 127.0.0.1' },
  ]

  function appUrl(port: number): string {
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1'
    return `http://${host}:${port}`
  }

  async function startApp() {
    if (!project || serveBusy) return
    setServeBusy(true)
    setServeError(null)
    try {
      const result = await serveApi.start(project, serveCommand.trim() || undefined)
      if (result.ok && result.port) {
        setServing({ port: result.port, command: serveCommand.trim() })
        const url = appUrl(result.port)
        setDraft(url)
        setUrl(url)
        setReloadKey((k) => k + 1)
        setLoading(true)
      } else {
        setServeError(result.error ?? 'Could not start the app server')
      }
    } catch (e) {
      setServeError(e instanceof Error ? e.message : String(e))
    } finally {
      setServeBusy(false)
    }
  }

  async function stopApp() {
    if (!project) return
    try {
      await serveApi.stop(project)
    } catch { /* best effort */ }
    setServing(null)
  }

  const navigate = () => {
    const v = draft.trim()
    if (!v) return
    setUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    setReloadKey((k) => k + 1)
    setLoading(true)
  }

  const activeTabInfo = browserTabs.find((t) => t.id === activeTab) ?? null
  // The agent is mid-action while the latest timeline browser step is running.
  const acting = lastBrowserStep.length > 0 && lastBrowserStep.endsWith(':running')

  // Drive the agent's CDP engine from the mirror's address bar / reload — the
  // same browser_goto the agent calls over MCP, so manual navigation lands in
  // the timeline too and the mirror refreshes on the resulting step.
  async function mirrorNavigate(raw: string) {
    const v = raw.trim()
    if (!v || !sessionId || !activeTab) return
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`
    setDraft(url)
    setMirrorNavPending(true)
    try {
      const { browserApi } = await import('@/lib/api')
      await browserApi.tool(sessionId, 'browser_goto', { tab: activeTab, url })
    } catch {
      /* transient — the next state poll will reconcile */
    }
    setMirrorNavPending(false)
  }

  /* ── User takeover: drive the SAME engine the agent automates ──────────
   * Clicks / scrolls / typing go through the identical browser_* tools, so
   * they land in the timeline like agent steps and visibly move the AI
   * cursor. The agent is told (skill doc) to re-snapshot after you
   * interfere — glance at the chat to see it notice. */
  const [takeoverText, setTakeoverText] = useState('')

  function mirrorPageCoords(e: React.MouseEvent): { x: number; y: number } | null {
    const img = browserImgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * viewport.width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * viewport.height),
    }
  }

  async function mirrorClick(e: React.MouseEvent) {
    if (!sessionId || !activeTab) return
    const pt = mirrorPageCoords(e)
    if (!pt) return
    try {
      const { browserApi } = await import('@/lib/api')
      await browserApi.tool(sessionId, 'browser_cua_click', { tab: activeTab, x: pt.x, y: pt.y })
      // The click lands as a timeline step; refresh the frame right after it.
      setTimeout(() => setMirrorTick((t) => t + 1), 600)
    } catch {
      /* transient — the next state poll will reconcile */
    }
  }

  // Wheel over the mirror scrolls the automated page (native non-passive
  // listener: React onWheel can't preventDefault the pane scroll).
  useEffect(() => {
    const box = browserBoxRef.current
    if (!box || !browserRunning || !activeTab || !sessionId) return
    const vw = viewport.width
    const vh = viewport.height
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelRef.current < 180) return
      lastWheelRef.current = now
      import('@/lib/api').then(({ browserApi }) =>
        browserApi
          .tool(sessionId, 'browser_cua_scroll', {
            tab: activeTab,
            x: Math.round(vw / 2),
            y: Math.round(vh / 2),
            scrollX: 0,
            scrollY: Math.round(e.deltaY),
          })
          .catch(() => {}),
      )
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [browserRunning, activeTab, viewport, sessionId])

  async function mirrorType() {
    const text = takeoverText
    if (!text || !sessionId) return
    setTakeoverText('')
    try {
      const { browserApi } = await import('@/lib/api')
      // Types at the current focus — click a field in the mirror first.
      await browserApi.tool(sessionId, 'browser_cursor_type', { tab: activeTab ?? undefined, text })
    } catch {
      /* transient */
    }
  }

  // CDP mirror mode — live AND drivable: click the page to take over, scroll
  // with the wheel, type via the toolbar box. Everything drives the same
  // engine the agent automates and lands in the timeline as browser steps.
  if (browserRunning && activeTab) {
    const screenshotUrl = `/api/browser/${encodeURIComponent(sessionId ?? '')}/screenshot/${encodeURIComponent(activeTab)}`
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewHeader
          eyebrow="Browser"
          right={
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-green">CDP</span>
              {acting ? (
                <span className="flex items-center gap-1 font-mono text-[9px] text-accent" title="The agent is driving the browser right now — you can still click in">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden /> LIVE
                </span>
              ) : (
                <span className="font-mono text-[9px] text-ink-3" title="Mirror is live; click the page anytime to take over">mirror</span>
              )}
              {profileSaved ? (
                <span className="font-mono text-[9px] text-ink-3" title="Persistent profile — cookies and logins survive restarts">saved</span>
              ) : null}
              <span className="font-mono text-[9px] text-ink-3" title="Page viewport in CSS px">{viewport.width}×{viewport.height}</span>
              {aiCursor ? <span className="font-mono text-[9px] text-ink-3">AI cursor {aiCursor.x},{aiCursor.y}</span> : null}
              {activeTabInfo ? <span className="max-w-[140px] truncate font-mono text-[9.5px] text-ink-3">{activeTabInfo.title}</span> : null}
              {browserTabs.length > 1 ? browserTabs.map((t) => (
                <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                  className={cn('rounded px-1 py-0.5 font-mono text-[9px]', t.id === activeTab ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover-2')}
                >{t.title.slice(0, 12)}</button>
              )) : null}
              <button type="button" onClick={stopBrowser} className="rounded-md px-1.5 py-0.5 text-[10px] text-red hover:bg-hover-2">Stop</button>
            </span>
          }
        />
        <div className="flex items-center gap-1.5 border-b border-line/40 bg-surface px-2 py-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void mirrorNavigate(draft) }}
            placeholder={activeTabInfo?.url ?? 'https://example.com'}
            aria-label="Address"
            className="h-6 min-w-0 flex-1 rounded-md border border-line/50 bg-field px-2 font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-3"
          />
          <Button variant="surface" className="min-h-6 rounded-md px-2 py-0 text-[11px]" onClick={() => void mirrorNavigate(draft)}>{mirrorNavPending ? '…' : 'Go'}</Button>
          <button
            type="button"
            onClick={() => activeTabInfo?.url ? void mirrorNavigate(activeTabInfo.url) : undefined}
            aria-label="Reload"
            disabled={mirrorNavPending}
            className="rounded-md p-1 text-ink-3 hover:bg-hover-2 hover:text-ink disabled:opacity-40"
          >
            <RefreshCw size={12} />
          </button>
          <input
            value={takeoverText}
            onChange={(e) => setTakeoverText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void mirrorType() }}
            placeholder="Type… (click a field first)"
            aria-label="Type into the automated page"
            title="Click a field in the page first to focus it, then type here"
            className="h-6 w-28 rounded-md border border-line/50 bg-field px-2 font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <div
          ref={browserBoxRef}
          onClick={(e) => void mirrorClick(e)}
          title="Live automated page — click to take over, scroll with the wheel. Your actions land in the timeline."
          className="relative min-h-0 flex-1 cursor-crosshair bg-white"
        >
          <img
            ref={browserImgRef}
            src={`${screenshotUrl}?t=${mirrorTick}`}
            alt="Browser page"
            className={cn('size-full object-contain', screenshotFailed && 'hidden')}
            onLoad={() => setScreenshotFailed(false)}
            onError={() => setScreenshotFailed(true)}
            draggable={false}
          />
          {screenshotFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas">
              <Loader2 size={18} className="animate-spin text-ink-3" />
              <p className="text-[11px] text-ink-3">Waiting for the page to render…</p>
            </div>
          ) : null}
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
            {browserRunning ? 'The CDP browser is ready. The agent will open pages through MCP tools.' : 'Enter a URL below to browse inline, or start the CDP browser for automation — its page then mirrors here live, and you can click, scroll, and type straight into it while the agent works.'}
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
          {project ? (
            <div className="mt-3 w-full max-w-[280px] rounded-xl border border-line/50 bg-surface/60 p-3 text-left">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                <Play size={11} className="text-green" /> Run this workspace app
              </p>
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-3" title={project}>
                {project.split('/').pop() ?? project}
              </p>
              {serveError ? <p className="mt-1.5 text-[10.5px] leading-snug text-red">{serveError}</p> : null}
              {serving ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10.5px] text-green">
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-green" aria-hidden />
                    <span className="truncate">:{serving.port}</span>
                  </span>
                  <Button
                    variant="surface"
                    className="min-h-7 rounded-lg px-2.5 py-0 text-[11px]"
                    onClick={() => {
                      const next = appUrl(serving.port)
                      setDraft(next)
                      setUrl(next)
                      setReloadKey((k) => k + 1)
                      setLoading(true)
                    }}
                  >
                    Open
                  </Button>
                  <button
                    type="button"
                    onClick={() => void stopApp()}
                    aria-label="Stop app server"
                    title="Stop app server"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 transition hover:bg-red-tint hover:text-red"
                  >
                    <Square size={11} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {SERVE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setServeCommand(preset.command)}
                        aria-pressed={serveCommand === preset.command}
                        title={preset.command || 'Serve files statically'}
                        className={cn(
                          'rounded-full border px-2 py-0.5 font-mono text-[9.5px] transition',
                          serveCommand === preset.command
                            ? 'border-accent/50 bg-accent-tint text-accent-ink'
                            : 'border-line/60 text-ink-3 hover:bg-hover-2 hover:text-ink-2',
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-line/50 bg-field px-2 py-1">
                    <input
                      value={serveCommand}
                      onChange={(e) => setServeCommand(e.target.value)}
                      placeholder="Custom command, {port} (empty = static files)"
                      aria-label="Custom run command"
                      className="h-6 min-w-0 flex-1 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-ink-3"
                    />
                  </div>
                  <Button
                    variant="primary"
                    className="mt-2 min-h-8 w-full rounded-lg text-[12px]"
                    disabled={serveBusy}
                    onClick={() => void startApp()}
                  >
                    {serveBusy ? 'Starting…' : '▶ Run app'}
                  </Button>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
                    {hasPackageJson
                      ? 'Tip: package.json found — try `npm run dev -- --port {port} --host 127.0.0.1`.'
                      : 'Serves the folder statically by default.'}
                  </p>
                </>
              )}
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
            {serving ? (
              <button
                type="button"
                onClick={() => void stopApp()}
                title={`Stop app server (:${serving.port})`}
                aria-label="Stop app server"
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-green hover:bg-red-tint hover:text-red"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-green" aria-hidden />
                :{serving.port}
              </button>
            ) : null}
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
                    <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-accent breathe' : s.status === 'waiting_for_approval' || s.status === 'waiting_for_input' ? 'bg-orange' : 'bg-ink-3/60')} aria-hidden />
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
            <span className={cn('size-1.5 shrink-0 rounded-full', sideSess?.status === 'running' ? 'bg-accent breathe' : 'bg-ink-3/60')} aria-hidden />
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
        onStop={() => void useStore.getState().interruptSession(sideId)}
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

/* ── 8. Rooms ─────────────────────────────────────────────────────────────── */

/**
 * The active room's channel transcript — a hidden session whose timeline
 * carries the seeded tasks, the per-worker orchestration cards, and the
 * merged reply. Messages go to the channel session, so asking a follow-up
 * re-runs the room the same way /orchestrator does.
 */
export function RoomChannelView({ session }: { session: Session }) {
  const roomId = useActiveRoomId()
  const room = useRooms().find((candidate) => candidate.id === roomId) ?? null
  const channelId = room?.sessionId
  const connection = useStore((s) => s.connection)
  const channel = useStore((s) => (channelId ? s.sessions.find((x) => x.id === channelId) : undefined))
  const conv = useConversation(channelId ?? session.id)

  useEffect(() => {
    if (channelId) void useStore.getState().openSession(channelId)
  }, [channelId])

  if (!room) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewHeader eyebrow="Rooms" right={<span className="font-mono text-[10px] text-ink-3">off</span>} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-2xl border border-line/50 bg-surface text-ink-3">
            <MessagesSquare size={20} />
          </span>
          <p className="mt-1 text-[13px] font-medium text-ink">No active room</p>
          <p className="max-w-[240px] text-[11.5px] leading-[1.6] text-ink-3">
            Pick a room in the sidebar (or create one), then dispatch with the ⚡ button or{' '}
            <code className="text-ink-2">/orchestrator &lt;task&gt;</code>. Workers always run on this session's agent
            and model.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow="Rooms"
        right={
          <span className="flex items-center gap-1.5">
            {room.workers.length > 0 ? <RoomAvatarStack names={room.workers.map((w) => w.name)} size={18} max={3} /> : null}
            {room.chief ? (
              <span className="font-mono text-[10px] text-accent/90" title="Chief of Staff">
                {room.chief} leads
              </span>
            ) : null}
            <span className="max-w-[110px] truncate font-mono text-[10px] text-ink-3" title={room.name}>
              {room.name}
            </span>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                room.panels.some((panel) => panel.status === 'working') || channel?.status === 'running'
                  ? 'bg-accent breathe'
                  : 'bg-ink-3/60',
              )}
              aria-hidden
            />
          </span>
        }
      />
      {channelId ? (
        <>
          <div className="scroll-thin flex max-h-[96px] shrink-0 flex-wrap gap-1 overflow-y-auto border-b border-line/30 px-2 py-1.5">
            {room.workers.length === 0 ? (
              <p className="px-1 py-0.5 text-[10px] text-ink-3">
                No workers yet — edit this room in the sidebar to add some.
              </p>
            ) : (
              room.workers.map((worker) => {
                const panel = room.panels.find((p) => p.name === worker.name)
                return (
                  <span
                    key={worker.name}
                    className="flex items-center gap-1.5 rounded-lg border border-line/40 bg-inset px-1.5 py-0.5"
                  >
                    <WorkerAvatar
                      name={worker.name}
                      size={16}
                      status={panel?.status}
                      ring
                    />
                    <span className={cn('max-w-[90px] truncate text-[10px]', room.chief === worker.name ? 'font-medium text-accent' : 'text-ink-2')}>
                      {worker.name}
                    </span>
                  </span>
                )
              })
            )}
          </div>
          <Timeline
            conversation={conv}
            onRespond={(id, d, m) => useStore.getState().respondToApproval(channelId, id, d, m)}
            project={session.project ?? undefined}
            sessionId={channelId}
          />
          <Composer
            wide
            workers={room.workers.map((worker) => worker.name)}
            onSend={(text) => {
              const trimmed = text.trim()
              // /orchestrator inside the room fans out on the channel's own
              // timeline (same-config workers) instead of prompting the lead.
              const orchestratorMatch = /^\/orchestrator\s+([\s\S]+)$/.exec(trimmed)
              if (orchestratorMatch) {
                void runRoomTask(session.id, room, orchestratorMatch[1])
                return
              }
              // @worker mentions narrow a dispatch to just those workers;
              // plain messages keep going to the room's lead agent.
              const mentioned = mentionedWorkers(
                trimmed,
                room.workers.map((worker) => worker.name),
              )
              if (mentioned.length > 0) {
                void runRoomTask(session.id, room, trimmed, mentioned)
                return
              }
              useStore.getState().sendPrompt(channelId, text)
            }}
            onQueue={(text) => {
              // While a run is in flight the same rules apply: dispatch
              // commands / @-worker mentions fire now, plain follow-ups wait
              // in the channel's queue instead of double-dispatching.
              const trimmed = text.trim()
              const orchestratorMatch = /^\/orchestrator\s+([\s\S]+)$/.exec(trimmed)
              if (orchestratorMatch) {
                void runRoomTask(session.id, room, orchestratorMatch[1])
                return
              }
              const mentioned = mentionedWorkers(
                trimmed,
                room.workers.map((worker) => worker.name),
              )
              if (mentioned.length > 0) {
                void runRoomTask(session.id, room, trimmed, mentioned)
                return
              }
              useStore.getState().queueMessage(channelId, trimmed)
            }}
            onStop={() => void useStore.getState().interruptSession(channelId)}
            working={channel?.status === 'running'}
            disabled={connection !== 'connected'}
            placeholder={`Message ${room.name}… (@ to mention a worker)`}
          />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-[12px] text-ink-2">{room.name}</p>
          <p className="max-w-[240px] text-[11px] leading-[1.6] text-ink-3">
            {room.workers.length > 0
              ? 'Dispatch a task with the ⚡ button in the sidebar, or /orchestrator — the channel opens here.'
              : 'This room has no workers yet — edit it in the sidebar to add some.'}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── File — workspace file preview ─────────────────────────────────────────
   Opened from the sidebar explorer: read-only preview of one workspace file
   with line numbers. keept mounted per tab so switching away preserves the
   scroll position. */

const FILE_CAP_CHARS = 200_000
const FILE_CAP_LINES = 3_000

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function FileView({ session }: { session: Session }) {
  const open = useOpenFile()
  const [contents, setContents] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const project = open?.project ?? session.project ?? undefined

  useEffect(() => {
    if (!open || !project) {
      setContents(null)
      setError(undefined)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(undefined)
    workspaceApi
      .file(project, open.path)
      .then((body) => {
        if (cancelled) return
        if (body.error || body.contents === undefined) {
          setError(body.error ?? 'Could not read this file')
          setContents(null)
        } else {
          setContents(body.contents)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not read this file')
          setContents(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.nonce])

  const lines: { rows: string[]; truncated: boolean } = useMemo(() => {
    if (contents === null) return { rows: [], truncated: false }
    let text = contents
    let truncated = false
    if (text.length > FILE_CAP_CHARS) {
      text = text.slice(0, FILE_CAP_CHARS)
      truncated = true
    }
    const split = text.split('\n')
    if (split.length > FILE_CAP_LINES) {
      return { rows: split.slice(0, FILE_CAP_LINES), truncated: true }
    }
    return { rows: split, truncated }
  }, [contents])

  const ext = open ? fileExtension(open.name) : ''

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow={open ? `File · ${ext || 'text'}` : 'File'}
        right={
          open ? (
            <span className="flex items-center gap-1">
              <RailButton
                label="Copy path"
                onClick={() => void navigator.clipboard?.writeText(open.path)}
              >
                Copy path
              </RailButton>
              <RailButton label="Close file" onClick={closeFile}>
                ✕
              </RailButton>
            </span>
          ) : null
        }
      />
      {!open ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
          <FileText size={18} className="text-ink-3" />
          <p className="text-[12px] font-medium text-ink-2">No file open</p>
          <p className="max-w-[26ch] text-[11px] leading-[1.6] text-ink-3">
            Pick a file in the sidebar explorer to preview it here.
          </p>
        </div>
      ) : loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <span className="flex items-center gap-2 text-[11px] text-ink-3">
            <Loader2 size={13} className="animate-spin" /> Reading {open.name}…
          </span>
        </div>
      ) : error ? (
        <p className="p-4 font-mono text-[11px] leading-relaxed text-red">{error}</p>
      ) : (
        <>
          <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-line/40 bg-inset px-3 py-1.5">
            <FileText size={12} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={open.path}>
              {open.path}
            </span>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            <pre className="min-w-max px-0 py-2 font-mono text-[11px] leading-[1.65]">
              <code>
                {lines.rows.map((line, index) => (
                  <span key={index} className="flex min-w-full hover:bg-hover/50">
                    <span className="w-10 shrink-0 select-none pr-3 text-right tabular-nums text-ink-3/50">
                      {index + 1}
                    </span>
                    <span className="whitespace-pre pr-4 text-ink-2">{line || ' '}</span>
                  </span>
                ))}
              </code>
            </pre>
            {lines.truncated ? (
              <p className="border-t border-line/40 px-3 py-2 font-mono text-[10px] text-ink-3">
                Truncated preview — open the file in your editor for the rest.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Files ────────────────────────────────────────────────────────────────── */

/**
 * Files — the workspace file tree with inline preview, the old sidebar
 * Explorer + right-pane File tab restructured into one tab: browse the tree,
 * and picking a file previews it in place (back returns to the tree).
 */
export function FilesView({ session }: { session: Session }) {
  const open = useOpenFile()
  const root = session.project ?? ''

  if (!root) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
        <FileText size={18} className="text-ink-3" />
        <p className="text-[12px] font-medium text-ink-2">No workspace</p>
        <p className="max-w-[26ch] text-[11px] leading-[1.6] text-ink-3">
          Files appear here once this session is tied to a project folder.
        </p>
      </div>
    )
  }

  if (open) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={closeFile}
          className="flex shrink-0 items-center gap-1.5 border-b border-line/40 bg-inset px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <ChevronRight size={11} className="rotate-180 text-ink-3" aria-hidden />
          Files
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{open.name}</span>
        </button>
        <FileView session={session} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow={`Files · ${basename(root)}`}
        right={
          <span className="font-mono text-[9.5px] tabular-nums text-ink-3">{root}</span>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <FileExplorer
          root={root}
          selectedPath={null}
          onOpenFile={(path) => openFile(root, path)}
        />
      </div>
    </div>
  )
}

/* ── Projects ─────────────────────────────────────────────────────────────── */

/**
 * Projects — every workspace and the sessions in it, the old sidebar's
 * workspace picker as a rail tab: pick a project to see its sessions, open
 * one to jump straight into it.
 */
export function ProjectsView({
  session,
  onOpenSession,
}: {
  session: Session
  onOpenSession?: (sessionId: string) => void
}) {
  const sessions = useStore((state) => state.sessions)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(session.project ? [session.project] : ['__inbox__']),
  )

  const workspaces = useMemo(() => {
    const grouped = new Map<string, Session[]>()
    for (const candidate of sessions) {
      if (candidate.status === 'archived' || isInternalSession(candidate)) continue
      const key = candidate.project ?? '__inbox__'
      const list = grouped.get(key) ?? []
      list.push(candidate)
      grouped.set(key, list)
    }
    return [...grouped.entries()]
      .map(([key, list]) => ({
        key,
        name: key === '__inbox__' ? 'Inbox' : basename(key),
        full: key === '__inbox__' ? 'No folder — inbox' : key,
        count: list.length,
        sessions: list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [sessions])

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ViewHeader
        eyebrow="Projects"
        right={<span className="font-mono text-[9.5px] tabular-nums text-ink-3">{workspaces.length}</span>}
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-1.5">
        {workspaces.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-ink-3">
            No projects yet. Create a task to start one.
          </p>
        ) : (
          workspaces.map((workspace) => {
            const open = expanded.has(workspace.key)
            return (
              <div key={workspace.key} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggle(workspace.key)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover-2"
                >
                  <ChevronRight
                    size={12}
                    className={cn('shrink-0 text-ink-3 transition-transform duration-150', open && 'rotate-90')}
                    aria-hidden
                  />
                  <Folder size={13} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                    {workspace.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">
                    {workspace.count}
                  </span>
                </button>
                {open ? (
                  <div className="mb-1 ml-[22px] border-l border-line/50 pl-2">
                    {workspace.sessions.map((candidate) => {
                      const active = candidate.id === session.id
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => onOpenSession?.(candidate.id)}
                          title={candidate.name}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                            active ? 'bg-hover text-ink' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[11.5px]">{candidate.name}</span>
                          <span className="shrink-0 font-mono text-[9px] text-ink-3">
                            {relativeTime(candidate.updated_at).replace(' ago', '')}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  TerminalSquare,
  WifiOff,
  X,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { clearDeviceCredential, getDeviceCredential } from '../lib/auth'
import { normalizedText } from '../lib/terminalText'
import { buildHistoryItems, buildLiveItems, type ChatItem } from '../lib/chatItems'
import { XtermTerminal } from './XtermTerminal'
import { useMobileWebSocket, type MobileRealtimeEvent, type MobileRealtimeMessage } from '../hooks/useMobileWebSocket'
import {
  ApprovalBlock,
  ChatItemBlock,
  QuestionBlock,
  ToolRun,
  groupBlocks,
} from './chat/blocks'
import LoadingState from './beautiful/LoadingState'
import PromptBar from './beautiful/PromptBar'
import { MobileContextPanel } from './MobileContextPanel'
import type {
  MobileAgent,
  MobileAgentEvent,
  MobileApproval,
  MobileConnectionState,
  MobileCreateSessionRequest,
  MobileSession,
  MobileSessionPayload,
  MobileQuestion,
  MobileSnapshot,
  MobileWorkspace,
} from '../types/mobile'

/**
 * Mobile remote control, built on the Beautiful UI collection.
 *
 * The task screen renders the same semantic blocks as the desktop chat
 * (StreamingText / ThinkingState / ToolChips / DiffTable / ApprovalCard /
 * CodeBlock) with mobile-native composition: compact safe-area header,
 * full-width timeline, pill composer pinned above the keyboard, sheets
 * for creation. Data flows through the authenticated mobile API and the
 * mobile WebSocket — no fake events, no legacy chat formatting.
 */

const statusMeta: Record<string, { label: string; pill: string; dot: string }> = {
  starting: { label: 'Starting', pill: 'bg-accent-tint text-accent', dot: 'bg-accent' },
  running: { label: 'Running', pill: 'bg-green-tint text-green', dot: 'bg-green' },
  waiting_for_input: { label: 'Waiting', pill: 'bg-orange-tint text-orange', dot: 'bg-orange' },
  waiting_for_approval: { label: 'Needs approval', pill: 'bg-orange-tint text-orange', dot: 'bg-orange' },
  idle: { label: 'Idle', pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' },
  error: { label: 'Error', pill: 'bg-red-tint text-red', dot: 'bg-red' },
  archived: { label: 'Completed', pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' },
  exited: { label: 'Stopped', pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' },
}

function statusFor(status: string) {
  return statusMeta[status] || { label: status.replace(/_/g, ' '), pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' }
}

function StatusPill({ status }: { status: string }) {
  const meta = statusFor(status)
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-chip px-2 py-0.5 text-[10.5px] font-medium ${meta.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === 'running' || status === 'starting' ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  )
}

function relativeTime(value?: string) {
  if (!value) return 'No activity yet'
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'now'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatElapsed(fromIso: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function compactPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : path || '/'
}

function connectionLabel(connection: MobileConnectionState) {
  switch (connection) {
    case 'connected': return 'Connected'
    case 'syncing': return 'Syncing'
    case 'authenticating': return 'Authenticating'
    case 'connecting': return 'Connecting'
    case 'reconnecting': return 'Reconnecting'
    case 'offline': return 'Offline'
    case 'device_revoked': return 'Access revoked'
    case 'session_expired': return 'Session expired'
    case 'sync_failed': return 'Sync failed'
    default: return 'Pairing'
  }
}

function normalizeSession(raw: Record<string, unknown>): MobileSession {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || raw.name || 'Untitled task'),
    name: String(raw.name || raw.title || 'Untitled task'),
    agent: String(raw.agent || 'Agent'),
    status: String(raw.status || 'idle') as MobileSession['status'],
    project: typeof raw.project === 'string' ? raw.project : undefined,
    branch: typeof raw.branch === 'string' ? raw.branch : undefined,
    created_at: String(raw.created_at || new Date().toISOString()),
    updated_at: String(raw.updated_at || new Date().toISOString()),
    cost: typeof raw.cost === 'number' ? raw.cost : undefined,
    tokens_used: typeof raw.tokens_used === 'number' ? raw.tokens_used : undefined,
    capabilities: raw.capabilities as Record<string, boolean> | undefined,
  }
}

export function MobileApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const credential = getDeviceCredential()
  const [snapshot, setSnapshot] = useState<MobileSnapshot | null>(null)
  const [syncing, setSyncing] = useState(Boolean(credential))
  const [syncError, setSyncError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const previousConnection = useRef<MobileConnectionState | null>(null)
  const processedEvents = useRef(new Set<number>())
  const { connection, events, terminalOutput, send, retry } = useMobileWebSocket(credential?.token || null, credential?.deviceId)

  const refresh = async () => {
    if (!credential) {
      navigate('/mobile/pair', { replace: true })
      return
    }
    setSyncing(true)
    setSyncError(null)
    try {
      const next = await api.mobile.snapshot()
      setSnapshot(next)
      setExpanded((current) => current.size ? current : new Set(next.workspaces.map((workspace) => workspace.id)))
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        clearDeviceCredential()
        navigate('/mobile/pair', { replace: true })
      } else {
        setSyncError(error instanceof Error ? error.message : 'Could not sync workspaces.')
      }
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!credential) {
      navigate('/mobile/pair', { replace: true })
      return
    }
    void refresh()
    // The credential is intentionally read once per mounted mobile session.
    // Pairing changes route and remounts this shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential?.token, navigate])

  useEffect(() => {
    if (connection === 'device_revoked' || connection === 'session_expired') {
      clearDeviceCredential()
      navigate('/mobile/pair', { replace: true })
      return
    }
    if (connection === 'connected' && previousConnection.current !== 'connected') {
      void refresh()
    }
    previousConnection.current = connection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, navigate])

  useEffect(() => {
    for (const event of events) {
      if (typeof event.event_id === 'number') {
        if (processedEvents.current.has(event.event_id)) continue
        processedEvents.current.add(event.event_id)
      }
      if (event.type === 'SessionUpdate') {
        const raw = event.payload?.session as Record<string, unknown> | undefined
        if (raw) {
          const session = normalizeSession(raw)
          setSnapshot((current) => current ? mergeSession(current, session) : current)
        }
      }
      if (event.type === 'StateChange') {
        const sessionId = String(event.payload?.session_id || '')
        const state = String(event.payload?.state || 'exited').split(':')[0]
        setSnapshot((current) => current ? updateSessionStatus(current, sessionId, state) : current)
      }
    }
  }, [events])

  const taskId = location.pathname.startsWith('/mobile/task/')
    ? decodeURIComponent(location.pathname.slice('/mobile/task/'.length))
    : null

  const toggleWorkspace = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const createSession = async (data: MobileCreateSessionRequest) => {
    const result = await api.mobile.createSession(data)
    const session = result.session
    setSnapshot((current) => current ? mergeSession(current, session) : current)
    setShowCreate(false)
    navigate(`/mobile/task/${encodeURIComponent(session.id)}`)
  }

  if (taskId) {
    return (
      <MobileTaskScreen
        taskId={taskId}
        snapshot={snapshot}
        connection={connection}
        events={events}
        terminalOutput={terminalOutput}
        send={send}
        onBack={() => navigate('/mobile')}
        onRetry={retry}
        onRefresh={refresh}
      />
    )
  }

  const tasks = snapshot ? snapshot.workspaces.flatMap((workspace) => workspace.tasks) : []
  const needsYou = tasks.filter((task) => task.status === 'waiting_for_approval' || task.status === 'waiting_for_input' || task.status === 'error')
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'starting')

  return (
    <main className="mobile-app min-h-[100dvh] bg-canvas text-ink">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-4 sm:max-w-2xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 28px)' }}>
        {/* compact app bar */}
        <header className="flex items-center gap-3 border-b border-line pb-4 pt-[calc(env(safe-area-inset-top)+16px)]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-accent-tint">
            <Bot className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold tracking-tight">AgentDeck</span>
              <ConnectionPill connection={connection} />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-3">{snapshot?.desktop.name || 'Desktop'}</p>
          </div>
          <button onClick={() => void refresh()} disabled={syncing} className="flex size-9 items-center justify-center rounded-control border border-line bg-surface text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink disabled:opacity-50" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowCreate(true)} className="flex size-9 items-center justify-center rounded-control transition-transform active:scale-95" style={{ background: 'var(--ink)', color: 'hsl(var(--surface))' }} aria-label="New task">
            <Plus className="h-4 w-4" />
          </button>
        </header>

        <ConnectionBanner connection={connection} error={syncError} onRetry={() => { retry(); void refresh() }} />

        {/* needs your attention */}
        {needsYou.length > 0 && (
          <section className="pt-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Needs your attention</h2>
            <div className="mt-2 flex flex-col gap-2">
              {needsYou.slice(0, 5).map((task, index) => (
                <button
                  key={task.id}
                  onClick={() => navigate(`/mobile/task/${encodeURIComponent(task.id)}`)}
                  className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card transition-colors active:bg-hover"
                  style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${index * 60}ms both` }}
                >
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-control ${task.status === 'error' ? 'bg-red-tint text-red' : 'bg-orange-tint text-orange'}`}>
                    {task.status === 'error' ? <AlertCircle className="h-4 w-4" /> : task.status === 'waiting_for_approval' ? <ShieldAlert className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{task.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-3">{task.project ? compactPath(task.project) : 'Desktop'} · {relativeTime(task.updated_at)}</span>
                  </span>
                  <StatusPill status={task.status} />
                </button>
              ))}
              {needsYou.length > 5 && (
                <p className="px-1 pt-1 text-[11px] text-ink-3">+{needsYou.length - 5} more waiting in the workspace list below</p>
              )}
            </div>
          </section>
        )}

        {/* active work */}
        {active.length > 0 && (
          <section className="pt-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Active now</h2>
            <div className="mt-2 flex flex-col gap-2">
              {active.map((task, index) => (
                <button
                  key={task.id}
                  onClick={() => navigate(`/mobile/task/${encodeURIComponent(task.id)}`)}
                  className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card transition-colors active:bg-hover"
                  style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${index * 60}ms both` }}
                >
                  <span className="relative flex size-8 shrink-0 items-center justify-center rounded-control bg-green-tint">
                    <span className="size-2 rounded-full bg-green animate-pulse" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{task.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-3">{task.agent}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-ink-3"><ElapsedClock from={task.created_at} /></span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* workspaces */}
        <section className="pt-5">
          <div className="flex items-end justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Workspaces</h2>
            {snapshot && <span className="text-[11px] tabular-nums text-ink-3">{snapshot.workspaces.length} · {countTasks(snapshot.workspaces)} tasks</span>}
          </div>
          <div className="mt-2 flex flex-col gap-3">
            {syncing && !snapshot ? <WorkspaceSkeleton /> : syncError && !snapshot ? (
              <ErrorState message="Couldn't sync workspaces." detail={syncError} onRetry={() => { void refresh() }} />
            ) : snapshot && snapshot.workspaces.length === 0 ? (
              <EmptyState title="No workspaces available" detail="Make sure the desktop daemon is running and a workspace has a task." />
            ) : snapshot ? snapshot.workspaces.map((workspace, index) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                expanded={expanded.has(workspace.id)}
                onToggle={() => toggleWorkspace(workspace.id)}
                onOpenTask={(id) => navigate(`/mobile/task/${encodeURIComponent(id)}`)}
                onNewTask={() => setShowCreate(true)}
                index={index}
              />
            )) : null}
          </div>
        </section>

        <div className="mt-auto pt-8">
          <div className="flex items-center justify-center gap-2 text-[11px] text-ink-3">
            <span className={`h-1.5 w-1.5 rounded-full ${connection === 'connected' ? 'bg-green' : 'bg-orange'}`} />
            {connectionLabel(connection)} to {snapshot?.desktop.name || 'desktop'}
          </div>
        </div>
      </div>

      {showCreate && (
        <NewTaskSheet
          workspaces={snapshot?.workspaces || []}
          agents={snapshot?.agents || []}
          onClose={() => setShowCreate(false)}
          onCreate={createSession}
        />
      )}
    </main>
  )
}

function ElapsedClock({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <>{formatElapsed(from, now)}</>
}

function ConnectionPill({ connection }: { connection: MobileConnectionState }) {
  const tone = connection === 'connected' ? 'bg-green-tint text-green' : connection === 'offline' || connection === 'device_revoked' || connection === 'session_expired' || connection === 'sync_failed' ? 'bg-red-tint text-red' : 'bg-orange-tint text-orange'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-[10.5px] font-medium ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${connection === 'connected' ? 'bg-green' : connection === 'offline' ? 'bg-red' : 'bg-orange animate-pulse'}`} />
      {connectionLabel(connection)}
    </span>
  )
}

function mergeSession(snapshot: MobileSnapshot, session: MobileSession): MobileSnapshot {
  const workspaceId = session.project || 'default'
  const workspaceName = session.project?.split('/').filter(Boolean).pop() || 'Desktop tasks'
  const workspaces = [...snapshot.workspaces]
  const index = workspaces.findIndex((workspace) => workspace.id === workspaceId)
  if (index < 0) {
    workspaces.push({ id: workspaceId, name: workspaceName, path: session.project || '/', local: true, task_count: 1, tasks: [session] })
  } else {
    const workspace = workspaces[index]
    const taskIndex = workspace.tasks.findIndex((task) => task.id === session.id)
    const tasks = [...workspace.tasks]
    if (taskIndex < 0) tasks.unshift(session)
    else tasks[taskIndex] = { ...tasks[taskIndex], ...session }
    workspaces[index] = { ...workspace, tasks, task_count: tasks.length, updated_at: session.updated_at }
  }
  return { ...snapshot, workspaces }
}

function updateSessionStatus(snapshot: MobileSnapshot, id: string, status: string): MobileSnapshot {
  return {
    ...snapshot,
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => task.id === id ? { ...task, status: status as MobileSession['status'], updated_at: new Date().toISOString() } : task),
    })),
  }
}

function countTasks(workspaces: MobileWorkspace[]) {
  return workspaces.reduce((total, workspace) => total + workspace.tasks.length, 0)
}

function ConnectionBanner({ connection, error, onRetry }: { connection: MobileConnectionState; error: string | null; onRetry: () => void }) {
  if (connection === 'connected' && !error) return null
  const isError = connection === 'offline' || connection === 'sync_failed' || connection === 'desktop_unavailable' || Boolean(error)
  const title = error || (connection === 'reconnecting' ? 'Desktop unavailable' : connection === 'offline' ? 'You are offline' : connectionLabel(connection))
  const detail = error ? 'Your last synced state remains available.' : connection === 'reconnecting' ? 'Trying to reconnect. Your device is still paired.' : connection === 'offline' ? 'We will reconnect automatically when the network returns.' : 'Syncing the latest desktop state.'
  return (
    <div className={`mt-4 flex items-start gap-3 rounded-card border px-3.5 py-3 ${isError ? 'border-orange/25 bg-orange-tint' : 'border-line bg-surface'}`}>
      {isError ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-orange" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />}
      <div className="min-w-0 flex-1"><p className="text-xs font-medium text-ink">{title}</p><p className="mt-0.5 text-[11px] leading-5 text-ink-2">{detail}</p></div>
      {isError && <button onClick={onRetry} className="shrink-0 rounded-control border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-hover">Retry</button>}
    </div>
  )
}

function WorkspaceCard({ workspace, expanded, onToggle, onOpenTask, onNewTask, index }: { workspace: MobileWorkspace; expanded: boolean; onToggle: () => void; onOpenTask: (id: string) => void; onNewTask: () => void; index: number }) {
  return (
    <article
      className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
      style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index * 60, 360)}ms both` }}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-hover" aria-expanded={expanded}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-tint text-accent"><FolderGit2 className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{workspace.name}</span>
            <span className="shrink-0 rounded-chip border border-line px-1.5 py-0.5 text-[9.5px] text-ink-3">{workspace.local ? 'Local' : 'Remote'}</span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-3">{compactPath(workspace.path)}</span>
        </span>
        <span className="shrink-0 text-right text-[10.5px] tabular-nums text-ink-3">{workspace.task_count} {workspace.task_count === 1 ? 'task' : 'tasks'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: expanded ? '1fr' : '0fr', transitionTimingFunction: 'cubic-bezier(0.23,1,0.32,1)' }}>
        <div className="overflow-hidden">
          <div className="border-t border-line">
            {workspace.tasks.length === 0 ? (
              <p className="px-3.5 py-4 text-[11.5px] text-ink-3">No tasks in this workspace yet.</p>
            ) : (
              workspace.tasks.map((task) => {
                const meta = statusFor(task.status)
                return (
                  <button key={task.id} onClick={() => onOpenTask(task.id)} className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-2.5 text-left transition-colors last:border-0 active:bg-hover">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot} ${task.status === 'running' || task.status === 'starting' ? 'animate-pulse' : ''}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-ink">{task.title}</span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">{task.agent} · {meta.label}</span>
                    </span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-ink-3">{relativeTime(task.updated_at)}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  </button>
                )
              })
            )}
            <button onClick={onNewTask} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[11.5px] font-medium text-ink-2 transition-colors active:bg-hover">
              <Plus className="h-3.5 w-3.5" /> New task in this workspace
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function WorkspaceSkeleton() {
  return <>{[0, 1].map((item) => <div key={item} className="h-24 animate-pulse rounded-card border border-line bg-surface" />)}</>
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line px-6 py-12 text-center">
      <FolderGit2 className="h-6 w-6 text-ink-3" />
      <p className="mt-3 text-[13px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-[11.5px] leading-5 text-ink-3">{detail}</p>
    </div>
  )
}

function ErrorState({ message, detail, onRetry }: { message: string; detail: string; onRetry: () => void }) {
  return (
    <div className="rounded-card border border-red/25 bg-red-tint px-5 py-8 text-center">
      <AlertCircle className="mx-auto h-6 w-6 text-red" />
      <p className="mt-3 text-[13px] font-medium text-ink">{message}</p>
      <p className="mt-1 text-[11.5px] text-ink-2">{detail}</p>
      <button onClick={onRetry} className="mt-5 rounded-control bg-ink px-4 py-2 text-xs font-medium" style={{ color: 'hsl(var(--surface))' }}>Retry sync</button>
    </div>
  )
}

function NewTaskSheet({ workspaces, agents, onClose, onCreate }: { workspaces: MobileWorkspace[]; agents: MobileAgent[]; onClose: () => void; onCreate: (data: MobileCreateSessionRequest) => Promise<void> }) {
  const [prompt, setPrompt] = useState('')
  const [agent, setAgent] = useState(agents.find((item) => item.available)?.id || agents[0]?.id || '')
  const [project, setProject] = useState(workspaces[0]?.path || '')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedAgent = agents.find((item) => item.id === agent)
  const models = selectedAgent?.models ?? []
  const reasoning = selectedAgent?.reasoningLevels ?? []
  // Default to the first model / middle effort when the agent supports them.
  useEffect(() => {
    if (models.length && !models.some((m) => m.id === model)) setModel(models[0].id)
  }, [models, model])
  useEffect(() => {
    if (reasoning.length && !reasoning.includes(effort)) setEffort(reasoning[Math.floor(reasoning.length / 2)])
  }, [reasoning, effort])

  const submit = async () => {
    if (!prompt.trim() || !agent) return
    setCreating(true)
    setError(null)
    const data: MobileCreateSessionRequest = { agent, project: project || undefined, prompt: prompt.trim() }
    if (models.length && model) data.model = model
    if (reasoning.length && effort) data.effort = effort
    try { await onCreate(data) }
    catch (error: unknown) { setError(error instanceof Error ? error.message : 'Could not start task.') }
    finally { setCreating(false) }
  }

  const field = 'w-full rounded-control border border-line bg-inset px-3 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-line-strong'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-card border border-line bg-surface p-4 shadow-overlay sm:rounded-card" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)', animation: 'fade-up 260ms cubic-bezier(0.23,1,0.32,1) both' }}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">New task</p>
            <h2 className="mt-0.5 text-[16px] font-semibold text-ink">Start an agent</h2>
          </div>
          <button onClick={onClose} className="primitive-icon-button" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Workspace</label>
        <select value={project} onChange={(event) => setProject(event.target.value)} className={`${field} mb-3.5`}>
          <option value="">Desktop default</option>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.path}>{workspace.name}</option>)}
        </select>
        <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Agent</label>
        <select value={agent} onChange={(event) => setAgent(event.target.value)} className={`${field} mb-3.5`}>
          {agents.filter((item) => item.available).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {models.length > 0 && (
          <>
            <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Model</label>
            <div className="mb-3.5 flex flex-wrap gap-1.5">
              {models.map((m) => (
                <button key={m.id} type="button" onClick={() => setModel(m.id)} className={`flex items-center gap-1.5 rounded-chip border px-2.5 py-1.5 text-[12px] transition-colors ${model === m.id ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface text-ink-2 hover:border-line-strong'}`}>
                  {m.name}
                  {m.tag && <span className={`text-[10px] ${model === m.id ? 'text-canvas/70' : 'text-ink-3'}`}>{m.tag}</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {reasoning.length > 0 && (
          <>
            <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Effort</label>
            <div className="mb-3.5 flex flex-wrap gap-1.5">
              {reasoning.map((level) => (
                <button key={level} type="button" onClick={() => setEffort(level)} className={`rounded-chip border px-2.5 py-1.5 text-[12px] capitalize transition-colors ${effort === level ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface text-ink-2 hover:border-line-strong'}`}>
                  {level}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="mb-1.5 block text-[11px] font-medium text-ink-2">What should it do?</label>
        <textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="Describe the task..." className={`${field} resize-none leading-6`} />
        {error && <p className="mt-2 text-[11.5px] text-red">{error}</p>}
        <button
          onClick={() => void submit()}
          disabled={!prompt.trim() || !agent || creating}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-control px-4 py-3 text-[13px] font-medium transition-transform enabled:active:scale-[0.98] disabled:opacity-40"
          style={{ background: 'var(--ink)', color: 'hsl(var(--surface))' }}
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          Start task
        </button>
      </div>
    </div>
  )
}

/* ── task screen ─────────────────────────────────────────── */

function MobileTaskScreen({ taskId, snapshot, connection, events, terminalOutput, send, onBack, onRetry, onRefresh }: { taskId: string; snapshot: MobileSnapshot | null; connection: MobileConnectionState; events: MobileRealtimeEvent[]; terminalOutput: MobileRealtimeEvent[]; send: (message: MobileRealtimeMessage) => boolean; onBack: () => void; onRetry: () => void; onRefresh: () => Promise<void> }) {
  const [payload, setPayload] = useState<MobileSessionPayload | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debug, setDebug] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [resolvedApprovals, setResolvedApprovals] = useState(new Set<string>())
  const [newActivity, setNewActivity] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastItemCount = useRef(0)

  const taskFromSnapshot = findTask(snapshot, taskId)
  const workspace = snapshot?.workspaces.find((item) => item.tasks.some((task) => task.id === taskId))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.mobile.session(taskId).then((next) => { if (!cancelled) setPayload(next) }).catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : 'Task unavailable.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, reload])

  const liveItems = useMemo(() => buildLiveItems(events, taskId), [events, taskId])
  const historyItems = useMemo(() => buildHistoryItems(payload?.messages || [], payload?.events || [], payload?.transcripts || []), [payload])

  const items = useMemo(() => {
    const historyUserContent = new Set(historyItems.filter((item) => item.kind === 'user').map((item) => normalizedText(item.content)))
    const questionAnswers = new Map<string, { selected_options?: unknown; custom_text?: unknown }>([
      ...(payload?.events || []).filter((event) => event.kind === 'question_answered').map((event) => [String(event.payload.question_id || ''), event.payload] as const),
      ...events.filter((event) => event.type === 'AgentEvent').map((event) => event.payload?.event as MobileAgentEvent | undefined).filter((event): event is MobileAgentEvent => event?.kind === 'question_answered').map((event) => [String(event.payload.question_id || ''), event.payload] as const),
    ])
    return [...historyItems, ...liveItems.filter((item) => item.kind !== 'user' || !historyUserContent.has(normalizedText(item.content)))].map((item) => {
      if (item.kind === 'question' && item.question) {
        const answer = questionAnswers.get(item.question.question_id)
        if (answer) return { ...item, question: { ...item.question, status: 'answered' as const, selected_options: Array.isArray(answer.selected_options) ? answer.selected_options.map(String) : [], custom_text: typeof answer.custom_text === 'string' ? answer.custom_text : undefined } }
      }
      return item
    }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
  }, [historyItems, liveItems, payload, events])

  const blocks = useMemo(() => groupBlocks(items), [items])

  const streamingId = useMemo(() => {
    const status = taskFromSnapshot?.status || payload?.session?.status || ''
    const working = status === 'running' || status === 'starting'
    if (!working) return null
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'agent' && item.id.startsWith('event-')) return item.id
      if (item.kind === 'user') return null
    }
    return null
  }, [items, taskFromSnapshot, payload])

  const rawHistory = (payload?.terminal_output || [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((item) => item.data)
    .join('')
  const rawOutput = rawHistory + terminalOutput
    .filter((event) => String(event.payload?.session_id || '') === taskId)
    .map((event) => String(event.payload?.data || ''))
    .join('')

  const { pendingApprovals, pendingQuestions } = useMemo(() => {
    const historyApprovals = historyItems
      .filter((item) => item.kind === 'approval')
      .map((item) => item.approval)
      .filter((approval): approval is MobileApproval => Boolean(approval))
    const liveApprovals = liveItems
      .filter((item) => item.kind === 'approval')
      .map((item) => item.approval)
      .filter((approval): approval is MobileApproval => Boolean(approval))
    const resolvedEventIds = new Set<string>([
      ...(payload?.events || [])
        .filter((event) => event.kind === 'permission_resolved')
        .map((event) => String(event.payload.request_id || '')),
      ...events
        .filter((event) => event.type === 'AgentEvent')
        .map((event) => event.payload?.event as { kind?: string; payload?: Record<string, unknown> } | undefined)
        .filter((event): event is { kind: string; payload?: Record<string, unknown> } => event?.kind === 'permission_resolved')
        .map((event) => String(event.payload?.request_id || '')),
      ...events
        .filter((event) => event.type === 'ApprovalResolved')
        .map((event) => String(event.payload?.request_id || '')),
    ])
    // Resolutions are not always persisted (desktop response path) — derive
    // them from subsequent agent activity, like the desktop chat does.
    const activityTimes = [...historyItems, ...liveItems]
      .filter((item) => item.timestamp && (item.kind === 'agent' || item.kind === 'activity' || item.kind === 'thinking' || item.kind === 'diff'))
      .map((item) => new Date(item.timestamp as string).getTime())
    const superseded = new Set(
      [...historyItems, ...liveItems]
        .filter((item) => item.kind === 'approval' && item.approval && item.timestamp && activityTimes.some((later) => later > new Date(item.timestamp as string).getTime()))
        .map((item) => (item.approval as MobileApproval).id),
    )
    const approvals = [...(payload?.approvals || []), ...historyApprovals, ...liveApprovals].filter((item, index, all) =>
      !resolvedApprovals.has(item.id)
      && !resolvedEventIds.has(item.id)
      && !superseded.has(item.id)
      && all.findIndex((candidate) => candidate.id === item.id) === index)
    const questionItems = items.filter((item): item is ChatItem & { question: MobileQuestion } => item.kind === 'question' && Boolean(item.question))
    const answeredIds = new Set<string>([
      ...(payload?.events || []).filter((event) => event.kind === 'question_answered').map((event) => String(event.payload.question_id || '')),
      ...events.filter((event) => event.type === 'AgentEvent').map((event) => event.payload?.event as { kind?: string; payload?: Record<string, unknown> } | undefined).filter((event): event is { kind: string; payload?: Record<string, unknown> } => event?.kind === 'question_answered').map((event) => String(event.payload?.question_id || '')),
    ])
    const questions = [...(payload?.questions || []), ...questionItems.map((item) => item.question)].filter((question, index, all) =>
      question.status === 'pending' && !answeredIds.has(question.question_id) && all.findIndex((candidate) => candidate.question_id === question.question_id) === index)
    return { pendingApprovals: approvals, pendingQuestions: questions }
  }, [historyItems, liveItems, items, payload, events, resolvedApprovals])

  const liveSession = [...events].reverse().find((event) => {
    if (event.type === 'SessionUpdate') {
      const session = event.payload?.session as Record<string, unknown> | undefined
      return session?.id === taskId
    }
    return event.type === 'StateChange' && String(event.payload?.session_id || '') === taskId
  })
  const baseTask = payload?.session || taskFromSnapshot
  const liveSessionValue = liveSession?.type === 'SessionUpdate'
    ? normalizeSession(liveSession.payload?.session as Record<string, unknown>)
    : liveSession?.type === 'StateChange' && baseTask
      ? { ...baseTask, status: String(liveSession.payload?.state || 'exited').split(':')[0] as MobileSession['status'] }
      : undefined
  const task = liveSessionValue || payload?.session || taskFromSnapshot
  const status = pendingApprovals.length > 0 ? 'waiting_for_approval' : task?.status || 'idle'
  const working = status === 'running' || status === 'starting'
  const ended = status === 'exited' || status === 'archived'

  useEffect(() => {
    if (items.length > lastItemCount.current && !isAtBottom) setNewActivity(true)
    if (isAtBottom && items.length > lastItemCount.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    lastItemCount.current = items.length
  }, [items.length, isAtBottom])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    setIsAtBottom(atBottom)
    if (atBottom) setNewActivity(false)
  }

  const sendQuestionAnswer = (answer: { question_id: string; session_id: string; selected_options: string[]; custom_text: string | null }) => {
    send({ type: 'QuestionAnswer', payload: { answer } })
  }

  const sendText = (text: string) => {
    send({ type: 'Input', payload: { session_id: taskId, data: `${text}\n` } })
    setIsAtBottom(true)
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }

  const stopTask = async () => {
    if (!window.confirm('Stop this agent? The conversation will remain available.')) return
    try {
      const result = await api.mobile.kill(taskId)
      if (!result.killed) throw new Error('The desktop did not stop the task.')
      setPayload((current) => current ? { ...current, session: { ...current.session, status: 'exited' } } : current)
      await onRefresh()
    } catch (error: unknown) { setError(error instanceof Error ? error.message : 'Could not stop the task.') }
  }

  const resolveApproval = (approval: MobileApproval, decision: string) => {
    const sent = send({ type: 'Command', payload: { action: 'approval_response', params: { session_id: taskId, request_id: approval.id, decision } } })
    if (!sent) { setError('Connection is unavailable. Try again when the desktop reconnects.'); return }
    setResolvedApprovals((current) => new Set(current).add(approval.id))
  }

  if (loading) return <TaskLoading onBack={onBack} />
  if (error || !task) return <TaskError error={error || 'Task unavailable.'} onBack={onBack} onRetry={() => { setReload((value) => value + 1); void onRefresh() }} />

  return (
    <main className="mobile-app flex min-h-[100dvh] flex-col bg-canvas text-ink">
      {/* compact safe-area header */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors active:bg-hover" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[13.5px] font-semibold text-ink">{task.title}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-ink-3">
              <Bot className="h-3 w-3 shrink-0" />{task.agent}
              <span className="h-0.5 w-0.5 rounded-full bg-ink-3" />
              <span className="truncate">{workspace?.name || compactPath(task.project || '')}</span>
            </p>
          </div>
          <StatusPill status={status} />
          {/* chat ⇄ terminal toggle */}
          <div className="flex h-8 shrink-0 items-center rounded-chip border border-line bg-surface p-0.5">
            <button onClick={() => setDebug(false)} className={`flex h-full items-center rounded-chip px-2 text-[11px] font-medium transition-colors ${!debug ? 'bg-hover-2 text-ink' : 'text-ink-3'}`} aria-pressed={!debug}>Chat</button>
            <button onClick={() => setDebug(true)} className={`flex h-full items-center gap-1 rounded-chip px-2 text-[11px] font-medium transition-colors ${debug ? 'bg-hover-2 text-ink' : 'text-ink-3'}`} aria-pressed={debug}>
              <TerminalSquare className="h-3 w-3" />CLI
            </button>
          </div>
          <button onClick={() => task?.project && setShowContext(true)} disabled={!task?.project} className="flex size-9 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors active:bg-hover disabled:opacity-30" aria-label="Files and changes">
            <FolderGit2 className="h-4 w-4" />
          </button>
          <button onClick={() => void stopTask()} disabled={!working && status !== 'waiting_for_approval'} className="flex h-8 shrink-0 items-center gap-1.5 rounded-chip bg-red-tint px-2.5 text-[11px] font-medium text-red transition-colors active:bg-red active:text-white disabled:opacity-30">
            <Square className="h-3 w-3 fill-current" />Stop
          </button>
        </div>
      </header>

      {/* semantic timeline */}
      <div ref={scrollRef} onScroll={handleScroll} className="ai-scroll-thin relative flex-1 px-4 pb-6 pt-4">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
          {connection !== 'connected' && <ConnectionBanner connection={connection} error={null} onRetry={onRetry} />}
          {error && <p className="rounded-card border border-red/25 bg-red-tint px-3 py-2 text-[11.5px] text-red">{error}</p>}
          {debug ? (
            <RawDebugView rawOutput={rawOutput} />
          ) : (
            <>
              {items.length === 0 && !working && pendingQuestions.length === 0 && pendingApprovals.length === 0 && (
                <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
                  <div className="flex size-11 items-center justify-center rounded-card border border-line bg-surface shadow-card">
                    <Bot className="h-5 w-5 text-accent" />
                  </div>
                  <p className="mt-4 text-[13.5px] font-medium text-ink">Start the conversation</p>
                  <p className="mt-1 max-w-xs text-[11.5px] leading-5 text-ink-3">Send a message and the agent's thinking, tool calls and results will appear here as they happen.</p>
                </div>
              )}
              {blocks.map((block) =>
                block.kind === 'tools' ? (
                  <ToolRun key={`run-${block.items[0].id}`} items={block.items} working={working} lastItemId={items[items.length - 1]?.id} />
                ) : (
                  <ChatItemBlock
                    key={block.item.id}
                    item={block.item}
                    streaming={block.item.id === streamingId}
                    working={working}
                    isLast={block.item.id === items[items.length - 1]?.id}
                    pendingApprovals={pendingApprovals}
                    resolvedApprovals={resolvedApprovals}
                  />
                ),
              )}
              {pendingQuestions.map((question) => (
                <QuestionBlock key={question.question_id} question={question} onAnswer={sendQuestionAnswer} />
              ))}
              {pendingApprovals.map((approval) => (
                <ApprovalBlock key={approval.id} approval={approval} onResolve={(decision) => resolveApproval(approval, decision)} />
              ))}
              {working && pendingApprovals.length === 0 && (
                <LoadingState label="Working" variant="Orbit" />
              )}
            </>
          )}
          {newActivity && !debug && (
            <button
              type="button"
              onClick={() => {
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
                setNewActivity(false)
              }}
              className="sticky bottom-2 left-1/2 mt-2 flex -translate-x-1/2 items-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink shadow-raised"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              New activity
            </button>
          )}
        </div>
      </div>

      {/* pill composer pinned above the keyboard */}
      <div className="sticky bottom-0 z-20 border-t border-line bg-canvas/95 px-3 pt-2 backdrop-blur-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-1.5">
          {connection !== 'connected' && (
            <p className="flex items-center gap-1.5 text-[11px] text-orange">
              <AlertCircle className="h-3 w-3" /> Reconnecting — messages send when the desktop is back.
            </p>
          )}
          <PromptBar
            variant="Pill"
            placeholder={ended ? 'Task stopped — start a new task' : working ? 'Queue a follow-up…' : 'Message the agent…'}
            disabled={ended}
            onSend={sendText}
            onPlus={() => setDebug((value) => !value)}
          />
          <div className="flex items-center justify-between px-1 text-[10px] text-ink-3">
            <button type="button" onClick={() => setDebug((value) => !value)} className="animated-underline transition-colors hover:text-ink">
              {debug ? 'Back to chat' : 'Terminal debug'}
            </button>
            <span>{working ? 'Follow-ups queue for this task' : ended ? 'Read-only history' : connection === 'connected' ? 'Ready' : connectionLabel(connection)}</span>
          </div>
        </div>
      </div>
      {/* full-screen context panel (files / diffs / worktrees) */}
      {task?.project && (
        <MobileContextPanel project={task.project} open={showContext} onClose={() => setShowContext(false)} />
      )}
    </main>
  )
}

function RawDebugView({ rawOutput }: { rawOutput: string }) {
  return (
    <div className="rounded-card border border-line bg-inset p-3 shadow-card">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ink-3">
        <TerminalSquare className="h-3 w-3" /> Terminal / debug
      </div>
      {rawOutput ? (
        <XtermTerminal output={rawOutput} />
      ) : (
        <div className="flex h-64 items-center justify-center font-mono text-xs text-ink-3">No raw output yet.</div>
      )}
    </div>
  )
}

function TaskLoading({ onBack }: { onBack: () => void }) {
  return (
    <main className="mobile-app min-h-[100dvh] bg-canvas px-4 pt-[calc(env(safe-area-inset-top)+12px)] text-ink">
      <button onClick={onBack} className="flex size-9 items-center justify-center rounded-control text-ink-2" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
      <div className="mt-6 flex items-center justify-center"><LoadingState label="Loading task" variant="Dots" showElapsed={false} /></div>
      <div className="mt-8 space-y-3">
        <div className="h-5 w-3/4 animate-pulse rounded-control bg-surface" />
        <div className="h-3 w-1/3 animate-pulse rounded-control bg-surface" />
        <div className="mt-10 h-24 animate-pulse rounded-card border border-line bg-surface" />
        <div className="h-20 animate-pulse rounded-card border border-line bg-surface" />
      </div>
    </main>
  )
}

function TaskError({ error, onBack, onRetry }: { error: string; onBack: () => void; onRetry: () => void }) {
  return (
    <main className="mobile-app flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-6 text-center text-ink">
      <AlertCircle className="h-7 w-7 text-red" />
      <p className="mt-4 text-[14px] font-medium">Task unavailable</p>
      <p className="mt-2 text-[12px] leading-5 text-ink-2">{error}</p>
      <div className="mt-6 flex gap-2">
        <button onClick={onBack} className="rounded-control border border-line px-4 py-2.5 text-xs font-medium text-ink transition-colors active:bg-hover">Back</button>
        <button onClick={onRetry} className="rounded-control px-4 py-2.5 text-xs font-medium" style={{ background: 'var(--ink)', color: 'hsl(var(--surface))' }}>Refresh</button>
      </div>
    </main>
  )
}

function findTask(snapshot: MobileSnapshot | null, id: string) {
  for (const workspace of snapshot?.workspaces || []) { const task = workspace.tasks.find((item) => item.id === id) ; if (task) return task }
  return undefined
}

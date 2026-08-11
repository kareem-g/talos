import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  Square,
  TerminalSquare,
  WifiOff,
  X,
  Zap,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { clearDeviceCredential, getDeviceCredential } from '../lib/auth'
import { cleanTerminalText, normalizedText } from '../lib/terminalText'
import { XtermTerminal } from './XtermTerminal'
import { useMobileWebSocket, type MobileRealtimeEvent, type MobileRealtimeMessage } from '../hooks/useMobileWebSocket'
import type {
  MobileAgent,
  MobileAgentEvent,
  MobileAgentMessage,
  MobileApproval,
  MobileConnectionState,
  MobileCreateSessionRequest,
  MobileSession,
  MobileSessionPayload,
  MobileQuestion,
  MobileSnapshot,
  MobileTaskTranscript,
  MobileWorkspace,
} from '../types/mobile'
import { QuestionCard } from './QuestionCard'

const statusMeta: Record<string, { label: string; tone: string; dot: string }> = {
  starting: { label: 'Starting', tone: 'text-accent', dot: 'bg-accent' },
  running: { label: 'Running', tone: 'text-success', dot: 'bg-success' },
  waiting_for_input: { label: 'Waiting', tone: 'text-warning', dot: 'bg-warning' },
  waiting_for_approval: { label: 'Needs approval', tone: 'text-warning', dot: 'bg-warning' },
  idle: { label: 'Idle', tone: 'text-text-muted', dot: 'bg-text-dim' },
  error: { label: 'Error', tone: 'text-error', dot: 'bg-error' },
  archived: { label: 'Completed', tone: 'text-text-muted', dot: 'bg-text-dim' },
  exited: { label: 'Stopped', tone: 'text-text-muted', dot: 'bg-text-dim' },
}

function statusFor(status: string) {
  return statusMeta[status] || { label: status.replace(/_/g, ' '), tone: 'text-text-muted', dot: 'bg-text-dim' }
}

function relativeTime(value?: string) {
  if (!value) return 'No activity yet'
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'Updated now'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Updated ${days}d ago`
}

function compactPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : path
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

function StatusPill({ status }: { status: string }) {
  const meta = statusFor(status)
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${meta.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === 'running' || status === 'starting' ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  )
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
        agents={snapshot?.agents || []}
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

  return (
    <main className="mobile-app min-h-[100dvh] bg-background text-text">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col px-4 pb-8">
        <MobileHomeHeader
          snapshot={snapshot}
          connection={connection}
          syncing={syncing}
          onRefresh={refresh}
          onNewTask={() => setShowCreate(true)}
        />

        <ConnectionBanner connection={connection} error={syncError} onRetry={() => { retry(); void refresh() }} />

        <section className="pb-3 pt-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-dim">Remote control</p>
              <h1 className="mt-1 text-[25px] font-semibold tracking-[-0.035em]">Workspaces and tasks</h1>
            </div>
            {snapshot && <div className="text-right text-xs text-text-dim"><div>{snapshot.workspaces.length} workspaces</div><div>{countTasks(snapshot.workspaces)} tasks</div></div>}
          </div>
        </section>

        {syncing && !snapshot ? <WorkspaceSkeleton /> : syncError && !snapshot ? (
          <ErrorState message="Couldn't sync workspaces." detail={syncError} onRetry={() => { void refresh() }} />
        ) : snapshot && snapshot.workspaces.length === 0 ? (
          <EmptyState icon={FolderGit2} title="No workspaces available" detail="Make sure the desktop daemon is running and a workspace has a task." />
        ) : snapshot ? (
          <div className="space-y-3">
            {snapshot.workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                expanded={expanded.has(workspace.id)}
                onToggle={() => toggleWorkspace(workspace.id)}
                onOpenTask={(id) => navigate(`/mobile/task/${encodeURIComponent(id)}`)}
                onNewTask={() => setShowCreate(true)}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-auto pt-8">
          <div className="flex items-center justify-center gap-2 text-[11px] text-text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${connection === 'connected' ? 'bg-success' : 'bg-warning'}`} />
            {connectionLabel(connection)} to {snapshot?.desktop.name || 'desktop'}
          </div>
          <div className="mt-4 flex items-center justify-center gap-5 text-[11px] text-text-dim">
            <span className="flex items-center gap-1.5 text-text"><Zap className="h-3.5 w-3.5 text-accent" /> Home</span>
            <span className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> {snapshot?.device.name || 'Device'}</span>
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

function MobileHomeHeader({
  snapshot,
  connection,
  syncing,
  onRefresh,
  onNewTask,
}: {
  snapshot: MobileSnapshot | null
  connection: MobileConnectionState
  syncing: boolean
  onRefresh: () => void
  onNewTask: () => void
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border pb-4 pt-[calc(env(safe-area-inset-top)+18px)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface">
        <Code2 className="h-4 w-4 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="text-sm font-semibold tracking-tight">AgentDeck</span><span className="h-1 w-1 rounded-full bg-text-dim" /><StatusPill status={connection === 'connected' ? 'running' : connection === 'reconnecting' || connection === 'offline' ? 'waiting_for_input' : 'starting'} /></div>
        <p className="mt-0.5 truncate text-[11px] text-text-dim">Connected to {snapshot?.desktop.name || 'desktop device'}</p>
      </div>
      <button onClick={onRefresh} disabled={syncing} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50" aria-label="Refresh">
        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
      </button>
      <button onClick={onNewTask} className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent-hover" aria-label="New task">
        <Plus className="h-4 w-4" />
      </button>
    </header>
  )
}

function ConnectionBanner({ connection, error, onRetry }: { connection: MobileConnectionState; error: string | null; onRetry: () => void }) {
  if (connection === 'connected' && !error) return null
  const isError = connection === 'offline' || connection === 'sync_failed' || connection === 'desktop_unavailable' || Boolean(error)
  const title = error || (connection === 'reconnecting' ? 'Desktop unavailable' : connection === 'offline' ? 'You are offline' : connectionLabel(connection))
  const detail = error ? 'Your last synced state remains available.' : connection === 'reconnecting' ? 'Trying to reconnect. Your device is still paired.' : connection === 'offline' ? 'We will reconnect automatically when the network returns.' : 'Syncing the latest desktop state.'
  return (
    <div className={`mt-4 flex items-start gap-3 rounded-xl border px-3.5 py-3 ${isError ? 'border-warning/20 bg-warning/5' : 'border-accent/20 bg-accent/5'}`}>
      {isError ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />}
      <div className="min-w-0 flex-1"><p className="text-xs font-medium text-text">{title}</p><p className="mt-0.5 text-[11px] leading-5 text-text-muted">{detail}</p></div>
      {isError && <button onClick={onRetry} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text hover:bg-surface-hover">Retry</button>}
    </div>
  )
}

function WorkspaceCard({ workspace, expanded, onToggle, onOpenTask, onNewTask }: { workspace: MobileWorkspace; expanded: boolean; onToggle: () => void; onOpenTask: (id: string) => void; onNewTask: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button onClick={onToggle} className="block w-full px-4 py-4 text-left active:bg-surface-hover">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><FolderGit2 className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h2 className="truncate text-sm font-semibold tracking-tight">{workspace.name}</h2><span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-dim">{workspace.local ? 'Local' : 'Remote'}</span></div>
            <p className="mt-1 truncate font-mono text-[10px] text-text-dim">{compactPath(workspace.path)}</p>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-text-muted"><span>{workspace.task_count} {workspace.task_count === 1 ? 'task' : 'tasks'}</span><span className="h-1 w-1 rounded-full bg-text-dim" /><span>{relativeTime(workspace.updated_at)}</span></div>
          </div>
          <span className="mt-1 text-text-dim">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border bg-background/30 px-3 pb-3 pt-2">
          {workspace.tasks.length === 0 ? <p className="px-2 py-4 text-xs text-text-dim">No active tasks</p> : workspace.tasks.map((task) => <TaskRow key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />)}
          <button onClick={onNewTask} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"><Plus className="h-3.5 w-3.5" /> New task in this workspace</button>
        </div>
      )}
    </article>
  )
}

function TaskRow({ task, onOpen }: { task: MobileSession; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-hover active:bg-surface-active">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-muted"><Bot className="h-3.5 w-3.5" /></div>
      <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-text group-hover:text-accent">{task.title}</p><div className="mt-1 flex items-center gap-2"><StatusPill status={task.status} /><span className="text-[10px] text-text-dim">{task.agent}</span></div></div>
      <div className="flex shrink-0 items-center gap-2"><span className="text-[10px] text-text-dim">{relativeTime(task.updated_at).replace('Updated ', '')}</span><ChevronRight className="h-3.5 w-3.5 text-text-dim" /></div>
    </button>
  )
}

function WorkspaceSkeleton() {
  return <div className="space-y-3">{[0, 1].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />)}</div>
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof FolderGit2; title: string; detail: string }) {
  return <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center"><Icon className="h-7 w-7 text-text-dim" /><p className="mt-4 text-sm font-medium text-text">{title}</p><p className="mt-2 max-w-xs text-xs leading-5 text-text-muted">{detail}</p></div>
}

function ErrorState({ message, detail, onRetry }: { message: string; detail: string; onRetry: () => void }) {
  return <div className="rounded-2xl border border-error/20 bg-error/5 px-5 py-8 text-center"><AlertCircle className="mx-auto h-6 w-6 text-error" /><p className="mt-3 text-sm font-medium">{message}</p><p className="mt-1 text-xs text-text-muted">{detail}</p><button onClick={onRetry} className="mt-5 rounded-xl bg-accent px-4 py-2 text-xs font-medium text-white">Retry sync</button></div>
}

function NewTaskSheet({ workspaces, agents, onClose, onCreate }: { workspaces: MobileWorkspace[]; agents: MobileAgent[]; onClose: () => void; onCreate: (data: MobileCreateSessionRequest) => Promise<void> }) {
  const [prompt, setPrompt] = useState('')
  const [agent, setAgent] = useState(agents[0]?.id || '')
  const [project, setProject] = useState(workspaces[0]?.path || '')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!prompt.trim() || !agent) return
    setCreating(true)
    setError(null)
    try { await onCreate({ agent, project: project || undefined, prompt: prompt.trim() }) }
    catch (error: unknown) { setError(error instanceof Error ? error.message : 'Could not start task.') }
    finally { setCreating(false) }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 px-3 pb-3 backdrop-blur-sm sm:items-center"><div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}><div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] uppercase tracking-[0.18em] text-text-dim">New task</p><h2 className="mt-1 text-lg font-semibold">Start an agent</h2></div><button onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-hover"><X className="h-4 w-4" /></button></div><label className="mb-2 block text-xs font-medium text-text-muted">Workspace</label><select value={project} onChange={(event) => setProject(event.target.value)} className="mb-4 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-text outline-none focus:border-accent"><option value="">Desktop default</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.path}>{workspace.name}</option>)}</select><label className="mb-2 block text-xs font-medium text-text-muted">Agent</label><select value={agent} onChange={(event) => setAgent(event.target.value)} className="mb-4 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-text outline-none focus:border-accent">{agents.filter((item) => item.available).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><label className="mb-2 block text-xs font-medium text-text-muted">What should it do?</label><textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="Describe the task..." className="w-full resize-none rounded-xl border border-border bg-background px-3 py-3 text-sm leading-6 text-text outline-none placeholder:text-text-dim focus:border-accent" />{error && <p className="mt-2 text-xs text-error">{error}</p>}<button onClick={() => void submit()} disabled={!prompt.trim() || !agent || creating} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">{creating && <Loader2 className="h-4 w-4 animate-spin" />}Start task</button></div></div>
}

function MobileTaskScreen({ taskId, snapshot, agents, connection, events, terminalOutput, send, onBack, onRetry, onRefresh }: { taskId: string; snapshot: MobileSnapshot | null; agents: MobileAgent[]; connection: MobileConnectionState; events: MobileRealtimeEvent[]; terminalOutput: MobileRealtimeEvent[]; send: (message: MobileRealtimeMessage) => boolean; onBack: () => void; onRetry: () => void; onRefresh: () => Promise<void> }) {
  const [payload, setPayload] = useState<MobileSessionPayload | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [debug, setDebug] = useState(false)
  const [agentMenu, setAgentMenu] = useState(false)
  const [resolvedApprovals, setResolvedApprovals] = useState(new Set<string>())
  const [newActivity, setNewActivity] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [now, setNow] = useState(Date.now())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const liveItems = buildLiveItems(events, taskId)
  const historyItems = buildHistoryItems(payload?.messages || [], payload?.events || [], payload?.transcripts || [])
  const historyUserContent = new Set(historyItems.filter((item) => item.kind === 'user').map((item) => normalizedText(item.content)))
  const questionAnswers = new Map<string, { selected_options?: unknown; custom_text?: unknown }>([
    ...(payload?.events || []).filter((event) => event.kind === 'question_answered').map((event) => [String(event.payload.question_id || ''), event.payload] as const),
    ...events.filter((event) => event.type === 'AgentEvent').map((event) => event.payload?.event as MobileAgentEvent | undefined).filter((event): event is MobileAgentEvent => event?.kind === 'question_answered').map((event) => [String(event.payload.question_id || ''), event.payload] as const),
  ])
  const items = [...historyItems, ...liveItems.filter((item) => item.kind !== 'user' || !historyUserContent.has(normalizedText(item.content)))].map((item) => {
    if (item.kind === 'question' && item.question) {
      const answer = questionAnswers.get(item.question.question_id)
      if (answer) return { ...item, question: { ...item.question, status: 'answered', selected_options: Array.isArray(answer.selected_options) ? answer.selected_options.map(String) : [], custom_text: typeof answer.custom_text === 'string' ? answer.custom_text : undefined } }
    }
    return item
  }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
  const rawHistory = (payload?.terminal_output || [])
    .sort((a, b) => a.sequence - b.sequence)
    .map((item) => item.data)
    .join('')
  const rawOutput = rawHistory + terminalOutput
    .filter((event) => String(event.payload?.session_id || '') === taskId)
    .map((event) => String(event.payload?.data || ''))
    .join('')
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
  const pendingApprovals = [...(payload?.approvals || []), ...historyApprovals, ...liveApprovals].filter((item, index, all) => !resolvedApprovals.has(item.id) && !resolvedEventIds.has(item.id) && all.findIndex((candidate) => candidate.id === item.id) === index)
  const questionItems = items.filter((item): item is ChatItem & { question: MobileQuestion } => item.kind === 'question' && Boolean(item.question))
  const answeredQuestionIds = new Set<string>([
    ...(payload?.events || []).filter((event) => event.kind === 'question_answered').map((event) => String(event.payload.question_id || '')),
    ...events.filter((event) => event.type === 'AgentEvent').map((event) => event.payload?.event as { kind?: string; payload?: Record<string, unknown> } | undefined).filter((event): event is { kind: string; payload?: Record<string, unknown> } => event?.kind === 'question_answered').map((event) => String(event.payload?.question_id || '')),
  ])
  const pendingQuestions = [...(payload?.questions || []), ...questionItems.map((item) => item.question)].filter((question, index, all) => question.status === 'pending' && !answeredQuestionIds.has(question.question_id) && all.findIndex((candidate) => candidate.question_id === question.question_id) === index)
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

  const sendQuestionAnswer = async (answer: { question_id: string; session_id: string; selected_options: string[]; custom_text: string | null }) => {
    const sent = send({ type: 'QuestionAnswer', payload: { answer } })
    if (!sent) throw new Error('Connection is unavailable. The answer was not sent.')
  }

  const sendText = () => {
    const value = input.trim()
    if (!value) return
    const sent = send({ type: 'Input', payload: { session_id: taskId, data: `${value}\n` } })
    if (!sent) { setError('Connection is unavailable. The message was not sent.') ; return }
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
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

  const copyText = (text: string) => { void navigator.clipboard?.writeText(text) }

  if (loading) return <TaskLoading onBack={onBack} />
  if (error || !task) return <TaskError error={error || 'Task unavailable.'} onBack={onBack} onRetry={() => { setReload((value) => value + 1); void onRefresh() }} />

  return <main className="mobile-app flex min-h-[100dvh] flex-col bg-background text-text"><header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur-xl"><div className="flex items-center gap-2"><button onClick={onBack} className="-ml-2 flex h-9 w-9 items-center justify-center rounded-xl text-text-muted hover:bg-surface-hover hover:text-text" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{task.title}</h1><p className="mt-0.5 truncate text-[10px] text-text-dim">{workspace?.name || task.project || 'Desktop task'}{task.branch ? ` · ${task.branch}` : ''}</p></div><StatusPill status={status} /><button onClick={() => setDebug((value) => !value)} className={`flex h-9 w-9 items-center justify-center rounded-xl ${debug ? 'bg-surface-active text-text' : 'text-text-muted hover:bg-surface-hover'}`} aria-label="Terminal debug"><TerminalSquare className="h-4 w-4" /></button><button onClick={stopTask} disabled={!working && status !== 'waiting_for_approval'} className="flex h-9 items-center gap-1.5 rounded-xl border border-error/20 bg-error/5 px-2.5 text-[11px] font-medium text-error disabled:opacity-30"><Square className="h-3 w-3 fill-current" />Stop</button></div><div className="mt-3 flex items-center gap-2 text-[10px] text-text-dim"><span className="flex items-center gap-1"><FolderGit2 className="h-3 w-3" />{compactPath(task.project || workspace?.path || '/')}</span><span className="h-1 w-1 rounded-full bg-text-dim" /><span className="flex items-center gap-1"><Bot className="h-3 w-3" />{task.agent}</span></div></header>
    <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-4 pb-6 pt-4"><div className="mx-auto w-full max-w-lg space-y-3">{connection !== 'connected' && <ConnectionBanner connection={connection} error={null} onRetry={onRetry} />}{working && <WorkingIndicator since={task.created_at} now={now} />}{debug ? <RawDebugView items={items} rawOutput={rawOutput} /> : <>{items.length === 0 && !working && !pendingQuestions.length && <div className="flex min-h-[45vh] flex-col items-center justify-center text-center"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface"><Bot className="h-5 w-5 text-accent" /></div><p className="mt-4 text-sm font-medium">Start the conversation</p><p className="mt-1 max-w-xs text-xs leading-5 text-text-muted">Send a message and AgentDeck will keep this task available on your desktop.</p></div>}{items.map((item) => <ChatItemView key={item.id} item={item} onCopy={copyText} onEdit={(value) => { setInput(value); inputRef.current?.focus() }} />)}{!pendingQuestions.length && pendingApprovals.map((approval) => <ApprovalPrompt key={approval.id} approval={approval} onResolve={(decision) => resolveApproval(approval, decision)} />)}{pendingQuestions.map((question) => <QuestionCard key={question.question_id} question={question} onAnswer={sendQuestionAnswer} />)}</>}</div>{newActivity && <button onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; setNewActivity(false) }} className="sticky bottom-2 left-1/2 mt-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-accent/30 bg-surface px-3 py-1.5 text-[11px] font-medium text-accent shadow-lg"><ChevronDown className="h-3.5 w-3.5" />New activity</button>}</div>
    <div className="sticky bottom-0 border-t border-border bg-background/95 px-3 pt-2 backdrop-blur-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}><div className="mx-auto max-w-lg"><div className="rounded-2xl border border-border bg-surface focus-within:border-border-hover"><div className="flex items-end gap-2 px-3 pt-2.5"><button className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text" aria-label="Add context"><Plus className="h-4 w-4" /></button><textarea ref={inputRef} value={input} onChange={(event) => { setInput(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px` }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendText() } }} rows={1} placeholder={working ? 'Keep typing to queue follow-up changes' : 'Message the agent...'} disabled={status === 'exited' || status === 'archived'} className="max-h-[120px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm leading-5 text-text outline-none placeholder:text-text-dim disabled:opacity-40" /><button onClick={sendText} disabled={!input.trim() || status === 'exited' || status === 'archived'} className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-30" aria-label="Send"><Send className="h-3.5 w-3.5" /></button></div><div className="flex items-center justify-between px-3 pb-2 pt-1"><div className="flex items-center gap-2"><button className="flex items-center gap-1.5 text-[10px] text-text-dim hover:text-text"><Paperclip className="h-3 w-3" />Context</button><div className="relative"><button onClick={() => setAgentMenu((value) => !value)} className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text"><Bot className="h-3 w-3 text-accent" />{task.agent}<ChevronDown className="h-3 w-3" /></button>{agentMenu && <div className="absolute bottom-6 left-0 z-30 w-48 rounded-xl border border-border bg-surface p-1.5 shadow-xl"><p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-dim">Agent for this task</p>{agents.map((agent) => <button key={agent.id} disabled={agent.id !== task.agent} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs text-text-muted disabled:opacity-100 hover:bg-surface-hover"><span>{agent.name}</span>{agent.id === task.agent ? <Check className="h-3 w-3 text-success" /> : <span className="text-[9px] text-text-dim">new task</span>}</button>)}{agents.length === 0 && <p className="px-2 py-2 text-[10px] text-text-dim">No agent metadata available.</p>}<p className="border-t border-border px-2 pb-1 pt-2 text-[10px] leading-4 text-text-dim">Switching during a task is not supported by this agent.</p></div>}</div></div><span className="text-[10px] text-text-dim">{working ? 'Follow-ups stay with this task' : connection === 'connected' ? 'Ready' : connectionLabel(connection)}</span></div></div></div></div>
  </main>
}

interface ChatItem { id: string; kind: 'user' | 'agent' | 'activity' | 'thinking' | 'plan' | 'diff' | 'approval' | 'question' | 'system'; content: string; timestamp?: string; title?: string; detail?: string; approval?: MobileApproval; question?: MobileQuestion }

function buildHistoryItems(messages: MobileAgentMessage[], events: MobileAgentEvent[], transcripts: MobileTaskTranscript[]): ChatItem[] {
  const messageItems = messages.map(messageToChatItem).filter((item): item is ChatItem => Boolean(item))
  const answers = new Map(events.filter((event) => event.kind === 'question_answered').map((event) => [String(event.payload.question_id || ''), event.payload]))
  const cancellations = new Set(events.filter((event) => event.kind === 'question_cancelled').map((event) => String(event.payload.question_id || '')))
  const hasQuestionEvent = events.some((event) => event.kind === 'question_started')
  const eventItems = events.map((event) => {
    if (event.kind === 'permission_required' && hasQuestionEvent && String(event.payload.prompt || '') === 'Claude requested permission') return null
    const item = agentEventToChatItem(event, `history-event-${event.event_id}`)
    if (item?.kind === 'question' && item.question) {
      const answer = answers.get(item.question.question_id)
      if (answer) item.question = { ...item.question, status: 'answered', selected_options: Array.isArray(answer.selected_options) ? answer.selected_options.map(String) : [], custom_text: typeof answer.custom_text === 'string' ? answer.custom_text : undefined }
      if (cancellations.has(item.question.question_id)) item.question = { ...item.question, status: 'cancelled' }
    }
    return item
  }).filter((item): item is ChatItem => Boolean(item))
  const legacyItems = transcripts.filter((item) => item.kind !== 'raw').map((item): ChatItem => {
    const content = cleanTerminalText(item.content)
    if (item.kind === 'user') return { id: `history-${item.id}`, kind: 'user', content, timestamp: item.timestamp }
    if (item.kind === 'approval') {
      try { const approval = JSON.parse(content) as MobileApproval; return { id: `approval-${approval.id}`, kind: 'approval', content: cleanTerminalText(approval.prompt), timestamp: item.timestamp, approval } }
      catch { return { id: `history-${item.id}`, kind: 'activity', content, timestamp: item.timestamp, title: 'Permission requested' } }
    }
    if (item.kind === 'activity' || item.kind === 'plan' || item.kind === 'diff') {
      try { const activity = JSON.parse(content) as { kind?: string; title?: string; detail?: string }; return { id: `history-${item.id}`, kind: activity.kind === 'plan' ? 'plan' : activity.kind === 'file_change' ? 'diff' : activity.kind === 'thinking' ? 'thinking' : 'activity', content, timestamp: item.timestamp, title: activity.title, detail: activity.detail ? cleanTerminalText(activity.detail) : undefined } }
      catch { return { id: `history-${item.id}`, kind: 'activity', content, timestamp: item.timestamp, title: 'Agent activity' } }
    }
    return { id: `history-${item.id}`, kind: item.kind === 'system' ? 'system' : 'agent', content, timestamp: item.timestamp }
  }).filter((item) => item.content.trim())
  return [...messageItems, ...eventItems, ...legacyItems].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
}

function messageToChatItem(message: MobileAgentMessage): ChatItem | null {
  const content = message.content
  if (!content) return null
  return {
    id: `message-${message.id}`,
    kind: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'agent' : 'system',
    content,
    timestamp: message.timestamp,
  }
}

function agentEventToChatItem(event: MobileAgentEvent, id: string): ChatItem | null {
  const payload = event.payload || {}
  const duration = typeof event.duration_ms === 'number' ? formatDuration(event.duration_ms) : ''
  switch (event.kind) {
    case 'assistant_text':
      return { id, kind: 'agent', content: String(payload.text || ''), timestamp: event.timestamp }
    case 'thinking_started':
      return { id, kind: 'thinking', content: '', title: 'Thinking', timestamp: event.timestamp }
    case 'thinking_finished':
      return { id, kind: 'thinking', content: '', title: duration ? `Thought for ${duration}` : 'Thought', timestamp: event.timestamp }
    case 'tool_started':
      return { id, kind: 'activity', content: '', title: String(payload.tool_name || 'Tool'), detail: payload.input ? JSON.stringify(payload.input) : undefined, timestamp: event.timestamp }
    case 'tool_finished':
      return { id, kind: 'activity', content: '', title: `${payload.success === false ? 'Failed' : 'Completed'} · ${String(payload.tool_name || 'Tool')}${duration ? ` · ${duration}` : ''}`, timestamp: event.timestamp }
    case 'file_edited':
      return { id, kind: 'diff', content: '', title: `Edited ${String(payload.path || 'file')}`, detail: formatFileChange(payload), timestamp: event.timestamp }
    case 'search_started':
      return { id, kind: 'thinking', content: '', title: `Explore · ${String(payload.query || 'searching')}`, timestamp: event.timestamp }
    case 'search_finished':
      return { id, kind: 'thinking', content: '', title: `Explore · ${String(payload.result_count || 0)} results${duration ? ` · ${duration}` : ''}`, timestamp: event.timestamp }
    case 'command_started':
      return { id, kind: 'activity', content: '', title: `$ ${String(payload.command || 'command')}`, timestamp: event.timestamp }
    case 'command_finished':
      return { id, kind: 'activity', content: '', title: `${payload.exit_code === 0 ? 'Completed' : 'Failed'} · ${String(payload.command || 'command')}${duration ? ` · ${duration}` : ''}`, timestamp: event.timestamp }
    case 'permission_required':
      return { id, kind: 'approval', content: String(payload.prompt || 'Permission required'), timestamp: event.timestamp, approval: { id: String(payload.id || event.event_id), session_id: event.session_id, prompt: String(payload.prompt || 'Permission required'), options: Array.isArray(payload.options) ? payload.options.map(String) : ['allow', 'always', 'deny'], risk_level: 'medium' } }
    case 'question_started':
      return { id, kind: 'question', content: '', timestamp: event.timestamp, question: payload as unknown as MobileQuestion }
    case 'question_answered':
      return { id, kind: 'system', content: `Question answered: ${String(payload.question_id || '')}`, timestamp: event.timestamp }
    case 'agent_completed':
      return { id, kind: 'thinking', content: '', title: duration ? `Worked for ${duration}` : 'Completed', timestamp: event.timestamp }
    case 'agent_error':
      return { id, kind: 'system', content: String(payload.message || 'Agent error'), timestamp: event.timestamp }
    default:
      return null
  }
}

function formatDuration(durationMs: number) {
  const seconds = Math.round(durationMs / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatFileChange(payload: Record<string, unknown>) {
  const additions = typeof payload.additions === 'number' ? `+${payload.additions}` : ''
  const deletions = typeof payload.deletions === 'number' ? ` -${payload.deletions}` : ''
  return `${additions}${deletions}`.trim() || undefined
}

function buildLiveItems(events: MobileRealtimeEvent[], taskId: string): ChatItem[] {
  const items: ChatItem[] = []
  const seen = new Set<number>()
  for (const event of events) {
    if (typeof event.event_id === 'number') { if (seen.has(event.event_id)) continue; seen.add(event.event_id) }
    const payload = event.payload || {}
    const eventSessionId = String(
      payload.session_id
      || (payload.message as { session_id?: string } | undefined)?.session_id
      || (payload.event as { session_id?: string } | undefined)?.session_id
      || '',
    )
    if (eventSessionId !== taskId) continue
    const id = `event-${event.event_id || `${event.type}-${event.timestamp}`}`
    if (event.type === 'Message') {
      const message = payload.message as MobileAgentMessage | undefined
      if (message) {
        const item = messageToChatItem(message)
        if (item) items.push({ ...item, id })
      }
    } else if (event.type === 'AgentEvent') {
      const semantic = payload.event as MobileAgentEvent | undefined
      if (semantic) {
        const item = agentEventToChatItem(semantic, id)
        if (item) items.push(item)
      }
    } else if (event.type === 'TranscriptChunk') {
      const kind = String(payload.kind || 'stdout')
      const content = cleanTerminalText(String(payload.chunk || ''))
      if (content) items.push({ id, kind: kind === 'user' ? 'user' : kind === 'system' ? 'system' : 'agent', content, timestamp: event.timestamp })
    } else if (event.type === 'Activity') {
      const activity = payload.activity as { kind?: string; title?: string; detail?: string } | undefined
      items.push({ id, kind: activity?.kind === 'plan' ? 'plan' : activity?.kind === 'file_change' ? 'diff' : activity?.kind === 'thinking' ? 'thinking' : 'activity', content: activity?.detail || '', title: activity?.title || 'Agent activity', detail: activity?.detail, timestamp: event.timestamp })
    } else if (event.type === 'ApprovalRequest') {
      const raw = payload.request as { id?: string; prompt?: string; options?: string[]; risk_level?: MobileApproval['risk_level'] } | undefined
      if (raw?.id) items.push({ id, kind: 'approval', content: raw.prompt || 'Permission required', timestamp: event.timestamp, approval: { id: raw.id, session_id: taskId, prompt: raw.prompt || 'Permission required', options: raw.options || ['allow', 'always', 'deny'], risk_level: raw.risk_level || 'medium' } })
    } else if (event.type === 'ApprovalResolved') {
      items.push({ id, kind: 'system', content: `Permission ${String(payload.decision || 'resolved')}`, timestamp: event.timestamp })
    } else if (event.type === 'SessionError' && payload.message) {
      items.push({ id, kind: 'system', content: String(payload.message), timestamp: event.timestamp })
    }
  }
  return items
}

function ChatItemView({ item, onCopy, onEdit }: { item: ChatItem; onCopy: (text: string) => void; onEdit: (text: string) => void }) {
  if (item.kind === 'question' && item.question) return item.question.status !== 'pending' ? <QuestionCard question={item.question} onAnswer={() => {}} /> : null
  if (item.kind === 'activity' || item.kind === 'thinking' || item.kind === 'plan' || item.kind === 'diff') return <ActivityRow item={item} />
  if (item.kind === 'approval') return null
  if (item.kind === 'system') return <div className="flex justify-center py-1"><div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] text-text-muted"><ShieldAlert className="h-3 w-3 text-warning" />{item.content}</div></div>
  const user = item.kind === 'user'
  return <div className={`flex ${user ? 'justify-end' : 'justify-start'}`}><div className={`group max-w-[88%] ${user ? 'items-end' : 'items-start'} flex flex-col`}><div className={`rounded-2xl px-3.5 py-2.5 ${user ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md border border-border bg-surface text-text'}`}><MessageContent content={item.content} /></div><div className={`mt-1 flex items-center gap-2 px-1 text-[10px] text-text-dim ${user ? 'flex-row-reverse' : ''}`}><span>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now'}</span><button onClick={() => onCopy(item.content)} className="opacity-0 transition-opacity group-hover:opacity-100" aria-label="Copy"><Copy className="h-3 w-3" /></button>{user && <button onClick={() => onEdit(item.content)} className="opacity-0 transition-opacity group-hover:opacity-100" aria-label="Edit"><Clipboard className="h-3 w-3" /></button>}</div></div></div>
}

function ActivityRow({ item }: { item: ChatItem }) {
  const [expanded, setExpanded] = useState(false)
  if (item.kind === 'thinking') return <div className="flex items-center gap-2 px-2 py-0.5 text-[10px] text-text-dim"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" />{item.title}</div>
  const Icon = item.kind === 'diff' ? FileCode2 : item.kind === 'plan' ? Clipboard : Search
  return <div className="rounded-xl border border-border/70 bg-surface/60"><button onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"><Icon className={`h-3.5 w-3.5 shrink-0 ${item.kind === 'diff' ? 'text-success' : 'text-text-dim'}`} /><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-muted">{item.title || 'Agent activity'}</span>{item.detail && (expanded ? <ChevronDown className="h-3 w-3 text-text-dim" /> : <ChevronRight className="h-3 w-3 text-text-dim" />)}</button>{expanded && item.detail && <div className="border-t border-border/60 px-3 pb-3 pt-2 text-[11px] leading-5 text-text-muted"><pre className="whitespace-pre-wrap font-sans">{item.detail}</pre></div>}</div>
}

function ApprovalPrompt({ approval, onResolve }: { approval: MobileApproval; onResolve: (decision: string) => void }) {
  const risk = approval.risk_level === 'high' || approval.risk_level === 'critical'
  return <div className={`rounded-2xl border p-3.5 ${risk ? 'border-error/30 bg-error/5' : 'border-warning/30 bg-warning/5'}`}><div className="flex items-start gap-3"><div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${risk ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'}`}><ShieldAlert className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs font-semibold">Permission required</p><p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-text-muted">{approval.prompt}</p></div></div><div className="mt-3 flex gap-2"><button onClick={() => onResolve('allow')} className="flex-1 rounded-xl bg-success/15 px-2 py-2 text-[11px] font-medium text-success hover:bg-success/25">Allow</button><button onClick={() => onResolve('always')} className="flex-1 rounded-xl border border-border bg-surface/70 px-2 py-2 text-[11px] font-medium text-text hover:bg-surface-hover">Always in project</button><button onClick={() => onResolve('deny')} className="flex-1 rounded-xl bg-error/10 px-2 py-2 text-[11px] font-medium text-error hover:bg-error/20">Deny</button></div></div>
}

function WorkingIndicator({ since, now }: { since: string; now: number }) {
  const elapsed = Math.max(0, now - new Date(since).getTime())
  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const label = minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
  return <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-text-muted"><span className="flex gap-0.5"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" /></span><span>Working for {label}</span></div>
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\w-]*\n[\s\S]*?```)/g)
  return <div className="space-y-2 text-[13px] leading-6">{parts.map((part, index) => { const match = part.match(/^```([\w-]*)\n([\s\S]*?)```$/); if (match) return <pre key={index} className="overflow-x-auto rounded-xl border border-border/70 bg-terminal-bg p-3 text-[11px] leading-5 text-terminal-fg"><code className="font-mono">{match[2]}</code></pre>; return part.trim() ? <p key={index} className="whitespace-pre-wrap break-words">{part}</p> : null })}</div>
}

function RawDebugView({ items, rawOutput }: { items: ChatItem[]; rawOutput: string }) {
  const content = rawOutput || items.map((item) => item.content).join('\n\n')
  return <div className="rounded-xl border border-border bg-terminal-bg p-3"><div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-dim"><TerminalSquare className="h-3 w-3" /> Terminal / debug</div>{content ? <XtermTerminal output={content} /> : <div className="flex h-64 items-center justify-center font-mono text-xs text-text-dim">No raw output yet.</div>}</div>
}

function TaskLoading({ onBack }: { onBack: () => void }) {
  return <main className="mobile-app min-h-[100dvh] bg-background px-4 pt-[calc(env(safe-area-inset-top)+12px)]"><button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted"><ArrowLeft className="h-4 w-4" /></button><div className="mt-8 space-y-3"><div className="h-5 w-3/4 animate-pulse rounded bg-surface" /><div className="h-3 w-1/3 animate-pulse rounded bg-surface" /><div className="mt-10 h-24 animate-pulse rounded-2xl border border-border bg-surface" /><div className="h-20 animate-pulse rounded-2xl border border-border bg-surface" /></div></main>
}

function TaskError({ error, onBack, onRetry }: { error: string; onBack: () => void; onRetry: () => void }) {
  return <main className="mobile-app flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center"><AlertCircle className="h-7 w-7 text-error" /><p className="mt-4 text-sm font-medium">Task unavailable</p><p className="mt-2 text-xs leading-5 text-text-muted">{error}</p><div className="mt-6 flex gap-2"><button onClick={onBack} className="rounded-xl border border-border px-4 py-2.5 text-xs font-medium text-text">Back</button><button onClick={onRetry} className="rounded-xl bg-accent px-4 py-2.5 text-xs font-medium text-white">Refresh</button></div></main>
}

function findTask(snapshot: MobileSnapshot | null, id: string) {
  for (const workspace of snapshot?.workspaces || []) { const task = workspace.tasks.find((item) => item.id === id); if (task) return task }
  return undefined
}

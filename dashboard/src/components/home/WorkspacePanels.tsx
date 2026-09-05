import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, FolderGit2, GitBranch, Globe2, LoaderCircle, Play, Plus, RefreshCw, RotateCcw, Search, TerminalSquare, Trash2, X } from 'lucide-react'
import { Button, Chip, Dots, EmptyState, IconButton, StatusPill, TextField } from '../ui'
import { getConversation, useStore } from '@/store'
import { sessionUIState, uiStateDisplay, isInternalSession } from '@/lib/sessionState'
import { relativeTime, cn } from '@/lib/format'
import { sessionWorkspaceApi, workspaceApi, type WorkspaceOverview } from '@/lib/api'
import type { Provider } from '@/types/provider'
import type { Session } from '@/types/session'
import {
  DiffLayer,
  GitError,
  GitSection,
  GitSummary,
  PanelHeader,
  PanelScroll,
} from '../shared/GitComponents'

export type WorkspaceTab = 'sessions' | 'agents' | 'terminals' | 'browser' | 'tasks' | 'git'

export const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string; key: string }> = [
  { id: 'sessions', label: 'Sessions', key: '1' },
  { id: 'agents', label: 'Subagents', key: '2' },
  { id: 'terminals', label: 'Terminals', key: '3' },
  { id: 'browser', label: 'Browser', key: '4' },
  { id: 'tasks', label: 'Tasks', key: '5' },
  { id: 'git', label: 'Git', key: '6' },
]

interface PanelActions {
  onOpenSession: (sessionId: string) => void
  onNewSession: () => void
}

export function WorkspacePanel({ tab, actions }: { tab: WorkspaceTab; actions: PanelActions }) {
  switch (tab) {
    case 'agents':
      return <AgentsPanel actions={actions} />
    case 'terminals':
      return <TerminalsPanel actions={actions} />
    case 'browser':
      return <BrowserPanel />
    case 'tasks':
      return <TasksPanel actions={actions} />
    case 'git':
      return <GitPanel />
    case 'sessions':
      return null
  }
}

function ProviderBadge({ provider }: { provider: Provider }) {
  const hue = provider.id === 'claude' ? '#6396cc' : provider.id === 'codex' ? '#a78bfa' : '#7fa8d8'
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: hue }} />
    </span>
  )
}

function AgentsPanel({ actions }: { actions: PanelActions }) {
  const providers = useStore((state) => state.providers)
  const sessions = useStore((state) => state.sessions)
  const loadProviders = useStore((state) => state.loadProviders)
  const createSession = useStore((state) => state.createSession)
  const [refreshing, setRefreshing] = useState(false)
  const [launching, setLaunching] = useState<string>()

  async function refresh() {
    setRefreshing(true)
    await loadProviders(true)
    setRefreshing(false)
  }

  async function launch(provider: Provider) {
    setLaunching(provider.id)
    try {
      const session = await createSession({ agent: provider.id })
      actions.onOpenSession(session.id)
    } finally {
      setLaunching(undefined)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        eyebrow="Subagent fleet"
        title="Available subagents"
        detail={`${providers.filter((provider) => provider.state === 'ready').length} ready · ${sessions.filter((session) => session.status === 'running').length} running`}
        action={
          <IconButton label="Refresh subagents" onClick={() => void refresh()} className="size-8">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
        }
      />
      <PanelScroll>
        {providers.length === 0 ? (
          <div className="p-4 text-center"><Dots label="Discovering subagents…" /></div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {providers.map((provider) => {
              const active = sessions.filter((session) => session.agent === provider.id && session.status === 'running').length
              const ready = provider.state === 'ready'
              return (
                <div key={provider.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-2.5">
                  <div className="flex items-center gap-2">
                    <ProviderBadge provider={provider} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-zinc-100">{provider.name}</p>
                      <p className="truncate font-mono text-[10px] text-zinc-500">{provider.id} · {provider.version ?? provider.transport}</p>
                    </div>
                    <Chip tone={ready ? 'green' : provider.state === 'error' ? 'red' : 'default'}>{ready ? 'Ready' : provider.state.replace('_', ' ')}</Chip>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
                    <span>{active} active</span>
                    <span className="text-white/15">·</span>
                    <span>{provider.models.length || provider.configOptions.length ? 'Configurable' : 'Native terminal'}</span>
                    <button
                      type="button"
                      disabled={!ready || launching === provider.id}
                      onClick={() => void launch(provider)}
                      className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[11px] font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {launching === provider.id ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={11} />}
                      Launch
                    </button>
                  </div>
                  {!ready && provider.remedy ? <p className="mt-2 rounded-lg bg-accent/[0.06] px-2 py-1.5 text-[10px] leading-[1.45] text-accent">{provider.remedy}</p> : null}
                </div>
              )
            })}
          </div>
        )}
      </PanelScroll>
      <div className="border-t border-white/[0.07] p-2">
        <Button onClick={actions.onNewSession} className="w-full bg-white text-black hover:bg-zinc-200">
          <Plus size={13} /> Advanced launch
        </Button>
      </div>
    </div>
  )
}

function TerminalRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const conversation = getConversation(session.id)
  const hasOutput = conversation.terminal.trim().length > 0
  const display = uiStateDisplay(sessionUIState(session, conversation, useStore.getState().connection))
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-2.5 text-left transition hover:border-white/15 hover:bg-white/[0.05]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/40 text-emerald-400"><TerminalSquare size={15} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-zinc-100">{session.name}</span>
        <span className="block truncate font-mono text-[10px] text-zinc-500">{session.project ?? 'No project'}{hasOutput ? ' · output buffered' : ' · waiting for output'}</span>
      </span>
      <StatusPill label={display.label} tone={display.tone} pulse={display.pulse} className="h-5 px-1.5 text-[10px]" />
    </button>
  )
}

function TerminalsPanel({ actions }: { actions: PanelActions }) {
  const sessions = useStore((state) => state.sessions).filter((session) => session.status !== 'archived' && !isInternalSession(session))
  const terminalSessions = useMemo(() => sessions.filter((session) => Boolean(getConversation(session.id).terminal.trim()) || session.status === 'running'), [sessions])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        eyebrow="Process I/O"
        title="Active terminals"
        detail="Open a session terminal, inspect raw PTY output, or start another agent session."
        action={<IconButton label="Create terminal session" onClick={actions.onNewSession} className="size-8"><Plus size={15} /></IconButton>}
      />
      <PanelScroll>
        {terminalSessions.length === 0 ? (
          <EmptyState title="No active terminals" description="Start an agent session to get a live terminal here." action={<Button onClick={actions.onNewSession}><Plus size={12} /> New terminal</Button>} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {terminalSessions.map((session) => <TerminalRow key={session.id} session={session} onOpen={() => actions.onOpenSession(session.id)} />)}
          </div>
        )}
      </PanelScroll>
    </div>
  )
}

type BrowserTab = { id: string; title: string; url: string }
const BROWSER_STORAGE = 'agentdeck-browser-tabs'
const DEFAULT_BROWSER_TAB: BrowserTab = { id: 'home', title: 'Start page', url: 'https://agentdeck.local' }

function BrowserPanel() {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(BROWSER_STORAGE) ?? 'null') as BrowserTab[] | null
      return parsed?.length ? parsed : [DEFAULT_BROWSER_TAB]
    } catch {
      return [DEFAULT_BROWSER_TAB]
    }
  })
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? DEFAULT_BROWSER_TAB.id)
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const [draft, setDraft] = useState(active?.url ?? '')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    localStorage.setItem(BROWSER_STORAGE, JSON.stringify(tabs))
  }, [tabs])
  useEffect(() => {
    setDraft(active?.url ?? '')
    setLoaded(false)
    // A URL edit should not reset the newly navigated page to loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  function normalizeUrl(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return ''
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  }

  function navigate() {
    const url = normalizeUrl(draft)
    if (!url) return
    setTabs((current) => current.map((tab) => tab.id === activeId ? { ...tab, url, title: new URL(url).hostname } : tab))
    setLoaded(true)
  }

  function addTab() {
    const id = `tab-${Date.now()}`
    setTabs((current) => [...current, { id, title: 'New tab', url: 'https://agentdeck.local' }])
    setActiveId(id)
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id)
      return next.length ? next : [DEFAULT_BROWSER_TAB]
    })
    if (id === activeId) setActiveId(tabs.find((tab) => tab.id !== id)?.id ?? DEFAULT_BROWSER_TAB.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        eyebrow="Web control"
        title="Browser tabs"
        detail="Keep research and local previews next to your running agents."
        action={<IconButton label="New browser tab" onClick={addTab} className="size-8"><Plus size={15} /></IconButton>}
      />
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.07] px-2 py-2">
          {tabs.map((tab) => (
            <div key={tab.id} className={cn('group flex min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[10px]', tab.id === activeId ? 'bg-white/10 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300')}>
              <button type="button" onClick={() => setActiveId(tab.id)} className="max-w-[115px] truncate">{tab.title}</button>
              <button type="button" onClick={() => closeTab(tab.id)} className="rounded p-0.5 opacity-50 hover:bg-white/10 hover:opacity-100" aria-label={`Close ${tab.title}`}><X size={10} /></button>
            </div>
          ))}
          <button type="button" onClick={addTab} className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-white" aria-label="New tab"><Plus size={13} /></button>
        </div>
        <div className="flex items-center gap-1 border-b border-white/[0.07] p-2">
          <IconButton label="Reload browser tab" onClick={() => { setLoaded(false); setTimeout(() => setLoaded(true), 50) }} className="size-8"><RotateCcw size={13} /></IconButton>
          <TextField aria-label="Browser URL" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') navigate() }} leading={<Globe2 size={13} />} className="min-w-0 flex-1" />
          <Button onClick={navigate} className="min-h-8 px-2.5"><Search size={12} /> Go</Button>
          {active ? <IconButton label="Open in external browser" onClick={() => window.open(active.url, '_blank', 'noopener,noreferrer')} className="size-8"><ExternalLink size={13} /></IconButton> : null}
        </div>
        <div className="min-h-[240px] flex-1 bg-black/20">
          {active?.url === DEFAULT_BROWSER_TAB.url ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center p-5 text-center">
              <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] text-zinc-300"><Globe2 size={22} /></span>
              <p className="text-[12px] font-medium text-zinc-200">Enter a URL to browse</p>
              <p className="mt-1 max-w-[190px] text-[10px] leading-[1.5] text-zinc-500">The page stays in this workspace and can also open in your system browser.</p>
            </div>
          ) : loaded ? (
            <iframe title={active?.title ?? 'Browser'} src={active?.url} className="h-[360px] min-h-full w-full border-0 bg-white" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts" />
          ) : (
            <div className="flex h-[360px] items-center justify-center"><Dots label="Loading page…" /></div>
          )}
        </div>
      </div>
    </div>
  )
}

function TasksPanel({ actions }: { actions: PanelActions }) {
  const sessions = useStore((state) => state.sessions).filter((session) => session.status !== 'archived' && !isInternalSession(session))
  const connection = useStore((state) => state.connection)
  const resumeSession = useStore((state) => state.resumeSession)
  const archive = useStore((state) => state.deleteSession)
  const [filter, setFilter] = useState<'all' | 'attention' | 'active'>('all')
  const [busy, setBusy] = useState<string>()
  const rows = useMemo(() => sessions.filter((session) => {
    const state = sessionUIState(session, getConversation(session.id), connection)
    if (filter === 'active') return state === 'working' || state === 'starting' || state === 'resuming'
    if (filter === 'attention') return state === 'approval' || state === 'input' || state === 'failed' || state === 'paused'
    return true
  }), [sessions, connection, filter])

  async function resume(sessionId: string) {
    setBusy(sessionId)
    await resumeSession(sessionId)
    setBusy(undefined)
  }

  async function remove(sessionId: string) {
    if (!window.confirm('Delete this session?')) return
    setBusy(sessionId)
    try {
      await archive(sessionId)
    } catch {
      /* notice already set by the store */
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader eyebrow="Work queue" title="Tasks" detail="Every session becomes an actionable task with live state." action={<IconButton label="New task" onClick={actions.onNewSession} className="size-8"><Plus size={15} /></IconButton>} />
      <div className="flex items-center gap-1 border-b border-white/[0.07] px-2 py-2">
        {(['all', 'active', 'attention'] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn('rounded-full px-2.5 py-1 text-[10px] capitalize transition', filter === value ? 'bg-white text-black' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200')}>{value}</button>)}
        <span className="ml-auto font-mono text-[10px] text-zinc-500">{rows.length} shown</span>
      </div>
      <PanelScroll>
        {rows.length === 0 ? <EmptyState title="No matching tasks" description="Start a session or change the filter." action={<Button onClick={actions.onNewSession}><Plus size={12} /> New task</Button>} /> : <div className="flex flex-col gap-1.5">{rows.map((session) => {
          const state = sessionUIState(session, getConversation(session.id), connection)
          const display = uiStateDisplay(state)
          const canResume = session.status === 'needs_resume' || session.status === 'exited' || session.status === 'error' || session.status === 'idle'
          return <div key={session.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-2.5">
            <button type="button" onClick={() => actions.onOpenSession(session.id)} className="flex w-full items-start gap-2 text-left">
              <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: display.tone === 'green' ? 'var(--green)' : display.tone === 'orange' ? 'var(--orange)' : display.tone === 'red' ? 'var(--red)' : 'var(--zinc-500)' }} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-zinc-100">{session.name}</span><span className="block truncate font-mono text-[10px] text-zinc-500">{session.project ?? 'Inbox'} · {relativeTime(session.updated_at)}</span></span>
              <StatusPill label={display.label} tone={display.tone} pulse={display.pulse} className="h-5 px-1.5 text-[10px]" />
            </button>
            <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-white/[0.06] pt-2">
              {canResume ? <button type="button" disabled={busy === session.id} onClick={() => void resume(session.id)} className="inline-flex h-7 items-center gap-1 rounded-full bg-white px-2.5 text-[10px] font-semibold text-black disabled:opacity-40">{busy === session.id ? <LoaderCircle size={11} className="animate-spin" /> : <RotateCcw size={11} />} Resume</button> : null}
              <button type="button" onClick={() => void remove(session.id)} disabled={busy === session.id} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"><Trash2 size={11} /> Delete</button>
            </div>
          </div>
        })}</div>}
      </PanelScroll>
    </div>
  )
}

function GitPanel() {
  const sessions = useStore((state) => state.sessions).filter((session) => session.project && session.status !== 'archived' && !isInternalSession(session))
  const projects = useMemo(() => [...new Set(sessions.map((session) => session.project).filter((project): project is string => Boolean(project)))], [sessions])
  const [project, setProject] = useState(projects[0] ?? '')
  const [overview, setOverview] = useState<WorkspaceOverview>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [openDiff, setOpenDiff] = useState<{ path: string; diff: string }>()

  useEffect(() => { if (!project && projects[0]) setProject(projects[0]) }, [project, projects])

  const refresh = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(undefined)
    try {
      setOverview(await workspaceApi.overview(project))
    } catch (cause) {
      // Older daemons expose the same payload through the session endpoint.
      try { setOverview(await sessionWorkspaceApi.overview(sessions.find((session) => session.project === project)?.id ?? '')) } catch (fallback) { setError(fallback instanceof Error ? fallback.message : cause instanceof Error ? cause.message : 'Could not load git state') }
    } finally { setLoading(false) }
  }, [project, sessions])

  useEffect(() => { if (project) void refresh() }, [project, refresh])

  const files = overview?.changed_files ?? (overview as (WorkspaceOverview & { files?: Array<{ path: string; status?: string; diff?: string }> }) | undefined)?.files ?? []
  const worktrees = overview?.worktrees ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader eyebrow="Repository state" title="Git tools" detail="Inspect changed files and worktrees from the active project." action={<IconButton label="Refresh git state" onClick={() => void refresh()} className="size-8"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></IconButton>} />
      <div className="border-b border-white/[0.07] p-2">
        {projects.length === 0 ? <p className="px-2 py-2 text-[10px] text-zinc-500">No session has a project folder yet.</p> : <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2"><GitBranch size={13} className="text-zinc-500" /><select aria-label="Git project" value={project} onChange={(event) => setProject(event.target.value)} className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-zinc-300 outline-none">{projects.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}</select><ChevronDown size={12} className="text-zinc-500" /></label>}
      </div>
      <PanelScroll>
        {error ? <GitError message={error} /> : null}
        {loading && !overview ? <div className="p-4 text-center"><Dots label="Reading git state…" /></div> : !project ? <EmptyState title="Choose a project" description="Git tools become available when a session has a project folder." /> : <div className="space-y-3">
          <GitSummary overview={overview} files={files} />
          <GitSection title={`Changes${files.length ? ` · ${files.length}` : ''}`}>
            {files.length === 0 ? <p className="text-[10px] text-zinc-500">Working tree clean.</p> : <div className="space-y-1">{files.map((file) => { const diff = 'diff' in file && typeof file.diff === 'string' ? file.diff : overview?.diffs?.[file.path]; return <button key={file.path} type="button" disabled={!diff} onClick={() => diff && setOpenDiff({ path: file.path, diff })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.05] disabled:cursor-default"><span className={cn('font-mono text-[10px] font-semibold', file.status?.includes('M') ? 'text-orange' : file.status?.includes('A') ? 'text-green' : 'text-zinc-500')}>{file.status ?? '·'}</span><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">{file.path}</span>{diff ? <span className="text-[10px] text-zinc-500">diff</span> : null}</button> })}</div>}
          </GitSection>
          {worktrees.length ? <GitSection title={`Worktrees · ${worktrees.length}`}><div className="space-y-1">{worktrees.map((tree, index) => <div key={tree.path ?? index} className="rounded-lg border border-white/[0.07] bg-black/20 px-2 py-2"><div className="flex items-center gap-2"><FolderGit2 size={12} className="text-zinc-500" /><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">{tree.branch ?? tree.name ?? 'worktree'}</span>{index === 0 ? <Chip tone="green">main</Chip> : null}</div>{tree.path ? <p className="mt-1 truncate font-mono text-[9px] text-zinc-600">{tree.path}</p> : null}</div>)}</div></GitSection> : null}
        </div>}
      </PanelScroll>
      {openDiff ? <DiffLayer diff={openDiff.diff} path={openDiff.path} onClose={() => setOpenDiff(undefined)} /> : null}
    </div>
  )
}


import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Terminal,
  Play,
  Pause,
  Square,
  GitBranch,
  Clock,
  Search,
  Plus,
  Bot,
  AlertCircle,
  Wifi
} from 'lucide-react'

interface SessionItem {
  id: string
  name: string
  agent: string
  agentName: string
  status: 'running' | 'waiting' | 'idle' | 'error' | 'archived' | 'starting' | 'exited'
  project?: string
  branch?: string
  updatedAt: string
  cost?: number
  tokensUsed?: number
}

interface AgentInfo {
  id: string
  name: string
  available: boolean
  path: string
  features: string[]
}

const statusConfig = {
  running: { color: 'text-success', bg: 'bg-success/10', icon: Play, label: 'Running', dot: 'bg-success', pill: 'bg-success/10 text-success' },
  waiting: { color: 'text-warning', bg: 'bg-warning/10', icon: Pause, label: 'Waiting', dot: 'bg-warning', pill: 'bg-warning/10 text-warning' },
  waiting_for_input: { color: 'text-warning', bg: 'bg-warning/10', icon: Pause, label: 'Waiting for input', dot: 'bg-warning', pill: 'bg-warning/10 text-warning' },
  waiting_for_approval: { color: 'text-warning', bg: 'bg-warning/10', icon: Pause, label: 'Waiting for approval', dot: 'bg-warning', pill: 'bg-warning/10 text-warning' },
  idle: { color: 'text-text-muted', bg: 'bg-surface-hover', icon: Terminal, label: 'Idle', dot: 'bg-text-dim', pill: 'bg-surface-hover text-text-muted' },
  error: { color: 'text-error', bg: 'bg-error/10', icon: Square, label: 'Error', dot: 'bg-error', pill: 'bg-error/10 text-error' },
  archived: { color: 'text-text-dim', bg: 'bg-surface-hover', icon: Terminal, label: 'Archived', dot: 'bg-text-dim', pill: 'bg-surface-hover text-text-dim' },
  starting: { color: 'text-accent', bg: 'bg-accent/10', icon: Play, label: 'Starting', dot: 'bg-accent', pill: 'bg-accent/10 text-accent' },
  exited: { color: 'text-text-dim', bg: 'bg-surface-active', icon: Square, label: 'Exited', dot: 'bg-text-dim', pill: 'bg-surface-active text-text-dim' },
} as Record<string, { color: string; bg: string; icon: typeof Terminal; label: string; dot: string; pill: string }>

/** Unknown statuses fall back to idle instead of crashing the grid. */
const configFor = (status: string) => statusConfig[status] || statusConfig.idle

/** Filter chips modeled on Beautiful UI's Filter Table (status chips + counts). */
const FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'idle', label: 'Idle' },
  { key: 'error', label: 'Error' },
]

export function SessionList() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [showNewSession, setShowNewSession] = useState(false)

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchData = async () => {
    try {
      // Fetch sessions
      console.log('[AgentDeck][Session] Fetching sessions...')
      const sessionsRes = await fetch('/api/sessions')
      const sessionsData = await sessionsRes.json()
      const sessionList = (sessionsData.sessions || []).map((s: any) => ({
        id: s.id,
        name: s.name || 'Unnamed',
        agent: s.agent || '',
        agentName: s.agent ? (s.agent === 'claude' ? 'Claude Code' : s.agent === 'codex' ? 'Codex CLI' : s.agent === 'opencode' ? 'OpenCode' : s.agent) : '',
        status: s.status || 'idle',
        project: s.project || undefined,
        branch: s.branch || undefined,
        updatedAt: s.updated_at ? new Date(s.updated_at).toLocaleDateString() : '-',
        cost: s.cost || undefined,
        tokensUsed: s.tokens_used || undefined,
      }))
      console.log(`[AgentDeck][Session] Loaded ${sessionList.length} session(s)`)
      setSessions(sessionList)

      // Fetch agents
      const agentsRes = await fetch('/api/agents')
      const agentsData = await agentsRes.json()
      setAgents(agentsData.agents || [])
    } catch (err) {
      console.error('[AgentDeck][Session] Failed to fetch data:', err)
      setAgents([])
      setSessions([])
    } finally {
      setIsLoading(false)
    }
  }

  const createSession = async (agentId: string) => {
    try {
      console.log(`[AgentDeck][Session] Creating session with agent=${agentId}`)
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentId }),
      })
      const data = await res.json()
      if (data.id) {
        console.log(`[AgentDeck][Session] Created session id=${data.id}`)
        navigate(`/session/${data.id}`)
      } else {
        console.error('[AgentDeck][Session] Create session failed:', data)
      }
    } catch (err) {
      console.error('[AgentDeck][Session] Create session error:', err)
    }
    setShowNewSession(false)
  }

  const filtered = sessions.filter((s) => {
    const matchesFilter = !filter || 
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.agent.toLowerCase().includes(filter.toLowerCase()) ||
      (s.project && s.project.toLowerCase().includes(filter.toLowerCase()))
    const matchesStatus = !statusFilter
      || (statusFilter === 'waiting' ? s.status.startsWith('waiting') : s.status === statusFilter)
    return matchesFilter && matchesStatus
  })

  const availableAgents = agents.filter(a => a.available)
  const countFor = (status: string | null) => status === null
    ? sessions.length
    : sessions.filter(s => status === 'waiting' ? s.status.startsWith('waiting') : s.status === status).length

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Toolbar */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-4 h-4 text-text-dim" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-transparent text-sm text-text placeholder:text-text-dim outline-none flex-1"
          />
        </div>
        {/* Filter chips — Beautiful UI Filter Table pattern */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTERS.map((f) => {
            const active = statusFilter === f.key
            const config = f.key ? statusConfig[f.key as keyof typeof statusConfig] : null
            return (
              <button
                key={f.label}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(f.key)}
                className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors duration-200 ${
                  active ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                {config?.dot && <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />}
                {f.label}
                <span className={`rounded px-1 text-[10.5px] tabular-nums ${active ? 'bg-surface-active text-text' : 'text-text-dim'}`}>
                  {countFor(f.key)}
                </span>
              </button>
            )
          })}
        </div>
        <div className="h-5 w-px bg-border mx-1" />
        <div className="relative">
          <button
            onClick={() => setShowNewSession(!showNewSession)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Session
          </button>

          {showNewSession && (
            <div className="absolute top-full right-0 mt-1 w-56 rounded-lg border border-border bg-surface shadow-xl z-50 overflow-hidden">
              <div className="p-2 text-[10px] text-text-dim uppercase tracking-wider font-medium">Select Agent</div>
              {availableAgents.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-text-dim">
                  <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                  No agents detected
                </div>
              ) : (
                availableAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => createSession(agent.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover transition-colors"
                  >
                    <Bot className="w-4 h-4 text-accent" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text">{agent.name}</div>
                      <div className="text-[10px] text-text-dim font-mono truncate">{agent.path}</div>
                    </div>
                    <Wifi className="w-3 h-3 text-success" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Session Grid */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Terminal className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm">No sessions found</p>
            <p className="text-xs mt-1">Create a new session to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((session, index) => {
              const config = configFor(session.status)
              const StatusIcon = config.icon
              return (
                <div
                  key={session.id}
                  onClick={() => navigate(`/session/${session.id}`)}
                  className="group relative cursor-pointer rounded-xl border border-border bg-surface p-4 transition-all hover:border-border-hover hover:shadow-lg"
                  style={{ animation: `ai-fade-up 220ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index * 45, 300)}ms both` }}
                  data-ai-anim
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${config.bg}`}>
                        <StatusIcon className={`h-4 w-4 ${config.color}`} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-text transition-colors group-hover:text-accent">
                          {session.name}
                        </h3>
                        <p className="flex items-center gap-1.5 text-[11px] text-text-dim">
                          <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
                          {session.agentName || session.agent}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${config.pill}`}>
                      {config.label}
                    </span>
                  </div>

                  {session.project && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <GitBranch className="h-3 w-3 text-text-dim" />
                      <span className="truncate text-[11px] text-text-muted">
                        {session.project}
                        {session.branch && ` • ${session.branch}`}
                      </span>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <div className="flex items-center gap-1.5 text-text-dim">
                      <Clock className="h-3 w-3" />
                      <span className="text-[11px]">{session.updatedAt}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {session.tokensUsed != null && (
                        <span className="font-mono text-[11px] text-text-dim tabular-nums">
                          {(session.tokensUsed / 1000).toFixed(1)}k tokens
                        </span>
                      )}
                      {session.cost != null && (
                        <span className="text-[11px] text-text-dim tabular-nums">
                          ${session.cost.toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

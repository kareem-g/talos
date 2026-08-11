import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Terminal, 
  Play, 
  Pause, 
  Square, 
  GitBranch,
  Clock,
  MoreHorizontal,
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
  running: { color: 'text-success', bg: 'bg-success/10', icon: Play, label: 'Running' },
  waiting: { color: 'text-warning', bg: 'bg-warning/10', icon: Pause, label: 'Waiting' },
  idle: { color: 'text-text-muted', bg: 'bg-surface-hover', icon: Terminal, label: 'Idle' },
  error: { color: 'text-error', bg: 'bg-error/10', icon: Square, label: 'Error' },
  archived: { color: 'text-text-dim', bg: 'bg-surface-hover', icon: Terminal, label: 'Archived' },
  starting: { color: 'text-accent', bg: 'bg-accent/10', icon: Play, label: 'Starting' },
  exited: { color: 'text-text-dim', bg: 'bg-surface-active', icon: Square, label: 'Exited' },
}

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
    const matchesStatus = !statusFilter || s.status === statusFilter
    return matchesFilter && matchesStatus
  })

  const availableAgents = agents.filter(a => a.available)

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
        <div className="flex items-center gap-1">
          {(['running', 'waiting', 'idle', 'error'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                statusFilter === status
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text hover:bg-surface-hover'
              }`}
            >
              {status}
            </button>
          ))}
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
            {filtered.map((session) => {
              const config = statusConfig[session.status]
              const StatusIcon = config.icon
              return (
                <div
                  key={session.id}
                  onClick={() => navigate(`/session/${session.id}`)}
                  className="group relative p-4 rounded-lg border border-border bg-surface hover:border-border-hover hover:bg-surface-hover cursor-pointer transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-md ${config.bg} flex items-center justify-center`}>
                        <StatusIcon className={`w-4 h-4 ${config.color}`} />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-text group-hover:text-accent transition-colors">
                          {session.name}
                        </h3>
                        <p className="text-[11px] text-text-dim">{session.agentName}</p>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation() }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-active transition-all"
                    >
                      <MoreHorizontal className="w-4 h-4 text-text-muted" />
                    </button>
                  </div>

                  {session.project && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <GitBranch className="w-3 h-3 text-text-dim" />
                      <span className="text-[11px] text-text-muted truncate">
                        {session.project}
                        {session.branch && ` • ${session.branch}`}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5 text-text-dim">
                      <Clock className="w-3 h-3" />
                      <span className="text-[11px]">{session.updatedAt}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {session.tokensUsed && (
                        <span className="text-[11px] text-text-dim font-mono">
                          {(session.tokensUsed / 1000).toFixed(1)}k tokens
                        </span>
                      )}
                      {session.cost != null && (
                        <span className="text-[11px] text-text-dim">
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

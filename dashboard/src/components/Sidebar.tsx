import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bot,
  MessageSquare,
  Plus,
  Puzzle,
  Search,
  Settings,
  Smartphone,
  Archive,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useWebSocketState } from '../hooks/useWebSocket'
import { api } from '../lib/api'
import { workspaceRoute } from '../lib/workspaces'

interface SessionSummary {
  id: string
  name: string
  agent: string
  status: string
  project?: string
  updated_at?: string
}

const STATUS_META: Record<string, { dot: string; label: string }> = {
  running: { dot: 'bg-green', label: 'Running' },
  starting: { dot: 'bg-accent', label: 'Starting' },
  waiting_for_input: { dot: 'bg-orange', label: 'Waiting for input' },
  waiting_for_approval: { dot: 'bg-orange', label: 'Needs approval' },
  needs_resume: { dot: 'bg-orange', label: 'Resume' },
  idle: { dot: 'bg-ink-3', label: 'Idle' },
  error: { dot: 'bg-red', label: 'Error' },
  exited: { dot: 'bg-ink-3', label: 'Exited' },
  archived: { dot: 'bg-ink-3', label: 'Completed' },
}

const statusMeta = (status: string) => STATUS_META[status] || { dot: 'bg-ink-3', label: status.replace(/_/g, ' ') }

function agentName(agent: string) {
  if (agent === 'claude') return 'Claude'
  if (agent === 'codex') return 'Codex'
  if (agent === 'opencode') return 'OpenCode'
  return agent
}

export function Sidebar() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stateVersion = useWebSocketState()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)

  const activeSessionId = searchParams.get('session') || searchParams.get('task')

  // Refetch the session list when the backend reports any session-state change.
  // The snapshot version only bumps for StateChange / SessionUpdate frames, so
  // this never fires for streamed tokens.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/sessions${showArchived ? '?include_archived=true' : ''}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setSessions((data.sessions || []).map((session: Record<string, unknown>) => ({
          id: String(session.id || ''),
          name: String(session.name || 'Untitled'),
          agent: String(session.agent || ''),
          status: String(session.status || 'idle'),
          project: typeof session.project === 'string' ? session.project : undefined,
          updated_at: typeof session.updated_at === 'string' ? session.updated_at : undefined,
        })))
      })
      .catch((error) => console.error('[AgentDeck][Sidebar] Failed to load sessions:', error))
    return () => { cancelled = true }
  }, [showArchived, stateVersion])

  const filtered = sessions.filter((session) => {
    if (!showArchived && session.status === 'archived') return false
    if (showArchived && session.status !== 'archived') return false
    if (!filter) return true
    const haystack = `${session.name} ${session.agent} ${session.project || ''}`.toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })

  const openSession = (id: string) => {
    if (activeSessionId === id) return
    navigate(`/task/${encodeURIComponent(id)}`)
  }

  const mutateSession = async (session: SessionSummary, action: 'archive' | 'restore' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete “${session.name}” permanently? Its history will be removed.`)) return
    try {
      if (action === 'archive') await api.sessions.archive(session.id)
      if (action === 'restore') await api.sessions.restore(session.id)
      if (action === 'delete') await api.sessions.delete(session.id)
      setMenuId(null)
      setSessions((current) => action === 'delete' ? current.filter((item) => item.id !== session.id) : current.map((item) => item.id === session.id ? { ...item, status: action === 'archive' ? 'archived' : 'idle' } : item))
      if (action === 'delete' && activeSessionId === session.id) navigate('/')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Session update failed.')
    }
  }

  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col border-r border-line bg-canvas lg:flex">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="mx-1.5 mt-2 flex h-9 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        <div className="mt-2 flex flex-1 flex-col gap-1 px-1.5">
          {filtered.slice(0, 12).map((session) => {
            const active = session.id === activeSessionId
            const meta = statusMeta(session.status)
            return (
              <button
                key={session.id}
                onClick={() => openSession(session.id)}
                title={session.name}
                className={`relative flex h-9 items-center justify-center rounded-control transition-colors ${active ? 'bg-accent-tint text-accent' : 'text-ink-3 hover:bg-hover-2 hover:text-ink'}`}
              >
                <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                <Bot className="h-4 w-4" />
              </button>
            )
          })}
        </div>
        <div className="border-t border-line p-2">
          <button
            onClick={() => setCollapsed(false)}
            className="flex w-full items-center justify-center rounded-control p-1.5 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-canvas lg:flex">
      {/* New session */}
      <div className="border-b border-line p-2.5">
        <button
          onClick={() => navigate('/')}
          className="flex w-full items-center justify-center gap-1.5 rounded-control bg-ink px-3 py-2 text-[12.5px] font-medium transition-transform enabled:active:scale-[0.98]"
          style={{ color: 'hsl(var(--surface))' }}
        >
          <Plus className="h-3.5 w-3.5" />
          New session
        </button>
      </div>

      {/* Sessions */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-3">{showArchived ? 'Archived sessions' : 'Sessions'}</span>
          <button type="button" onClick={() => setShowArchived((value) => !value)} className="rounded-control p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label={showArchived ? 'Show active sessions' : 'Show archived sessions'}>
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="px-2.5 pb-2">
          <div className="flex h-7 items-center gap-2 rounded-control border border-line bg-field px-2 transition-colors focus-within:border-line-strong">
            <Search className="h-3 w-3 shrink-0 text-ink-3" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search sessions…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
        </div>
        <div className="ai-scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11.5px] leading-5 text-ink-3">
              No sessions yet.
              <br />
              Start one to begin chatting.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11.5px] text-ink-3">No matching sessions.</p>
          ) : (
            <div className="flex flex-col gap-px">
              {filtered.map((session) => {
                const active = session.id === activeSessionId
                const meta = statusMeta(session.status)
                return (
                  <div
                    key={session.id}
                    className={`group relative flex w-full items-start gap-2.5 rounded-control px-2 py-2 text-left transition-colors ${
                      active ? 'bg-accent-tint' : 'hover:bg-hover'
                    }`}
                  >
                    <button type="button" onClick={() => openSession(session.id)} aria-current={active ? 'page' : undefined} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot} ${session.status === 'running' || session.status === 'starting' ? 'animate-pulse' : ''}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[12.5px] leading-5 ${active ? 'font-medium text-ink' : 'text-ink-2'}`}>
                          {session.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">{agentName(session.agent)} · {meta.label}</span>
                        {session.project && <span className="mt-0.5 block truncate font-mono text-[9.5px] text-ink-3" onClick={(event) => { event.stopPropagation(); navigate(workspaceRoute(session.project)) }}>{session.project}</span>}
                      </span>
                    </button>
                    <button type="button" onClick={() => setMenuId(menuId === session.id ? null : session.id)} className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 opacity-0 transition-opacity hover:bg-hover-2 hover:text-ink group-hover:opacity-100" aria-label={`Actions for ${session.name}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuId === session.id && (
                      <div className="absolute right-2 top-10 z-30 w-44 rounded-card border border-line bg-surface p-1.5 shadow-overlay">
                        <button type="button" onClick={() => void mutateSession(session, showArchived ? 'restore' : 'archive')} className="flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-xs text-ink-2 hover:bg-hover hover:text-ink">
                          {showArchived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                          {showArchived ? 'Restore session' : 'Archive session'}
                        </button>
                        <button type="button" onClick={() => void mutateSession(session, 'delete')} className="flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-xs text-red hover:bg-red-tint">
                          <Trash2 className="h-3.5 w-3.5" /> Delete permanently
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* System nav */}
      <div className="border-t border-line p-2">
        <div className="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">
          System
        </div>
        <div className="flex flex-col gap-px">
          {[
            { path: '/mcp', label: 'MCP', icon: Puzzle },
            { path: '/settings', label: 'Settings', icon: Settings },
            { path: '/pair', label: 'Connect mobile', icon: Smartphone },
          ].map((item) => {
            const active = window.location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                aria-current={active ? 'page' : undefined}
                className={`group flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors ${
                  active ? 'text-ink' : 'text-ink-2 hover:text-ink'
                }`}
              >
                <span className={active ? 'text-accent' : 'text-ink-3'}>
                  <item.icon className="h-4 w-4" />
                </span>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'font-medium' : ''}`}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

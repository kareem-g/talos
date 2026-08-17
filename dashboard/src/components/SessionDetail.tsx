import { useState, useEffect } from 'react'
import {
  Terminal,
  Square,
  GitBranch,
  Archive,
  RotateCcw,
  Trash2,
  Maximize2,
  Minimize2,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { ChatView } from './ChatView'
import { WorktreePanel } from './WorktreePanel'
import { useWebSocketConnected, useWebSocketState } from '../hooks/useWebSocket'
import { api } from '../lib/api'

/**
 * Session page: compact status header + chat (TaskView) + optional worktree
 * rail on very wide screens. Status is refreshed reactively whenever the
 * WebSocket reports a state change for any session — never by polling, and
 * never re-rendered for streamed tokens (see useWebSocketState).
 */
export function SessionDetail({ sessionId }: { sessionId: string }) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [sessionStatus, setSessionStatus] = useState('running')
  const [sessionName, setSessionName] = useState('')
  const stateVersion = useWebSocketState()
  const connected = useWebSocketConnected()

  // Fetch session info on mount and whenever the backend reports a session
  // state change (resume, stop, approval, start, …).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/sessions/${sessionId}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.status) setSessionStatus(data.status)
        if (data.name) setSessionName(data.name)
      })
      .catch(err => console.error('[AgentDeck][Session] Failed to fetch session:', err))
    return () => { cancelled = true }
  }, [sessionId, stateVersion])

  const handleStop = async () => {
    if (!sessionId || stopping) return
    setStopping(true)
    console.log(`[AgentDeck][Session] Stopping session ${sessionId}...`)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/kill`, { method: 'POST' })
      const data = await res.json()
      console.log('[AgentDeck][Session] Stop response:', data)
      if (data.killed) {
        setSessionStatus('exited')
      }
    } catch (err) {
      console.error('[AgentDeck][Session] Stop failed:', err)
    } finally {
      setStopping(false)
      setShowStopConfirm(false)
    }
  }

  const mutateSession = async (action: 'archive' | 'restore' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete “${sessionName || sessionId}” permanently? Its history will be removed.`)) return
    try {
      if (action === 'archive') await api.sessions.archive(sessionId)
      if (action === 'restore') await api.sessions.restore(sessionId)
      if (action === 'delete') await api.sessions.delete(sessionId)
      if (action === 'delete') window.location.assign('/')
      else setSessionStatus(action === 'archive' ? 'archived' : 'idle')
      setShowActions(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Session update failed.')
    }
  }

  const statusBadge = () => {
    const colors: Record<string, { pill: string; dot: string }> = {
      running: { pill: 'bg-green-tint text-green', dot: 'bg-green' },
      starting: { pill: 'bg-accent-tint text-accent', dot: 'bg-accent' },
      idle: { pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' },
      waiting_for_input: { pill: 'bg-orange-tint text-orange', dot: 'bg-orange' },
      waiting_for_approval: { pill: 'bg-orange-tint text-orange', dot: 'bg-orange' },
      error: { pill: 'bg-red-tint text-red', dot: 'bg-red' },
      exited: { pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' },
      archived: { pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' },
    }
    const tone = colors[sessionStatus] || { pill: 'bg-hover text-ink-3', dot: 'bg-ink-3' }
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-[10.5px] font-medium ${tone.pill}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${sessionStatus === 'running' || sessionStatus === 'starting' ? 'animate-pulse' : ''}`} />
        {sessionStatus.replace(/_/g, ' ')}
      </span>
    )
  }

  return (
    <div className={`flex min-h-0 flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'flex-1 min-w-0'}`}>
      {/* Session Header */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-control bg-accent-tint">
            <Terminal className="h-3.5 w-3.5 text-accent" />
          </div>
          <span className="truncate text-[13px] font-medium text-ink">
            {sessionName || `Session ${sessionId.slice(0, 8)}`}
          </span>
          {statusBadge()}
          <span
            className={`hidden h-1.5 w-1.5 rounded-full sm:block ${connected ? 'bg-green' : 'bg-red'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>

        <div className="flex items-center gap-1">
          {/* Stop Button — only show for active sessions */}
          {(sessionStatus === 'running' || sessionStatus === 'starting' || sessionStatus === 'waiting_for_input' || sessionStatus === 'idle') && (
            <button
              onClick={() => setShowStopConfirm(true)}
              className="flex items-center gap-1.5 rounded-chip bg-red-tint px-2.5 py-1.5 text-[11.5px] font-medium text-red transition-colors hover:bg-red hover:text-white"
              title="Stop session"
            >
              <Square className="h-3 w-3" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          )}
          <div className="relative">
            <button type="button" onClick={() => setShowActions((value) => !value)} className="flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-hover-2 hover:text-ink" aria-label="Session actions">
              <Archive className="h-3.5 w-3.5" />
            </button>
            {showActions && (
              <div className="absolute right-0 top-9 z-30 w-48 rounded-card border border-line bg-surface p-1.5 shadow-overlay">
                <button type="button" onClick={() => void mutateSession(sessionStatus === 'archived' ? 'restore' : 'archive')} className="flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-xs text-ink-2 hover:bg-hover hover:text-ink">
                  {sessionStatus === 'archived' ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  {sessionStatus === 'archived' ? 'Restore session' : 'Archive session'}
                </button>
                <button type="button" onClick={() => void mutateSession('delete')} className="flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-xs text-red hover:bg-red-tint">
                  <Trash2 className="h-3.5 w-3.5" /> Delete permanently
                </button>
              </div>
            )}
          </div>
          {/* Worktree panel is a large-desktop side panel only */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`hidden rounded-control p-1.5 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink xl:block ${showSidebar ? 'bg-hover-2 text-ink' : ''}`}
            title="Toggle worktree panel"
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="rounded-control p-1.5 text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
            title="Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat — semantic timeline + composer (centered readable column) */}
        <ChatView sessionId={sessionId} />

        {/* Right rail — optional side panel on large desktops */}
        {showSidebar && (
          <div className="ai-scroll-thin hidden w-72 shrink-0 overflow-auto border-l border-line bg-canvas xl:block">
            <WorktreePanel sessionId={sessionId} />
          </div>
        )}
      </div>

      {/* Stop Confirmation Modal */}
      {showStopConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-card border border-line bg-surface shadow-overlay animate-fade-in">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 text-red" />
                <h2 className="text-[15px] font-semibold text-ink">Stop session?</h2>
              </div>
              <button
                onClick={() => setShowStopConfirm(false)}
                className="primitive-icon-button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <p className="text-[13px] leading-relaxed text-ink-2">
                This will terminate the running agent and its PTY process.
                The session history will remain available, but the running process
                will be stopped.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowStopConfirm(false)}
                  disabled={stopping}
                  className="rounded-control border border-line px-4 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStop}
                  disabled={stopping}
                  className="flex items-center gap-2 rounded-control bg-red px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:opacity-85 disabled:opacity-50"
                >
                  {stopping && <Loader2 className="h-4 w-4 animate-spin" />}
                  {stopping ? 'Stopping...' : 'Stop Session'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

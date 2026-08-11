import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Terminal,
  Send,
  Square,
  GitBranch,
  Maximize2,
  Minimize2,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { Transcript } from './Transcript'
import { WorktreePanel } from './WorktreePanel'
import { useWebSocket } from '../hooks/useWebSocket'

export function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const [input, setInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [sessionStatus, setSessionStatus] = useState('running')
  const [sessionName, setSessionName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { connected, sendMessage } = useWebSocket()

  // Fetch session info on mount
  useEffect(() => {
    if (!id) return
    fetch(`/api/sessions/${id}`)
      .then(res => res.json())
      .then(data => {
        if (data.status) setSessionStatus(data.status)
        if (data.name) setSessionName(data.name)
      })
      .catch(err => console.error('[AgentDeck][Session] Failed to fetch session:', err))
  }, [id])

  useEffect(() => {
    inputRef.current?.focus()
  }, [id])

  const handleSend = () => {
    if (!input.trim() || !id) return
    const msg = {
      type: 'Input' as const,
      payload: { session_id: id, data: input + '\n' }
    }
    console.log('[AgentDeck][Message] Sending:', msg)
    sendMessage(msg)
    setInput('')
  }

  const handleStop = async () => {
    if (!id || stopping) return
    setStopping(true)
    console.log(`[AgentDeck][Session] Stopping session ${id}...`)
    try {
      const res = await fetch(`/api/sessions/${id}/kill`, { method: 'POST' })
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

  const statusBadge = () => {
    const colors: Record<string, { pill: string; dot: string }> = {
      running: { pill: 'bg-success/10 text-success', dot: 'bg-success' },
      starting: { pill: 'bg-accent/10 text-accent', dot: 'bg-accent' },
      idle: { pill: 'bg-surface-hover text-text-muted', dot: 'bg-text-dim' },
      waiting_for_input: { pill: 'bg-warning/10 text-warning', dot: 'bg-warning' },
      waiting_for_approval: { pill: 'bg-warning/10 text-warning', dot: 'bg-warning' },
      error: { pill: 'bg-error/10 text-error', dot: 'bg-error' },
      exited: { pill: 'bg-surface-active text-text-dim', dot: 'bg-text-dim' },
      archived: { pill: 'bg-surface-active text-text-dim', dot: 'bg-text-dim' },
    }
    const tone = colors[sessionStatus] || { pill: 'bg-surface-hover text-text-muted', dot: 'bg-text-dim' }
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.pill}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${sessionStatus === 'running' || sessionStatus === 'starting' ? 'animate-pulse' : ''}`} />
        {sessionStatus.replace(/_/g, ' ')}
      </span>
    )
  }

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'flex-1 min-w-0'}`}>
      {/* Session Header */}
      <div className="h-10 border-b border-border bg-surface flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10">
            <Terminal className="h-3.5 w-3.5 text-accent" />
          </div>
          <span className="text-sm font-medium truncate">
            {sessionName || `Session ${id?.slice(0, 8)}`}
          </span>
          {statusBadge()}
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-text-dim'}`} title={connected ? 'Connected' : 'Disconnected'} />
        </div>

        <div className="flex items-center gap-1">
          {/* Stop Button — only show for active sessions */}
          {(sessionStatus === 'running' || sessionStatus === 'starting' || sessionStatus === 'waiting_for_input' || sessionStatus === 'idle') && (
            <button
              onClick={() => setShowStopConfirm(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-error/10 hover:bg-error/20 text-error text-xs font-medium transition-colors"
              title="Stop session"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          )}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted transition-colors"
            title="Toggle sidebar"
          >
            <GitBranch className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted transition-colors"
            title="Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Transcript Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <Transcript sessionId={id || ''} />

          {/* Input */}
          <div className="h-14 border-t border-border bg-surface flex items-center px-4 gap-3 shrink-0">
            <div className="flex-1 flex items-center gap-2.5 px-4 py-2 rounded-full bg-terminal-bg border border-border focus-within:border-accent/60 transition-all">
              <span className="text-terminal-green font-mono text-sm">$</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={
                  sessionStatus === 'exited' || sessionStatus === 'archived'
                    ? 'Session ended — create a new session'
                    : 'Type a message or command...'
                }
                disabled={sessionStatus === 'exited' || sessionStatus === 'archived'}
                className="flex-1 bg-transparent text-sm text-terminal-fg placeholder:text-text-dim outline-none font-mono disabled:opacity-40"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || sessionStatus === 'exited' || sessionStatus === 'archived'}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-all hover:bg-accent-hover enabled:active:scale-95 disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Right Sidebar */}
        {showSidebar && (
          <div className="w-64 border-l border-border bg-surface shrink-0 overflow-auto">
            <WorktreePanel sessionId={id || ''} />
          </div>
        )}
      </div>

      {/* Stop Confirmation Modal */}
      {showStopConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-surface rounded-xl border border-border shadow-2xl overflow-hidden animate-fade-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-error" />
                <h2 className="text-base font-semibold">Stop session?</h2>
              </div>
              <button
                onClick={() => setShowStopConfirm(false)}
                className="p-1 rounded hover:bg-surface-hover text-text-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-text-muted leading-relaxed">
                This will terminate the running agent and its PTY process.
                The session history will remain available, but the running process
                will be stopped.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowStopConfirm(false)}
                  disabled={stopping}
                  className="px-4 py-2 rounded-md text-sm font-medium text-text hover:bg-surface-hover border border-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStop}
                  disabled={stopping}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-error hover:bg-error/80 text-white transition-colors disabled:opacity-50"
                >
                  {stopping && <Loader2 className="w-4 h-4 animate-spin" />}
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

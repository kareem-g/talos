import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Terminal,
  Send,
  GitBranch,
  Maximize2,
  Minimize2
} from 'lucide-react'
import { Transcript } from './Transcript'
import { ApprovalCard } from './ApprovalCard'
import { WorktreePanel } from './WorktreePanel'
import { useWebSocket } from '../hooks/useWebSocket'

export function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const [input, setInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const { sendMessage } = useWebSocket()

  useEffect(() => {
    inputRef.current?.focus()
  }, [id])

  const handleSend = () => {
    if (!input.trim() || !id) return
    sendMessage({
      type: 'Input',
      payload: { session_id: id, data: input + '\n' }
    })
    setInput('')
  }

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'flex-1 min-w-0'}`}>
      {/* Session Header */}
      <div className="h-10 border-b border-border bg-surface flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Terminal className="w-4 h-4 text-accent shrink-0" />
          <span className="text-sm font-medium truncate">Session {id?.slice(0, 8)}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/10 text-success font-medium">
            Running
          </span>
        </div>

        <div className="flex items-center gap-1">
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

          {/* Approval Cards */}
          <div className="shrink-0">
            <ApprovalCard 
              request={{
                id: 'test',
                prompt: 'Do you want me to edit src/main.rs?',
                options: ['Yes', 'No', 'Always'],
                riskLevel: 'medium'
              }}
            />
          </div>

          {/* Input */}
          <div className="h-12 border-t border-border bg-surface flex items-center px-4 gap-3 shrink-0">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-terminal-bg border border-border focus-within:border-accent transition-colors">
              <span className="text-terminal-green font-mono text-sm">$</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Type a message or command..."
                className="flex-1 bg-transparent text-sm text-terminal-fg placeholder:text-text-dim outline-none font-mono"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2.5 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:hover:bg-accent text-white transition-colors"
            >
              <Send className="w-4 h-4" />
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
    </div>
  )
}

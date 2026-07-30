import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Terminal,
  Plus,
  Search,
  Settings,
  Wifi,
  WifiOff,
  Command
} from 'lucide-react'
import { useWebSocket } from '../hooks/useWebSocket'
import { useCommandPalette } from '../hooks/useCommands'

export function Header() {
  const navigate = useNavigate()
  const { connected } = useWebSocket()
  const { open } = useCommandPalette()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <header className="h-12 border-b border-border bg-surface flex items-center px-4 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-accent" />
          </div>
          <span className="font-semibold text-sm tracking-tight">AgentDeck</span>
        </div>

        <div className="h-5 w-px bg-border mx-1" />

        <button
          onClick={() => open()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-hover border border-border hover:border-border-hover text-text-muted text-xs transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Command Palette</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface-active text-[10px] font-mono">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </kbd>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-hover">
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-success" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-error" />
          )}
          <span className="text-[11px] text-text-muted">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-md hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Session</span>
        </button>
      </div>
    </header>
  )
}

import { useNavigate } from 'react-router-dom'
import {
  Terminal,
  Plus,
  Search,
  Settings,
  Command,
  Smartphone
} from 'lucide-react'
import { useWebSocket } from '../hooks/useWebSocket'
import { useCommandPalette } from '../hooks/useCommands'

export function Header() {
  const navigate = useNavigate()
  const { connected } = useWebSocket()
  const { open } = useCommandPalette()

  return (
    <header className="h-12 border-b border-border bg-surface flex items-center px-3 sm:px-4 shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-accent" />
          </div>
          <span className="font-semibold text-sm tracking-tight">AgentDeck</span>
        </div>

        <div className="hidden h-5 w-px bg-border mx-1 sm:block" />

        <button
          onClick={() => open()}
          className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface-hover border border-border hover:border-border-hover text-text-muted text-xs transition-colors"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">Command Palette</span>
          <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface-active text-[10px] font-mono">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </kbd>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden items-center gap-1.5 rounded-full bg-surface-hover px-2.5 py-1 xs:flex sm:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-error'}`} />
          <span className="text-[11px] text-text-muted">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-full hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={() => navigate('/pairing')}
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border hover:border-border-hover hover:bg-surface-hover text-text-muted text-xs transition-colors"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Connect mobile</span>
        </button>

        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors sm:px-3"
          title="New session"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Session</span>
        </button>
      </div>
    </header>
  )
}

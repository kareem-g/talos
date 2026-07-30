import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Terminal, Settings, Puzzle } from 'lucide-react'
import { useCommandPalette } from '../hooks/useCommands'

interface CommandItem {
  id: string
  label: string
  description: string
  icon: React.ElementType
  action: () => void
  shortcut?: string
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const commands: CommandItem[] = [
    {
      id: 'new-claude',
      label: 'New Claude Session',
      description: 'Launch a new Claude Code session',
      icon: Terminal,
      action: () => { navigate('/'); close() },
      shortcut: '⌘N',
    },
    {
      id: 'new-codex',
      label: 'New Codex Session',
      description: 'Launch a new Codex CLI session',
      icon: Terminal,
      action: () => { navigate('/'); close() },
    },
    {
      id: 'mcp',
      label: 'Manage MCP Servers',
      description: 'Add, remove, or configure MCP servers',
      icon: Puzzle,
      action: () => { navigate('/mcp'); close() },
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Configure AgentDeck',
      icon: Settings,
      action: () => { navigate('/settings'); close() },
      shortcut: '⌘,',
    },
  ]

  const filtered = commands.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        filtered[selectedIndex]?.action()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filtered, selectedIndex, close])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface rounded-xl border border-border shadow-2xl overflow-hidden animate-fade-in">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-text-dim" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-dim outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-surface-active text-[10px] text-text-dim font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-dim text-sm">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, index) => {
              const Icon = cmd.icon
              const isSelected = index === selectedIndex
              return (
                <button
                  key={cmd.id}
                  onClick={() => cmd.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-accent' : 'text-text-dim'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${isSelected ? 'text-accent' : 'text-text'}`}>
                      {cmd.label}
                    </div>
                    <div className="text-[11px] text-text-dim truncate">{cmd.description}</div>
                  </div>
                  {cmd.shortcut && (
                    <kbd className="px-1.5 py-0.5 rounded bg-surface-active text-[10px] text-text-dim font-mono">
                      {cmd.shortcut}
                    </kbd>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

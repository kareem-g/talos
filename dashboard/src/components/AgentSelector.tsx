import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Agent {
  id: string
  name: string
  icon: string
  available: boolean
}

const agents: Agent[] = [
  { id: 'claude', name: 'Claude Code', icon: '🤖', available: true },
  { id: 'codex', name: 'Codex CLI', icon: '⚡', available: true },
  { id: 'opencode', name: 'OpenCode', icon: '🔧', available: true },
  { id: 'grok', name: 'Grok', icon: '🧠', available: false },
]

interface AgentSelectorProps {
  value: string
  onChange: (agent: string) => void
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selected = agents.find(a => a.id === value) || agents[0]

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-hover border border-border hover:border-border-hover text-sm transition-colors"
      >
        <span>{selected.icon}</span>
        <span className="text-text">{selected.name}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-text-dim transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 rounded-lg border border-border bg-surface shadow-xl z-50 overflow-hidden">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => { onChange(agent.id); setIsOpen(false) }}
              disabled={!agent.available}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                agent.id === value
                  ? 'bg-accent/10 text-accent'
                  : agent.available
                    ? 'hover:bg-surface-hover text-text'
                    : 'text-text-dim cursor-not-allowed'
              }`}
            >
              <span>{agent.icon}</span>
              <span>{agent.name}</span>
              {!agent.available && (
                <span className="ml-auto text-[10px] text-text-dim">Soon</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

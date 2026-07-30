import { useState } from 'react'
import { Puzzle, Play, Square, Plus, Trash2 } from 'lucide-react'

interface McpServer {
  id: string
  name: string
  command: string
  status: 'stopped' | 'running' | 'error'
  socketPath?: string
}

export function MCPManager() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')

  const handleAdd = () => {
    if (!newName || !newCommand) return
    setServers(prev => [...prev, {
      id: crypto.randomUUID(),
      name: newName,
      command: newCommand,
      status: 'stopped',
    }])
    setNewName('')
    setNewCommand('')
    setShowAdd(false)
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="h-12 border-b border-border flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Puzzle className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold">MCP Servers</h2>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Server
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {showAdd && (
          <div className="mb-4 p-4 rounded-lg border border-border bg-surface space-y-3">
            <h3 className="text-sm font-medium">Add MCP Server</h3>
            <input
              type="text"
              placeholder="Name (e.g., filesystem)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-terminal-bg border border-border text-sm text-text outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Command (e.g., npx -y @modelcontextprotocol/server-filesystem /path)"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-terminal-bg border border-border text-sm text-text outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="px-4 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-1.5 rounded-md bg-surface-hover hover:bg-surface-active text-text-muted text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Puzzle className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm">No MCP servers configured</p>
            <p className="text-xs mt-1">Add a server to enable tool use</p>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <div key={server.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface hover:bg-surface-hover transition-colors">
                <div className={`w-2 h-2 rounded-full ${
                  server.status === 'running' ? 'bg-success' :
                  server.status === 'error' ? 'bg-error' :
                  'bg-text-dim'
                }`} />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-text">{server.name}</h4>
                  <p className="text-[11px] text-text-dim font-mono truncate">{server.command}</p>
                </div>
                <div className="flex items-center gap-1">
                  {server.status === 'running' ? (
                    <button className="p-1.5 rounded hover:bg-surface-active text-text-muted hover:text-error transition-colors">
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button className="p-1.5 rounded hover:bg-surface-active text-text-muted hover:text-success transition-colors">
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button className="p-1.5 rounded hover:bg-surface-active text-text-muted hover:text-error transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

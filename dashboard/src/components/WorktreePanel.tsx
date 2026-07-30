import { useState } from 'react'
import { GitBranch, GitMerge, Trash2, ExternalLink } from 'lucide-react'

interface Worktree {
  path: string
  branch: string
  sessionId: string
  status: 'clean' | 'modified' | 'conflict'
}

interface WorktreePanelProps {
  sessionId: string
}

export function WorktreePanel({ sessionId }: WorktreePanelProps) {
  const [worktrees] = useState<Worktree[]>([
    {
      path: '/home/user/.agentdeck/worktrees/agentdeck-abc123',
      branch: 'agentdeck/abc123',
      sessionId,
      status: 'modified',
    }
  ])

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Worktree</h3>
      </div>

      {worktrees.map((wt) => (
        <div key={wt.branch} className="rounded-md border border-border bg-surface-hover p-3 space-y-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-mono text-text truncate">{wt.branch}</span>
          </div>

          <div className="text-[10px] text-text-dim font-mono truncate">
            {wt.path}
          </div>

          <div className="flex items-center gap-1 pt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              wt.status === 'clean' ? 'bg-success' :
              wt.status === 'modified' ? 'bg-warning' :
              'bg-error'
            }`} />
            <span className="text-[10px] text-text-muted capitalize">{wt.status}</span>
          </div>

          <div className="flex gap-1 pt-1">
            <button 
              className="flex-1 flex items-center justify-center gap-1 p-1.5 rounded hover:bg-surface-active text-text-muted hover:text-text transition-colors"
              title="Merge to main"
            >
              <GitMerge className="w-3 h-3" />
            </button>
            <button 
              className="flex-1 flex items-center justify-center gap-1 p-1.5 rounded hover:bg-surface-active text-text-muted hover:text-error transition-colors"
              title="Delete worktree"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button 
              className="flex-1 flex items-center justify-center gap-1 p-1.5 rounded hover:bg-surface-active text-text-muted hover:text-text transition-colors"
              title="Open in editor"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

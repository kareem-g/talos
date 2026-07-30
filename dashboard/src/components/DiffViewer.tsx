import { useState } from 'react'
import { FileCode, ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react'

interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: Array<{ type: 'context' | 'added' | 'removed'; content: string }>
}

interface DiffFile {
  path: string
  hunks: DiffHunk[]
}

interface DiffViewerProps {
  files: DiffFile[]
}

export function DiffViewer({ files }: DiffViewerProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(files.map(f => f.path)))

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {files.map((file) => {
        const isExpanded = expandedFiles.has(file.path)
        const added = file.hunks.flatMap(h => h.lines).filter(l => l.type === 'added').length
        const removed = file.hunks.flatMap(h => h.lines).filter(l => l.type === 'removed').length

        return (
          <div key={file.path} className="rounded-lg border border-border overflow-hidden">
            {/* File Header */}
            <button
              onClick={() => toggleFile(file.path)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-surface-hover hover:bg-surface-active transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-text-dim" />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-dim" />
              )}
              <FileCode className="w-4 h-4 text-accent" />
              <span className="text-sm text-text font-mono truncate">{file.path}</span>
              <div className="flex items-center gap-2 ml-auto">
                {added > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-success">
                    <Plus className="w-3 h-3" />
                    {added}
                  </span>
                )}
                {removed > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-error">
                    <Minus className="w-3 h-3" />
                    {removed}
                  </span>
                )}
              </div>
            </button>

            {/* Diff Content */}
            {isExpanded && (
              <div className="bg-terminal-bg font-mono text-xs overflow-x-auto">
                {file.hunks.map((hunk, hi) => (
                  <div key={hi}>
                    <div className="px-3 py-1 bg-surface text-text-dim border-y border-border">
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                    </div>
                    {hunk.lines.map((line, li) => (
                      <div
                        key={li}
                        className={`px-3 py-0.5 whitespace-pre ${
                          line.type === 'added' ? 'bg-success/10 text-success' :
                          line.type === 'removed' ? 'bg-error/10 text-error' :
                          'text-terminal-fg'
                        }`}
                      >
                        <span className="select-none mr-2 text-text-dim">
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        </span>
                        {line.content}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

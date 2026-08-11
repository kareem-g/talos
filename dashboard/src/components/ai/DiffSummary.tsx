import { useState } from 'react'
import { FileDiff, ChevronDown, Plus, Minus } from 'lucide-react'

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  text: string
}

export interface DiffFile {
  filename: string
  lines: DiffLine[]
}

/**
 * Diff summary adapted from Beautiful UI's Diff Table.
 * Renders a filename header and a readable additions/removals block with an
 * expand/collapse control so long diffs never break a mobile layout.
 */
export function DiffSummary({ files }: { files: DiffFile[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (files.length === 0) return null
  const totalAdd = files.reduce((sum, f) => sum + f.lines.filter((l) => l.type === 'add').length, 0)
  const totalDel = files.reduce((sum, f) => sum + f.lines.filter((l) => l.type === 'remove').length, 0)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface ai-hairline" data-ai-anim>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <FileDiff className="h-3.5 w-3.5 text-success" />
        <span className="text-[12.5px] font-medium text-text">{files.length} file{files.length > 1 ? 's' : ''} changed</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[11px]">
          <span className="flex items-center gap-0.5 text-success"><Plus className="h-3 w-3" />{totalAdd}</span>
          <span className="flex items-center gap-0.5 text-error"><Minus className="h-3 w-3" />{totalDel}</span>
        </span>
      </div>
      <div className="divide-y divide-border/60">
        {files.map((file) => {
          const isOpen = open[file.filename]
          return (
            <div key={file.filename}>
              <button
                onClick={() => setOpen((prev) => ({ ...prev, [file.filename]: !isOpen }))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11.5px] text-text-muted transition-colors hover:bg-surface-hover"
                aria-expanded={Boolean(isOpen)}
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                <span className="min-w-0 flex-1 truncate">{file.filename}</span>
              </button>
              {isOpen && (
                <div className="border-t border-border/40 px-3 py-2">
                  <pre className="ai-scroll-thin overflow-x-auto font-mono text-[11px] leading-5">
                    {file.lines.map((line, index) => (
                      <div
                        key={index}
                        className={`whitespace-pre pr-2 ${line.type === 'add' ? 'bg-success/10 text-success' : line.type === 'remove' ? 'bg-error/10 text-error' : 'text-text-muted'}`}
                      >
                        <span className="mr-2 inline-block w-3 select-none">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                        {line.text}
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
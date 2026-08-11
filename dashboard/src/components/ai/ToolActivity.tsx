import { Check, Loader2, X, ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'

/**
 * Compact tool-activity rows adapted from Beautiful UI's Tool Chips.
 * Each activity shows an icon, a label (e.g. "Editing src/App.tsx") and a
 * running / completed / failed state. Rows can expand to reveal a detail line.
 */

export type ToolState = 'running' | 'completed' | 'failed' | 'pending'

export interface ToolActivityItem {
  id: string
  label: string
  state: ToolState
  detail?: string
  duration?: string
  icon?: 'search' | 'edit' | 'read' | 'command' | 'tool'
  timestamp?: string
}

function stateVisual(state: ToolState) {
  switch (state) {
    case 'running':
      return { chip: 'border-accent/25 bg-accent/10 text-accent', label: 'Running', Icon: Loader2, spin: true }
    case 'failed':
      return { chip: 'border-error/25 bg-error/10 text-error', label: 'Failed', Icon: X, spin: false }
    case 'pending':
      return { chip: 'border-border bg-surface-hover text-text-muted', label: 'Queued', Icon: null, spin: false }
    default:
      return { chip: 'border-success/25 bg-success/10 text-success', label: 'Completed', Icon: Check, spin: false }
  }
}

function kindIcon(kind?: ToolActivityItem['icon']) {
  switch (kind) {
    case 'search':
      return <Search className="h-3.5 w-3.5" />
    case 'command':
      return <span className="font-mono text-[11px]">$</span>
    default:
      return <span className="block h-1.5 w-1.5 rounded-full bg-text-muted" />
  }
}

export function ToolActivityRow({ item, index }: { item: ToolActivityItem; index: number }) {
  const [open, setOpen] = useState(false)
  const visual = stateVisual(item.state)
  const hasDetail = Boolean(item.detail)
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
      data-ai-anim
      style={{ animation: `ai-fade-up 220ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index * 45, 400)}ms both` }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted">
        {kindIcon(item.icon)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{item.label}</span>
      {item.duration && <span className="shrink-0 font-mono text-[10.5px] text-text-dim">{item.duration}</span>}
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${visual.chip}`}>
        {visual.Icon && <visual.Icon className={`h-3 w-3 ${visual.spin ? 'animate-spin' : ''}`} />}
        {visual.label}
      </span>
      {hasDetail && (
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover"
          aria-label={open ? 'Collapse details' : 'Expand details'}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && hasDetail && (
        <div className="col-span-full mt-1 w-full border-t border-border/60 pt-1.5 font-mono text-[11.5px] leading-5 text-text-muted">
          <pre className="whitespace-pre-wrap break-words rounded-md bg-background/50 p-2">{item.detail}</pre>
        </div>
      )}
    </div>
  )
}

export function ToolActivityFeed({ items }: { items: ToolActivityItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <ToolActivityRow key={item.id} item={item} index={index} />
      ))}
    </div>
  )
}
/**
 * ProgressCard — the plan-checklist card.
 *
 * Renders "Progress X/Y" with one row per plan step and a status icon:
 *   ✓ completed, → in-progress (active), ○ pending, ⚠ blocked/failed.
 * The active step is highlighted. Used both as the floating contexture menu
 * over the timeline and inside the right-pane Plan tab.
 *
 * The header's pin toggles the list collapsed; the ⋯ menu is a small action
 * popover (refresh / open the plan).
 */

import { useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react'
import { DropdownList } from '@/components/ui'
import { cn } from '@/lib/format'
import { useWorkspaceStats, type TaskStatus, type TodoItem } from './workspaceData'
import type { Session } from '@/types/session'

export function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'completed':
      return <Check size={12} strokeWidth={3} className="text-green" />
    case 'in_progress':
      return <ArrowRight size={12} className="text-ink" />
    case 'blocked':
      return <AlertTriangle size={12} className="text-orange" />
    case 'failed':
      return <AlertTriangle size={12} className="text-red" />
    default:
      return <Circle size={11} className="text-ink-3" />
  }
}

/** The plan step list shared by the card, the floating menu and the Plan tab. */
export function PlanStepList({
  todos,
  onToggle,
  onRetry,
}: {
  todos: TodoItem[]
  onToggle?: (id: string) => void
  onRetry?: (title: string) => void
}) {
  if (todos.length === 0) {
    return (
      <p className="px-2 py-3 text-[11px] leading-snug text-ink-3">
        No plan yet — ask the agent to plan work.
      </p>
    )
  }
  return (
    <ol className="space-y-0.5">
      {todos.map((todo, idx) => {
        const active = todo.status === 'in_progress'
        const doneRow = todo.status === 'completed'
        const isBlocked = todo.status === 'blocked' || todo.status === 'failed'
        return (
          <li
            key={todo.id}
            className={cn('flex items-start gap-2 rounded-lg px-2 py-1', active && 'bg-hover-2')}
          >
            <button
              type="button"
              onClick={() => onToggle?.(todo.id)}
              disabled={!onToggle}
              aria-label={doneRow ? 'Mark not done' : 'Mark done'}
              className="mt-0.5 shrink-0"
            >
              <StatusIcon status={todo.status} />
            </button>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[11.5px] leading-snug',
                doneRow ? 'text-ink-3 line-through' : active ? 'font-medium text-ink' : 'text-ink',
              )}
            >
              {idx + 1}. {todo.title}
            </span>
            {isBlocked && onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(todo.title)}
                title={`Retry: ${todo.title}`}
                className="shrink-0 rounded-md p-1 text-ink-3 transition hover:bg-hover-2 hover:text-ink"
              >
                <RefreshCw size={11} />
              </button>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function ProgressCard({ session }: { session: Session }) {
  const stats = useWorkspaceStats(session)
  const todos = stats.todos
  const done = stats.done
  const total = todos.length

  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="flex flex-col overscroll-contain rounded-card border border-line/70 bg-hover shadow-overlay">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line/50 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Progress</span>
        <span className="font-mono text-[10px] tabular-nums text-ink-3">
          {done}/{total}
        </span>
        <span className="flex-1" />
        <button
          ref={moreRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More progress actions"
          title="More actions"
          className="flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand progress' : 'Collapse progress'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand progress' : 'Collapse progress'}
          className="flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <ChevronDown size={14} className={cn('transition-transform duration-200', collapsed && '-rotate-90')} />
        </button>

        {menuOpen ? (
          <DropdownList anchorRef={moreRef} onClose={() => setMenuOpen(false)} width={220}>
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setCollapsed(false)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11.5px] text-ink hover:bg-hover-2"
              >
                <RefreshCw size={12} className="text-ink-3" /> Expand steps
              </button>
            </div>
          </DropdownList>
        ) : null}
      </div>

      {/* Steps */}
      {collapsed ? null : (
        <div className="scroll-thin max-h-[260px] min-h-0 overflow-y-auto p-1.5">
          <PlanStepList todos={todos} />
        </div>
      )}
    </div>
  )
}

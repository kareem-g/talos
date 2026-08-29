/**
 * SubagentsStrip — a live row of running-subagent chips above the composer.
 *
 * Surfaces only the subagents the agent actually spawned in THIS session (from
 * `Subagent`/`Agent` tool parts in the transcript). No workspace-session
 * fallback: the workspace's other sessions are not subagents and have no place
 * in this strip. Clicking a chip opens the Agents tab in the right panel.
 *
 * Renders nothing when there is no active subagent — additive, zero-footprint.
 */

import { Bot } from 'lucide-react'
import { getConversation } from '@/store'
import { cn } from '@/lib/format'
import { deriveSubagents, type AgentStatus } from './workspaceData'
import type { Session } from '@/types/session'

const STATUS_META: Record<string, { label: string; dot: string; text: string; pulse?: boolean }> = {
  thinking: { label: 'Thinking', dot: 'bg-green', text: 'text-green', pulse: true },
  working: { label: 'Working', dot: 'bg-green', text: 'text-green', pulse: true },
  waiting: { label: 'Waiting', dot: 'bg-orange', text: 'text-orange' },
  blocked: { label: 'Blocked', dot: 'bg-orange', text: 'text-orange' },
  failed: { label: 'Failed', dot: 'bg-red', text: 'text-red' },
  completed: { label: 'Done', dot: 'bg-green', text: 'text-green' },
  paused: { label: 'Paused', dot: 'bg-orange', text: 'text-orange' },
  idle: { label: 'Idle', dot: 'bg-ink-3/60', text: 'text-ink-3' },
}

export function SubagentsStrip({
  session,
  onOpenAgentPanel,
}: {
  session: Session
  /** Open the Agents tab in the right Agent Workspace pane. */
  onOpenAgentPanel?: () => void
}) {
  const derived = deriveSubagents(getConversation(session.id).messages)
  const items = derived.map((a) => ({ id: a.id, name: a.name, status: a.status as AgentStatus, kind: a.kind }))

  if (items.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line/40 bg-surface/70 px-4 py-1.5">
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-3">
        <Bot size={12} /> Running
      </span>
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {items.map((agent) => {
          const meta = STATUS_META[agent.status] ?? STATUS_META.idle
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onOpenAgentPanel?.()}
              title={`${agent.name} — ${meta.label}. Open Agents panel`}
              aria-label={`Open Agents panel for ${agent.name}`}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-line/50 bg-surface px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot, meta.pulse && 'breathe')} aria-hidden />
              <span className="max-w-[140px] truncate">{agent.name}</span>
              {agent.kind ? <span className="shrink-0 font-mono text-[8.5px] uppercase text-ink-3">{agent.kind}</span> : null}
              <span className={cn('shrink-0 font-mono text-[9px] uppercase', meta.text)}>{meta.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

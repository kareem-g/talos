/**
 * UsagePage — the Manage › Usage destination.
 *
 * Real accounting, scanned from the conversations themselves: every turn's
 * `usage` part (input / output / cost, when the agent reports it) is summed
 * per session, with a fleet total up top. Sessions with no reported usage
 * stay visible at zero — an agent that does not report cannot be billed here.
 */

import { BarChart3 } from 'lucide-react'
import { cn } from '@/lib/format'
import { getConversation } from '@/store'
import { isInternalSession } from '@/lib/sessionState'
import { useStore } from '@/store'

interface UsageRow {
  sessionId: string
  name: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function scanUsage(sessionId: string): { inputTokens: number; outputTokens: number; costUsd: number } {
  const conversation = getConversation(sessionId)
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  for (const message of conversation.messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind !== 'usage') continue
      inputTokens += part.inputTokens ?? 0
      outputTokens += part.outputTokens ?? 0
      costUsd += part.costUsd ?? 0
    }
  }
  return { inputTokens, outputTokens, costUsd }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

function formatCost(cost: number): string {
  if (cost <= 0) return '—'
  return cost < 0.01 ? '< $0.01' : `$${cost.toFixed(2)}`
}

export function UsagePage({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const sessions = useStore((state) => state.sessions)

  const rows: UsageRow[] = sessions
    .filter((session) => session.status !== 'archived' && !isInternalSession(session))
    .map((session) => {
      const usage = scanUsage(session.id)
      return { sessionId: session.id, name: session.name, ...usage }
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))

  const totals = rows.reduce(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      costUsd: sum.costUsd + row.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  )

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-tint">
          <BarChart3 size={14} className="text-accent" />
        </span>
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Usage</h1>
      </header>

      {/* Fleet total — the only number that matters at a glance. */}
      <dl className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-hairline">
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">Tokens in</dt>
          <dd className="mt-1 text-[20px] font-semibold tabular-nums text-ink">
            {formatTokens(totals.inputTokens)}
          </dd>
        </div>
        <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-hairline">
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">Tokens out</dt>
          <dd className="mt-1 text-[20px] font-semibold tabular-nums text-ink">
            {formatTokens(totals.outputTokens)}
          </dd>
        </div>
        <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-hairline">
          <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">Cost</dt>
          <dd className="mt-1 text-[20px] font-semibold tabular-nums text-ink">
            {formatCost(totals.costUsd)}
          </dd>
        </div>
      </dl>

      <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-hairline">
        {rows.length === 0 ? (
          <li className="p-6 text-center text-[12px] text-ink-3">No sessions yet.</li>
        ) : (
          rows.map((row, index) => (
            <li key={row.sessionId} className={cn(index > 0 && 'border-t border-line/50')}>
              <button
                type="button"
                onClick={() => onOpenSession(row.sessionId)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{row.name}</span>
                  <span className="block font-mono text-[10.5px] text-ink-3">
                    {formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-2">
                  {formatCost(row.costUsd)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

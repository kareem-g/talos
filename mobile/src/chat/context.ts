/**
 * Context-window accounting — the phone's half of the desktop's context ring.
 *
 * The desktop draws a small ring on the composer showing how full the model's
 * context window is; tapping it opens the token breakdown. The phone gets the
 * same numbers from the same place: the newest `usage` part in the transcript,
 * with the window size the daemon reports for the session's engine.
 *
 * Nothing here invents a number — a missing window means "unknown", and the
 * ring says so by drawing an empty track rather than a fabricated percentage.
 */

import type { MobileAgent } from '@/store'
import type { Session } from '@/types/session'
import type { Conversation } from '@/types/conversation'

export interface ContextUsage {
  /** Tokens the model was sent on the last turn (prompt + cache reads). */
  usedTokens: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  costUsd?: number
  /** The engine's context window, when it reports one. */
  windowTokens?: number
  /** 0–100, only when both a window and a used count are known. */
  percent?: number
}

/** The newest usage the agent reported, or undefined when it never has. */
export function contextUsageFor(
  conversation: Conversation | undefined,
  session: Session | undefined,
  agents: MobileAgent[],
): ContextUsage | undefined {
  if (!conversation) return undefined

  let newest: { input: number; output?: number; cache?: number; cost?: number } | undefined
  for (let m = conversation.messages.length - 1; m >= 0 && !newest; m--) {
    const parts = conversation.messages[m].parts
    for (let p = parts.length - 1; p >= 0; p--) {
      const part = parts[p] as {
        kind: string
        inputTokens?: number
        outputTokens?: number
        cacheReadTokens?: number
        costUsd?: number
      }
      if (part.kind !== 'usage' && part.kind !== 'turn_summary') continue
      if (part.inputTokens === undefined && part.outputTokens === undefined) continue
      newest = {
        input: part.inputTokens ?? 0,
        output: part.outputTokens,
        cache: part.cacheReadTokens,
        cost: part.costUsd,
      }
      break
    }
  }
  if (!newest) return undefined

  const usedTokens = newest.input + (newest.cache ?? 0)
  const windowTokens = session ? agentWindow(agents, session.agent) : undefined
  const percent =
    windowTokens && windowTokens > 0 && usedTokens > 0
      ? Math.min(100, (usedTokens / windowTokens) * 100)
      : undefined

  return {
    usedTokens,
    inputTokens: newest.input,
    outputTokens: newest.output,
    cacheReadTokens: newest.cache,
    costUsd: newest.cost,
    windowTokens,
    percent,
  }
}

/**
 * The engine's advertised context window. Agents report their dimensions on the
 * agents endpoint; the window arrives as `context_windows` keyed by model, so a
 * session without a model reported yet simply has no window.
 */
function agentWindow(agents: MobileAgent[], agentId: string): number | undefined {
  const agent = agents.find((row) => row.id === agentId)
  if (!agent) return undefined
  if (typeof agent.contextWindow === 'number') return agent.contextWindow
  const windows = agent.context_windows
  if (!windows || typeof windows !== 'object') return undefined
  const values = Object.values(windows as Record<string, unknown>).filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  return values.length > 0 ? Math.max(...values) : undefined
}

/** `12.4k` / `242k` — the desktop's token shorthand. */
export function formatTokens(value: number | undefined): string {
  if (value === undefined || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) {
    const thousands = value / 1000
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}
/**
 * Session view derivations — pure reads over a conversation.
 *
 * These answer the questions the Plan / Agents / Goal rail tabs ask: what is the
 * newest plan, what did the user actually ask for, which subagents were spawned,
 * did the last assistant turn fail?
 *
 * They live here rather than beside the rail component because they are pure and
 * platform-neutral — no hooks, no icons, no store — which is the same seam the
 * desktop keeps (`workspaceData.ts`). The desktop module could not simply be
 * imported: it reaches into the desktop store and the DOM-backed API client.
 */

import type { FileChangePart, Message, ToolPart } from '@/types/conversation'

export interface PlanInfo {
  title?: string
  /** Files the agent changed in the same message after producing the plan. */
  relatedFiles: string[]
  stepCount: number
  /** The full plan body (markdown) the agent wrote, when it reported one. */
  text?: string
  steps: string[]
  entries?: Array<{ content: string; status?: string }>
}

/** Metadata about the newest plan part, for the Plan view's header. */
export function latestPlanInfo(messages: Message[]): PlanInfo | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const planIndex = message.parts.findIndex((part) => part.kind === 'plan')
    if (planIndex === -1) continue
    const plan = message.parts[planIndex] as {
      title?: string
      steps: string[]
      text?: string
      entries?: Array<{ content: string; status?: string }>
    }
    const relatedFiles = message.parts
      .slice(planIndex + 1)
      .filter((part): part is FileChangePart => part.kind === 'file')
      .map((part) => part.path)
    return {
      title: plan.title,
      relatedFiles,
      stepCount: plan.steps.length,
      text: plan.text,
      steps: plan.steps,
      entries: plan.entries,
    }
  }
  return undefined
}

/** The newest user prompt's text — the plan's objective, when present. */
export function latestUserPrompt(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const text = message.parts
      .filter((part) => part.kind === 'text')
      .map((part) => (part as { text: string }).text)
      .join(' ')
      .trim()
    if (text) return text
  }
  return undefined
}

/** Whether the newest assistant turn ended in an error. */
export function hasRecentError(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'assistant') continue
    return messages[index].parts.some((part) => part.kind === 'error')
  }
  return false
}

export interface DerivedSubagent {
  id: string
  /** Human task label (the tool's `description`). */
  name: string
  /** `subagent_type` from the tool input, when present. */
  kind: string
  status: 'working' | 'completed' | 'failed'
}

/**
 * Subagents the agent actually spawned, read from the transcript: first-class
 * subagent events when the backend forwards them, otherwise `Agent`/`Task` tool
 * invocations carrying a `description`.
 */
export function deriveSubagents(messages: Message[]): DerivedSubagent[] {
  const out: DerivedSubagent[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind === 'subagent') {
        out.push({
          id: part.id,
          name: part.name,
          kind: part.kindType,
          status:
            part.status === 'running' ? 'working' : part.status === 'cancelled' ? 'failed' : part.status,
        })
        continue
      }
      if (part.kind !== 'tool') continue
      const tool: ToolPart = part
      let input: Record<string, unknown> = {}
      try {
        const parsed = tool.input ? JSON.parse(tool.input) : null
        if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
      } catch {
        // Non-JSON tool input carries no subagent metadata.
        continue
      }
      const description = typeof input.description === 'string' ? input.description : undefined
      const isSubagent =
        tool.name === 'Agent' || tool.name === 'Task' || (description !== undefined && 'prompt' in input)
      if (!isSubagent || !description) continue
      out.push({
        id: tool.toolId,
        name: description,
        kind: typeof input.subagent_type === 'string' ? input.subagent_type : 'agent',
        status: tool.status === 'running' ? 'working' : tool.status === 'failed' ? 'failed' : 'completed',
      })
    }
  }
  return out
}

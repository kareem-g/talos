import type { MessagePartStreamStatus, ThreadMessageLike } from '@assistant-ui/react'
import type { ChatItem } from './chatItems'
import { formatDuration } from './chatItems'
import type { MobileAgentEvent, MobileApproval, MobileQuestion } from '../types/mobile'

/**
 * Converts the shared semantic chat model (ChatItems folded from persisted
 * history + live WebSocket frames) into assistant-ui ThreadMessages.
 *
 * The core promise of this app is streaming: the same items that previously
 * rendered as one-off blocks now fold into a single growing assistant message
 * per turn. Assistant text chunks merge into one text part, tool-start /
 * tool-finish pairs collapse into one tool-call part that resolves in place,
 * and questions, approvals, diffs, plans and system notes ride along as data
 * parts. Every rebuild is derived — ids stay stable across frames, so the
 * thread reconciles incrementally and the travelling caret reflects what the
 * agent is actually printing right now.
 *
 * The builder works on a local mutable model (parts must grow in place while
 * the stream is folding: text accumulates, tool results resolve) and is
 * cast to the readonly ThreadMessageLike shape at the boundary.
 */

export interface TaskThreadContext {
  items: ChatItem[]
  optimistic: Array<{ id: string; content: string }>
  working: boolean
  /** id of the live ChatItem currently streaming — drives the caret. */
  streamingId: string | null
  /** approvals rendered in the action zone below the composer — not in-thread. */
  pendingApprovalIds: Set<string>
  /** questions rendered in the action zone below the composer. */
  pendingQuestionIds: Set<string>
  /** request_id -> decision for approvals already resolved by the user. */
  resolvedDecisionById: Map<string, string>
  /** raw agent events keyed by ChatItem id (`history-event-N` / `event-N`). */
  rawEvents: Map<string, MobileAgentEvent>
}

interface MutableTextPart {
  type: 'text'
  text: string
  status?: MessagePartStreamStatus
}

interface MutableReasoningPart {
  type: 'reasoning'
  text: string
  status?: MessagePartStreamStatus
}

interface MutableToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  argsText: string
  result?: { success?: boolean; output?: unknown; exit_code?: number; duration?: string }
  isError?: boolean
  status?: MessagePartStreamStatus
}

interface MutableDataPart {
  type: 'data'
  name: string
  data: Record<string, unknown>
}

type MutablePart = MutableTextPart | MutableReasoningPart | MutableToolCallPart | MutableDataPart

interface MutableMessage {
  id: string
  role: 'assistant' | 'user'
  content: MutablePart[]
  createdAt: Date
  status?:
    | { type: 'running' }
    | { type: 'requires-action'; reason: 'interrupt' }
    | { type: 'complete'; reason: 'stop' }
}

const eventNumber = (id: string) => {
  const match = /^(?:history-)?event-(\d+)/.exec(id)
  return match ? Number(match[1]) : null
}

export function buildThreadMessages(context: TaskThreadContext): ThreadMessageLike[] {
  const {
    items,
    optimistic,
    working,
    streamingId,
    pendingApprovalIds,
    pendingQuestionIds,
    resolvedDecisionById,
    rawEvents,
  } = context

  const messages: MutableMessage[] = []
  const seenEventIds = new Set<number>()

  let current: MutableMessage | null = null
  let lastTextPart: MutableTextPart | null = null
  // In-flight tool calls keyed by tool_id (falls back to name for legacy events).
  const openTools = new Map<string, MutableToolCallPart>()
  // Reasoning is a distinct in-thread block; hold the running block to complete it.
  let openReasoning: MutableReasoningPart | null = null

  const startTurn = (id: string) => {
    const message: MutableMessage = {
      id,
      role: 'assistant',
      content: [],
      createdAt: new Date(),
      status: { type: 'running' },
    }
    messages.push(message)
    current = message
    lastTextPart = null
    openReasoning = null
    return message
  }

  const ensureTurn = (id: string) => {
    if (!current) startTurn(id)
    return current as MutableMessage
  }

  const syncRunning = (item: ChatItem) => {
    if (!current) return
    current.status = working && item.id === streamingId ? { type: 'running' } : { type: 'complete', reason: 'stop' }
  }

  const textStatus = (item: ChatItem): MessagePartStreamStatus =>
    working && item.id === streamingId ? { type: 'running' } : { type: 'complete' }

  for (const item of items) {
    const eventId = eventNumber(item.id)
    if (eventId !== null) {
      if (seenEventIds.has(eventId)) continue
      seenEventIds.add(eventId)
    }
    const raw = rawEvents.get(item.id)

    switch (item.kind) {
      case 'user': {
        messages.push({
          id: item.id,
          role: 'user',
          content: [{ type: 'text', text: item.content }],
          createdAt: createItemDate(item.timestamp),
        })
        current = null
        lastTextPart = null
        openReasoning = null
        break
      }

      case 'agent': {
        const isDelta = raw?.payload?.delta === true
        if (lastTextPart) {
          if (item.content === lastTextPart.text || lastTextPart.text.endsWith(item.content)) {
            break
          }
          if (isDelta) {
            lastTextPart.text += item.content
          } else if (item.content.startsWith(lastTextPart.text)) {
            // Transcript frames are complete snapshots, while PTY frames are
            // deltas. Replace a partial PTY render with the authoritative
            // final transcript rather than appending it a second time.
            lastTextPart.text = item.content
          } else {
            const separator = lastTextPart.text.endsWith('\n') || item.content.startsWith('\n') ? '' : '\n'
            lastTextPart.text += `${separator}${item.content}`
          }
          lastTextPart.status = textStatus(item)
        } else {
          const message = ensureTurn(item.id)
          const part: MutableTextPart = { type: 'text', text: item.content, status: textStatus(item) }
          lastTextPart = part
          message.content.push(part)
        }
        syncRunning(item)
        break
      }

      case 'thinking': {
        const finished = /for|results|completed/i.test(item.title || '')
        if (finished && openReasoning) {
          openReasoning.text = item.title || 'Thought'
          openReasoning.status = { type: 'complete' }
          openReasoning = null
        } else {
          const reasoning: MutableReasoningPart = {
            type: 'reasoning',
            text: item.title || 'Thinking',
            status: finished ? { type: 'complete' } : { type: 'running' },
          }
          if (!finished) openReasoning = reasoning
          ensureTurn(item.id).content.push(reasoning)
        }
        syncRunning(item)
        break
      }

      case 'activity': {
        const part = raw ? activityPart(raw, item, openTools) : activityData(item)
        if (part) {
          ensureTurn(item.id).content.push(part)
        }
        syncRunning(item)
        break
      }

      case 'plan':
      case 'diff': {
        if (item.kind === 'plan' || (raw && item.kind === 'diff')) {
          const part = raw ? activityPart(raw, item, openTools) : null
          if (part) {
            ensureTurn(item.id).content.push(part)
          }
        } else if (item.kind === 'diff') {
          const data: MutableDataPart = {
            type: 'data',
            name: 'agent-diff',
            data: { path: 'file', success: true },
          }
          ensureTurn(item.id).content.push(data)
        }
        syncRunning(item)
        break
      }

      case 'approval': {
        const approval: MobileApproval | undefined = item.approval
        if (!approval) break
        if (!current && !hasUserMessage(messages)) break
        const pending = pendingApprovalIds.has(approval.id)
        const message = ensureTurn(item.id)
        message.content.push({
          type: 'data',
          name: 'agent-approval',
          data: {
            approval,
            pending,
            decision: resolvedDecisionById.get(approval.id) || null,
          },
        })
        message.status = pending
          ? { type: 'requires-action', reason: 'interrupt' }
          : { type: 'complete', reason: 'stop' }
        break
      }

      case 'question': {
        const question: MobileQuestion | undefined = item.question
        if (!question) break
        if (!current && !hasUserMessage(messages)) break
        const pending = pendingQuestionIds.has(question.question_id)
        const message = ensureTurn(item.id)
        message.content.push({
          type: 'data',
          name: 'agent-question',
          data: { question, pending, answered: question.status === 'answered' },
        })
        message.status = pending
          ? { type: 'requires-action', reason: 'interrupt' }
          : { type: 'complete', reason: 'stop' }
        break
      }

      case 'system': {
        if (!current && !hasUserMessage(messages)) break
        ensureTurn(item.id).content.push({
          type: 'data',
          name: 'agent-system',
          data: { content: item.content, isError: item.id.includes('error') || /error/i.test(item.content) },
        })
        syncRunning(item)
        break
      }
    }
  }

  // Optimistic user messages render the instant the user hits send, then
  // self-expire once the matching real message arrives (matched by normalized
  // text upstream, mirroring the pre-runtime behavior).
  for (const entry of optimistic) {
    messages.push({
      id: entry.id,
      role: 'user',
      content: [{ type: 'text', text: entry.content }],
      createdAt: new Date(),
    })
  }

  const tail = [...messages].reverse().find((message) => message.role === 'assistant')
  if (tail?.status?.type === 'running' && !working) {
    tail.status = { type: 'complete', reason: 'stop' }
  }

  // The session switches to running immediately after a user send. Until the
  // first semantic event arrives, expose a real assistant-ui running message
  // so the thread is never visually silent.
  if (working && messages[messages.length - 1]?.role === 'user') {
    messages.push({
      id: `generating-${messages[messages.length - 1].id}`,
      role: 'assistant',
      content: [],
      createdAt: new Date(),
      status: { type: 'running' },
    })
  }
  return messages as unknown as ThreadMessageLike[]
}

function hasUserMessage(messages: MutableMessage[]) {
  return messages.some((message) => message.role === 'user')
}

function createItemDate(timestamp?: string) {
  const time = timestamp ? new Date(timestamp).getTime() : Number.NaN
  return Number.isFinite(time) ? new Date(time) : new Date()
}

function activityData(item: ChatItem): MutableDataPart {
  return {
    type: 'data',
    name: 'agent-activity',
    data: {
      title: item.title || 'Agent activity',
      detail: item.detail,
    },
  }
}

/**
 * Derives a tool-call / reasoning / diff / plan part from a raw semantic
 * event, pairing started/finished events through the openTools map. Finished
 * events resolve their already-pushed part in place and return null (no new
 * part is produced), matching how the previous ToolChips run collapsed pairs.
 */
function activityPart(
  event: MobileAgentEvent,
  item: ChatItem,
  openTools: Map<string, MutableToolCallPart>,
): MutablePart | null {
  const payload = event.payload || {}
  const toolId = String(payload.tool_id || '')
  const toolName = String(payload.tool_name || 'Tool')
  const duration = typeof event.duration_ms === 'number' ? formatDuration(event.duration_ms) : ''
  const lookupKey = (name: string) => openTools.get(toolId || `anon-${name}`) || undefined

  switch (event.kind) {
    case 'tool_started': {
      const part: MutableToolCallPart = {
        type: 'tool-call',
        toolCallId: toolId || `call-${item.id}`,
        toolName,
        args: payload.input && typeof payload.input === 'object'
          ? (payload.input as Record<string, unknown>)
          : { input: payload.input },
        argsText: payload.input ? JSON.stringify(payload.input) : '{}',
        status: { type: 'running' },
      }
      openTools.set(toolId || `anon-${toolName}`, part)
      return part
    }
    case 'tool_finished': {
      const part = lookupKey(toolName)
      if (!part) return null
      part.result = { success: payload.success === true ? true : payload.success === false ? false : undefined, output: payload.output, duration }
      part.isError = payload.success === false
      part.status = { type: 'complete' }
      return null
    }
    case 'command_started': {
      const part: MutableToolCallPart = {
        type: 'tool-call',
        toolCallId: toolId || `cmd-${item.id}`,
        toolName: 'bash',
        args: { command: payload.command },
        argsText: payload.command ? JSON.stringify({ command: payload.command }) : '{}',
        status: { type: 'running' },
      }
      openTools.set(toolId || 'cmd-bash', part)
      return part
    }
    case 'command_finished': {
      const part = openTools.get(toolId || 'cmd-bash')
      if (!part) return null
      part.result = { success: payload.exit_code === 0, exit_code: typeof payload.exit_code === 'number' ? payload.exit_code : undefined, duration }
      part.isError = payload.exit_code !== 0
      part.status = { type: 'complete' }
      return null
    }
    case 'tool_activity': {
      return {
        type: 'data',
        name: 'agent-activity',
        data: { title: toolName, detail: payload.input ? JSON.stringify(payload.input) : undefined },
      }
    }
    case 'file_edited': {
      const data: MutableDataPart = {
        type: 'data',
        name: 'agent-diff',
        data: {
          path: String(payload.path || 'file'),
          additions: typeof payload.additions === 'number' ? payload.additions : undefined,
          deletions: typeof payload.deletions === 'number' ? payload.deletions : undefined,
          success: payload.success,
        },
      }
      return data
    }
    case 'plan': {
      return {
        type: 'data',
        name: 'agent-plan',
        data: {
          title: String(payload.title || 'Plan'),
          steps: Array.isArray(payload.steps) ? payload.steps.map(String) : [],
        },
      }
    }
    case 'thinking_started':
      return {
        type: 'reasoning',
        text: toolName || 'Thinking',
        status: { type: 'running' },
      }
    case 'thinking_finished':
      return {
        type: 'reasoning',
        text: `${toolName}${duration ? ` · ${duration}` : ''}`,
        status: { type: 'complete' },
      }
    default:
      return null
  }
}

/** Reindexes ChatItem ids to the raw agent events that produced them. */
export function eventIndexByItemId(
  historyEvents: MobileAgentEvent[],
  liveFrames: Array<{ event_id?: number; type: string; payload?: Record<string, unknown> }>,
): Map<string, MobileAgentEvent> {
  const index = new Map<string, MobileAgentEvent>()
  for (const event of historyEvents) {
    index.set(`history-event-${event.event_id}`, event)
  }
  for (const frame of liveFrames) {
    if (frame.type !== 'AgentEvent' || typeof frame.event_id !== 'number') continue
    const event = frame.payload?.event as MobileAgentEvent | undefined
    if (event) index.set(`event-${frame.event_id}`, event)
  }
  return index
}

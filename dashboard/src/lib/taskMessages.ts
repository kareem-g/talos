import type { MessagePartStreamStatus, ThreadMessageLike } from '@assistant-ui/react'
import type { ChatItem } from './chatItems'
import { normalizedText } from './terminalText'
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
  /**
   * True in the window right after the user hits Send, before the backend has
   * reported the session as running. Renders the ✦ Thinking… placeholder
   * assistant message immediately instead of leaving a silent gap.
   */
  optimisticRunning?: boolean
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
  /** Generation metadata, persisted across reloads via the assistant-ui runtime. */
  metadata?: {
    custom?: {
      /** Wall-clock milliseconds of the generation (last event minus first). 0 when unknown. */
      durationMs?: number
      /** How the generation ended. Drives the post-generation status line. */
      status?: 'completed' | 'failed'
    }
  }
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
    optimisticRunning = false,
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
  // Tool-call ids already emitted this build. assistant-ui's runtime requires
  // every tool-call part to carry a globally unique toolCallId, so when the
  // agent reuses a tool_id (a tool that finishes then runs again, or a start
  // event delivered twice) we disambiguate instead of pushing a duplicate part.
  const usedToolCallIds = new Set<string>()
  const uniqueToolCallId = (base: string): string => {
    if (!usedToolCallIds.has(base)) {
      usedToolCallIds.add(base)
      return base
    }
    let n = 1
    while (usedToolCallIds.has(`${base}#${n}`)) n++
    const id = `${base}#${n}`
    usedToolCallIds.add(id)
    return id
  }
  // Reasoning is a distinct in-thread block; hold the running block to complete it.
  let openReasoning: MutableReasoningPart | null = null

  // Per-turn generation timing, derived purely from the persisted event
  // timestamps of the items that make up the assistant turn. Used to compute a
  // reload-safe duration that is attached to the message metadata.
  let turnStartEpoch: number | null = null
  let turnEndEpoch: number | null = null
  let turnHasError = false

  const recordTurnTiming = (item: ChatItem) => {
    if (!current) return
    const epoch = item.timestamp ? new Date(item.timestamp).getTime() : NaN
    if (Number.isFinite(epoch)) {
      if (turnStartEpoch === null) turnStartEpoch = epoch
      turnEndEpoch = epoch
    }
    if (item.kind === 'system' && (item.id.includes('error') || /error/i.test(item.content))) {
      turnHasError = true
    }
  }

  // Finalize the outgoing assistant turn: compute its wall-clock duration from
  // the first-to-last event timestamps and persist it to message metadata so it
  // survives reloads. Resets the per-turn trackers for the next turn.
  const finalizeTurn = () => {
    if (!current) return
    const durationMs =
      turnStartEpoch !== null && turnEndEpoch !== null
        ? Math.max(0, turnEndEpoch - turnStartEpoch)
        : 0
    current.metadata = {
      custom: {
        durationMs,
        status: turnHasError ? 'failed' : 'completed',
      },
    }
    current = null
    turnStartEpoch = null
    turnEndEpoch = null
    turnHasError = false
  }

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
        // A new user turn finalizes any outgoing assistant turn — persisting its
        // wall-clock duration to metadata before resetting per-turn trackers.
        finalizeTurn()
        messages.push({
          id: item.id,
          role: 'user',
          content: [{ type: 'text', text: item.content }],
          createdAt: createItemDate(item.timestamp),
        })
        lastTextPart = null
        openReasoning = null
        break
      }

      case 'agent': {
        const previousUser = [...items].slice(0, items.indexOf(item)).reverse().find((candidate) => candidate.kind === 'user')
        if (previousUser && normalizedText(item.content) === normalizedText(previousUser.content)) break
        recordTurnTiming(item)
        const isDelta = raw?.payload?.delta === true
        const isRedraw = raw?.payload?.redraw === true
        if (lastTextPart) {
          if (item.content === lastTextPart.text || lastTextPart.text.endsWith(item.content)) {
            break
          }
          if (isRedraw) {
            // Redraw events contain the full authoritative render — replace
            // the prior partial PTY render rather than appending.
            lastTextPart.text = item.content
          } else if (isDelta) {
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
        recordTurnTiming(item)
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
        recordTurnTiming(item)
        const part = raw ? activityPart(raw, item, openTools, uniqueToolCallId) : activityData(item)
        if (part) {
          ensureTurn(item.id).content.push(part)
        }
        syncRunning(item)
        break
      }

      case 'plan':
      case 'diff': {
        recordTurnTiming(item)
        if (item.kind === 'plan' || (raw && item.kind === 'diff')) {
          const part = raw ? activityPart(raw, item, openTools, uniqueToolCallId) : null
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
        recordTurnTiming(item)
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
        recordTurnTiming(item)
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
        recordTurnTiming(item)
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

  // Finalize the trailing assistant turn (if any) so its duration is persisted
  // even though no subsequent user message triggered finalization above.
  finalizeTurn()

  // Legacy transcript turns fold the agent's internal reasoning and its final
  // reply into one text block (no discrete `thinking` events). Split that
  // merged text into a `reasoning` part (the "Thinking" component) plus the
  // reply as text. This runs as a single post-pass so it applies uniformly to
  // both live (delta) frames and reloaded (snapshot) transcripts — otherwise the
  // reasoning component would only appear after a reload, and the live reply
  // would render the thinking text inline (garbled).
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
  // so the thread is never visually silent. `optimisticRunning` covers the
  // gap before the backend confirms the run, making the ✦ Thinking…
  // placeholder appear the instant the user hits Send.
  if ((working || optimisticRunning) && messages[messages.length - 1]?.role === 'user') {
    messages.push({
      id: `generating-${messages[messages.length - 1].id}`,
      role: 'assistant',
      content: [{
        type: 'reasoning',
        text: 'Thinking',
        status: { type: 'running' },
      }],
      createdAt: new Date(),
      status: { type: 'running' },
    })
  }
  return messages as unknown as ThreadMessageLike[]
}

function hasUserMessage(messages: MutableMessage[]) {
  return messages.some((message) => message.role === 'user')
}

/**
 * Splits a monolithic legacy-transcript assistant block into its internal
 * reasoning (the "thinking") and the user-facing reply. Returns
 * `[undefined, text]` when no clear boundary exists so callers fall back to
 * rendering the whole block as text (current behaviour preserved).
 *
 * Heuristic: reasoning reads as an instruction / bullet monologue (system
 * notes, skill lists, "Follow all instructions..."), while the reply is the
 * first paragraph that addresses the user directly — a greeting or a normal
 * prose sentence that follows the monologue.
 */
const GREETING_WORDS = /^(hello|hi|hey|greetings|welcome|thanks|thank you|sure|okay|certainly|great|good |i can|i'd|i will|let me|here's|here is|of course)/i
export function splitReasoning(text: string): [string | undefined, string | undefined] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  if (paragraphs.length < 2) return [undefined, text]

  const isMonologue = (paragraph: string) => {
    // cleanTerminalText rewrites bullets ("• foo") to ". foo"; strip that plus
    // any remaining list-marker prefix before testing the leading keyword.
    const stripped = paragraph.replace(/^\.\s+/, '').replace(/^[-•*]\.\s*/, '').replace(/^[-•*]\s*/, '')
    if (/^(follow|see|use|note|remember|you can|you should|the user|let me think|i should|i need to|first,|next,)/i.test(stripped)) return true
    // Bulleted / itemized lists read as internal reasoning, not a reply.
    if (/^[-•*]\s+/.test(paragraph)) return true
    const lines = paragraph.split('\n')
    if (lines.length > 1 && lines.every((line) => /^[-•*]\s+/.test(line.trim()) || /:$/.test(line.trim()))) return true
    return false
  }

  // Only split when there is a genuine monologue/instruction prefix followed by
  // the actual reply. A reply-start is recognized solely after we have seen at
  // least one monologue paragraph, so plain multi-paragraph prose is left intact.
  let replyStart = -1
  let seenMonologue = false
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    if (isMonologue(paragraph)) {
      seenMonologue = true
      continue
    }
    const looksLikeReply = GREETING_WORDS.test(paragraph) || (/[.!?]$/.test(paragraph.trim()) && paragraph.length > 24)
    if (looksLikeReply && seenMonologue) {
      replyStart = index
      break
    }
  }
  if (replyStart <= 0) return [undefined, text]

  const reasoning = paragraphs.slice(0, replyStart).join('\n\n').trim()
  const reply = paragraphs.slice(replyStart).join('\n\n').trim()
  if (!reasoning || !reply) return [undefined, text]
  return [reasoning, reply]
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
  uniqueToolCallId: (base: string) => string,
): MutablePart | null {
  const payload = event.payload || {}
  const toolId = String(payload.tool_id || '')
  const toolName = String(payload.tool_name || 'Tool')
  const duration = typeof event.duration_ms === 'number' ? formatDuration(event.duration_ms) : ''
  const lookupKey = (name: string) => openTools.get(toolId || `anon-${name}`) || undefined

  switch (event.kind) {
    case 'tool_started': {
      // If a tool with this id is still in flight (start delivered twice, or a
      // previous run never sent a finish), reuse it in place rather than
      // emitting a second part that would collide on its toolCallId.
      const existingKey = toolId || `anon-${toolName}`
      const inFlight = openTools.get(existingKey)
      if (inFlight) return null
      const part: MutableToolCallPart = {
        type: 'tool-call',
        toolCallId: uniqueToolCallId(toolId || `call-${item.id}`),
        toolName,
        args: payload.input && typeof payload.input === 'object'
          ? (payload.input as Record<string, unknown>)
          : { input: payload.input },
        argsText: payload.input ? JSON.stringify(payload.input) : '{}',
        status: { type: 'running' },
      }
      openTools.set(existingKey, part)
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
      const existingKey = toolId || 'cmd-bash'
      const inFlight = openTools.get(existingKey)
      if (inFlight) return null
      const part: MutableToolCallPart = {
        type: 'tool-call',
        toolCallId: uniqueToolCallId(toolId || `cmd-${item.id}`),
        toolName: 'bash',
        args: { command: payload.command },
        argsText: payload.command ? JSON.stringify({ command: payload.command }) : '{}',
        status: { type: 'running' },
      }
      openTools.set(existingKey, part)
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

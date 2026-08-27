/**
 * Event reducer: backend event → conversation mutation.
 *
 * This is the core of the streaming fix. Two rules:
 *
 * 1. **Incremental.** Each event mutates the conversation in place. Nothing is
 *    re-derived from an event log, so cost is O(1) per event rather than O(n).
 * 2. **No text heuristics.** The backend states whether text is a delta, a
 *    replacement, or a whole message. We never guess by comparing prefixes.
 *
 * Idempotency is by `event_id`, not by content. Content-equality dedupe (the old
 * approach) silently drops an agent legitimately repeating a line.
 *
 * Unknown event kinds are ignored, not errors. The backend's `kind` is an open
 * string and adding one must not require a frontend change.
 */

import type { AgentEvent, AgentMessage } from '@/types/protocol'
import type {
  ApprovalOptionData,
  ApprovalPart,
  CommandPart,
  Conversation,
  Message,
  ReasoningPart,
  TextPart,
  ToolPart,
  TurnSummaryPart,
  UsagePart,
} from '@/types/conversation'

/** Read a string field from an untyped payload. */
function str(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function bool(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function num(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' ? value : undefined
}

/** Stringify a tool input/output that may be a string or an object. */
function text(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/**
 * Map a provider-native event kind onto the canonical kind the reducer speaks.
 *
 * Grok Build (and agents modeled on it) use a slightly different vocabulary —
 * `text`, `thought`, `tool_call`, `tool_call_update`, `usage`,
 * `available_commands`, `end` — whether arriving through ACP mapping or raw
 * headless streaming-json. Normalizing here means every alias flows through the
 * exact same code path as the canonical kinds, with no duplicated logic to
 * drift.
 */
function normalizeKind(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'text':
      return 'assistant_text'
    case 'thought':
      return 'thinking_delta'
    case 'turn_end':
    case 'end':
      return 'agent_completed'
    case 'available_commands':
      return 'commands_available'
    case 'tool_call':
    case 'tool_call_update': {
      // One vocabulary covers start and finish; status decides which.
      const status = str(payload, 'status') ?? 'in_progress'
      return status === 'completed' || status === 'failed' ? 'tool_finished' : 'tool_started'
    }
    default:
      return kind
  }
}

/** Read a numeric field that may be named in snake_case or camelCase. */
function numAny(payload: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = num(payload, key)
    if (value !== undefined) return value
  }
  // camelCase fallback: input_tokens → inputTokens
  for (const key of keys) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    const value = num(payload, camel)
    if (value !== undefined) return value
  }
  return undefined
}

function stringList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Turn the agent's `options` field into structured metadata.
 *
 * Accepts both the rich shape (`{ value, label, description, allows_custom_text }`)
 * an agent may send and a flat string array (the legacy permission prompt). The
 * structured form wins when present; the flat form is normalized to it so the
 * rest of the pipeline only deals with `ApprovalOptionData`.
 */
function parseApprovalOptions(payload: Record<string, unknown>): ApprovalOptionData[] {
  const structured = payload['option_data']
  if (Array.isArray(structured) && structured.length > 0) {
    const parsed = structured
      .map((item): ApprovalOptionData | null => {
        if (typeof item === 'string') return { value: item }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          const value = str(record, 'value') ?? str(record, 'id')
          if (!value) return null
          return {
            value,
            label: str(record, 'label') ?? str(record, 'title'),
            description: str(record, 'description'),
            allowsCustomText: record['allows_custom_text'] === true,
          }
        }
        return null
      })
      .filter((item): item is ApprovalOptionData => item !== null)
    if (parsed.length > 0) return parsed
  }
  // Fall back to the legacy flat string options.
  return stringList(payload, 'options').map((value) => ({ value }))
}

/** Read a string field that may be named differently per provider. */
function strAny(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(payload, key)
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * The assistant turn currently receiving events, created on demand.
 *
 * A turn ends when the backend says so (`agent_completed`), not when a user
 * message arrives — so trailing events after a completion open a new turn rather
 * than being appended to a finished one.
 */
function currentTurn(conversation: Conversation, event: AgentEvent): Message {
  const last = conversation.messages[conversation.messages.length - 1]
  if (last && last.role === 'assistant' && last.streaming) return last

  const turn: Message = {
    id: `turn-${event.event_id}`,
    role: 'assistant',
    parts: [],
    sequence: event.sequence,
    createdAt: event.timestamp,
    streaming: true,
  }
  conversation.messages.push(turn)
  return turn
}

/**
 * The open text part at the end of a turn, or a new one.
 *
 * Text is appended to the *trailing* part only. If a tool call landed after the
 * last text, the next text starts a fresh part — which is what keeps prose and
 * tool activity in the order they actually happened.
 */
function openTextPart(turn: Message): TextPart {
  const last = turn.parts[turn.parts.length - 1]
  if (last?.kind === 'text' && last.streaming) return last
  const part: TextPart = { kind: 'text', text: '', streaming: true }
  turn.parts.push(part)
  return part
}

function openReasoningPart(turn: Message): ReasoningPart {
  for (let index = turn.parts.length - 1; index >= 0; index -= 1) {
    const part = turn.parts[index]
    if (part.kind === 'reasoning' && part.streaming) return part
  }
  const part: ReasoningPart = { kind: 'reasoning', text: '', streaming: true }
  turn.parts.push(part)
  return part
}

/** Find an in-flight tool/command part by its provider-native id. */
function findByToolId(
  turn: Message,
  toolId: string,
): ToolPart | CommandPart | undefined {
  for (let index = turn.parts.length - 1; index >= 0; index -= 1) {
    const part = turn.parts[index]
    if ((part.kind === 'tool' || part.kind === 'command') && part.toolId === toolId) {
      return part
    }
  }
  return undefined
}

/** Close every streaming part in a turn and mark the turn finished. */
function finishTurn(turn: Message): void {
  for (const part of turn.parts) {
    if (part.kind === 'text' || part.kind === 'reasoning') part.streaming = false
    // A tool still marked running when the turn ends never reported back.
    // Leaving it "running" forever would spin a spinner indefinitely.
    if ((part.kind === 'tool' || part.kind === 'command') && part.status === 'running') {
      part.status = 'failed'
    }
  }
  turn.streaming = false
}

/**
 * Human-readable activity label for an event, or `null` to leave the current
 * activity alone.
 *
 * Labels come from the event kind and its own payload — never from parsing
 * output text.
 */
function activityFor(kind: string, payload: Record<string, unknown>): string | null {
  switch (kind) {
    case 'thinking_started':
      return 'Thinking'
    case 'plan':
      return 'Planning'
    case 'assistant_text':
      return 'Responding'
    case 'command_started': {
      const command = str(payload, 'command')
      return command ? `Running ${command.split(/\s+/)[0]}` : 'Running command'
    }
    case 'file_read':
      return 'Reading files'
    case 'file_edited':
      return 'Editing files'
    case 'search_started':
      return 'Searching'
    case 'tool_started':
    case 'tool_activity': {
      const name = str(payload, 'tool_name')
      return name ? `Using ${name}` : 'Using tool'
    }
    case 'permission_required':
      return 'Waiting for approval'
    default:
      return null
  }
}

/**
 * Apply one agent event.
 *
 * Returns true if the conversation changed, so callers can skip a re-render on a
 * duplicate or irrelevant event.
 */
export function applyAgentEvent(
  conversation: Conversation,
  event: AgentEvent,
  envelopeEventId?: number,
): boolean {
  // Idempotent by id: a replay overlap after reconnect must not duplicate.
  if (conversation.seenEvents.has(event.event_id)) return false
  conversation.seenEvents.add(event.event_id)
  if (envelopeEventId !== undefined && envelopeEventId > conversation.lastEventId) {
    conversation.lastEventId = envelopeEventId
  }

  const { kind: rawKind, payload } = event
  const kind = normalizeKind(rawKind, payload)
  const label = activityFor(kind, payload)
  if (label) {
    conversation.activity = {
      label,
      detail: str(payload, 'path') ?? str(payload, 'command') ?? str(payload, 'query'),
      since: event.timestamp,
    }
  }

  switch (kind) {
    case 'assistant_text': {
      const content = str(payload, 'text') ?? str(payload, 'content')
      if (!content) return true
      const turn = currentTurn(conversation, event)
      const part = openTextPart(turn)
      // The backend distinguishes these three cases explicitly. This is the
      // whole reason no prefix-matching is needed. A payload carrying *neither*
      // flag is a non-canonical source (raw Grok streaming-json), where chunks
      // are increments — appending is the only non-lossy reading.
      if (bool(payload, 'delta') === false || bool(payload, 'redraw')) {
        part.text = content
      } else {
        part.text += content
      }
      return true
    }

    case 'thinking_started': {
      const turn = currentTurn(conversation, event)
      openReasoningPart(turn)
      return true
    }

    case 'thinking_delta': {
      const content = str(payload, 'text')
      if (!content) return true
      const turn = currentTurn(conversation, event)
      const part = openReasoningPart(turn)
      // The backend states whether this is an increment or the whole thought,
      // exactly as it does for assistant text. A whole thought replaces, so an
      // agent that sends both chunks and a final complete thought does not
      // double the trace.
      if (bool(payload, 'delta') === false) part.text = content
      else part.text += content
      return true
    }

    case 'thinking_finished': {
      const turn = currentTurn(conversation, event)
      const part = openReasoningPart(turn)
      part.streaming = false
      if (event.duration_ms !== null) part.durationMs = event.duration_ms
      return true
    }

    case 'tool_started':
    case 'tool_activity': {
      const turn = currentTurn(conversation, event)
      // Grok names these id/name; canonical events use tool_id/tool_name.
      const toolId = strAny(payload, 'tool_id', 'toolCallId', 'call_id', 'id') ?? `tool-${event.event_id}`
      // A re-delivered start must not create a second card.
      if (findByToolId(turn, toolId)) return false
      const part: ToolPart = {
        kind: 'tool',
        toolId,
        name: strAny(payload, 'tool_name', 'name', 'title') ?? 'Tool',
        toolKind: strAny(payload, 'kind', 'tool_kind', 'type'),
        input: text(payload, 'input') ?? text(payload, 'tool_input') ?? text(payload, 'rawInput'),
        status: 'running',
      }
      turn.parts.push(part)
      return true
    }

    case 'tool_input': {
      // The complete input for a streaming tool call, published once at block
      // close. Fills in the card created by tool_started.
      const turn = currentTurn(conversation, event)
      const toolId = str(payload, 'tool_id')
      const part = toolId ? findByToolId(turn, toolId) : undefined
      if (part && part.kind === 'tool') {
        const input = text(payload, 'input')
        if (input) {
          try {
            // Parsed JSON reads far better than an escaped string blob.
            part.input = JSON.stringify(JSON.parse(input), null, 1)
          } catch {
            part.input = input
          }
        }
        return true
      }
      return false
    }

    case 'tool_finished': {
      const turn = currentTurn(conversation, event)
      const toolId = strAny(payload, 'tool_id', 'toolCallId', 'call_id', 'id')
      const part = toolId ? findByToolId(turn, toolId) : undefined
      if (!part) return false
      // Canonical events carry a boolean `success`; raw Grok updates carry a
      // string `status`. Either may declare the failure.
      part.status =
        bool(payload, 'success') === false || str(payload, 'status') === 'failed'
          ? 'failed'
          : 'ok'
      part.output = text(payload, 'output') ?? text(payload, 'result') ?? text(payload, 'content')
      part.durationMs = event.duration_ms ?? numAny(payload, 'duration_ms')
      return true
    }

    case 'command_started': {
      const turn = currentTurn(conversation, event)
      const toolId = strAny(payload, 'tool_id', 'toolCallId', 'call_id', 'id') ?? `cmd-${event.event_id}`
      if (findByToolId(turn, toolId)) return false
      const part: CommandPart = {
        kind: 'command',
        toolId,
        command: strAny(payload, 'command', 'cmd') ?? '',
        status: 'running',
      }
      turn.parts.push(part)
      return true
    }

    case 'command_finished': {
      const turn = currentTurn(conversation, event)
      const toolId = strAny(payload, 'tool_id', 'toolCallId', 'call_id', 'id')
      const part = toolId ? findByToolId(turn, toolId) : undefined
      if (!part || part.kind !== 'command') return false
      const exitCode = numAny(payload, 'exit_code')
      part.exitCode = exitCode
      part.status = exitCode === undefined ? 'ok' : exitCode === 0 ? 'ok' : 'failed'
      part.output = text(payload, 'output') ?? text(payload, 'result')
      part.durationMs = event.duration_ms ?? numAny(payload, 'duration_ms')
      return true
    }

    case 'file_edited': {
      const path = str(payload, 'path')
      if (!path) return true
      const turn = currentTurn(conversation, event)
      turn.parts.push({ kind: 'file', path, ok: bool(payload, 'success') !== false })
      return true
    }

    case 'plan': {
      const turn = currentTurn(conversation, event)
      // Entries carry per-step status (Grok Build, ACP agents); plain strings
      // remain the fallback for agents that do not.
      let entries: Array<{ content: string; status?: string }> = []
      const rawEntries = payload['entries']
      if (Array.isArray(rawEntries)) {
        for (const entry of rawEntries) {
          if (entry && typeof entry === 'object') {
            const record = entry as Record<string, unknown>
            const content = str(record, 'content')
            if (content) entries.push({ content, status: str(record, 'status') })
          } else if (typeof entry === 'string') {
            entries.push({ content: entry })
          }
        }
      }
      if (entries.length === 0) {
        entries = stringList(payload, 'steps').map((content) => ({ content }))
      }
      if (entries.length === 0) return true
      turn.parts.push({
        kind: 'plan',
        title: str(payload, 'title'),
        steps: entries.map((entry) => entry.content),
        entries,
      })
      return true
    }

    /**
     * Token/cost accounting. Merges into a trailing usage part so a stream of
     * updates renders as one meter that ticks up, not one card per event.
     */
    case 'usage': {
      const turn = currentTurn(conversation, event)
      const incoming: UsagePart = {
        kind: 'usage',
        inputTokens: numAny(payload, 'input_tokens', 'prompt_tokens', 'tokens_in'),
        outputTokens: numAny(payload, 'output_tokens', 'completion_tokens', 'tokens_out'),
        cacheReadTokens: numAny(payload, 'cache_read_tokens', 'cache_tokens'),
        costUsd: numAny(payload, 'cost_usd', 'cost'),
      }
      const last = turn.parts[turn.parts.length - 1]
      if (last?.kind === 'usage') {
        if (incoming.inputTokens !== undefined) last.inputTokens = incoming.inputTokens
        if (incoming.outputTokens !== undefined) last.outputTokens = incoming.outputTokens
        if (incoming.cacheReadTokens !== undefined) last.cacheReadTokens = incoming.cacheReadTokens
        if (incoming.costUsd !== undefined) last.costUsd = incoming.costUsd
        return true
      }
      if (
        incoming.inputTokens === undefined &&
        incoming.outputTokens === undefined &&
        incoming.costUsd === undefined
      ) {
        return false
      }
      turn.parts.push(incoming)
      return true
    }

    /** Slash commands the agent can run — composer chips, not transcript rows. */
    case 'commands_available': {
      const commands = stringList(payload, 'commands')
      if (commands.length === 0) return false
      conversation.commands = commands.slice(0, 40)
      return true
    }

    /** The agent switched mode (e.g. Grok build ↔ plan). Shown as a chip. */
    case 'mode_changed': {
      const modeId = strAny(payload, 'mode_id', 'currentModeId', 'mode')
      if (!modeId) return false
      const rawModes = payload['modes']
      const modes = Array.isArray(rawModes)
        ? rawModes
            .filter((mode) => mode && typeof mode === 'object')
            .map((mode) => {
              const record = mode as Record<string, unknown>
              return { id: str(record, 'id') ?? '', name: str(record, 'name') }
            })
            .filter((mode) => mode.id !== '')
        : []
      conversation.mode = { id: modeId, modes }
      return true
    }

    case 'permission_required': {
      const turn = currentTurn(conversation, event)
      const requestId = str(payload, 'id') ?? event.event_id
      if (
        turn.parts.some((part) => part.kind === 'approval' && part.requestId === requestId)
      ) {
        return false
      }
      const part: ApprovalPart = {
        kind: 'approval',
        requestId,
        prompt: str(payload, 'prompt') ?? 'The agent is requesting permission.',
        options: stringList(payload, 'options'),
        riskLevel: str(payload, 'risk_level'),
      }
      // Structured options: when the agent supplies richer metadata
      // (labels, descriptions, custom-text flags) carry it through verbatim.
      const optionData = parseApprovalOptions(payload)
      if (optionData.length > 0) part.optionData = optionData
      const selectionMode = str(payload, 'selection_mode')
      part.multiSelect = selectionMode === 'multiple' || selectionMode === 'multi'
      const allowsCustom = payload['allows_custom_text']
      part.allowsCustomText = allowsCustom === true
      turn.parts.push(part)
      return true
    }

    case 'permission_resolved': {
      const requestId = str(payload, 'request_id')
      if (!requestId) return false
      // The card may be in an earlier turn; search backwards across the whole
      // conversation rather than assuming it is in the current one.
      for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
        for (const part of conversation.messages[index].parts) {
          if (part.kind === 'approval' && part.requestId === requestId) {
            part.decision = str(payload, 'decision') ?? 'resolved'
            return true
          }
        }
      }
      return false
    }

    case 'agent_error': {
      const turn = currentTurn(conversation, event)
      turn.parts.push({
        kind: 'error',
        message: str(payload, 'message') ?? 'The agent reported an error.',
      })
      finishTurn(turn)
      conversation.activity = undefined
      return true
    }

    case 'agent_completed':
    case 'agent_stopped': {
      const last = conversation.messages[conversation.messages.length - 1]
      // A completion that reports cost/tokens/stop-reason earns a summary
      // card. A bare completion (the common case) adds nothing — an empty
      // "Turn complete" row is noise, not information.
      const summary: TurnSummaryPart = {
        kind: 'turn_summary',
        stopReason: strAny(payload, 'stop_reason', 'reason', 'stopReason'),
        inputTokens: numAny(payload, 'input_tokens', 'prompt_tokens', 'tokens_in'),
        outputTokens: numAny(payload, 'output_tokens', 'completion_tokens', 'tokens_out'),
        costUsd: numAny(payload, 'cost_usd', 'cost'),
        durationMs: event.duration_ms ?? numAny(payload, 'duration_ms'),
      }
      if (
        summary.stopReason !== undefined ||
        summary.inputTokens !== undefined ||
        summary.outputTokens !== undefined ||
        summary.costUsd !== undefined
      ) {
        if (last?.role === 'assistant') {
          // Attach to the turn that just finished — including one already
          // sealed by an earlier completion event, which must not spawn a
          // fresh streaming turn holding only a summary card.
          last.parts.push(summary)
        } else {
          const turn = currentTurn(conversation, event)
          turn.parts.push(summary)
          finishTurn(turn)
        }
      }
      if (last?.role === 'assistant' && last.streaming) finishTurn(last)
      conversation.activity = undefined
      return true
    }

    // Terminal bytes belong in the terminal, never rendered as chat prose.
    case 'terminal_output':
      return false

    default:
      // Unknown kinds are expected: the backend's `kind` is an open string.
      return false
  }
}

/**
 * Apply a `Message` frame.
 *
 * The server echoes user input back, so a matching optimistic message is
 * *confirmed* rather than duplicated. Matching is by id when the caller supplied
 * one, falling back to the newest unconfirmed optimistic message — not by
 * comparing text, which broke whenever whitespace differed.
 */
export function applyMessage(conversation: Conversation, message: AgentMessage): boolean {
  if (conversation.seenEvents.has(message.id)) return false
  conversation.seenEvents.add(message.id)

  if (message.role === 'user') {
    const pending = conversation.messages.find(
      (candidate) => candidate.optimistic && candidate.role === 'user',
    )
    if (pending) {
      pending.id = message.id
      pending.optimistic = false
      pending.createdAt = message.timestamp
      return true
    }
    conversation.messages.push({
      id: message.id,
      role: 'user',
      parts: [{ kind: 'text', text: message.content, streaming: false }],
      sequence: 0,
      createdAt: message.timestamp,
      streaming: false,
    })
    return true
  }

  // A whole assistant message (no streaming): close any open turn and record it.
  const last = conversation.messages[conversation.messages.length - 1]
  if (last?.role === 'assistant' && last.streaming) {
    const part = openTextPart(last)
    part.text = message.content
    finishTurn(last)
    return true
  }
  conversation.messages.push({
    id: message.id,
    role: 'assistant',
    parts: [{ kind: 'text', text: message.content, streaming: false }],
    sequence: 0,
    createdAt: message.timestamp,
    streaming: false,
  })
  return true
}

/**
 * Add a user message locally, before the server confirms it.
 *
 * This is what makes a sent prompt appear instantly. `applyMessage` later
 * reconciles it by flipping `optimistic`, so the message is never rendered twice.
 */
export function addOptimisticUserMessage(
  conversation: Conversation,
  content: string,
): Message {
  const message: Message = {
    id: `optimistic-${Date.now()}`,
    role: 'user',
    parts: [{ kind: 'text', text: content, streaming: false }],
    sequence: Number.MAX_SAFE_INTEGER,
    createdAt: new Date().toISOString(),
    streaming: false,
    optimistic: true,
  }
  conversation.messages.push(message)
  return message
}

/** Append raw terminal bytes, bounded so a runaway agent cannot exhaust memory. */
const TERMINAL_LIMIT = 512 * 1024

export function appendTerminal(conversation: Conversation, data: string): void {
  const combined = conversation.terminal + data
  conversation.terminal =
    combined.length > TERMINAL_LIMIT ? combined.slice(-TERMINAL_LIMIT) : combined
}

/**
 * Close everything still marked in-flight.
 *
 * Called when the backend reports the session is over. Without this, a session
 * that ends between events — a crash, a kill, a process exit — leaves the
 * activity line and any open text part spinning forever, which is precisely the
 * "shows Working after it stopped" failure this rewrite targets.
 */
export function sealConversation(conversation: Conversation): void {
  conversation.activity = undefined
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last || !last.streaming) return
  for (const part of last.parts) {
    if (part.kind === 'text' || part.kind === 'reasoning') part.streaming = false
    if ((part.kind === 'tool' || part.kind === 'command') && part.status === 'running') {
      part.status = 'failed'
    }
  }
  last.streaming = false
}

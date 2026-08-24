/**
 * Conversation model — what the timeline renders.
 *
 * The central design decision: this is a **mutable, incrementally-updated**
 * structure, not something derived by re-folding the event log.
 *
 * The old pipeline rebuilt the entire timeline from scratch on every token
 * (`messages` array reallocated per frame → `useMemo` dependency → full
 * re-fold), and reconstructed streaming text with a five-branch
 * `startsWith`/`endsWith` heuristic whose fallback blind-appended. That is where
 * duplicated and garbled assistant text came from.
 *
 * Here, a delta appends to one part of one message in place. There is no
 * heuristic because the backend tells us whether text is a delta, a replacement,
 * or a whole message.
 */

/** A contiguous run of assistant prose. */
export interface TextPart {
  kind: 'text'
  text: string
  /** False once the backend says the message is complete. */
  streaming: boolean
}

/** Reasoning/thinking, shown collapsed by default. */
export interface ReasoningPart {
  kind: 'reasoning'
  text: string
  streaming: boolean
  /** Wall time the agent spent reasoning, when the backend reports it. */
  durationMs?: number
}

/** A tool invocation, paired with its result when it arrives. */
export interface ToolPart {
  kind: 'tool'
  /** Provider-native tool call id; the pairing key for start/finish. */
  toolId: string
  name: string
  /** Coarse kind hint from the provider ("read", "edit", "search", …). */
  toolKind?: string
  input?: string
  output?: string
  status: 'running' | 'ok' | 'failed'
  durationMs?: number
}

/** A shell command the agent ran. */
export interface CommandPart {
  kind: 'command'
  toolId: string
  command: string
  output?: string
  exitCode?: number
  status: 'running' | 'ok' | 'failed'
  durationMs?: number
}

/** A file the agent changed. */
export interface FileChangePart {
  kind: 'file'
  path: string
  ok: boolean
}

/** A task plan. */
export interface PlanPart {
  kind: 'plan'
  title?: string
  steps: string[]
  /**
   * Live step status, when the agent reports it (Grok Build and other ACP
   * agents do): "pending" | "in_progress" | "completed". Parallel to `steps`
   * and possibly shorter — a missing entry renders as pending.
   */
  entries?: Array<{ content: string; status?: string }>
}

/**
 * Token/cost accounting for a turn, when the agent reports usage
 * (`usage_update` in ACP; Grok's headless `usage` events map here too).
 */
export interface UsagePart {
  kind: 'usage'
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  costUsd?: number
}

/**
 * End-of-turn summary: why the turn stopped plus what it cost. Built from an
 * `agent_completed` / `end` event's payload when it carries any of these
 * fields — absent fields mean the agent did not report them.
 */
export interface TurnSummaryPart {
  kind: 'turn_summary'
  stopReason?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  durationMs?: number
}

/** A permission request awaiting the user. */
export interface ApprovalPart {
  kind: 'approval'
  requestId: string
  prompt: string
  options: string[]
  riskLevel?: string
  /** Set once resolved, so the card shows the outcome instead of vanishing. */
  decision?: string
}

/** An error surfaced by the agent or the transport. */
export interface ErrorPart {
  kind: 'error'
  message: string
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolPart
  | CommandPart
  | FileChangePart
  | PlanPart
  | ApprovalPart
  | UsagePart
  | TurnSummaryPart
  | ErrorPart

export type MessageRole = 'user' | 'assistant'

/**
 * One turn. An assistant turn accumulates many parts as the agent works;
 * `parts` is appended to and mutated in place.
 */
export interface Message {
  id: string
  role: MessageRole
  parts: MessagePart[]
  /** Backend event sequence for ordering and dedupe. */
  sequence: number
  createdAt: string
  /** True while this turn is still receiving events. */
  streaming: boolean
  /**
   * Set for a locally-created user message not yet confirmed by the server.
   * Cleared when the server echoes it back, which is how the double-render is
   * avoided without prefix-matching text.
   */
  optimistic?: boolean
}

/**
 * What the agent is doing right now, for the live activity indicator.
 *
 * Derived from the newest event rather than a timer, and cleared on completion —
 * so the UI never shows a stale "Worked for 1m" while work continues.
 */
export interface Activity {
  label: string
  detail?: string
  since: string
}

/** Everything the timeline needs for one session. */
export interface Conversation {
  sessionId: string
  messages: Message[]
  /** Undefined when the agent is idle. */
  activity?: Activity
  /** Raw terminal bytes, for the terminal view. Kept out of the chat. */
  terminal: string
  /**
   * Slash commands the agent announced (`commands_available`). Rendered as
   * tappable chips by the composer, not as transcript rows.
   */
  commands: string[]
  /** The agent's current mode (e.g. Grok's build/plan), when reported. */
  mode?: { id: string; modes: Array<{ id: string; name?: string }> }
  /**
   * Highest `event_id` applied. Sent as the replay cursor on reconnect so the
   * server resends only what was missed.
   */
  lastEventId: number
  /** Applied event ids, for idempotency across a replay overlap. */
  seenEvents: Set<string>
}

export function emptyConversation(sessionId: string): Conversation {
  return {
    sessionId,
    messages: [],
    terminal: '',
    commands: [],
    lastEventId: 0,
    seenEvents: new Set(),
  }
}

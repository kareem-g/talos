/**
 * Wire protocol — the exact frames the backend sends and accepts.
 *
 * The envelope is `{"type": "VariantName", "payload": {...}}` with PascalCase
 * type names and snake_case payload keys (serde `tag = "type", content =
 * "payload"`). Broadcast frames additionally carry top-level `event_id` and
 * `timestamp` injected by the sender.
 *
 * Two behaviors documented here because getting them wrong causes visible bugs:
 *
 * - The broadcast hub is **global**. Every client receives every session's
 *   frames, and `Subscribe` is currently accepted and ignored server-side.
 *   Filter by `session_id` on arrival.
 * - `Input` is **echoed back** as a `Message` frame with `role: "user"`. Render
 *   optimistically and reconcile, or the prompt appears twice.
 */

import type { Session } from './session'

/** Semantic agent events. `kind` is an open string: unknown kinds must not crash. */
export interface AgentEvent {
  event_id: string
  session_id: string
  sequence: number
  timestamp: string
  kind: string
  payload: Record<string, unknown>
  duration_ms: number | null
}

export interface AgentMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface Activity {
  id: string
  kind: string
  title: string
  detail: string
  timestamp: string
}

/**
 * One answer choice the agent offers. All fields except `value` are optional;
 * when absent the UI falls back to rendering `value` verbatim.
 */
export interface ApprovalOption {
  /** Value sent back to the agent verbatim. */
  value: string
  label?: string
  description?: string
  /** `true` when this option also permits free-text input. */
  allows_custom_text?: boolean
}

export interface ApprovalRequest {
  id: string
  prompt: string
  /** Legacy flat option list. */
  options: string[]
  /** Structured options, when the agent supplies them. */
  option_data?: ApprovalOption[]
  /** Selection mode the agent requested: "single" (default) or "multiple". */
  selection_mode?: 'single' | 'multiple'
  /** `true` when the agent invites free-form custom input for this prompt. */
  allows_custom_text?: boolean
  /** PascalCase from the backend enum: "Low" | "Medium" | "High" | "Critical". */
  risk_level: string
  timestamp: string
}

/** Metadata carried with an approval response, beyond the verbatim `decision`. */
export interface ApprovalMeta {
  /** Free-form text the user supplied (custom input). */
  customText?: string
  /** `true` when the choice should persist for the rest of the session. */
  always?: boolean
  /** Explicit allow/deny for custom-text answers (the agent can't infer it). */
  allow?: boolean
}
export type ServerFrame =
  | { type: 'Authenticated'; payload: { device_id: string; last_event_id: number } }
  | { type: 'DeviceRevoked'; payload: { device_id: string } }
  | { type: 'SessionUpdate'; payload: { session: Session } }
  | { type: 'SessionDeleted'; payload: { session_id: string } }
  | { type: 'TerminalOutput'; payload: { session_id: string; data: string } }
  | { type: 'TerminalResized'; payload: { session_id: string; cols: number; rows: number } }
  | { type: 'Message'; payload: { message: AgentMessage } }
  | { type: 'AgentEvent'; payload: { event: AgentEvent } }
  | { type: 'ApprovalRequest'; payload: { session_id: string; request: ApprovalRequest } }
  | {
      type: 'ApprovalResolved'
      payload: { session_id: string; request_id: string; decision: string }
    }
  | { type: 'Activity'; payload: { session_id: string; activity: Activity } }
  | { type: 'StateChange'; payload: { session_id: string; state: string } }
  | { type: 'TunnelUpdate'; payload: { status: string; details: Record<string, unknown> } }
  | { type: 'SessionError'; payload: { session_id: string; code: string; message: string } }
  | { type: 'Error'; payload: { code: string; message: string } }
  | { type: 'Ping'; payload?: undefined }

/** Envelope fields added to broadcast frames. */
export interface FrameEnvelope {
  event_id?: number
  timestamp?: string
}

export type IncomingFrame = ServerFrame & FrameEnvelope

/** Client → server frames. */
export type ClientFrame =
  | { type: 'Authenticate'; payload: { token: string; after_event_id: number | null } }
  | { type: 'Input'; payload: { session_id: string; data: string } }
  | { type: 'TerminalInput'; payload: { session_id: string; data: string } }
  | { type: 'TerminalResize'; payload: { session_id: string; cols: number; rows: number } }
  | { type: 'Command'; payload: { action: string; params: Record<string, unknown> } }
  | { type: 'Ping' }

/**
 * Connection lifecycle. `reconnecting` is distinct from `connecting` so the UI
 * can say "Reconnecting…" while preserving state, rather than looking like a
 * fresh page load. `offline` is the navigator.onLine false state — kept distinct
 * so the UI can show "Offline" instead of generic disconnected.
 */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'offline'
  | 'unauthorized'
  | 'error'

/**
 * Structural guard for an incoming frame.
 *
 * Deliberately not an exhaustive `type` check: the backend may add frame
 * variants, and an unknown-but-well-formed frame should fall through the reducer
 * untouched rather than being rejected at the door.
 */
export function isIncomingFrame(value: unknown): value is IncomingFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

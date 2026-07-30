export interface ProtocolFrame {
  version: number
  nonce: string
  timestamp: number
  payload: ProtocolPayload
  signature?: string
}

export type ProtocolPayload =
  | { kind: 'session_event'; sessionId: string; event: SessionEvent }
  | { kind: 'agent_output'; sessionId: string; output: string }
  | { kind: 'approval_request'; id: string; prompt: string; options: string[] }
  | { kind: 'approval_response'; id: string; approved: boolean; always: boolean }
  | { kind: 'command'; action: string; params: Record<string, unknown> }
  | { kind: 'heartbeat' }

export type SessionEvent =
  | { kind: 'started' }
  | { kind: 'paused' }
  | { kind: 'resumed' }
  | { kind: 'completed' }
  | { kind: 'error'; message: string }
  | { kind: 'state_changed'; state: string }

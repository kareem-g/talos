import type { SessionStatus } from './session'

export type MobileConnectionState =
  | 'pairing'
  | 'authenticating'
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'session_expired'
  | 'device_revoked'
  | 'desktop_unavailable'
  | 'sync_failed'

export interface MobileAgent {
  id: string
  name: string
  available: boolean
  path: string
  version?: string
  features: string[]
  capabilities?: Record<string, boolean>
}

export interface MobileSession {
  id: string
  title: string
  name: string
  agent: string
  status: SessionStatus
  project?: string
  branch?: string
  created_at: string
  updated_at: string
  cost?: number
  tokens_used?: number
  capabilities?: Record<string, boolean>
}

export interface MobileTaskTranscript {
  id: number
  session_id: string
  kind: string
  content: string
  timestamp: string
}

export interface MobileAgentMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system' | string
  content: string
  timestamp: string
}

export interface MobileAgentEvent {
  event_id: string
  session_id: string
  sequence: number
  timestamp: string
  kind: string
  payload: Record<string, unknown>
  duration_ms?: number
}

export interface MobileTerminalOutput {
  id: number
  session_id: string
  sequence: number
  data: string
  timestamp: string
}

export interface MobileApproval {
  id: string
  session_id: string
  prompt: string
  options: string[]
  risk_level: 'low' | 'medium' | 'high' | 'critical'
}

export interface MobileQuestionOption {
  id: string
  label: string
  description?: string
  allows_custom_text: boolean
}

export interface MobileQuestion {
  question_id: string
  session_id: string
  title: string
  question: string
  options: MobileQuestionOption[]
  selection_mode: 'single' | 'multiple' | string
  status: 'pending' | 'answered' | 'cancelled' | 'expired' | 'failed' | string
  created_at: string
  answered_at?: string
  selected_options: string[]
  custom_text?: string
}

export interface MobileWorkspace {
  id: string
  name: string
  path: string
  local: boolean
  updated_at?: string
  task_count: number
  tasks: MobileSession[]
}

export interface MobileSnapshot {
  device: { id: string; name: string }
  desktop: { name: string; version: string; connected: boolean }
  workspaces: MobileWorkspace[]
  agents: MobileAgent[]
  synced_at: string
}

export interface MobileMe {
  device: { id: string; name: string }
  desktop: { name: string; version: string }
}

export interface MobileSessionPayload {
  session: MobileSession
  transcripts: MobileTaskTranscript[]
  messages: MobileAgentMessage[]
  events: MobileAgentEvent[]
  terminal_output: MobileTerminalOutput[]
  approvals: MobileApproval[]
  questions: MobileQuestion[]
}

export interface MobileCreateSessionRequest {
  agent: string
  project?: string
  prompt: string
  name?: string
  executable?: string
  args?: string[]
}

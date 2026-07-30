export interface Session {
  id: string
  name: string
  agent: string
  status: SessionStatus
  project?: string
  branch?: string
  createdAt: string
  updatedAt: string
  cost?: number
  tokensUsed?: number
}

export type SessionStatus = 'starting' | 'running' | 'waiting_for_input' | 'waiting_for_approval' | 'idle' | 'error' | 'archived' | 'exited'

export interface SessionCreateRequest {
  name?: string
  agent: string
  project?: string
  branch?: string
}

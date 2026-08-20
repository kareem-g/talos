/**
 * Session contracts — mirrors `backend/src/sessions/mod.rs`.
 *
 * Field names are snake_case because that is what the backend serializes. This
 * file deliberately does not rename them. Translating at the type boundary is
 * how the old frontend ended up with two divergent shapes (`Session` with
 * `createdAt` and `MobileSession` with `created_at`) describing the same row.
 */

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'idle'
  | 'needs_resume'
  | 'error'
  | 'archived'
  | 'exited'

export interface Session {
  id: string
  name: string
  /** Provider id — matches `Provider.id`. */
  agent: string
  project: string | null
  branch: string | null
  status: SessionStatus
  worktree_path: string | null
  created_at: string
  updated_at: string
  cost: number | null
  tokens_used: number | null
  /** Set by the backend when status is `needs_resume`. */
  resume_command: string | null
  /**
   * The CLI's own session id, when this row was imported from a provider's
   * history rather than created here. Opaque.
   */
  external_id?: string | null
  /** `agentdeck` for locally created, or the provider id it was imported from. */
  source?: string
}

/**
 * A session found in a CLI's own storage, not yet adopted by this app.
 *
 * `GET /api/sessions/discover`
 */
export interface DiscoveredSession {
  agent: string
  /** The CLI's own id. Sent back verbatim to import it. */
  externalId: string
  title: string
  project?: string
  updatedAt?: string
  /** True when this app already has a row for it. */
  imported: boolean
}

export interface DiscoverResponse {
  sessions: DiscoveredSession[]
  errors: Array<{ agent: string; message: string }>
  total: number
  /** How many are not yet imported. */
  pending: number
}

export interface SyncResponse {
  imported: number
  skipped: number
  sessions: Session[]
  discoveryErrors: Array<{ agent: string; message: string }>
  failures: Array<{ agent: string; externalId: string; message: string }>
}

/** The agent is working; the UI should show live activity. */
export function isActive(status: SessionStatus): boolean {
  return status === 'starting' || status === 'running'
}

/** The agent is waiting on the user. */
export function isBlocked(status: SessionStatus): boolean {
  return status === 'waiting_for_input' || status === 'waiting_for_approval'
}

/** Nothing further will happen without a new action. */
export function isFinished(status: SessionStatus): boolean {
  return (
    status === 'idle' ||
    status === 'exited' ||
    status === 'error' ||
    status === 'archived' ||
    status === 'needs_resume'
  )
}

/** Request body for `POST /api/sessions`. */
export interface CreateSessionRequest {
  agent: string
  project?: string
  prompt?: string
  name?: string
  /**
   * Opaque provider-native model id. The backend applies it before the first
   * prompt, so turn one already runs on the chosen model.
   */
  model?: string
  effort?: string
}

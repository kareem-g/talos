/**
 * HTTP client for the daemon's mobile API.
 *
 * Ports the web `lib/api.ts` request core verbatim in behaviour — Bearer auth
 * from the stored device token, the "error may ride a 200 body" envelope, and
 * the descriptive network-error mapping — but targets the authenticated
 * `/api/mobile/*` surface (built for a remote phone) instead of the desktop's
 * unauthenticated `/api/*`, and resolves every path against the paired daemon
 * origin (there is no same-origin in RN).
 *
 * Only the endpoints the mobile app uses live here; desktop-only surfaces (git,
 * browser, skills, orchestration) are added as their screens are ported.
 */

import { resolveApiUrl } from './native'
import { storage } from './storage'
import { persistToken, TOKEN_KEY } from './secureStore'
import type { Session } from '@/types/session'
import type { AgentEvent, AgentMessage } from '@/types/protocol'

/** Thrown for both transport failures and backend error envelopes. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Bearer token for the paired device. MMKV is the synchronous live copy. */
export function deviceToken(): string | null {
  return storage.getString(TOKEN_KEY)
}

/** Store the token for synchronous reads now, mirror it to the Keychain async. */
export function setDeviceToken(token: string | null): void {
  if (token === null || token === '') storage.delete(TOKEN_KEY)
  else storage.set(TOKEN_KEY, token)
  void persistToken(token)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = deviceToken()
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  const target = resolveApiUrl(path)
  try {
    response = await fetch(target, { ...init, headers })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const opaque = /load failed|failed to fetch|networkerror|network request failed/i.test(reason)
    throw new ApiError(
      opaque
        ? `No response from ${target} — is the daemon reachable? (${reason})`
        : `Request to ${target} failed: ${reason}`,
      0,
      'network_error',
    )
  }

  const body = await response.text()
  let parsed: unknown = null
  if (body.length > 0) {
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new ApiError(`Malformed response from ${path}`, response.status, 'malformed_response')
    }
  }

  // The backend reports many errors as HTTP 200 with an { error } body.
  const envelope = parsed as { error?: unknown; code?: unknown } | null
  if (envelope && typeof envelope.error === 'string') {
    throw new ApiError(
      envelope.error,
      response.status,
      typeof envelope.code === 'string' ? envelope.code : undefined,
    )
  }
  if (!response.ok) {
    throw new ApiError(`${init?.method ?? 'GET'} ${path} failed`, response.status)
  }
  return parsed as T
}

/* ── Pairing ─────────────────────────────────────────────────────────────── */

export interface PairedDevice {
  verified: boolean
  token: string
  device_id: string
  device_name: string
  fingerprint: string
  paired_at: string
}

export const pairingApi = {
  /** Complete pairing from the phone, exchanging the scanned offer for a token. */
  verify: (input: { offerId: string; secret: string; deviceKey: string; deviceName: string }) =>
    request<PairedDevice>('/api/pair/verify', {
      method: 'POST',
      body: JSON.stringify({
        offer_id: input.offerId,
        secret: input.secret,
        device_key: input.deviceKey,
        device_name: input.deviceName,
      }),
    }),
  me: () =>
    request<{ device: { id: string; name: string }; desktop: { name: string; version: string } }>(
      '/api/mobile/me',
    ),
}

/* ── Mobile API ──────────────────────────────────────────────────────────── */

/** A human-intervention request still open, from `GET /api/mobile/pending`. */
export interface PendingAction {
  session_id: string
  session_name: string
  kind: 'approval' | 'question' | string
  id: string
  title: string
  prompt: string | null
  tool_name: string | null
  risk_level: string | null
  created_at: string
  payload: unknown
}

export interface MobileTask {
  id: string
  title?: string
  name: string
  agent: string
  status: string
  project?: string | null
  branch?: string | null
  created_at: string
  updated_at: string
  cost?: number | null
  tokens_used?: number | null
  parent_id?: string | null
}

export interface MobileWorkspace {
  id: string
  name: string
  path: string
  local: boolean
  updated_at: string
  task_count: number
  tasks: MobileTask[]
}

export interface MobileSnapshot {
  device: { id: string; name: string }
  desktop: { name: string; version: string; connected: boolean }
  workspaces: MobileWorkspace[]
  agents: unknown[]
  synced_at: string
}

export interface MobileSessionDetail {
  session: Session
  transcripts: unknown[]
  messages: AgentMessage[]
  events: AgentEvent[]
  terminal_output: string
  approvals: { id: string; session_id: string; prompt: string; options: string[]; risk_level: string }[]
  questions: unknown[]
}

export const mobileApi = {
  me: () => pairingApi.me(),
  snapshot: (includeArchived = false) =>
    request<MobileSnapshot>(`/api/mobile/snapshot?include_archived=${includeArchived}`),
  /** Open approvals/questions across all sessions — the reconnect-sync source. */
  pending: () => request<{ pending: PendingAction[] }>('/api/mobile/pending'),
  agents: () => request<{ agents: unknown[] }>('/api/mobile/agents'),
  session: (id: string) => request<MobileSessionDetail>(`/api/mobile/sessions/${encodeURIComponent(id)}`),
  createSession: (body: Record<string, unknown>) =>
    request<{ session: Session }>('/api/mobile/sessions', { method: 'POST', body: JSON.stringify(body) }),
  kill: (id: string) =>
    request<{ killed: boolean }>(`/api/mobile/sessions/${encodeURIComponent(id)}/kill`, { method: 'POST' }),
  archive: (id: string) =>
    request<{ archived: boolean }>(`/api/mobile/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  restore: (id: string) =>
    request<{ restored: boolean }>(`/api/mobile/sessions/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  remove: (id: string) =>
    request<{ deleted: boolean }>(`/api/mobile/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

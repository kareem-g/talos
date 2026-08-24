/**
 * HTTP client.
 *
 * Two backend behaviors this layer normalizes so callers don't each handle them:
 *
 * - Most REST errors come back as **HTTP 200 with `{"error": "..."}` in the
 *   body**; only some endpoints use real status codes. Checking `response.ok` is
 *   therefore not sufficient, and every call here inspects the body too.
 * - `PATCH /sessions/{id}/config` returns 200 for a *declined* change, with the
 *   reason in `applied`. That is not an error — a provider refusing is an answer
 *   the UI must display, so it is returned rather than thrown.
 */

import type {
  ConfigUpdateResponse,
  Provider,
  ProvidersResponse,
  SessionConfig,
} from '@/types/provider'
import type { CreateSessionRequest, DiscoverResponse, Session, SyncResponse } from '@/types/session'
import type { AgentEvent, AgentMessage } from '@/types/protocol'

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

/** Bearer token for a paired device, when present. */
const TOKEN_KEY = 'agentdeck-device-token'

export function deviceToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private browsing / disabled storage: treat as unpaired rather than crash.
    return null
  }
}

export function setDeviceToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY)
    else localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Non-fatal: the app still works for this page load without persistence.
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = deviceToken()
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Network request failed',
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

  // The body may carry an error even on 200 — see the module docs.
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

/** Providers: what this machine can run, with real models and capabilities. */
export const providersApi = {
  list: () => request<ProvidersResponse>('/api/providers').then(normalizeProviders),

  /** Re-probe. Use after installing a CLI or changing credentials. */
  refresh: () =>
    request<ProvidersResponse>('/api/providers/refresh', { method: 'POST' }).then(
      normalizeProviders,
    ),

  get: (id: string) =>
    request<{ provider: Provider }>(`/api/providers/${encodeURIComponent(id)}`).then((body) =>
      normalizeProvider(body.provider),
    ),
}

/**
 * Guarantee that collections are arrays and capabilities is an object.
 *
 * The backend always sends them, but a single missing array here becomes a
 * blank screen — the whole UI unmounts on `undefined.length`. Normalizing at the
 * one place data enters is cheaper than defending at every render site.
 */
function normalizeProvider(provider: Provider): Provider {
  return {
    ...provider,
    models: provider.models ?? [],
    configOptions: provider.configOptions ?? [],
    capabilities: provider.capabilities ?? {},
  }
}

function normalizeProviders(response: ProvidersResponse): ProvidersResponse {
  const providers = (response.providers ?? []).map(normalizeProvider)
  return { ...response, providers }
}

export interface SessionHistory {
  session_id: string
  messages: AgentMessage[]
  events: AgentEvent[]
  terminal_output: Array<{ sequence: number; data: string; timestamp: string }>
}

export const sessionsApi = {
  list: () =>
    request<{ sessions: Session[]; total: number }>('/api/sessions').then((body) => body.sessions),

  get: (id: string) => request<Session>(`/api/sessions/${encodeURIComponent(id)}`),

  /**
   * Create and start a session. `model` is applied before the first prompt, so
   * turn one already runs on the chosen model.
   */
  create: (body: CreateSessionRequest) =>
    request<Session & { spawned: boolean }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Persisted history, for hydrating a session on open or after a reload. */
  history: (id: string) =>
    request<SessionHistory>(`/api/sessions/${encodeURIComponent(id)}/transcripts`),

  /** Stop the agent process. This really kills it, not just the UI state. */
  kill: (id: string) =>
    request<{ killed: boolean }>(`/api/sessions/${encodeURIComponent(id)}/kill`, {
      method: 'POST',
    }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Restart the agent so a stopped or imported session can continue.
   *
   * A refusal (wrong state, unsupported provider) arrives as
   * `{"success": false, "error": "…"}` with HTTP 200, which `request` turns into
   * a thrown `ApiError` carrying the backend's reason — so callers get the
   * explanation rather than a generic failure.
   */
  resume: (id: string) =>
    request<{ success: boolean; status?: string; message?: string; spawned?: boolean }>(
      `/api/sessions/${encodeURIComponent(id)}/resume`,
      { method: 'POST', body: JSON.stringify({ session_id: id }) },
    ),

  archive: (id: string) =>
    request<{ archived: boolean }>(`/api/sessions/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    }),

  /**
   * Sessions that exist in each CLI's own history but not here yet. Read-only,
   * so it is safe to call whenever the sync UI opens.
   */
  discover: () => request<DiscoverResponse>('/api/sessions/discover'),

  /**
   * Adopt discovered sessions. Idempotent by `(agent, externalId)`: syncing twice
   * counts the second pass as skipped rather than duplicating rows.
   *
   * `only` imports a subset; omitted means everything discovered.
   */
  sync: (only?: Array<{ agent: string; externalId: string }>) =>
    request<SyncResponse>('/api/sessions/sync', {
      method: 'POST',
      body: JSON.stringify(only ? { only } : {}),
    }),
}

export interface DirListing {
  path: string
  exists: boolean
  home: string
  parent?: string | null
  roots: Array<{ name: string; path: string }>
  entries: Array<{ name: string; path: string; dir?: boolean }>
}

/** Workspace browsing for the project picker and the @context menu. */
export interface TunnelState {
  kind: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  url?: string | null
  ip?: string | null
  error?: string | null
}

/** Native tunnel control — bring Tailscale / Cloudflare up from the UI. */
export const tunnelApi = {
  status: () => request<{ tailscale: unknown; cloudflare: unknown }>('/api/tunnel/status'),
  start: (kind: 'tailscale' | 'cloudflare') =>
    request<TunnelState>(`/api/tunnel/${kind}/start`, { method: 'POST' }),
  stop: (kind: 'tailscale' | 'cloudflare') =>
    request<TunnelState>(`/api/tunnel/${kind}/stop`, { method: 'POST' }),
}

export interface WorktreeInfo {
  name?: string
  path?: string
  branch?: string
  head?: string
  [key: string]: unknown
}

export interface WorkspaceOverview {
  worktrees?: WorktreeInfo[]
  changed_files?: Array<{ path: string; status?: string; [key: string]: unknown }>
  diffs?: Record<string, string>
  [key: string]: unknown
}

/** Session-scoped workspace data for the right-side panels. */
export const sessionWorkspaceApi = {
  overview: (sessionId: string) =>
    request<WorkspaceOverview>(
      `/api/workspace/overview?session=${encodeURIComponent(sessionId)}`,
    ),
  worktrees: (project: string) =>
    request<{ worktrees: WorktreeInfo[] }>(
      `/api/worktrees?project=${encodeURIComponent(project)}`,
    ),
}

export const workspaceApi = {
  dirs: (path?: string, files = false) =>
    request<DirListing>(
      `/api/workspace/dirs?${[
        path ? `path=${encodeURIComponent(path)}` : '',
        files ? 'files=1' : '',
      ]
        .filter(Boolean)
        .join('&')}`,
    ),
}

export const configApi = {
  /** Current dimensions. `live: true` means these came from the running agent. */
  get: (sessionId: string) =>
    request<{ config: SessionConfig }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/config`,
    ).then((body) => body.config),

  /**
   * Change one dimension.
   *
   * Resolves even when the provider declines — inspect `applied`. `value` is sent
   * verbatim: model ids are opaque and must not be rewritten in transit.
   */
  update: (sessionId: string, configId: string, value: string) =>
    request<ConfigUpdateResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ configId, value }),
    }),
}

export interface PairingOffer {
  offer_id: string
  /** A full URL the phone can open directly — encode this in the QR code. */
  qr_data: string
  /** Short hash of the offer secret, for out-of-band confirmation. */
  fingerprint: string
  expires_at: string
  status: string
  endpoint?: {
    base_url: string
    source: string
    host: string
    port: number
    secure: boolean
    reachable: boolean
  }
}

export interface PairedDevice {
  verified: boolean
  token: string
  device_id: string
  device_name: string
  fingerprint: string
  paired_at: string
}

export const pairingApi = {
  /** Start a pairing offer. Valid for two minutes. */
  offer: () => request<PairingOffer>('/api/pair', { method: 'POST' }),

  /**
   * Where this machine is reachable from — Tailnet / Cloudflare / LAN —
   * without minting an offer. Read-only; powers the Remote screen.
   */
  endpoint: () =>
    request<{
      endpoint: {
        base_url: string
        source: string
        host: string
        port: number
        secure: boolean
        reachable: boolean
      }
    }>('/api/pair/endpoint'),

  /**
   * Complete pairing from the phone.
   *
   * `deviceKey` is an opaque per-device value; the server stores it and returns a
   * bearer token exactly once. Note the response uses `verified: false` plus an
   * `error` for failure, which `request` already surfaces as a thrown ApiError.
   */
  verify: (input: {
    offerId: string
    secret: string
    deviceKey: string
    deviceName: string
  }) =>
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

export interface PairedDeviceInfo {
  id: string
  name: string
  fingerprint: string
  paired_at: string
  last_seen?: string | null
}

/** Paired remote controls. Management stays in the browser — no app needed. */
export const devicesApi = {
  list: () => request<{ devices: PairedDeviceInfo[] }>('/api/devices'),
  revoke: (id: string) =>
    request<{ revoked: boolean }>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

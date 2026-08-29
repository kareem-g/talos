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
  ConfigOption,
  ConfigUpdateResponse,
  Provider,
  ProvidersResponse,
  SessionConfig,
} from '@/types/provider'
import type { CreateSessionRequest, DiscoverResponse, Session, SyncResponse } from '@/types/session'
import type { AgentEvent, AgentMessage } from '@/types/protocol'
import type { AttachmentRef } from '@/types/conversation'

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

/** Custom API provider configs (OpenAI-compatible / Anthropic-compatible). */
export interface ApiProviderConfig {
  id: string
  name: string
  api_url: string
  transport: 'openai_compatible' | 'anthropic_compatible'
  models: string[]
  default_model?: string | null
  has_key: boolean
}

export const apiProvidersApi = {
  list: () => request<{ providers: ApiProviderConfig[] }>('/api/providers/api').then((r) => r.providers),
  create: (body: {
    id: string
    name: string
    api_url: string
    api_key?: string
    transport?: string
    models?: string[]
    default_model?: string
  }) => request<{ ok: boolean; id: string }>('/api/providers/api', { method: 'POST', body: JSON.stringify(body) }),
  remove: (id: string) =>
    request<{ ok: boolean }>('/api/providers/api/' + encodeURIComponent(id), { method: 'DELETE' }),
  test: (body: { id: string; name: string; api_url: string; api_key?: string; transport?: string }) =>
    request<{ ok: boolean; models?: string[]; error?: string }>('/api/providers/api/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

/**
 * Guarantee that collections are arrays and capabilities is an object.
 *
 * The backend always sends them, but a single missing array here becomes a
 * blank screen — the whole UI unmounts on `undefined.length`. Normalizing at the
 * one place data enters is cheaper than defending at every render site.
 */
function normalizeOption(option: ConfigOption): ConfigOption {
  return {
    ...option,
    choices: option.choices ?? [],
    allowsCustomValue: option.allowsCustomValue ?? false,
    mutability: option.mutability ?? 'live',
    currentValue: option.currentValue ?? undefined,
  }
}

function normalizeProvider(provider: Provider): Provider {
  return {
    ...provider,
    models: provider.models ?? [],
    configOptions: (provider.configOptions ?? []).map(normalizeOption),
    capabilities: provider.capabilities ?? {},
  }
}

function normalizeSessionConfig(config: SessionConfig): SessionConfig {
  return {
    ...config,
    options: (config.options ?? []).map(normalizeOption),
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
  /** Pending AskUserQuestion cards to hydrate on replay (live ones arrive via WS). */
  questions?: Array<{
    question_id: string
    session_id: string
    title: string
    question: string
    options: Array<{ id: string; label: string; description?: string; allows_custom_text?: boolean }>
    selection_mode: string
    status: string
  }>
  /** Pending permission approvals to hydrate on replay. */
  approvals?: Array<{ id: string; prompt: string; options: string[]; risk_level?: string }>
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
  overview: (project: string) =>
    request<WorkspaceOverview>(
      `/api/workspace/overview?project=${encodeURIComponent(project)}`,
    ),
  file: (project: string, path: string) =>
    request<{ path: string; contents: string; error?: string }>(
      `/api/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`,
    ),
}

/** Skills management: the backend owns `.agentdeck/skills/` per project.
 *  `list`/`get` read the on-disk catalog (bundled + ~/.claude + ~/.hermes);
 *  the management calls read and write the project's installed skills. */
export interface RegistrySkill {
  id: string
  name: string
  description: string
  author?: string
  version?: string
  category?: string
}
export interface InstalledSkill {
  id: string
  name: string
  enabled: boolean
  path: string
}
export type InstallSource =
  | { kind: 'registry'; skill_id: string }
  | { kind: 'url'; url: string; name?: string }
  | { kind: 'skillssh'; url: string; name?: string }
  | { kind: 'content'; name: string; content: string }

export const skillsApi = {
  list: () =>
    request<{ skills: Array<{ name: string; description: string; source?: string }> }>('/api/skills'),
  get: (name: string) =>
    request<{ name: string; source: string; content: string }>(
      `/api/skills/${encodeURIComponent(name)}`,
    ),
  available: () =>
    request<{ skills: RegistrySkill[] }>('/api/skills/available'),
  installed: (project: string) =>
    request<{ skills: InstalledSkill[] }>(
      `/api/skills/installed?project=${encodeURIComponent(project)}`,
    ),
  install: (source: InstallSource, project: string) =>
    request<{ path: string; installed: boolean }>('/api/skills/install', {
      method: 'POST',
      body: JSON.stringify({
        // Map the discriminated union onto the backend's InstallRequest.
        skill_id: source.kind === 'registry' ? source.skill_id : undefined,
        url: source.kind === 'url' ? source.url : undefined,
        skillssh: source.kind === 'skillssh' ? source.url : undefined,
        content: source.kind === 'content' ? source.content : undefined,
        name:
          source.kind === 'url' || source.kind === 'skillssh'
            ? source.name
            : source.kind === 'content'
              ? source.name
              : undefined,
        project,
      }),
    }),
  toggle: (id: string, enabled: boolean, project: string) =>
    request<{ skill_id: string; enabled: boolean }>(
      `/api/skills/${encodeURIComponent(id)}/toggle`,
      { method: 'PUT', body: JSON.stringify({ enabled, project }) },
    ),
  uninstall: (id: string, project: string) =>
    request<{ skill_id: string; uninstalled: boolean }>(
      `/api/skills/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
      { method: 'DELETE' },
    ),
  update: (id: string, content: string, project: string) =>
    request<{ skill_id: string; updated: boolean }>(
      `/api/skills/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify({ content, project }) },
    ),
  content: (id: string, project: string) =>
    request<{ skill_id: string; path: string; content: string }>(
      `/api/skills/${encodeURIComponent(id)}/content?project=${encodeURIComponent(project)}`,
    ),
}

/* ── Git operations (branch panel / git tab) ─────────────────────────────── */

export interface GitBranch {
  name: string
  head?: string
  current?: boolean
}

export interface GitState {
  branches: GitBranch[]
  current?: string
  changed_count: number
  added: number
  removed: number
}

export interface CommitResult {
  ok: boolean
  head?: string | null
  output?: string
  pushed?: boolean
  push_error?: string | null
  push_output?: string
}

export interface GitCommitEntry {
  hash: string
  short: string
  author: string
  email?: string
  date: string
  message: string
  refs?: string[]
}

export const gitApi = {
  /** Branches + diff totals for a project directory. */
  branches: (project: string) =>
    request<GitState>(`/api/git/branches?project=${encodeURIComponent(project)}`),

  /** Recent commit history for the Git Graph modal. */
  log: (project: string, limit = 200) =>
    request<{ commits: GitCommitEntry[] }>(
      `/api/git/log?project=${encodeURIComponent(project)}&limit=${limit}`,
    ),

  checkout: (project: string, branch: string) =>
    request<{ ok: boolean; output?: string }>(`/api/git/checkout?project=${encodeURIComponent(project)}&branch=${encodeURIComponent(branch)}`, { method: 'POST', body: JSON.stringify({ project }) }),

  createBranch: (project: string, name: string) =>
    request<{ ok: boolean; output?: string }>(`/api/git/branch?project=${encodeURIComponent(project)}`, {
      method: 'POST',
      body: JSON.stringify({ project, name }),
    }),

  /** Stage everything, commit, optionally push. Real git stderr comes back in `error`. */
  commit: (project: string, message: string, push = false) =>
    request<CommitResult>(`/api/git/commit?project=${encodeURIComponent(project)}`, {
      method: 'POST',
      body: JSON.stringify({ project, message, push }),
    }),

  /** Per-file diff for a file the agent edited. Resolves project from a session. */
  diff: (project: string, path: string, session?: string) =>
    request<{ path: string; diff: string }>(
      `/api/git/diff?${[
        `project=${encodeURIComponent(project)}`,
        `path=${encodeURIComponent(path)}`,
        session ? `session=${encodeURIComponent(session)}` : '',
      ]
        .filter(Boolean)
        .join('&')}`,
    ),
}

/* ── Built-in browser (CDP) automation ────────────────────────────────────── */

export interface BrowserInstance {
  session_id: string
  pid: number
  http_port: number
  state?: { ok: boolean } | Record<string, unknown>
}

export const browserApi = {
  status: () => request<{ sessions: BrowserInstance[] }>('/api/browser'),

  start: (sessionId: string) =>
    request<{ ok: boolean; http_port?: number; pid?: number; error?: string }>('/api/browser/start', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),

  stop: (sessionId: string) =>
    request<{ ok: boolean }>('/api/browser/stop', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),

  state: (sessionId: string) =>
    request<{ ok: boolean; tabs?: Array<{ id: string; url: string; title: string }> }>(
      `/api/browser/${encodeURIComponent(sessionId)}/state`,
    ),

  screenshotUrl: (sessionId: string, tabId: string) =>
    `/api/browser/${encodeURIComponent(sessionId)}/screenshot/${encodeURIComponent(tabId)}`,
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

/**
 * Upload files to a session's scratch dir.
 *
 * Multipart, so this cannot go through `request` (which pins
 * `Content-Type: application/json` whenever a body is present — the browser
 * must set the multipart boundary itself). It reuses the same auth header and
 * error-envelope handling as every other call here.
 */
export const attachmentsApi = {
  upload: async (sessionId: string, files: File[]): Promise<AttachmentRef[]> => {
    if (files.length === 0) return []
    const form = new FormData()
    for (const file of files) form.append(file.name, file)

    const headers = new Headers()
    const token = deviceToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    let response: Response
    try {
      response = await fetch(
        `/api/attachments/upload?session=${encodeURIComponent(sessionId)}`,
        { method: 'POST', body: form, headers },
      )
    } catch (cause) {
      throw new ApiError(
        cause instanceof Error ? cause.message : 'Upload failed',
        0,
        'network_error',
      )
    }

    const body = await response.text()
    let parsed: { attachments?: AttachmentRef[]; error?: string } | null = null
    if (body.length > 0) {
      try {
        parsed = JSON.parse(body)
      } catch {
        throw new ApiError('Malformed upload response', response.status, 'malformed_response')
      }
    }
    if (parsed && typeof parsed.error === 'string') {
      throw new ApiError(parsed.error, response.status)
    }
    if (!response.ok) {
      throw new ApiError(`Upload failed (${response.status})`, response.status)
    }
    return parsed?.attachments ?? []
  },
  /** Fetch a previously uploaded attachment by session and file name. */
  get: async (sessionId: string, fileName: string): Promise<Blob> => {
    const token = deviceToken()
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(
      `/api/attachments/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`,
      { headers },
    )
    if (!response.ok) throw new ApiError(`Fetch attachment failed (${response.status})`, response.status)
    return response.blob()
  },
}

/* ── Standalone PTY terminals ────────────────────────────────────────────── */

export interface StandaloneTerminal {
  id: string
  pid?: number
  cwd?: string | null
  created_at?: string
}

export const terminalsApi = {
  list: () => request<{ terminals: StandaloneTerminal[] }>('/api/terminals'),
  create: (cwd?: string) =>
    request<StandaloneTerminal>('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({ cwd }),
    }),
  close: (id: string) =>
    request<{ closed: boolean }>(`/api/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}


export const configApi = {
  /** Current dimensions. `live: true` means these came from the running agent. */
  get: (sessionId: string) =>
    request<{ config: SessionConfig }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/config`,
    ).then((body) => normalizeSessionConfig(body.config)),

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
    }).then((body) => ({ ...body, config: normalizeSessionConfig(body.config) })),
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

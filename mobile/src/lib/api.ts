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
  config: (id: string) => request<{ config: unknown }>(`/api/mobile/sessions/${encodeURIComponent(id)}/config`),
  resume: (id: string) =>
    request<{ session?: Session }>(`/api/mobile/sessions/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      body: JSON.stringify({ session_id: id }),
    }),
  fork: (id: string) =>
    request<{ session?: Session }>(`/api/mobile/sessions/${encodeURIComponent(id)}/fork`, { method: 'POST' }),
  switchEngine: (id: string, agent: string, model?: string) =>
    request<{ switched: boolean; error?: string }>(
      `/api/mobile/sessions/${encodeURIComponent(id)}/engine`,
      { method: 'POST', body: JSON.stringify({ agent, ...(model ? { model } : {}) }) },
    ),
  spawnSubagent: (
    id: string,
    body: { prompt: string; agent?: string; role?: string; model?: string; max_cost_usd?: number },
  ) =>
    request<{ child_session_id?: string; agent?: string; status?: string; reply?: string; error?: string }>(
      `/api/mobile/sessions/${encodeURIComponent(id)}/subagents`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  orchestrate: (id: string, body: { prompt: string; agents: string[]; merge?: boolean }) =>
    request<Record<string, unknown>>(
      `/api/mobile/sessions/${encodeURIComponent(id)}/orchestrate`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  trajectories: (id: string) =>
    request<{ transcripts?: unknown[]; events?: unknown[] }>(
      `/api/mobile/sessions/${encodeURIComponent(id)}/transcripts`,
    ),
  /** Save this session's conversation as a project memory on the desktop. */
  saveMemory: (id: string, title?: string) =>
    request<{ saved?: boolean; id?: string; error?: string }>(
      `/api/mobile/sessions/${encodeURIComponent(id)}/memory`,
      { method: 'POST', body: JSON.stringify(title ? { title } : {}) },
    ),
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

/** A stored attachment, in the shape the shared conversation model expects. */
export interface UploadedAttachment {
  ref: string
  name: string
  fileName: string
  contentType?: string
  size: number
  path: string
}

export const attachmentsApi = {
  /**
   * Upload one local file. `FormData` with a `{ uri, name, type }` part is how
   * React Native streams a file, so no blob has to be read into JS memory.
   */
  upload: async (sessionId: string, file: { uri: string; name: string; type?: string }) => {
    const form = new FormData()
    // RN's FormData accepts this shape at runtime; the cast satisfies TS, which
    // models the DOM's File/Blob union instead.
    form.append(file.name, { uri: file.uri, name: file.name, type: file.type ?? 'application/octet-stream' } as never)
    const token = deviceToken()
    const target = resolveApiUrl(
      `/api/mobile/attachments/upload?session=${encodeURIComponent(sessionId)}`,
    )
    let response: Response
    try {
      response = await fetch(target, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new ApiError(`Upload failed: ${reason}`, 0, 'network_error')
    }
    const body = await response.text()
    let parsed: { attachments?: UploadedAttachment[]; error?: string } | null = null
    if (body.length > 0) {
      try {
        parsed = JSON.parse(body)
      } catch {
        // The daemon serves the dashboard SPA for any path it does not know, so
        // an HTML body here means this route does not exist on that build — an
        // older daemon, not a broken upload. Saying "malformed" sent people
        // looking in the wrong place.
        const looksLikeHtml = /^\s*</.test(body)
        throw new ApiError(
          looksLikeHtml
            ? 'The daemon does not have the attachments route — it is running an older build. Rebuild and restart it.'
            : 'Malformed upload response',
          response.status,
          looksLikeHtml ? 'route_missing' : 'malformed_response',
        )
      }
    }
    if (parsed?.error) throw new ApiError(parsed.error, response.status)
    if (!response.ok) throw new ApiError(`Upload failed (${response.status})`, response.status)
    return parsed?.attachments ?? []
  },
}

/* ── Git ─────────────────────────────────────────────────────────────────── */

export interface GitBranch {
  name: string
  current?: boolean
  [key: string]: unknown
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

/** Git operations, against the same handlers the desktop dashboard calls. */
export const gitApi = {
  branches: (project: string) =>
    request<GitState>(`/api/mobile/git/branches?project=${encodeURIComponent(project)}`),
  log: (project: string, limit = 200) =>
    request<{ commits: Array<{ sha: string; message: string; author?: string; date?: string }> }>(
      `/api/mobile/git/log?project=${encodeURIComponent(project)}&limit=${limit}`,
    ),
  checkout: (project: string, branch: string) =>
    request<{ ok: boolean; output?: string }>(
      `/api/mobile/git/checkout?project=${encodeURIComponent(project)}&branch=${encodeURIComponent(branch)}`,
      { method: 'POST', body: JSON.stringify({ project, branch }) },
    ),
  createBranch: (project: string, name: string) =>
    request<{ ok: boolean; output?: string }>(
      `/api/mobile/git/branch?project=${encodeURIComponent(project)}`,
      { method: 'POST', body: JSON.stringify({ project, name }) },
    ),
  commit: (project: string, message: string, push = false) =>
    request<CommitResult>(`/api/mobile/git/commit?project=${encodeURIComponent(project)}`, {
      method: 'POST',
      body: JSON.stringify({ project, message, push }),
    }),
  /** Per-file diff, for the transcript's file chips. */
  diff: (project: string, path: string, session?: string) =>
    request<{ path: string; diff: string }>(
      `/api/mobile/git/diff?${[
        `project=${encodeURIComponent(project)}`,
        `path=${encodeURIComponent(path)}`,
        session ? `session=${encodeURIComponent(session)}` : '',
      ]
        .filter(Boolean)
        .join('&')}`,
    ),
}

/* ── Workspace ───────────────────────────────────────────────────────────── */

export interface DirEntry {
  name: string
  path: string
  dir: boolean
}

export interface DirListing {
  path: string
  exists: boolean
  home?: string
  parent?: string
  roots?: string[]
  entries: DirEntry[]
}

export interface WorkspaceOverview {
  worktrees?: Array<{ path: string; branch?: string; [key: string]: unknown }>
  changed_files?: Array<{ path: string; status?: string; [key: string]: unknown }>
  diffs?: Record<string, string>
  [key: string]: unknown
}

export const workspaceApi = {
  dirs: (path?: string, files = false) =>
    request<DirListing>(
      `/api/mobile/workspace/dirs?${[path ? `path=${encodeURIComponent(path)}` : '', files ? 'files=1' : '']
        .filter(Boolean)
        .join('&')}`,
    ),
  overview: (project: string) =>
    request<WorkspaceOverview>(`/api/mobile/workspace/overview?project=${encodeURIComponent(project)}`),
  /** Session-scoped overview — resolves the project server-side. */
  sessionOverview: (sessionId: string) =>
    request<WorkspaceOverview>(`/api/mobile/workspace/overview?session=${encodeURIComponent(sessionId)}`),
  file: (project: string, path: string) =>
    request<{ path: string; contents: string; error?: string }>(
      `/api/mobile/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`,
    ),
  serveStatus: (project: string) =>
    request<{ running?: boolean; port?: number; url?: string }>(
      `/api/mobile/workspace/serve?project=${encodeURIComponent(project)}`,
    ),
  serveStart: (project: string, command?: string) =>
    request<{ ok: boolean; port?: number; error?: string }>('/api/mobile/workspace/serve/start', {
      method: 'POST',
      body: JSON.stringify({ project, ...(command ? { command } : {}) }),
    }),
  serveStop: (project: string) =>
    request<{ ok: boolean }>('/api/mobile/workspace/serve/stop', {
      method: 'POST',
      body: JSON.stringify({ project }),
    }),
  worktrees: () =>
    request<{ worktrees: Array<{ path: string; branch?: string; head?: string }> }>(
      '/api/mobile/worktrees',
    ),
}

/* ── Browser (CDP) ───────────────────────────────────────────────────────── */

export interface BrowserInstance {
  session_id: string
  running?: boolean
  url?: string
  [key: string]: unknown
}

export const browserApi = {
  status: () => request<{ sessions: BrowserInstance[] }>('/api/mobile/browser'),
  start: (sessionId: string) =>
    request<{ ok: boolean; http_port?: number; error?: string }>('/api/mobile/browser/start', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),
  stop: (sessionId: string) =>
    request<{ ok: boolean }>('/api/mobile/browser/stop', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),
  state: (sessionId: string) =>
    request<{
      ok: boolean
      tabs?: Array<{ id: string; url: string; title: string }>
      viewport?: { width: number; height: number }
      persistent?: boolean
    }>(`/api/mobile/browser/${encodeURIComponent(sessionId)}/state`),
  /** Drive the agent's CDP engine manually. Same tools the agent calls over MCP. */
  tool: (sessionId: string, name: string, args: Record<string, unknown> = {}) =>
    request<{ ok: boolean; result?: unknown; error?: string }>(
      `/api/mobile/browser/${encodeURIComponent(sessionId)}/tool`,
      { method: 'POST', body: JSON.stringify({ name, args }) },
    ),
  /**
   * A tab screenshot. The route needs the device token, which `<Image source>`
   * cannot send, so the bytes are fetched with auth and handed back as a data
   * URI the image component can render.
   */
  screenshot: (sessionId: string, tab: string) =>
    requestDataUri(
      `/api/mobile/browser/${encodeURIComponent(sessionId)}/screenshot/${encodeURIComponent(tab)}`,
    ),
}

/* ── Skills ──────────────────────────────────────────────────────────────── */

export interface InstalledSkill {
  id: string
  name: string
  description?: string
  enabled: boolean
  [key: string]: unknown
}

export interface RegistrySkill {
  id: string
  name: string
  description?: string
  author?: string
  version?: string
  category?: string
}

export const skillsApi = {
  list: () =>
    request<{ skills: Array<{ name: string; description?: string; source?: string }> }>('/api/mobile/skills'),
  available: () => request<{ skills: RegistrySkill[] }>('/api/mobile/skills/available'),
  installed: (project: string) =>
    request<{ skills: InstalledSkill[] }>(`/api/mobile/skills/installed?project=${encodeURIComponent(project)}`),
  toggle: (id: string, project: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/api/mobile/skills/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ project, enabled }),
    }),
  install: (body: Record<string, unknown>) =>
    request<{ path: string; installed: boolean }>('/api/mobile/skills/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  content: (id: string, project: string) =>
    request<{ content: string }>(
      `/api/mobile/skills/${encodeURIComponent(id)}/content?project=${encodeURIComponent(project)}`,
    ),
  uninstall: (name: string, project: string) =>
    request<{ ok: boolean }>(
      `/api/mobile/skills/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`,
      { method: 'DELETE' },
    ),
}

/* ── Rooms, MCP, memory, providers, settings, terminals ──────────────────── */

export const roomsApi = {
  list: () => request<{ rooms: Array<{ id: string; name: string; session_id?: string; workers?: unknown[] }> }>('/api/mobile/rooms'),
}

export const mcpApi = {
  list: () => request<{ servers: Array<{ name: string; command?: string; enabled?: boolean }> }>('/api/mobile/mcp'),
  add: (body: Record<string, unknown>) =>
    request<{ ok: boolean }>('/api/mobile/mcp', { method: 'POST', body: JSON.stringify(body) }),
  remove: (name: string) =>
    request<{ ok: boolean }>(`/api/mobile/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' }),
}

export const providersApi = {
  list: () => request<{ providers: unknown[] }>('/api/mobile/providers'),
  refresh: () => request<{ providers: unknown[] }>('/api/mobile/providers/refresh', { method: 'POST' }),
}

export const settingsApi = {
  get: () => request<{ settings: Record<string, unknown>; config_path?: string }>('/api/mobile/settings'),
  update: (patch: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>('/api/mobile/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
}

export const terminalsApi = {
  list: () => request<{ terminals: Array<{ id: string; cwd?: string }> }>('/api/mobile/terminals'),
  create: (cwd?: string) =>
    request<{ terminal: { id: string } }>('/api/mobile/terminals', {
      method: 'POST',
      body: JSON.stringify({ cwd }),
    }),
  close: (id: string) =>
    request<{ ok: boolean }>(`/api/mobile/terminals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/** Remote-access surface: the routes this device uses, and the paired devices. */
export const remoteApi = {
  endpoints: () =>
    request<{ endpoints: Array<{ base_url: string; source: string; host: string; port: number; secure: boolean; reachable: boolean; via?: string }> }>(
      '/api/mobile/tunnel/endpoints',
    ),
  status: () => request<Record<string, unknown>>('/api/mobile/tunnel/status'),
  start: (kind: 'tailscale' | 'cloudflare', body: Record<string, unknown> = {}) =>
    request<{ ok: boolean; error?: string }>(`/api/mobile/tunnel/${kind}/start`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stop: (kind: 'tailscale' | 'cloudflare') =>
    request<{ ok: boolean }>(`/api/mobile/tunnel/${kind}/stop`, { method: 'POST' }),
  devices: () =>
    request<{ devices: Array<{ id: string; name: string; fingerprint?: string; last_seen?: string; paired_at?: string }> }>(
      '/api/mobile/devices',
    ),
  revoke: (id: string) =>
    request<{ revoked: boolean }>(`/api/mobile/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const memoryApi = {
  config: (project?: string) =>
    request<{ enabled: boolean; project?: string }>(
      `/api/mobile/memory/config${project ? `?project=${encodeURIComponent(project)}` : ''}`,
    ),
  setConfig: (enabled: boolean, project?: string) =>
    request<{ enabled: boolean }>(
      `/api/mobile/memory/config${project ? `?project=${encodeURIComponent(project)}` : ''}`,
      { method: 'PUT', body: JSON.stringify({ enabled }) },
    ),
  list: (project?: string) =>
    request<{ memories: Array<{ id: string; content: string; created_at: string }> }>(
      `/api/mobile/memory${project ? `?project=${encodeURIComponent(project)}` : ''}`,
    ),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/api/mobile/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const syncApi = {
  discover: () =>
    request<{
      discovered: Array<{ id: string; name: string; agent: string; project?: string; updated_at?: string }>
    }>('/api/sessions/discover'),
  sync: (sessions: unknown[]) =>
    request<{ synced: number }>('/api/sessions/sync', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    }),
}

/**
 * Fetch a binary route with the device token and return it as a data URI.
 *
 * `<Image source={{ uri }}>` cannot attach an Authorization header, and the
 * mobile surface is authenticated by design, so the bytes are pulled through
 * `request`-equivalent auth and inlined instead of loosening the route.
 */
async function requestDataUri(path: string): Promise<string> {
  const token = deviceToken()
  const target = resolveApiUrl(path)
  const response = await fetch(target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) throw new ApiError(`GET ${path} failed`, response.status)
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ApiError('Could not read image data', 0, 'malformed_response'))
    reader.readAsDataURL(blob)
  })
}

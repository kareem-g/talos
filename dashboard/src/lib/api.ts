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
import { resolveApiUrl } from './native'

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
export const TOKEN_KEY = 'agentdeck-device-token'

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
  let target = path
  try {
    // Same-origin in the browser (resolveApiUrl returns the path unchanged);
    // absolute in the native shell, which is not served by the daemon.
    target = resolveApiUrl(path)
    response = await fetch(target, { ...init, headers })
  } catch (cause) {
    // WebKit reports blocked and unreachable requests with the identical,
    // content-free "Load failed", which tells you nothing about which URL was
    // even attempted. Name it, and say plainly that nothing answered — the
    // difference between "blocked" and "server said no" is the whole diagnosis.
    const reason = cause instanceof Error ? cause.message : String(cause)
    const opaque = /load failed|failed to fetch|networkerror|network request failed/i.test(reason)
    throw new ApiError(
      opaque
        ? `No response from ${target} — the request never reached the server (${reason}).`
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

  /**
   * Switch the engine backing an existing session to another ready CLI/API
   * provider, keeping the same session row and transcript. The current engine
   * is stopped and the new one is launched with a digest of the prior
   * conversation. Model changes inside the same engine go through the config
   * PATCH instead.
   */
  switchEngine: (id: string, agent: string, model?: string) =>
    request<{ switched: boolean; session?: Session; digest_chars?: number; error?: string }>(
      `/api/sessions/${encodeURIComponent(id)}/engine`,
      { method: 'POST', body: JSON.stringify(model ? { agent, model } : { agent }) },
    ),

  /**
   * Spawn a subagent (generic, or a built-in role: summarizer/planner/reviewer/
   * worker) as a hidden child of this session. The child's engine comes from
   * the configured `[agents.builtin]` default unless `agent` is given.
   */
  spawnSubagent: (
    id: string,
    body: { prompt: string; role?: string; agent?: string; max_cost_usd?: number; timeout_secs?: number },
  ) =>
    request<{
      child_session_id?: string
      agent?: string
      completed?: boolean
      status?: string
      reply?: string
      error?: string
    }>(`/api/sessions/${encodeURIComponent(id)}/subagents`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  archive: (id: string) =>
    request<{ archived: boolean }>(`/api/sessions/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    }),

  restore: (id: string) =>
    request<{ restored: boolean }>(`/api/sessions/${encodeURIComponent(id)}/restore`, {
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

/**
 * Rooms — rosters synced through the daemon, so a room created in one browser
 * appears in all of them. The backend stores the room JSON opaquely and
 * broadcasts `RoomUpsert` / `RoomDeleted` over the websocket on every write.
 */
export const roomsApi = {
  list: () => request<{ rooms: RoomRecord[] }>('/api/rooms').then((body) => body.rooms),
  upsert: (room: RoomRecord) =>
    request<RoomRecord>(`/api/rooms/${encodeURIComponent(room.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(room),
    }),
  create: (room: RoomRecord) =>
    request<RoomRecord>('/api/rooms', { method: 'POST', body: JSON.stringify(room) }),
  remove: (roomId: string) =>
    request<{ deleted: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' }),
}

/** The roster as persisted server-side (no volatile run panels). */
export interface RoomRecord {
  id: string
  name: string
  workers: Array<{
    name: string
    sessionId?: string
    avatar?: { gradient: number; emoji?: string }
    skills?: string[]
  }>
  chief?: string | null
  sessionId?: string | null
  skipPermissions?: boolean | null
  project?: string | null
  createdAt?: string
}

/** One fan-out child's outcome, as returned by the orchestrate endpoint. */
export interface OrchestrateChild {
  agent: string
  session_id: string
  reply: string
  status: string
  error?: string | null
  cost_usd?: number | null
  input_tokens?: number | null
  output_tokens?: number | null
  duration_ms?: number | null
}

export interface OrchestrateResponse {
  prompt: string
  children: OrchestrateChild[]
  merged: boolean
  merged_reply: string
  merge?: OrchestrateChild
}

/**
 * Multi-agent fan-out: run one prompt on several agents concurrently, then
 * merge their answers. Long-running — the promise resolves when the whole run
 * (children + merge) finishes; progress streams as orchestration WS events on
 * the parent session's timeline.
 */
export const orchestrationApi = {
  run: (
    sessionId: string,
    body: {
      prompt: string
      agents: string[]
      /** Per-child display names, same length as `agents`. */
      names?: string[]
      merge?: boolean
      merge_agent?: string
      /** Pin every child to this model instead of the parent's own. */
      model?: string
      /**
       * Room identity: workers are prompted as team members, the chief of
       * staff (when set) leads the merge, and the run is distilled into the
       * room's own memory store.
       */
      room?: { id: string; name: string; chief?: string | null }
      /**
       * Per-worker skill ids (registry ids), keyed by worker name. The
       * harness prompts each worker in its specialty.
       */
      worker_skills?: Record<string, string[]>
      timeout_secs?: number
    },
  ) =>
    request<OrchestrateResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/orchestrate`, {
      method: 'POST',
      body: JSON.stringify(body),
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

/** Phone-pairing payload returned after a successful Tailscale login. */
export interface PairInfo {
  /** `tailscale://…` deep link the Tailscale app parses on iOS/Android. */
  qr_payload: string
  /** Plain-https fallback for browsers / older clients. */
  fallback_url: string
  /** MagicDNS handle of this node on the user's tailnet. */
  tailnet: string
  /** Underlying preauth key — surfaced for copy-to-clipboard. */
  key: string
  /** RFC3339 expiry of the preauth key, when the server returns it. */
  expires_at?: string | null
}

/** A single transport option in the QR picker. The backend collapses all
 *  tailnet rows (MagicDNS / IPv4 / IPv6) to one — `source` is one of those
 *  three but the picker treats them all as "Tailnet". Self-hosted Headscale
 *  control planes still report via the `via` field. */
export interface EndpointOption {
  base_url: string
  /** Which transport this is — drives the label and icon. */
  source:
    | 'explicit'
    | 'cloudflare'
    | 'tailnet'
    | 'tailnet_magic_dns'
    | 'tailnet_ipv4'
    | 'tailnet_ipv6'
    | 'lan'
    | 'localhost'
    | (string & {})
  host: string
  port: number
  secure: boolean
  reachable: boolean
  /** "tailscale" or "headscale <host>" — the latter means a self-hosted
   *  control plane, surfaced honestly in the picker. */
  via?: string | null
  /** QR payload for this option (only present when returned by the pairing
   *  offer endpoint, not by the bare `/api/tunnel/endpoints` list). */
  qr_data?: string
  /** Human label the picker chip displays — server-built so it stays in
   *  sync with the source taxonomy. */
  label?: string
}

/** Response shape of GET /api/tunnel/endpoints — used by the QR method picker. */
export interface EndpointList {
  port: number
  endpoints: EndpointOption[]
  best: EndpointOption | null
}

/** Workspace browsing for the project picker and the @context menu. */
export interface TunnelState {
  kind: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  url?: string | null
  ip?: string | null
  /** Control-plane label for tailnet kinds ("tailscale", "headscale <host>"). */
  via?: string | null
  /** Connection token for token-based kinds, when active. */
  token?: string | null
  /** Phone-pairing payload, when this kind offers one. */
  pair?: PairInfo | null
  /** Human-readable error message when status is "error". */
  error?: string | null
  /** Structured failure reason — drives targeted next-step buttons. */
  error_kind?:
    | 'needs_authorization'
    | 'unreachable_control_plane'
    | 'invalid_auth_key'
    | 'daemon_not_running'
    | 'tailscale_not_installed'
    | 'tailscale_failed'
    | null
}

/** Native tunnel control — Tailscale / Cloudflare from the UI. */
export const tunnelApi = {
  status: () =>
    request<{ tailscale: unknown; cloudflare: unknown }>('/api/tunnel/status'),
  start: (
    kind: 'tailscale' | 'cloudflare',
    body?: {
      /** Cloudflare tunnel token (long-lived secret). Persisted to settings
       *  when present so subsequent bring-ups don't need it re-typed. */
      token?: string
      /** Cloudflare tunnel hostname, e.g. agentdeck.example.com. */
      hostname?: string
    },
  ) =>
    request<TunnelState>(`/api/tunnel/${kind}/start`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  stop: (kind: 'tailscale' | 'cloudflare') =>
    request<TunnelState>(`/api/tunnel/${kind}/stop`, { method: 'POST' }),
  /** Every reachable transport (LAN, Tailnet, Cloudflare, …) — feeds the
   *  "pick where your phone is" QR picker on the home page. */
  endpoints: () => request<EndpointList>('/api/tunnel/endpoints'),
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
  /** Per-workspace memory setting: whether memory is enabled for this project. */
  memoryConfig: (project: string) =>
    request<{ enabled: boolean }>(
      `/api/memory/config?project=${encodeURIComponent(project)}`,
    ),
  /** Turn workspace memory on/off. */
  setMemoryConfig: (project: string, enabled: boolean) =>
    request<{ ok: boolean; enabled: boolean }>('/api/memory/config', {
      method: 'PUT',
      body: JSON.stringify({ project, enabled }),
    }),
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

  /** Drive the agent's CDP engine manually (goto, reload, …). Same tools the
   * agent calls over MCP, so manual actions land in the timeline too. */
  tool: (sessionId: string, name: string, args: Record<string, unknown> = {}) =>
    request<{ ok: boolean; result?: unknown; error?: string }>(
      `/api/browser/${encodeURIComponent(sessionId)}/tool`,
      {
        method: 'POST',
        body: JSON.stringify({ name, arguments: args }),
      },
    ),

  screenshotUrl: (sessionId: string, tabId: string) =>
    `/api/browser/${encodeURIComponent(sessionId)}/screenshot/${encodeURIComponent(tabId)}`,
}

/* ── Workspace app server ("run this app" for the right-pane browser) ─────── */

export interface AppServeStatus {
  running: boolean
  port?: number
  command?: string
  error?: string
}

export const serveApi = {
  status: (project: string) =>
    request<AppServeStatus>(`/api/workspace/serve?project=${encodeURIComponent(project)}`),
  start: (project: string, command?: string) =>
    request<{ ok: boolean; port?: number; pid?: number; error?: string }>(
      '/api/workspace/serve/start',
      {
        method: 'POST',
        body: JSON.stringify({ project, ...(command?.trim() ? { command } : {}) }),
      },
    ),
  stop: (project: string) =>
    request<{ ok: boolean }>('/api/workspace/serve/stop', {
      method: 'POST',
      body: JSON.stringify({ project }),
    }),
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
  /** A full URL the phone can open directly — encode this in the QR code.
   *  Defaults to the best endpoint. The picker may swap this for an
   *  option from `qr_options` when the user picks a different transport. */
  qr_data: string
  /** Per-transport QR payloads — drives the "pick where your phone is"
   *  picker. First entry is the recommended default. */
  qr_options?: EndpointOption[]
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
    via?: string | null
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
        /** Control-plane label for tailnet paths ("tailscale", "headscale <host>"). */
        via?: string | null
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

/** Persisted settings — the operator's tunnel token, hostname, and which
 *  transports are enabled. Mirrors the TOML fields the daemon reads on boot. */
export interface CloudflareSettings {
  enabled: boolean
  token: string | null
  hostname: string | null
  tunnel_id: string | null
}

export interface TunnelSettings {
  cloudflare: CloudflareSettings
}

export interface BuiltinEngineSettings {
  summarizer?: string | null
  planner?: string | null
  reviewer?: string | null
  worker?: string | null
}

/** `[agents.context_windows]` — provider (or `provider/model`) → token budget. */
export type ContextWindowSettings = Record<string, number>

export interface SettingsPayload {
  tunnel?: {
    cloudflare?: {
      enabled?: boolean
      token?: string
      hostname?: string
    }
  }
  agents?: {
    builtin?: BuiltinEngineSettings
    /** Serialized snake_case, matching the backend's Settings struct. */
    context_windows?: ContextWindowSettings
  }
}

export const settingsApi = {
  get: () =>
    request<{
      settings: {
        tunnel: TunnelSettings
        agents?: { builtin?: BuiltinEngineSettings; context_windows?: ContextWindowSettings }
      }
    }>('/api/settings'),
  update: (body: SettingsPayload) =>
    request<{ ok: boolean }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
}

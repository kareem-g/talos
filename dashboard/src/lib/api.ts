import { deviceAuthHeaders } from './auth'
import type {
  MobileAgent,
  MobileCreateSessionRequest,
  MobileMe,
  MobileSession,
  MobileSessionPayload,
  MobileSnapshot,
} from '../types/mobile'

const API_BASE = '/api'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function fetchApi<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...deviceAuthHeaders(),
      ...options?.headers,
    },
  })
  const data = await res.json().catch(() => ({})) as { error?: string; code?: string }
  if (!res.ok) throw new ApiError(res.status, data.error || `API error: ${res.status}`, data.code)
  return data as T
}

export const api = {
  sessions: {
    list: () => fetchApi('/sessions'),
    get: (id: string) => fetchApi(`/sessions/${id}`),
    create: (data: unknown) => fetchApi('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    kill: (id: string) => fetchApi(`/sessions/${id}/kill`, { method: 'POST' }),
    archive: (id: string) => fetchApi<{ archived: boolean; session_id: string }>(`/sessions/${id}/archive`, { method: 'POST' }),
    restore: (id: string) => fetchApi<{ restored: boolean; session_id: string }>(`/sessions/${id}/restore`, { method: 'POST' }),
    delete: (id: string) => fetchApi<{ deleted: boolean; session_id: string }>(`/sessions/${id}`, { method: 'DELETE' }),
    resume: (id: string) =>
      fetchApi<{ success: boolean; session_id: string; status: string; error?: string; message?: string }>(
        `/sessions/${id}/resume`,
        { method: 'POST', body: JSON.stringify({ session_id: id }) },
      ),
  },
  agents: {
    list: () => fetchApi('/agents'),
  },
  mcp: {
    list: () => fetchApi('/mcp'),
    add: (data: unknown) => fetchApi('/mcp', { method: 'POST', body: JSON.stringify(data) }),
  },
  tunnel: {
    status: () => fetchApi('/tunnel/status'),
  },
  pair: {
    initiate: () => fetchApi('/pair', { method: 'POST' }),
    verify: (data: unknown) => fetchApi('/pair/verify', { method: 'POST', body: JSON.stringify(data) }),
  },
  devices: {
    list: () => fetchApi('/devices'),
    revoke: (id: string) => fetchApi(`/devices/${id}`, { method: 'DELETE' }),
  },
  workspace: {
    overview: (project: string) => fetchApi<WorkspaceOverview>(
      `/workspace/overview?project=${encodeURIComponent(project)}`,
    ),
    file: (project: string, path: string) => fetchApi<{ path: string; contents: string }>(
      `/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`,
    ),
    worktrees: (project: string) => fetchApi<{ worktrees: unknown[] }>(
      `/worktrees?project=${encodeURIComponent(project)}`,
    ),
  },
  attachments: {
    upload: (sessionId: string, file: File): Promise<{ attachments: Array<{ ref: string; name: string; fileName: string; size: number }> }> => {
      const form = new FormData()
      form.append('file', file)
      return fetch(`${API_BASE}/attachments/upload?session=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: deviceAuthHeaders(),
        body: form,
      }).then(async (res) => {
        const data = await res.json().catch(() => ({})) as { error?: string; attachments?: unknown[] }
        if (!res.ok) throw new ApiError(res.status, data.error || 'Upload failed')
        return data as { attachments: Array<{ ref: string; name: string; fileName: string; size: number }> }
      })
    },
  },
  mobile: {
    me: () => fetchApi<MobileMe>('/mobile/me'),
    snapshot: (includeArchived = false) => fetchApi<MobileSnapshot>(`/mobile/snapshot${includeArchived ? '?include_archived=true' : ''}`),
    agents: () => fetchApi<{ agents: MobileAgent[] }>('/mobile/agents'),
    session: (id: string) => fetchApi<MobileSessionPayload>(`/mobile/sessions/${id}`),
    createSession: (data: MobileCreateSessionRequest) => fetchApi<{ session: MobileSession }>(
      '/mobile/sessions',
      { method: 'POST', body: JSON.stringify(data) },
    ),
    kill: (id: string) => fetchApi<{ killed: boolean }>(`/mobile/sessions/${id}/kill`, { method: 'POST' }),
    archive: (id: string) => fetchApi<{ archived: boolean; session_id: string }>(`/mobile/sessions/${id}/archive`, { method: 'POST' }),
    restore: (id: string) => fetchApi<{ restored: boolean; session_id: string }>(`/mobile/sessions/${id}/restore`, { method: 'POST' }),
    delete: (id: string) => fetchApi<{ deleted: boolean; session_id: string }>(`/mobile/sessions/${id}`, { method: 'DELETE' }),
  },
}

export interface WorkspaceFile {
  path: string
  status: string
  staged: boolean
  diff: string
}

export interface WorkspaceOverview {
  project: string
  branch: string | null
  worktrees: Array<{ worktree?: string; HEAD?: string; branch?: string; bare?: boolean }>
  files: WorkspaceFile[]
}

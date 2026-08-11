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
  mobile: {
    me: () => fetchApi<MobileMe>('/mobile/me'),
    snapshot: () => fetchApi<MobileSnapshot>('/mobile/snapshot'),
    agents: () => fetchApi<{ agents: MobileAgent[] }>('/mobile/agents'),
    session: (id: string) => fetchApi<MobileSessionPayload>(`/mobile/sessions/${id}`),
    createSession: (data: MobileCreateSessionRequest) => fetchApi<{ session: MobileSession }>(
      '/mobile/sessions',
      { method: 'POST', body: JSON.stringify(data) },
    ),
    kill: (id: string) => fetchApi<{ killed: boolean }>(`/mobile/sessions/${id}/kill`, { method: 'POST' }),
  },
}

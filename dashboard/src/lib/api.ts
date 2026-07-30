const API_BASE = '/api'

async function fetchApi(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
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
}

import { useState, useEffect } from 'react'

interface Session {
  id: string
  name: string
  agent: string
  status: 'running' | 'waiting' | 'idle' | 'error' | 'archived'
  project?: string
  branch?: string
  updatedAt: string
  cost?: number
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/sessions')
        const data = await res.json()
        setSessions(data.sessions || [])
      } catch {
        // Demo data
        setSessions([
          {
            id: 'demo-1',
            name: 'Feature Implementation',
            agent: 'claude',
            status: 'running',
            project: '~/projects/myapp',
            branch: 'agentdeck/abc123',
            updatedAt: '2 min ago',
            cost: 0.0234,
          },
          {
            id: 'demo-2',
            name: 'Bug Fix Session',
            agent: 'codex',
            status: 'waiting',
            project: '~/projects/api',
            updatedAt: '15 min ago',
            cost: 0.0156,
          },
          {
            id: 'demo-3',
            name: 'Code Review',
            agent: 'opencode',
            status: 'idle',
            updatedAt: '1 hour ago',
          },
        ])
      } finally {
        setIsLoading(false)
      }
    }

    fetchSessions()
  }, [])

  return { sessions, isLoading }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileConnectionState } from '../types/mobile'

export interface MobileRealtimeEvent {
  type: string
  payload?: Record<string, unknown>
  event_id?: number
  timestamp?: string
}

interface MobileRealtimeState {
  connection: MobileConnectionState
  events: MobileRealtimeEvent[]
  terminalOutput: MobileRealtimeEvent[]
  lastEventId: number
  send: (message: MobileRealtimeMessage) => boolean
  retry: () => void
}

export interface MobileRealtimeMessage {
  type: string
  payload?: Record<string, unknown>
}

const MAX_EVENTS = 600

export function useMobileWebSocket(token: string | null, deviceId?: string | null): MobileRealtimeState {
  const [connection, setConnection] = useState<MobileConnectionState>(token ? 'connecting' : 'pairing')
  const [events, setEvents] = useState<MobileRealtimeEvent[]>([])
  const [terminalOutput, setTerminalOutput] = useState<MobileRealtimeEvent[]>([])
  const [lastEventId, setLastEventId] = useState(() => {
    const value = Number(localStorage.getItem('agentdeck-last-event-id') || 0)
    return Number.isFinite(value) ? value : 0
  })
  const socketRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastEventIdRef = useRef(lastEventId)
  const activeRef = useRef(true)

  const updateLastEventId = useCallback((value: number) => {
    if (!value || value <= lastEventIdRef.current) return
    lastEventIdRef.current = value
    setLastEventId(value)
    localStorage.setItem('agentdeck-last-event-id', String(value))
  }, [])

  const connect = useCallback(() => {
    if (!token || !activeRef.current || socketRef.current) return
    if (!navigator.onLine) {
      setConnection('offline')
      return
    }

    setConnection('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/mobile`)
    socketRef.current = socket

    socket.onopen = () => {
      setConnection('authenticating')
      socket.send(JSON.stringify({
        type: 'Authenticate',
        payload: { token, after_event_id: lastEventIdRef.current || null },
      }))
    }

    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as MobileRealtimeEvent
        if (event.type === 'Authenticated') {
          setConnection('connected')
        } else if (event.type === 'DeviceRevoked' && event.payload?.device_id === deviceId) {
          setConnection('device_revoked')
        } else if (event.type === 'Error') {
          const code = event.payload?.code
          if (code === 'device_revoked') {
            setConnection('device_revoked')
          } else if (code === 'auth_unavailable') {
            setConnection('session_expired')
          }
        }
        if (typeof event.event_id === 'number') updateLastEventId(event.event_id)
        if (event.type === 'TerminalOutput') {
          setTerminalOutput((current) => {
            const next = [...current, event]
            return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
          })
          return
        }
        setEvents((current) => {
          if (event.event_id && current.some((item) => item.event_id === event.event_id)) return current
          const next = [...current, event]
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
        })
      } catch {
        // A malformed realtime frame must not take down the connection.
      }
    }

    socket.onerror = () => {
      socket.close()
    }

    socket.onclose = () => {
      socketRef.current = null
      if (!activeRef.current) return
      setConnection((current) => current === 'device_revoked' ? current : 'reconnecting')
      retryTimerRef.current = setTimeout(connect, 2500)
    }
  }, [deviceId, token, updateLastEventId])

  useEffect(() => {
    activeRef.current = true
    connect()

    const handleOnline = () => {
      if (!socketRef.current) connect()
    }
    const handleOffline = () => {
      setConnection('offline')
      socketRef.current?.close()
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      activeRef.current = false
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      socketRef.current?.close()
      socketRef.current = null
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [connect])

  const send = useCallback((message: MobileRealtimeMessage) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false
    socketRef.current.send(JSON.stringify(message))
    return true
  }, [])

  const retry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    socketRef.current?.close()
    socketRef.current = null
    setConnection(token ? 'connecting' : 'pairing')
    connect()
  }, [connect, token])

  return { connection, events, terminalOutput, lastEventId, send, retry }
}

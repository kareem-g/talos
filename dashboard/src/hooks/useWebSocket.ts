import { useSyncExternalStore } from 'react'

export interface WsMessage {
  type: string
  payload?: Record<string, unknown>
}

/**
 * Single shared WebSocket connection for the whole app.
 *
 * Previously every component that called `useWebSocket()` opened its own
 * connection to `/ws`. On the session page that meant 4 concurrent connections
 * through the Vite proxy (App, Header, SessionDetail, Transcript), each with its
 * own reconnect logic — amplified further by React.StrictMode's double-mount in
 * dev. The connect/close churn surfaced as `ECONNRESET` / `EPIPE` in Vite's
 * "ws proxy socket error" logs.
 *
 * Now the connection is a module-level singleton: the first subscriber kicks it
 * off, all consumers read from the same store via `useSyncExternalStore`, and
 * the buffer is capped so terminal output can't grow it without bound.
 */

// ---- Module-level state -----------------------------------------------------

const MAX_MESSAGES = 500

const listeners = new Set<() => void>()

let ws: WebSocket | null = null
let connected = false
let messages: WsMessage[] = []
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

function emit() {
  for (const listener of listeners) listener()
}

function connect() {
  // One connection at a time — guard against double-invocation (StrictMode,
  // reconnect timer racing a subscriber, etc.).
  if (ws) return

  // Clear any pending reconnect timer so timers can't stack if a subscriber
  // triggers connect() between a drop and the scheduled retry.
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/ws`
  console.log(`[AgentDeck][WS] Connecting to ${url}...`)
  ws = new WebSocket(url)

  ws.onopen = () => {
    connected = true
    console.log('[AgentDeck][WS] Connected')
    emit()
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type) {
        console.log(`[AgentDeck][WS] Received type=${msg.type}`, msg.payload ? `session=${msg.payload.session_id || '-'}` : '')
      }
      messages = [...messages, msg]
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES)
      }
      emit()
    } catch {
      console.error('[AgentDeck][WS] Failed to parse message:', event.data.substring(0, 200))
    }
  }

  ws.onclose = (event) => {
    console.log(`[AgentDeck][WS] Disconnected (code=${event.code})`)
    connected = false
    ws = null
    emit()
    reconnectTimeout = setTimeout(connect, 3000)
  }

  ws.onerror = (error) => {
    console.error('[AgentDeck][WS] Error:', error)
    ws?.close()
  }
}

function sendMessage(msg: WsMessage): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    const json = JSON.stringify(msg)
    console.log(`[AgentDeck][WS] Sending type=${msg.type} len=${json.length}`)
    ws.send(json)
    return true
  } else {
    console.warn('[AgentDeck][WS] Cannot send — not connected')
    return false
  }
}

// ---- Store subscription ------------------------------------------------------

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    connect()
  }
  return () => {
    listeners.delete(listener)
  }
}

// Snapshots must be referentially stable between changes so React doesn't
// re-render on every subscribe call.
const getConnected = () => connected
const getMessages = () => messages

// ---- Hook --------------------------------------------------------------------

export function useWebSocket() {
  const isConnected = useSyncExternalStore(subscribe, getConnected, getConnected)
  const allMessages = useSyncExternalStore(subscribe, getMessages, getMessages)

  return { connected: isConnected, messages: allMessages, sendMessage }
}

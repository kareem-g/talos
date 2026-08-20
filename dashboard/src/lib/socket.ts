/**
 * WebSocket client.
 *
 * One socket for the whole app, owned by a module-level singleton. The old code
 * opened one per component (four per page at one point), which multiplied every
 * incoming frame by the number of listeners.
 *
 * Reconnection preserves state and resumes rather than restarting:
 *
 *   connected → disconnected → reconnecting → connected → replay from cursor
 *
 * The cursor is `after_event_id`. On reconnect the server resends everything
 * newer, which overlaps with what we already have — the reducer's id-based
 * idempotency absorbs the overlap, so nothing duplicates and nothing is lost.
 *
 * One caveat worth knowing: the server's `event_id` counter is in-memory and
 * resets to 1 when the daemon restarts. A stale cursor would then skip the whole
 * replay, so we drop the cursor when the server reports a `last_event_id` lower
 * than ours.
 */

import type { ClientFrame, ConnectionState, IncomingFrame } from '@/types/protocol'
import { isIncomingFrame } from '@/types/protocol'
import { deviceToken } from './api'

type FrameListener = (frame: IncomingFrame) => void
type StateListener = (state: ConnectionState) => void

/** Backoff schedule in ms. Caps rather than growing without bound. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000] as const

class SocketClient {
  private socket: WebSocket | null = null
  private state: ConnectionState = 'idle'
  private frameListeners = new Set<FrameListener>()
  private stateListeners = new Set<StateListener>()
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private everConnected = false
  /** Replay cursor: highest event id we have applied. */
  private cursor: number | null = null
  /** Frames queued while the socket is down, flushed on reconnect. */
  private outbox: ClientFrame[] = []
  private closedByUs = false

  getState(): ConnectionState {
    return this.state
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Remember how far we have applied, so a reconnect resumes from here. */
  setCursor(eventId: number): void {
    if (this.cursor === null || eventId > this.cursor) this.cursor = eventId
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return
    this.closedByUs = false
    this.clearTimer()

    const token = deviceToken()
    // Authenticated devices use the mobile socket, which supports replay; an
    // unauthenticated local browser uses the plain socket.
    const path = token ? '/ws/mobile' : '/ws'
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${scheme}://${window.location.host}${path}`

    this.setState(this.everConnected ? 'reconnecting' : 'connecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.everConnected = true
      if (token) {
        // The server requires Authenticate as the first frame, within 10s.
        this.sendNow({
          type: 'Authenticate',
          payload: { token, after_event_id: this.cursor },
        })
        // State becomes `connected` on Authenticated, not here — an unauthorized
        // token would otherwise show as connected for a moment.
      } else {
        this.setState('connected')
        this.flush()
      }
    }

    socket.onmessage = (message) => {
      if (typeof message.data !== 'string') return
      let parsed: unknown
      try {
        parsed = JSON.parse(message.data)
      } catch {
        return
      }
      if (!isIncomingFrame(parsed)) return
      this.handleFrame(parsed)
    }

    socket.onclose = () => {
      this.socket = null
      if (this.closedByUs) {
        this.setState('idle')
        return
      }
      this.setState('disconnected')
      this.scheduleReconnect()
    }

    socket.onerror = () => {
      // `onclose` always follows, and handles the reconnect.
    }
  }

  disconnect(): void {
    this.closedByUs = true
    this.clearTimer()
    this.socket?.close()
    this.socket = null
    this.setState('idle')
  }

  /** Send a frame, queueing it if the socket is down. */
  send(frame: ClientFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.state === 'connected') {
      this.sendNow(frame)
    } else {
      // Bounded: a long outage should not accumulate unbounded input.
      if (this.outbox.length < 50) this.outbox.push(frame)
      this.connect()
    }
  }

  /** Send a prompt to a session. */
  sendInput(sessionId: string, data: string): void {
    this.send({ type: 'Input', payload: { session_id: sessionId, data } })
  }

  /** Raw keystrokes to a session's terminal. */
  sendTerminalInput(sessionId: string, data: string): void {
    this.send({ type: 'TerminalInput', payload: { session_id: sessionId, data } })
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'TerminalResize', payload: { session_id: sessionId, cols, rows } })
  }

  /** Stop the agent. Reaches the real process. */
  stopSession(sessionId: string): void {
    this.send({
      type: 'Command',
      payload: { action: 'stop', params: { session_id: sessionId } },
    })
  }

  respondToApproval(sessionId: string, requestId: string, decision: string): void {
    this.send({
      type: 'Command',
      payload: {
        action: 'approval_response',
        params: { session_id: sessionId, request_id: requestId, decision },
      },
    })
  }

  private handleFrame(frame: IncomingFrame): void {
    if (frame.type === 'Authenticated') {
      const serverLast = frame.payload.last_event_id
      // The server's counter resets on daemon restart. A cursor ahead of the
      // server's would silently skip the entire replay, so drop it.
      if (this.cursor !== null && serverLast < this.cursor) this.cursor = null
      this.setState('connected')
      this.flush()
      return
    }
    if (frame.type === 'Error' && frame.payload.code === 'device_revoked') {
      this.closedByUs = true
      this.setState('unauthorized')
      this.socket?.close()
      return
    }
    if (frame.event_id !== undefined) this.setCursor(frame.event_id)

    for (const listener of this.frameListeners) listener(frame)
  }

  private sendNow(frame: ClientFrame): void {
    try {
      this.socket?.send(JSON.stringify(frame))
    } catch {
      if (this.outbox.length < 50) this.outbox.push(frame)
    }
  }

  private flush(): void {
    const queued = this.outbox
    this.outbox = []
    for (const frame of queued) this.sendNow(frame)
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || this.reconnectTimer !== null) return
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]
    this.attempt += 1
    this.setState('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }
}

export const socket = new SocketClient()

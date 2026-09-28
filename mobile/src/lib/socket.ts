/**
 * WebSocket client (React Native).
 *
 * A port of the web `lib/socket.ts` singleton — same resume-from-cursor replay,
 * same backoff, same outbox — with the browser lifecycle signals swapped for
 * their RN equivalents and a keepalive added:
 *
 *   - `document.visibilitychange` / `window focus`  →  AppState 'active'
 *   - `navigator.onLine` + online/offline events    →  NetInfo
 *   - new: a periodic `Ping` while connected. The daemon swallows it (no pong),
 *     but it keeps NAT/proxy idle timers from silently dropping the socket, which
 *     matters on mobile networks far more than on a desktop browser.
 *
 * Reconnection preserves state and resumes rather than restarting: the cursor is
 * `after_event_id`, the server replays everything newer, and the reducer's
 * id-based idempotency absorbs the overlap. If the server's `last_event_id` is
 * below our cursor the daemon restarted (its counter is in-memory), so we drop
 * the cursor and let the caller do a full REST resync.
 */

import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import type { ApprovalMeta, ClientFrame, ConnectionState, IncomingFrame } from '@/types/protocol'
import { isIncomingFrame } from '@/types/protocol'
import { deviceToken } from './api'
import { socketOrigin } from './native'

type FrameListener = (frame: IncomingFrame) => void
type StateListener = (state: ConnectionState) => void

/** Backoff schedule in ms. Caps rather than growing without bound. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000] as const
/** Keepalive interval while connected. */
const KEEPALIVE_MS = 25_000

class SocketClient {
  private socket: WebSocket | null = null
  private state: ConnectionState = 'idle'
  private frameListeners = new Set<FrameListener>()
  private stateListeners = new Set<StateListener>()
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private everConnected = false
  /** Replay cursor: highest event id we have applied. */
  private cursor: number | null = null
  /** Frames queued while the socket is down, flushed on reconnect. */
  private outbox: ClientFrame[] = []
  private closedByUs = false
  private lifecycleAttached = false
  /** Last known connectivity from NetInfo; optimistic until the first event. */
  private online = true

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

  private attachLifecycle(): void {
    if (this.lifecycleAttached) return
    this.lifecycleAttached = true

    // Foreground return: reconnect promptly if we dropped while backgrounded.
    AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        if (
          this.state === 'disconnected' ||
          this.state === 'offline' ||
          this.state === 'error' ||
          this.state === 'reconnecting'
        ) {
          this.connect()
        }
      }
    })

    // Connectivity: go offline immediately, reconnect when it returns.
    NetInfo.addEventListener((net) => {
      const connected = net?.isConnected ?? true
      this.online = connected
      if (!connected) {
        if (this.state !== 'idle') this.setState('offline')
      } else if (
        this.state === 'offline' ||
        this.state === 'disconnected' ||
        this.state === 'error'
      ) {
        this.connect()
      }
    })
    void NetInfo.fetch().then((net) => {
      this.online = net?.isConnected ?? true
    })
  }

  connect(): void {
    this.attachLifecycle()
    if (!this.online) {
      this.setState('offline')
      this.scheduleReconnect()
      return
    }
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return
    this.closedByUs = false
    this.clearTimer()

    const token = deviceToken()
    // Authenticated devices use the mobile socket, which supports replay.
    const path = token ? '/ws/mobile' : '/ws'
    const origin = socketOrigin()
    if (!origin) {
      // Unpaired: nothing to connect to. Stay idle rather than retry-spam.
      this.setState('idle')
      return
    }
    const url = `${origin}${path}`

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
        this.sendNow({ type: 'Authenticate', payload: { token, after_event_id: this.cursor } })
        // State becomes `connected` on Authenticated, not here.
      } else {
        this.setState('connected')
        this.startKeepalive()
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
      this.stopKeepalive()
      if (this.closedByUs) {
        this.setState('idle')
        return
      }
      this.setState(this.online ? 'disconnected' : 'offline')
      this.scheduleReconnect()
    }

    socket.onerror = () => {
      // `onclose` always follows and handles the reconnect.
    }
  }

  disconnect(): void {
    this.closedByUs = true
    this.clearTimer()
    this.stopKeepalive()
    this.socket?.close()
    this.socket = null
    this.setState('idle')
  }

  /** Send a frame, queueing it if the socket is down. */
  send(frame: ClientFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.state === 'connected') {
      this.sendNow(frame)
    } else {
      if (this.outbox.length < 50) this.outbox.push(frame)
      this.connect()
    }
  }

  sendInput(sessionId: string, data: string): void {
    this.send({ type: 'Input', payload: { session_id: sessionId, data } })
  }

  sendTerminalInput(sessionId: string, data: string): void {
    this.send({ type: 'TerminalInput', payload: { session_id: sessionId, data } })
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'TerminalResize', payload: { session_id: sessionId, cols, rows } })
  }

  stopSession(sessionId: string): void {
    this.send({ type: 'Command', payload: { action: 'stop', params: { session_id: sessionId } } })
  }

  interruptSession(sessionId: string): void {
    this.send({ type: 'Command', payload: { action: 'interrupt', params: { session_id: sessionId } } })
    this.send({ type: 'TerminalInput', payload: { session_id: sessionId, data: '\x03' } })
  }

  respondToApproval(sessionId: string, requestId: string, decision: string, meta?: ApprovalMeta): void {
    const params: Record<string, unknown> = { session_id: sessionId, request_id: requestId, decision }
    if (meta?.customText !== undefined) params.custom_text = meta.customText
    if (meta?.always === true) params.always = true
    if (meta?.allow !== undefined) params.allow = meta.allow
    this.send({ type: 'Command', payload: { action: 'approval_response', params } })
  }

  answerQuestion(questionId: string, selectedOptions: string[], customText?: string): void {
    this.send({
      type: 'QuestionAnswer',
      payload: { question_id: questionId, selected_options: selectedOptions, custom_text: customText },
    })
  }

  private handleFrame(frame: IncomingFrame): void {
    if (frame.type === 'Authenticated') {
      const serverLast = frame.payload.last_event_id
      if (this.cursor !== null && serverLast < this.cursor) this.cursor = null
      this.setState('connected')
      this.startKeepalive()
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

  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepaliveTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.sendNow({ type: 'Ping' })
    }, KEEPALIVE_MS)
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || this.reconnectTimer !== null) return
    if (!this.online) {
      this.setState('offline')
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, 5000)
      return
    }
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

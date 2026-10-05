/**
 * Remote-view socket.
 *
 * Its own connection to `/ws/remote` — deliberately not the chat socket, so a
 * 24fps video stream can never starve approvals or transcripts. Same auth model
 * as the rest of the app (device token as the first frame), same reconnect idea
 * (rejoin the session by id so the desktop keeps its capture running), plus a
 * keepalive because mobile NATs drop idle sockets.
 *
 * Blocking backend work (consent dialogs, portal sessions) happens server-side;
 * this client only negotiates, feeds input and paints frames.
 */

import type {
  InputEvent,
  RemoteFrame,
  RemoteServerMessage,
  RemoteState,
  RemoteTarget,
  StreamOptions,
} from '@/types/remoteView'
import { deviceToken } from './api'
import { socketOrigin } from './native'

const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000] as const
const KEEPALIVE_MS = 20_000

export interface RemoteHandlers {
  onFrame?: (frame: RemoteFrame) => void
  onMessage?: (message: RemoteServerMessage) => void
  onState?: (state: RemoteState, detail?: string) => void
}

export class RemoteSocket {
  private socket: WebSocket | null = null
  private state: RemoteState = 'idle'
  private sessionId: string | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private closedByUs = false
  private target: RemoteTarget = { kind: 'desktop' }
  private options: StreamOptions | null = null
  private outbox: string[] = []

  constructor(private handlers: RemoteHandlers) {}

  getState(): RemoteState {
    return this.state
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  /** Open a session for a target. Safe to call again to switch targets. */
  connect(target: RemoteTarget, options: StreamOptions): void {
    this.target = target
    this.options = options
    this.closedByUs = false
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      // Already connected — switch live rather than reconnecting.
      if (this.state === 'connected') {
        this.sendJson({ type: 'Start', payload: { target, options } })
      }
      return
    }
    this.open()
  }

  /** Switch the streamed target without dropping the session. */
  switchTarget(target: RemoteTarget): void {
    this.target = target
    this.sendJson({ type: 'SwitchTarget', payload: { target } })
  }

  setQuality(options: StreamOptions): void {
    this.options = options
    this.sendJson({ type: 'SetQuality', payload: { options } })
  }

  /** High-frequency: dropped rather than queued when the socket is down. */
  input(event: InputEvent): void {
    this.sendJson({ type: 'Input', payload: { event } }, false)
  }

  requestMetadata(): void {
    this.sendJson({ type: 'RequestMetadata' })
  }

  clipboardGet(): void {
    this.sendJson({ type: 'ClipboardGet' })
  }

  clipboardSet(text: string): void {
    this.sendJson({ type: 'ClipboardSet', payload: { text } })
  }

  /**
   * Retry a failed stream by starting a **fresh** session.
   *
   * Reusing the old session id would rejoin a session whose capture thread has
   * already exited (that is why it failed), so nothing would ever resume. A new
   * session is the only way to re-request capture — and on Wayland that is also
   * what re-opens the compositor's screen-sharing prompt.
   */
  retry(target: RemoteTarget, options: StreamOptions): void {
    this.target = target
    this.options = options
    this.sessionId = null
    this.clearTimers()
    const previous = this.socket
    this.socket = null
    try {
      previous?.close()
    } catch {
      // already closing
    }
    this.closedByUs = false
    this.attempt = 0
    this.setState('connecting')
    this.open()
  }

  stop(): void {
    this.closedByUs = true
    this.clearTimers()
    this.sendJson({ type: 'Stop' })
    this.socket?.close()
    this.socket = null
    this.sessionId = null
    this.setState('idle')
  }

  close(): void {
    this.closedByUs = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.setState('idle')
  }

  private open(): void {
    const token = deviceToken()
    const origin = socketOrigin()
    if (!origin) {
      this.setState('idle')
      return
    }
    this.clearTimer()
    this.setState(this.sessionId ? 'reconnecting' : 'connecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(`${origin}/ws/remote`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      if (!token) {
        this.setState('unauthorized', 'This device is not paired.')
        socket.close()
        return
      }
      // Authenticate is the required first frame; Ready follows, then Start.
      this.sendNow({ type: 'Authenticate', payload: { token, session_id: this.sessionId } })
    }

    socket.onmessage = (message) => {
      if (typeof message.data !== 'string') return
      let parsed: unknown
      try {
        parsed = JSON.parse(message.data)
      } catch {
        return
      }
      if (typeof parsed !== 'object' || parsed === null) return
      this.handle(parsed as RemoteServerMessage)
    }

    socket.onclose = () => {
      // A superseded socket (we replaced it during a retry) must not clobber the
      // new connection's state or schedule a competing reconnect.
      if (this.socket !== socket) return
      this.socket = null
      this.stopKeepalive()
      if (this.closedByUs) {
        this.setState('idle')
        return
      }
      this.setState('disconnected')
      this.scheduleReconnect()
    }

    socket.onerror = () => {
      // `onclose` always follows.
    }
  }

  private handle(message: RemoteServerMessage): void {
    switch (message.type) {
      case 'Ready': {
        this.sessionId = message.payload.session_id
        this.setState('connected')
        this.startKeepalive()
        // Kick off the stream and flush anything queued during the handshake.
        if (this.options) {
          this.sendJson({ type: 'Start', payload: { target: this.target, options: this.options } })
        }
        this.flush()
        break
      }
      case 'Frame':
        this.handlers.onFrame?.(message.payload)
        break
      case 'PermissionRequired':
        this.setState('permission_required', message.payload.message)
        break
      case 'Error':
        if (message.payload.code === 'unauthorized' || message.payload.code === 'device_revoked') {
          this.setState('unauthorized', message.payload.message)
        } else if (message.payload.code === 'unsupported') {
          this.setState('unsupported', message.payload.message)
        } else if (message.payload.fatal) {
          // A specific cause (a missing permission, an unsupported platform)
          // arrives first; the capture loop then emits a generic "capture
          // stopped" as it exits. Keep the specific reason rather than letting
          // the generic one replace it — otherwise the user is told "something
          // went wrong" when the answer is "approve the screen-sharing prompt".
          if (this.state === 'permission_required' || this.state === 'unsupported') break
          this.setState('error', message.payload.message)
        }
        break
      default:
        break
    }
    this.handlers.onMessage?.(message)
  }

  private sendJson(frame: Record<string, unknown>, queue = true): void {
    const text = JSON.stringify(frame)
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(text)
      } catch {
        // Socket is going down; onclose reconnects.
      }
    } else if (queue && this.outbox.length < 20) {
      this.outbox.push(text)
    }
  }

  private sendNow(frame: Record<string, unknown>): void {
    try {
      this.socket?.send(JSON.stringify(frame))
    } catch {
      // A failed send means the socket is going down; onclose reconnects.
    }
  }

  private flush(): void {
    const queued = this.outbox
    this.outbox = []
    for (const text of queued) {
      try {
        this.socket?.send(text)
      } catch {
        // ignore; reconnect handles it
      }
    }
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
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]
    this.attempt += 1
    this.setState('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearTimers(): void {
    this.clearTimer()
    this.stopKeepalive()
  }

  private setState(state: RemoteState, detail?: string): void {
    if (this.state === state && !detail) return
    this.state = state
    this.handlers.onState?.(state, detail)
  }
}

export { DEFAULT_OPTIONS } from '@/types/remoteView'
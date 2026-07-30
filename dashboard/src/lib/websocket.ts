export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private reconnectDelay: number = 3000
  private messageHandlers: Map<string, ((data: unknown) => void)[]> = new Map()

  constructor(url: string) {
    this.url = url
  }

  connect() {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      console.log('WebSocket connected')
      this.reconnectDelay = 3000
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const handlers = this.messageHandlers.get(msg.type) || []
        handlers.forEach(h => h(msg.payload))
      } catch {
        console.error('Failed to parse message')
      }
    }

    this.ws.onclose = () => {
      console.log('WebSocket closed, reconnecting...')
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  }

  send(type: string, payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }))
    }
  }

  on(type: string, handler: (data: unknown) => void) {
    const handlers = this.messageHandlers.get(type) || []
    handlers.push(handler)
    this.messageHandlers.set(type, handlers)
  }

  disconnect() {
    this.ws?.close()
  }
}

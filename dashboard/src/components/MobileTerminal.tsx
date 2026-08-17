import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Square, TerminalSquare } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TerminalCommandBar } from './TerminalCommandBar'
import { TerminalInput } from './TerminalInput'
import { useTerminalResize, type TerminalDimensions } from '../hooks/useTerminalResize'
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight'

export interface MobileTerminalProps {
  sessionId: string
  title: string
  output: string
  connection: 'connected' | 'disconnected' | string
  onData: (data: string) => void
  onResize?: (dimensions: TerminalDimensions) => void
  onRetry?: () => void
  onStop?: () => void
  error?: string | null
  onBack: () => void
}

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 22

function defaultFontSize(): number {
  return typeof window !== 'undefined' && window.innerWidth < 640 ? 13 : 12
}

function clampFontSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value))
}

export function MobileTerminal({
  sessionId,
  title,
  output,
  connection,
  onData,
  onResize,
  onRetry,
  onStop,
  error,
  onBack,
}: MobileTerminalProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const terminalHostRef = useRef<HTMLDivElement>(null)
  const [terminalState, setTerminalState] = useState<{ terminal: Terminal; fit: FitAddon } | null>(null)
  const [fontSize, setFontSize] = useState(defaultFontSize)
  const previousOutputRef = useRef('')
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const followRef = useRef(true)
  const fontSizeRef = useRef(fontSize)
  const pinchRef = useRef<{ startDistance: number; startFontSize: number } | null>(null)
  const viewportHeight = useVisualViewportHeight()

  onDataRef.current = onData
  onResizeRef.current = onResize
  fontSizeRef.current = fontSize

  const emitResize = useCallback((dimensions: TerminalDimensions) => {
    onResizeRef.current?.(dimensions)
  }, [])

  useEffect(() => {
    const host = terminalHostRef.current
    if (!host) return

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, Fira Code, SF Mono, monospace',
      fontSize: fontSizeRef.current,
      lineHeight: 1.25,
      scrollback: 10000,
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#d4d4d8',
        cursorAccent: '#09090b',
        black: '#18181b',
        red: '#f87171',
        green: '#86efac',
        yellow: '#fde68a',
        blue: '#93c5fd',
        magenta: '#d8b4fe',
        cyan: '#67e8f9',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#fca5a5',
        brightGreen: '#bbf7d0',
        brightYellow: '#fef3c7',
        brightBlue: '#bfdbfe',
        brightMagenta: '#e9d5ff',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff',
        selectionBackground: '#3f3f46',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)

    const inputDisposable = terminal.onData((data) => onDataRef.current(data))
    const scrollDisposable = terminal.onScroll(() => {
      const buffer = terminal.buffer.active
      followRef.current = buffer.viewportY >= buffer.baseY - 1
    })

    setTerminalState({ terminal, fit })

    return () => {
      inputDisposable.dispose()
      scrollDisposable.dispose()
      terminal.dispose()
      setTerminalState(null)
      previousOutputRef.current = ''
      followRef.current = true
    }
  }, [sessionId])

  useTerminalResize(
    terminalState?.terminal ?? null,
    terminalState?.fit ?? null,
    viewportRef.current,
    emitResize,
  )

  useEffect(() => {
    if (!terminalState) return
    terminalState.terminal.options.fontSize = fontSize
    try {
      terminalState.fit.fit()
    } catch {
      return
    }
  }, [fontSize, terminalState])

  useEffect(() => {
    const terminal = terminalState?.terminal
    if (!terminal || !output) return

    if (previousOutputRef.current && output.startsWith(previousOutputRef.current)) {
      terminal.write(output.slice(previousOutputRef.current.length))
    } else {
      terminal.reset()
      terminal.write(output)
    }
    previousOutputRef.current = output
    if (followRef.current) terminal.scrollToBottom()
  }, [output, terminalState])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || !terminalState) return

    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinchRef.current = { startDistance: distance(event.touches), startFontSize: fontSizeRef.current }
      }
    }
    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const scale = distance(event.touches) / pinch.startDistance
      setFontSize(clampFontSize(Math.round(pinch.startFontSize * scale)))
    }
    const onTouchEnd = () => {
      pinchRef.current = null
    }

    element.addEventListener('touchstart', onTouchStart)
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchEnd)
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [terminalState])

  return (
    <main
      className="mobile-app mobile-terminal flex flex-col overflow-hidden bg-canvas text-ink"
      style={{ height: viewportHeight, maxHeight: viewportHeight }}
    >
      <header className="mobile-terminal__header flex shrink-0 items-center gap-2 border-b border-line bg-canvas/95 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur-xl">
        <button
          type="button"
          onClick={onBack}
          className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors active:bg-hover"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-tint">
          <TerminalSquare className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-3">
            <span className={`size-1.5 rounded-full ${connection === 'connected' ? 'bg-green' : 'bg-orange animate-pulse'}`} />
            {connection === 'connected' ? 'Connected' : connection}
          </p>
        </div>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-control bg-red-tint px-3 text-[11px] font-medium text-red active:bg-red active:text-white"
            aria-label="Stop task"
          >
            <Square className="h-3 w-3 fill-current" />
            <span className="hidden min-[380px]:inline">Stop</span>
          </button>
        )}
      </header>

      <div
        ref={viewportRef}
        className="mobile-terminal__viewport relative min-h-0 flex-1 bg-[#09090b]"
        onClick={() => terminalState?.terminal.focus()}
      >
        <div ref={terminalHostRef} className="absolute inset-0" aria-label="Terminal output" />
      </div>

      <footer className="mobile-terminal__controls shrink-0 pb-[env(safe-area-inset-bottom)]">
        {error && <p className="border-t border-red/25 bg-red-tint px-3 py-2 text-[11px] text-red" role="status">{error}</p>}
        {connection !== 'connected' && (
          <div className="flex items-center gap-2 border-t border-line bg-orange-tint px-3 py-2 text-[11px] text-orange" role="status">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1">Terminal {connection}</span>
            {onRetry && <button type="button" onClick={onRetry} className="min-h-11 shrink-0 rounded-control border border-orange/30 px-3 font-medium">Retry</button>}
          </div>
        )}
        <TerminalInput onData={onData} disabled={connection !== 'connected'} />
        <TerminalCommandBar onData={onData} disabled={connection !== 'connected'} fontSize={fontSize} onFontSizeChange={setFontSize} />
      </footer>
    </main>
  )
}

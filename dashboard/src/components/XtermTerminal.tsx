import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface XtermTerminalProps {
  output: string
  onData?: (data: string) => void
}

export function XtermTerminal({ output, onData }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const previousOutput = useRef('')
  const onDataRef = useRef(onData)
  onDataRef.current = onData

  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: true,
      cursorBlink: false,
      disableStdin: !onDataRef.current,
      fontFamily: 'JetBrains Mono, Fira Code, SF Mono, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#71717a',
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
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current)
    terminalRef.current = terminal
    const input = terminal.onData((data) => onDataRef.current?.(data))

    const resizeObserver = new ResizeObserver(() => fit.fit())
    resizeObserver.observe(containerRef.current)
    requestAnimationFrame(() => fit.fit())

    return () => {
      resizeObserver.disconnect()
      input.dispose()
      terminal.dispose()
      terminalRef.current = null
      previousOutput.current = ''
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !output) return

    if (previousOutput.current && output.startsWith(previousOutput.current)) {
      terminal.write(output.slice(previousOutput.current.length))
    } else {
      terminal.reset()
      terminal.write(output)
    }
    previousOutput.current = output
    terminal.scrollToBottom()
  }, [output])

  return <div ref={containerRef} className="h-[55vh] min-h-64 w-full overflow-hidden rounded-lg bg-terminal-bg p-2" aria-label="Raw terminal output" />
}

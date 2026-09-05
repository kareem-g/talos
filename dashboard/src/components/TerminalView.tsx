/**
 * Terminal view.
 *
 * A real terminal renderer, because ANSI belongs in one. The chat never receives
 * these bytes — the reducer routes `terminal_output` here and nowhere else.
 *
 * Writes are batched on an animation frame: an agent can emit thousands of
 * chunks per second, and calling `write` per chunk stalls the main thread.
 */

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** Real byte sequences for keys a touch keyboard cannot produce. */
const TOUCH_KEYS: Array<{ label: string; bytes: string; aria: string }> = [
  { label: '^C', bytes: '\u0003', aria: 'Control C' },
  { label: 'Esc', bytes: '\u001b', aria: 'Escape' },
  { label: 'Tab', bytes: '\t', aria: 'Tab' },
  { label: '↑', bytes: '\u001b[A', aria: 'Up arrow' },
  { label: '↓', bytes: '\u001b[B', aria: 'Down arrow' },
  { label: '←', bytes: '\u001b[D', aria: 'Left arrow' },
  { label: '→', bytes: '\u001b[C', aria: 'Right arrow' },
  { label: '⏎', bytes: '\r', aria: 'Enter' },
]

/** Terminal palette from the live CSS tokens, so it follows the app theme.
 *  ANSI colors beyond background/foreground/cursor stay per-theme constants —
 *  they need to stay punchy against whichever background is active. */
function terminalTheme(): { [key: string]: string } {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const light = document.documentElement.dataset.theme === 'light'
  const bg = read('--term-bg', light ? '#ffffff' : '#141210')
  const fg = read('--term-fg', light ? '#26201a' : '#e7dac8')
  return {
    background: bg,
    foreground: fg,
    cursor: read('--accent', '#8eadbf'),
    cursorAccent: bg,
    selectionBackground: 'rgba(76, 141, 255, 0.28)',
    black: bg,
    red: light ? '#b3402f' : '#ff6b6b',
    green: light ? '#2f7d3f' : '#57ab5a',
    yellow: light ? '#a8741f' : '#d9a25e',
    blue: light ? '#386484' : '#8eadbf',
    magenta: light ? '#7c5cae' : '#c39bff',
    cyan: light ? '#386484' : '#8eadbf',
    white: light ? '#5c5347' : '#d8c7b1',
    brightBlack: light ? '#8a7f71' : '#817366',
    brightRed: light ? '#a33a2a' : '#ff8f8f',
    brightGreen: light ? '#296e37' : '#6fbc7f',
    brightYellow: light ? '#96681b' : '#e0b06a',
    brightBlue: light ? '#325874' : '#8eadbf',
    brightMagenta: light ? '#6b4f9c' : '#d4b8ff',
    brightCyan: light ? '#325874' : '#8eadbf',
    brightWhite: light ? '#26201a' : '#f3e9dc',
  }
}

export function TerminalView({
  output,
  onInput,
  onResize,
  onClear,
  interactive,
  transport,
  connectionState,
  fontSize: fontSizeProp = 12,
}: {
  output: string
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
  onClear?: () => void
  /**
   * Whether this session's terminal accepts keystrokes. False for an ACP session
   * (piped stdio, no PTY) and for one whose process has exited. Output is shown
   * either way.
   */
  interactive: boolean
  /** Used only to explain *why* input is unavailable. */
  transport?: string
  connectionState?: string
  /** Font size in px. Changing it recreates the instance (xterm cannot resize live). */
  fontSize?: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  /** How much of `output` has been written, so we only write the delta. */
  const writtenRef = useRef(0)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      convertEol: true,
      cursorBlink: interactive,
      disableStdin: !interactive,
      fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
      fontSize: fontSizeProp,
      lineHeight: 1.4,
      scrollback: 5000,
      // Read from the live CSS tokens so the terminal follows the app theme.
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    const disposable = interactive ? term.onData(onInput) : undefined

    // Resizing only means something for a real PTY. Reporting dimensions for an
    // ACP session produced a "Session not found" error banner on every open,
    // because there is no pty to resize.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        if (interactive) onResize(term.cols, term.rows)
      } catch {
        // The element can be detached mid-observation; nothing to do.
      }
    })
    observer.observe(host)
    if (interactive) onResize(term.cols, term.rows)

    return () => {
      observer.disconnect()
      disposable?.dispose()
      term.dispose()
      termRef.current = null
      writtenRef.current = 0
    }
    // Recreating on `interactive` change is intentional: stdin cannot be toggled
    // on a live instance. Font size likewise requires a fresh instance.
  }, [interactive, onInput, onResize, fontSizeProp])

  // Write only what is new, batched to one frame.
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    if (output.length < writtenRef.current) {
      // The buffer was trimmed at the front: rewrite from scratch rather than
      // writing a misaligned slice.
      term.reset()
      writtenRef.current = 0
    }
    const pending = output.slice(writtenRef.current)
    if (!pending) return
    writtenRef.current = output.length

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      term.write(pending)
    })
  }, [output])

  // Follow live theme changes (lib/theme.ts dispatches this event).
  useEffect(() => {
    function onThemeChange() {
      const term = termRef.current
      if (term) term.options.theme = terminalTheme()
    }
    window.addEventListener('agentdeck-theme-change', onThemeChange)
    return () => window.removeEventListener('agentdeck-theme-change', onThemeChange)
  }, [])

  function handleClear() {
    termRef.current?.clear()
    // Keep writtenRef at current output length so new data appends correctly
    // but visual buffer is empty until next write
    if (onClear) onClear()
  }

  function handleCopy() {
    // Copy visible terminal buffer
    const term = termRef.current
    if (term) {
      const text = term.getSelection() || output.slice(-4096)
      navigator.clipboard?.writeText(text).catch(() => undefined)
    } else if (output) {
      navigator.clipboard?.writeText(output.slice(-8192)).catch(() => undefined)
    }
  }

  const isReconnecting = connectionState === 'reconnecting' || connectionState === 'connecting' || connectionState === 'offline'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-term-bg">
      {/* Terminal toolbar: clear, copy, interrupt, connection hint */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1.5">
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleClear}
            className="rounded-control bg-field px-2 py-1 font-mono text-[10.5px] text-ink-2 shadow-hairline hover:bg-hover hover:text-ink"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-control bg-field px-2 py-1 font-mono text-[10.5px] text-ink-2 shadow-hairline hover:bg-hover hover:text-ink"
          >
            Copy
          </button>
          {interactive ? (
            <button
              type="button"
              onClick={() => onInput('\x03')}
              className="rounded-control bg-red-tint px-2 py-1 font-mono text-[10.5px] font-bold text-red hover:bg-red-tint"
              title="Send Ctrl+C (interrupt)"
            >
              Ctrl+C
            </button>
          ) : null}
        </span>
        <span className="flex items-center gap-1.5">
          {isReconnecting ? (
            <span className="inline-flex items-center gap-1 rounded-chip bg-orange-tint px-1.5 py-0.5 text-[10.5px] text-orange">
              <span className="size-1.5 rounded-full bg-orange breathe" aria-hidden />
              Reconnecting
            </span>
          ) : null}
          <span className="hidden font-mono text-[10.5px] text-ink-3 sm:inline">
            {interactive ? 'Interactive' : transport === 'acp' ? 'ACP' : 'View only'}
          </span>
        </span>
      </div>

      {/*
        The host element is always mounted, never conditionally rendered: xterm
        attaches to it in an effect that does not re-run on output changes, so
        swapping it out for a placeholder would leave the terminal with nowhere to
        write once bytes arrive. The empty message overlays instead.
      */}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="scroll-thin absolute inset-0 px-2 py-1.5" />
        {output.length === 0 ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[11.5px] leading-[1.6] text-ink-3">
            No terminal output from this session yet.
          </p>
        ) : null}
      </div>

      {interactive ? (
        <div
          className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-2"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          {TOUCH_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              onClick={() => onInput(key.bytes)}
              aria-label={key.aria}
              className="min-h-9 min-w-11 shrink-0 rounded-control bg-field font-mono text-[11.5px] text-ink-2 shadow-btn transition-[background-color,transform] duration-100 hover:bg-hover hover:text-ink active:scale-95"
            >
              {key.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="shrink-0 border-t border-line bg-surface px-3 py-2 text-[11.5px] leading-[1.6] text-ink-3">
          {transport === 'acp'
            ? 'This session runs over ACP on piped stdio, so there is no terminal to type into. Output is shown above.'
            : 'This session has no running terminal to accept input.'}
        </p>
      )}
    </div>
  )
}

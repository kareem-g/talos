import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, MoreHorizontal } from 'lucide-react'

/**
 * A quick-action key: the label shown on the button and the exact byte
 * sequence it sends through the terminal input path. These are real terminal
 * control characters / xterm escape sequences — never faked UI text.
 */
interface KeyBinding {
  label: string
  ariaLabel: string
  send: string
}

/** Primary actions, left-to-right in order of use-frequency (per the spec). */
export const PRIMARY_KEYS: KeyBinding[] = [
  { label: 'Ctrl+C', ariaLabel: 'Send Ctrl+C interrupt', send: '\x03' },
  { label: 'Enter', ariaLabel: 'Send Enter', send: '\r' },
  { label: 'Tab', ariaLabel: 'Send Tab', send: '\t' },
  { label: '↑', ariaLabel: 'Send Arrow Up', send: '\x1b[A' },
  { label: '↓', ariaLabel: 'Send Arrow Down', send: '\x1b[B' },
  { label: 'Esc', ariaLabel: 'Send Escape', send: '\x1b' },
]

/** Secondary actions surfaced behind the "More" popover. */
export const SECONDARY_KEYS: KeyBinding[] = [
  { label: 'Ctrl+D', ariaLabel: 'Send Ctrl+D end of transmission', send: '\x04' },
  { label: 'Ctrl+Z', ariaLabel: 'Send Ctrl+Z suspend', send: '\x1a' },
  { label: 'Ctrl+L', ariaLabel: 'Send Ctrl+L clear screen', send: '\x0c' },
  { label: '←', ariaLabel: 'Send Arrow Left', send: '\x1b[D' },
  { label: '→', ariaLabel: 'Send Arrow Right', send: '\x1b[C' },
  { label: 'Home', ariaLabel: 'Send Home', send: '\x1b[H' },
  { label: 'End', ariaLabel: 'Send End', send: '\x1b[F' },
  { label: 'PgUp', ariaLabel: 'Send Page Up', send: '\x1b[5~' },
  { label: 'PgDn', ariaLabel: 'Send Page Down', send: '\x1b[6~' },
  { label: 'Clear', ariaLabel: 'Clear the terminal screen', send: '\x0c' },
]

export interface TerminalCommandBarProps {
  /** Sends a raw byte sequence through the terminal input path. */
  onData: (data: string) => void
  disabled?: boolean
  /** Current terminal font size, for the text-size controls. */
  fontSize?: number
  /** Called with the next font size when the user taps A− / A+. */
  onFontSizeChange?: (next: number) => void
}

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 22

function clampFontSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value))
}

/**
 * Tmux-inspired quick-command toolbar for the mobile terminal.
 *
 * Buttons send real keystroke sequences (control chars / xterm escapes) through
 * the terminal's existing `onData` path — they never manipulate visible text.
 * On mobile the bar is horizontally scrollable; on desktop it wraps. The
 * "More" button opens a popover of secondary actions.
 */
export function TerminalCommandBar({ onData, disabled = false, fontSize, onFontSizeChange }: TerminalCommandBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative border-t border-line bg-surface">
      {/* Primary actions — horizontally scrollable on mobile, wrapping on desktop */}
      <div
        ref={containerRef}
        className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 scrollbar-none"
      >
        {PRIMARY_KEYS.map((key) => (
          <KeyButton key={key.label} binding={key} onData={onData} disabled={disabled} />
        ))}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="More terminal actions"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          disabled={disabled}
          className="flex h-11 shrink-0 items-center gap-1 rounded-control border border-line bg-canvas px-2.5 text-[11px] font-medium text-ink transition-transform active:scale-95 disabled:opacity-40"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">More</span>
        </button>
      </div>

      {/* Secondary actions popover */}
      {moreOpen && (
        <>
          {/* Tap-outside-to-close backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
          <div className="absolute right-2 bottom-full z-20 mb-2 w-56 overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-overlay animate-[pop-in_150ms_cubic-bezier(0.23,1,0.32,1)_both]">
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
              Terminal actions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SECONDARY_KEYS.map((key) => (
                <KeyButton
                  key={key.label}
                  binding={key}
                  disabled={disabled}
                  onData={(data) => {
                    onData(data)
                    setMoreOpen(false)
                  }}
                />
              ))}
            </div>
            {typeof fontSize === 'number' && onFontSizeChange && (
              <>
                <div className="mx-2 my-1.5 h-px bg-line" />
                <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                    Text size
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Decrease text size"
                      onClick={() => onFontSizeChange(clampFontSize(fontSize - 1))}
                      disabled={fontSize <= MIN_FONT_SIZE}
                      className="flex h-8 min-w-[36px] items-center justify-center rounded-control border border-line bg-canvas px-2 text-[12px] font-semibold text-ink transition-transform active:scale-95 disabled:opacity-40"
                    >
                      A−
                    </button>
                    <span className="min-w-[34px] text-center font-mono text-[10.5px] text-ink-2">{fontSize}px</span>
                    <button
                      type="button"
                      aria-label="Increase text size"
                      onClick={() => onFontSizeChange(clampFontSize(fontSize + 1))}
                      disabled={fontSize >= MAX_FONT_SIZE}
                      className="flex h-8 min-w-[36px] items-center justify-center rounded-control border border-line bg-canvas px-2 text-[13px] font-semibold text-ink transition-transform active:scale-95 disabled:opacity-40"
                    >
                      A+
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

interface KeyButtonProps {
  binding: KeyBinding
  onData: (data: string) => void
  disabled?: boolean
}

function KeyButton({ binding, onData, disabled = false }: KeyButtonProps) {
  return (
    <button
      type="button"
      aria-label={binding.ariaLabel}
      onClick={() => binding.send && onData(binding.send)}
      disabled={disabled || !binding.send}
      className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-control border border-line bg-canvas px-2.5 text-[11px] font-medium text-ink transition-transform active:scale-95 disabled:opacity-40"
    >
      {binding.label}
    </button>
  )
}

/** Small arrow-key cluster for directional input. */
export function ArrowPad({ onData }: { onData: (data: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Send Arrow Left" onClick={() => onData('\x1b[D')} className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-canvas text-ink active:scale-95">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex flex-col gap-1">
        <button type="button" aria-label="Send Arrow Up" onClick={() => onData('\x1b[A')} className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-canvas text-ink active:scale-95">
          <ChevronUp className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Send Arrow Down" onClick={() => onData('\x1b[B')} className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-canvas text-ink active:scale-95">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <button type="button" aria-label="Send Arrow Right" onClick={() => onData('\x1b[C')} className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-canvas text-ink active:scale-95">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

import { useRef, useState } from 'react'

export interface TerminalInputProps {
  /** Sends a raw byte sequence through the terminal input path. */
  onData: (data: string) => void
  disabled?: boolean
}

/**
 * Command input for the mobile terminal.
 *
 * Captures typed lines and sends them (plus Enter) through the terminal's
 * existing input path. Maintains a local, in-session command history so the
 * user can recall prior commands with Up/Down — purely a convenience layer
 * over the real terminal input.
 */
export function TerminalInput({ onData, disabled = false }: TerminalInputProps) {
  const [value, setValue] = useState('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef<number>(-1)
  const draftRef = useRef<string>('')

  const submit = () => {
    const line = value
    if (line) {
      // De-duplicate consecutive identical entries but keep full history.
      const hist = historyRef.current
      if (hist[hist.length - 1] !== line) hist.push(line)
      historyIndexRef.current = hist.length
      draftRef.current = ''
      onData(`${line}\r`)
    }
    setValue('')
  }

  const recall = (direction: 'up' | 'down') => {
    const hist = historyRef.current
    if (hist.length === 0) return

    if (historyIndexRef.current === hist.length) {
      // Starting a recall from the live draft — remember it.
      draftRef.current = value
    }

    if (direction === 'up') {
      historyIndexRef.current = Math.max(0, historyIndexRef.current - 1)
    } else {
      historyIndexRef.current = Math.min(hist.length, historyIndexRef.current + 1)
    }

    const recalled = historyIndexRef.current === hist.length ? draftRef.current : hist[historyIndexRef.current]
    setValue(recalled)
  }

  return (
    <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2">
      <span className="select-none font-mono text-[12px] text-green">{'>'}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={disabled ? 'Disconnected' : 'Type a command…'}
        aria-label="Terminal command input"
         className="min-w-0 flex-1 bg-transparent font-mono text-base text-ink outline-none placeholder:text-ink-3 disabled:opacity-50 sm:text-[13px]"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            recall('up')
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            recall('down')
          }
        }}
      />
    </div>
  )
}

/**
 * Composer — the message input, in the collection's PromptBar shape: a raised
 * rounded field with controls tucked inside its lower edge rather than a bare
 * textarea plus an external toolbar.
 *
 * Mobile ergonomics that matter and are easy to get wrong:
 *
 * - The input must stay above the software keyboard. Handled by
 *   `interactive-widget=resizes-content` in the viewport meta plus `dvh` units,
 *   not by measuring `visualViewport` every frame.
 * - Enter sends on desktop; on touch it inserts a newline. Thumb-typing against
 *   an on-screen Return key otherwise sends half-written prompts constantly.
 * - The field grows to a cap, then scrolls internally.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, StopIcon } from './ui'
import { cn } from '@/lib/format'

const MAX_HEIGHT_PX = 168

/** Coarse pointer means touch: Enter must not send. */
function isTouchPrimary(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

export function Composer({
  onSend,
  onStop,
  working,
  disabled,
  placeholder,
  controls,
}: {
  onSend: (text: string) => void
  onStop?: () => void
  /** True while the agent is running: send becomes stop. */
  working?: boolean
  disabled?: boolean
  placeholder?: string
  /** Config chips, rendered inside the field's lower edge. */
  controls?: ReactNode
}) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Autosize before paint, so there is no visible jump as the field grows.
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  function send() {
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    onSend(text)
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div
      className="shrink-0 px-3 pb-3 pt-1.5"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto w-full max-w-[46rem]">
        <div
          className={cn(
            'overflow-hidden rounded-[18px] border bg-surface shadow-raised',
            'transition-colors duration-150',
            focused ? 'border-line-strong' : 'border-line',
          )}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(changeEvent) => setValue(changeEvent.target.value)}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key !== 'Enter') return
              if (keyEvent.shiftKey || isTouchPrimary()) return
              keyEvent.preventDefault()
              send()
            }}
            placeholder={placeholder ?? 'Message the agent…'}
            aria-label="Message"
            className={cn(
              'scroll-thin block w-full resize-none bg-transparent px-3.5 pt-3',
              'text-[13px] leading-[1.6] text-ink outline-none',
              'placeholder:text-ink-3 disabled:opacity-50',
            )}
            style={{ maxHeight: MAX_HEIGHT_PX }}
          />

          <div className="flex items-end justify-between gap-2 px-2 pb-2 pt-1.5">
            <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
              {controls}
            </div>

            {working && onStop ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop the agent"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full',
                  'bg-red-tint text-red transition-[background-color,transform] duration-150',
                  'hover:bg-red-tint active:scale-95',
                )}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                aria-label="Send"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full',
                  'transition-[background-color,color,transform] duration-150',
                  canSend
                    ? 'bg-accent text-canvas shadow-btn active:scale-95'
                    : 'bg-hover text-ink-3',
                )}
              >
                <ArrowUp />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

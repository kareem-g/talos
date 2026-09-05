/**
 * ThoughtChip — the harness Thought level (Off/On/High/Max) as a small inline
 * chip with an anchored dropdown, shown in the mobile composer (desktop shows
 * the same control via the generic config chip).
 */

import { useRef, useState } from 'react'
import { Brain, Check, ChevronDown } from 'lucide-react'
import { useStore } from '@/store'
import { DropdownList } from './ui'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'

export function ThoughtChip({ session, compact }: { session: Session; compact?: boolean }) {
  const config = useStore((s) => s.configs[session.id])
  const setConfig = useStore((s) => s.setConfig)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  const option = config?.options?.find((o) => o.id === 'thought')
  if (!option) return null
  const current = option.currentValue
  const label =
    current && current !== 'Not set'
      ? (option.choices?.find((choice) => choice.value === current)?.name ?? current)
      : option.choices?.[0]?.name ?? 'On'

  async function choose(value: string) {
    if (busy) return
    setBusy(true)
    try {
      const applied = await setConfig(session.id, 'thought', value)
      if (applied.applied !== 'unsupported') setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Thought level: ${label}`}
        title={`Thought level · ${label}`}
        className={cn(
          'inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg border border-line/50 bg-surface/80 px-2 text-[11px] transition-all duration-150 hover:bg-hover hover:border-line-strong',
          open && 'border-line-strong bg-hover',
          compact && 'min-h-0 px-1.5 py-0.5 font-mono text-[10px]',
        )}
      >
        <Brain size={compact ? 10 : 12} className="shrink-0 opacity-70" />
        <span className="max-w-20 truncate font-medium">{label}</span>
        <ChevronDown size={10} className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <DropdownList anchorRef={ref} onClose={() => setOpen(false)} width={220}>
          <div role="listbox" className="p-1">
            <p className="px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">
              Thought level
            </p>
            {option.choices.map((choice) => {
              const active = (current ?? option.choices?.[0]?.value) === choice.value
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={busy}
                  onClick={() => void choose(choice.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover-2 disabled:opacity-50',
                    active && 'bg-accent-tint',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink">{choice.name}</span>
                    {choice.description ? (
                      <span className="block truncate text-[10px] text-ink-3">{choice.description}</span>
                    ) : null}
                  </span>
                  {active ? <Check size={13} className="shrink-0 text-accent-ink" /> : null}
                </button>
              )
            })}
          </div>
        </DropdownList>
      ) : null}
    </div>
  )
}

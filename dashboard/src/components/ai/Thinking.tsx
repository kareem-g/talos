import { useState } from 'react'
import { ChevronDown, Check, Search, FileText, CircleDot } from 'lucide-react'

/**
 * Expandable "thinking" trace adapted from Beautiful UI's ThinkingState (Steps variant).
 * Renders a shimmer "Thought for Ns" header that expands into step rows which settle
 * into muted success checks. Touch-friendly (larger targets on mobile).
 */

export interface ThinkingStep {
  label: string
  detail?: string
  kind?: 'search' | 'read' | 'code' | 'step'
  done?: boolean
}

function kindIcon(kind: ThinkingStep['kind']) {
  switch (kind) {
    case 'search':
      return <Search className="h-3.5 w-3.5" />
    case 'read':
      return <FileText className="h-3.5 w-3.5" />
    case 'code':
      return <CircleDot className="h-3.5 w-3.5" />
    default:
      return <span className="h-1.5 w-1.5 rounded-full bg-accent" />
  }
}

export function Thinking({
  seconds,
  steps,
  defaultOpen = false,
}: {
  seconds?: number
  steps: ThinkingStep[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface ai-hairline" data-ai-anim>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
        aria-expanded={open}
      >
        <span className="ai-shimmer-text text-[13px] font-medium">
          Thought{seconds ? ` for ${seconds}s` : ''}
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-1 border-t border-border px-3 py-2">
          {steps.map((step, index) => (
            <div
              key={`${step.label}-${index}`}
              className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-[12.5px] leading-5"
              style={{ animation: `ai-fade-up 220ms cubic-bezier(0.23,1,0.32,1) ${index * 60}ms both` }}
            >
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-text-muted`}>
                {step.done !== false && index < steps.length - 1
                  ? <Check className="h-3.5 w-3.5 text-success" />
                  : kindIcon(step.kind)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-text">{step.label}</span>
                {step.detail && (
                  <span className="ml-1.5 font-mono text-[11.5px] text-text-muted">{step.detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
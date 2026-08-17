import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { api } from '../lib/api'

export interface ResumeSessionProps {
  sessionId: string
  /** Optional command hint from the backend (displayed read-only). */
  resumeCommand?: string
}

type ResumeState = 'idle' | 'resuming' | 'error'

/**
 * Prominent, lightweight Resume card shown when a Claude session needs to be
 * resumed before the user can continue chatting.
 *
 * The button is disabled and labeled "Resuming…" while the request is in
 * flight (preventing duplicate spawns / rapid double-clicks). On failure it
 * shows an actionable error with a "Try again" path — it never gets stuck on
 * "Resuming…". On success the parent re-renders the active state and this
 * component unmounts itself.
 */
export function ResumeSession({ sessionId, resumeCommand }: ResumeSessionProps) {
  const [state, setState] = useState<ResumeState>('idle')
  const [error, setError] = useState<string | null>(null)

  const resume = async () => {
    if (state === 'resuming') return
    setState('resuming')
    setError(null)
    try {
      const result = await api.sessions.resume(sessionId)
      if (!result.success) {
        setError(result.error || 'Unable to resume session.')
        setState('error')
        return
      }
      // Success. If the resumed process keeps running, the parent flips the
      // session to active and unmounts this card. If it exits immediately (e.g.
      // a session with no further work) and the parent keeps the card mounted,
      // fall back to idle so the user is never stuck on "Resuming…".
      setState('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resume session.')
      setState('error')
    }
  }

  return (
    <div className="mx-auto my-4 w-full max-w-md animate-[fade-up_300ms_cubic-bezier(0.23,1,0.32,1)_both]">
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div className="flex flex-col items-center gap-3 px-6 py-7 text-center">
          <div className="flex size-12 items-center justify-center rounded-control bg-orange-tint">
            <RotateCcw className="h-5 w-5 text-orange" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-ink">Session needs to be resumed</p>
            <p className="mt-1 text-[12px] leading-5 text-ink-2">
              This Claude session is available to continue.
            </p>
          </div>

          {resumeCommand && state !== 'resuming' && (
            <code className="max-w-full truncate rounded-control bg-inset px-3 py-1.5 font-mono text-[11px] text-ink-2">
              {resumeCommand}
            </code>
          )}

          {state === 'error' && error && (
            <p className="text-[12px] text-orange">{error}</p>
          )}

          <button
            type="button"
            onClick={() => void resume()}
            disabled={state === 'resuming'}
            aria-busy={state === 'resuming'}
            className="mt-1 flex h-11 items-center justify-center rounded-control bg-ink px-6 text-[13px] font-medium transition-opacity active:opacity-80 disabled:opacity-60"
            style={{ color: 'hsl(var(--surface))' }}
          >
            {state === 'resuming' ? 'Resuming…' : state === 'error' ? 'Try again' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  )
}

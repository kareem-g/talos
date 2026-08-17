import { useEffect, useRef, useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { PhraseCycler } from './statusUtils'
import type { StreamingStatusMode } from './statusPhrases'

const PHRASE_INTERVAL_MS = 1700

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

export interface StreamingStatusProps {
  /**
   * What the model is doing, when known. Drives context-specific phrases.
   * `general` (default) uses the large rotating pool.
   */
  mode?: StreamingStatusMode
  /**
   * True once the assistant has started producing visible text. When set, the
   * indicator stops cycling phrases so it doesn't jitter against the streamed
   * response.
   */
  hasContent?: boolean
}

/**
 * ChatGPT-style streaming status indicator.
 *
 * Driven entirely by the parent's running state (assistant-ui generation
 * lifecycle): it mounts only while the assistant message is generating and
 * unmounts when generation finishes, so there is no separate isLoading flag to
 * drift out of sync with the model.
 */
export default function StreamingStatus({ mode = 'general', hasContent = false }: StreamingStatusProps) {
  const reducedMotion = usePrefersReducedMotion()
  const cyclerRef = useRef<PhraseCycler | null>(null)
  if (!cyclerRef.current) cyclerRef.current = new PhraseCycler(mode)

  const [phrase, setPhrase] = useState<string>(() => cyclerRef.current!.next())

  // Keep hasContent in a ref so the interval never restarts on every streamed token.
  const hasContentRef = useRef(hasContent)
  useEffect(() => {
    hasContentRef.current = hasContent
  }, [hasContent])

  // Swap the phrase pool when the known operation changes.
  const modeRef = useRef(mode)
  useEffect(() => {
    if (modeRef.current !== mode) {
      modeRef.current = mode
      cyclerRef.current = new PhraseCycler(mode, phrase)
    }
  }, [mode, phrase])

  // One timer for the mounted (running) indicator; cleaned up on unmount.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (hasContentRef.current) return
      setPhrase((prev) => cyclerRef.current!.next(prev))
    }, PHRASE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      role="status"
      className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface/80 px-2.5 py-1.5 text-[11.5px] text-ink-2 shadow-hairline backdrop-blur"
    >
      <span
        className={`select-none text-[12px] leading-none text-orange ${reducedMotion ? '' : 'animate-pulse'}`}
        aria-hidden="true"
      >
        ✦
      </span>
      <span
        key={phrase}
        className={reducedMotion ? '' : 'animate-[stream-in_220ms_cubic-bezier(0.22,0.61,0.25,1)]'}
      >
        {phrase}
      </span>
      {/* Single static label for assistive tech; announced once, not on every change. */}
      <span className="sr-only">Assistant is generating a response.</span>
    </div>
  )
}

/**
 * Full generation-status component for an assistant message.
 *
 * Combines the two phases of the generation lifecycle:
 *   - while `running`  → shows the rotating `StreamingStatus` (✦ Thinking…)
 *   - once `complete`  → replaces it with the static duration line
 *                         (✦ Worked for 18s) or an interrupted note.
 *
 * Mounted once inside `AssistantMessage`; it swaps its own content based on
 * the real assistant-ui message status, so it can never hang the UI in a
 * generating state.
 */
export function MessageStreamingDuration() {
  const status = useAuiState((s) => s.message.status?.type)
  if (status === 'running') {
    return <MessageStreamingStatus />
  }
  if (status === 'complete') {
    return <MessageGenerationDuration />
  }
  return null
}

/**
 * Context-aware variant for use inside an assistant message.
 *
 * Reads the real message parts through assistant-ui's reactive state (no
 * separate isLoading flag) to choose honest context phrases and to stop
 * cycling once the assistant starts producing visible text:
 *   - a `reasoning` part exists        → thinking mode
 *   - a `tool-call`/tool `data` part exists → tool mode
 *   - a non-empty `text` part exists   → hasContent (fades the cycling out)
 *
 * Rendered only while the message is generating (wrap in
 * `<AuiIf running>`), so it mounts/unmounts with the real
 * streaming state and disappears on completion or cancel.
 */
export function MessageStreamingStatus() {
  const content = useAuiState((s) => s.message.content)
  const hasReasoning = content.some((part) => part.type === 'reasoning')
  const hasTool = content.some(
    (part) =>
      part.type === 'tool-call' ||
      (part.type === 'data' && part.name?.startsWith('agent-')),
  )
  const hasContent = content.some(
    (part) => part.type === 'text' && typeof part.text === 'string' && part.text.length > 0,
  )

  const mode: StreamingStatusMode = hasReasoning ? 'thinking' : hasTool ? 'tool' : 'general'
  return <StreamingStatus mode={mode} hasContent={hasContent} />
}

/**
 * Static post-generation status line shown beneath a completed assistant message.
 *
 * Reads the duration that `buildThreadMessages` persisted to the message's
 * `metadata.custom`. Because it is derived from event timestamps (never a
 * timer), the value is stable across reloads and never recalculated after the
 * generation finishes.
 *
 *   - completed → "✦ Worked for 18s"
 *   - failed    → "Generation interrupted" (no duration shown)
 *
 * Rendered only when the message status is `complete`. No timers, no
 * subscriptions — pure derived state.
 */
export function MessageGenerationDuration() {
  const metadata = useAuiState((s) => s.message.metadata)
  const custom = metadata?.custom as { durationMs?: number; status?: 'completed' | 'failed' } | undefined

  if (!custom || custom.status === 'failed') {
    return (
      <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-orange">
        <span aria-hidden="true">✦</span>
        <span>Generation interrupted</span>
      </div>
    )
  }

  return (
    <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-3">
      <span aria-hidden="true">✦</span>
      <span>Worked for {formatGenerationDuration(custom.durationMs ?? 0)}</span>
    </div>
  )
}

function formatGenerationDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

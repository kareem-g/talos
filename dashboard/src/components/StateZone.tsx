/**
 * StateZone — the bottom of the session, as a state machine surface.
 *
 * The composer used to look identical in every state: an active input while the
 * agent needed approval, after it failed, after it exited. This zone renders
 * the honest UI for each state instead:
 *
 *   working    → composer (send morphs to stop) + a live activity strip
 *   approval   → a pointer card; the request itself is the focus above
 *   input      → composer + an amber "waiting for you" cue
 *   paused     → resume card with the command that brings it back
 *   failed     → error card with the reason and a Retry action
 *   ended      → ended card with Resume
 *   resuming   → in-flight strip
 *   reconnecting/offline → connection strips; input waits
 *
 * One rule drives the copy: say what is happening, then what to do next.
 */

import { useEffect, useMemo, useState } from 'react'
import { Composer } from './Composer'
import { ConfigBar } from './ConfigControls'
import { Button, Dots } from './ui'
import { socket } from '@/lib/socket'
import { useStore } from '@/store'
import { cn, formatDuration } from '@/lib/format'
import { firstOpenApprovalId, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { describeApproval } from '@/lib/approvals'
import type { Conversation } from '@/types/conversation'
import type { ConnectionState } from '@/types/protocol'
import type { Provider, SessionConfig } from '@/types/provider'
import type { Session } from '@/types/session'

/** Seconds since `since`, ticking once per second. Mounted only while live. */
function useElapsed(since: string | undefined): string | undefined {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  if (!since) return undefined
  const start = new Date(since).getTime()
  if (Number.isNaN(start)) return undefined
  return formatDuration(Math.max(0, now - start))
}

/** The live strip while the agent works: what it is doing, and for how long.
 *  Stop/interrupt stay in the composer below, where the send button was. */
function WorkingStrip({ conversation }: { conversation: Conversation }) {
  const activity = conversation.activity
  const elapsed = useElapsed(activity?.since)
  const label = activity?.label ?? 'Working'
  return (
    <div className="flex items-center gap-3 border-t border-line/40 bg-surface/80 px-4 py-2.5">
      <span className="size-[9px] shrink-0 rounded-full border-2 border-accent border-t-transparent breathe" aria-hidden />
      <span className="shrink-0 text-[12px] font-medium text-ink shimmer">{label}</span>
      {activity?.detail ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{activity.detail}</span>
      ) : (
        <span className="flex-1" />
      )}
      {elapsed ? (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{elapsed}</span>
      ) : null}
    </div>
  )
}

/** Scroll the first open approval card into view. */
function scrollToApproval(): void {
  const element = document.querySelector('[data-approval-id][role="alert"]')
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** Amber pointer card when the agent is blocked on a permission. */
function ApprovalPointer({ conversation }: { conversation: Conversation }) {
  const requestId = firstOpenApprovalId(conversation)
  const part = useMemo(() => {
    if (!requestId) return undefined
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      for (const candidate of conversation.messages[index].parts) {
        if (candidate.kind === 'approval' && candidate.requestId === requestId) return candidate
      }
    }
    return undefined
  }, [conversation, requestId])

  const view = part ? describeApproval(part.prompt, part.options) : undefined
  const summary = view?.context ?? view?.question

  return (
    <div className="border-t border-orange/20 bg-surface/80 px-4 py-3" role="status">
      <div className="mx-auto flex w-full max-w-[46rem] items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-orange/[0.08] text-orange"
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink">Approval needed</p>
          {summary ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{summary}</p>
          ) : null}
        </div>
        <Button variant="primary" onClick={scrollToApproval} className="shrink-0">
          Review
        </Button>
      </div>
    </div>
  )
}

/** Resume card for a paused session — the command that brings it back. */
function ResumeCard({
  session,
  tone,
  title,
  description,
  onResume,
  resuming,
}: {
  session: Session
  tone: 'orange' | 'dim'
  title: string
  description: string
  onResume: () => void
  resuming: boolean
}) {
  const connected = useStore((s) => s.connection) === 'connected'
  return (
    <div
      className={cn(
        'border-t bg-surface/80 px-4 py-3',
        tone === 'orange' ? 'border-orange/20' : 'border-line/40',
      )}
      role="status"
    >
      <div className="mx-auto flex w-full max-w-[46rem] items-center gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            tone === 'orange' ? 'bg-orange-tint text-orange' : 'bg-field text-ink-3',
          )}
          aria-hidden
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">{title}</p>
          {session.resume_command ? (
            <code className="mt-1 block truncate font-mono text-[11px] text-ink-3" title={session.resume_command}>
              {session.resume_command}
            </code>
          ) : (
            <p className="mt-0.5 text-[11px] text-ink-3">{description}</p>
          )}
        </div>
        <Button
          variant="primary"
          onClick={onResume}
          disabled={resuming || !connected}
          className="shrink-0"
        >
          {resuming ? 'Resuming…' : 'Resume'}
        </Button>
      </div>
    </div>
  )
}

/** Failure card: the reason plus the one action that helps. */
function FailureCard({ reason, onRetry, retrying }: { reason?: string; onRetry: () => void; retrying: boolean }) {
  const connected = useStore((s) => s.connection) === 'connected'
  return (
    <div className="border-t border-red/20 bg-surface/80 px-4 py-3" role="alert">
      <div className="mx-auto flex w-full max-w-[46rem] items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-tint text-red" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">Agent failed</p>
          {reason ? (
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-ink-3">
              {reason}
            </p>
          ) : null}
        </div>
        <Button variant="primary" onClick={onRetry} disabled={retrying || !connected} className="shrink-0">
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    </div>
  )
}

/** Quiet strip for in-between states (resuming, reconnecting, offline, archived). */
function StateStrip({ label, hint, pulse }: { label: string; hint?: string; pulse?: boolean }) {
  return (
    <div className="border-t border-line/40 bg-surface/80 px-4 py-2.5" role="status">
      <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2.5">
        {pulse ? (
          <Dots />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
        )}
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {hint ? <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{hint}</span> : <span className="flex-1" />}
      </div>
    </div>
  )
}

/** The most recent error message in the transcript, for the failure card. */
function lastErrorReason(conversation: Conversation | undefined): string | undefined {
  if (!conversation) return undefined
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const parts = conversation.messages[index].parts
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (part.kind === 'error') return part.message
    }
  }
  return undefined
}

export function StateZone({
  session,
  conversation,
  connection,
  config,
  provider,
  onSend,
  onSetConfig,
}: {
  session: Session
  conversation: Conversation
  connection: ConnectionState
  config?: SessionConfig
  provider?: Provider
  onSend: (text: string) => void
  onSetConfig: (id: string, value: string) => void
}) {
  const state = sessionUIState(session, conversation, connection)
  const display = uiStateDisplay(state)
  const notice = useStore((s) => s.notices[session.id])
  const stopSession = useStore((s) => s.stopSession)
  const resumeSession = useStore((s) => s.resumeSession)
  const [retrying, setRetrying] = useState(false)

  const working = state === 'working' || state === 'starting'

  const resume = () => {
    setRetrying(true)
    void resumeSession(session.id).finally(() => setRetrying(false))
  }

  const composer = (
    <Composer
      wide
      onSend={onSend}
      onStop={() => void stopSession(session.id)}
      onInterrupt={() => socket.interruptSession(session.id)}
      working={working}
      disabled={connection !== 'connected'}
      placeholder={connection !== 'connected' ? 'Waiting for connection…' : 'Message the agent…'}
      commands={conversation.commands.length > 0 ? conversation.commands : undefined}
      agentId={session.agent}
      projectPath={session.project ?? undefined}
      controls={
        config ? (
          <ConfigBar
            options={config.options}
            live={config.live}
            modelsSource={provider?.modelsSource}
            onChange={(id, v) => onSetConfig(id, v)}
          />
        ) : null
      }
    />
  )

  switch (state) {
    case 'approval':
      return (
        <div>
          <ApprovalPointer conversation={conversation} />
          {/* The composer stays reachable during approval — queueing a note
              must not require answering first. */}
          {composer}
        </div>
      )
    case 'paused':
      return (
        <ResumeCard
          session={session}
          tone="orange"
          title="Session paused"
          description={display.hint ?? 'Resume to continue this session'}
          onResume={resume}
          resuming={retrying}
        />
      )
    case 'failed': {
      const reason = notice ?? lastErrorReason(conversation)
      return <FailureCard reason={reason} onRetry={resume} retrying={retrying} />
    }
    case 'ended':
      return (
        <div>
          <div className="flex items-center gap-2 border-t border-line/40 bg-surface/80 px-4 pt-2.5" role="status">
            <span className="size-1.5 shrink-0 rounded-full bg-green" aria-hidden />
            <span className="text-[11.5px] font-medium text-ink-2">Session completed</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
              {session.resume_command ? 'Process exited — resume to restart it' : 'Send a message to continue this conversation'}
            </span>
          </div>
          {composer}
        </div>
      )
    case 'resuming':
      return <StateStrip label="Resuming session…" pulse />
    case 'reconnecting':
      return <StateStrip label="Reconnecting…" hint="Live updates are paused" pulse />
    case 'offline':
      return <StateStrip label="Offline" hint="Reconnect to send messages" />
    case 'archived':
      return <StateStrip label="Archived" hint="This session is read-only" />
    case 'input':
      return (
        <div>
          <div className="flex items-center gap-2 border-t border-orange/20 bg-surface/80 px-4 pt-2" role="status">
            <span className="size-1.5 shrink-0 rounded-full bg-orange" aria-hidden />
            <span className="text-[11.5px] font-medium text-orange">The agent is waiting for you</span>
          </div>
          {composer}
        </div>
      )
    case 'working':
    case 'starting':
      return (
        <div>
          <WorkingStrip conversation={conversation} />
          {composer}
        </div>
      )
    case 'ready':
      return composer
  }
}

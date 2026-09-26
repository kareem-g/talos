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

import { useMemo, useState } from 'react'
import { Composer } from './Composer'
import { ComposerControls, PermissionChip } from '@/components/desktop/session/TasksAndExecution'
import { EngineModelMenu } from '@/components/EngineModelMenu'
import { ThoughtChip } from '@/components/ThoughtChip'
import { deriveSubagents } from '@/components/desktop/session/workspaceData'
import { Button } from './ui'
import LoadingState from './LoadingState'
import { socket } from '@/lib/socket'
import { attachmentsApi } from '@/lib/api'
import { useStore } from '@/store'
import { cn } from '@/lib/format'
import { firstOpenApprovalId, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { describeApproval } from '@/lib/approvals'
import type { AttachmentRef, Conversation } from '@/types/conversation'
import type { ConnectionState } from '@/types/protocol'
import type { Provider, SessionConfig } from '@/types/provider'
import type { Session } from '@/types/session'

/** Live status docked to the top of the composer card while the agent works. */
function WorkingStrip({ conversation }: { conversation: Conversation }) {
  const activity = conversation.activity
  const label = activity?.label ?? 'Working'
  return (
    <div className="flex min-w-0 items-center gap-2" role="status">
      <LoadingState label={label} variant="Drive" since={activity?.since} />
      {activity?.detail ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{activity.detail}</span>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  )
}

/** Compact dock row shared by the idle-state headers (completed / waiting). */
function DockStatus({
  dot,
  title,
  titleClass,
  hint,
}: {
  dot: string
  title: string
  titleClass?: string
  hint?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" role="status">
      <span className={cn('size-1.5 shrink-0 rounded-full', dot)} aria-hidden />
      <span className={cn('shrink-0 text-[11.5px] font-medium', titleClass ?? 'text-ink-2')}>{title}</span>
      {hint ? <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{hint}</span> : <span className="flex-1" />}
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

  const view = part ? describeApproval(part.prompt, part.options, {
    optionData: part.optionData,
    multiSelect: part.multiSelect,
    allowsCustomText: part.allowsCustomText,
  }) : undefined
  const summary = view?.context ?? view?.question

  return (
    <div className="flex min-w-0 items-center gap-2" role="status">
      <span className="size-1.5 shrink-0 rounded-full bg-orange" aria-hidden />
      <span className="shrink-0 text-[11.5px] font-medium text-orange">Approval needed</span>
      {summary ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{summary}</span>
      ) : (
        <span className="flex-1" />
      )}
      <Button variant="primary" onClick={scrollToApproval} className="shrink-0 !min-h-7 px-2.5 text-[11.5px]">
        Review
      </Button>
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
      <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3">
        <div className="flex w-full items-center gap-3">
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
            className="shrink-0 min-h-9"
          >
            {resuming ? 'Resuming…' : 'Resume'}
          </Button>
        </div>
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
          <>
            <LoadingState label={label} variant="Dots" />
            {hint ? <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{hint}</span> : <span className="flex-1" />}
          </>
        ) : (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
            <span className="text-[12px] font-medium text-ink-2">{label}</span>
            {hint ? <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{hint}</span> : <span className="flex-1" />}
          </>
        )}
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
  onQueue,
  onSetConfig,
  rooms,
  workers,
  compact,
  wide = true,
}: {
  session: Session
  conversation: Conversation
  connection: ConnectionState
  config?: SessionConfig
  provider?: Provider
  onSend: (text: string, attachments: AttachmentRef[]) => boolean | void
  /**
   * Queue path. When provided it routes dispatch commands (which are
   * independent of the busy agent) immediately; plain text still queues.
   */
  onQueue?: (text: string, attachments: AttachmentRef[]) => boolean | void
  onSetConfig: (id: string, value: string) => void
  /** Room names for the #-menu so the user can mention a room. */
  rooms?: string[]
  /** Room worker names for the @-menu (when this session is a room channel). */
  workers?: string[]
  /** Mobile compact mode: hide the in-line config chips in the composer. */
  compact?: boolean
  /** Full-width composer (default). False caps the bar at the reading
   *  column width and centers it, matching the reference's composer. */
  wide?: boolean
}) {
  const state = sessionUIState(session, conversation, connection)
  const display = uiStateDisplay(state)
  const notice = useStore((s) => s.notices[session.id])
  const resumeSession = useStore((s) => s.resumeSession)
  const queue = useStore((s) => s.queues[session.id])
  const queueMessage = useStore((s) => s.queueMessage)
  const steerQueued = useStore((s) => s.steerQueued)
  const editQueued = useStore((s) => s.editQueued)
  const removeQueued = useStore((s) => s.removeQueued)
  const reorderQueued = useStore((s) => s.reorderQueued)
  const [retrying, setRetrying] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  // Set when the user edits a queued message: hands the draft back to the composer.
  const [draftSeed, setDraftSeed] = useState<{ text: string; attachments: AttachmentRef[]; nonce: number } | null>(null)

  // Subagents this session spawned — feeds the composer's subagents popup.
  const subagents = deriveSubagents(conversation.messages)

  const working = state === 'working' || state === 'starting'

  const resume = () => {
    setRetrying(true)
    void resumeSession(session.id).finally(() => setRetrying(false))
  }

  const handleSetConfig = (id: string, value: string) => {
    setUpdating(id)
    void Promise.resolve(onSetConfig(id, value)).finally(() => setUpdating(null))
  }

  // Real context-window data: the agent's most recent reported usage against
  // the configured window. Scanned newest-first across all turns — the final
  // message of a turn doesn't always carry the accounting.
  const contextUsage = (() => {
    let usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number } | undefined
    for (let index = conversation.messages.length - 1; index >= 0 && !usage; index--) {
      const message = conversation.messages[index]
      if (message.role !== 'assistant') continue
      usage = message.parts.find(
        (part): part is Extract<typeof part, { kind: 'usage' }> => part.kind === 'usage',
      )
    }
    if (!usage || ((usage.inputTokens ?? 0) <= 0 && (usage.outputTokens ?? 0) <= 0)) return undefined
    const windowOption = config?.options.find((option) => option.id === 'context_window')
    const windowTokens = Number.parseInt(windowOption?.currentValue ?? '', 10)
    return {
      usedTokens: usage.inputTokens ?? 0,
      windowTokens: Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : undefined,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costUsd: usage.costUsd,
    }
  })()

  const handleEditQueued = (id: string) => {
    const message = editQueued(session.id, id)
    if (message) setDraftSeed({ text: message.text, attachments: message.attachments, nonce: Date.now() })
  }

  // Mobile summary chip: engine + model + mode + effort in one short string,
  // so the user can see what's set without opening the right pane. Same data
  // as the right-pane rows, just flattened.
  const summary = useMemo(() => {
    if (!compact) return undefined
    const isThinking = (id: string) =>
      id === 'thought' || ['effort', 'thinking', 'reasoning'].includes(id) || id.includes('effort')
    const isModel = (id: string) => id === 'model' || id.includes('model')
    const parts: string[] = []
    const opts = config?.options ?? []
    const model = opts.find((o) => isModel(o.id))
    const modelLabel =
      model?.currentValue && model.currentValue !== 'Not set'
        ? (model.choices?.find((c) => c.value === model.currentValue)?.name ?? model.currentValue)
        : undefined
    if (provider?.name && modelLabel && modelLabel !== provider.name) {
      parts.push(`${provider.name} · ${modelLabel}`)
    } else if (modelLabel) {
      parts.push(modelLabel)
    } else if (provider?.name) {
      parts.push(provider.name)
    }
    if (conversation.mode) {
      const cur = conversation.mode.modes.find((m) => m.id === conversation.mode!.id)
      const label = cur?.name ?? cur?.id
      if (label) parts.push(label)
    }
    const thought = opts.find((o) => o.id === 'thought')
    if (thought?.currentValue) {
      const choice = thought.choices?.find((c) => c.value === thought.currentValue)
      parts.push(`Thought ${choice?.name ?? thought.currentValue}`)
    } else {
      const effort = opts.find((o) => !isModel(o.id) && isThinking(o.id))
      if (effort?.currentValue) {
        const choice = effort.choices?.find((c) => c.value === effort.currentValue)
        parts.push(choice?.name ?? effort.currentValue)
      }
    }
    return parts.length > 0 ? parts.join(' · ') : undefined
  }, [compact, config?.options, conversation.mode, provider?.name])

  // Dock header — the state strip merged into the top of the composer card,
  // so status / queue / images share one border instead of floating bars.
  const dockHeader =
    state === 'approval' ? (
      <ApprovalPointer conversation={conversation} />
    ) : state === 'ended' ? (
      <DockStatus
        dot="bg-green"
        title="Session completed"
        hint={
          session.resume_command
            ? 'Process exited — resume to restart it'
            : 'Send a message to continue this conversation'
        }
      />
    ) : state === 'input' ? (
      <DockStatus dot="bg-orange" title="The agent is waiting for you" titleClass="text-orange" />
    ) : working ? (
      <WorkingStrip conversation={conversation} />
    ) : undefined

  const composer = (
    <Composer
      wide={wide}
      compact={compact}
      summary={summary}
      header={dockHeader}
      compactControls={
        compact ? (
          <>
            {!session.hidden && !session.parent_id ? <EngineModelMenu session={session} compact /> : null}
            <ThoughtChip session={session} compact />
            <PermissionChip
              currentMode={config?.options.find((o) => o.id === 'permission_mode')?.currentValue}
              onChange={handleSetConfig}
            />
          </>
        ) : undefined
      }
      onSend={onSend}
      // Stop ends the running response only — the session stays resumable, so
      // the next message or a steer just works (auto-resume on send).
      onStop={() => socket.interruptSession(session.id)}
      working={working}
      disabled={connection !== 'connected'}
      placeholder={
        connection !== 'connected'
          ? 'Waiting for connection…'
          : working
            ? 'Keep typing to queue follow-up changes'
            : 'Message the agent…'
      }
      commands={conversation.commands.length > 0 ? conversation.commands : undefined}
      agentId={session.agent}
      projectPath={session.project ?? undefined}
      queue={queue}
      onQueue={(text, attachments) => {
        // The caller's queue handler routes dispatch commands immediately;
        // fall back to a plain queue when the workspace didn't wire one.
        if (onQueue) return onQueue(text, attachments)
        queueMessage(session.id, text, attachments)
      }}
      onSteer={(id) => steerQueued(session.id, id)}
      onEditQueued={handleEditQueued}
      onRemoveQueued={(id) => removeQueued(session.id, id)}
      onReorderQueued={(from, to) => reorderQueued(session.id, from, to)}
      onUploadFiles={(files) => attachmentsApi.upload(session.id, files)}
      draftSeed={draftSeed}
      sessionId={session.id}
      contextUsage={contextUsage}
      rooms={rooms}
      workers={workers}
      controls={
        compact ? undefined : (
          <ComposerControls
            part="left"
            session={session}
            config={config}
            agent={session.agent}
            modelsSource={provider?.modelsSource}
            busyId={updating}
            mode={conversation.mode}
            onChange={handleSetConfig}
            subagents={subagents}
          />
        )
      }
      controlsRight={
        compact ? undefined : (
          <ComposerControls
            part="right"
            session={session}
            config={config}
            agent={session.agent}
            modelsSource={provider?.modelsSource}
            busyId={updating}
            mode={conversation.mode}
            onChange={handleSetConfig}
          />
        )
      }
    />
  )

  switch (state) {
    case 'approval':
      // The composer stays reachable during approval — queueing a note
      // must not require answering first. Status is docked in the card.
      return composer
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
      return composer
    case 'resuming':
      return <StateStrip label="Resuming session…" pulse />
    case 'reconnecting':
      return <StateStrip label="Reconnecting…" hint="Live updates are paused" pulse />
    case 'offline':
      return <StateStrip label="Offline" hint="Reconnect to send messages" />
    case 'archived':
      return <StateStrip label="Archived" hint="This session is read-only" />
    case 'input':
      return composer
    case 'working':
    case 'starting':
      return composer
    case 'ready':
      return composer
  }
}

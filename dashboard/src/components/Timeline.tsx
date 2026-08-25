/**
 * Timeline — the conversation.
 *
 * The main column stays prose-first. Reasoning and tool activity are compact,
 * collapsed rows in the Beautiful UI idiom rather than an expanded debug log,
 * and file changes are grouped into chips at the end of a turn instead of one
 * row each.
 *
 * Terminal bytes never reach here — the reducer routes `terminal_output` to the
 * terminal view only.
 */

import { memo, useEffect, useRef } from 'react'
import { Part } from './chat'
import { FileChips } from './chat'
import LoadingState from './LoadingState'
import { cn } from '@/lib/format'
import type {
  Activity,
  Conversation,
  FileChangePart,
  Message,
  MessagePart,
} from '@/types/conversation'

/**
 * Split a turn's parts into the inline sequence and the trailing file changes.
 * Grouping the files mirrors how the collection presents diffs and keeps the
 * timeline from turning into a list of one-line file rows.
 */
function partition(parts: MessagePart[]): {
  inline: MessagePart[]
  files: FileChangePart[]
} {
  const inline: MessagePart[] = []
  const files: FileChangePart[] = []
  for (const part of parts) {
    if (part.kind === 'file') files.push(part)
    else inline.push(part)
  }
  return { inline, files }
}

const Turn = memo(function Turn({
  message,
  onRespond,
}: {
  message: Message
  onRespond: (requestId: string, decision: string) => void
}) {
  if (message.role === 'user') {
    const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('')
    const time = new Date(message.createdAt)
    return (
      <div className="group flex justify-end">
        <div className="flex max-w-[86%] flex-col items-end">
          <time
            dateTime={message.createdAt}
            title={Number.isNaN(time.getTime()) ? undefined : time.toLocaleString()}
            className="mb-0.5 pr-0.5 font-mono text-[10px] text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            {Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          <div
            className={cn(
              'rounded-2xl rounded-br-md bg-accent/[0.08] border border-accent/[0.12] px-3.5 py-2.5',
              'transition-opacity duration-200',
              message.optimistic && 'opacity-60',
            )}
          >
            <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-ink">
              {text}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { inline, files } = partition(message.parts)

  return (
    <div className="flex flex-col gap-2">
      {inline.map((part, index) => (
        <Part key={index} part={part} onRespond={onRespond} />
      ))}
      {files.length > 0 ? <FileChips files={files} /> : null}
    </div>
  )
})

/** Live activity — pixel-grid loader with shimmer + elapsed */
function ActivityLine({ activity }: { activity: Activity }) {
  const hasDetail = Boolean(activity.detail)
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line/40 bg-surface/60 px-4 py-3 shadow-card animate-up">
      <div className="min-w-0 flex-1">
        <LoadingState label={activity.label} variant="Drive" since={activity.since} />
        {hasDetail ? (
          <span className="mt-1.5 block truncate font-mono text-[11.5px] leading-none text-ink-3">{activity.detail}</span>
        ) : null}
      </div>
    </div>
  )
}

export function Timeline({
  conversation,
  onRespond,
}: {
  conversation: Conversation
  onRespond: (requestId: string, decision: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Whether the user is near the bottom; only then do we follow new content. */
  const pinnedRef = useRef(true)

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !pinnedRef.current) return
    element.scrollTop = element.scrollHeight
  }, [conversation.messages, conversation.activity])

  const empty = conversation.messages.length === 0

  return (
    <div
      ref={scrollRef}
      onScroll={(scrollEvent) => {
        const element = scrollEvent.currentTarget
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight
        pinnedRef.current = distance < 140
      }}
      className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3.5 px-4 py-4">
        {empty ? (
          <div className="flex flex-col items-center gap-1.5 py-14 text-center">
            <p className="text-[12.5px] font-medium text-ink-2">The transcript is empty.</p>
            <p className="max-w-[36ch] text-[12px] leading-[1.6] text-ink-3">
              Send the first message below — the agent's work, tool calls, and
              approvals will stream here.
            </p>
          </div>
        ) : null}
        {conversation.messages.map((message) => (
          <Turn key={message.id} message={message} onRespond={onRespond} />
        ))}
        {conversation.activity ? <ActivityLine activity={conversation.activity} /> : null}
      </div>
    </div>
  )
}

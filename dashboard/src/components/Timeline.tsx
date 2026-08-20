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
import { Dots } from './ui'
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
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            'max-w-[86%] rounded-card rounded-br-[5px] bg-surface px-3 py-2 shadow-card',
            'transition-opacity duration-200',
            // A quiet cue that the server has not confirmed it yet.
            message.optimistic && 'opacity-60',
          )}
        >
          <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-ink">
            {text}
          </p>
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

/** Live activity — Zcode-style: state label + mono detail on second line. */
function ActivityLine({ activity }: { activity: Activity }) {
  const hasDetail = Boolean(activity.detail)
  return (
    <div className="flex items-start gap-2.5 rounded-card border border-line/60 bg-surface/60 px-3 py-2.5 shadow-card animate-up">
      <span className="mt-1 flex shrink-0">
        <Dots />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium leading-none text-ink shimmer">{activity.label}</span>
        {hasDetail ? (
          <span className="mt-1 block truncate font-mono text-[11.5px] leading-none text-ink-3">{activity.detail}</span>
        ) : null}
      </span>
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
          <p className="py-10 text-center text-[12.5px] text-ink-3">
            Send a message to start this session.
          </p>
        ) : null}
        {conversation.messages.map((message) => (
          <Turn key={message.id} message={message} onRespond={onRespond} />
        ))}
        {conversation.activity ? <ActivityLine activity={conversation.activity} /> : null}
      </div>
    </div>
  )
}

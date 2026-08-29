/**
 * Timeline — the conversation.
 *
 * The main column stays prose-first. Reasoning and tool activity are compact,
 * collapsed rows in the Beautiful UI idiom rather than an expanded debug log,
 * and file changes are grouped into chips at the end of a turn instead of one
 * row each.
 *
 * A navigator rail floats at the center-left: one tick per user turn, the
 * in-view turn bolded. Hovering expands it into a card of turn previews you can
 * click to jump.
 *
 * Terminal bytes never reach here — the reducer routes `terminal_output` to the
 * terminal view only.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Part } from './chat'
import { FileChips } from './chat'
import { Chips } from './chat'
import LoadingState from './LoadingState'
import { CopyButton, IconButton, RefreshIcon } from './ui'
import { cn } from '@/lib/format'
import { useStore } from '@/store'
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

/** One-line preview of a user turn for the navigator card. */
function turnPreview(message: Message): string {
  const text = message.parts
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join(' ')
    // The backend injects a skills_instructions preamble into the first prompt;
    // it is noise in a jump preview, so drop it.
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 46 ? `${text.slice(0, 46).trimEnd()}…` : text
}

const Turn = memo(function Turn({
  message,
  onRespond,
  onRetry,
  project,
  sessionId,
}: {
  message: Message
  onRespond: (requestId: string, decision: string, meta?: { customText?: string; always?: boolean; allow?: boolean }) => void
  onRetry: () => void
  project?: string
  sessionId?: string
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
              <Chips text={text} />
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { inline, files } = partition(message.parts)
  const assistantText = message.parts
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join('')

  return (
    <div className="group flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {inline.map((part, index) => (
            <Part key={index} part={part} onRespond={onRespond} sessionId={sessionId} />
          ))}
          {files.length > 0 ? <FileChips files={files} project={project} sessionId={sessionId} /> : null}
        </div>
        {/* Assistant action bar — revealed on hover, like ChatGPT's controls. */}
        <div className="flex shrink-0 items-center gap-0.5 pt-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton value={assistantText} label="Copy" />
          <IconButton label="Retry from last prompt" onClick={onRetry} className="size-7">
            <RefreshIcon size={13} />
          </IconButton>
        </div>
      </div>
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

/**
 * Navigator rail — a vertical spine of tick dashes pinned to the center-left of
 * the scroll viewport, one per user turn. The turn currently in view renders
 * bold and wide; the rest are quiet. Hovering slides out a card of turn
 * previews; clicking one scrolls the timeline to that turn.
 *
 * The card is a flex sibling of the rail (not absolutely positioned) so the
 * hover region is continuous — moving from the ticks to the card never crosses
 * a gap that would close it.
 */
function TimelineNavigator({
  turns,
  activeId,
  onJump,
}: {
  turns: Array<{ id: string; preview: string }>
  activeId?: string
  onJump: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (turns.length === 0) return null

  return (
    <div
      className="absolute left-1 top-1/2 z-20 flex -translate-y-1/2 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Collapsed rail: spine + one tick per turn. Ticks rest small and grow
          to full width when the rail is hovered; the in-view turn stays bold. */}
      <div className="relative flex flex-col items-center gap-2.5 py-2">
        <div
          className={cn(
            'absolute inset-y-0 w-px transition-colors duration-200',
            open ? 'bg-line-strong/60' : 'bg-line/40',
          )}
          aria-hidden
        />
        {turns.map((turn) => (
          <button
            key={turn.id}
            type="button"
            aria-label={`Jump to: ${turn.preview}`}
            onClick={() => onJump(turn.id)}
            className={cn(
              'relative h-px rounded-full transition-all duration-200 ease-out',
              turn.id === activeId
                ? 'w-4 bg-ink'
                : open
                  ? 'w-2.5 bg-line-strong hover:w-3.5 hover:bg-ink-3'
                  : 'w-1.5 bg-line-strong/70 hover:bg-ink-3',
            )}
          />
        ))}
      </div>

      {/* Hover card: clickable turn previews with a trailing tick. */}
      {open ? (
        <div className="ml-2 w-64 rounded-xl border border-line bg-surface/95 p-1.5 shadow-overlay backdrop-blur animate-up">
          {turns.map((turn) => {
            const active = turn.id === activeId
            return (
              <button
                key={turn.id}
                type="button"
                onClick={() => onJump(turn.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100',
                  active ? 'bg-hover-2' : 'hover:bg-hover',
                )}
              >
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[12px] leading-[1.5]',
                    active ? 'text-ink' : 'text-ink-2',
                  )}
                >
                  {turn.preview}
                </span>
                <span
                  className={cn(
                    'h-px shrink-0 rounded-full transition-all duration-150',
                    active ? 'w-4 bg-ink' : 'w-2.5 bg-line-strong',
                  )}
                  aria-hidden
                />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function Timeline({
  conversation,
  onRespond,
  project,
  sessionId,
}: {
  conversation: Conversation
  onRespond: (requestId: string, decision: string, meta?: { customText?: string; always?: boolean; allow?: boolean }) => void
  /** Project root, for lazy-loading file diffs in the chat. */
  project?: string
  sessionId?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Whether the user is near the bottom; only then do we follow new content. */
  const pinnedRef = useRef(true)
  /** The user turn currently in view, for the navigator's bold tick. */
  const [activeTurnId, setActiveTurnId] = useState<string>()

  /**
   * Mark the last user turn whose top has scrolled above ~a third of the
   * viewport as active. Cheap enough to run on every scroll event.
   */
  function updateActiveTurn() {
    const element = scrollRef.current
    if (!element) return
    const threshold = element.getBoundingClientRect().top + element.clientHeight * 0.35
    let current: string | undefined
    element.querySelectorAll<HTMLElement>('[data-turn-id]').forEach((node) => {
      if (node.getBoundingClientRect().top <= threshold) current = node.dataset.turnId
    })
    setActiveTurnId((previous) => (previous === current ? previous : current))
  }

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !pinnedRef.current) return
    element.scrollTop = element.scrollHeight
  }, [conversation.messages, conversation.activity])

  useEffect(() => {
    updateActiveTurn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.messages])

  function jumpToTurn(id: string) {
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-turn-id="${id}"]`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const resendLastUserPrompt = useStore((state) => state.resendLastUserPrompt)

  const empty = conversation.messages.length === 0
  const turns = conversation.messages
    .filter((message) => message.role === 'user')
    .map((message) => ({ id: message.id, preview: turnPreview(message) }))

  return (
    <div className="relative min-h-0 flex-1">
      <TimelineNavigator turns={turns} activeId={activeTurnId} onJump={jumpToTurn} />
      <div
        ref={scrollRef}
        onScroll={(scrollEvent) => {
          const element = scrollEvent.currentTarget
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight
          pinnedRef.current = distance < 140
          updateActiveTurn()
        }}
        className="scroll-thin h-full overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3.5 px-4 py-4 pl-9">
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
            <div
              key={message.id}
              data-turn-id={message.role === 'user' ? message.id : undefined}
            >
              <Turn
                message={message}
                onRespond={onRespond}
                onRetry={() => resendLastUserPrompt(conversation.sessionId)}
                project={project}
                sessionId={sessionId}
              />
            </div>
          ))}
          {conversation.activity ? <ActivityLine activity={conversation.activity} /> : null}
        </div>
      </div>
    </div>
  )
}

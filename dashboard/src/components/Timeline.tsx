/**
 * Timeline — the conversation.
 *
 * Vertical rhythm (the redesign rule):
 *   - Turns are separated by 24px (gap-6). A turn is a unit; parts inside
 *     a turn are closer (8px) than turns are to each other.
 *   - Consecutive tool/command rows collapse into one ToolGroup card with
 *     1px dividers and 24px rows — no loose stack of identical rows with
 *     large gaps between them.
 *   - Single tools render bare (no card chrome). Cards are reserved for
 *     real groups, files, plans, and approvals.
 *   - Usage + turn-summary merge into one 10px footer row, not two rows.
 *
 * A navigator rail floats at the center-left: one tick per user turn, the
 * in-view turn bolded. Hovering expands it into a card of turn previews.
 *
 * Terminal bytes never reach here — the reducer routes `terminal_output` to the
 * terminal view only.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Part, Step, TurnSummary, UsageMeter } from './chat'
import { FileChips } from './chat'
import { Chips } from './chat'
import LoadingState from './LoadingState'
import { ChevronDown } from 'lucide-react'
import { CopyButton, IconButton, RefreshIcon } from './ui'
import { cn, formatDuration } from '@/lib/format'
import { useStore } from '@/store'
import type {
  Activity,
  CommandPart,
  Conversation,
  FileChangePart,
  Message,
  MessagePart,
  ToolPart,
  TurnSummaryPart,
  UsagePart,
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

type ToolRow = ToolPart | CommandPart

function isToolRow(part: MessagePart): part is ToolRow {
  return part.kind === 'tool' || part.kind === 'command'
}

type Block = { kind: 'tools'; parts: ToolRow[] } | { kind: 'part'; part: MessagePart }

/** Fold consecutive tool/command rows into shared groups. Everything else stays singular. */
function groupBlocks(parts: MessagePart[]): Block[] {
  const blocks: Block[] = []
  let run: ToolRow[] = []
  const flush = () => {
    if (run.length > 0) {
      blocks.push({ kind: 'tools', parts: run })
      run = []
    }
  }
  for (const part of parts) {
    if (isToolRow(part)) run.push(part)
    else {
      flush()
      blocks.push({ kind: 'part', part })
    }
  }
  flush()
  return blocks
}

/**
 * A run of consecutive tool calls — one bordered card, 1px dividers, 24px
 * rows. A single tool renders bare (no chrome). Long groups (>4) collapse
 * behind a header showing the count + total time; running groups stay open.
 * In simple mode the group is always collapsed to one friendly line.
 */
function ToolGroup({ parts }: { parts: ToolRow[] }) {
  const running = parts.some((p) => p.status === 'running')
  const failed = parts.filter((p) => p.status === 'failed').length
  const totalMs = parts.reduce((sum, p) => sum + (p.durationMs ?? 0), 0)
  const simple = useStore((s) => s.timelineDetail === 'simple')
  const [collapsed, setCollapsed] = useState(false)
  const isCollapsed = simple && !running ? true : collapsed
  const collapsible = simple ? !running : parts.length > 4 && !running

  if (parts.length === 1 && !simple) {
    return <Step part={parts[0]!} />
  }

  if (simple) {
    // One friendly line, no counts/timings. One tap reveals the steps for
    // users who want them.
    return (
      <div className="overflow-hidden rounded-lg border border-line/50 bg-surface/30">
        {!isCollapsed ? (
          <div className="flex flex-col gap-px p-1">
            {parts.map((part) => (
              <Step key={part.toolId} part={part} />
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-7 w-full items-center gap-2 border-t border-line/40 bg-surface/40 px-2.5 text-left transition-colors hover:bg-hover/60"
        >
          <span
            className={cn('size-1.5 shrink-0 rounded-full', running ? 'bg-accent breathe' : failed > 0 ? 'bg-red' : 'bg-green')}
            aria-hidden
          />
          <span className="text-[12px] text-ink-2">
            {running ? 'Working…' : failed > 0 ? 'Ran into a problem' : `Used ${parts.length} tool${parts.length === 1 ? '' : 's'}`}
          </span>
          <ChevronDown
            size={11}
            className={cn('ml-auto shrink-0 text-ink-3 transition-transform duration-200', isCollapsed && '-rotate-90')}
          />
        </button>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line/50 bg-surface/30">
      <div className="flex flex-col gap-px p-1">
        {(isCollapsed ? [] : parts).map((part) => (
          <Step key={part.toolId} part={part} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => collapsible && setCollapsed((v) => !v)}
        disabled={!collapsible}
        className={cn(
          'flex h-6 w-full items-center gap-1.5 border-t border-line/40 bg-surface/40 px-2.5',
          collapsible ? 'cursor-pointer hover:bg-hover/60' : 'cursor-default',
        )}
      >
        <span
          className={cn('size-1.5 rounded-full', running ? 'bg-accent breathe' : failed > 0 ? 'bg-red' : 'bg-green')}
          aria-hidden
        />
        <span className="font-mono text-[10px] tabular-nums text-ink-3">
          {isCollapsed ? `+${parts.length} steps` : `${parts.length} steps`}
          {totalMs > 0 ? ` · ${formatDuration(totalMs)}` : ''}
          {failed > 0 ? ` · ${failed} failed` : ''}
          {running ? ' · running' : ''}
        </span>
        {collapsible ? (
          <ChevronDown
            size={11}
            className={cn('ml-auto text-ink-3 transition-transform duration-200', isCollapsed && '-rotate-90')}
          />
        ) : null}
      </button>
    </div>
  )
}

const Turn = memo(function Turn({
  message,
  onRespond,
  onRetry,
  project,
  sessionId,
  onViewPlan,
  dim,
}: {
  message: Message
  onRespond: (requestId: string, decision: string, meta?: { customText?: string; always?: boolean; allow?: boolean }) => void
  onRetry: () => void
  project?: string
  sessionId?: string
  onViewPlan?: () => void
  /** Recency fade: older turns sit dimmer, like ink drying toward the top. */
  dim?: number
}) {
  const simple = useStore((s) => s.timelineDetail === 'simple')

  // A `system` row is a lifecycle notice (engine/model switch, config change,
  // context compression): one centered line between rules, not a chat bubble.
  if (message.role === 'system') {
    const text = message.parts
      .map((part) => (part.kind === 'text' ? part.text : ''))
      .join('')
      .trim()
    if (!text) return null
    const time = new Date(message.createdAt)
    return (
      <div className="group flex items-center gap-3 py-1">
        <span aria-hidden className="h-px min-w-8 flex-1 rounded-full bg-line-strong/60" />
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 text-center text-[11px] leading-snug text-ink-3">{text}</span>
          <time
            dateTime={message.createdAt}
            title={Number.isNaN(time.getTime()) ? undefined : time.toLocaleString()}
            className="shrink-0 font-mono text-[9px] tabular-nums text-ink-3/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            {Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </span>
        <span aria-hidden className="h-px min-w-8 flex-1 rounded-full bg-line-strong/60" />
      </div>
    )
  }

  if (message.role === 'user') {
    const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('')
    // Context enrichment stays in the data model (the agent still receives
    // it) — it just no longer renders under the bubble.
    const time = new Date(message.createdAt)
    return (
      <div
        className="group flex justify-end transition-opacity duration-200 hover:!opacity-100"
        style={dim !== undefined ? { opacity: dim } : undefined}
      >
        <div className="flex max-w-[82%] flex-col items-end">
          <time
            dateTime={message.createdAt}
            title={Number.isNaN(time.getTime()) ? undefined : time.toLocaleString()}
            className="mb-1 pr-0.5 font-mono text-[10px] tabular-nums text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            {Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          <div
            className={cn(
              'rounded-2xl rounded-br-md border border-accent/[0.12] bg-accent/[0.08] px-3 py-2',
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
  // The turn's token accounting, surfaced as ↑/↓ chips on the Thought row.
  const usage = [...message.parts]
    .reverse()
    .find((part): part is Extract<MessagePart, { kind: 'usage' }> => part.kind === 'usage')

  // Usage + turn_summary merge into one footer row — accounting, not prose.
  const footer: { usage?: UsagePart; summary?: TurnSummaryPart } = {}
  const content: MessagePart[] = []
  for (const part of inline) {
    if (part.kind === 'usage') footer.usage = part
    else if (part.kind === 'turn_summary') footer.summary = part
    else content.push(part)
  }
  const blocks = groupBlocks(content)
  const hasFooter = footer.usage !== undefined || footer.summary !== undefined

  return (
    <div
      className="group flex flex-col transition-opacity duration-200 hover:!opacity-100"
      style={dim !== undefined ? { opacity: dim } : undefined}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {blocks.map((block, index) =>
            block.kind === 'tools' ? (
              <ToolGroup key={`tools-${index}`} parts={block.parts} />
            ) : (
              <div key={index} className="min-w-0">
                <Part
                  part={block.part}
                  onRespond={onRespond}
                  sessionId={sessionId}
                  onViewPlan={onViewPlan}
                  usage={usage}
                />
              </div>
            ),
          )}
          {files.length > 0 ? (
            <div className="mt-0.5">
              <FileChips files={files} project={project} sessionId={sessionId} />
            </div>
          ) : null}
          {hasFooter && !simple ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-0.5">
              {footer.summary ? <TurnSummary part={footer.summary} /> : null}
              {footer.summary && footer.usage ? (
                <span aria-hidden className="text-[10px] text-ink-3/50">·</span>
              ) : null}
              {footer.usage ? <UsageMeter part={footer.usage} /> : null}
            </div>
          ) : null}
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

/** Live activity — a 24px row matching tool-row height: work in progress, not furniture. */
function ActivityLine({ activity }: { activity: Activity }) {
  return (
    <div className="flex h-6 items-center gap-2 animate-up">
      <span
        className="ml-1.5 size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-ink-3 border-t-transparent"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <LoadingState label={activity.label} variant="Drive" since={activity.since} />
        {activity.detail ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-ink-3">{activity.detail}</span>
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
      className="absolute left-0.5 top-1/2 z-10 flex -translate-y-1/2 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Collapsed rail: spine + one tick per turn. Ticks rest small and grow
          to full width when the rail is hovered; the in-view turn stays bold. */}
      <div className="relative flex flex-col items-center gap-2 py-2">
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
  onViewPlan,
}: {
  conversation: Conversation
  onRespond: (requestId: string, decision: string, meta?: { customText?: string; always?: boolean; allow?: boolean }) => void
  /** Project root, for lazy-loading file diffs in the chat. */
  project?: string
  sessionId?: string
  /** Opens the right-rail Plan tab (timeline plan preview's "View full plan"). */
  onViewPlan?: () => void
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

  // Recency fade: the latest two turns are full brightness; everything older
  // steps down — brightness, not bubbles or dividers. Hover restores any turn.
  const fadeFor = (index: number): number | undefined => {
    if (index >= conversation.messages.length - 2) return undefined
    const distance = conversation.messages.length - 1 - index
    return distance <= 2 ? 0.8 : distance <= 4 ? 0.65 : 0.5
  }

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
        <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-6 px-4 py-5 pl-10">
          {empty ? (
            <div className="mx-auto flex w-full max-w-[26rem] flex-col items-center gap-2 rounded-2xl border border-dashed border-line/70 bg-surface/30 px-6 py-10 text-center">
              <span className="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-[15px]" aria-hidden>
                ✦
              </span>
              <p className="text-[13px] font-semibold text-ink">New session — say where to start</p>
              <p className="max-w-[34ch] text-[12px] leading-[1.65] text-ink-3">
                Describe the task below. Tool calls will group here as compact
                steps, approvals will pause the agent until you answer.
              </p>
              <p className="mt-1 font-mono text-[10.5px] text-ink-3/80">
                Tip: <span className="rounded bg-field px-1 py-px text-ink-2">@file</span> attaches context ·{' '}
                <span className="rounded bg-field px-1 py-px text-ink-2">/command</span> runs a shortcut
              </p>
            </div>
          ) : null}
          {conversation.messages.map((message, index) => (
            <div
              key={message.id}
              data-turn-id={message.role === 'user' ? message.id : undefined}
              className="scroll-mt-4"
            >
              <Turn
                message={message}
                onRespond={onRespond}
                onRetry={() => resendLastUserPrompt(conversation.sessionId)}
                project={project}
                sessionId={sessionId}
                onViewPlan={onViewPlan}
                dim={message.role === 'system' ? undefined : fadeFor(index)}
              />
            </div>
          ))}
          {conversation.activity ? <ActivityLine activity={conversation.activity} /> : null}
        </div>
      </div>
    </div>
  )
}

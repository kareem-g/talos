/**
 * Chat part renderers — Beautiful UI collection idiom.
 *
 * Mapping from the collection's components to what the agent produces:
 *
 *   ThinkingState (Reasoning) → `Reasoning`   collapsed trace that settles
 *   ToolChips (rows)          → `Step`        icon + label + inline chip, expandable
 *   ToolChips (diff chips)    → `FileChips`   file pills with +/− counts
 *   CodeBlock                 → `Code`        header, mono body, copy
 *   ApprovalCard              → `Approval`    question card with pill choices
 *   TaskRows                  → `Plan`        numbered step list
 *
 * Structural conventions kept from the collection: expand/collapse via
 * `grid-template-rows: 1fr/0fr` (animates height without measuring), the
 * icon→chevron swap on hover, 100–150ms color transitions, and `fade-up`
 * entrances.
 */

import { memo, useState } from 'react'
import {
  AlertIcon,
  Check,
  ChevronDown,
  CopyButton,
  Dots,
  FileIcon,
  PencilIcon,
  Sparkle,
  Terminal,
} from './ui'
import { cn, formatDuration } from '@/lib/format'
import type {
  ApprovalPart,
  CommandPart,
  FileChangePart,
  MessagePart,
  PlanPart,
  ReasoningPart,
  ToolPart,
} from '@/types/conversation'

/**
 * Collapsible container, the collection's height-animation pattern. Animating
 * `grid-template-rows` between `1fr` and `0fr` avoids measuring content, so it
 * works while text is still streaming in.
 */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300"
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/* ── Text ────────────────────────────────────────────────────────────────── */

/** Split on ``` fences. A trailing unterminated fence is treated as code:
 *  during streaming a fence is routinely half-arrived, and flickering between
 *  prose and code is worse than committing. */
function splitFences(text: string): Array<{ text: string; code: boolean; lang?: string }> {
  const parts = text.split('```')
  return parts
    .map((part, index) => {
      if (index % 2 === 0) return { text: part, code: false }
      const newline = part.indexOf('\n')
      const firstLine = newline === -1 ? '' : part.slice(0, newline)
      const isLang = /^[\w+-]*$/.test(firstLine)
      return {
        text: isLang && newline !== -1 ? part.slice(newline + 1) : part,
        code: true,
        lang: isLang && firstLine ? firstLine : undefined,
      }
    })
    .filter((segment) => segment.text.length > 0)
}

/** Inline `code`, **bold**, and bullet lines. Deliberately minimal. */
function inline(text: string): React.ReactNode {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={index}
          className="rounded-[5px] bg-field px-1 py-[1px] font-mono text-[11.5px] text-ink-2"
        >
          {token.slice(1, -1)}
        </code>
      )
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={index} className="font-medium text-ink">
          {token.slice(2, -2)}
        </strong>
      )
    }
    return token
  })
}

/** Code block: header with language and copy, mono body. */
export function Code({ text, lang }: { text: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-inset shadow-card">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          {lang ?? 'code'}
        </span>
        <CopyButton value={text} />
      </div>
      <pre className="scroll-thin overflow-x-auto px-2.5 py-2">
        <code className="font-mono text-[11.5px] leading-[1.65] text-ink-2">{text}</code>
      </pre>
    </div>
  )
}

export const Prose = memo(function Prose({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const segments = splitFences(text)
  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, index) => {
        if (segment.code) return <Code key={index} text={segment.text} lang={segment.lang} />
        const isLast = index === segments.length - 1
        return (
          <p
            key={index}
            className={cn(
              'whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-ink',
              streaming && isLast && 'caret',
            )}
          >
            {inline(segment.text)}
          </p>
        )
      })}
    </div>
  )
})

/* ── Reasoning ───────────────────────────────────────────────────────────── */

/**
 * The collection's ThinkingState "Reasoning" variant: a shimmering label while
 * in flight, settling into "Thought for Ns" with the trace behind a chevron.
 *
 * The trace **auto-expands while streaming** and collapses once the thought
 * closes, which is the collection's own behavior (it runs, settles, and remains
 * expandable). Showing a bare "Thinking…" label while reasoning text is arriving
 * hides the most interesting part of a turn. A manual toggle wins over the
 * automatic behavior for the rest of the turn.
 */
export function Reasoning({ part }: { part: ReasoningPart }) {
  const [override, setOverride] = useState<boolean>()
  const hasText = part.text.trim().length > 0
  // Follow the stream unless the user has said otherwise.
  const open = override ?? (part.streaming && hasText)

  const label = part.streaming
    ? 'Thinking'
    : part.durationMs !== undefined
      ? `Thought for ${formatDuration(part.durationMs)}`
      : 'Thought'

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        disabled={!hasText}
        className={cn(
          '-mx-1.5 flex min-h-7 w-fit items-center gap-1.5 rounded-control px-1.5',
          'text-[12.5px] transition-colors duration-100',
          hasText && 'hover:bg-hover-2',
        )}
      >
        {hasText ? (
          <ChevronDown
            className="shrink-0 text-ink-3 transition-transform duration-200"
            style={{ transform: open ? undefined : 'rotate(-90deg)' }}
          />
        ) : (
          <Sparkle size={11} className="shrink-0 text-ink-3" />
        )}
        <span className={cn(part.streaming ? 'shimmer' : 'text-ink-2')}>{label}</span>
      </button>

      <Collapse open={open}>
        <p className="ml-2 mt-1 whitespace-pre-wrap break-words border-l border-line py-0.5 pl-3.5 text-[11.5px] leading-[1.7] text-ink-2">
          {part.text}
        </p>
      </Collapse>
    </div>
  )
}

/* ── Tool / command steps ────────────────────────────────────────────────── */

/** Icon by the provider's own tool-kind hint, falling back to a generic glyph. */
function stepIcon(kind: string | undefined, name: string) {
  const hint = `${kind ?? ''} ${name}`.toLowerCase()
  if (/edit|write|patch|create/.test(hint)) return <PencilIcon />
  if (/read|open|view|fetch/.test(hint)) return <FileIcon />
  if (/exec|bash|shell|run|command|terminal/.test(hint)) return <Terminal />
  return <Sparkle />
}

/**
 * One agent step, in the collection's ToolChips row shape: icon that swaps to a
 * chevron on hover, bold label, inline chip for the argument, expanding to the
 * detail behind a left rule.
 */
function prettyToolLabel(part: ToolPart | CommandPart): string {
  if (part.kind === 'command') return 'Run command'
  const hint = `${part.toolKind ?? ''} ${part.name}`.toLowerCase()
  if (/edit|write|patch|create|update/.test(hint)) return 'Edit file'
  if (/read|open|view|fetch|cat/.test(hint)) return 'Read file'
  if (/search|grep|find|glob/.test(hint)) return 'Search'
  if (/exec|bash|shell|terminal/.test(hint)) return 'Run command'
  // Fallback: humanize tool name
  return part.name
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Tool'
}

export function Step({ part }: { part: ToolPart | CommandPart }) {
  const [open, setOpen] = useState(false)

  const isCommand = part.kind === 'command'
  const label = prettyToolLabel(part)
  const chip = isCommand ? part.command : (part.input ?? '')
  const detail = part.output
  const expandable = Boolean(detail || (!isCommand && part.input))
  const failed = part.status === 'failed'

  return (
    <div className="animate-up">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen(!open)}
        className={cn(
          'group/row -mx-[3px] flex min-h-8 w-[calc(100%+6px)] min-w-0 items-center gap-2',
          'rounded-control px-[3px] text-left transition-colors duration-100',
          expandable && 'hover:bg-hover-2',
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {part.status === 'running' ? (
            <span className="size-[9px] rounded-full border border-accent border-t-transparent breathe" />
          ) : (
            <>
              <span
                className={cn(
                  'transition-opacity duration-100',
                  failed ? 'text-red' : 'text-ink-3',
                  expandable && 'group-hover/row:opacity-0',
                  open && 'opacity-0',
                )}
              >
                {failed ? (
                <AlertIcon size={13} />
              ) : (
                stepIcon(part.kind === 'tool' ? part.toolKind : 'command', label)
              )}
              </span>
              {expandable ? (
                <ChevronDown
                  className={cn(
                    'absolute text-ink-3 transition-[opacity,transform] duration-150',
                    'opacity-0 group-hover/row:opacity-100',
                    open && 'opacity-100',
                  )}
                  style={{ transform: open ? undefined : 'rotate(-90deg)' }}
                />
              ) : null}
            </>
          )}
        </span>

        <span className="shrink-0 text-[12.5px] font-medium text-ink">{label}</span>

        {chip ? (
          <span
            className={cn(
              'inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5',
              'font-mono text-[11.5px] text-ink-2 shadow-hairline',
              'transition-colors duration-100',
              expandable && 'group-hover/row:bg-hover',
            )}
          >
            {chip}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {isCommand && part.exitCode !== undefined && part.exitCode !== 0 ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-red">
            exit {part.exitCode}
          </span>
        ) : null}
        {part.durationMs !== undefined ? (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
            {formatDuration(part.durationMs)}
          </span>
        ) : null}
      </button>

      <Collapse open={open}>
        <div className="ml-2 mb-1 mt-0.5 flex flex-col gap-1 border-l border-line py-0.5 pl-3.5">
          {!isCommand && part.input ? (
            <span className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.6] text-ink-3">
              {part.input}
            </span>
          ) : null}
          {detail ? (
            <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-ink-2">
              <code>{detail}</code>
            </pre>
          ) : null}
        </div>
      </Collapse>
    </div>
  )
}

/* ── File changes ────────────────────────────────────────────────────────── */

/** The collection's file-diff chips: a pill per file with add/delete counts. */
export function FileChips({ files }: { files: FileChangePart[] }) {
  return (
    <div className="flex max-w-full flex-wrap gap-1.5 border-t border-line pt-2.5">
      {files.map((file, index) => (
        <span
          key={`${file.path}-${index}`}
          className={cn(
            'inline-flex h-7 max-w-full items-center gap-1.5 rounded-chip bg-surface px-2',
            'font-mono text-[11.5px] shadow-btn transition-colors duration-100 hover:bg-hover',
            file.ok ? 'text-ink' : 'text-red',
          )}
          style={{ animation: `pop-in 250ms cubic-bezier(0.23,1,0.32,1) ${index * 70}ms both` }}
        >
          {file.ok ? (
            <Check size={11} className="shrink-0 text-green" />
          ) : (
            <AlertIcon size={11} className="shrink-0 text-red" />
          )}
          <span className="min-w-0 truncate">{file.path}</span>
        </span>
      ))}
    </div>
  )
}

/* ── Plan ────────────────────────────────────────────────────────────────── */

export function Plan({ part }: { part: PlanPart }) {
  return (
    <div className="animate-up overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad">
        <p className="pb-1.5 text-[12.5px] font-medium text-ink">{part.title ?? 'Plan'}</p>
        <ol className="flex flex-col gap-1">
          {part.steps.map((step, index) => (
            <li key={index} className="flex gap-2 text-[12px] leading-[1.6] text-ink-2">
              <span className="shrink-0 tabular-nums text-ink-3">{index + 1}.</span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/* ── Approval ────────────────────────────────────────────────────────────── */

/**
 * The collection's ApprovalCard: question, pill choices, footer.
 *
 * Option labels come from the agent — never invented. Once resolved the card
 * stays visible showing the decision, rather than disappearing and leaving the
 * transcript unexplained.
 */
export function Approval({
  part,
  onRespond,
}: {
  part: ApprovalPart
  onRespond: (requestId: string, decision: string) => void
}) {
  const resolved = part.decision !== undefined
  const options = part.options.length > 0 ? part.options : ['allow', 'deny']
  const risky = /high|critical/i.test(part.riskLevel ?? '')

  return (
    <div
      className={cn(
        'animate-up overflow-hidden rounded-card shadow-card',
        resolved ? 'bg-surface' : risky ? 'bg-red-tint' : 'bg-surface',
      )}
    >
      <div className="primitive-card-pad">
        <div className="flex items-start gap-2">
          {!resolved ? (
            <AlertIcon
              size={14}
              className={cn('mt-[3px] shrink-0', risky ? 'text-red' : 'text-orange')}
            />
          ) : (
            <Check size={14} className="mt-[3px] shrink-0 text-green" />
          )}
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-ink">
            {part.prompt}
          </p>
        </div>
        {part.riskLevel && !resolved ? (
          <p className="mt-1.5 pl-6 text-[11px] text-ink-3">Risk: {part.riskLevel}</p>
        ) : null}
      </div>

      <div className="primitive-card-footer flex items-center justify-between gap-2">
        {resolved ? (
          <span className="text-[11.5px] text-ink-3">
            Responded <span className="font-mono text-ink-2">{part.decision}</span>
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {options.map((option, index) => (
              <button
                key={option}
                type="button"
                onClick={() => onRespond(part.requestId, option)}
                className={cn(
                  'inline-flex min-h-8 items-center rounded-chip px-3 text-[12px] font-medium',
                  'transition-[background-color,transform] duration-150 active:scale-[0.97]',
                  index === 0
                    ? 'bg-accent text-canvas shadow-btn hover:bg-accent-ink'
                    : 'bg-hover text-ink-2 hover:bg-line-strong hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Error ───────────────────────────────────────────────────────────────── */

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="animate-up flex items-start gap-2 rounded-card bg-red-tint p-3 shadow-card">
      <AlertIcon size={14} className="mt-[2px] shrink-0 text-red" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-ink">
        {message}
      </p>
    </div>
  )
}

/* ── Dispatch ────────────────────────────────────────────────────────────── */

/**
 * Render one part.
 *
 * `file` returns null: file changes are collected by the caller and rendered
 * together as chips at the end of the turn, which is how the collection groups
 * them and reads far better than one row per file.
 */
export function Part({
  part,
  onRespond,
}: {
  part: MessagePart
  onRespond: (requestId: string, decision: string) => void
}) {
  switch (part.kind) {
    case 'text':
      return <Prose text={part.text} streaming={part.streaming} />
    case 'reasoning':
      return <Reasoning part={part} />
    case 'tool':
    case 'command':
      return <Step part={part} />
    case 'plan':
      return <Plan part={part} />
    case 'approval':
      return <Approval part={part} onRespond={onRespond} />
    case 'error':
      return <ErrorCard message={part.message} />
    case 'file':
      return null
  }
}

export { Dots }

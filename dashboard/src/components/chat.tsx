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
  Circle,
  CopyButton,
  Dots,
  FileIcon,
  PencilIcon,
  Search,
  Sparkle,
  Terminal,
} from './ui'
import { cn, formatDuration } from '@/lib/format'
import { gitApi } from '@/lib/api'
import { decisionLabel, describeApproval } from '@/lib/approvals'
import { describeTool } from '@/lib/tools'
import type {
  ApprovalPart,
  CommandPart,
  FileChangePart,
  MessagePart,
  PlanPart,
  ReasoningPart,
  ToolPart,
  TurnSummaryPart,
  UsagePart,
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
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|[@$#/][^\s]+)/g)
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
    if (/^[@$#/][^\s]/.test(token)) {
      const kind = token[0] === '@' ? 'at' : token[0] === '$' ? 'skill' : token[0] === '#' ? 'mention' : 'slash'
      const raw = token.slice(1)
      const label = kind === 'mention' ? raw.replace(/\s*\([^)]*\)$/, '') : kind === 'at' ? raw.replace(/\/$/, '') : raw
      return (
        <span
          key={index}
          className={cn(
            'mx-[1px] inline-flex max-w-full items-baseline rounded px-1 py-[1px] align-baseline',
            'text-[12px] font-medium',
            kind === 'at' && 'bg-green/[0.16] text-green',
            kind === 'skill' && 'bg-purple-400/[0.18] text-purple-300',
            kind === 'mention' && 'bg-sky-400/[0.16] text-sky-300',
            kind === 'slash' && 'bg-orange/[0.16] text-orange',
          )}
        >
          <span className="shrink-0 opacity-60">{token[0]}</span>
          <span className="truncate">{label}</span>
        </span>
      )
    }
    return token
  })
}

/** Render inline text with @/$/#/ and / tokens as colored chips (shared by
 *  the composer transcript and user bubbles). */
export const Chips = memo(function Chips({ text }: { text: string }) {
  return <>{inline(text)}</>
})

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

/** Icon by the humanizer's glyph family, falling back to a generic glyph. */
function stepIcon(glyph: string) {
  if (glyph === 'edit') return <PencilIcon />
  if (glyph === 'read' || glyph === 'file') return <FileIcon />
  if (glyph === 'run') return <Terminal />
  if (glyph === 'search') return <Search size={13} />
  return <Sparkle />
}

/**
 * One agent step: verb + the argument that matters, expanding to the raw
 * input/output. The inline chip shows a file name, a command, or a query —
 * never a JSON dump; the raw payload stays behind the chevron.
 */
export function Step({ part }: { part: ToolPart | CommandPart }) {
  const [open, setOpen] = useState(false)

  const isCommand = part.kind === 'command'
  const summary = describeTool(part)
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
                {failed ? <AlertIcon size={13} /> : stepIcon(summary.glyph)}
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

        <span className="shrink-0 text-[12.5px] font-medium text-ink">{summary.label}</span>

        {summary.arg ? (
          <span
            className={cn(
              'inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5',
              'font-mono text-[11.5px] text-ink-2 shadow-hairline',
              'transition-colors duration-100',
              expandable && 'group-hover/row:bg-hover',
            )}
            title={isCommand ? part.command : part.input}
          >
            {summary.arg}
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

/** Minimal syntax-only diff renderer (no heavy dependency). */
function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <pre className="scroll-thin max-h-72 overflow-auto rounded-b-card border-t border-line/60 bg-inset px-3 py-2 font-mono text-[11px] leading-[1.55]">
      <code className="block">
        {lines.map((line, index) => {
          const tone =
            line.startsWith('+') && !line.startsWith('+++')
              ? 'text-emerald-400'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'text-rose-500'
                : line.startsWith('@@')
                  ? 'text-sky-400'
                  : 'text-ink-2'
          return (
            <span key={index} className={cn('block whitespace-pre-wrap break-words', tone)}>
              {line || ' '}
            </span>
          )
        })}
      </code>
    </pre>
  )
}

/** The collection's file-diff chips: a pill per file with add/delete counts. */
export function FileChips({
  files,
  project,
  sessionId,
}: {
  files: FileChangePart[]
  /** Used to lazy-fetch a real diff from the daemon on expand. */
  project?: string
  sessionId?: string
}) {
  return (
    <div className="flex max-w-full flex-col gap-1.5 border-t border-line pt-2.5">
      {files.map((file, index) => (
        <FileChip
          key={`${file.path}-${index}`}
          file={file}
          project={project}
          sessionId={sessionId}
          style={{ animation: `pop-in 250ms cubic-bezier(0.23,1,0.32,1) ${index * 70}ms both` }}
        />
      ))}
    </div>
  )
}

function FileChip({
  file,
  project,
  sessionId,
  style,
}: {
  file: FileChangePart
  project?: string
  sessionId?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || diff !== undefined || loading) return
    if (!project) {
      setError('No project')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const body = await gitApi.diff(project, file.path, sessionId)
      setDiff(body.diff)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load diff')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-chip bg-surface shadow-btn transition-colors duration-100',
        open && 'bg-surface/80',
      )}
      style={style}
    >
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'group/chip flex min-h-7 w-full items-center gap-1.5 px-2 py-1 text-left',
          'transition-colors duration-100 hover:bg-hover',
        )}
      >
        {file.ok ? (
          <Check size={11} className="shrink-0 text-green" />
        ) : (
          <AlertIcon size={11} className="shrink-0 text-red" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">{file.path}</span>
        {project ? (
          <span className="shrink-0 font-mono text-[10px] text-ink-3 opacity-0 transition-opacity group-hover/chip:opacity-100">
            {open ? 'hide' : 'diff'}
          </span>
        ) : null}
        {project ? (
          <ChevronDown
            size={11}
            className={cn('shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')}
          />
        ) : null}
      </button>
      {open ? (
        <div>
          {loading ? (
            <p className="px-3 py-2 font-mono text-[11px] text-ink-3">Loading diff…</p>
          ) : error ? (
            <p className="px-3 py-2 font-mono text-[11px] text-red">{error}</p>
          ) : diff && diff.trim().length > 0 ? (
            <DiffView diff={diff} />
          ) : (
            <p className="px-3 py-2 font-mono text-[11px] text-ink-3">No uncommitted diff for this file.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/* ── Plan ────────────────────────────────────────────────────────────────── */

/**
 * Plan steps with live status when the agent reports it (Grok Build and ACP
 * agents do): a check for completed, a pulsing marker for in-progress, a hollow
 * dot pending. Statuses come from `entries`; agents without them render the
 * classic numbered list.
 */
export function Plan({ part }: { part: PlanPart }) {
  const entries: Array<{ content: string; status?: string }> =
    part.entries ?? part.steps.map((content) => ({ content }))
  const hasStatus = entries.some((entry) => entry.status !== undefined)

  return (
    <div className="animate-up overflow-hidden rounded-xl border border-line/40 bg-surface/80 shadow-card">
      <div className="px-4 py-3">
        <p className="pb-2 text-[12.5px] font-semibold text-ink">{part.title ?? 'Plan'}</p>
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry, index) => {
            const status = entry.status ?? (hasStatus ? 'pending' : undefined)
            const done = status === 'completed'
            const active = status === 'in_progress'
            return (
              <li
                key={index}
                className={cn(
                  'flex gap-2.5 text-[12px] leading-[1.6]',
                  done ? 'text-ink-3' : active ? 'text-ink' : 'text-ink-2',
                )}
              >
                {status !== undefined ? (
                  <span className="mt-[3px] flex size-[13px] shrink-0 items-center justify-center">
                    {done ? (
                      <Check size={11} className="text-green" />
                    ) : active ? (
                      <span className="size-[7px] rounded-full border border-accent border-t-transparent breathe" />
                    ) : (
                      <Circle size={11} className="text-line-strong" />
                    )}
                  </span>
                ) : (
                  <span className="shrink-0 tabular-nums text-ink-3">{index + 1}.</span>
                )}
                <span className="min-w-0">{entry.content}</span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/* ── Usage ───────────────────────────────────────────────────────────────── */

function formatTokens(count: number | undefined): string | null {
  if (count === undefined || count <= 0) return null
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

/**
 * The turn's token meter: compact stat chips that update in place as usage
 * events stream in. Rendered at the end of a turn — accounting, not prose.
 */
export function UsageMeter({ part }: { part: UsagePart }) {
  const input = formatTokens(part.inputTokens)
  const output = formatTokens(part.outputTokens)
  if (input === null && output === null) return null

  return (
    <div className="animate-up mt-0.5 flex flex-wrap items-center gap-1.5">
      {input !== null ? (
        <span
          title={`${part.inputTokens} input tokens`}
          className="inline-flex h-5.5 items-center gap-1 rounded-chip bg-field px-1.5 text-[11px] tabular-nums text-ink-3 shadow-hairline"
        >
          <span aria-hidden>↑</span>
          {input}
        </span>
      ) : null}
      {output !== null ? (
        <span
          title={`${part.outputTokens} output tokens`}
          className="inline-flex h-5.5 items-center gap-1 rounded-chip bg-field px-1.5 text-[11px] tabular-nums text-ink-3 shadow-hairline"
        >
          <span aria-hidden>↓</span>
          {output}
        </span>
      ) : null}
    </div>
  )
}

/* ── Turn summary ────────────────────────────────────────────────────────── */

const STOP_REASONS: Record<string, string> = {
  end_turn: 'Completed',
  complete: 'Completed',
  completed: 'Completed',
  stop_sequence: 'Stopped',
  max_tokens: 'Token limit reached',
  max_turns: 'Turn limit reached',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
  refusal: 'Refused',
}

/** End-of-turn card: why the turn stopped, how long it ran, and token counts. */
export function TurnSummary({ part }: { part: TurnSummaryPart }) {
  const reason = part.stopReason ? STOP_REASONS[part.stopReason] ?? part.stopReason : undefined
  const input = formatTokens(part.inputTokens)
  const output = formatTokens(part.outputTokens)

  const stats: string[] = []
  if (input !== null || output !== null) {
    stats.push(`${input ?? '0'} in · ${output ?? '0'} out`)
  }
  if (part.durationMs !== undefined) stats.push(formatDuration(part.durationMs))

  const failed = /error|refus|max_tokens|max_turns/i.test(part.stopReason ?? '')

  return (
    <div className="animate-up flex items-center gap-1.5 pt-0.5 text-[11px] text-ink-3">
      {failed ? (
        <AlertIcon size={11} className="shrink-0 text-orange" />
      ) : (
        <Check size={11} className="shrink-0 text-green" />
      )}
      <span>{reason ?? 'Turn complete'}</span>
      {stats.length > 0 ? (
        <>
          <span aria-hidden className="text-ink-3/50">·</span>
          <span className="tabular-nums">{stats.join(' · ')}</span>
        </>
      ) : null}
    </div>
  )
}

/* ── Approval ────────────────────────────────────────────────────────────── */

/**
 * Permission card — dark, sleep UI.
 * The agent is "sleeping" while waiting for your approval — dim, quiet, with a
 * moon/Zzz motif and a clear wake-up action. Resolved cards stay minimal.
 *
 * Behavior now supported (no layout change): multiple answer options, a
 * free-text custom input when the agent offers one, and per-choice "always"
 * persistence (always allow / always deny) so repeating prompts don't require
 * re-answering.
 */
function SleepIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      <path d="M17 5l1 1" />
      <path d="M19 7l-1 1" opacity={0.6} />
      <text x="14" y="14" fontFamily="JetBrains Mono, monospace" fontSize="6" fill="currentColor" stroke="none" opacity={0.5}>Z</text>
    </svg>
  )
}

type RespondMeta = { customText?: string; always?: boolean; allow?: boolean }

export function Approval({
  part,
  onRespond,
}: {
  part: ApprovalPart
  onRespond: (requestId: string, decision: string, meta?: RespondMeta) => void
}) {
  const resolved = part.decision !== undefined
  const view = describeApproval(part.prompt, part.options, {
    optionData: part.optionData,
    multiSelect: part.multiSelect,
    allowsCustomText: part.allowsCustomText,
  })
  const risky = /high|critical/i.test(part.riskLevel ?? '')
  // Keep track of multi-select state locally
  const [selected, setSelected] = useState<string[]>([])

  const isMulti = !!view.multiSelect

  const toggleSelect = (value: string) => {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  /**
   * Derive the response metadata from the option the user picked. An agent may
   * encode persistence directly in the option value (e.g. `always_allow`,
   * `always_deny`); we forward that so the backend can persist it. Allow/deny
   * is inferred from the value unless the agent supplies an explicit flag.
   */
  const metaForValue = (value: string, explicitAllow?: boolean): RespondMeta => {
    const lower = value.toLowerCase()
    const always = lower === 'always_allow' || lower === 'always_deny' || lower === 'always allow' || lower === 'always deny'
    const allow = explicitAllow ?? /^(allow|approve|yes|always_allow|always allow)\b/i.test(value)
    return { always, allow }
  }

  const handleSelect = (value: string, explicitAllow?: boolean) => {
    if (isMulti) {
      toggleSelect(value)
    } else {
      onRespond(part.requestId, value, metaForValue(value, explicitAllow))
    }
  }

  const handleMultiSubmit = () => {
    if (selected.length === 0) return
    // For multi-select, send JSON array string so backend can parse it
    const decision = selected.length === 1 ? selected[0] : JSON.stringify(selected)
    onRespond(part.requestId, decision, { always: selected.some((v) => /always/i.test(v)) })
  }

  if (resolved) {
    return (
      <div
        data-approval-id={part.requestId}
        className="animate-up flex items-center gap-2 rounded-xl border border-white/10 bg-[#111113]/80 px-3 py-2.5 text-[11.5px] text-zinc-400 backdrop-blur"
      >
        {part.decision && /deny|reject|no\b/i.test(part.decision) ? (
          <AlertIcon size={12} className="shrink-0 text-amber-500" />
        ) : (
          <Check size={12} className="shrink-0 text-emerald-500" />
        )}
        <span className="shrink-0 font-medium text-zinc-200">{decisionLabel(part.decision!)}</span>
        <span aria-hidden className="text-white/20">·</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{view.header ?? view.context ?? view.question}</span>
      </div>
    )
  }

  return (
    <div
      data-approval-id={part.requestId}
      className={cn(
        'animate-up overflow-hidden rounded-2xl border shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)]',
        'bg-[#0a0a0c] backdrop-blur-xl',
        risky ? 'border-red-900/30' : 'border-zinc-800',
      )}
      role="alert"
      aria-label="Approval required — agent sleeping"
    >
      {/* Sleep header — dark, quiet */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <SleepIcon size={14} className="shrink-0 text-zinc-500" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">Agent sleeping</span>
        <span className="h-2 w-px bg-white/10" aria-hidden />
        <span className={cn('rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium', risky ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/20' : 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/15')}>
          {risky ? 'high risk' : view.header ? view.header : 'needs approval'}
        </span>
        <span className="ml-auto hidden items-center gap-1 font-mono text-[10px] text-zinc-600 sm:inline-flex">
          <span className="size-1.5 rounded-full bg-amber-500/60 animate-pulse" aria-hidden />
          waiting for you
        </span>
      </div>

      {/* Header as context if present and different from question. Skipped for
          question cards: the pill above already renders the same header
          (e.g. "Drink"), so showing it again here would just duplicate it. */}
      {view.header && view.header !== view.question && risky ? (
        <div className="border-b border-white/[0.04] bg-black/20 px-4 py-2">
          <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-zinc-400">{view.header}</span>
        </div>
      ) : null}

      {/* Context — mono, dim, like a terminal trace */}
      {view.context ? (
        <div className="border-b border-white/[0.04] bg-black/20 px-4 py-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 font-mono text-[10px] leading-none text-zinc-600">›</span>
            <code className="block min-w-0 flex-1 break-all font-mono text-[11.5px] leading-[1.5] text-zinc-300">
              {view.context}
            </code>
          </div>
        </div>
      ) : null}

      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl', risky ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20' : 'bg-zinc-900 text-zinc-400 ring-1 ring-white/10')}>
          <SleepIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-[1.5] text-white">
            {view.question}
          </p>
          {isMulti ? (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-400 ring-1 ring-white/5">
              Select {selected.length > 0 ? `${selected.length} selected` : 'one or more'} — {view.options.length} options
            </p>
          ) : null}
          {part.riskLevel ? (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-400 ring-1 ring-white/5">
              <span className="size-1 rounded-full bg-amber-500" aria-hidden /> Risk: {part.riskLevel}
            </p>
          ) : null}
          {!isMulti ? (
            <p className="mt-2 font-mono text-[11px] leading-[1.5] text-zinc-500">
              Choose an action to wake the agent. Your choice is recorded and the agent will continue automatically.
            </p>
          ) : null}
        </div>
      </div>

      {view.options.length > 0 ? (
        <div className="border-t border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div className="flex flex-col gap-2">
            {view.options.map((option, index) => {
              const active = isMulti ? selected.includes(option.value) : false
              return (
                <button
                  key={`${option.value}-${index}`}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left',
                    'transition-all duration-150 active:scale-[0.99]',
                    active
                      ? 'border-white bg-white text-black'
                      : isMulti
                        ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                      active
                        ? 'border-black bg-black text-white'
                        : isMulti
                          ? 'border-white/20 bg-transparent text-zinc-500 group-hover:border-white/30'
                          : 'border-white/15 bg-white/5 text-zinc-400',
                    )}
                  >
                    {isMulti ? (active ? '✓' : '') : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px] font-medium', active ? 'text-black' : 'text-zinc-200')}>{option.label}</span>
                    {option.description ? (
                      <span className={cn('mt-0.5 block font-mono text-[11px] leading-[1.4]', active ? 'text-black/60' : 'text-zinc-500')}>{option.description}</span>
                    ) : null}
                  </span>
                  {!isMulti ? (
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]', active ? 'bg-black/10 text-black' : 'bg-white/5 text-zinc-500')}>
                      {option.kind === 'allow' ? 'allow' : option.kind === 'deny' ? 'deny' : 'choose'}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          {isMulti ? (
            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[11px] text-zinc-500">{selected.length} of {view.options.length} selected</span>
              <button type="button" disabled={selected.length === 0} onClick={handleMultiSubmit} className="inline-flex min-h-9 items-center justify-center rounded-full bg-white px-5 text-[13px] font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed">
                Confirm {selected.length > 0 ? `(${selected.length})` : ''}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ── Error ───────────────────────────────────────────────────────────────── */

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="animate-up overflow-hidden rounded-xl border border-red/20 bg-red/[0.03] shadow-card">
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <AlertIcon size={14} className="mt-[2px] shrink-0 text-red" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-red">Agent error</p>
          <p className="mt-1 min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-ink-2">
            {message}
          </p>
        </div>
      </div>
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
  onRespond: (requestId: string, decision: string, meta?: { customText?: string; always?: boolean; allow?: boolean }) => void
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
    case 'usage':
      return <UsageMeter part={part} />
    case 'turn_summary':
      return <TurnSummary part={part} />
    case 'error':
      return <ErrorCard message={part.message} />
    case 'file':
      return null
    case 'subagent':
      return <SubagentRow part={part} />
    case 'progress':
      return <ProgressRow part={part} />
    case 'search':
      return <SearchRow part={part} />
    case 'git_commit':
      return <GitCommitRow part={part} />
    case 'config_changed':
      return <ConfigRow part={part} />
    case 'browser':
      return <BrowserStepRow part={part} />
  }
}

/* ── New AI-event part rows ──────────────────────────────────────────────── */

function SubagentRow({ part }: { part: Extract<MessagePart, { kind: 'subagent' }> }) {
  const running = part.status === 'running'
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className={cn('size-1.5 shrink-0 rounded-full', running ? 'bg-green breathe' : part.status === 'failed' ? 'bg-red' : 'bg-green')} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        {running ? 'Subagent running' : part.status === 'failed' ? 'Subagent failed' : 'Subagent done'} · {part.name}
      </span>
      {part.kindType ? <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">{part.kindType}</span> : null}
    </div>
  )
}

function ProgressRow({ part }: { part: Extract<MessagePart, { kind: 'progress' }> }) {
  const pct = part.percent
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-field">
        <div className="h-full rounded-full bg-accent-2 transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
      </div>
      <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-ink-3">{pct !== undefined ? `${Math.round(pct)}%` : '…'}</span>
      {part.message ? <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{part.message}</span> : null}
    </div>
  )
}

function SearchRow({ part }: { part: Extract<MessagePart, { kind: 'search' }> }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className="mt-0.5 shrink-0 text-ink-3" aria-hidden>🔍</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-ink-2">Search: {part.query}</span>
        {part.results && part.results.length > 0 ? (
          <span className="block truncate font-mono text-[9.5px] text-ink-3">{part.results[0]}</span>
        ) : null}
      </span>
    </div>
  )
}

function GitCommitRow({ part }: { part: Extract<MessagePart, { kind: 'git_commit' }> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className="shrink-0 font-mono text-[10px] font-semibold text-green">⬆</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">Commit {part.sha}{part.message ? ` — ${part.message}` : ''}</span>
      {part.files && part.files.length > 0 ? <span className="shrink-0 font-mono text-[9px] text-ink-3">{part.files.length} files</span> : null}
    </div>
  )
}

function ConfigRow({ part }: { part: Extract<MessagePart, { kind: 'config_changed' }> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className="shrink-0 text-ink-3" aria-hidden>⚙</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        {part.key} → <span className="font-mono text-ink">{part.value}</span>
      </span>
    </div>
  )
}

/* Icon per browser action — mirrors the plan's vocabulary (🌐 goto, 🖱 click, 📷 screenshot, ✅ assert, ✋ cursor). */
const BROWSER_ACTION_ICON: Record<string, string> = {
  goto: '🌐',
  click: '🖱',
  type: '⌨',
  press: '⌨',
  check: '☑',
  select: '▾',
  scroll: '↕',
  screenshot: '📷',
  assert: '✅',
  wait_for: '⏳',
  cursor_move: '✋',
  cursor_click: '🖱',
  cursor_type: '⌨',
  cursor_keypress: '⌨',
}

function BrowserStepRow({ part }: { part: Extract<MessagePart, { kind: 'browser' }> }) {
  const running = part.status === 'running'
  const icon = BROWSER_ACTION_ICON[part.action] ?? '🌐'
  const detail = part.detail ?? part.target
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className="shrink-0 text-ink-3" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        <span className="font-mono uppercase text-[9px] text-ink-3">{part.action}</span>
        {detail ? <span className="text-ink-2"> · {detail}</span> : null}
      </span>
      <span className={cn('size-1.5 shrink-0 rounded-full', running ? 'bg-green breathe' : part.status === 'failed' ? 'bg-red' : 'bg-green')} aria-hidden />
      <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">{part.status}</span>
    </div>
  )
}

export { Dots }

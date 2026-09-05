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

import { memo, useMemo, useState } from 'react'
import {
  AlertIcon,
  Check,
  ChevronDown,
  CopyButton,
  Dots,
  FileIcon,
  PencilIcon,
  Search,
  Sparkle,
  Terminal,
} from './ui'
import { cn, formatDuration } from '@/lib/format'
import { useStore } from '@/store'
import { gitApi } from '@/lib/api'
import { decisionLabel, describeApproval } from '@/lib/approvals'
import { describeTool } from '@/lib/tools'
import { WorkerAvatar } from './desktop/RoomAvatars'
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

/** Inline `code` and **bold** — the markdown every agent actually emits.
 *  Deliberately no @/$/#// chips here: those belong to the composer and user
 *  bubbles. Wrapping agent prose tokens (markdown `#` headings, `/paths`)
 *  in mention chips garbled real messages. */
function inlineMarkdown(text: string): React.ReactNode {
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

/** Inline text with @/$/#/ and / tokens as colored chips (shared by
 *  the composer transcript and user bubbles — never agent prose). */
function inlineChips(text: string): React.ReactNode {
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

export const Chips = memo(function Chips({ text }: { text: string }) {
  return <>{inlineChips(text)}</>
})

/** Code block: header with language and copy, mono body. */
export function Code({ text, lang }: { text: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line/60 bg-inset">
      <div className="flex h-7 items-center justify-between border-b border-line/50 bg-surface/40 px-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
          {lang ?? 'code'}
        </span>
        <CopyButton value={text} />
      </div>
      <pre className="scroll-thin overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-[11.5px] leading-[1.65] text-ink-2">{text}</code>
      </pre>
    </div>
  )
}

/** One parsed block of agent markdown: a paragraph, a heading, or a list. */
type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }

/** Line-based markdown block parser — headings (#…####), bullet (- / *),
 *  ordered (1. / 1)) lists, paragraphs. Deliberately minimal: agents emit
 *  this subset; full markdown is a dependency we don't need. */
function parseBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let para: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'p', text: para.join('\n') })
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push(list)
      list = null
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    // `**bold**` must not read as a `*` bullet: the marker requires a space.
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ kind: 'h', level: heading[1]!.length, text: heading[2]! })
    } else if (bullet) {
      flushPara()
      if (!list || list.kind !== 'ul') {
        flushList()
        list = { kind: 'ul', items: [] }
      }
      list.items.push(bullet[1]!)
    } else if (ordered) {
      flushPara()
      if (!list || list.kind !== 'ol') {
        flushList()
        list = { kind: 'ol', items: [] }
      }
      list.items.push(ordered[1]!)
    } else if (line.trim() === '') {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return blocks
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
    <div className="flex min-w-0 flex-col gap-2.5">
      {segments.map((segment, index) => {
        if (segment.code)
          return (
            <div key={index} className="mt-0.5">
              <Code text={segment.text} lang={segment.lang} />
            </div>
          )
        const isLast = index === segments.length - 1
        const blocks = parseBlocks(segment.text)
        return (
          <div key={index} className="flex min-w-0 flex-col gap-2">
            {blocks.map((block, blockIndex) => {
              const blockIsLast = isLast && blockIndex === blocks.length - 1
              if (block.kind === 'h') {
                return (
                  <p
                    key={blockIndex}
                    className={cn(
                      'font-semibold tracking-[-0.01em] text-ink',
                      block.level === 1 && 'text-[15px]',
                      block.level === 2 && 'text-[13.5px]',
                      block.level >= 3 && 'text-[12.5px]',
                    )}
                  >
                    {inlineMarkdown(block.text)}
                  </p>
                )
              }
              if (block.kind === 'ul' || block.kind === 'ol') {
                return (
                  <ul key={blockIndex} className="flex min-w-0 flex-col gap-1.5">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="flex min-w-0 gap-2 text-[13px] leading-[1.65] text-ink">
                        <span className="shrink-0 select-none font-mono text-[11px] leading-[1.9] text-ink-3" aria-hidden>
                          {block.kind === 'ul' ? '•' : `${itemIndex + 1}.`}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{inlineMarkdown(item)}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
              return (
                <p
                  key={blockIndex}
                  className={cn(
                    'whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-ink',
                    streaming && blockIsLast && 'caret',
                  )}
                >
                  {inlineMarkdown((block as { text: string }).text)}
                </p>
              )
            })}
          </div>
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
export function Reasoning({
  part,
  tokens,
}: {
  part: ReasoningPart
  /** The turn's usage, shown as ↑/↓ chips beside the label once reported. */
  tokens?: { inputTokens?: number; outputTokens?: number }
}) {
  const [override, setOverride] = useState<boolean>()
  const simple = useStore((s) => s.timelineDetail === 'simple')
  const hasText = part.text.trim().length > 0
  // Follow the stream unless the user has said otherwise.
  const open = override ?? (part.streaming && hasText)

  const label = part.streaming
    ? 'Thinking'
    : part.durationMs !== undefined && !simple
      ? `Thought for ${formatDuration(part.durationMs)}`
      : 'Thought'
  const inputTokens = simple ? null : formatTokens(tokens?.inputTokens)
  const outputTokens = simple ? null : formatTokens(tokens?.outputTokens)

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        disabled={!hasText}
        className={cn(
          'flex h-6 w-fit max-w-full items-center gap-1.5 rounded-md px-1.5 -ml-1.5',
          'text-[12px] transition-colors duration-100',
          hasText && 'hover:bg-hover-2',
        )}
      >
        {hasText ? (
          <ChevronDown
            size={12}
            className="shrink-0 text-ink-3 transition-transform duration-200"
            style={{ transform: open ? undefined : 'rotate(-90deg)' }}
          />
        ) : (
          <Sparkle size={11} className="shrink-0 text-ink-3" />
        )}
        <span className={cn('truncate', part.streaming ? 'shimmer' : 'text-ink-2')}>{label}</span>
        {inputTokens ? (
          <span
            title={`${tokens?.inputTokens} input tokens`}
            className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3"
          >
            ↑{inputTokens}
          </span>
        ) : null}
        {outputTokens ? (
          <span
            title={`${tokens?.outputTokens} output tokens`}
            className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3"
          >
            ↓{outputTokens}
          </span>
        ) : null}
      </button>

      <Collapse open={open}>
        <p className="ml-[7px] mt-1 whitespace-pre-wrap break-words border-l border-line/60 py-0.5 pl-3 text-[12px] leading-[1.65] text-ink-2">
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
 * One agent step — a compact 24px row designed to live inside a ToolGroup.
 * `[icon] Verb(dim) — file bright / dir dim — +N green — Failed red-dotted`.
 * No chip backgrounds; the argument is bare monospace text. Expands to the raw
 * input/output behind a hover chevron. When rendered standalone (single tool
 * outside a group) the caller wraps it; this row itself has no outer margin.
 */
export function Step({ part }: { part: ToolPart | CommandPart }) {
  const [open, setOpen] = useState(false)
  const simple = useStore((s) => s.timelineDetail === 'simple')

  const isCommand = part.kind === 'command'
  const summary = describeTool(part)
  const detail = part.output
  // Simple mode: raw JSON args/output stay hidden entirely.
  const expandable = !simple && Boolean(detail || (!isCommand && part.input))
  const failed = part.status === 'failed'

  // Split "src/lib/mod.rs" into a dim directory and a bright file name, the
  // way the reference renders tool targets. Commands stay one dim run.
  let argName: string | undefined
  let argDir: string | undefined
  if (summary.arg) {
    const cut = summary.arg.lastIndexOf('/')
    if (cut > -1 && cut < summary.arg.length - 1) {
      argDir = summary.arg.slice(0, cut + 1)
      argName = summary.arg.slice(cut + 1)
    } else {
      argName = summary.arg
    }
  }

  // Cheap diffstat for write-like tools: the line count of the content being
  // written. Real diffs stay behind the file chips at the end of the turn.
  // Hidden in simple mode — counts are developer detail.
  const diffstat = (() => {
    if (simple || isCommand || failed) return null
    const lower = (summary.label ?? '').toLowerCase()
    if (!lower.includes('write') && !lower.includes('edit')) return null
    try {
      const args = JSON.parse(part.input ?? '{}') as { content?: string; new_string?: string }
      const text = args.content ?? args.new_string
      if (typeof text !== 'string' || text.length === 0) return null
      return `+${text.split('\n').length}`
    } catch {
      return null
    }
  })()

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen(!open)}
        className={cn(
          'group/row flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left transition-colors duration-100',
          expandable ? 'hover:bg-hover-2' : 'cursor-default',
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {part.status === 'running' ? (
            <span className="size-2.5 rounded-full border-[1.5px] border-accent border-t-transparent animate-spin" aria-hidden />
          ) : (
            <>
              <span
                className={cn(
                  'flex items-center transition-opacity duration-100',
                  failed ? 'text-red' : 'text-ink-3',
                  expandable && 'group-hover/row:opacity-0',
                  open && 'opacity-0',
                )}
              >
                {failed ? <AlertIcon size={12} /> : stepIcon(summary.glyph)}
              </span>
              {expandable ? (
                <ChevronDown
                  size={12}
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

        <span className="shrink-0 text-[12px] leading-none text-ink-2">{summary.label}</span>

        {summary.arg ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-none"
            title={isCommand ? part.command : part.input}
          >
            {argDir ? <span className="text-ink-3">{argDir}</span> : null}
            <span className={cn(isCommand ? 'text-ink-2' : 'text-ink')}>{argName}</span>
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {diffstat ? (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-green">{diffstat}</span>
        ) : null}
        {isCommand && !simple && part.exitCode !== undefined && part.exitCode !== 0 ? (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-red">
            exit {part.exitCode}
          </span>
        ) : null}
        {failed ? (
          <span
            title={detail ?? 'This step failed'}
            className="shrink-0 text-[10.5px] font-medium text-red underline decoration-dotted decoration-from-font underline-offset-2"
          >
            Failed
          </span>
        ) : null}
        {!simple && part.durationMs !== undefined ? (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-3">
            {formatDuration(part.durationMs)}
          </span>
        ) : null}
      </button>

      <Collapse open={open}>
        <div className="mb-1 ml-[13px] mt-0.5 flex flex-col gap-1 border-l border-line/60 py-1 pl-3">
          {!isCommand && part.input ? (
            <span className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.6] text-ink-3">
              {part.input}
            </span>
          ) : null}
          {detail ? (
            <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset/60 px-2 py-1.5 font-mono text-[11px] leading-[1.6] text-ink-2">
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

/** Grouped file changes at the end of a turn — one compact card, not loose rows. */
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
    <div className="overflow-hidden rounded-lg border border-line/50 bg-surface/30">
      <div className="flex items-center gap-1.5 border-b border-line/40 bg-surface/40 px-2.5 py-1">
        <FileIcon size={11} className="shrink-0 text-ink-3" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
          {files.length === 1 ? '1 file changed' : `${files.length} files changed`}
        </span>
      </div>
      <div className="flex max-w-full flex-col gap-0.5 p-1">
        {files.map((file, index) => (
          <FileChip
            key={`${file.path}-${index}`}
            file={file}
            project={project}
            sessionId={sessionId}
          />
        ))}
      </div>
    </div>
  )
}

function FileChip({
  file,
  project,
  sessionId,
}: {
  file: FileChangePart
  project?: string
  sessionId?: string
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
        'overflow-hidden rounded-md transition-colors duration-100',
        open ? 'bg-surface/60' : 'hover:bg-hover/60',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'group/chip flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-left',
          'transition-colors duration-100',
        )}
      >
        {file.ok ? (
          <Check size={11} className="shrink-0 text-green" />
        ) : (
          <AlertIcon size={11} className="shrink-0 text-red" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{file.path}</span>
        {project ? (
          <span className="shrink-0 font-mono text-[9.5px] text-ink-3 opacity-0 transition-opacity group-hover/chip:opacity-100">
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
/**
 * Plan preview card — the timeline's rendering of a `plan` part. Shows the
 * plan's title and body (markdown, clamped) with a "View full plan" action that
 * opens the right-rail Plan tab. The step list itself lives in the HUD Progress
 * section and the right rail — the timeline card is a *preview*, not a todo
 * list, so the plan reads as the agent wrote it.
 */
export function Plan({ part, onViewPlan }: { part: PlanPart; onViewPlan?: () => void }) {
  const [open, setOpen] = useState(true)
  const body = (part.text ?? '').trim()
  // Title: the payload title, else the first heading/line of the body.
  const firstLine = body.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const title = part.title?.trim() || firstLine.replace(/^#{1,6}\s*/, '') || 'Plan'
  // Body excludes the title line so it isn't shown twice.
  const bodyWithoutTitle = part.title
    ? body
    : body.split('\n').slice(body.split('\n').findIndex((l) => l.trim()) + 1).join('\n').trim()

  // Todo steps with live status — the model's checklist, collapsible.
  const steps = useMemo(() => {
    const entries = part.entries ?? []
    return (part.steps ?? []).map((step) => {
      const raw = entries.find((e) => e.content === step)?.status?.toLowerCase() ?? 'pending'
      const status = raw.includes('progress')
        ? 'in_progress'
        : raw.includes('complet') || raw === 'done'
          ? 'completed'
          : raw.includes('fail')
            ? 'failed'
            : raw.includes('block')
              ? 'blocked'
              : 'pending'
      return { step, status: status as 'completed' | 'in_progress' | 'pending' | 'blocked' | 'failed' }
    })
  }, [part.steps, part.entries])
  const done = steps.filter((s) => s.status === 'completed').length

  return (
    <div className="animate-up overflow-hidden rounded-2xl border border-zinc-800 bg-inset shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl">
      {/* Header — collapsible toggle + "Plan" + progress + copy */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <FileIcon size={13} className="shrink-0 text-zinc-500" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">Plan</span>
        {steps.length > 0 ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
            {done}/{steps.length}
          </span>
        ) : null}
        {part.status && part.status !== 'proposed' ? (
          <span
            className={cn(
              'shrink-0 rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide',
              part.status === 'approved' && 'border-green/30 bg-green/10 text-green',
              part.status === 'declined' && 'border-red/30 bg-red/10 text-red',
              part.status === 'completed' && 'border-line bg-inset text-ink-2',
            )}
          >
            {part.status}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {body ? (
            <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              <CopyButton value={body} label="Copy plan" />
            </span>
          ) : null}
          <ChevronDown
            size={13}
            className={cn('shrink-0 text-zinc-500 transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>

      <Collapse open={open}>
        <div>
          {/* Todo checklist */}
          {steps.length > 0 ? (
            <ol className="space-y-0.5 px-2.5 pt-2">
              {steps.map(({ step, status }, index) => (
                <li
                  key={`${step}-${index}`}
                  className={cn('flex items-start gap-2 rounded-lg px-1.5 py-1', status === 'in_progress' && 'bg-white/[0.04]')}
                >
                  <span className="mt-0.5 shrink-0 text-[11px] leading-none" aria-hidden>
                    {status === 'completed' ? (
                      <span className="text-green">✓</span>
                    ) : status === 'in_progress' ? (
                      <span className="inline-block size-2.5 animate-pulse rounded-full border-[1.5px] border-accent border-t-transparent" />
                    ) : status === 'failed' || status === 'blocked' ? (
                      <span className="text-red">⚠</span>
                    ) : (
                      <span className="text-zinc-600">○</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 break-words text-[12px] leading-snug',
                      status === 'completed' ? 'text-zinc-500 line-through' : status === 'in_progress' ? 'font-medium text-zinc-100' : 'text-zinc-300',
                    )}
                  >
                    {index + 1}. {step}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {/* Title + body preview */}
          <div className="px-4 pb-3 pt-3.5">
            <h3 className="text-[15px] font-semibold leading-[1.4] text-white">{title}</h3>
            {bodyWithoutTitle ? (
              <div className="mt-2 flex flex-col gap-1.5">
                {bodyWithoutTitle
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .slice(0, 6)
                  .map((line, index) => {
                    const heading = /^#{1,6}\s+/.test(line)
                    const bullet = /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)
                    const clean = line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '')
                    return (
                      <p
                        key={index}
                        className={cn(
                          'whitespace-pre-wrap break-words leading-[1.6]',
                          heading ? 'text-[13px] font-semibold text-zinc-100' : 'text-[12.5px] text-zinc-400',
                        )}
                      >
                        {bullet ? <span className="mr-1.5 text-zinc-600">•</span> : null}
                        {inlineMarkdown(clean)}
                      </p>
                    )
                  })}
                {bodyWithoutTitle.split('\n').filter((l) => l.trim()).length > 6 ? (
                  <p className="font-mono text-[10.5px] text-zinc-600">…</p>
                ) : null}
              </div>
            ) : null}

            {onViewPlan ? (
              <button
                type="button"
                onClick={onViewPlan}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition hover:bg-white/[0.06] active:scale-[0.99]"
              >
                View full plan
                <span aria-hidden className="text-zinc-500">→</span>
              </button>
            ) : null}
          </div>
        </div>
      </Collapse>
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
  const cached = formatTokens(part.cacheReadTokens)
  if (input === null && output === null && cached === null) return null

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-ink-3">
      {input !== null ? <span title={`${part.inputTokens} input tokens (total this turn)`}>↑{input}</span> : null}
      {output !== null ? <span title={`${part.outputTokens} output tokens (total this turn)`}>↓{output}</span> : null}
      {cached !== null ? <span title={`${part.cacheReadTokens} cache-read tokens`}>↻{cached}</span> : null}
    </span>
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

/** End-of-turn footer: why the turn stopped, how long it ran, token counts. */
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
    <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
      {failed ? (
        <AlertIcon size={10} className="shrink-0 text-orange" />
      ) : (
        <Check size={10} className="shrink-0 text-green" />
      )}
      <span className="font-sans text-[10.5px]">{reason ?? 'Turn complete'}</span>
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

/**
 * Plan-approval card — shown when the agent proposes a full plan and waits for
 * the user's go-ahead (ExitPlanMode / plan-mode approval). Matches the
 * reference design: a plan preview (title + body + "View full plan"), numbered
 * options with bold labels + descriptions, a free-text row for suggestions, and
 * a Dismiss / Submit footer.
 */
function PlanApproval({
  part,
  view,
  onRespond,
  onViewPlan,
}: {
  part: ApprovalPart
  view: ReturnType<typeof describeApproval>
  onRespond: (requestId: string, decision: string, meta?: RespondMeta) => void
  onViewPlan?: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // The plan body rides in the prompt as `ExitPlanMode {"plan": "…"}`. Pull the
  // markdown out so the card can preview it; fall back to the parsed question.
  const planText = useMemo(() => {
    const match = part.prompt.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>
        const plan = parsed['plan']
        if (typeof plan === 'string' && plan.trim()) return plan.trim()
      } catch {
        /* not JSON — fall through */
      }
    }
    return view.question
  }, [part.prompt, view.question])

  // First non-empty line (minus a leading heading marker) is the title.
  const lines = planText.split('\n').map((l) => l.trim()).filter(Boolean)
  const title = (lines[0] ?? 'Proposed plan').replace(/^#{1,6}\s*/, '')
  const body = lines.slice(1).join('\n')

  const options = view.options.length > 0
    ? view.options
    : [
        { value: 'approve', label: 'Approve', description: 'Accept the plan and let the agent execute it', kind: 'allow' as const },
        { value: 'decline', label: 'Decline', description: 'Reject the plan and stop the agent', kind: 'deny' as const },
        { value: 'suggest changes', label: 'Suggest changes', description: 'Send feedback for the agent to revise', kind: 'other' as const },
      ]

  const isSuggest = selected !== null && options[selected]?.value === 'suggest changes'
  const canSubmit = selected !== null && (!isSuggest || feedback.trim().length > 0)

  const handleSubmit = () => {
    if (selected === null || submitting) return
    const option = options[selected]
    setSubmitting(true)
    if (option.value === 'suggest changes') {
      onRespond(part.requestId, 'suggest changes', { allow: false, customText: feedback.trim() })
    } else {
      const allow = /^(allow|approve|yes)\b/i.test(option.value)
      onRespond(part.requestId, option.value, { allow })
    }
  }

  const handleDismiss = () => {
    setSubmitting(true)
    onRespond(part.requestId, 'decline', { allow: false })
  }

  return (
    <div
      data-approval-id={part.requestId}
      className="animate-up overflow-hidden rounded-2xl border border-zinc-800 bg-inset shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl"
      role="alert"
      aria-label="Plan approval required"
    >
      {/* Plan header — document icon + "Plan" + copy */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
        <FileIcon size={13} className="shrink-0 text-zinc-500" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">Plan</span>
        <span className="ml-auto">
          <CopyButton value={planText} label="Copy plan" />
        </span>
      </div>

      {/* Plan preview — title + clamped body + "View full plan" → right rail */}
      <div className="px-4 pb-3 pt-3.5">
        <h3 className="text-[15px] font-semibold leading-[1.4] text-white">{title}</h3>
        {body ? (
          <div className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-zinc-400">
            {body}
          </div>
        ) : null}
        {body && onViewPlan ? (
          <button
            type="button"
            onClick={onViewPlan}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition hover:bg-white/[0.06] active:scale-[0.99]"
          >
            View full plan
            <span aria-hidden className="text-zinc-500">→</span>
          </button>
        ) : null}
      </div>

      {/* Numbered options */}
      <div className="border-t border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <div className="flex flex-col gap-2">
          {options.map((option, index) => {
            const active = selected === index
            return (
              <button
                key={`${option.value}-${index}`}
                type="button"
                disabled={submitting}
                onClick={() => setSelected(index)}
                className={cn(
                  'group flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 active:scale-[0.99]',
                  active
                    ? 'border-white bg-white'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                    active ? 'border-black bg-black text-white' : 'border-white/15 bg-white/5 text-zinc-400',
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13px] font-semibold', active ? 'text-black' : 'text-zinc-100')}>
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className={cn('mt-0.5 block text-[11.5px] leading-[1.5]', active ? 'text-black/60' : 'text-zinc-500')}>
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}

          {/* Free-text row — always visible, focused when "Suggest changes" is picked */}
          <div
            className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
              isSuggest ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.03]',
            )}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                isSuggest ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400' : 'border-white/15 bg-white/5 text-zinc-400',
              )}
            >
              {options.length + 1}
            </span>
            <input
              value={feedback}
              onChange={(e) => { setFeedback(e.target.value); if (e.target.value.trim()) setSelected(options.findIndex((o) => o.value === 'suggest changes')) }}
              onFocus={() => setSelected(options.findIndex((o) => o.value === 'suggest changes'))}
              placeholder="Enter your answer…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>
      </div>

      {/* Footer — hint + Dismiss + Submit */}
      <div className="flex items-center gap-3 border-t border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10.5px] leading-[1.4] text-zinc-600">
          <AlertIcon size={12} className="shrink-0" />
          Use Tab / arrow keys to choose, then Enter or Space to select
        </span>
        <button
          type="button"
          disabled={submitting}
          onClick={handleDismiss}
          className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          className="shrink-0 rounded-lg bg-white px-4 py-1.5 text-[12px] font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Submit
        </button>
      </div>
    </div>
  )
}

export function Approval({
  part,
  onRespond,
  onViewPlan,
}: {
  part: ApprovalPart
  onRespond: (requestId: string, decision: string, meta?: RespondMeta) => void
  onViewPlan?: () => void
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

  // A plan-mode approval (ExitPlanMode / plan proposal) gets a dedicated card
  // with approve / decline / suggest-changes actions and the plan's steps.
  if (part.isPlan && !resolved) {
    return <PlanApproval part={part} view={view} onRespond={onRespond} onViewPlan={onViewPlan} />
  }

  if (resolved) {
    return (
      <div
        data-approval-id={part.requestId}
        className="animate-up flex items-center gap-2 rounded-xl border border-white/10 bg-field/80 px-3 py-2.5 text-[11.5px] text-zinc-400 backdrop-blur"
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
        'bg-inset backdrop-blur-xl',
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

/* ── Image ─────────────────────────────────────────────── */

/** Rendered inline in user messages for pasted/attached images. */
export function Image({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  if (error || !url) return null
  return (
    <img
      src={url}
      alt="attachment"
      className={cn(
        'max-h-64 w-auto rounded-xl border border-line/40 shadow-card',
        loaded ? 'opacity-100' : 'opacity-0',
        'transition-opacity duration-200',
      )}
      onLoad={() => setLoaded(true)}
      onError={() => setError(true)}
      loading="lazy"
    />
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
  sessionId,
  onViewPlan,
  usage,
}: {
  part: MessagePart
  onRespond: (requestId: string, decision: string, meta?: { customText?: string; always?: boolean; allow?: boolean }) => void
  sessionId?: string
  /** Opens the right-rail Plan tab (timeline plan preview's "View full plan"). */
  onViewPlan?: () => void
  /** The turn's usage, attached to the reasoning row's ↑/↓ chips. */
  usage?: Extract<MessagePart, { kind: 'usage' }>
}) {
  switch (part.kind) {
    case 'text':
      return <Prose text={part.text} streaming={part.streaming} />
    case 'image':
      return <Image url={sessionId ? `/api/attachments/${sessionId}/${encodeURIComponent(part.fileName)}` : ''} />
    case 'reasoning':
      return <Reasoning part={part} tokens={usage} />
    case 'tool':
    case 'command':
      return <Step part={part} />
    case 'plan':
      return <Plan part={part} onViewPlan={onViewPlan} />
    case 'approval':
      return <Approval part={part} onRespond={onRespond} onViewPlan={onViewPlan} />
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
    case 'orchestration':
      return <OrchestrationRow part={part} />
    case 'progress':
      return <ProgressRow part={part} />
    case 'search':
      return <SearchRow part={part} />
    case 'git_commit':
      return <GitCommitRow part={part} />
    case 'config_changed':
      return <ConfigRow part={part} />
    case 'context':
      return <ContextChip part={part} />
    case 'verification':
      return <VerificationCard part={part} />
    case 'browser':
      return <BrowserStepRow part={part} />
  }
}

/* ── New AI-event part rows ──────────────────────────────────────────────── */

function SubagentRow({ part }: { part: Extract<MessagePart, { kind: 'subagent' }> }) {
  const running = part.status === 'running'
  const cancelled = part.status === 'cancelled'
  const failed = part.status === 'failed'
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <WorkerAvatar
        name={part.name}
        size={18}
        ring
        status={running ? 'working' : failed ? 'failed' : cancelled ? 'idle' : 'done'}
      />
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        {running
          ? 'Subagent running'
          : cancelled
            ? 'Subagent cancelled'
            : failed
              ? 'Subagent failed'
              : 'Subagent done'}{' '}
        · {part.name}
      </span>
      {part.kindType ? <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">{part.kindType}</span> : null}
    </div>
  )
}

function OrchestrationRow({ part }: { part: Extract<MessagePart, { kind: 'orchestration' }> }) {
  const running = part.status === 'running' || part.status === 'merging'
  const label =
    part.status === 'merging'
      ? 'Merging answers'
      : part.status === 'running'
        ? 'Fan-out running'
        : part.status === 'failed'
          ? 'Fan-out failed'
          : 'Fan-out done'
  const children = part.children ?? []
  // Worker/agent labels: a room run names its workers (Scout, Maven…), a
  // plain fan-out falls back to the agent ids. Names make the roster visible.
  const workers = part.names && part.names.length > 0 ? part.names : part.agents
  const display = workers.length > 0 ? workers : children.map((child) => child.agent)
  const childStatus = new Map(children.map((child) => [child.agent, child.status]))
  const showStatuses = display.length === children.length
  return (
    <div className="rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex shrink-0 items-center" aria-hidden>
          {display.slice(0, 4).map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="rounded-full ring-2 ring-inset ring-inset"
              style={{ marginLeft: index === 0 ? 0 : -5, zIndex: display.length - index }}
            >
              <WorkerAvatar
                name={name}
                size={16}
                ring
                status={
                  showStatuses
                    ? childStatus.get(name) === 'completed'
                      ? 'done'
                      : childStatus.get(name) === 'failed' || childStatus.get(name) === 'timeout' || childStatus.get(name) === 'cancelled'
                        ? 'failed'
                        : childStatus.has(name)
                          ? 'working'
                          : 'idle'
                    : running
                      ? 'working'
                      : 'done'
                }
              />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
          {label} · {display.join(' + ')}
        </span>
        <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">
          {children.length > 0
            ? `${children.filter((child) => child.status === 'completed').length}/${children.length} ok`
            : `${workers.length} agents`}
        </span>
      </div>
      {part.reply && !running ? (
        <div className="mt-1.5 border-t border-line/30 pt-1.5">
          <Prose text={part.reply} streaming={false} />
        </div>
      ) : null}
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
  const simple = useStore((s) => s.timelineDetail === 'simple')
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className="shrink-0 font-mono text-[10px] font-semibold text-green">⬆</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        Committed{part.message ? ` — ${part.message}` : simple ? '' : ` ${part.sha}`}
      </span>
      {part.files && part.files.length > 0 ? <span className="shrink-0 font-mono text-[9px] text-ink-3">{part.files.length} files</span> : null}
    </div>
  )
}

function ConfigRow({ part }: { part: Extract<MessagePart, { kind: 'config_changed' }> }) {
  const simple = useStore((s) => s.timelineDetail === 'simple')
  if (simple) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <span className="shrink-0 text-ink-3" aria-hidden>⚙</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
        {part.key} → <span className="font-mono text-ink">{part.value}</span>
      </span>
    </div>
  )
}

/** Harness verification card: project tests run after a code-changing turn. */
function VerificationCard({ part }: { part: Extract<MessagePart, { kind: 'verification' }> }) {
  const running = part.status === 'running'
  const failed = part.status === 'failed'
  const simple = useStore((s) => s.timelineDetail === 'simple')
  return (
    <div className="rounded-lg border border-line/40 bg-inset px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            running ? 'bg-amber animate-pulse' : failed ? 'bg-red' : part.status === 'passed' ? 'bg-green' : 'bg-ink-3/60',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
          {running ? 'Running tests…' : part.status === 'passed' ? 'Tests passed' : part.status === 'failed' ? 'Tests failed' : 'Tests skipped'}
        </span>
        {part.command && !simple ? <span className="shrink-0 font-mono text-[9.5px] text-ink-3">{part.command}</span> : null}
      </div>
      {part.output && !simple ? (
        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-canvas/60 px-2 py-1 font-mono text-[10px] leading-snug text-ink-2">
          {part.output}
        </pre>
      ) : null}
    </div>
  )
}

/**
 * The harness-context chip: what the Plumb harness injected into the user's
 * prompt before it reached the agent (environment, project skills, similar past
 * runs). Rendered under the user message so the enrichment is visible.
 * Developer detail — hidden in simple mode.
 */
export function ContextChip({ part }: { part: Extract<MessagePart, { kind: 'context' }> }) {
  const simple = useStore((s) => s.timelineDetail === 'simple')
  if (simple) return null
  const bits: string[] = []
  if (part.environment) bits.push('environment')
  if (part.skills.length > 0) bits.push(`skills: ${part.skills.join(', ')}`)
  const runs = part.trajectories.length
  if (runs > 0) bits.push(`${runs} similar run${runs > 1 ? 's' : ''}`)
  const memories = part.memories.length
  if (memories > 0) bits.push(`memory: ${memories}`)
  return (
    <div
      className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-ink-3"
      title="Injected by the Plumb harness before this prompt reached the agent"
    >
      <span aria-hidden>🧠</span>
      <span className="truncate">Context: {bits.join(' · ')}</span>
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
      <span className={cn('size-1.5 shrink-0 rounded-full', running ? 'bg-accent breathe' : part.status === 'failed' ? 'bg-red' : 'bg-green')} aria-hidden />
      <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">{part.status}</span>
    </div>
  )
}

export { Dots }

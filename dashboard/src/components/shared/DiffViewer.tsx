/**
 * DiffViewer — inline unified diff with line numbers and per-line tinting.
 *
 * Upgrades the plain `<pre>` diff rendering (DiffLayer) with a line-number
 * gutter and a file header row so added/removed counts and copy are available
 * without leaving the panel. Rendered as rows rather than a `<pre>` so the two
 * line-number columns stay aligned with their content.
 *
 * No syntax highlighting (none of the diff surfaces use a highlighter); the
 * +/- tint is backed by the visible sign character so status is never conveyed
 * by color alone.
 */

import { useMemo } from 'react'
import { cn } from '@/lib/format'
import { CopyButton } from '../ui'

export type DiffLineType = 'add' | 'del' | 'hunk' | 'context' | 'meta'

export interface DiffLine {
  type: DiffLineType
  text: string
  /** Source (left) line number, for context and removed lines. */
  left?: number
  /** Destination (right) line number, for context and added lines. */
  right?: number
}

/**
 * Split a unified git diff into typed rows, tracking line numbers across hunks.
 * `@@ -a,b +c,d @@` headers reset the counters; `+++`/`---` lines are meta.
 */
export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let left = 0
  let right = 0

  // Diffs end with a newline; drop the empty last element so an empty input
  // yields no rows and a trailing newline doesn't fabricate a context line.
  const rawLines = diff.split('\n')
  if (rawLines[rawLines.length - 1] === '') rawLines.pop()

  for (const raw of rawLines) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match) {
        left = Number(match[1]) - 1
        right = Number(match[2]) - 1
      }
      lines.push({ type: 'hunk', text: line })
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      lines.push({ type: 'meta', text: line })
      continue
    }
    if (line.startsWith('+')) {
      right += 1
      lines.push({ type: 'add', text: line, right })
      continue
    }
    if (line.startsWith('-')) {
      left += 1
      lines.push({ type: 'del', text: line, left })
      continue
    }
    left += 1
    right += 1
    lines.push({ type: 'context', text: line, left, right })
  }
  return lines
}

function countAdds(lines: DiffLine[]): number {
  return lines.reduce((sum, l) => sum + (l.type === 'add' ? 1 : 0), 0)
}

function countDels(lines: DiffLine[]): number {
  return lines.reduce((sum, l) => sum + (l.type === 'del' ? 1 : 0), 0)
}

export function DiffViewer({
  path,
  diff,
  status,
}: {
  path: string
  diff: string
  /** Git status letter, e.g. "M", "A", "??" — shown in the header. */
  status?: string
}) {
  const lines = useMemo(() => parseDiff(diff), [diff])
  const added = useMemo(() => countAdds(lines), [lines])
  const removed = useMemo(() => countDels(lines), [lines])

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line/60 bg-inset"
      aria-label={`Diff for ${path}`}
    >
      {/* File header — path, status, counts, copy */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line/40 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">{path}</span>
        {status ? (
          <span className="shrink-0 font-mono text-[9.5px] font-semibold text-ink-3">{status}</span>
        ) : null}
        <span className="shrink-0 font-mono text-[9.5px] tabular-nums">
          <span className="text-green">+{added}</span>{' '}
          <span className="text-red">−{removed}</span>
        </span>
        <CopyButton value={diff} label="Copy diff" />
      </header>

      {/* Rows with aligned line-number gutters */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto" role="region" aria-label="Diff contents">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'grid grid-cols-[3.25rem_3.25rem_minmax(0,1fr)] items-stretch font-mono text-[10px] leading-[1.55]',
              line.type === 'add' && 'bg-green/[0.07] text-green',
              line.type === 'del' && 'bg-red/[0.07] text-red',
              line.type === 'hunk' && 'text-orange',
              line.type === 'meta' && 'text-ink-3',
              line.type === 'context' && 'text-ink-2',
            )}
          >
            <span className="select-none border-r border-line/30 pr-1.5 text-right text-ink-3/70">
              {line.left ?? ''}
            </span>
            <span className="select-none border-r border-line/30 pr-1.5 text-right text-ink-3/70">
              {line.right ?? ''}
            </span>
            <span className="whitespace-pre-wrap break-words px-1.5">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

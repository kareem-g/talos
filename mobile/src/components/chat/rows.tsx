/**
 * Chat rows — the compact activity lines in an assistant turn.
 *
 * Each row is a faithful port of the desktop's counterpart, at the same height,
 * type scale and colour: `Step` (tool/command) at 24px with its glyph, diffstat,
 * exit code, duration and expandable raw input/output; the `FileChips` group;
 * the `DiffView` line colouring; and the AI-event rows (subagent, orchestration,
 * progress, search, git commit, browser step, verification).
 *
 * Two platform rules applied throughout: `truncate`/`line-clamp` become
 * `numberOfLines`, and CSS `hover:`/`group-hover:` reveals become either
 * press-to-expand or always-visible affordances — a phone has no hover.
 */

import * as React from 'react'
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  Pencil,
  Search as SearchIcon,
  Sparkle,
  SquareTerminal,
} from 'lucide-react-native'

import { cn } from '@/lib/format'
import { describeTool } from '@/lib/tools'
import { deviceBaseUrl } from '@app/lib/native'
import type {
  BrowserStepPart,
  CommandPart,
  FileChangePart,
  GitCommitPart,
  OrchestrationPart,
  ProgressPart,
  SearchPart,
  SubagentPart,
  ToolPart,
  VerificationPart,
} from '@/types/conversation'
import { Mono } from '@app/components/ui'
import { Prose } from './prose'
import { palette } from '@app/design/tokens'

const FAILED = palette.danger
const DIM = palette.ink3
const GREEN = palette.ok

/* ── Step: a tool call or shell command ──────────────────────────────────── */

function StepIcon({ glyph, failed }: { glyph: string; failed: boolean }) {
  const color = failed ? FAILED : DIM
  const size = glyph === 'search' ? 13 : 12
  if (failed) return <AlertTriangle size={12} color={FAILED} />
  if (glyph === 'edit') return <Pencil size={size} color={color} />
  if (glyph === 'read' || glyph === 'file') return <FileText size={size} color={color} />
  if (glyph === 'run') return <SquareTerminal size={size} color={color} />
  if (glyph === 'search') return <SearchIcon size={size} color={color} />
  return <Sparkle size={size} color={color} />
}

/**
 * One agent step. `[icon] Verb(dim) arg — +N / exit N / Failed / duration`.
 * Collapsed to a single 24px row; expands to the raw input and output.
 */
export function Step({
  part,
  simple,
}: {
  part: ToolPart | CommandPart
  simple?: boolean
}) {
  const isCommand = part.kind === 'command'
  const failed = part.status === 'failed'
  const running = part.status === 'running'
  const summary = describeTool(part)
  const [open, setOpen] = React.useState(false)

  // Commands echo their own text as the argument; tools show a basename.
  const arg = summary.arg
  const argDir = arg && arg.includes('/') ? arg.slice(0, arg.lastIndexOf('/') + 1) : ''
  const argName = arg && argDir ? arg.slice(argDir.length) : arg
  const expandable = !simple && Boolean(part.output || (!isCommand && part.input))
  const diffLines = part.kind === 'tool' ? countAddedLines(part) : 0

  return (
    <View className="min-w-0">
      <Pressable
        onPress={expandable ? () => setOpen((value) => !value) : undefined}
        disabled={!expandable}
        className="h-6 w-full flex-row items-center gap-1.5 rounded-md px-1.5"
      >
        <View className="size-4 shrink-0 items-center justify-center">
          {running ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <StepIcon glyph={summary.glyph} failed={failed} />
          )}
        </View>

        <Text className="shrink-0 text-[12px] leading-4 text-ink-2">{summary.label}</Text>

        {arg ? (
          <Mono className="min-w-0 flex-1 text-[11.5px] leading-4 text-ink" numberOfLines={1}>
            {argDir ? <Mono className="text-ink-3">{argDir}</Mono> : null}
            {argName}
          </Mono>
        ) : (
          <View className="flex-1" />
        )}

        {!running && diffLines > 0 && !isCommand ? (
          <Mono className="shrink-0 text-[10.5px] text-green">+{diffLines}</Mono>
        ) : null}
        {isCommand && part.exitCode !== undefined && part.exitCode !== 0 ? (
          <Mono className="shrink-0 text-[10.5px] text-red">exit {part.exitCode}</Mono>
        ) : null}
        {failed ? (
          <Text className="shrink-0 text-[10.5px] font-medium text-red underline">Failed</Text>
        ) : null}
        {part.durationMs && !simple ? (
          <Mono className="shrink-0 text-[10.5px]">{formatMs(part.durationMs)}</Mono>
        ) : null}
        {expandable ? (
          <ChevronDown size={11} color={DIM} style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }} />
        ) : null}
      </Pressable>

      {open && expandable ? (
        <View className="mb-1 ml-[13px] mt-0.5 flex-col gap-1 border-l border-line py-1 pl-3">
          {part.kind === 'tool' && part.input ? (
            <Mono className="text-[10.5px] leading-4">{part.input}</Mono>
          ) : null}
          {part.output ? (
            <Mono className="max-h-64 overflow-hidden rounded-md bg-inset px-2 py-1.5 text-[11px] leading-4 text-ink-2">
              {part.output}
            </Mono>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** `+N` diffstat for write tools, from the tool's own output. */
function countAddedLines(part: ToolPart): number {
  if (!part.output) return 0
  if (!/edit|write|patch|create|apply/i.test(`${part.toolKind ?? ''} ${part.name}`)) return 0
  let added = 0
  for (const line of part.output.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1
  }
  return added
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/* ── Diff ────────────────────────────────────────────────────────────────── */

/** Unified-diff lines, coloured by prefix exactly as the desktop does. */
export function DiffView({ diff }: { diff: string }) {
  return (
    <View className="max-h-72 overflow-hidden rounded-b-lg border-t border-line bg-inset px-3 py-2">
      {diff.split('\n').map((line, index) => {
        const tone =
          line.startsWith('+') && !line.startsWith('+++')
            ? 'text-green'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'text-red'
              : line.startsWith('@@')
                ? 'text-accent'
                : 'text-ink-2'
        return (
          <Mono key={index} className={cn('text-[11px] leading-5', tone)}>
            {line.length === 0 ? ' ' : line}
          </Mono>
        )
      })}
    </View>
  )
}

/* ── Files changed ───────────────────────────────────────────────────────── */

/** The "N files changed" group, with each path expandable to its diff. */
export function FileChips({
  parts,
  onLoadDiff,
}: {
  parts: FileChangePart[]
  onLoadDiff?: (path: string) => Promise<string | null>
}) {
  return (
    <View className="overflow-hidden rounded-lg border border-line bg-surface">
      <View className="flex-row items-center gap-1.5 border-b border-line bg-inset px-2.5 py-1">
        <FileText size={11} color={DIM} />
        <Mono className="text-[10px] uppercase tracking-wider">
          {parts.length} file{parts.length === 1 ? '' : 's'} changed
        </Mono>
      </View>
      <View className="flex-col gap-0.5 p-1">
        {parts.map((part) => (
          <FileChip key={part.path} part={part} onLoadDiff={onLoadDiff} />
        ))}
      </View>
    </View>
  )
}

function FileChip({
  part,
  onLoadDiff,
}: {
  part: FileChangePart
  onLoadDiff?: (path: string) => Promise<string | null>
}) {
  const [open, setOpen] = React.useState(false)
  const [diff, setDiff] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (diff !== null || error !== null) return
    if (!onLoadDiff) {
      setError('Diff is not available for this session.')
      return
    }
    const next = await onLoadDiff(part.path)
    if (next === null) setError('No diff available for this file.')
    else setDiff(next)
  }

  return (
    <View className="overflow-hidden rounded-md">
      <Pressable onPress={() => void toggle()} className="h-6 flex-row items-center gap-1.5 rounded-md px-2">
        {part.ok ? <Check size={11} color={GREEN} /> : <AlertTriangle size={11} color={FAILED} />}
        <Mono className="min-w-0 flex-1 text-[11px] text-ink" numberOfLines={1}>
          {part.path}
        </Mono>
        <Mono className="shrink-0 text-[9.5px]">{open ? 'hide' : 'diff'}</Mono>
        <ChevronDown size={11} color={DIM} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        error ? (
          <Mono className="px-3 py-2 text-[11px]">{error}</Mono>
        ) : diff === null ? (
          <Mono className="px-3 py-2 text-[11px]">Loading diff…</Mono>
        ) : (
          <DiffView diff={diff} />
        )
      ) : null}
    </View>
  )
}

/* ── AI-event rows ───────────────────────────────────────────────────────── */

function EventRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={cn('flex-row items-center gap-2 rounded-lg border border-line bg-inset px-2 py-1.5', className)}>
      {children}
    </View>
  )
}

export function SubagentRow({ part }: { part: SubagentPart }) {
  const tone =
    part.status === 'failed' ? 'bg-red' : part.status === 'running' ? 'bg-accent' : 'bg-green'
  return (
    <EventRow>
      <View className={cn('size-[7px] rounded-full', tone)} />
      <Text className="min-w-0 flex-1 text-[11px] text-ink-2" numberOfLines={1}>
        Subagent {part.status} · {part.name}
      </Text>
      <Mono className="shrink-0 text-[9px] uppercase">{part.kindType}</Mono>
    </EventRow>
  )
}

export function OrchestrationRow({ part }: { part: OrchestrationPart }) {
  const names = part.names?.length ? part.names : part.agents
  const label =
    part.status === 'merging' ? 'Merging answers' : part.status === 'running' ? 'Fan-out running' : `Fan-out ${part.status}`
  const okCount = part.children?.filter((child) => child.status === 'ok').length
  return (
    <EventRow className="flex-col items-stretch">
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-[11px] text-ink-2" numberOfLines={1}>
          {label} · {names.slice(0, 4).join(' + ')}
        </Text>
        <Mono className="shrink-0 text-[9px] uppercase">
          {part.children ? `${okCount ?? 0}/${part.children.length} ok` : `${part.agents.length} agents`}
        </Mono>
      </View>
      {part.reply ? (
        <View className="mt-1.5 border-t border-line pt-1.5">
          <Prose text={part.reply} />
        </View>
      ) : null}
    </EventRow>
  )
}

export function ProgressRow({ part }: { part: ProgressPart }) {
  const pct = Math.max(0, Math.min(100, part.percent ?? 0))
  return (
    <EventRow>
      <View className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-field">
        <View className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </View>
      <Mono className="shrink-0 text-[9.5px]">{part.percent !== undefined ? `${Math.round(pct)}%` : '…'}</Mono>
      {part.message ? (
        <Text className="min-w-0 flex-1 text-[11px] text-ink-2" numberOfLines={1}>
          {part.message}
        </Text>
      ) : null}
    </EventRow>
  )
}

export function SearchRow({ part }: { part: SearchPart }) {
  return (
    <EventRow className="items-start">
      <Text className="mt-0.5 shrink-0 text-[11px]">🔍</Text>
      <View className="min-w-0 flex-1">
        <Text className="text-[11px] text-ink-2" numberOfLines={1}>
          Search: {part.query}
        </Text>
        {part.results?.[0] ? (
          <Mono className="text-[9.5px]" numberOfLines={1}>
            {part.results[0]}
          </Mono>
        ) : null}
      </View>
    </EventRow>
  )
}

export function GitCommitRow({ part }: { part: GitCommitPart }) {
  return (
    <EventRow>
      <Mono className="shrink-0 text-[10px] font-semibold text-green">⬆</Mono>
      <Text className="min-w-0 flex-1 text-[11px] text-ink-2" numberOfLines={1}>
        Committed — {part.message ?? part.sha.slice(0, 7)}
      </Text>
      {part.files?.length ? (
        <Mono className="shrink-0 text-[9px]">{part.files.length} files</Mono>
      ) : null}
    </EventRow>
  )
}

const BROWSER_ICON: Record<string, string> = {
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

export function BrowserStepRow({ part }: { part: BrowserStepPart }) {
  const tone = part.status === 'failed' ? 'bg-red' : part.status === 'running' ? 'bg-accent' : 'bg-green'
  return (
    <EventRow>
      <Text className="shrink-0 text-[11px]">{BROWSER_ICON[part.action] ?? '🌐'}</Text>
      <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
        <Mono className="text-[9px] uppercase">{part.action}</Mono>
        <Text className="min-w-0 flex-1 text-[11px] text-ink-2" numberOfLines={1}>
          {part.detail ?? part.target ?? ''}
        </Text>
      </View>
      <View className={cn('size-1.5 shrink-0 rounded-full', tone)} />
      <Mono className="shrink-0 text-[9px] uppercase">{part.status}</Mono>
    </EventRow>
  )
}

export function VerificationCard({ part, simple }: { part: VerificationPart; simple?: boolean }) {
  const tone =
    part.status === 'failed'
      ? 'bg-red'
      : part.status === 'passed'
        ? 'bg-green'
        : part.status === 'running'
          ? 'bg-orange'
          : 'bg-ink-3'
  return (
    <EventRow className="items-start">
      <View className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', tone)} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-[11px] text-ink-2" numberOfLines={1}>
            Tests {part.status}
          </Text>
          {!simple ? (
            <Mono className="shrink-0 text-[9.5px]" numberOfLines={1}>
              {part.command}
            </Mono>
          ) : null}
        </View>
        {part.output && !simple ? (
          <Mono className="mt-1 max-h-28 overflow-hidden rounded bg-canvas px-2 py-1 text-[10px] leading-4 text-ink-2">
            {part.output}
          </Mono>
        ) : null}
      </View>
    </EventRow>
  )
}

/** An attached image: the desktop loads it from the daemon's attachment route. */
export function ChatImage({
  sessionId,
  fileName,
}: {
  sessionId: string
  fileName: string
}) {
  const [failed, setFailed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  if (failed) return null
  const uri = `${deviceBaseUrl()}/api/attachments/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`
  return (
    <Image
      source={{ uri }}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      resizeMode="contain"
      className={cn('rounded-xl border border-line', loaded ? 'opacity-100' : 'opacity-0')}
      style={{ maxHeight: 256, width: '100%' }}
    />
  )
}

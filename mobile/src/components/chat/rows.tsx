/**
 * Chat rows — the compact kiln lines in an assistant turn.
 *
 * EMBER CLAY: a lone tool renders bare; a run folds into one clay tablet
 * whose footer counts steps/time/failures. Diffstat + exit code stay
 * right-aligned tabular; a step in flight keeps its height (spinner swaps the
 * glyph) so the stream never jumps. Slim 22pt ember-glow tiles hold glyphs;
 * numbers are the content. Same describeTool/diff handlers.
 */

import * as React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  FolderSearch,
  GitCommitHorizontal,
  Globe,
  Keyboard,
  MousePointerClick,
  Pencil,
  Search as SearchIcon,
  Sparkle,
  SquareTerminal,
  Terminal,
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
import {
  diffAddSoft,
  diffDelSoft,
  palette,
  radius,
  toneBorder,
  toneColor,
  toneSoft,
  type Tone,
} from '@app/design/tokens'
import { useCollapse } from '@app/components/motion'
import {
  CopyButton,
  Mono,
  Well,
  haptic,
} from '@app/components/ui'
import { Prose } from './prose'
import { EventCard } from './cards'

const FAILED = palette.danger

/* ── Step: a tool call or shell command ──────────────────────────────────────── */

function StepGlyph({ glyph, failed, size = 12 }: { glyph: string; failed: boolean; size?: number }) {
  if (failed) return <AlertTriangle size={size} color={FAILED} />
  switch (glyph) {
    case 'edit':
      return <Pencil size={size} color={palette.ink2} />
    case 'read':
    case 'file':
      return <FileText size={size} color={palette.ink2} />
    case 'run':
      return <SquareTerminal size={size} color={palette.ink2} />
    case 'search':
      return <SearchIcon size={size} color={palette.ink2} />
    default:
      return <Sparkle size={size} color={palette.ink2} />
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`
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
  const collapse = useCollapse(open)

  // Commands echo their own text as the argument; tools show a basename.
  const arg = summary.arg
  const argDir = arg && arg.includes('/') ? arg.slice(0, arg.lastIndexOf('/') + 1) : ''
  const argName = arg && argDir ? arg.slice(argDir.length) : arg
  const expandable = !simple && Boolean(part.output || (!isCommand && part.input))
  const diffLines = part.kind === 'tool' ? countAddedLines(part) : 0

  return (
    <View style={{ minWidth: 0 }}>
      <Pressable
        accessibilityRole={expandable ? 'button' : 'text'}
        accessibilityLabel={`${summary.label}${arg ? ` ${arg}` : ''}`}
        accessibilityHint={expandable ? 'Shows the raw input and output' : undefined}
        accessibilityState={{ expanded: expandable ? open : undefined }}
        onPress={
          expandable
            ? () => {
                void haptic('light')
                setOpen((value) => !value)
              }
            : undefined
        }
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: radius.xs,
          paddingHorizontal: 4,
        }}
      >
        {/* Fixed 22pt tile: a spinner must not change the row's rhythm. */}
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.raised,
          }}
        >
          {running ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <StepGlyph glyph={summary.glyph} failed={failed} />
          )}
        </View>

        <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={1}>
          {summary.label}
        </Text>

        {arg ? (
          <Mono className="min-w-0 flex-1 text-[12px] leading-[17px] text-ink-2" numberOfLines={1}>
            {argDir ? <Mono className="text-ink-4">{argDir}</Mono> : null}
            {argName}
          </Mono>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        {!running && diffLines > 0 && !isCommand ? (
          <Mono className="shrink-0 text-[11px] text-ok" style={{ fontVariant: ['tabular-nums'] }}>
            +{diffLines}
          </Mono>
        ) : null}
        {isCommand && part.exitCode !== undefined && part.exitCode !== 0 ? (
          <Mono className="shrink-0 text-[11px] text-danger" style={{ fontVariant: ['tabular-nums'] }}>
            exit {part.exitCode}
          </Mono>
        ) : null}
        {failed ? (
          <Text className="shrink-0 text-[11px] font-semibold text-danger">Failed</Text>
        ) : null}
        {part.durationMs && !simple ? (
          <Mono className="shrink-0 text-[11px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
            {formatMs(part.durationMs)}
          </Mono>
        ) : null}
        {expandable ? (
          <ChevronDown
            size={12}
            color={palette.ink4}
            style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }}
          />
        ) : null}
      </Pressable>

      {expandable ? (
        <View {...(collapse.measured ? { onLayout: collapse.onLayout } : {})} style={collapse.style}>
          <View
            style={{
              marginLeft: 15,
              marginTop: 4,
              marginBottom: 6,
              paddingLeft: 11,
              borderLeftWidth: 1,
              borderLeftColor: palette.line,
              gap: 6,
            }}
          >
            {part.kind === 'tool' && part.input ? (
              <Mono className="text-[11px] leading-[16px] text-ink-3">{part.input}</Mono>
            ) : null}
            {part.output ? (
              <Well
                className="max-h-[200px] px-2.5 py-2"
                style={{ borderRadius: radius.sm }}
              >
                <ScrollView nestedScrollEnabled>
                  <Mono className="text-[11px] leading-[16px] text-ink-2">{part.output}</Mono>
                </ScrollView>
              </Well>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}

/* ── Tool group ─────────────────────────────────────────────────────────────── */

export function ToolGroup({ parts }: { parts: Array<ToolPart | CommandPart> }) {
  const [open, setOpen] = React.useState(true)
  const collapse = useCollapse(open)
  const failed = parts.some((part) => part.status === 'failed')
  const running = parts.some((part) => part.status === 'running')
  const totalMs = parts.reduce((sum, part) => sum + (part.durationMs ?? 0), 0)

  // A lone tool gets no card — see the file header.
  if (parts.length === 1) return <Step part={parts[0]} />

  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface,
        overflow: 'hidden',
      }}
    >
      <View {...(collapse.measured ? { onLayout: collapse.onLayout } : {})} style={collapse.style}>
        <View style={{ gap: 1, padding: 5 }}>
          {parts.map((part, index) => (
            <Step key={index} part={part} />
          ))}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${parts.length} tool steps${failed ? ', some failed' : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          void haptic('light')
          setOpen((value) => !value)
        }}
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          borderTopWidth: 1,
          borderTopColor: palette.line,
          paddingHorizontal: 11,
        }}
      >
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: running ? palette.accent : failed ? palette.danger : palette.ok,
          }}
        />
        {running ? <ActivityIndicator size="small" color={palette.accent} /> : null}
        <Mono className="text-[10.5px] text-ink-4" style={{ fontVariant: ['tabular-nums'] }}>
          {parts.length} steps{totalMs > 0 ? ` · ${formatMs(totalMs)}` : ''}
          {failed ? ' · failed' : ''}
          {running ? ' · running' : ''}
        </Mono>
        <View style={{ flex: 1 }} />
        <ChevronDown
          size={12}
          color={palette.ink4}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
    </View>
  )
}

/* ── Diff ──────────────────────────────────────────────────────────────────────
 * The desktop's `DiffViewer` rules, unchanged, because they are the right ones:
 * the `+`/`-` sign is the redundant encoding, so the state survives with no
 * colour vision at all, and the line-number gutters are what make a diff
 * navigable on a phone.
 *
 * A diff is horizontally scrollable, never wrapped. A wrapped diff is
 * unreadable, and a diff that is not scrollable silently hides the right-hand
 * side — which is where the new code is. */

export function DiffView({ diff, maxHeight = 280 }: { diff: string; maxHeight?: number }) {
  const lines = React.useMemo(() => diff.split('\n'), [diff])
  return (
    <Well style={{ maxHeight, borderTopWidth: 1, borderTopColor: palette.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <ScrollView nestedScrollEnabled style={{ maxHeight }}>
          <View style={{ paddingVertical: 8 }}>
            {lines.map((line, index) => {
              const add = line.startsWith('+') && !line.startsWith('+++')
              const del = line.startsWith('-') && !line.startsWith('---')
              const hunk = line.startsWith('@@')
              // The sign character in the line itself is the redundant
              // encoding, so the colour is reinforcement rather than the only
              // signal — and it is the *status* palette doing the colouring,
              // which is why there is no separate diff palette to keep in sync.
              const color = add ? palette.ok : del ? palette.danger : hunk ? palette.info : palette.ink2
              return (
                <View
                  key={index}
                  style={{
                    flexDirection: 'row',
                    backgroundColor: add ? diffAddSoft : del ? diffDelSoft : 'transparent',
                    paddingLeft: 10,
                    paddingRight: 14,
                  }}
                >
                  <Mono className="w-9 shrink-0 pr-2 text-right text-[10.5px] leading-[16px] text-ink-4">
                    {line.length === 0 ? ' ' : line}
                  </Mono>
                  <Mono className="text-[11.5px] leading-[16px]" style={{ color }}>
                    {line.length === 0 ? ' ' : line}
                  </Mono>
                </View>
              )
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </Well>
  )
}

/** A diff with a header that names the file and the size of the change. */
export function DiffCard({
  path,
  diff,
  status,
  added,
  removed,
}: {
  path: string
  diff: string
  status?: string
  added?: number
  removed?: number
}) {
  const stat = React.useMemo(() => {
    let plus = 0
    let minus = 0
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) plus += 1
      else if (line.startsWith('-') && !line.startsWith('---')) minus += 1
    }
    return { plus: added ?? plus, minus: removed ?? minus }
  }, [added, diff, removed])

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        }}
      >
        {status ? (
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: radius.xs,
              backgroundColor: palette.raised,
            }}
          >
            <Mono className="text-[10px] font-semibold text-ink-3">{status}</Mono>
          </View>
        ) : null}
        <Mono className="min-w-0 flex-1 text-[12px] text-ink-2" numberOfLines={1}>
          {path}
        </Mono>
        {stat.plus > 0 ? (
          <Mono className="text-[11px] text-ok" style={{ fontVariant: ['tabular-nums'] }}>
            +{stat.plus}
          </Mono>
        ) : null}
        {stat.minus > 0 ? (
          <Mono className="text-[11px] text-danger" style={{ fontVariant: ['tabular-nums'] }}>
            −{stat.minus}
          </Mono>
        ) : null}
        <CopyButton value={diff} label="Copy diff" accessibilityLabel={`Copy the diff for ${path}`} />
      </View>
      <DiffView diff={diff} />
    </View>
  )
}

/* ── Files changed ──────────────────────────────────────────────────────────────
 * One card per turn, collapsed to a list of paths. Each row expands to its
 * diff, fetched on demand — a turn that changed forty files must not fetch
 * forty diffs to render a summary of forty paths. */

export function FileChips({
  parts,
  onLoadDiff,
}: {
  parts: FileChangePart[]
  onLoadDiff?: (path: string) => Promise<string | null>
}) {
  const [expanded, setExpanded] = React.useState(false)
  const visible = expanded ? parts : parts.slice(0, 6)

  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        }}
      >
        <FileText size={12} color={palette.ink3} />
        <Mono className="text-[10px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 1 }}>
          {parts.length} {parts.length === 1 ? 'file' : 'files'} changed
        </Mono>
      </View>

      <View style={{ padding: 4 }}>
        {visible.map((part) => (
          <FileChip key={part.path} part={part} onLoadDiff={onLoadDiff} />
        ))}
      </View>

      {parts.length > 6 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show fewer files' : `Show all ${parts.length} files`}
          onPress={() => setExpanded((value) => !value)}
          style={{
            minHeight: 36,
            alignItems: 'center',
            justifyContent: 'center',
            borderTopWidth: 1,
            borderTopColor: palette.line,
          }}
        >
          <Text className="text-[12px] font-semibold text-ink-3">
            {expanded ? 'Show fewer' : `Show all ${parts.length}`}
          </Text>
        </Pressable>
      ) : null}
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
  const [loading, setLoading] = React.useState(false)
  const collapse = useCollapse(open)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (diff !== null || error !== null || loading) return
    if (!onLoadDiff) {
      setError('No workspace on this session, so there is no diff to show.')
      return
    }
    setLoading(true)
    try {
      const next = await onLoadDiff(part.path)
      if (next === null) setError('The working tree has moved on — no diff for this file.')
      else setDiff(next)
    } catch {
      setError('Could not read that diff.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ borderRadius: radius.sm, overflow: 'hidden' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={part.path}
        accessibilityHint={open ? 'Hides the diff' : 'Shows the diff'}
        accessibilityState={{ expanded: open }}
        onPress={() => void toggle()}
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 8,
        }}
      >
        {part.ok ? (
          <Check size={12} color={palette.ok} strokeWidth={2.6} />
        ) : (
          <AlertTriangle size={12} color={FAILED} />
        )}
        <Mono className="min-w-0 flex-1 text-[12px] text-ink-2" numberOfLines={1}>
          {part.path}
        </Mono>
        <Mono className="shrink-0 text-[10.5px] text-ink-4">{open ? 'hide' : 'diff'}</Mono>
        <ChevronDown
          size={12}
          color={palette.ink4}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      <View {...(collapse.measured ? { onLayout: collapse.onLayout } : {})} style={collapse.style}>
        {loading ? (
          <View style={{ padding: 14, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={palette.ink3} />
          </View>
        ) : error ? (
          <Text className="px-3 py-2.5 text-[12px] leading-[17px] text-ink-3">{error}</Text>
        ) : diff ? (
          <DiffView diff={diff} maxHeight={240} />
        ) : null}
      </View>
    </View>
  )
}

/* ── AI-event rows ──────────────────────────────────────────────────────────── */

export function SubagentRow({ part }: { part: SubagentPart }) {
  const tone =
    part.status === 'failed'
      ? palette.danger
      : part.status === 'running'
        ? palette.accent
        : palette.ok
  return (
    <EventCard
      icon={<View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone }} />}
      label={`Subagent ${part.status} · ${part.name}`}
      meta={part.kindType?.toUpperCase()}
    />
  )
}

export function OrchestrationRow({ part }: { part: OrchestrationPart }) {
  const names = part.names?.length ? part.names : part.agents
  const label =
    part.status === 'merging'
      ? 'Merging answers'
      : part.status === 'running'
        ? 'Fan-out running'
        : `Fan-out ${part.status}`
  const okCount = part.children?.filter((child) => child.status === 'ok').length
  return (
    <View style={{ gap: 6 }}>
      <EventCard
        icon={<Sparkle size={13} color={palette.accent} />}
        label={`${label} · ${names.slice(0, 4).join(' + ')}`}
        meta={part.children ? `${okCount ?? 0}/${part.children.length} ok` : `${part.agents.length} agents`}
      />
      {part.reply ? (
        <Well className="px-3.5 py-3">
          <Prose text={part.reply} />
        </Well>
      ) : null}
    </View>
  )
}

export function ProgressRow({ part }: { part: ProgressPart }) {
  const pct = Math.max(0, Math.min(100, part.percent ?? 0))
  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 7,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        {part.message ? (
          <Text className="min-w-0 flex-1 text-[12.5px] leading-[17px] text-ink-2" numberOfLines={1}>
            {part.message}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Mono className="text-[10.5px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
          {part.percent !== undefined ? `${Math.round(pct)}%` : '…'}
        </Mono>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: palette.raised, overflow: 'hidden' }}>
        <View
          style={{ width: `${pct}%`, height: '100%', borderRadius: 2, backgroundColor: palette.accent }}
        />
      </View>
    </View>
  )
}

export function SearchRow({ part }: { part: SearchPart }) {
  return (
    <EventCard
      icon={<FolderSearch size={13} color={palette.ink3} />}
      label={`Search: ${part.query}`}
      detail={part.results?.[0]}
    />
  )
}

export function GitCommitRow({ part }: { part: GitCommitPart }) {
  return (
    <EventCard
      icon={<GitCommitHorizontal size={13} color={palette.ok} />}
      label={`Committed — ${part.message ?? part.sha.slice(0, 7)}`}
      meta={part.files?.length ? `${part.files.length} files` : undefined}
    />
  )
}

const BROWSER_ICON: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  goto: Globe,
  click: MousePointerClick,
  type: Keyboard,
  press: Keyboard,
  check: Check,
  select: ChevronDown,
  scroll: ChevronDown,
  screenshot: Globe,
  assert: Check,
  wait_for: Sparkle,
  cursor_move: MousePointerClick,
  cursor_click: MousePointerClick,
  cursor_type: Keyboard,
  cursor_keypress: Keyboard,
}

export function BrowserStepRow({ part }: { part: BrowserStepPart }) {
  const tone =
    part.status === 'failed' ? palette.danger : part.status === 'running' ? palette.accent : palette.ok
  const Glyph = BROWSER_ICON[part.action] ?? Globe
  return (
    <EventCard
      icon={<Glyph size={13} color={palette.ink3} />}
      label={part.action}
      detail={part.detail ?? part.target ?? undefined}
      meta={part.status}
      tone={tone}
    />
  )
}

const VERIFICATION_TONE: Record<string, Tone> = {
  failed: 'danger',
  passed: 'ok',
  running: 'wait',
}

export function VerificationCard({
  part,
  simple,
}: {
  part: VerificationPart
  simple?: boolean
}) {
  const tone = VERIFICATION_TONE[part.status] ?? 'muted'
  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: toneBorder[tone],
        backgroundColor: toneSoft[tone],
        overflow: 'hidden',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: toneColor[tone],
          }}
        />
        <Text className="flex-1 text-[12.5px] font-medium text-ink" numberOfLines={1}>
          Tests {part.status}
        </Text>
        {!simple && part.command ? (
          <Mono className="max-w-[45%] text-[11px] text-ink-3" numberOfLines={1}>
            {part.command}
          </Mono>
        ) : null}
      </View>
      {part.output && !simple ? (
        <Well style={{ maxHeight: 110, borderTopWidth: 1, borderTopColor: palette.line }}>
          <ScrollView nestedScrollEnabled>
            <Mono className="px-3 py-2 text-[11px] leading-[16px] text-ink-2">{part.output}</Mono>
          </ScrollView>
        </Well>
      ) : null}
    </View>
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
      accessibilityLabel={`Attachment: ${fileName}`}
      style={{
        maxHeight: 260,
        width: '100%',
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.well,
        // Fades in rather than popping: an image that appears at full size
        // makes the transcript jump by its own height.
        opacity: loaded ? 1 : 0,
      }}
    />
  )
}

export { Terminal, cn }

/**
 * Chat cards — the full-width instrument blocks in an assistant turn.
 *
 * QAI SIGNAL DECK: Plan is a checklist card with an accent progress edge;
 * Approval stays the one LOUD element (tone-tinted fill + tone border +
 * "Needs you" pill + signal radio rings + full-width accent Confirm) because
 * it is where a pocket run unblocks. Resolved approvals collapse to one row so
 * the decision stays in history. Same respond/describeApproval handlers.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  TextInput,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { AlertTriangle, Check, ChevronDown, FileText, Moon, X } from 'lucide-react-native'

import { describeApproval, type ApprovalOption } from '@/lib/approvals'
import type {
  ApprovalPart,
  ErrorPart,
  PlanPart,
  TurnSummaryPart,
  UsagePart,
} from '@/types/conversation'
import { palette, radius, toneColor, toneSoft, type Tone } from '@app/design/tokens'
import { useCollapse } from '@app/components/motion'
import { Button, Card, CopyButton, Mono, StatusPill, Well, haptic } from '@app/components/ui'

/* ── Usage meter ───────────────────────────────────────────────────────────── */

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

export function UsageMeter({ part }: { part: UsagePart }) {
  const bits: string[] = []
  if (part.inputTokens != null) bits.push(`↑${formatTokens(part.inputTokens)}`)
  if (part.outputTokens != null) bits.push(`↓${formatTokens(part.outputTokens)}`)
  if (part.cacheReadTokens != null) bits.push(`↻${formatTokens(part.cacheReadTokens)}`)
  if (bits.length === 0) return null
  return (
    <Mono className="text-[11px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
      {bits.join('  ')}
    </Mono>
  )
}

/* ── Turn summary ──────────────────────────────────────────────────────────── */

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

export function TurnSummary({ part }: { part: TurnSummaryPart }) {
  const reason = part.stopReason ? (STOP_REASONS[part.stopReason] ?? part.stopReason) : undefined
  const failed = /error|refus|max_tokens|max_turns/i.test(part.stopReason ?? '')
  const stats: string[] = []
  if (part.inputTokens || part.outputTokens) {
    stats.push(`${formatTokens(part.inputTokens ?? 0)} in · ${formatTokens(part.outputTokens ?? 0)} out`)
  }
  if (part.durationMs) stats.push(`${(part.durationMs / 1000).toFixed(1)}s`)
  if (!reason && stats.length === 0) return null

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 }}>
      {failed ? (
        <AlertTriangle size={11} color={palette.wait} />
      ) : (
        <Check size={11} color={palette.ok} strokeWidth={2.6} />
      )}
      {reason ? <Text className="text-[11.5px] text-ink-3">{reason}</Text> : null}
      {reason && stats.length ? <Text className="text-[11px] text-ink-4">·</Text> : null}
      {stats.length ? (
        <Mono className="text-[11px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
          {stats.join(' · ')}
        </Mono>
      ) : null}
    </View>
  )
}

/* ── Error ─────────────────────────────────────────────────────────────────── */

export function ErrorCard({ part }: { part: ErrorPart }) {
  return (
    <Card tone="danger" accessible accessibilityRole="alert" className="overflow-hidden">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.raised,
          }}
        >
          <AlertTriangle size={14} color={palette.danger} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[13px] font-semibold text-danger">Agent error</Text>
          <Mono className="mt-1 text-[12px] leading-[18px] text-ink-2">{part.message}</Mono>
        </View>
      </View>
    </Card>
  )
}

/* ── Plan ──────────────────────────────────────────────────────────────────────
 * The plan is the answer to "what is this agent about to do", so it is a card
 * rather than prose, and it is collapsible because it is frequently longer
 * than the answer underneath it.
 *
 * The progress line at the top is a thin bar, not "3/7" alone: the bar answers
 * "how far along" without being read, and the count answers it precisely for
 * anyone who wants the number. */

const STEP_TONE: Record<string, string> = {
  completed: palette.ok,
  in_progress: palette.accent,
  failed: palette.danger,
  blocked: palette.wait,
  pending: palette.ink4,
}

const STEP_MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '▸',
  failed: '!',
  blocked: '!',
  pending: '○',
}

export function Plan({ part, onViewPlan }: { part: PlanPart; onViewPlan?: () => void }) {
  const [open, setOpen] = React.useState(true)
  const steps = part.entries?.length
    ? part.entries.map((entry) => ({ content: entry.content, status: entry.status ?? 'pending' }))
    : part.steps.map((content) => ({ content, status: 'pending' }))
  const done = steps.filter((step) => step.status === 'completed').length
  const ratio = steps.length ? done / steps.length : 0
  const collapse = useCollapse(open)

  const body = part.text ?? ''
  const previewLines = body.split('\n').filter((line) => line.trim().length > 0)

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Plan, ${done} of ${steps.length} steps done`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          void haptic('light')
          setOpen((value) => !value)
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          paddingHorizontal: 14,
          paddingVertical: 11,
        }}
      >
        <FileText size={14} color={palette.ink3} />
        <Mono className="text-[10px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 1.1 }}>
          Plan
        </Mono>
        <View
          style={{
            height: 4,
            flex: 1,
            borderRadius: 2,
            backgroundColor: palette.raised,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.max(3, ratio * 100)}%`,
              height: '100%',
              borderRadius: 2,
              backgroundColor: ratio === 1 ? palette.ok : palette.accent,
            }}
          />
        </View>
        <Mono className="text-[10.5px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
          {done}/{steps.length}
        </Mono>
        <ChevronDown
          size={14}
          color={palette.ink4}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      <Animated.View {...(collapse.measured ? { onLayout: collapse.onLayout } : {})} style={collapse.style}>
        <View style={{ borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 10, paddingHorizontal: 6 }}>
          {steps.slice(0, 20).map((step, index) => {
            const isDone = step.status === 'completed'
            const isActive = step.status === 'in_progress'
            return (
              <View
                key={index}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 9,
                  borderRadius: radius.sm,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  backgroundColor: isActive ? palette.raised : 'transparent',
                }}
              >
                <Text
                  style={{
                    marginTop: 1,
                    fontSize: 12,
                    lineHeight: 17,
                    width: 14,
                    color: STEP_TONE[step.status] ?? palette.ink4,
                    fontWeight: '700',
                  }}
                >
                  {STEP_MARK[step.status] ?? '○'}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 13.5,
                    lineHeight: 19,
                    color: isDone ? palette.ink3 : isActive ? palette.ink : palette.ink2,
                    textDecorationLine: isDone ? 'line-through' : 'none',
                    fontWeight: isActive ? '600' : '400',
                  }}
                >
                  {step.content}
                </Text>
              </View>
            )
          })}
        </View>

        {previewLines.length > 0 ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 10 }}>
            {part.title ? (
              <Text
                className="text-[16px] font-semibold text-ink"
                style={{ letterSpacing: -0.2, lineHeight: 22 }}
              >
                {part.title}
              </Text>
            ) : null}
            <View style={{ gap: 5 }}>
              {previewLines.slice(0, 6).map((line, index) => {
                const heading = /^#{1,4}\s+/.test(line)
                const bullet = /^\s*[-*]\s+/.test(line)
                const text = line.replace(/^#{1,4}\s+/, '').replace(/^\s*[-*]\s+/, '')
                return (
                  <Text
                    key={index}
                    style={{
                      fontSize: heading ? 14 : 13.5,
                      lineHeight: 20,
                      fontWeight: heading ? '600' : '400',
                      color: heading ? palette.ink : palette.ink2,
                      marginLeft: bullet ? 10 : 0,
                    }}
                  >
                    {bullet ? '• ' : ''}
                    {text}
                  </Text>
                )
              })}
              {previewLines.length > 6 ? <Mono className="text-[11px] text-ink-4">…</Mono> : null}
            </View>
            {onViewPlan ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View the full plan in the session panel"
                onPress={onViewPlan}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: palette.line,
                  backgroundColor: pressed ? palette.hover : palette.raised,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                })}
              >
                <Text className="text-[12.5px] font-semibold text-ink-2">View full plan</Text>
                <Text className="text-[12.5px] text-accent">→</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </View>
  )
}

/* ── Approval / question ────────────────────────────────────────────────────── */

function decisionLabel(decision: string): string {
  if (decision === 'allow') return 'Allowed'
  if (decision === 'deny') return 'Denied'
  return `Responded ${decision}`
}

function metaForValue(option: ApprovalOption) {
  const value = option.value.toLowerCase()
  if (option.kind === 'allow' && /always|don't ask|dont ask/.test(value)) return { always: true }
  if (option.kind === 'deny' && /always|never/.test(value)) return { always: true }
  return undefined
}

export function Approval({
  part,
  onRespond,
}: {
  part: ApprovalPart
  /** The id is read off `part`, so the callback only carries the decision. */
  onRespond: (decision: string, meta?: { always?: boolean }) => void
}) {
  const view = React.useMemo(
    () =>
      describeApproval(part.prompt, part.options, {
        optionData: part.optionData,
        multiSelect: part.multiSelect,
        allowsCustomText: part.allowsCustomText,
      }),
    [part],
  )
  const risky = /high|critical/i.test(part.riskLevel ?? '')
  const isMulti = Boolean(view.multiSelect)
  const [selected, setSelected] = React.useState<string[]>([])
  const [custom, setCustom] = React.useState('')
  // The one loud card: amber for "a human is blocking the run", red when the
  // request itself is dangerous. Every tint inside derives from the tone.
  const tone: Tone = risky ? 'danger' : 'wait'

  // Resolved cards collapse to one row, so the decision stays visible in the
  // transcript history rather than becoming a tall block of stale options.
  if (part.decision !== undefined) {
    const denied = part.decision === 'deny'
    return (
      <View
        accessible
        accessibilityLabel={`${decisionLabel(part.decision)}. ${part.customText ?? view.header ?? view.question}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.raised,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        {denied ? (
          <AlertTriangle size={13} color={palette.wait} />
        ) : (
          <Check size={13} color={palette.ok} strokeWidth={2.6} />
        )}
        <Text className="text-[12.5px] font-semibold text-ink">
          {decisionLabel(part.decision)}
        </Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Mono className="text-[11.5px] leading-[16px] text-ink-3" numberOfLines={1}>
            {part.customText ?? view.header ?? view.context ?? view.question}
          </Mono>
        </View>
      </View>
    )
  }

  const isPlan = Boolean(part.isPlan)
  const options: ApprovalOption[] =
    isPlan && view.options.length === 0
      ? [
          { value: 'approve', label: 'Approve plan', kind: 'allow' as const },
          { value: 'decline', label: 'Keep planning', kind: 'deny' as const },
          { value: 'suggest', label: 'Suggest changes', kind: 'other' as const },
        ]
      : view.options

  // A single-select `allow`/`deny` option is the common case, and it is the
  // one the user performs one-handed while walking. One tap.
  const instant = !isMulti && !isPlan && options.some((option) => option.kind === 'allow' || option.kind === 'deny')

  function submit(values: string[]) {
    if (values.length === 0) return
    if (isMulti) {
      onRespond(values.length === 1 ? values[0] : JSON.stringify(values))
      return
    }
    const option = options.find((candidate) => candidate.value === values[0])
    if (option) onRespond(option.value, metaForValue(option))
  }

  function choose(option: ApprovalOption) {
    if (instant) {
      void haptic(option.kind === 'deny' ? 'warn' : 'success')
      onRespond(option.value, metaForValue(option))
      return
    }
    setSelected((current) =>
      isMulti
        ? current.includes(option.value)
          ? current.filter((value) => value !== option.value)
          : [...current, option.value]
        : [option.value],
    )
  }

  return (
    <Card
      tone={tone}
      accessible={false}
      accessibilityRole="alert"
      accessibilityLabel="The agent is waiting for you"
      className="overflow-hidden"
    >
      {/* Header: the agent is asleep. That framing is the desktop's, and it is
          the one that makes the card legible — the user is not being asked to
          evaluate a form, they are being asked to wake something up. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Moon size={13} color={toneColor[tone]} />
        <Mono className="text-[10px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 1.1 }}>
          Agent sleeping
        </Mono>
        <View style={{ width: 1, height: 12, backgroundColor: palette.lineStrong }} />
        <StatusPill tone={tone} label={risky ? 'High risk' : 'Needs you'} size="sm" />
        <View style={{ flex: 1 }} />
      </View>

      {/* Context: the command, path or URL the request is about. First, because
          it is what you check before deciding. */}
      {view.context ? (
        <Well style={{ borderRadius: 0, flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 11 }}>
          <Mono className="text-[12px] leading-[18px] text-ink-4">›</Mono>
          <Mono className="flex-1 text-[12px] leading-[18px] text-ink-2">{view.context}</Mono>
        </Well>
      ) : null}

      {/* The question, in the agent's words. */}
      <View style={{ flexDirection: 'row', gap: 11, padding: 14, paddingBottom: 12 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.raised,
          }}
        >
          <Moon size={15} color={toneColor[tone]} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          {view.header ? (
            <Text className="text-[11px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.6 }}>
              {view.header}
            </Text>
          ) : null}
          <Text className="text-[14.5px] font-medium leading-[20px] text-ink" style={{ letterSpacing: -0.1 }}>
            {view.question}
          </Text>
          {isMulti ? (
            <View
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: radius.pill,
                backgroundColor: palette.raised,
              }}
            >
              <Text className="text-[11.5px] text-ink-3">select all that apply</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Options. Each is a full-width target with its own description in
          monospace — the description is agent-supplied text, often a shell
          fragment, and prose styling would misrepresent it. */}
      <View style={{ gap: 8, paddingHorizontal: 14, paddingBottom: 14 }}>
        {options.map((option, index) => {
          const active = selected.includes(option.value)
          const kindTone: Tone | null =
            option.kind === 'allow' ? 'ok' : option.kind === 'deny' ? 'danger' : null
          return (
            <Pressable
              key={option.value}
              accessibilityRole={isMulti ? 'checkbox' : 'radio'}
              accessibilityLabel={option.label}
              accessibilityHint={option.description}
              accessibilityState={{ selected: active, checked: isMulti ? active : undefined }}
              onPress={() => choose(option)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: active ? palette.accent : palette.line,
                backgroundColor: active ? palette.accentSoft : pressed ? palette.raised : palette.surface,
                paddingHorizontal: 13,
                paddingVertical: 12,
                minHeight: 48,
              })}
            >
              {/* A 16pt ring: the index while undecided, the accent once chosen. */}
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: isMulti ? 5 : 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: active ? palette.accent : palette.lineStrong,
                  backgroundColor: active ? palette.accent : 'transparent',
                }}
              >
                {active ? (
                  isMulti ? (
                    <Check size={10} color={palette.accentInk} strokeWidth={3.2} />
                  ) : (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: palette.accentInk,
                      }}
                    />
                  )
                ) : (
                  <Text style={{ color: palette.ink4, fontSize: 9.5, lineHeight: 11, fontWeight: '700' }}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-[14px] font-medium leading-[19px] text-ink" numberOfLines={2}>
                  {option.label}
                </Text>
                {option.description ? (
                  <Mono className="mt-1 text-[11.5px] leading-[16px] text-ink-3" numberOfLines={3}>
                    {option.description}
                  </Mono>
                ) : null}
              </View>
              {kindTone ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: radius.xs,
                    backgroundColor: toneSoft[kindTone],
                  }}
                >
                  <Text
                    style={{
                      color: toneColor[kindTone],
                      fontSize: 9.5,
                      fontWeight: '700',
                      letterSpacing: 0.5,
                    }}
                  >
                    {option.kind.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}

        {/* Plan approvals accept a free-text answer alongside the choices. */}
        {isPlan ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: palette.line,
              backgroundColor: palette.surface,
              paddingHorizontal: 12,
            }}
          >
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Or write an answer…"
              placeholderTextColor={palette.ink4}
              accessibilityLabel="Write an answer"
              autoCapitalize="sentences"
              className="flex-1 py-3 text-[14px] text-ink"
              style={{ minHeight: 48 }}
            />
            {custom.trim().length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send this answer instead"
                onPress={() => {
                  void haptic('success')
                  onRespond(custom.trim())
                }}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? palette.accentHover : palette.accent,
                })}
              >
                <Check size={16} color={palette.accentInk} strokeWidth={3} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Multi-select and plan approvals need a confirm: the answer is
            composed, not chosen, and one wrong tap here is a wrong turn. */}
        {instant ? null : (
          <View style={{ gap: 8, marginTop: 2 }}>
            {isMulti ? (
              <Text className="text-[12.5px] text-ink-3">
                {selected.length === 0
                  ? 'Pick at least one'
                  : `${selected.length} selected — ${options.length} options`}
              </Text>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              full
              label={isMulti ? `Confirm${selected.length ? ` (${selected.length})` : ''}` : 'Respond'}
              disabled={selected.length === 0}
              onPress={() => {
                void haptic('success')
                submit(selected)
              }}
            />
          </View>
        )}
      </View>
    </Card>
  )
}

/* ── A row that reports a non-blocking event ──────────────────────────────────────
 * Progress, search, commits, verification. Each one gets a shape that matches
 * what it is: a bar for progress, monospace for anything an agent passed to a
 * shell, a status dot and a word for verification. */

export function EventCard({
  icon,
  label,
  detail,
  meta,
  tone,
  children,
}: {
  icon?: React.ReactNode
  label: string
  detail?: string
  meta?: string
  tone?: string
  children?: React.ReactNode
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-[12px] leading-[16px] text-ink-2" numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Mono className="mt-0.5 text-[11px] leading-[15px] text-ink-3" numberOfLines={1}>
            {detail}
          </Mono>
        ) : null}
      </View>
      {children}
      {meta ? (
        <Text style={{ color: tone ?? palette.ink3, fontSize: 10.5, fontWeight: '600' }} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </View>
  )
}

export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={onPress}
      hitSlop={10}
      className="size-9 items-center justify-center rounded-md active:bg-raised"
    >
      <X size={17} color={palette.ink3} />
    </Pressable>
  )
}

export { ActivityIndicator, CopyButton }

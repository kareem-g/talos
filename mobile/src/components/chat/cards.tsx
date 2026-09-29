/**
 * Chat cards — the full-width blocks in an assistant turn.
 *
 * Ports of the desktop's `Plan`, `Approval` (which also renders AskUserQuestion
 * cards), `ErrorCard`, `TurnSummary` and `UsageMeter`. The approval card is the
 * most consequential: it is where a turn is unblocked, so it keeps the desktop's
 * structure — numbered options, per-option mono description, multi-select with an
 * explicit confirm, a free-text row for plan approvals, and a collapsed
 * outcome row once resolved.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { AlertTriangle, Check, ChevronDown, FileText, Moon, TextCursorInput } from 'lucide-react-native'

import { cn } from '@/lib/format'
import { describeApproval, type ApprovalOption } from '@/lib/approvals'
import type { ApprovalPart, ErrorPart, PlanPart, TurnSummaryPart, UsagePart } from '@/types/conversation'
import { Button, Mono, TextField } from '@app/components/ui'
import { palette } from '@app/design/tokens'

const DIM = palette.ink3

/* ── Usage meter ─────────────────────────────────────────────────────────── */

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
  return <Mono className="text-[10px]">{bits.join('  ')}</Mono>
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
    <View className="flex-row items-center gap-1.5">
      {failed ? <AlertTriangle size={10} color={palette.wait} /> : <Check size={10} color={palette.ok} />}
      {reason ? <Text className="text-[10.5px] text-ink-3">{reason}</Text> : null}
      {reason && stats.length ? <Text className="text-[10px] text-ink-3">·</Text> : null}
      {stats.length ? <Mono className="text-[10px]">{stats.join(' · ')}</Mono> : null}
    </View>
  )
}

/* ── Error ───────────────────────────────────────────────────────────────── */

export function ErrorCard({ part }: { part: ErrorPart }) {
  return (
    <View className="overflow-hidden rounded-xl border border-red-border bg-red-tint">
      <View className="flex-row items-start gap-3 px-4 pb-3 pt-3.5">
        <AlertTriangle size={14} color={palette.danger} />
        <View className="min-w-0 flex-1">
          <Text className="text-[12px] font-semibold text-red">Agent error</Text>
          <Mono className="mt-1 text-[11.5px] leading-5 text-ink-2">{part.message}</Mono>
        </View>
      </View>
    </View>
  )
}

/* ── Plan ────────────────────────────────────────────────────────────────── */

const STEP_MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '›',
  failed: '⚠',
  blocked: '⚠',
  pending: '○',
}

export function Plan({ part, onViewPlan }: { part: PlanPart; onViewPlan?: () => void }) {
  const [open, setOpen] = React.useState(true)
  const steps = part.entries?.length
    ? part.entries.map((entry) => ({ content: entry.content, status: entry.status ?? 'pending' }))
    : part.steps.map((content) => ({ content, status: 'pending' }))
  const done = steps.filter((step) => step.status === 'completed').length
  const body = part.text ?? ''
  const previewLines = body.split('\n').filter((line) => line.trim().length > 0)

  return (
    <View className="overflow-hidden rounded-2xl border border-line bg-inset">
      <Pressable
        onPress={() => setOpen((value) => !value)}
        className="w-full flex-row items-center gap-2 border-b border-line bg-surface px-4 py-2.5"
      >
        <FileText size={13} color={DIM} />
        <Mono className="text-[10px] font-medium uppercase tracking-[0.14em]">Plan</Mono>
        <Mono className="text-[10px]">
          {done}/{steps.length}
        </Mono>
        {part.status && part.status !== 'proposed' ? (
          <View
            className={cn(
              'rounded-chip border px-1.5 py-px',
              part.status === 'approved'
                ? 'border-green-border bg-green-tint'
                : part.status === 'declined'
                  ? 'border-red-border bg-red-tint'
                  : 'border-line bg-field',
            )}
          >
            <Mono className="text-[9px] uppercase">{part.status}</Mono>
          </View>
        ) : null}
        <View className="flex-1" />
        <ChevronDown size={13} color={DIM} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>

      {open ? (
        <>
          <View className="gap-0.5 px-2.5 pt-2">
            {steps.slice(0, 20).map((step, index) => {
              const isDone = step.status === 'completed'
              const isActive = step.status === 'in_progress'
              const isBad = step.status === 'failed' || step.status === 'blocked'
              return (
                <View
                  key={index}
                  className={cn('flex-row items-start gap-2 rounded-lg px-1.5 py-1', isActive && 'bg-hover-2')}
                >
                  <Text
                    className={cn(
                      'mt-0.5 shrink-0 text-[11px] leading-4',
                      isDone ? 'text-green' : isActive ? 'text-accent' : isBad ? 'text-red' : 'text-ink-3',
                    )}
                  >
                    {STEP_MARK[step.status] ?? '○'}
                  </Text>
                  <Text
                    className={cn(
                      'min-w-0 flex-1 text-[12px] leading-4',
                      isDone
                        ? 'text-ink-3 line-through'
                        : isActive
                          ? 'font-medium text-ink'
                          : 'text-ink-2',
                    )}
                  >
                    {index + 1}. {step.content}
                  </Text>
                </View>
              )
            })}
          </View>

          {previewLines.length > 0 ? (
            <View className="px-4 pb-3 pt-3">
              {part.title ? (
                <Text className="text-[15px] font-semibold leading-5 text-ink">{part.title}</Text>
              ) : null}
              <View className="mt-2 gap-1.5">
                {previewLines.slice(0, 6).map((line, index) => {
                  const heading = /^#{1,4}\s+/.test(line)
                  const bullet = /^\s*[-*]\s+/.test(line)
                  const text = line.replace(/^#{1,4}\s+/, '').replace(/^\s*[-*]\s+/, '')
                  return (
                    <Text
                      key={index}
                      className={cn(
                        'leading-5',
                        heading ? 'text-[13px] font-semibold text-ink' : 'text-[12.5px] text-ink-2',
                      )}
                    >
                      {bullet ? '• ' : ''}
                      {text}
                    </Text>
                  )
                })}
                {previewLines.length > 6 ? <Mono className="text-[10.5px]">…</Mono> : null}
              </View>
              {onViewPlan ? (
                <Pressable onPress={onViewPlan} className="mt-3 flex-row items-center gap-1.5 self-start rounded-lg border border-line bg-surface px-3 py-1.5">
                  <Text className="text-[11.5px] font-medium text-ink-2">View full plan</Text>
                  <Text className="text-[11.5px] text-ink-3">→</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

/* ── Approval / question ─────────────────────────────────────────────────── */

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
  onRespond: (requestId: string, decision: string, meta?: { always?: boolean }) => void
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

  // Resolved cards collapse to one row, so the decision stays visible in history.
  if (part.decision !== undefined) {
    const denied = part.decision === 'deny'
    return (
      <View className="flex-row items-center gap-2 rounded-xl border border-line bg-field px-3 py-2.5">
        {denied ? <AlertTriangle size={12} color={palette.wait} /> : <Check size={12} color={palette.ok} />}
        <Text className="text-[11.5px] font-medium text-ink">{decisionLabel(part.decision)}</Text>
        <Text className="text-[11px] text-ink-3">·</Text>
        <Mono className="min-w-0 flex-1 text-[11px]" numberOfLines={1}>
          {part.customText ?? view.header ?? view.context ?? view.question}
        </Mono>
      </View>
    )
  }

  const isPlan = Boolean(part.isPlan)
  const options: ApprovalOption[] = isPlan && view.options.length === 0
    ? [
        { value: 'approve', label: 'Approve plan', kind: 'allow' as const },
        { value: 'decline', label: 'Keep planning', kind: 'deny' as const },
        { value: 'suggest', label: 'Suggest changes', kind: 'other' as const },
      ]
    : view.options

  function submit() {
    if (isMulti) {
      const values = selected.length === 1 ? selected[0] : JSON.stringify(selected)
      onRespond(part.requestId, values)
      return
    }
    const option = options.find((candidate) => candidate.value === selected[0])
    if (option) onRespond(part.requestId, option.value, metaForValue(option))
  }

  const canSubmit = selected.length > 0

  return (
    <View
      className={cn(
        'overflow-hidden rounded-2xl border bg-inset',
        risky ? 'border-red-border' : 'border-line',
      )}
    >
      {/* Header */}
      <View className="flex-row items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <Moon size={14} color={DIM} />
        <Mono className="text-[10px] font-medium uppercase tracking-[0.14em]">Agent sleeping</Mono>
        <View className="h-2 w-px bg-line" />
        <View
          className={cn(
            'rounded-chip px-1.5 py-0.5',
            risky ? 'bg-red-tint' : 'bg-orange-tint',
          )}
        >
          <Mono className={cn('text-[10px] font-medium', risky ? 'text-red' : 'text-orange')}>
            {risky ? 'high risk' : 'needs you'}
          </Mono>
        </View>
      </View>

      {/* Context trace (the command/path the prompt is about) */}
      {view.context ? (
        <View className="border-b border-line bg-canvas px-4 py-3">
          <View className="flex-row items-start gap-2">
            <Text className="mt-0.5 text-[10px] leading-4 text-ink-3">›</Text>
            <Mono className="min-w-0 flex-1 text-[11.5px] leading-5 text-ink-2">{view.context}</Mono>
          </View>
        </View>
      ) : null}

      {/* Question */}
      <View className="flex-row items-start gap-3 px-4 pb-3 pt-4">
        <View
          className={cn(
            'size-8 shrink-0 items-center justify-center rounded-xl',
            risky ? 'bg-red-tint' : 'bg-field',
          )}
        >
          <Moon size={16} color={risky ? palette.danger : DIM} />
        </View>
        <View className="min-w-0 flex-1">
          {view.header ? (
            <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{view.header}</Text>
          ) : null}
          <Text className="text-[13px] font-medium leading-5 text-ink">{view.question}</Text>
          {isMulti ? (
            <View className="mt-1.5 self-start rounded-chip bg-surface px-2 py-0.5">
              <Mono className="text-[11px]">select all that apply</Mono>
            </View>
          ) : null}
        </View>
      </View>

      {/* Options */}
      <View className="gap-2 border-t border-line bg-surface px-4 py-3">
        {options.map((option, index) => {
          const active = selected.includes(option.value)
          return (
            <Pressable
              key={option.value}
              onPress={() =>
                setSelected((current) =>
                  isMulti
                    ? current.includes(option.value)
                      ? current.filter((value) => value !== option.value)
                      : [...current, option.value]
                    : [option.value],
                )
              }
              className={cn(
                'w-full flex-row items-center gap-3 rounded-xl border px-4 py-3',
                active ? 'border-accent bg-accent-tint' : 'border-line bg-canvas',
              )}
            >
              <View
                className={cn(
                  'size-5 shrink-0 items-center justify-center rounded-full border',
                  active ? 'border-accent bg-accent' : 'border-line-strong',
                )}
              >
                {active ? (
                  isMulti ? (
                    <Text className="text-[10px] font-bold text-accent-ink">✓</Text>
                  ) : (
                    <Text className="text-[10px] font-bold text-accent-ink">{index + 1}</Text>
                  )
                ) : (
                  <Text className="text-[10px] text-ink-3">{index + 1}</Text>
                )}
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] font-medium text-ink">{option.label}</Text>
                {option.description ? (
                  <Mono className="mt-0.5 text-[11px] leading-4">{option.description}</Mono>
                ) : null}
              </View>
              {!isMulti && option.kind !== 'other' ? (
                <View className="shrink-0 rounded-chip bg-field px-2 py-0.5">
                  <Mono className="text-[10px]">{option.kind}</Mono>
                </View>
              ) : null}
            </Pressable>
          )
        })}

        {/* Plan approvals accept a free-text answer alongside the choices. */}
        {isPlan ? (
          <View className="flex-row items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-2.5">
            <TextCursorInput size={14} color={DIM} />
            <View className="min-w-0 flex-1">
              <TextField
                value={custom}
                onChangeText={setCustom}
                placeholder="Enter your answer…"
                className="text-[12.5px]"
              />
            </View>
          </View>
        ) : null}

        <View className="mt-1 flex-row items-center gap-2">
          {isMulti ? (
            <Mono className="min-w-0 flex-1 text-[11px]">
              {selected.length} selected
            </Mono>
          ) : (
            <View className="flex-1" />
          )}
          {isPlan && custom.trim() ? (
            <Button variant="surface" label="Send feedback" onPress={() => onRespond(part.requestId, custom.trim())} />
          ) : null}
          <Button
            variant="primary"
            label={isMulti ? 'Confirm' : 'Respond'}
            disabled={!canSubmit}
            onPress={submit}
          />
        </View>
      </View>
    </View>
  )
}

/**
 * ConfigChips and the context ring — the session's live dials.
 *
 * QAI SIGNAL DECK: the desktop's composer row / narrow "Model & permissions"
 * layer as a horizontal dial row in the session header's run bar, one tap
 * from the transcript. Socket `set_config` like the desktop; dimensions are
 * data (a new capability renders with no release). A live dimension carries
 * an accent dot; one that only applies on the next run says NEXT — the
 * difference is a fact, not a detail.
 */

import * as React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

import type { ConfigOption } from '@/types/provider'
import { socket } from '@app/lib/socket'
import { getConversation, useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { PickerSheet, Sheet } from '@app/components/Sheet'
import { Divider, Eyebrow, KeyValue, ProgressBar, haptic } from '@app/components/ui'

/** Dimensions that are not meaningful as a chip. */
const HIDDEN_OPTIONS = new Set(['worktree', 'cwd', 'command'])

/** The chip row. Horizontally scrollable, never wrapped. */
export function ConfigChips({ sessionId }: { sessionId: string }) {
  const config = useStore((state) => state.configs[sessionId])
  const [openId, setOpenId] = React.useState<string | null>(null)

  const options = (config?.options ?? []).filter(
    (option) => !HIDDEN_OPTIONS.has(option.id) && option.mutability !== 'start_only',
  )

  if (options.length === 0) {
    return (
      <Text className="py-1 text-[11px] text-ink-4">
        no live settings reported
      </Text>
    )
  }

  return (
    <>
      {options.map((option) => (
        <OptionChip key={option.id} option={option} onOpen={() => setOpenId(option.id)} />
      ))}

      <OptionSheet
        sessionId={sessionId}
        option={options.find((candidate) => candidate.id === openId) ?? null}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}

function OptionChip({ option, onOpen }: { option: ConfigOption; onOpen: () => void }) {
  const current = option.choices.find((choice) => choice.value === option.currentValue)
  const label = current?.name || option.currentValue || option.name
  const live = option.mutability === 'live'

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${option.name}: ${label}`}
      accessibilityHint="Opens the list of values"
      onPress={() => {
        void haptic('light')
        onOpen()
      }}
      style={({ pressed }) => ({
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: pressed ? palette.hover : palette.surface,
        paddingLeft: 9,
        paddingRight: 7,
      })}
    >
      <Text className="text-[10.5px] text-ink-3" numberOfLines={1}>
        {option.name}
      </Text>
      <Text className="max-w-[120px] text-[11.5px] font-semibold text-ink-2" numberOfLines={1}>
        {label}
      </Text>
      {/* A live dimension gets an accent dot; one that only applies on the
          next run does not, because the difference matters and the word
          "next_run" is not somewhere to find out. */}
      {live ? (
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.accent }} />
      ) : (
        <View
          style={{
            paddingHorizontal: 4,
            paddingVertical: 1,
            borderRadius: radius.xs,
            backgroundColor: palette.hover,
          }}
        >
          <Text
            style={{
              color: palette.ink3,
              fontSize: 8.5,
              fontWeight: '700',
              letterSpacing: 0.5,
              fontVariant: ['tabular-nums'],
            }}
          >
            NEXT
          </Text>
        </View>
      )}
    </Pressable>
  )
}

function OptionSheet({
  sessionId,
  option,
  onClose,
}: {
  sessionId: string
  option: ConfigOption | null
  onClose: () => void
}) {
  function choose(value: string) {
    if (!option) return
    socket.setConfig(sessionId, option.id, value)
    void haptic('success')
    onClose()
  }

  return (
    <PickerSheet
      open={option !== null}
      onClose={onClose}
      title={option?.name ?? ''}
      subtitle={
        option?.mutability === 'live'
          ? 'Applies immediately'
          : 'Applies to the next run of this session'
      }
      value={option?.currentValue}
      onSelect={choose}
      options={(option?.choices ?? []).map((choice) => ({
        value: choice.value,
        label: choice.name || choice.value,
        hint: choice.description,
      }))}
      allowsCustomValue={option?.allowsCustomValue}
      customPlaceholder="Any value this agent accepts"
      emptyLabel="This agent reported no options for this setting."
    />
  )
}

/* ── Context ring ──────────────────────────────────────────────────────────────
 * The desktop's context-usage ring, unchanged in meaning: the newest reported
 * turn against the configured window, amber past 60% and red past 85%. Tapping
 * opens the breakdown as a sheet — the ring lives in a scrolling run bar, where
 * an anchored popover would be clipped, and the breakdown is a read-and-dismiss
 * surface anyway. */

const RING_CIRCUMFERENCE = (r: number) => 2 * Math.PI * r

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

interface Usage {
  input: number
  output: number
  cached: number
  cost: number
  window?: number
}

export function ContextRing({
  sessionId,
  working,
  size = 30,
}: {
  sessionId: string
  working: boolean
  /** Outer box edge in pt. The ring itself is ~60% of it. */
  size?: number
}) {
  // The revision counter is what re-derives usage as turns stream in.
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const options = useStore((state) => state.configs[sessionId]?.options)
  const [open, setOpen] = React.useState(false)

  const usage = React.useMemo<Usage | undefined>(() => {
    const messages = getConversation(sessionId).messages
    let found:
      | { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number }
      | undefined
    for (let index = messages.length - 1; index >= 0 && !found; index--) {
      const message = messages[index]
      if (message.role !== 'assistant') continue
      found = message.parts.find(
        (part): part is Extract<typeof part, { kind: 'usage' }> => part.kind === 'usage',
      )
    }
    if (!found || ((found.inputTokens ?? 0) <= 0 && (found.outputTokens ?? 0) <= 0)) return undefined
    const windowTokens = Number.parseInt(
      options?.find((option) => option.id === 'context_window')?.currentValue ?? '',
      10,
    )
    return {
      input: found.inputTokens ?? 0,
      output: found.outputTokens ?? 0,
      cached: found.cacheReadTokens ?? 0,
      cost: found.costUsd ?? 0,
      window: Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : undefined,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, options, revision])

  if (working) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={palette.ink3} />
      </View>
    )
  }
  if (!usage) return <View style={{ width: size * 0.6, height: size }} />

  const pct = usage.window ? Math.min(100, (usage.input / usage.window) * 100) : 0
  const color = pct > 85 ? palette.danger : pct > 60 ? palette.wait : palette.ok
  const ringRadius = size * 0.29
  const box = size * 0.62
  const circumference = RING_CIRCUMFERENCE(ringRadius)

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Context window, ${usage.window ? `${Math.round(pct)} percent used` : 'unknown size'}`}
        accessibilityHint="Shows the context breakdown"
        onPress={() => {
          void haptic('light')
          setOpen(true)
        }}
        style={({ pressed }) => ({
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.xs,
          backgroundColor: pressed ? palette.hover : 'transparent',
        })}
      >
        <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
          <Circle
            cx={box / 2}
            cy={box / 2}
            r={ringRadius}
            stroke={palette.lineStrong}
            strokeWidth={2}
            fill="none"
          />
          {usage.window ? (
            <Circle
              cx={box / 2}
              cy={box / 2}
              r={ringRadius}
              stroke={color}
              strokeWidth={2}
              fill="none"
              strokeDasharray={`${circumference}`}
              strokeDashoffset={circumference * (1 - pct / 100)}
              rotation={-90}
              origin={`${box / 2}, ${box / 2}`}
            />
          ) : null}
        </Svg>
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} title="Context window" eyebrow="Last reported turn">
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={{ color, fontSize: 20, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] }}>
              {formatTokens(usage.input)}
              {usage.window ? ` / ${formatTokens(usage.window)}` : ''}
            </Text>
            {usage.window ? (
              <Text style={{ color: palette.ink3, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {Math.round(pct)}%
              </Text>
            ) : null}
          </View>
          {usage.window ? (
            <ProgressBar value={pct / 100} tone={pct > 85 ? 'danger' : pct > 60 ? 'wait' : 'ok'} />
          ) : null}

          <Divider />

          <View style={{ gap: 4 }}>
            <Eyebrow>Breakdown</Eyebrow>
            <KeyValue label="Context sent" value={formatTokens(usage.input)} />
            <KeyValue label="Last output" value={formatTokens(usage.output)} />
            <KeyValue label="Cache reads" value={formatTokens(usage.cached)} />
            {usage.cost > 0 ? <KeyValue label="Turn cost" value={`$${usage.cost.toFixed(4)}`} /> : null}
          </View>

          {pct >= 90 ? (
            <View
              className="rounded-md bg-danger-soft"
              style={{ paddingHorizontal: 10, paddingVertical: 8 }}
            >
              <Text className="text-[12px] leading-[17px] text-danger">
                The window is nearly full. Older messages are compressed automatically to continue.
              </Text>
            </View>
          ) : pct >= 60 ? (
            <Text className="text-[12px] leading-[17px] text-wait">
              Auto-compression will activate when the window fills.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </>
  )
}

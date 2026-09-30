/**
 * ConfigChips and the context ring — the session's live configuration.
 *
 * The desktop keeps these in the composer's control row on wide screens and
 * moves them into a "Model & permissions" layer on narrow ones. Mobile has
 * only the narrow case, so they live in the composer's dock, scrolling
 * horizontally, where they are one tap from the field you are typing into.
 *
 * Changes go over the socket (`set_config`), the same command surface the
 * desktop uses — the mobile HTTP API has no config PATCH and the daemon routes
 * both WebSocket paths into one handler.
 *
 * DIMENSIONS ARE DATA
 * -------------------
 * The desktop treats a config dimension as data: a new one renders with no code
 * change, because `ConfigOption[]` is what the agent reports. This does too.
 * That is why there is no `ModelChip` and `PermissionChip` and `ThoughtChip`
 * component here, and why adding a new capability to an agent shows up on the
 * phone with no mobile release.
 */

import * as React from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

import type { ConfigOption } from '@/types/provider'
import { socket } from '@app/lib/socket'
import { getConversation, useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { PickerSheet } from '@app/components/Sheet'
import { haptic, KeyValue, Popover, ProgressBar } from '@app/components/ui'

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
      <Text className="py-1 text-[11.5px] text-ink-4">
        This agent exposes no live settings
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
        minHeight: 30,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: pressed ? palette.hover : palette.raised,
        paddingLeft: 10,
        paddingRight: 7,
      })}
    >
      <Text className="text-[11px] text-ink-3" numberOfLines={1}>
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
    haptic('success')
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
 * opens the same breakdown, in a popover rather than a sheet, because this is a
 * glance-and-leave read and a sheet would cover the transcript you were reading
 * to decide whether to keep going. */

const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

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

export function ContextRing({ sessionId, working }: { sessionId: string; working: boolean }) {
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
      <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={palette.ink3} />
      </View>
    )
  }
  if (!usage) return <View style={{ width: 30, height: 30 }} />

  const pct = usage.window ? Math.min(100, (usage.input / usage.window) * 100) : 0
  const color = pct > 85 ? palette.danger : pct > 60 ? palette.wait : palette.ok

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
          width: 30,
          height: 30,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: pressed ? palette.hover : 'transparent',
        })}
      >
        <Svg width={17} height={17} viewBox="0 0 14 14">
          <Circle cx={7} cy={7} r={RING_RADIUS} stroke={palette.lineStrong} strokeWidth={2} fill="none" />
          {usage.window ? (
            <Circle
              cx={7}
              cy={7}
              r={RING_RADIUS}
              stroke={color}
              strokeWidth={2}
              fill="none"
              strokeDasharray={`${RING_CIRCUMFERENCE}`}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct / 100)}
              rotation={-90}
              origin={`${7}, ${7}`}
            />
          ) : null}
        </Svg>
      </Pressable>

      {open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the context breakdown"
          onPress={() => setOpen(false)}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, zIndex: 30 }}
        >
          <View style={{ flex: 1 }} />
        </Pressable>
      ) : null}

      {open ? (
        <View
          style={{
            position: 'absolute',
            right: 8,
            bottom: 44,
            width: 262,
            zIndex: 31,
          }}
        >
          <ContextPopover usage={usage} pct={pct} color={color} onClose={() => setOpen(false)} />
        </View>
      ) : null}
    </>
  )
}

function ContextPopover({
  usage,
  pct,
  color,
  onClose,
}: {
  usage: Usage
  pct: number
  color: string
  onClose: () => void
}) {
  return (
    <Popover>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text className="text-[13px] font-semibold text-ink">Context windows</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={10}
          className="size-7 items-center justify-center rounded-pill active:bg-hover"
        >
          <Text style={{ color: palette.ink3, fontSize: 15, fontWeight: '600' }}>×</Text>
        </Pressable>
      </View>

      <View style={{ gap: 6, marginTop: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={{ color: color, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {formatTokens(usage.input)}
            {usage.window ? ` / ${formatTokens(usage.window)}` : ''}
          </Text>
          {usage.window ? (
            <Text style={{ color: palette.ink3, fontSize: 12, fontVariant: ['tabular-nums'] }}>
              {Math.round(pct)}%
            </Text>
          ) : null}
        </View>
        {usage.window ? <ProgressBar value={pct / 100} tone={pct > 85 ? 'danger' : pct > 60 ? 'wait' : 'ok'} /> : null}
      </View>

      <View style={{ height: 1, backgroundColor: palette.line, marginTop: 10, marginBottom: 8 }} />

      <View style={{ gap: 4 }}>
        <KeyValue label="Context sent" value={formatTokens(usage.input)} />
        <KeyValue label="Last output" value={formatTokens(usage.output)} />
        <KeyValue label="Cache reads" value={formatTokens(usage.cached)} />
        {usage.cost > 0 ? <KeyValue label="Cost" value={`$${usage.cost.toFixed(4)}`} /> : null}
      </View>

      {pct >= 90 ? (
        <View
          className="rounded-sm bg-danger-soft"
          style={{ paddingHorizontal: 9, paddingVertical: 7, marginTop: 8 }}
        >
          <Text className="text-[11.5px] leading-[16px] text-danger">
            The window is nearly full. Older messages are compressed automatically to continue.
          </Text>
        </View>
      ) : pct >= 60 ? (
        <Text className="mt-2 text-[11.5px] leading-[16px] text-wait">
          Auto-compression will activate when the window fills.
        </Text>
      ) : null}
    </Popover>
  )
}

export { ScrollView }

/**
 * ConfigChips — the session's live configuration, for the header row.
 *
 * The desktop keeps these in the composer's control row on wide screens and moves
 * them into a "Model & permissions" layer on narrow ones. On the phone they live
 * in the header, beside the pane toggles, so the run's settings are visible while
 * the transcript scrolls and the composer stays purely about typing.
 *
 * Changes go over the socket (`set_config`), which is the same command surface the
 * desktop uses — the mobile HTTP API has no config PATCH, and the daemon routes
 * both WebSocket paths into one handler.
 */

import * as React from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ChevronDown, X } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'

import { cn } from '@/lib/format'
import type { ConfigOption } from '@/types/provider'
import { socket } from '@app/lib/socket'
import { getConversation, useStore } from '@app/store'
import { Button, Mono } from '@app/components/ui'
import { GlassSurface } from '@app/components/Glass'

/** Dimensions that are not meaningful as a chip. */
const HIDDEN_OPTIONS = new Set(['worktree', 'cwd', 'command'])

export function ConfigChips({ sessionId }: { sessionId: string }) {
  const config = useStore((state) => state.configs[sessionId])
  const [openId, setOpenId] = React.useState<string | null>(null)

  const options = (config?.options ?? []).filter(
    (option) => !HIDDEN_OPTIONS.has(option.id) && option.mutability !== 'start_only',
  )

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row items-center gap-1.5 px-3 pb-2"
      >
        {options.map((option) => (
          <OptionChip key={option.id} option={option} onOpen={() => setOpenId(option.id)} />
        ))}
        {options.length === 0 ? (
          <Mono className="text-[10.5px]">No live options for this session</Mono>
        ) : null}
      </ScrollView>

      <OptionSheet sessionId={sessionId} options={options} openId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function OptionChip({ option, onOpen }: { option: ConfigOption; onOpen: () => void }) {
  const current = option.choices.find((choice) => choice.value === option.currentValue)
  const label = current?.name || option.currentValue || option.name
  return (
    <Pressable
      onPress={onOpen}
      className="min-h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-surface px-2"
    >
      <Text className="text-[11px] text-ink-3">{option.name}</Text>
      <Text className="max-w-[110px] text-[11px] font-medium text-ink-2" numberOfLines={1}>
        {label}
      </Text>
      <ChevronDown size={10} color="#7e7e86" />
    </Pressable>
  )
}

/** The native stand-in for the desktop's anchored `DropdownList`. */
function OptionSheet({
  sessionId,
  options,
  openId,
  onClose,
}: {
  sessionId: string
  options: ConfigOption[]
  openId: string | null
  onClose: () => void
}) {
  const option = options.find((candidate) => candidate.id === openId) ?? null
  const [custom, setCustom] = React.useState('')

  React.useEffect(() => setCustom(''), [openId])

  function choose(value: string) {
    if (!option) return
    socket.setConfig(sessionId, option.id, value)
    onClose()
  }

  return (
    <Modal visible={option !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/65" onPress={onClose}>
        <Pressable className="max-h-[80%] overflow-hidden rounded-t-2xl border-t border-line bg-canvas" onPress={() => {}}>
          <GlassSurface radius={0} className="border-b border-line">
            <View className="flex-row items-center justify-between px-3.5 py-3 pt-12">
              <Text className="text-[13px] font-medium text-ink">{option?.name ?? ''}</Text>
              <Pressable onPress={onClose} accessibilityLabel="Close" className="size-9 items-center justify-center rounded-full active:bg-hover-2">
                <X size={16} color="#b0b0b6" />
              </Pressable>
            </View>
          </GlassSurface>
          <ScrollView contentContainerClassName="p-1.5">
            {option?.choices.map((choice) => {
              const active = choice.value === option.currentValue
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => choose(choice.value)}
                  className={cn('min-h-11 flex-row items-center gap-2 rounded-control px-2.5', active && 'bg-hover')}
                >
                  <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                    {choice.name || choice.value}
                  </Text>
                  {active ? <View className="size-1.5 rounded-full bg-green" /> : null}
                </Pressable>
              )
            })}
            {option?.allowsCustomValue ? (
              <View className="flex-row items-center gap-2 px-2.5 py-2">
                <TextInput
                  value={custom}
                  onChangeText={setCustom}
                  placeholder="Custom value…"
                  placeholderTextColor="#7e7e86"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-h-10 flex-1 rounded-lg border border-line bg-field px-2.5 text-[12.5px] text-ink"
                />
                <Button
                  variant="surface"
                  label="Use"
                  disabled={custom.trim().length === 0}
                  onPress={() => choose(custom.trim())}
                />
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/* ── Context ring ────────────────────────────────────────────────────────── */

const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

/**
 * The desktop's context-usage ring: the newest reported turn against the
 * configured window, amber past 60% and red past 85%. Tapping opens the same
 * breakdown the desktop shows in its popover.
 */
export function ContextRing({ sessionId, working }: { sessionId: string; working: boolean }) {
  // The revision counter is what re-derives usage as turns stream in.
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const options = useStore((state) => state.configs[sessionId]?.options)
  const [open, setOpen] = React.useState(false)

  const usage = React.useMemo(() => {
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
      <View className="size-6 items-center justify-center">
        <ActivityIndicator size="small" color="#b0b0b6" />
      </View>
    )
  }
  if (!usage) return <View className="size-6" />

  const pct = usage.window ? Math.min(100, (usage.input / usage.window) * 100) : 0
  const color = pct > 85 ? '#f85149' : pct > 60 ? '#db6d28' : '#57ab5a'

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Context window"
        className="size-8 items-center justify-center rounded-full active:bg-hover-2"
      >
        <Svg width={16} height={16} viewBox="0 0 14 14">
          <Circle cx={7} cy={7} r={RING_RADIUS} stroke="#34343a" strokeWidth={2} fill="none" />
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

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/65" onPress={() => setOpen(false)}>
          <Pressable className="overflow-hidden rounded-t-2xl border-t border-line bg-canvas p-4 pt-12" onPress={() => {}}>
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] font-medium text-ink">Context window</Text>
              <Mono className="text-[11px]">
                {formatTokens(usage.input)}
                {usage.window ? ` / ${formatTokens(usage.window)} (${Math.round(pct)}%)` : ' sent'}
              </Mono>
            </View>
            {usage.window ? (
              <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-field">
                <View
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }}
                />
              </View>
            ) : null}
            <View className="mt-3 gap-1.5">
              <UsageRow label="Context sent" value={formatTokens(usage.input)} />
              <UsageRow label="Last output" value={formatTokens(usage.output)} />
              <UsageRow label="Cache reads" value={formatTokens(usage.cached)} />
              {usage.cost > 0 ? <UsageRow label="Cost" value={`$${usage.cost.toFixed(4)}`} /> : null}
            </View>
            {pct >= 90 ? (
              <Text className="mt-3 text-[11px] leading-4 text-orange">
                The window is nearly full; older messages are compressed automatically.
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-1.5">
        <View className="size-1.5 rounded-full bg-accent" />
        <Text className="text-[11.5px] text-ink-2">{label}</Text>
      </View>
      <Mono className="text-[11px] text-ink">{value}</Mono>
    </View>
  )
}

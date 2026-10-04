/**
 * Timeline — the conversation: your turns as blue bubbles, the agent's prose
 * at reading size, consecutive tool calls folded into one run card, plan and
 * approval as interactive cards, and the quiet mono rows for usage, turn
 * summaries, files and subagents. Engine bookkeeping narrated as a sentence
 * ("Model changed to fable") renders as a quiet row, not a shout.
 */

import * as React from 'react'
import { Animated, Pressable, ScrollView, TextInput, View } from 'react-native'
import { cn, formatDuration } from '@/lib/format'
import type { Conversation, Message, MessagePart } from '@/types/conversation'
import { useStore } from '@/store'
import { color } from '../design/tokens'
import { MONO, W_SEMI } from '../design/fonts'
import { Alert, Check, ChevronDown, List } from '../design/icons'
import { Dot, Sheet, Text, Tap, haptic } from '../ui'
import { Prose } from './Prose'
import { formatTokens } from './context'
import { TokenText } from './tokens'

function duration(ms?: number): string {
  if (!ms || ms <= 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function short(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function Spinner({ size = 14 }: { size?: number }) {
  const spin = React.useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [spin])
  const angle = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <Animated.View
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color.accent, borderTopColor: 'transparent', transform: [{ rotate: angle }] }}
    />
  )
}

/* ── Quiet row — the small mono surfaces ──────────────────────────────────── */

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <View className="mx-[18px] my-1 flex-row items-center gap-2 rounded-[10px] px-3 py-[7px]" style={{ backgroundColor: color.wash }}>
      {children}
    </View>
  )
}

/* ── Tool run card ────────────────────────────────────────────────────────── */

function Step({ part }: { part: MessagePart }) {
  if (part.kind !== 'tool' && part.kind !== 'command') return null
  const running = part.status === 'running'
  const failed = part.status === 'failed'
  const name = part.kind === 'command' ? part.command : part.name
  const detail = part.kind === 'command' ? (part.output ?? '') : (part.input ?? '')
  return (
    <View>
      <View className="h-[34px] w-full flex-row items-center gap-[9px] px-3">
        {running ? <Spinner size={13} /> : <View className="size-[7px] rounded-full" style={{ backgroundColor: failed ? color.red : color.green }} />}
        <Text className="min-w-0 flex-1 text-[12px] text-ink" style={{ fontFamily: MONO }} numberOfLines={1}>
          {name}
        </Text>
        {part.durationMs ? (
          <Text className="shrink-0 text-[10.5px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
            {duration(part.durationMs)}
          </Text>
        ) : null}
      </View>
      {detail && detail.length < 300 ? (
        <Text className="pb-1 pl-[23px] pr-2 text-[10.5px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={2}>
          {detail.replace(/\s+/g, ' ').trim()}
        </Text>
      ) : null}
      {part.kind === 'command' && part.output && part.output.length >= 300 ? (
        <View className="mb-1 ml-4 mr-2 overflow-hidden rounded-[10px] bg-plate px-2 py-1.5">
          <Text className="text-[10.5px] leading-[16px] text-term-fg" style={{ fontFamily: MONO }} numberOfLines={6}>
            {part.output}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function RunCard({ parts }: { parts: Array<Extract<MessagePart, { kind: 'tool' | 'command' }>> }) {
  const detail = useStore((s) => s.timelineDetail)
  const [expanded, setExpanded] = React.useState(false)
  const running = parts.some((part) => part.status === 'running')
  const failed = parts.filter((part) => part.status === 'failed').length
  const totalMs = parts.reduce((sum, part) => sum + (part.durationMs ?? 0), 0)
  const showAll = detail === 'detailed' || expanded || running

  return (
    <View className="mx-[18px] my-1.5 overflow-hidden rounded-[14px] bg-surface">
      {showAll ? (
        <View className="flex-col p-1">
          {parts.map((part) => (
            <Step key={part.toolId} part={part} />
          ))}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={showAll ? 'Hide steps' : 'Show steps'}
        onPress={() => {
          void haptic('light')
          setExpanded((value) => !value)
        }}
        className="h-[42px] w-full flex-row items-center gap-2 border-t border-line px-3.5"
        style={{ backgroundColor: color.wash }}
      >
        <View className="size-[6px] rounded-full" style={{ backgroundColor: running ? color.accent : failed > 0 ? color.red : color.green }} />
        <Text className="flex-1 text-[13px] font-medium text-ink-2">
          {running ? 'Working…' : failed > 0 ? `Ran into a problem${failed > 1 ? ` · ${failed}` : ''}` : `Used ${parts.length} tool${parts.length === 1 ? '' : 's'}`}
        </Text>
        {totalMs > 0 ? (
          <Text className="text-[11px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
            {duration(totalMs)}
          </Text>
        ) : null}
        <ChevronDown size={14} color={color.ink3} />
      </Pressable>
    </View>
  )
}

/* ── Plan card ────────────────────────────────────────────────────────────── */

function PlanCard({ part, onRespond }: { part: Extract<MessagePart, { kind: 'plan' }>; onRespond?: (requestId: string, decision: string) => void }) {
  const entries = (part.entries ?? part.steps.map((step) => ({ content: step }))) as Array<{ content: string; status?: string }>
  const done = entries.filter((entry) => entry.status === 'completed').length
  const proposed = part.status === 'proposed'
  return (
    <View className="mx-[18px] my-2 overflow-hidden rounded-[16px] bg-surface">
      <View className="flex-row items-center gap-2 border-b border-line px-4 py-3">
        <Text className="min-w-0 flex-1 text-[14.5px] font-semibold text-ink" weight={W_SEMI}>
          {part.title ?? 'Plan'}
        </Text>
        {part.status ? (
          <View className={cn('h-[19px] justify-center rounded-full px-2', proposed ? 'bg-orange-tint' : 'bg-field')}>
            <Text className={cn('text-[10px] font-semibold uppercase', proposed ? 'text-orange' : 'text-ink-2')} style={{ fontFamily: MONO, letterSpacing: 0.6 }}>
              {part.status}
            </Text>
          </View>
        ) : (
          <View className="h-[22px] justify-center rounded-full bg-field px-2">
            <Text className="text-[10px] font-medium text-ink-2" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
              {done}/{entries.length}
            </Text>
          </View>
        )}
      </View>
      <View className="gap-1 px-4 py-2.5">
        {entries.map((entry, index) => {
          const status = entry.status ?? 'pending'
          return (
            <View key={index} className="flex-row items-start gap-2.5 py-1.5">
              <View className="mt-px">
                {status === 'completed' ? (
                  <View className="size-[18px] items-center justify-center rounded-full bg-green-tint">
                    <Check size={11} color={color.green} stroke={2.6} />
                  </View>
                ) : status === 'in_progress' ? (
                  <View className="size-[18px] items-center justify-center">
                    <Spinner size={13} />
                  </View>
                ) : (
                  <View className="size-[18px] rounded-full border-[1.5px] border-edge" />
                )}
              </View>
              <Text className={cn('min-w-0 flex-1 text-[13.5px] leading-[20px]', status === 'completed' ? 'text-ink-3' : 'text-ink')} numberOfLines={3}>
                {entry.content}
              </Text>
            </View>
          )
        })}
      </View>
      {proposed && onRespond ? (
        <View className="flex-row items-center justify-end gap-2.5 border-t border-line px-4 py-3">
          <Tap
            accessibilityRole="button"
            onPress={() => {
              void haptic('light')
              onRespond('plan', 'decline')
            }}
            className="h-10 items-center justify-center rounded-[12px] bg-raised px-4"
          >
            <Text className="text-[15px] font-semibold text-ink" weight={W_SEMI}>
              Decline
            </Text>
          </Tap>
          <Tap
            accessibilityRole="button"
            onPress={() => {
              void haptic('medium')
              onRespond('plan', 'approve')
            }}
            className="h-10 items-center justify-center rounded-[12px] bg-accent px-4"
          >
            <Text className="text-[15px] font-semibold text-accent-ink" weight={W_SEMI}>
              Approve Plan
            </Text>
          </Tap>
        </View>
      ) : null}
    </View>
  )
}

/* ── Approval card — options, multi-select, custom text ───────────────────── */

type Respond = (requestId: string, decision: string, meta?: { customText?: string; always?: boolean }) => void

function ApprovalCard({ part, onRespond }: { part: Extract<MessagePart, { kind: 'approval' }>; onRespond: Respond }) {
  const resolved = part.decision !== undefined
  const [selected, setSelected] = React.useState<string[]>([])
  const [custom, setCustom] = React.useState('')
  const [always, setAlways] = React.useState(false)
  const multi = !!part.multiSelect
  const risky = (part.riskLevel ?? '').toLowerCase() === 'high'

  if (resolved) {
    return (
      <View className="mx-[18px] my-1.5 flex-row items-center gap-2.5 rounded-[12px] bg-surface px-4 py-3">
        <Check size={13} color={color.green} />
        <Text className="min-w-0 flex-1 text-[11.5px] text-ink-2" style={{ fontFamily: MONO }} numberOfLines={1}>
          {part.prompt}
        </Text>
        <Text className="shrink-0 text-[11px] text-ink-3" style={{ fontFamily: MONO }}>
          {part.decision}
        </Text>
      </View>
    )
  }

  const options: Array<{ value: string; label: string; description?: string }> = part.optionData?.length
    ? part.optionData.map((option) => ({ value: option.value, label: option.label ?? option.value, description: option.description }))
    : part.options.map((value) => ({ value, label: value }))

  function submit() {
    void haptic('medium')
    onRespond(part.requestId, multi ? selected.join(',') : (selected[0] ?? ''), {
      customText: custom.trim() || undefined,
      always: always || undefined,
    })
  }

  return (
    <View
      className="mx-[18px] my-2 overflow-hidden rounded-[16px]"
      style={{
        backgroundColor: risky ? color.redCard : color.card,
        borderWidth: 0.5,
        borderColor: risky ? color.redEdge : color.line,
      }}
    >
      <View className="px-4 pb-1 pt-3.5">
        <View className="flex-row items-center gap-2">
          <View className="size-[6px] rounded-full bg-orange" />
          <Text className="text-[10.5px] uppercase text-orange" style={{ fontFamily: MONO, letterSpacing: 0.8 }}>
            {part.isQuestion ? 'Question' : 'Needs approval'}
          </Text>
          {part.riskLevel ? (
            <View className={cn('h-[19px] justify-center rounded-full px-2', risky ? 'bg-red-tint' : 'bg-orange-tint')}>
              <Text className={cn('text-[10px] font-semibold uppercase', risky ? 'text-red' : 'text-orange')} style={{ fontFamily: MONO, letterSpacing: 0.4 }}>
                {part.riskLevel} risk
              </Text>
            </View>
          ) : null}
        </View>
        {part.header ? (
          <Text className="mt-1.5 text-[15.5px] font-semibold text-ink" weight={W_SEMI}>
            {part.header}
          </Text>
        ) : null}
        <Text className="mt-1 text-[12.5px] leading-[19px] text-ink-2" style={{ fontFamily: MONO }}>
          {part.prompt}
        </Text>
      </View>

      <View className="gap-2 p-3">
        {options.map((option, index) => {
          const active = selected.includes(option.value)
          return (
            <Tap
              key={option.value}
              accessibilityRole="checkbox"
              accessibilityState={{ selected: active }}
              onPress={() => {
                void haptic('select')
                if (multi) setSelected((current) => (active ? current.filter((v) => v !== option.value) : [...current, option.value]))
                else setSelected([option.value])
              }}
              className={cn('flex-row items-center gap-3 rounded-[12px] px-3.5 py-[11px]', active ? 'bg-accent-tint' : undefined)}
              style={active ? { borderWidth: 1, borderColor: color.accentEdge } : { backgroundColor: color.option }}
            >
              <View
                className="size-[22px] shrink-0 items-center justify-center rounded-full"
                style={{ borderWidth: 1.5, borderColor: active ? color.accent : color.ink4, backgroundColor: active ? color.accent : 'transparent' }}
              >
                <Text className="text-[11px] font-bold" style={{ color: active ? color.accentInk : color.ink2 }}>
                  {String.fromCharCode(65 + index)}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[14px] text-ink">{option.label}</Text>
                {option.description ? (
                  <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-2" numberOfLines={2}>
                    {option.description}
                  </Text>
                ) : null}
              </View>
            </Tap>
          )
        })}

        {part.allowsCustomText ? (
          <TextInput
            value={custom}
            onChangeText={setCustom}
            placeholder="Or write your own answer…"
            placeholderTextColor={color.ink3}
            accessibilityLabel="Custom answer"
            multiline
            className="rounded-[12px] px-3.5 py-3 text-[14px] leading-[20px] text-ink"
            style={{ backgroundColor: color.option, minHeight: 88, textAlignVertical: 'top' }}
          />
        ) : null}

        <View className="flex-row items-center justify-between gap-2 pt-1">
          {!multi ? (
            <Tap
              accessibilityRole="checkbox"
              accessibilityState={{ checked: always }}
              onPress={() => {
                void haptic('select')
                setAlways((value) => !value)
              }}
              hitSlop={6}
              className="flex-row items-center gap-2"
            >
              <View
                className="size-[18px] items-center justify-center rounded-[5px]"
                style={{ borderWidth: 1.5, borderColor: always ? color.accent : color.ink4, backgroundColor: always ? color.accent : 'transparent' }}
              >
                {always ? <Check size={11} color={color.accentInk} stroke={3} /> : null}
              </View>
              <Text className="text-[12.5px] text-ink-2">Always allow</Text>
            </Tap>
          ) : (
            <Text className="text-[12.5px] text-ink-3">Select all that apply</Text>
          )}
          <Tap
            accessibilityRole="button"
            accessibilityLabel={multi ? 'Submit' : 'Confirm'}
            onPress={submit}
            className={cn('h-[30px] items-center justify-center rounded-full px-[13px]', selected.length === 0 && !custom.trim() ? 'bg-field' : 'bg-accent')}
          >
            <Text className={cn('text-[12.5px] font-semibold', selected.length === 0 && !custom.trim() ? 'text-ink-3' : 'text-accent-ink')} weight={W_SEMI}>
              {multi ? 'Submit' : 'Confirm'}
            </Text>
          </Tap>
        </View>
      </View>
    </View>
  )
}

/* ── Parts ────────────────────────────────────────────────────────────────── */

const CHATTER =
  /^\s*(?:model|thought level|permission(?: mode)?|context window|working directory|engine)\b[^\n]{0,80}\b(?:changed|switched)\b/i

function isChatter(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && !trimmed.includes('\n') && CHATTER.test(trimmed)
}

function Part({ part, onRespond }: { part: MessagePart; onRespond: Respond }) {
  // How much of a turn to show is one setting, read here as well as in the
  // reasoning card — the accounting rows follow it too.
  const detail = useStore((s) => s.timelineDetail)
  switch (part.kind) {
    case 'plan':
      return <PlanCard part={part} onRespond={part.status === 'proposed' ? (decision) => onRespond(`plan:${part.steps.join('|')}`, decision) : undefined} />
    case 'approval':
      return <ApprovalCard part={part} onRespond={onRespond} />
    case 'error':
      return (
        <View className="mx-[18px] my-2 flex-row items-start gap-2.5 rounded-[14px] bg-red-tint px-3.5 py-3">
          <View className="mt-px">
            <Alert size={14} color={color.red} />
          </View>
          <Text className="min-w-0 flex-1 text-[13px] leading-[19px] text-ink-2">{part.message}</Text>
        </View>
      )
    case 'usage':
      if (detail === 'simple') return null
      if (!part.inputTokens && !part.outputTokens && !part.costUsd) return null
      return (
        <Quiet>
          <Text className="text-[11.5px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
            ↑ {short(part.inputTokens)} ↓ {short(part.outputTokens)}
            {part.costUsd ? ` · $${part.costUsd.toFixed(3)}` : ''}
          </Text>
        </Quiet>
      )
    case 'turn_summary':
      // The stop reason is worth keeping in the simple view; what it cost is
      // not — that is the accounting the Detail toggle is for.
      return (
        <Quiet>
          <Dot tone={part.stopReason && part.stopReason !== 'end_turn' ? 'orange' : 'dim'} size={6} />
          <Text className="min-w-0 flex-1 text-[11.5px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
            {part.stopReason ?? 'Turn complete'}
            {detail === 'detailed' && part.durationMs ? ` · ${duration(part.durationMs)}` : ''}
            {detail === 'detailed' && part.outputTokens ? ` · ${short(part.outputTokens)} out` : ''}
            {detail === 'detailed' && part.costUsd ? ` · $${part.costUsd.toFixed(3)}` : ''}
          </Text>
        </Quiet>
      )
    case 'file':
      return (
        <Quiet>
          <Check size={13} color={part.ok ? color.ink3 : color.red} />
          <Text className="min-w-0 flex-1 text-[11.5px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
            {part.path}
          </Text>
        </Quiet>
      )
    case 'subagent':
      return (
        <Quiet>
          <Dot tone={part.status === 'running' ? 'accent' : part.status === 'failed' ? 'red' : 'green'} pulse={part.status === 'running'} size={7} />
          <Text className="min-w-0 flex-1 text-[11.5px] text-ink-2" numberOfLines={1}>
            {part.name}
          </Text>
          <Text className="text-[10.5px] text-ink-3" style={{ fontFamily: MONO }}>
            {part.status}
          </Text>
        </Quiet>
      )
    default:
      return null
  }
}

/* ── Turn ─────────────────────────────────────────────────────────────────── */

function Turn({ message, onRespond }: { message: Message; onRespond: Respond }) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((part) => part.kind === 'text')
      .map((part) => (part.kind === 'text' ? part.text : ''))
      .join('\n')
      .trim()
    if (!text) return null
    return (
      <View className="mb-0.5 mt-2.5 flex-row justify-end px-4">
        <View className="max-w-[78%] rounded-[20px] rounded-br-[6px] bg-accent px-[15px] py-[9px]">
          {/* Sent prompts keep their tokens coloured, so a `$skill` you typed
              still reads as the thing the agent resolved rather than as prose. */}
          <TokenText text={text} className="text-[15.5px] leading-[22px] text-accent-ink" chip />
        </View>
      </View>
    )
  }

  const blocks: Array<{ kind: 'parts'; items: MessagePart[] } | { kind: 'run'; items: Array<Extract<MessagePart, { kind: 'tool' | 'command' }>> }> = []
  for (const part of message.parts) {
    const isRun = part.kind === 'tool' || part.kind === 'command'
    const last = blocks[blocks.length - 1]
    if (isRun) {
      if (last?.kind === 'run') last.items.push(part as never)
      else blocks.push({ kind: 'run', items: [part as never] })
    } else {
      if (last?.kind === 'parts') last.items.push(part)
      else blocks.push({ kind: 'parts', items: [part] })
    }
  }

  return (
    <View className="gap-1 py-1">
      {blocks.map((block, index) => {
        if (block.kind === 'run') return <RunCard key={index} parts={block.items} />
        return (
          <View key={index} className="gap-2.5">
            {block.items.map((part, partIndex) => {
              if (part.kind === 'text' && part.text.trim()) {
                if (isChatter(part.text)) {
                  return (
                    <Quiet key={partIndex}>
                      <Dot tone="dim" size={6} />
                      <Text className="min-w-0 flex-1 text-[13px] text-ink-3" numberOfLines={1}>
                        {part.text.trim()}
                      </Text>
                    </Quiet>
                  )
                }
                return <Prose key={partIndex} text={part.text} />
              }
              if (part.kind === 'reasoning') {
                return (
                  <Reasoning
                    key={partIndex}
                    text={part.text}
                    streaming={part.streaming}
                    durationMs={(part as { durationMs?: number }).durationMs}
                    usage={message.parts.find((entry) => entry.kind === 'usage') as Extract<MessagePart, { kind: 'usage' }> | undefined}
                  />
                )
              }
              return <Part key={partIndex} part={part} onRespond={onRespond} />
            })}
          </View>
        )
      })}
    </View>
  )
}

export function Timeline({
  conversation,
  onRespond,
  sessionId,
  topInset = 0,
}: {
  conversation: Conversation
  onRespond: Respond
  sessionId: string
  topInset?: number
}) {
  const scrollRef = React.useRef<ScrollView>(null)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const [outlineOpen, setOutlineOpen] = React.useState(false)

  // One entry per thing the *user* asked for: the turns worth navigating to.
  const turns = React.useMemo(
    () =>
      conversation.messages
        .filter((message) => message.role === 'user')
        .map((message) => ({
          id: message.id,
          preview: turnPreview(message),
        })),
    [conversation.messages],
  )

  // Where each turn sits, so a tap can go there. `onLayout` reports positions
  // in the content box, which is also the unit `scrollTo` takes.
  const offsets = React.useRef(new Map<string, number>())
  const [activeId, setActiveId] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [revision, conversation.messages.length])

  function jumpTo(id: string) {
    const y = offsets.current.get(id)
    setOutlineOpen(false)
    if (y === undefined) return
    void haptic('light')
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
    setActiveId(id)
  }

  return (
    <View className="flex-1">
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingTop: topInset + 10, paddingBottom: 8, gap: 4 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          const y = event.nativeEvent.contentOffset.y
          let current: string | undefined
          for (const turn of turns) {
            const offset = offsets.current.get(turn.id)
            if (offset !== undefined && offset <= y + 60) current = turn.id
          }
          setActiveId(current ?? turns[0]?.id)
        }}
        scrollEventThrottle={64}
      >
        {conversation.messages.map((message) => (
          <View
            key={message.id}
            onLayout={(event) => offsets.current.set(message.id, event.nativeEvent.layout.y)}
          >
            <Turn message={message} onRespond={onRespond} />
          </View>
        ))}
      </ScrollView>

      <TimelineOutline turns={turns} activeId={activeId} onJump={jumpTo} onOpen={() => setOutlineOpen(true)} />

      {/* The jump list — the rail's ticks are the shortcut; this is the detail. */}
      <Sheet open={outlineOpen} onClose={() => setOutlineOpen(false)} title="Conversation" glyph={<List size={19} color={color.ink2} />}>
        {turns.length === 0 ? (
          <Text className="px-4 py-3 text-sub text-ink-3">Nothing asked yet.</Text>
        ) : (
          turns.map((turn, index) => {
            const on = turn.id === activeId
            return (
              <Tap
                key={turn.id}
                accessibilityRole="button"
                accessibilityLabel={`Jump to: ${turn.preview}`}
                accessibilityState={{ selected: on }}
                onPress={() => jumpTo(turn.id)}
                className={cn('min-h-[52px] w-full flex-row items-center gap-3 px-4 py-2.5', on && 'bg-accent-tint')}
                style={!on && index > 0 ? { borderTopWidth: 0.5, borderTopColor: color.lineSoft } : undefined}
              >
                <Text className="shrink-0 text-mono-cap text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
                  {String(index + 1).padStart(2, '0')}
                </Text>
                <Text className="min-w-0 flex-1 text-sub text-ink" numberOfLines={2}>
                  {turn.preview}
                </Text>
                <View
                  className="shrink-0 rounded-full"
                  style={{ width: on ? 16 : 10, height: 2, backgroundColor: on ? color.ink : color.edge }}
                />
              </Tap>
            )
          })
        )}
      </Sheet>
    </View>
  )
}

/** The first line of a prompt, short enough for the rail and the jump list. */
function turnPreview(message: Message): string {
  const text = message.parts
    .filter((part) => part.kind === 'text')
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'Message'
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/**
 * TimelineOutline — the spine down the left edge of the transcript.
 *
 * The desktop keeps this rail on hover; a phone has no hover, so the ticks are
 * always there — one per prompt, widening for the turn you are reading — and
 * tapping anywhere on it opens the full list. It is the cheapest way to answer
 * "where was that thing I asked earlier" without scrolling the whole thread.
 */
function TimelineOutline({
  turns,
  activeId,
  onJump,
  onOpen,
}: {
  turns: Array<{ id: string; preview: string }>
  activeId?: string
  onJump: (id: string) => void
  onOpen: () => void
}) {
  if (turns.length < 2) return null
  return (
    <View className="absolute bottom-0 left-0 top-0 w-6 justify-center" pointerEvents="box-none">
      <View className="items-center gap-1 py-3">
        {turns.map((turn) => {
          const on = turn.id === activeId
          return (
            <Tap
              key={turn.id}
              accessibilityRole="button"
              accessibilityLabel={`Jump to: ${turn.preview}`}
              accessibilityState={{ selected: on }}
              onPress={() => onJump(turn.id)}
              hitSlop={{ top: 2, bottom: 2, left: 6, right: 6 }}
              className="items-center justify-center px-2 py-1"
            >
              <View
                className="rounded-full"
                style={{
                  width: on ? 16 : 6,
                  height: 2,
                  backgroundColor: on ? color.ink : color.edge,
                }}
              />
            </Tap>
          )
        })}
        {/* The rail's own affordance for the full list, at its foot. */}
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`Open the conversation outline, ${turns.length} prompts`}
          onPress={onOpen}
          hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}
          className="mt-1 items-center justify-center px-2 py-1"
        >
          <List size={11} color={color.ink3} />
        </Tap>
      </View>
    </View>
  )
}

/**
 * Reasoning — the agent's thinking, drawn the way the desktop draws it.
 *
 * The trace is not decoration: it is where a turn explains itself, and the
 * phone was discarding it outright. While the thought is still arriving the
 * trace is open, because the interesting part of a reasoning turn is the
 * reasoning; once it closes it collapses to "Thought for 4.2s" and stays
 * expandable. A tap wins over the automatic behaviour for the rest of the turn.
 */
function Reasoning({
  text,
  streaming,
  durationMs,
  usage,
}: {
  text: string
  streaming?: boolean
  durationMs?: number
  usage?: Extract<MessagePart, { kind: 'usage' }>
}) {
  const [override, setOverride] = React.useState<boolean | undefined>(undefined)
  const simple = useStore((s) => s.timelineDetail === 'simple')
  const hasText = text.trim().length > 0
  const open = override ?? (!!streaming && hasText)

  const label = streaming
    ? 'Thinking'
    : durationMs !== undefined && !simple
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Thought'

  const input = simple ? undefined : formatTokens(usage?.inputTokens)
  const output = simple ? undefined : formatTokens(usage?.outputTokens)

  return (
    <View className="px-[18px] py-0.5">
      <Tap
        accessibilityRole="button"
        accessibilityLabel={hasText ? `${label}. ${open ? 'Collapse' : 'Expand'} the trace.` : label}
        accessibilityState={{ expanded: open }}
        disabled={!hasText}
        onPress={() => {
          void haptic('light')
          setOverride(!open)
        }}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
        className="h-6 shrink-0 flex-row items-center gap-1.5 self-start"
      >
        <ChevronDown size={12} color={color.ink3} />
        <Text className={cn('text-meta', streaming ? 'text-ink-3' : 'text-ink-2')} numberOfLines={1}>
          {label}
        </Text>
        {input ? (
          <Text className="text-mono-cap text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
            ↑{input}
          </Text>
        ) : null}
        {output ? (
          <Text className="text-mono-cap text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
            ↓{output}
          </Text>
        ) : null}
      </Tap>
      {open && hasText ? (
        <View className="ml-[7px] mt-1 border-l py-0.5 pl-3" style={{ borderColor: color.lineSoft }}>
          <Text className="text-meta leading-[20px] text-ink-2">{text.trim()}</Text>
        </View>
      ) : null}
    </View>
  )
}

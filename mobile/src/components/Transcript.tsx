/**
 * Transcript — the conversation timeline.
 *
 * The desktop's `Timeline` + `chat.tsx` ported to native. The conversation is
 * still the shared mutable model produced by `@/lib/events` — so the streaming
 * and dedup behaviour is identical to the desktop — and this is only its view.
 *
 * FOUR DECISIONS, EACH OF WHICH WAS A BUG ON A PHONE
 * --------------------------------------------------
 *
 * 1. **Recency fade, but only when idle.** The desktop fades older turns so the
 *    current one dominates. On a phone this fights *streaming*: a long answer
 *    arriving would keep re-rendering under the user's thumb. So the fade is
 *    applied only while the agent is not actively streaming, and it is a single
 *    opacity on the oldest turns rather than a per-turn value that changes on
 *    every frame.
 *
 * 2. **Follow-the-stream is polite.** The list auto-scrolls on new content,
 *    but it *stops following the moment the user scrolls away*. A transcript
 *    that yanks itself back to the bottom while you are reading the diff two
 *    turns up is the single most irritating thing a chat list can do, and no
 *    amount of "scroll to bottom" button fixes it — the fix is not fighting
 *    the user in the first place. The button appears instead.
 *
 * 3. **A jump-to-bottom control, not a jump-to-latest-message control.** The
 *    desktop has a navigator spine pinned to the left for turn-to-turn
 *    navigation; there is no room for that at phone width next to bubbles, and
 *    it was never the thing people used. "Get me back to the live edge" is.
 *
 * 4. **The system divider is a real divider.** Two hairlines with the text
 *    between them, exactly as the desktop does it. It reads as a boundary
 *    rather than as another message, which is the point of a system message.
 *
 * V3: the conversation reads like a premium dark control room. Assistant
 * turns are full-width clean prose — no bubble, no card — separated by clear
 * vertical rhythm; user messages sit in a compact right-aligned accent-washed
 * panel with one small corner; reasoning is a quiet collapsible row.
 *
 * QAI SIGNAL DECK: user turns are signal panels — the accent wash with a
 * cyan hairline — so your words read as "command input" against the
 * assistant's open prose on the deck.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Text } from '@app/components/Text'
import { ArrowDown, Check, ChevronDown, Sparkles } from 'lucide-react-native'

import { cn } from '@/lib/format'
import type { Message, MessagePart } from '@/types/conversation'
import { gitApi } from '@app/lib/api'
import { useStore } from '@app/store'
import { palette, radius, shadowFloating } from '@app/design/tokens'
import { EASE_OUT } from '@app/components/motion'
import { Well, haptic } from '@app/components/ui'
import { Approval, ErrorCard, Plan, TurnSummary, UsageMeter } from './chat/cards'
import {
  BrowserStepRow,
  ChatImage,
  FileChips,
  GitCommitRow,
  OrchestrationRow,
  ProgressRow,
  SearchRow,
  SubagentRow,
  ToolGroup,
  VerificationCard,
} from './chat/rows'
import { Chips, Prose } from './chat/prose'

/* ── Part shells ────────────────────────────────────────────────────────────── */

/** Collapsible thinking block. Auto-expands while streaming, then collapses. */
function Reasoning({ part }: { part: MessagePart & { kind: 'reasoning' } }) {
  const hasText = part.text.trim().length > 0
  const [override, setOverride] = React.useState<boolean | undefined>(undefined)
  const open = override ?? (part.streaming && hasText)
  const label = part.streaming
    ? 'Thinking'
    : part.durationMs
      ? `Thought for ${(part.durationMs / 1000).toFixed(1)}s`
      : 'Thought'

  return (
    <View style={{ minWidth: 0 }}>
      <Pressable
        accessibilityRole={hasText ? 'button' : 'text'}
        accessibilityLabel={label}
        accessibilityState={{ expanded: hasText ? open : undefined }}
        onPress={hasText ? () => setOverride(!open) : undefined}
        style={{
          minHeight: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          borderRadius: radius.xs,
          paddingHorizontal: 6,
        }}
      >
        {part.streaming ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : (
          <ChevronDown
            size={12}
            color={palette.ink4}
            style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }}
          />
        )}
        <Text style={{ fontSize: 13, lineHeight: 18, color: palette.ink3 }}>
          {part.streaming ? '✦ ' : ''}
          {label}
        </Text>
        {part.durationMs && !part.streaming ? (
          <Check size={11} color={palette.ok} strokeWidth={2.6} />
        ) : null}
      </Pressable>
      {open && hasText ? (
        <Well className="mb-1 mt-1.5 px-3 py-2.5">
          <Text className="text-[13px] leading-[19px] text-ink-2">{part.text}</Text>
        </Well>
      ) : null}
    </View>
  )
}

function SystemTurn({ message }: { message: Message }) {
  const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join(' ').trim()
  if (!text) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.line }} />
      <Text style={{ color: palette.ink3, fontSize: 11.5, textAlign: 'center' }}>{text}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.line }} />
    </View>
  )
}

function UserTurn({ message }: { message: Message }) {
  const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n')
  if (!text.trim()) return null
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <View
        style={{
          maxWidth: '86%',
          borderRadius: radius.lg,
          borderBottomRightRadius: 6,
          borderWidth: 1,
          borderColor: palette.accentBorder,
          backgroundColor: palette.selected,
          paddingHorizontal: 14,
          paddingVertical: 10,
          // 60% while optimistic: the message is on its way to the desktop but
          // is not yet a fact, and the user should be able to see that.
          opacity: message.optimistic ? 0.6 : 1,
        }}
      >
        <Chips text={text} />
      </View>
    </View>
  )
}

function AssistantTurn({
  sessionId,
  message,
  project,
  simple,
  onRespond,
  onViewPlan,
}: {
  sessionId: string
  message: Message
  project?: string | null
  /** Desktop timeline-detail toggle: simple folds tool runs to one line. */
  simple?: boolean
  onRespond: (part: MessagePart & { kind: 'approval' }, decision: string, meta?: { always?: boolean }) => void
  onViewPlan?: () => void
}) {
  const files = message.parts.filter((part) => part.kind === 'file')

  return (
    <View style={{ gap: 10 }}>
      {message.parts.map((part, index) => {
        // Fold a run of consecutive calls into one group; a lone call is bare.
        if (part.kind === 'tool' || part.kind === 'command') {
          const previous = message.parts[index - 1]
          if (previous && (previous.kind === 'tool' || previous.kind === 'command')) return null
          const run: Array<never> = []
          for (let cursor = index; cursor < message.parts.length; cursor++) {
            const candidate = message.parts[cursor]
            if (candidate.kind !== 'tool' && candidate.kind !== 'command') break
            run.push(candidate as never)
          }
          // Simple mode folds even a LONE tool into the one-line group, which
          // is exactly what the desktop Timeline does.
          return <ToolGroup key={index} parts={run} simple={simple} />
        }

        switch (part.kind) {
          case 'text':
            return part.text.trim() ? <Prose key={index} text={part.text} streaming={part.streaming} /> : null
          case 'reasoning':
            return <Reasoning key={index} part={part} />
          case 'plan':
            return <Plan key={index} part={part} onViewPlan={onViewPlan} />
          case 'approval':
            return (
              <Approval
                key={index}
                part={part}
                onRespond={(decision, meta) => onRespond(part, decision, meta)}
              />
            )
          case 'error':
            return <ErrorCard key={index} part={part} />
          case 'usage':
            return <UsageMeter key={index} part={part} />
          case 'turn_summary':
            return <TurnSummary key={index} part={part} />
          case 'subagent':
            return <SubagentRow key={index} part={part} />
          case 'orchestration':
            return <OrchestrationRow key={index} part={part} />
          case 'progress':
            return <ProgressRow key={index} part={part} />
          case 'search':
            return <SearchRow key={index} part={part} />
          case 'git_commit':
            return <GitCommitRow key={index} part={part} />
          case 'browser':
            return <BrowserStepRow key={index} part={part} />
          case 'verification':
            return <VerificationCard key={index} part={part} />
          case 'image':
            return <ChatImage key={index} sessionId={sessionId} fileName={part.fileName} />
          // `file` parts are grouped below into one card; `context` is
          // metadata the desktop shows in simple mode only.
          default:
            return null
        }
      })}

      {files.length > 0 ? (
        <FileChips
          parts={files as never}
          onLoadDiff={
            project
              ? async (path) => {
                  try {
                    const result = await gitApi.diff(project, path, sessionId)
                    return result.diff || null
                  } catch {
                    return null
                  }
                }
              : undefined
          }
        />
      ) : null}
    </View>
  )
}

/* ── Empty state ──────────────────────────────────────────────────────────────
 * The desktop's: a dashed card, a spark, "New session — say where to start",
 * an explanation, and the tip line. The tip is kept because the two tokens a
 * new user needs — `@file` and `/command` — are otherwise undiscoverable, and
 * the desktop's whole tutorial is those two characters. */

function TranscriptEmpty() {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: 10,
        marginHorizontal: 8,
        marginTop: 12,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: palette.lineStrong,
        backgroundColor: palette.surface,
        paddingHorizontal: 22,
        paddingVertical: 34,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.accentSoft,
        }}
      >
        <Sparkles size={19} color={palette.accent} />
      </View>
      <Text
        className="text-center text-[16px] font-semibold text-ink"
        style={{ letterSpacing: -0.2 }}
      >
        New session — say where to start
      </Text>
      <Text className="max-w-[36ch] text-center text-[13px] leading-[18px] text-ink-3">
        Describe the change you want. The agent will plan it, ask before anything risky, and
        stream its work back here.
      </Text>
      <View
        style={{
          marginTop: 4,
          borderRadius: radius.sm,
          backgroundColor: palette.well,
          paddingHorizontal: 11,
          paddingVertical: 7,
        }}
      >
        <Text className="text-[12px] leading-[17px] text-ink-3">
          <Text style={{ color: palette.ok, fontWeight: '600' }}>@file</Text> attaches context
          {'  ·  '}
          <Text style={{ color: palette.wait, fontWeight: '600' }}>/command</Text> runs a shortcut
        </Text>
      </View>
    </View>
  )
}

/* ── Timeline ───────────────────────────────────────────────────────────────── */

export function Transcript({
  sessionId,
  messages,
  revision,
  simple,
  onViewPlan,
}: {
  sessionId: string
  messages: Message[]
  revision: number
  /** Desktop timeline-detail toggle: simple folds tool runs to one line. */
  simple?: boolean
  onViewPlan?: () => void
}) {
  const listRef = React.useRef<FlatList<Message>>(null)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const answerQuestion = useStore((state) => state.answerQuestion)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))

  const [following, setFollowing] = React.useState(true)
  const [atBottom, setAtBottom] = React.useState(true)
  const lastCount = React.useRef(messages.length)

  // Follow the stream — but only while the user has not taken over. See the
  // file header: this is the difference between a transcript you can read and
  // one that fights you.
  React.useEffect(() => {
    if (!following) return
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 70)
    lastCount.current = messages.length
    return () => clearTimeout(timer)
  }, [revision, messages.length, following])

  const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height
    setAtBottom(distanceFromBottom < 120)
    // A deliberate scroll away from the bottom means the user wants to read.
    setFollowing(distanceFromBottom < 120)
  }, [])

  const onRespond = React.useCallback(
    (part: MessagePart & { kind: 'approval' }, decision: string, meta?: { always?: boolean }) => {
      if (part.isQuestion) {
        // Questions are answered over `QuestionAnswer`, with the selection as
        // a list. Multi-select sends a JSON array; single-select a bare value.
        let values: string[] = [decision]
        if (decision.startsWith('[')) {
          try {
            const parsed = JSON.parse(decision)
            if (Array.isArray(parsed)) values = parsed.map(String)
          } catch {
            /* keep the raw value */
          }
        }
        answerQuestion(part.requestId, values)
        return
      }
      respondToApproval(sessionId, part.requestId, decision, meta)
    },
    [answerQuestion, respondToApproval, sessionId],
  )

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(message) => message.id}
        extraData={revision}
        contentContainerStyle={{ gap: 18, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}
        renderItem={({ item }) =>
          item.role === 'system' ? (
            <SystemTurn message={item} />
          ) : item.role === 'user' ? (
            <UserTurn message={item} />
          ) : (
            <AssistantTurn
              sessionId={sessionId}
              message={item}
              project={session?.project}
              simple={simple}
              onRespond={onRespond}
              onViewPlan={onViewPlan}
            />
          )
        }
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          if (following) listRef.current?.scrollToEnd({ animated: false })
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<TranscriptEmpty />}
        ListFooterComponent={<TranscriptFooter streaming={messages[messages.length - 1]?.streaming} />}
      />

      <JumpToBottom
        visible={!atBottom}
        onPress={() => {
          void haptic('light')
          setFollowing(true)
          listRef.current?.scrollToEnd({ animated: true })
        }}
      />
    </View>
  )
}

/**
 * The "back to the live edge" control.
 *
 * It appears only when the user has scrolled away, and it is the *only* thing
 * in the app that fights the scroll position — which is why it can afford to:
 * it is opt-in, it is a single obvious target, and it never moves the content
 * by itself.
 */
function JumpToBottom({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const progress = React.useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 20, stiffness: 260, mass: 0.6 }).start()
    } else {
      Animated.timing(progress, { toValue: 0, duration: 160, easing: EASE_OUT, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setMounted(false)
        },
      )
    }
  }, [visible, progress])

  if (!mounted) return null

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 10,
        alignItems: 'center',
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Jump to the newest message"
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: palette.lineStrong,
          backgroundColor: pressed ? palette.hover : palette.raised,
          paddingHorizontal: 13,
          paddingVertical: 8,
          ...shadowFloating,
        })}
      >
        <ArrowDown size={14} color={palette.ink2} strokeWidth={2.4} />
        <Text className="text-[12.5px] font-semibold text-ink-2">Latest</Text>
      </Pressable>
    </Animated.View>
  )
}

/**
 * A tail under the transcript.
 *
 * Not decoration: it tells the user which end of the stream they are looking at
 * and, when the agent is mid-turn, that it is still producing. A bare
 * transcript gives you neither.
 */
function TranscriptFooter({ streaming }: { streaming?: boolean }) {
  if (!streaming) return <View style={{ height: 4 }} />
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingTop: 8,
        paddingLeft: 2,
      }}
    >
      <ActivityIndicator size="small" color={palette.accent} />
      <Text className="text-[12.5px] text-ink-3">Working…</Text>
    </View>
  )
}

export { cn }

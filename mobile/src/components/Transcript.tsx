/**
 * Transcript — the chat timeline.
 *
 * The desktop's `Timeline` + `chat.tsx` ported to native. The conversation is
 * still the shared mutable model produced by `@/lib/events` (so the streaming and
 * dedup behaviour is identical to the desktop); this is only its view.
 *
 * Structure, spacing and type are the desktop's: the content column is capped at
 * 60rem, turns are 24px apart, parts inside a turn are 8px apart, user messages
 * are right-aligned accent-tinted bubbles, assistant turns are unadorned columns
 * of parts, and consecutive tool/command calls fold into one bordered group with
 * an "N steps" footer.
 */

import * as React from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { Check, ChevronDown } from 'lucide-react-native'

import { cn } from '@/lib/format'
import type { Message, MessagePart } from '@/types/conversation'
import { gitApi } from '@app/lib/api'
import { useStore } from '@app/store'
import { Mono } from '@app/components/ui'
import { Approval, ErrorCard, Plan, TurnSummary, UsageMeter } from './chat/cards'
import {
  BrowserStepRow,
  ChatImage,
  FileChips,
  GitCommitRow,
  OrchestrationRow,
  ProgressRow,
  SearchRow,
  Step,
  SubagentRow,
  VerificationCard,
} from './chat/rows'
import { Chips, Prose } from './chat/prose'

/* ── Tool group ──────────────────────────────────────────────────────────── */

/** Consecutive tool/command calls, folded into one card. */
function ToolGroup({ parts }: { parts: Array<MessagePart> }) {
  const [open, setOpen] = React.useState(true)
  const failed = parts.some((part) => (part as { status?: string }).status === 'failed')
  const running = parts.some((part) => (part as { status?: string }).status === 'running')

  if (parts.length === 1) {
    const part = parts[0] as MessagePart & { kind: 'tool' | 'command' }
    return <Step part={part} />
  }

  return (
    <View className="overflow-hidden rounded-lg border border-line bg-surface">
      {open ? (
        <View className="gap-px p-1">
          {parts.map((part, index) => (
            <Step key={index} part={part as never} />
          ))}
        </View>
      ) : null}
      <Pressable
        onPress={() => setOpen((value) => !value)}
        className="h-6 w-full flex-row items-center gap-1.5 border-t border-line bg-inset px-2.5"
      >
        <View className={cn('size-1.5 rounded-full', running ? 'bg-accent' : failed ? 'bg-red' : 'bg-green')} />
        <Mono className="text-[10px]">
          {parts.length} steps{failed ? ' · failed' : ''}
          {running ? ' · running' : ''}
        </Mono>
        <View className="flex-1" />
        <ChevronDown size={11} color="#7e7e86" style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
    </View>
  )
}

/* ── Part dispatch ───────────────────────────────────────────────────────── */

function PartView({
  sessionId,
  part,
  project,
  onRespond,
  onViewPlan,
}: {
  sessionId: string
  part: MessagePart
  project?: string | null
  onRespond: (part: MessagePart & { kind: 'approval' }, decision: string, meta?: { always?: boolean }) => void
  onViewPlan?: () => void
}) {
  switch (part.kind) {
    case 'text':
      return <Prose text={part.text} streaming={part.streaming} />
    case 'reasoning':
      return <Reasoning part={part} />
    case 'tool':
    case 'command':
      return <Step part={part} />
    case 'plan':
      return <Plan part={part} onViewPlan={onViewPlan} />
    case 'approval':
      return <Approval part={part} onRespond={(requestId, decision, meta) => onRespond(part, decision, meta)} />
    case 'error':
      return <ErrorCard part={part} />
    case 'usage':
      return <UsageMeter part={part} />
    case 'turn_summary':
      return <TurnSummary part={part} />
    case 'subagent':
      return <SubagentRow part={part} />
    case 'orchestration':
      return <OrchestrationRow part={part} />
    case 'progress':
      return <ProgressRow part={part} />
    case 'search':
      return <SearchRow part={part} />
    case 'git_commit':
      return <GitCommitRow part={part} />
    case 'browser':
      return <BrowserStepRow part={part} />
    case 'verification':
      return <VerificationCard part={part} />
    case 'image':
      return <ChatImage sessionId={sessionId} fileName={part.fileName} />
    case 'file':
      // Grouped by the caller into one FileChips block.
      return null
    case 'context':
      return null
    default:
      return null
  }
}

/** Collapsible thinking block — collapsed by default, expands on tap. */
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
    <View className="min-w-0">
      <Pressable
        onPress={hasText ? () => setOverride(!open) : undefined}
        disabled={!hasText}
        className="h-6 flex-row items-center gap-1.5 rounded-md px-1.5"
      >
        <ChevronDown
          size={12}
          color="#7e7e86"
          style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }}
        />
        <Text className="shrink-0 text-[12px] text-ink-2">{label}</Text>
        {part.durationMs && !part.streaming ? (
          <Check size={11} color="#57ab5a" />
        ) : null}
      </Pressable>
      {open && hasText ? (
        <Mono className="ml-2 mt-1 border-l border-line py-0.5 pl-3 text-[12px] leading-5 text-ink-2">
          {part.text}
        </Mono>
      ) : null}
    </View>
  )
}

/* ── Message shells ──────────────────────────────────────────────────────── */

function SystemTurn({ message }: { message: Message }) {
  const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join(' ').trim()
  if (!text) return null
  return (
    <View className="flex-row items-center gap-3 py-1">
      <View className="h-px min-w-8 flex-1 bg-line" />
      <Text className="min-w-0 text-center text-[11px] leading-4 text-ink-3">{text}</Text>
      <View className="h-px min-w-8 flex-1 bg-line" />
    </View>
  )
}

function UserTurn({ message }: { message: Message }) {
  const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n')
  return (
    <View className="flex-row justify-end">
      <View className={cn('max-w-[85%] rounded-2xl rounded-br-md border border-accent bg-accent-tint px-3.5 py-2.5', message.optimistic && 'opacity-60')}>
        <Chips text={text} />
      </View>
    </View>
  )
}

function AssistantTurn({
  sessionId,
  message,
  project,
  onRespond,
  onViewPlan,
}: {
  sessionId: string
  message: Message
  project?: string | null
  onRespond: (part: MessagePart & { kind: 'approval' }, decision: string, meta?: { always?: boolean }) => void
  onViewPlan?: () => void
}) {
  const files = message.parts.filter((part) => part.kind === 'file')

  return (
    <View className="gap-2">
      {message.parts.map((part, index) => {
        if (part.kind === 'tool' || part.kind === 'command') {
          // Fold a run of consecutive calls into one group; a lone call is bare.
          const previous = message.parts[index - 1]
          const isRunStart =
            !previous || (previous.kind !== 'tool' && previous.kind !== 'command')
          if (!isRunStart) return null
          const run: MessagePart[] = []
          for (let cursor = index; cursor < message.parts.length; cursor++) {
            const candidate = message.parts[cursor]
            if (candidate.kind !== 'tool' && candidate.kind !== 'command') break
            run.push(candidate)
          }
          return <ToolGroup key={index} parts={run} />
        }
        if (part.kind === 'file') return null
        return (
          <PartView
            key={index}
            sessionId={sessionId}
            part={part}
            project={project}
            onRespond={onRespond}
            onViewPlan={onViewPlan}
          />
        )
      })}
      {files.length > 0 ? (
        <FileChips
          parts={files as never}
          onLoadDiff={
            // A working tree may have moved on since the file was written, in
            // which case the diff comes back empty — the chip says so rather
            // than showing a blank card.
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

/* ── Timeline ────────────────────────────────────────────────────────────── */

export function Transcript({
  sessionId,
  messages,
  revision,
  onViewPlan,
}: {
  sessionId: string
  messages: Message[]
  revision: number
  onViewPlan?: () => void
}) {
  const listRef = React.useRef<FlatList<Message>>(null)
  const connection = useStore((state) => state.connection)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const answerQuestion = useStore((state) => state.answerQuestion)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))

  // Follow the stream: jump to the newest content as it arrives.
  React.useEffect(() => {
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(timer)
  }, [revision, messages.length])

  const onRespond = React.useCallback(
    (part: MessagePart & { kind: 'approval' }, decision: string, meta?: { always?: boolean }) => {
      if (part.isQuestion) {
        // Questions are answered over `QuestionAnswer`, with the selection as a
        // list. Multi-select sends a JSON array; single-select a bare value.
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

  void connection

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(message) => message.id}
      extraData={revision}
      contentContainerClassName="gap-6 px-4 py-5"
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
            onRespond={onRespond}
            onViewPlan={onViewPlan}
          />
        )
      }
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      ListEmptyComponent={
        <View className="items-center gap-2 rounded-2xl border border-dashed border-line bg-surface px-6 py-10">
          <View className="size-9 items-center justify-center rounded-xl bg-accent-tint">
            <Text className="text-[15px] text-accent">✦</Text>
          </View>
          <Text className="text-[13px] font-semibold text-ink">Nothing here yet</Text>
          <Text className="max-w-[34ch] text-center text-[12px] leading-5 text-ink-3">
            Send a prompt to start the agent. Ask for a file with{' '}
            <Text className="text-ink-2">@path</Text> or run a command with{' '}
            <Text className="text-ink-2">/command</Text>.
          </Text>
        </View>
      }
    />
  )
}

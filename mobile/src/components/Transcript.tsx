/**
 * Transcript — renders a session's conversation as a chat timeline.
 *
 * The conversation is the shared mutable model the web app uses, produced by the
 * ported `@/lib/events` reducer; this is only its React Native view. Phase C
 * covers the parts that carry the conversation (text, reasoning, tools, commands,
 * files, plans, approvals, errors, turn summaries); the rest (browser steps,
 * orchestration, subagents, search, git, verification, context, images) render a
 * compact fallback row and get full treatments in Phase D.
 *
 * The list re-renders on the session's revision counter (bumped by the store as
 * frames mutate the conversation in place) and scrolls to the newest content.
 */

import * as React from 'react'
import { FlatList, Text, View } from 'react-native'
import type { Message, MessagePart, PlanPart, TurnSummaryPart } from '@/types/conversation'
import { ApprovalCard } from './ApprovalCard'
import { cn } from '@/lib/format'

const STATUS_DOT: Record<string, string> = {
  running: 'bg-orange',
  ok: 'bg-green',
  failed: 'bg-red',
}

function ActivityRow({
  label,
  detail,
  status,
  mono,
}: {
  label: string
  detail?: string
  status?: string
  mono?: boolean
}) {
  return (
    <View className="my-1 flex-row items-start rounded-control bg-inset px-2.5 py-2">
      <View className={cn('mt-1.5 mr-2 size-[6px] shrink-0 rounded-full', STATUS_DOT[status ?? 'ok'] ?? 'bg-ink-3')} />
      <View className="flex-1">
        <Text className={cn('text-[12px] text-ink-2', mono && 'font-mono')} numberOfLines={2}>
          {label}
        </Text>
        {detail ? (
          <Text className={cn('mt-0.5 text-[11px] text-ink-3', mono && 'font-mono')} numberOfLines={3}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function PlanView({ part }: { part: PlanPart }) {
  const steps = part.entries?.length
    ? part.entries
    : part.steps.map((content) => ({ content, status: 'pending' }))
  return (
    <View className="my-1 rounded-control border border-line bg-inset px-3 py-2">
      {part.title ? <Text className="mb-1 text-[12px] font-medium text-ink">{part.title}</Text> : null}
      {steps.slice(0, 12).map((step, index) => {
        const done = step.status === 'completed'
        const active = step.status === 'in_progress'
        return (
          <View key={index} className="mb-0.5 flex-row items-start">
            <Text className={cn('mr-2 text-[12px]', done ? 'text-green' : active ? 'text-orange' : 'text-ink-3')}>
              {done ? '✓' : active ? '›' : '·'}
            </Text>
            <Text className={cn('flex-1 text-[12px]', done ? 'text-ink-3 line-through' : 'text-ink-2')}>
              {step.content}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function SummaryView({ part }: { part: TurnSummaryPart }) {
  const bits: string[] = []
  if (part.stopReason) bits.push(part.stopReason)
  if (part.costUsd !== undefined) bits.push(`$${part.costUsd.toFixed(4)}`)
  if (part.durationMs) bits.push(`${(part.durationMs / 1000).toFixed(1)}s`)
  if (bits.length === 0) return null
  return (
    <View className="my-1.5 items-center">
      <Text className="text-[10.5px] uppercase tracking-wide text-ink-3">{bits.join(' · ')}</Text>
    </View>
  )
}

function PartView({ sessionId, part }: { sessionId: string; part: MessagePart }) {
  switch (part.kind) {
    case 'text':
      return (
        <Text className="my-1 text-[14px] leading-6 text-ink">
          {part.text}
          {part.streaming ? '  ▌' : ''}
        </Text>
      )
    case 'reasoning':
      return (
        <Text className="my-1 text-[12px] italic leading-5 text-ink-3" numberOfLines={6}>
          {part.text}
        </Text>
      )
    case 'tool':
      return <ActivityRow label={part.name} detail={part.input} status={part.status} />
    case 'command':
      return <ActivityRow label={part.command} detail={part.output} status={part.status} mono />
    case 'file':
      return <ActivityRow label={part.path} status={part.ok ? 'ok' : 'failed'} />
    case 'plan':
      return <PlanView part={part} />
    case 'approval':
      return <ApprovalCard sessionId={sessionId} part={part} />
    case 'error':
      return (
        <View className="my-1 rounded-control border border-red-border bg-red-tint px-3 py-2">
          <Text className="text-[12px] leading-5 text-red">{part.message}</Text>
        </View>
      )
    case 'turn_summary':
      return <SummaryView part={part} />
    case 'search':
      return <ActivityRow label={`Searched: ${part.query}`} status="ok" />
    case 'git_commit':
      return <ActivityRow label={`Committed ${part.sha.slice(0, 7)}`} detail={part.message} status="ok" />
    case 'verification':
      return <ActivityRow label={`Tests ${part.status}`} detail={part.command} status={part.status === 'passed' ? 'ok' : part.status === 'failed' ? 'failed' : 'running'} />
    case 'usage':
    case 'context':
    case 'image':
      return null
    default: {
      // Subagent, orchestration, progress, browser steps — a compact placeholder
      // until Phase D gives each its full row.
      const kind = (part as { kind: string }).kind
      return <ActivityRow label={kind.replace(/_/g, ' ')} status="ok" />
    }
  }
}

function MessageView({ sessionId, message }: { sessionId: string; message: Message }) {
  if (message.role === 'system') {
    return (
      <View className="my-2 items-center">
        <Text className="text-[11px] text-ink-3">
          {message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(' ') || '—'}
        </Text>
      </View>
    )
  }
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n')
    return (
      <View className="my-1.5 flex-row justify-end">
        <View className="max-w-[85%] rounded-card rounded-br-sm bg-accent px-3 py-2">
          <Text className="text-[14px] leading-6 text-accent-ink">{text}</Text>
        </View>
      </View>
    )
  }
  return (
    <View className="my-1">
      {message.parts.map((part, index) => (
        <PartView key={index} sessionId={sessionId} part={part} />
      ))}
    </View>
  )
}

export function Transcript({
  sessionId,
  messages,
  revision,
}: {
  sessionId: string
  messages: Message[]
  revision: number
}) {
  const listRef = React.useRef<FlatList<Message>>(null)
  React.useEffect(() => {
    // Follow the stream: jump to the newest content as it arrives.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(timer)
  }, [revision, messages.length])

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(message) => message.id}
      extraData={revision}
      contentContainerClassName="px-3 py-3"
      renderItem={({ item }) => <MessageView sessionId={sessionId} message={item} />}
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
    />
  )
}

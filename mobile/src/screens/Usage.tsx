/**
 * Usage — per-session token/cost accounting scanned from the conversations
 * on the client, plus the fleet total. Rows stay live as transcripts stream.
 */

import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getConversation, useStore, useConversation } from '@/store'
import { Text } from '../ui'
import { MONO } from '../design/fonts'
import { agentHue, color } from '../design/tokens'
import type { Session } from '@/types/session'

function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  return n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function scan(session: Session): { tokens: number; cost: number } {
  const conversation = getConversation(session.id)
  let tokensTotal = 0
  let costTotal = 0
  for (const message of conversation.messages) {
    for (const part of message.parts) {
      if (part.kind === 'usage' || part.kind === 'turn_summary') {
        tokensTotal += (part.inputTokens ?? 0) + (part.outputTokens ?? 0)
        costTotal += part.costUsd ?? 0
      }
    }
  }
  return { tokens: tokensTotal, cost: costTotal }
}

export function UsageScreen() {
  const insets = useSafeAreaInsets()
  const sessions = useStore((s) => s.sessions)
  const revisions = useStore((s) => s.revisions)
  void revisions

  const rows = React.useMemo(
    () =>
      sessions
        .filter((session) => session.status !== 'archived')
        .map((session) => ({ session, ...scan(session) }))
        .sort((a, b) => b.cost - a.cost),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, revisions],
  )

  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0)
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0)

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-5" style={{ paddingTop: insets.top + 16 }}>
          <Text className="text-[33px] font-bold leading-[37px] text-ink" style={{ letterSpacing: -0.5 }}>
            Usage
          </Text>
        </View>

        <View className="mt-4 flex-row gap-3 px-4">
          <View className="flex-1 rounded-[16px] bg-surface px-4 py-3.5">
            <Text className="text-[11.5px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.4 }}>
              Fleet cost
            </Text>
            <Text className="mt-1 text-[26px] font-bold text-ink" style={{ letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}>
              {fmtCost(totalCost)}
            </Text>
          </View>
          <View className="flex-1 rounded-[16px] bg-surface px-4 py-3.5">
            <Text className="text-[11.5px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.4 }}>
              Tokens
            </Text>
            <Text className="mt-1 text-[26px] font-bold text-ink" style={{ letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}>
              {fmtTokens(totalTokens)}
            </Text>
          </View>
        </View>

        <View className="mx-4 mt-4 overflow-hidden rounded-[16px] bg-surface">
          {rows.length === 0 ? (
            <Text className="p-6 text-center text-[13px] text-ink-3">No sessions to account yet.</Text>
          ) : (
            rows.map(({ session, tokens: used, cost: spent }, index) => (
              <Row key={session.id} session={session} tokens={used} cost={spent} inset={index > 0} />
            ))
          )}
        </View>
        <Text className="mx-4 mt-3.5 text-[11.5px] leading-[17px] text-ink-3">
          Scanned from the conversations this device has loaded — totals grow as sessions are opened.
        </Text>
      </ScrollView>
    </View>
  )
}

function Row({ session, tokens, cost, inset }: { session: Session; tokens: number; cost: number; inset: boolean }) {
  useConversation(session.id)
  return (
    <View
      className="min-h-[54px] flex-row items-center gap-2.5 px-4 py-3"
      style={inset ? { borderTopWidth: 0.5, borderTopColor: color.line, marginLeft: 16 } : undefined}
    >
      <View className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentHue(session.agent) }} />
      <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>
        {session.name}
      </Text>
      <Text className="shrink-0 text-[12px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
        {fmtTokens(tokens)}
      </Text>
      <Text className="w-16 shrink-0 text-right text-[13px] font-medium text-ink" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
        {fmtCost(cost)}
      </Text>
    </View>
  )
}
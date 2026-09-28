/**
 * Usage — token and cost accounting, scanned from the conversations themselves.
 *
 * The desktop `UsagePage` has no usage endpoint to call: it walks the stored
 * conversations' `usage` parts (ACP `usage_update`, Grok headless `usage`) and
 * totals them per session. This is the same scan and the same formatting, so the
 * numbers agree with the desktop for the same sessions.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'

import { getConversation, useStore } from '@app/store'
import { isInternalSession } from '@/lib/sessionState'
import { useOpenSession, type DrawerParamList } from '@app/navigation'
import { Card, CardHeader, EmptyState, Mono, PageHeader, SectionHeading } from '@app/components/ui'

interface UsageRow {
  sessionId: string
  name: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function scanUsage(sessionId: string): { inputTokens: number; outputTokens: number; costUsd: number } {
  const conversation = getConversation(sessionId)
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  for (const message of conversation.messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind !== 'usage') continue
      inputTokens += part.inputTokens ?? 0
      outputTokens += part.outputTokens ?? 0
      costUsd += part.costUsd ?? 0
    }
  }
  return { inputTokens, outputTokens, costUsd }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

function formatCost(cost: number): string {
  if (cost <= 0) return '—'
  return cost < 0.01 ? '< $0.01' : `$${cost.toFixed(2)}`
}

export function UsageScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const sessions = useStore((s) => s.sessions)
  const revisions = useStore((s) => s.revisions)
  const openSession = useOpenSession()

  const rows = React.useMemo<UsageRow[]>(
    () =>
      sessions
        .filter((session) => session.status !== 'archived' && !isInternalSession(session))
        .map((session) => ({ sessionId: session.id, name: session.name, ...scanUsage(session.id) }))
        .sort(
          (a, b) =>
            b.costUsd - a.costUsd ||
            b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
        ),
    // `revisions` re-runs the scan as usage parts stream in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, revisions],
  )

  const totals = rows.reduce(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      costUsd: sum.costUsd + row.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  )

  const measured = rows.filter((row) => row.inputTokens + row.outputTokens > 0)

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader onMenu={() => navigation.openDrawer()} title="Usage" />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <SectionHeading
          eyebrow="Manage"
          title="Token spend"
          description="Totalled from the turns your agents reported. Sessions whose CLI does not report usage stay at zero."
        />

        <Card>
          <CardHeader title="Fleet totals" />
          <View className="flex-row gap-4 p-3.5">
            <Stat label="Input" value={formatTokens(totals.inputTokens)} />
            <Stat label="Output" value={formatTokens(totals.outputTokens)} />
            <Stat label="Cost" value={formatCost(totals.costUsd)} />
          </View>
        </Card>

        <Card>
          <CardHeader title="By session" right={<Mono className="text-[11px]">{measured.length}</Mono>} />
          <View className="p-1.5">
            {rows.length === 0 ? (
              <EmptyState title="Nothing to measure" body="Open a session and let an agent take a turn." />
            ) : (
              rows.map((row) => (
                <Pressable
                  key={row.sessionId}
                  onPress={() => openSession(row.sessionId)}
                  className="min-h-12 flex-row items-center gap-3 rounded-control px-2.5 py-1.5 active:bg-hover-2"
                >
                  <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Mono className="text-[11px]" numberOfLines={1}>
                    {formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
                  </Mono>
                  <Mono className="w-16 text-right text-[11.5px] text-ink">{formatCost(row.costUsd)}</Mono>
                </Pressable>
              ))
            )}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}

/** Desktop stat block: 9.5px uppercase mono label over a large tabular figure. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1">
      <Mono className="text-[9.5px] uppercase tracking-[0.14em]">{label}</Mono>
      <Text className="text-[20px] font-semibold tracking-tight text-ink">{value}</Text>
    </View>
  )
}

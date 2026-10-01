/**
 * Usage — the full token and cost ledger.
 *
 * QAI SIGNAL DECK
 * ---------------
 * The desktop UsagePage walks stored conversations' `usage` parts and totals
 * per session — same scan, same formatting, so numbers agree. There is no
 * usage endpoint; this screen is the evidence: every session under a totals
 * slab with a signal edge, whether or not it reported, with unreported
 * sessions at `—` (the CLI did not report, which is not the same as free).
 */

import * as React from 'react'
import {Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Search } from 'lucide-react-native'

import { isInternalSession } from '@/lib/sessionState'
import { getConversation, useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { ScreenScaffold, Section, StationBackButton } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Card,
  CardHeader,
  Divider,
  EmptyState,
  Eyebrow,
  Mono,
  ProgressBar,
  SearchField,
  Stat,
  formatCost,
  formatCount,
  haptic,
} from '@app/components/ui'

interface Row {
  sessionId: string
  name: string
  agent: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

function scan(sessionId: string) {
  const conversation = getConversation(sessionId)
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let costUsd = 0
  for (const message of conversation.messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind !== 'usage') continue
      inputTokens += part.inputTokens ?? 0
      outputTokens += part.outputTokens ?? 0
      cacheReadTokens += part.cacheReadTokens ?? 0
      costUsd += part.costUsd ?? 0
    }
  }
  return { inputTokens, outputTokens, cacheReadTokens, costUsd }
}

export function UsageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((s) => s.sessions)
  const revisions = useStore((s) => s.revisions)
  const agents = useStore((s) => s.agents)
  const [query, setQuery] = React.useState('')

  const rows = React.useMemo<Row[]>(
    () =>
      sessions
        .filter((session) => session.status !== 'archived' && !isInternalSession(session))
        .map((session) => ({
          sessionId: session.id,
          name: session.name,
          agent: session.agent,
          ...scan(session.id),
        }))
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
      cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
      costUsd: sum.costUsd + row.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
  )

  const measured = rows.filter((row) => row.inputTokens + row.outputTokens > 0)
  const maxCost = Math.max(0.0001, ...rows.map((row) => row.costUsd))

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? rows.filter((row) => row.name.toLowerCase().includes(needle) || row.agent.toLowerCase().includes(needle))
    : rows

  return (
    <ScreenScaffold
      title="Usage"
      eyebrow="Manage · ledger"
      subtitle="Totalled from the turns your agents reported."
      scroll
      contentClassName="px-4 pb-12 gap-5"
      headerLeft={<StationBackButton />}
    >
      <Section eyebrow="Fleet ledger" enterIndex={0}>
        <Card className="overflow-hidden">
          {/* Signal edge: cost is the hottest fact on the page. */}
          <View style={{ height: 2, backgroundColor: palette.accent, opacity: 0.8 }} />
          {/* The header carries the reporting count rather than the footer: it
              changes how the three numbers below should be read, and a caveat
              under a number has to be read second. */}
          <CardHeader
            title="Totals"
            subtitle={`${measured.length} of ${rows.length} ${
              rows.length === 1 ? 'session reports' : 'sessions report'
            } token usage`}
          />
          <View className="flex-row items-stretch px-4 py-4">
            <Stat label="Input" value={formatCount(totals.inputTokens)} />
            <View className="mx-1 my-1 w-px bg-line" />
            <Stat label="Output" value={formatCount(totals.outputTokens)} />
            <View className="mx-1 my-1 w-px bg-line" />
            <Stat label="Cost" value={formatCost(totals.costUsd)} tone="accent" align="right" />
          </View>
          {totals.cacheReadTokens > 0 ? (
            <View className="gap-1.5 border-t border-line px-4 py-4">
              <Eyebrow>Cache reads</Eyebrow>
              <Text
                className="text-[20px] leading-[25px] font-semibold text-ink"
                style={{ letterSpacing: -0.3, fontVariant: ['tabular-nums'] }}
              >
                {formatCount(totals.cacheReadTokens)}
              </Text>
              <Text className="text-[12px] leading-[17px] text-ink-3">
                Cached prompt tokens are billed at a fraction of fresh ones, so this number is
                usually the difference between a session that looks expensive and one that is not.
              </Text>
            </View>
          ) : null}
        </Card>
      </Section>

      <Section eyebrow="By session" title={`${measured.length} of ${rows.length} reported`} enterIndex={1}>
        <View className="gap-2.5">
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Filter sessions"
            accessibilityLabel="Filter sessions by name or agent"
          />

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing to measure"
                body="Open a session and let an agent take a turn. Numbers appear as the turns report them."
                icon={<Search size={22} color={palette.ink3} />}
              />
            </Card>
          ) : (
            <Card>
              {visible.map((row, index) => (
                <View key={row.sessionId}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <UsageRow
                    row={row}
                    index={index}
                    maxCost={maxCost}
                    providerName={agents.find((agent) => agent.id === row.agent)?.name ?? row.agent}
                    onPress={() => navigation.navigate('Session', { sessionId: row.sessionId })}
                  />
                </View>
              ))}
            </Card>
          )}
        </View>
      </Section>
    </ScreenScaffold>
  )
}

function UsageRow({
  row,
  index,
  maxCost,
  providerName,
  onPress,
}: {
  row: Row
  index: number
  maxCost: number
  providerName: string
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  const unmeasured = row.inputTokens + row.outputTokens === 0

  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.name}
        accessibilityHint={
          unmeasured
            ? 'This agent did not report token usage.'
            : `${formatCount(row.inputTokens)} tokens in, ${formatCount(row.outputTokens)} out, ${formatCost(row.costUsd)}`
        }
        onPress={() => {
          void haptic('light')
          onPress()
        }}
        className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-raised"
      >
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-[15px] leading-[20px] font-medium text-ink" numberOfLines={1}>
            {row.name}
          </Text>
          <Text className="text-[11.5px] leading-[15px] text-ink-3" numberOfLines={1}>
            {providerName}
          </Text>
          {/* Same slim baseline bar as the Spend rows — the two lists are the
              same data at different densities, and they should look related. */}
          <ProgressBar value={unmeasured ? 0 : row.costUsd / maxCost} tone="accent" className="h-[2.5px]" />
        </View>
        <View className="shrink-0 items-end gap-0.5" style={{ minWidth: 82 }}>
          <Mono
            className={
              unmeasured
                ? 'text-[13px] leading-[18px] text-ink-4'
                : 'text-[13px] leading-[18px] font-semibold text-ink'
            }
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {unmeasured ? '—' : formatCost(row.costUsd)}
          </Mono>
          <Mono
            className="text-[10.5px] leading-[14px] text-ink-3"
            style={{ fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {unmeasured
              ? 'no usage reported'
              : `↑${formatCount(row.inputTokens)} ↓${formatCount(row.outputTokens)}`}
          </Mono>
        </View>
      </Pressable>
    </View>
  )
}

export { radius }

/**
 * Usage — the full token and cost breakdown.
 *
 * The desktop `UsagePage` has no usage endpoint to call: it walks the stored
 * conversations' `usage` parts (ACP `usage_update`, Grok headless `usage`) and
 * totals them per session. This is the same scan and the same formatting, so
 * the numbers agree with the browser for the same sessions.
 *
 * The Activity tab already carries the totals and a cost-sorted list, which is
 * the *answer*. This screen is the *evidence*: every session, whether or not it
 * reported anything, with the difference made explicit rather than shown as a
 * confident zero. A session at `—` means the CLI did not report usage, which
 * is a different fact from a session that cost nothing, and conflating the two
 * is how a fleet looks cheaper than it is.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Search } from 'lucide-react-native'

import { isInternalSession } from '@/lib/sessionState'
import { getConversation, useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { BackButton, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Card,
  CardHeader,
  Divider,
  EmptyState,
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
      eyebrow="Manage"
      subtitle="Totalled from the turns your agents reported."
      scroll
      contentClassName="px-4 pb-12 gap-5"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back" />}
    >
      <Section eyebrow="Fleet" title="Totals" enterIndex={0}>
        <Card>
          {/* The header carries the reporting count rather than the footer: it
              changes how the three numbers below should be read, and a caveat
              under a number has to be read second. */}
          <CardHeader
            title="Totals"
            subtitle={`${measured.length} of ${rows.length} ${
              rows.length === 1 ? 'session reports' : 'sessions report'
            } token usage`}
          />
          <View style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
            <Stat label="Input" value={formatCount(totals.inputTokens)} />
            <Stat label="Output" value={formatCount(totals.outputTokens)} />
            <Stat label="Cost" value={formatCost(totals.costUsd)} tone="accent" align="right" />
          </View>
          {totals.cacheReadTokens > 0 ? (
            <View style={{ borderTopWidth: 1, borderTopColor: palette.line, padding: 16, gap: 6 }}>
              <Text className="text-[11px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 1.1 }}>
                Cache reads
              </Text>
              <Text
                style={{
                  color: palette.ink,
                  fontSize: 20,
                  fontWeight: '600',
                  fontVariant: ['tabular-nums'],
                }}
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
        <View style={{ gap: 10 }}>
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
              <View style={{ paddingVertical: 4 }}>
                {visible.map((row, index) => (
                  <UsageRow
                    key={row.sessionId}
                    row={row}
                    index={index}
                    maxCost={maxCost}
                    providerName={agents.find((agent) => agent.id === row.agent)?.name ?? row.agent}
                    onPress={() => navigation.navigate('Session', { sessionId: row.sessionId })}
                  />
                ))}
              </View>
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
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text className="text-[14.5px] font-medium text-ink" numberOfLines={1}>
            {row.name}
          </Text>
          <Text className="text-[11.5px] text-ink-3" numberOfLines={1}>
            {providerName}
          </Text>
          <ProgressBar value={unmeasured ? 0 : row.costUsd / maxCost} tone="accent" />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 82 }}>
          <Text
            style={{
              color: unmeasured ? palette.ink4 : palette.ink,
              fontSize: 13.5,
              fontWeight: '600',
              fontVariant: ['tabular-nums'],
            }}
          >
            {unmeasured ? '—' : formatCost(row.costUsd)}
          </Text>
          <Text
            style={{
              color: palette.ink3,
              fontSize: 10.5,
              fontVariant: ['tabular-nums'],
            }}
            numberOfLines={1}
          >
            {unmeasured
              ? 'no usage reported'
              : `↑${formatCount(row.inputTokens)} ↓${formatCount(row.outputTokens)}`}
          </Text>
        </View>
      </Pressable>
      <Divider inset={16} />
    </View>
  )
}

export { radius }

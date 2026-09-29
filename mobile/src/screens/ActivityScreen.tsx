/**
 * Activity — what this station has run, and what it cost.
 *
 * THE TWO PAGES MERGED, AND WHY
 * -----------------------------
 * The desktop has separate `History` and `Usage` destinations. On a phone they
 * are the same question asked twice — "what did it do, and what did that cost"
 * — and a session's tokens and its last turn are both facts about the same
 * object. Splitting them means the answer to either question is a tab away from
 * the other half of the answer, which on a phone is two screens and a
 * decision.
 *
 * So this is one screen with a two-way switch:
 *
 *   - **Sessions** is the chronological record, grouped by day, newest first.
 *     Exactly the desktop's `HistoryPage` row-for-row, so the two agree.
 *   - **Spend** is the same sessions sorted by cost, with the fleet totals on
 *     top, because "which session is costing me money" is a different sort of
 *     the same list rather than a different list.
 *
 * Nothing is thrown away: the full usage table is still a tab away and is
 * exactly the same data, just laid out for comparison rather than for
 * browsing.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { BarChart3, History } from 'lucide-react-native'

import { isInternalSession } from '@/lib/sessionState'
import { basename } from '@/lib/format'
import type { Session } from '@/types/session'
import { getConversation, useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Card,
  CardHeader,
  Divider,
  EmptyState,
  ProgressBar,
  Segmented,
  Skeleton,
  Stat,
  formatCost,
  formatCount,
  haptic,
} from '@app/components/ui'
import { SessionRow } from '@app/components/session/SessionRow'

type Mode = 'sessions' | 'spend'

/** Desktop `relativeDay`: Today / Yesterday / Nd / a short date. */
function relativeDay(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface Spend {
  sessionId: string
  name: string
  agent: string
  project: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * Totals per session, scanned from the conversations' `usage` parts.
 *
 * There is no usage endpoint to call — this is the desktop's `UsagePage` scan,
 * ported exactly, so the numbers agree with the browser for the same sessions.
 * The important honesty is in the copy: a session whose CLI never reported usage
 * stays at zero, and saying so beats showing a confident `0.00` that means
 * "we do not know" rather than "it was free".
 */
function scanSpend(sessionId: string): { inputTokens: number; outputTokens: number; costUsd: number } {
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

export function ActivityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((s) => s.sessions)
  const revisions = useStore((s) => s.revisions)
  const starred = useStore((s) => s.starred)
  const sessionsLoading = useStore((s) => s.sessionsLoading)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const agents = useStore((s) => s.agents)

  const [mode, setMode] = React.useState<Mode>('sessions')
  const [refreshing, setRefreshing] = React.useState(false)

  const providerName = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  const visible = React.useMemo(
    () =>
      sessions
        .filter((session) => session.status !== 'archived' && !isInternalSession(session))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [sessions],
  )

  const groups = React.useMemo(() => {
    const byDay = new Map<string, Session[]>()
    for (const session of visible) {
      const key = relativeDay(session.updated_at)
      const list = byDay.get(key)
      if (list) list.push(session)
      else byDay.set(key, [session])
    }
    return [...byDay.entries()]
  }, [visible])

  const spend = React.useMemo<Spend[]>(
    () =>
      visible.map((session) => ({
        sessionId: session.id,
        name: session.name,
        agent: session.agent,
        project: session.project,
        ...scanSpend(session.id),
      })),
    // `revisions` re-runs the scan as usage parts stream in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, revisions],
  )

  const ranked = React.useMemo(
    () =>
      [...spend].sort(
        (a, b) =>
          b.costUsd - a.costUsd ||
          b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
      ),
    [spend],
  )

  const totals = React.useMemo(
    () =>
      ranked.reduce(
        (sum, row) => ({
          inputTokens: sum.inputTokens + row.inputTokens,
          outputTokens: sum.outputTokens + row.outputTokens,
          costUsd: sum.costUsd + row.costUsd,
        }),
        { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      ),
    [ranked],
  )

  const measured = ranked.filter((row) => row.inputTokens + row.outputTokens > 0)
  const maxCost = Math.max(0.0001, ...ranked.map((row) => row.costUsd))

  async function onRefresh() {
    setRefreshing(true)
    try {
      await loadSnapshot()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ScreenScaffold
      title="Activity"
      eyebrow={sessionsLoading ? 'Loading' : `${visible.length} ${visible.length === 1 ? 'session' : 'sessions'}`}
      subtitle={
        mode === 'sessions'
          ? 'Everything this station has run, newest first.'
          : 'Token spend, totalled from the turns your agents reported.'
      }
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="pb-10"
      below={
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Segmented
              label="Activity view"
              value={mode}
              onChange={(value) => {
                void haptic('select')
                setMode(value as Mode)
              }}
              options={[
                { value: 'sessions', label: 'Sessions' },
                { value: 'spend', label: 'Spend' },
              ]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the full usage breakdown"
            onPress={() => navigation.navigate('Usage')}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 46,
              height: 46,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: palette.line,
              backgroundColor: pressed ? palette.raised : 'transparent',
            })}
          >
            <BarChart3 size={18} color={palette.ink2} />
          </Pressable>
        </View>
      }
    >
      {mode === 'sessions' ? (
        <View style={{ gap: 18 }}>
          {sessionsLoading && visible.length === 0 ? (
            <Card>
              <View style={{ padding: 8 }}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
                    <Skeleton width={34} height={34} radius={12} />
                    <View style={{ flex: 1, gap: 8 }}>
                      <Skeleton width="58%" height={13} />
                      <Skeleton width="36%" height={10} />
                    </View>
                    <Skeleton width={62} height={20} radius={10} />
                  </View>
                ))}
              </View>
            </Card>
          ) : groups.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing yet"
                body="Sessions you run on the desktop appear here, newest first."
                icon={<History size={22} color={palette.ink3} />}
              />
            </Card>
          ) : (
            groups.map(([title, rows], groupIndex) => (
              <Section
                key={title}
                eyebrow={`${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}`}
                title={title}
                enterIndex={groupIndex}
              >
                <Card>
                  {rows.map((session, index) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      enterIndex={index}
                      providerName={providerName(session.agent)}
                      starred={starred.includes(session.id)}
                      onOpen={() => navigation.navigate('Session', { sessionId: session.id })}
                    />
                  ))}
                </Card>
              </Section>
            ))
          )}
        </View>
      ) : (
        <View style={{ gap: 18 }}>
          {/* The header carries the *reporting* count, because that is the
              number a reader needs before the totals: "12 sessions, 7 of them
              reported" changes how the total below it should be read, and
              putting it below the total asks them to un-read the number first. */}
          <Section eyebrow="Fleet" title="Totals" enterIndex={0}>
            <Card>
              <CardHeader
                title="Totals"
                subtitle={`${measured.length} of ${ranked.length} ${
                  ranked.length === 1 ? 'session reports' : 'sessions report'
                } token usage`}
              />
              <View style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
                <Stat label="Input" value={formatCount(totals.inputTokens)} />
                <Stat label="Output" value={formatCount(totals.outputTokens)} />
                <Stat label="Cost" value={formatCost(totals.costUsd)} tone="accent" align="right" />
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  borderTopWidth: 1,
                  borderTopColor: palette.line,
                  padding: 14,
                }}
              >
                <Text className="flex-1 text-[12.5px] leading-[17px] text-ink-3">
                  {measured.length === 0
                    ? 'Nothing has reported usage yet. A session stays at zero when its CLI does not report tokens.'
                    : `${measured.length} of ${ranked.length} sessions reported usage. The rest cost nothing because their CLI does not report it — not because they were free.`}
                </Text>
              </View>
            </Card>
          </Section>

          {ranked.length === 0 ? (
            <Card>
              <EmptyState title="Nothing to measure" body="Open a session and let an agent take a turn." />
            </Card>
          ) : (
            <Section eyebrow="By cost" title={`${ranked.length} sessions`} enterIndex={1}>
              <Card>
                <View style={{ paddingVertical: 4 }}>
                  {ranked.map((row, index) => (
                    <SpendRow
                      key={row.sessionId}
                      row={row}
                      index={index}
                      maxCost={maxCost}
                      providerName={providerName(row.agent)}
                      onPress={() => navigation.navigate('Session', { sessionId: row.sessionId })}
                    />
                  ))}
                </View>
              </Card>
            </Section>
          )}
        </View>
      )}
    </ScreenScaffold>
  )
}

function SpendRow({
  row,
  index,
  maxCost,
  providerName,
  onPress,
}: {
  row: Spend
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
        accessibilityHint={`${formatCount(row.inputTokens)} tokens in, ${formatCount(row.outputTokens)} out, ${formatCost(row.costUsd)}`}
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
            {row.project ? ` · ${basename(row.project)}` : ''}
          </Text>
          {/* The bar is a *proportion of the most expensive session*, not of
              the total, so the top row is always full and the shape of the
              distribution is readable at a glance. */}
          <ProgressBar value={unmeasured ? 0 : row.costUsd / maxCost} tone="accent" />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3, minWidth: 74 }}>
          <Text style={{ color: palette.ink, fontSize: 13.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
            {unmeasured ? '—' : formatCost(row.costUsd)}
          </Text>
          <Text style={{ color: palette.ink3, fontSize: 10.5, fontVariant: ['tabular-nums'] }}>
            {unmeasured ? 'not reported' : `↑${formatCount(row.inputTokens)} ↓${formatCount(row.outputTokens)}`}
          </Text>
        </View>
      </Pressable>
      {index > -1 ? <Divider inset={16} /> : null}
    </View>
  )
}

export { Badge }

/**
 * Activity — what this kiln has fired, and what it cost.
 *
 * EMBER CLAY
 * ----------
 * The desktop's History and Usage are one question asked twice — "what did it
 * do, and what did that cost". This stays one screen with a kiln switch:
 * Sessions (chronological, grouped by day, newest first) and Spend (same
 * sessions sorted by cost, fleet totals on a lit slab on top). The totals card
 * carries an ember edge because cost is the hottest fact on the page. Nothing
 * is thrown away: the full usage breakdown is one tap away on the same data.
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
import { palette } from '@app/design/tokens'
import { ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Card,
  CardHeader,
  Divider,
  EmptyState,
  IconButton,
  ProgressBar,
  Segmented,
  Stat,
  Mono,
  formatCost,
  formatCount,
  haptic,
} from '@app/components/ui'
import { SessionListSkeleton, SessionRow } from '@app/components/session/SessionRow'

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
        <View className="flex-row items-center gap-2.5">
          <View className="flex-1">
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
          <IconButton
            label="Open the full usage breakdown"
            size={46}
            className="border border-line"
            onPress={() => navigation.navigate('Usage')}
          >
            <BarChart3 size={19} color={palette.ink2} />
          </IconButton>
        </View>
      }
    >
      {mode === 'sessions' ? (
        <View className="gap-5">
          {sessionsLoading && visible.length === 0 ? (
            <SessionListSkeleton count={5} />
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
                eyebrow={title}
                enterIndex={groupIndex}
                action={
                  <Text
                    className="pb-0.5 text-[11px] font-medium text-ink-4"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {rows.length}
                  </Text>
                }
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
        <View className="gap-5">
          {/* The header carries the *reporting* count, because that is the
              number a reader needs before the totals: "12 sessions, 7 of them
              reported" changes how the total below it should be read, and
              putting it below the total asks them to un-read the number first. */}
          <Section eyebrow="Kiln totals" enterIndex={0}>
            <Card className="overflow-hidden">
              <View style={{ height: 3, backgroundColor: palette.accent, opacity: 0.9 }} />
              <CardHeader
                title="Totals"
                subtitle={`${measured.length} of ${ranked.length} ${
                  ranked.length === 1 ? 'session reports' : 'sessions report'
                } token usage`}
              />
              <View className="flex-row items-stretch px-4 py-4">
                <Stat label="Input" value={formatCount(totals.inputTokens)} />
                <View className="mx-1 my-1 w-px bg-line" />
                <Stat label="Output" value={formatCount(totals.outputTokens)} />
                <View className="mx-1 my-1 w-px bg-line" />
                <Stat label="Cost" value={formatCost(totals.costUsd)} tone="accent" align="right" />
              </View>
              <View className="border-t border-line px-4 py-3">
                <Text className="text-[12.5px] leading-[17px] text-ink-3">
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
                {ranked.map((row, index) => (
                  <View key={row.sessionId}>
                    {index > 0 ? <Divider inset={16} /> : null}
                    <SpendRow
                      row={row}
                      index={index}
                      maxCost={maxCost}
                      providerName={providerName(row.agent)}
                      onPress={() => navigation.navigate('Session', { sessionId: row.sessionId })}
                    />
                  </View>
                ))}
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
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-[15px] leading-[20px] font-medium text-ink" numberOfLines={1}>
            {row.name}
          </Text>
          <Text className="text-[11.5px] leading-[15px] text-ink-3" numberOfLines={1}>
            {providerName}
            {row.project ? ` · ${basename(row.project)}` : ''}
          </Text>
          {/* The bar is a *proportion of the most expensive session*, not of
              the total, so the top row is always full and the shape of the
              distribution is readable at a glance. Slim, because it is the
              row's baseline, not its headline. */}
          <ProgressBar value={unmeasured ? 0 : row.costUsd / maxCost} tone="accent" className="h-[2.5px]" />
        </View>
        <View className="shrink-0 items-end gap-0.5" style={{ minWidth: 74 }}>
          <Mono
            className={
              unmeasured
                ? 'text-[13.5px] leading-[18px] text-ink-4'
                : 'text-[13.5px] leading-[18px] font-semibold text-ink'
            }
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {unmeasured ? '—' : formatCost(row.costUsd)}
          </Mono>
          <Mono className="text-[10.5px] leading-[14px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
            {unmeasured ? 'not reported' : `↑${formatCount(row.inputTokens)} ↓${formatCount(row.outputTokens)}`}
          </Mono>
        </View>
      </Pressable>
    </View>
  )
}

export { Badge }

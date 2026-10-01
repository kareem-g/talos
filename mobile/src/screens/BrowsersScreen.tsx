/**
 * Browser engines — the CDP fleet view.
 *
 * QAI SIGNAL DECK
 * ---------------
 * Same page as the desktop BrowsersPage against the same start/stop handlers,
 * restructured as scannable rows: workspace + URL lead (an engine is
 * per-workspace, and one live engine serves several sessions), engine state
 * as a start/stop control on the right. Row opens the session; control
 * toggles the engine. Two targets, two meanings. The fleet header counts live
 * engines honestly — no engine is shown as running that is not.
 */

import * as React from 'react'
import {
  Animated,
  Pressable,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Globe, Play, Square } from 'lucide-react-native'

import { basename } from '@/lib/format'
import { browserApi, type BrowserInstance } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { useStore } from '@app/store'
import { palette } from '@app/design/tokens'
import { Card, ListCard, ScreenScaffold, Section, StationBackButton } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Chevron,
  Dot,
  EmptyState,
  ErrorState,
  IconTile,
  IconButton,
  Mono,
  haptic,
  toast,
} from '@app/components/ui'

export function BrowsersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((state) => state.sessions)
  const agents = useStore((state) => state.agents)
  const [instances, setInstances] = React.useState<BrowserInstance[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setInstances((await browserApi.status()).sessions ?? [])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read browser status')
    }
  }, [])

  React.useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [load])

  const withProject = React.useMemo(
    () => sessions.filter((session) => session.project && session.status !== 'archived'),
    [sessions],
  )

  const providerName = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  async function toggle(sessionId: string, running: boolean) {
    setBusy(sessionId)
    try {
      if (running) await browserApi.stop(sessionId)
      else await browserApi.start(sessionId)
      await load()
      toast({ message: running ? 'Engine stopped' : 'Engine started', tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'That action failed',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  const runningCount = instances.filter((instance) => instance.running || instance.url).length

  return (
    <ScreenScaffold
      title="Browser engines"
      eyebrow="Products"
      subtitle="One shared engine per workspace. The agent drives it over MCP; you can drive it by hand from a session's tools."
      onRefresh={() => {
        setRefreshing(true)
        void load().finally(() => setRefreshing(false))
      }}
      refreshing={refreshing}
      scroll
      contentClassName="pb-12 gap-6"
      headerLeft={<StationBackButton />}
    >
      {error ? (
        <View className="mx-4">
          <ErrorState message={error} onRetry={() => void load()} retryLabel="Retry" />
        </View>
      ) : null}

      {withProject.length === 0 ? (
        <Card>
          <EmptyState
            title="No sessions with a workspace"
            body="An engine needs a project to serve, so one appears here once a session has a folder."
            icon={<Globe size={22} color={palette.ink3} />}
          />
        </Card>
      ) : (
        <Section
          eyebrow="Engine fleet"
          title={`${runningCount} of ${withProject.length} ${withProject.length === 1 ? 'engine' : 'engines'} running`}
          enterIndex={0}
        >
          <ListCard inset={64}>
            {withProject.map((session, index) => {
              const instance = instances.find((candidate) => candidate.session_id === session.id)
              const running = Boolean(instance?.running || instance?.url)
              return (
                <EngineRow
                  key={session.id}
                  name={session.name}
                  providerName={providerName(session.agent)}
                  url={instance?.url ?? basename(session.project ?? 'workspace')}
                  running={running}
                  busy={busy === session.id}
                  disabled={busy !== null && busy !== session.id}
                  index={index}
                  onOpen={() => navigation.navigate('Session', { sessionId: session.id })}
                  onToggle={() => void toggle(session.id, running)}
                />
              )
            })}
          </ListCard>
        </Section>
      )}
    </ScreenScaffold>
  )
}

/**
 * One engine row, two targets.
 *
 * The row body opens the session; the trailing square control starts or stops
 * the engine. The control stays a separate pressable from the row — nesting
 * them would make the stop button also open the session — and it is disabled
 * (not hidden) while any other engine is mid-toggle, so the column of controls
 * never reflows.
 */
function EngineRow({
  name,
  providerName,
  url,
  running,
  busy,
  disabled,
  index,
  onOpen,
  onToggle,
}: {
  name: string
  providerName: string
  url: string
  running: boolean
  busy: boolean
  disabled: boolean
  index: number
  onOpen: () => void
  onToggle: () => void
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 5)), false)
  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          accessibilityHint={`${running ? 'Engine running' : 'Engine stopped'}. Opens the session.`}
          onPress={() => {
            void haptic('light')
            onOpen()
          }}
          className="min-h-16 flex-1 flex-row items-center gap-3 px-4 py-3 active:bg-raised"
        >
          <IconTile
            icon={<Globe size={16} color={running ? palette.ok : palette.ink2} />}
            tone={running ? 'ok' : 'muted'}
          />
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="min-w-0 flex-1 text-[14.5px] leading-[20px] font-semibold text-ink"
                numberOfLines={1}
              >
                {name}
              </Text>
              <Badge tone={running ? 'ok' : 'muted'} outline>
                {running ? 'running' : 'stopped'}
              </Badge>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Dot tone={running ? 'ok' : 'muted'} />
              <Mono className="min-w-0 flex-1 text-[11.5px] leading-[16px]" numberOfLines={1}>
                {url}
              </Mono>
            </View>
            <Text className="text-[11px] leading-[15px] text-ink-3" numberOfLines={1}>
              {providerName}
            </Text>
          </View>
          <Chevron />
        </Pressable>

        <IconButton
          label={running ? `Stop the engine for ${name}` : `Start the engine for ${name}`}
          size={44}
          disabled={disabled || busy}
          style={{ marginRight: 8 }}
          onPress={() => {
            void haptic('medium')
            onToggle()
          }}
        >
          {busy ? (
            <View
              className="size-3.5 rounded-full"
              style={{ borderWidth: 2, borderColor: palette.ink4, borderTopColor: 'transparent' }}
            />
          ) : running ? (
            <Square size={14} color={palette.danger} fill={palette.danger} />
          ) : (
            <Play size={16} color={palette.ok} fill={palette.ok} />
          )}
        </IconButton>
      </View>
    </Animated.View>
  )
}

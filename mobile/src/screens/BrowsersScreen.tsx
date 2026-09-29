/**
 * Browser engines — the fleet view.
 *
 * The desktop `BrowsersPage` lists every session that has a workspace and lets
 * you start or stop its CDP engine. This is the same page against the same
 * handlers, restructured for a list you scan rather than a table you read.
 *
 * The interesting state is not "running" or "stopped" — it is *which workspace
 * is using the engine right now*, because engines are per-workspace and one
 * running engine can be several sessions' worth of browser. So the row leads
 * with the workspace and its URL, and the engine state is a control on the
 * right rather than a label. Tapping the row opens the session; tapping the
 * control toggles the engine. Two targets, two meanings, no ambiguity.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ChevronRight, Globe, Play, Square } from 'lucide-react-native'

import { basename } from '@/lib/format'
import { browserApi, type BrowserInstance } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { BackButton, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Button,
  Card,
  Divider,
  Dot,
  EmptyState,
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
      contentClassName="px-4 pb-12 gap-5"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to settings" />}
    >
      {error ? (
        <View
          accessible
          accessibilityRole="alert"
          style={{
            gap: 9,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.dangerBorder,
            backgroundColor: palette.dangerSoft,
            padding: 14,
          }}
        >
          <Text className="text-[13.5px] font-semibold text-ink">{error}</Text>
          <Button label="Retry" size="sm" variant="secondary" onPress={() => void load()} />
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
          eyebrow="Fleet"
          title={`${runningCount} of ${withProject.length} ${withProject.length === 1 ? 'engine' : 'engines'} running`}
          enterIndex={0}
        >
          <Card>
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
          </Card>
        </Section>
      )}
    </ScreenScaffold>
  )
}

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
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      {index > 0 ? <Divider inset={16} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: running ? palette.okSoft : palette.raised,
            }}
          >
            <Globe size={16} color={running ? palette.ok : palette.ink3} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
                {name}
              </Text>
              <Badge tone={running ? 'ok' : 'muted'} outline>
                {running ? 'running' : 'stopped'}
              </Badge>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Dot tone={running ? 'ok' : 'muted'} />
              <Mono className="min-w-0 flex-1 text-[11.5px]" numberOfLines={1}>
                {url}
              </Mono>
            </View>
            <Text className="text-[11px] text-ink-4">{providerName}</Text>
          </View>
          <ChevronRight size={16} color={palette.ink4} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={running ? `Stop the engine for ${name}` : `Start the engine for ${name}`}
          disabled={disabled || busy}
          onPress={() => {
            void haptic('medium')
            onToggle()
          }}
          style={({ pressed }) => ({
            width: 46,
            height: 46,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: pressed ? palette.hover : 'transparent',
            opacity: disabled ? 0.4 : 1,
          })}
        >
          {busy ? (
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                borderWidth: 2,
                borderColor: palette.ink4,
                borderTopColor: 'transparent',
              }}
            />
          ) : running ? (
            <Square size={14} color={palette.danger} fill={palette.danger} />
          ) : (
            <Play size={16} color={palette.ok} fill={palette.ok} />
          )}
        </Pressable>
      </View>
    </View>
  )
}

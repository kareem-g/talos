/**
 * Browsers — the fleet view of the built-in browser engine.
 *
 * The desktop `BrowsersPage` lists every session that has a workspace and lets you
 * start or stop its CDP engine; this is the same page against the same handlers.
 * The per-session live view (screenshot mirror, manual tool calls) is the session
 * rail's Browser tab, exactly as on the desktop.
 */

import * as React from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'

import { basename } from '@/lib/format'
import type { DrawerParamList } from '@app/navigation'
import { browserApi, type BrowserInstance } from '@app/lib/api'
import { useStore } from '@app/store'
import { Button, Card, CardHeader, Chip, Dot, EmptyState, Mono, PageHeader } from '@app/components/ui'
import { palette } from '@app/design/tokens'

export function BrowsersScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const sessions = useStore((state) => state.sessions)
  const [instances, setInstances] = React.useState<BrowserInstance[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

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

  const withProject = sessions.filter((session) => session.project && session.status !== 'archived')

  async function toggle(sessionId: string, running: boolean) {
    setBusy(sessionId)
    setError(null)
    try {
      if (running) await browserApi.stop(sessionId)
      else await browserApi.start(sessionId)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader onMenu={() => navigation.openDrawer()} title="Browsers" />
      <FlatList
        data={withProject}
        keyExtractor={(session) => session.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load().finally(() => setRefreshing(false))
            }}
            tintColor={palette.ink3}
          />
        }
        ListHeaderComponent={
          <View className="gap-1 p-4">
            <Mono className="text-[10.5px] uppercase tracking-[0.16em] text-ink-3">Products</Mono>
            <Text className="text-[20px] font-semibold tracking-tight text-ink">Browser engines</Text>
            <Text className="text-[12.5px] leading-5 text-ink-2">
              One shared engine per workspace. The agent drives it over MCP; you can drive it by hand
              from a session's Browser tab.
            </Text>
            {error ? <Text className="mt-1 text-[11.5px] text-red">{error}</Text> : null}
          </View>
        }
        renderItem={({ item }) => {
          const instance = instances.find((candidate) => candidate.session_id === item.id)
          const running = Boolean(instance?.running || instance?.url)
          return (
            <View className="px-4 pb-3">
              <Card>
                <CardHeader
                  title={item.name}
                  right={<Chip tone={running ? 'green' : 'dim'} label={running ? 'running' : 'stopped'} />}
                />
                <View className="gap-2 p-3">
                  <View className="flex-row items-center gap-2">
                    <Dot tone={running ? 'green' : 'dim'} />
                    <Mono className="min-w-0 flex-1 text-[11px]" numberOfLines={1}>
                      {instance?.url ?? basename(item.project ?? 'workspace')}
                    </Mono>
                  </View>
                  <Button
                    variant={running ? 'danger' : 'surface'}
                    label={busy === item.id ? '…' : running ? 'Stop engine' : 'Start engine'}
                    disabled={busy !== null}
                    className="self-start"
                    onPress={() => void toggle(item.id, running)}
                  />
                </View>
              </Card>
            </View>
          )
        }}
        ListEmptyComponent={
          <EmptyState
            title="No sessions with a workspace"
            body="A browser engine needs a project to serve, so it appears once a session has one."
          />
        }
        contentContainerClassName="pb-10"
      />
    </SafeAreaView>
  )
}

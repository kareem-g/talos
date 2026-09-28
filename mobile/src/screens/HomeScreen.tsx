/**
 * Home — the session list (the phone's control deck).
 *
 * Renders each session's true UI state from the shared `sessionState` machine
 * (connection + status + open approvals merged), sorts by urgency so anything
 * blocked on the user floats to the top, and pulls to refresh. Phase D grows
 * this into the full Station home (triage timeline, workspace groups,
 * quick-launch); the ranking and status derivation already come from the same
 * pure logic the desktop uses, so the behaviour matches.
 */

import * as React from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Settings } from 'lucide-react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useStore, useConversation } from '@app/store'
import { isInternalSession, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import type { RootStackParamList } from '@app/navigation'
import { EmptyState, ScreenHeader, Spinner, StatusPill } from '@app/components/ui'

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>

/**
 * Urgency proxy for list ordering, keyed on the backend status. The full
 * `uiStateRank` needs each session's conversation (open approvals), which is a
 * per-row hook; for ordering the list this status ranking is enough and keeps the
 * sort cheap. Anything blocked on the user or failed floats to the top.
 */
const STATUS_RANK: Record<string, number> = {
  waiting_for_approval: 0,
  error: 0,
  waiting_for_input: 1,
  running: 2,
  starting: 2,
  resuming: 2,
  idle: 3,
  needs_resume: 3,
  paused: 3,
  exited: 4,
  archived: 5,
}

function ConnectionLabel({ connection }: { connection: string }) {
  const tone =
    connection === 'connected'
      ? 'green'
      : connection === 'reconnecting' || connection === 'connecting'
        ? 'orange'
        : 'red'
  const label =
    connection === 'connected'
      ? 'Connected'
      : connection === 'reconnecting' || connection === 'connecting'
        ? 'Reconnecting'
        : connection === 'offline'
          ? 'Offline'
          : 'Disconnected'
  return <StatusPill tone={tone} label={label} pulse={tone === 'orange'} />
}

function SessionRow({ session, onPress }: { session: Session; onPress: () => void }) {
  const conversation = useConversation(session.id)
  const connection = useStore((state) => state.connection)
  const uiState = sessionUIState(session, conversation, connection)
  const display = uiStateDisplay(uiState)

  return (
    <Pressable onPress={onPress} className="flex-row items-center border-b border-line px-4 py-3 active:bg-hover">
      <View className="flex-1 pr-3">
        <Text className="text-[15px] font-medium text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <Text className="mt-0.5 text-xs text-ink-3" numberOfLines={1}>
          {session.agent}
          {session.project ? ` · ${session.project.split('/').pop()}` : ''}
          {display.hint ? ` · ${display.hint}` : ''}
        </Text>
      </View>
      <StatusPill tone={display.tone} label={display.label} pulse={display.pulse} />
    </Pressable>
  )
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>()
  const sessions = useStore((state) => state.sessions)
  const sessionsLoading = useStore((state) => state.sessionsLoading)
  const connection = useStore((state) => state.connection)
  const desktopName = useStore((state) => state.desktopName)
  const loadSnapshot = useStore((state) => state.loadSnapshot)
  const [refreshing, setRefreshing] = React.useState(false)

  // User-facing sessions only, most-needs-attention first.
  const visible = React.useMemo(
    () =>
      sessions
        .filter((session) => !isInternalSession(session))
        .sort((a, b) => (STATUS_RANK[a.status] ?? 6) - (STATUS_RANK[b.status] ?? 6)),
    [sessions],
  )

  async function onRefresh() {
    setRefreshing(true)
    await loadSnapshot()
    setRefreshing(false)
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <ScreenHeader
        title="AgentDeck"
        subtitle={desktopName}
        right={
          <>
            <ConnectionLabel connection={connection} />
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              className="ml-2 rounded-lg p-1.5 active:bg-hover"
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Settings size={18} color="#b0b0b6" />
            </Pressable>
          </>
        }
      />
      {visible.length === 0 && sessionsLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(session) => session.id}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              onPress={() => navigation.navigate('Session', { sessionId: item.id })}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7e7e86" />
          }
          ListEmptyComponent={
            <EmptyState
              title="No sessions yet"
              body="Start an agent on your desktop and it will show up here. Pull to refresh."
            />
          }
        />
      )}
    </SafeAreaView>
  )
}

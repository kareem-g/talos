/**
 * History — every session, grouped by day, newest first.
 *
 * The desktop `HistoryPage` is the same screen: a flat chronological record of
 * what the station has run, with each row opening the session. Grouping labels
 * (Today / Yesterday / Nd / date) and the row shape match the desktop rail's
 * History section.
 */

import * as React from 'react'
import { Pressable, SectionList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'

import { useConversation, useStore } from '@app/store'
import { isInternalSession, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { basename } from '@/lib/format'
import type { Session } from '@/types/session'
import { useOpenSession, type DrawerParamList } from '@app/navigation'
import { Dot, EmptyState, Mono, PageHeader, StatusPill } from '@app/components/ui'

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

export function HistoryScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const sessions = useStore((s) => s.sessions)
  const openSession = useOpenSession()

  const sections = React.useMemo(() => {
    const visible = sessions
      .filter((session) => session.status !== 'archived' && !isInternalSession(session))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const byDay = new Map<string, Session[]>()
    for (const session of visible) {
      const key = relativeDay(session.updated_at)
      const list = byDay.get(key)
      if (list) list.push(session)
      else byDay.set(key, [session])
    }
    return [...byDay.entries()].map(([title, data]) => ({ title, data }))
  }, [sessions])

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader onMenu={() => navigation.openDrawer()} title="History" />
      <SectionList
        sections={sections}
        keyExtractor={(session) => session.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View className="bg-canvas px-4 pb-1 pt-4">
            <Mono className="text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{section.title}</Mono>
          </View>
        )}
        renderItem={({ item }) => <HistoryRow session={item} onPress={() => openSession(item.id)} />}
        ListEmptyComponent={
          <EmptyState title="Nothing yet" body="Sessions you run on the desktop appear here, newest first." />
        }
        contentContainerClassName="pb-10"
      />
    </SafeAreaView>
  )
}

function HistoryRow({ session, onPress }: { session: Session; onPress: () => void }) {
  const connection = useStore((s) => s.connection)
  // Subscribes to this session's revisions, so an approval arriving live flips
  // the row from "Working" to "Needs approval" without a list refresh.
  const conversation = useConversation(session.id)
  const display = uiStateDisplay(sessionUIState(session, conversation, connection))

  return (
    <Pressable
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-2 border-b border-line px-4 py-2.5 active:bg-hover"
    >
      <Dot tone={display.tone} pulse={display.pulse} />
      <View className="min-w-0 flex-1">
        <Text className="text-[13.5px] text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <Mono className="mt-0.5 text-[11px]" numberOfLines={1}>
          {session.agent}
          {session.project ? ` · ${basename(session.project)}` : ''}
        </Mono>
      </View>
      <StatusPill tone={display.tone} label={display.label} pulse={display.pulse} />
    </Pressable>
  )
}

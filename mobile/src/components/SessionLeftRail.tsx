/**
 * Left rail — the session's context panel, mirroring the desktop `LeftSidebar`.
 *
 * Same contents in the same order: the workspace with a "new session here"
 * action, a session search, the "needs your attention" list, the session list for
 * switching without leaving the chat, and rooms. On the desktop this is a fixed
 * column beside the transcript; on a phone it is a sheet, which is what the
 * desktop itself does below its `lg` breakpoint.
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Plus, Search, Waypoints, X } from 'lucide-react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { basename, cn, relativeTime } from '@/lib/format'
import { isInternalSession, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { RootStackParamList } from '@app/navigation'
import { roomsApi } from '@app/lib/api'
import { getConversation, useStore } from '@app/store'
import { Button, Dot, GlassSurface, IconButton, Mono, SectionLabel, TextField } from '@app/components/ui'
import { palette } from '@app/design/tokens'

export function SessionLeftRail({
  open,
  onClose,
  sessionId,
  onNewTask,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  onNewTask: () => void
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)
  const current = sessions.find((session) => session.id === sessionId)
  const [query, setQuery] = React.useState('')
  const [rooms, setRooms] = React.useState<Array<{ id: string; name: string; session_id?: string }>>([])

  React.useEffect(() => {
    if (!open) return
    roomsApi
      .list()
      .then((result) => setRooms(result.rooms ?? []))
      .catch(() => setRooms([]))
  }, [open])

  const project = current?.project ?? null
  const inWorkspace = sessions.filter(
    (session) => !isInternalSession(session) && (project ? session.project === project : true),
  )

  const needle = query.trim().toLowerCase()
  const visible = inWorkspace
    .filter((session) => session.status !== 'archived')
    .filter((session) => !needle || session.name.toLowerCase().includes(needle))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  /** Sessions blocked on the human, in the order the desktop ranks them. */
  const attention = inWorkspace
    .map((session) => ({ session, state: sessionUIState(session, getConversation(session.id), connection) }))
    .filter(({ state }) => state === 'approval' || state === 'input' || state === 'failed')
    .sort((a, b) => (a.state === 'approval' || a.state === 'failed' ? -1 : 1))

  function openSession(id: string) {
    if (id === sessionId) {
      onClose()
      return
    }
    onClose()
    navigation.navigate('Session', { sessionId: id })
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 flex-row bg-black/65">
        <View className="w-[86%] max-w-[320px] flex-1 border-r border-line bg-sidebar">
          <GlassSurface radius={0} className="border-b border-line">
            <View className="flex-row items-center gap-2 px-3 pt-14 pb-3">
              <View className="min-w-0 flex-1">
                <Mono className="text-[10px] uppercase tracking-[0.16em] text-ink-3">Workspace</Mono>
                <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
                  {project ? basename(project) : 'Inbox'}
                </Text>
              </View>
              <IconButton label="New session here" onPress={onNewTask} className="size-9">
                <Plus size={17} color={palette.ink} />
              </IconButton>
              <IconButton label="Close" onPress={onClose} className="size-9">
                <X size={16} color={palette.ink2} />
              </IconButton>
            </View>
          </GlassSurface>

          <View className="px-3 pt-3">
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder="Search sessions…"
              autoCapitalize="none"
              autoCorrect={false}
              leading={<Search size={14} color={palette.ink3} />}
            />
          </View>

          <ScrollView contentContainerClassName="pb-8">
            {attention.length > 0 ? (
              <View>
                <SectionLabel>Needs your attention</SectionLabel>
                {attention.map(({ session, state }) => {
                  const display = uiStateDisplay(state)
                  return (
                    <Pressable
                      key={session.id}
                      onPress={() => openSession(session.id)}
                      className="min-h-11 flex-row items-center gap-2 rounded-control px-2.5 active:bg-hover-2"
                    >
                      <Dot tone={display.tone} pulse={display.pulse} />
                      <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                        {session.name}
                      </Text>
                      <Mono className="text-[9.5px] uppercase">{display.label}</Mono>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}

            <SectionLabel>Sessions</SectionLabel>
            {visible.length === 0 ? (
              <Text className="px-2.5 py-2 text-[11.5px] text-ink-3">No sessions match.</Text>
            ) : (
              visible.map((session) => {
                const active = session.id === sessionId
                const display = uiStateDisplay(
                  sessionUIState(session, getConversation(session.id), connection),
                )
                return (
                  <Pressable
                    key={session.id}
                    onPress={() => openSession(session.id)}
                    className={cn(
                      'min-h-11 flex-row items-center gap-2 rounded-control px-2.5',
                      active ? 'bg-accent-tint' : 'active:bg-hover-2',
                    )}
                  >
                    <Dot tone={display.tone} pulse={display.pulse} />
                    <View className="min-w-0 flex-1">
                      <Text className={cn('text-[12.5px]', active ? 'text-ink' : 'text-ink-2')} numberOfLines={1}>
                        {session.name}
                      </Text>
                      <Mono className="text-[9.5px]">{relativeTime(session.updated_at)}</Mono>
                    </View>
                  </Pressable>
                )
              })
            )}

            <SectionLabel>Rooms</SectionLabel>
            {rooms.length === 0 ? (
              <Text className="px-2.5 py-2 text-[11.5px] text-ink-3">
                No rooms. A room is a roster of workers you can fan a task out to.
              </Text>
            ) : (
              rooms.map((room) => (
                <Pressable
                  key={room.id}
                  onPress={() => room.session_id && openSession(room.session_id)}
                  className="min-h-11 flex-row items-center gap-2 rounded-control px-2.5 active:bg-hover-2"
                >
                  <Waypoints size={14} color={palette.ink3} />
                  <Text className="min-w-0 flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
                    {room.name}
                  </Text>
                </Pressable>
              ))
            )}

            <View className="mt-4 gap-2 px-2.5">
              <View className="flex-row items-center gap-2">
                <Dot tone={connection === 'connected' ? 'green' : connection === 'offline' ? 'red' : 'orange'} />
                <Text className="text-[11px] text-ink-3">
                  {connection === 'connected' ? 'Connected to your desktop' : connection}
                </Text>
              </View>
              {project ? (
                <Button variant="surface" label="New session here" onPress={onNewTask} />
              ) : null}
            </View>
          </ScrollView>
        </View>

        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Close panel" />
      </View>
    </Modal>
  )
}

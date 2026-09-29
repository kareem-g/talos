/**
 * Session switcher — the desktop's left sidebar, as a sheet.
 *
 * The desktop keeps a 304pt column beside the transcript: workspace picker,
 * search, "needs your attention", the session list, rooms. On a phone that is
 * two panels and two dismissal gestures for one idea ("show me more"), so it is
 * one sheet with a segmented switch, and the segments are *the reason you
 * opened it* rather than sections you scroll past:
 *
 *   - **Needs you** is a separate segment, not a group at the top of the list.
 *     A sheet that opens onto a list you then have to scroll past to find the
 *     thing that is blocking you has not solved the problem; a tab you can
 *     hit puts it in front of you. It is also pre-selected when there is
 *     something in it, which is the whole point.
 *   - **All** is the same list the deck shows, plus archived sessions, because
 *     "where did that session go" is asked from inside a session more often
 *     than from the deck.
 *   - **Rooms** is its own segment rather than a section at the bottom, for the
 *     same reason.
 *
 * The transcript stays visible behind a 60%-height sheet, so switching is a
 * glance rather than a page change — which is the entire difference between a
 * rail and a screen.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Search, Waypoints, Zap } from 'lucide-react-native'

import { cn, relativeTime } from '@/lib/format'
import { isInternalSession, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import type { RootStackParamList } from '@app/navigation'
import { roomsApi } from '@app/lib/api'
import { getConversation, useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { Sheet } from '@app/components/Sheet'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  AgentAvatar,
  Button,
  Divider,
  Dot,
  EmptyState,
  FilterChips,
  Mono,
  SearchField,
  haptic,
} from '@app/components/ui'
import { stateTone } from './session/SessionRow'

type Mode = 'attention' | 'all' | 'rooms'

export function SessionSwitcherSheet({
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
  const agents = useStore((state) => state.agents)
  const current = sessions.find((session) => session.id === sessionId)

  const [query, setQuery] = React.useState('')
  const [mode, setMode] = React.useState<Mode>('all')
  const [rooms, setRooms] = React.useState<Array<{ id: string; name: string; session_id?: string }>>([])

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    roomsApi
      .list()
      .then((result) => setRooms(result.rooms ?? []))
      .catch(() => setRooms([]))
  }, [open])

  const project = current?.project ?? null

  const withState = React.useMemo(
    () =>
      sessions
        .filter((session) => !isInternalSession(session))
        .map((session) => ({
          session,
          state: sessionUIState(session, getConversation(session.id), connection),
        })),
    [connection, sessions],
  )

  const attention = React.useMemo(
    () =>
      withState
        .filter(({ state }) => state === 'approval' || state === 'input' || state === 'failed')
        .sort((a, b) => {
          const rank = (state: string) => (state === 'approval' || state === 'failed' ? 0 : 1)
          return rank(a.state) - rank(b.state)
        }),
    [withState],
  )

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return withState
      .filter((entry) => (mode === 'attention' ? true : entry.session.status !== 'archived'))
      .filter(
        (entry) =>
          !needle ||
          entry.session.name.toLowerCase().includes(needle) ||
          entry.session.agent.toLowerCase().includes(needle) ||
          (entry.session.project ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
  }, [mode, query, withState])

  const providerName = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  // Open on the segment that answers the question. A sheet that opens on
  // "All" when three sessions are blocked has made the user scroll to find the
  // thing they came for.
  const [touched, setTouched] = React.useState(false)
  const effectiveMode = touched ? mode : attention.length > 0 ? 'attention' : mode

  function openSession(id: string) {
    if (id === sessionId) {
      onClose()
      return
    }
    onClose()
    navigation.push('Session', { sessionId: id })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={project ? project.split('/').filter(Boolean).pop() : 'Inbox'}
      eyebrow="Switch session"
      snapPoints={[0.62, 0.94]}
    >
      <View style={{ gap: 10 }}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search sessions"
          accessibilityLabel="Search sessions"
        />

        {/* Three modes, one of which is rarely non-empty. `FilterChips` rather
            than `Segmented` because each mode carries a *count*, and a count
            beside a label is what tells you whether the mode is worth opening
            — which is the whole reason "Needs you" can pre-select itself. */}
        <FilterChips
          label="Session list"
          value={effectiveMode}
          onChange={(value) => {
            void haptic('light')
            setTouched(true)
            setMode(value as Mode)
          }}
          options={[
            { value: 'attention' as Mode, label: 'Needs you', count: attention.length || undefined },
            { value: 'all' as Mode, label: 'All', count: withState.length || undefined },
            { value: 'rooms' as Mode, label: 'Rooms', count: rooms.length || undefined },
          ]}
        />
      </View>

      {effectiveMode === 'rooms' ? (
        rooms.length === 0 ? (
          <EmptyState
            compact
            title="No rooms"
            body="A room is a roster of workers you can fan a single task out to. Send /orchestrator inside a session to make one."
          />
        ) : (
          <View style={{ marginHorizontal: -16 }}>
            {rooms.map((room, index) => (
              <RoomRow
                key={room.id}
                room={room}
                index={index}
                onPress={() => {
                  if (!room.session_id) return
                  onClose()
                  navigation.push('Session', { sessionId: room.session_id })
                }}
              />
            ))}
          </View>
        )
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          title={query ? 'Nothing matches' : effectiveMode === 'attention' ? 'Nothing is waiting on you' : 'No sessions'}
          body={
            query
              ? 'Try a different search.'
              : effectiveMode === 'attention'
                ? 'Every session is either finished or running on its own.'
                : 'Start one to get going.'
          }
        />
      ) : (
        <View style={{ marginHorizontal: -16, marginTop: 4 }}>
          {visible.map(({ session, state }, index) => (
            <SwitchRow
              key={session.id}
              session={session}
              state={state}
              index={index}
              active={session.id === sessionId}
              providerName={providerName(session.agent)}
              onPress={() => {
                void haptic('light')
                openSession(session.id)
              }}
            />
          ))}
        </View>
      )}

      <View style={{ marginTop: 8, gap: 8 }}>
        <Button
          variant="secondary"
          label="Start a task in this workspace"
          icon={<Zap size={16} color={palette.ink2} />}
          full
          onPress={() => {
            void haptic('light')
            onNewTask()
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4 }}>
          <Dot tone={connection === 'connected' ? 'ok' : 'danger'} pulse={connection !== 'connected'} />
          <Text className="flex-1 text-[11.5px] text-ink-3">
            {connection === 'connected' ? 'Connected to your desktop' : 'Not connected — the list may be stale'}
          </Text>
        </View>
      </View>
    </Sheet>
  )
}

/**
 * One row in the switcher.
 *
 * Its own component so the entry animation's value is created by a hook on a
 * stable component rather than inside a `.map` callback.
 */
function SwitchRow({
  session,
  state,
  index,
  active,
  providerName,
  onPress,
}: {
  session: { id: string; name: string; agent: string; updated_at: string }
  state: string
  index: number
  active: boolean
  providerName: string
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  const tone = stateTone(state)
  const display = uiStateDisplay(state as never)

  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={session.name}
        accessibilityHint={`${display.label}. ${relativeTime(session.updated_at)}`}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          minHeight: 56,
          paddingHorizontal: 16,
          paddingVertical: 9,
          backgroundColor: active ? palette.accentSoft : pressed ? palette.raised : 'transparent',
        })}
      >
        <AgentAvatar agent={session.agent} size={30} name={providerName} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            className="text-[14.5px]"
            style={{ color: active ? palette.ink : palette.ink2, fontWeight: active ? '600' : '500' }}
            numberOfLines={1}
          >
            {session.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <Dot tone={tone} pulse={display.pulse} />
            <Text
              className="text-[11.5px]"
              style={{ color: tone === 'muted' ? palette.ink3 : toneColorFor(tone) }}
            >
              {display.label}
            </Text>
            <Text className="text-[11px] text-ink-4">·</Text>
            <Mono className="text-[11px]">{relativeTime(session.updated_at)}</Mono>
          </View>
        </View>
      </Pressable>
      <Divider inset={57} />
    </View>
  )
}

function toneColorFor(tone: string): string {
  switch (tone) {
    case 'ok':
      return palette.ok
    case 'wait':
      return palette.wait
    case 'danger':
      return palette.danger
    case 'info':
      return palette.info
    case 'accent':
      return palette.accent
    default:
      return palette.ink3
  }
}

function RoomRow({
  room,
  index,
  onPress,
}: {
  room: { id: string; name: string; session_id?: string }
  index: number
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={room.name}
        accessibilityHint={room.session_id ? 'Opens the room channel' : 'This room has no channel session yet'}
        disabled={!room.session_id}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          minHeight: 54,
          paddingHorizontal: 16,
          paddingVertical: 10,
          opacity: room.session_id ? 1 : 0.5,
          backgroundColor: pressed ? palette.raised : 'transparent',
        })}
      >
        <Waypoints size={17} color={palette.ink3} />
        <Text className="flex-1 text-[14.5px] text-ink-2" numberOfLines={1}>
          {room.name}
        </Text>
      </Pressable>
      <Divider inset={44} />
    </View>
  )
}

export { cn, Search, radius }

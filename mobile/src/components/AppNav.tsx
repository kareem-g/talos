/**
 * The drawer — the app's primary navigation.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The previous drawer was a direct port of the desktop's 224px rail, and it
 * imported the desktop's information architecture wholesale: nine
 * destinations across four groups ("Get started / Products / Manage / …"),
 * plus a list of recent sessions, plus an API-key copy, plus a device card.
 *
 * Three problems with that on a phone:
 *
 *  1. **Nine destinations in a drawer is a search problem, not a navigation
 *     problem.** The user has to remember which of two similar-looking groups
 *     a screen lives in. The grouping labels were pure desktop vocabulary
 *     ("Products") that meant nothing on a device.
 *  2. **Recent sessions were unbounded.** Up to 30 rows, pushing the
 *     navigation below the fold and burying the actual destinations.
 *  3. **The API key was a nav item.** A copyable secret is not a place; it is a
 *     value that belongs on a settings screen, where it can be explained.
 *
 * Now: five destinations, grouped by what the user is *doing* (monitor, extend,
 * configure), recent sessions capped at five, and the device card at the bottom
 * carrying connection state — because "am I even connected?" is the first
 * question the drawer should answer.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { DrawerContentComponentProps } from '@react-navigation/drawer'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ChevronRight, Plus } from 'lucide-react-native'

import { useStore } from '@app/store'
import type { RootStackParamList, DrawerParamList } from '@app/navigation'
import { deviceToken } from '@app/lib/api'
import { palette, type Tone } from '@app/design/tokens'
import {
  BrandMark,
  Button,
  CopyButton,
  Dot,
  Eyebrow,
  IconButton,
  haptic,
} from '@app/components/ui'
import { NewTaskSheet } from '@app/components/NewTaskSheet'

/** Connection state → a tone, so the drawer and the rest of the app agree. */
function connectionTone(connection: string): Tone {
  if (connection === 'connected') return 'ok'
  if (connection === 'connecting' || connection === 'reconnecting') return 'wait'
  return 'danger'
}

function connectionLabel(connection: string, paired: boolean): string {
  if (!paired) return 'Not paired'
  switch (connection) {
    case 'connected':
      return 'Connected'
    case 'connecting':
    case 'reconnecting':
      return 'Connecting'
    case 'offline':
    case 'unauthorized':
      return 'Offline'
    default:
      return 'Disconnected'
  }
}

/** The five destinations, in the order they should be reached for. */
const DESTINATIONS: Array<{
  route: keyof DrawerParamList
  label: string
  hint: string
  group: 'Monitor' | 'Extend' | 'Configure'
}> = [
  { route: 'Home', label: 'Sessions', hint: 'Everything running or waiting', group: 'Monitor' },
  { route: 'History', label: 'History', hint: 'Past sessions and outcomes', group: 'Monitor' },
  { route: 'Usage', label: 'Usage', hint: 'Cost, tokens and runtime', group: 'Monitor' },
  { route: 'Agents', label: 'Agents', hint: 'Which CLIs are ready', group: 'Extend' },
  { route: 'Browsers', label: 'Browsers', hint: 'Browser engines per workspace', group: 'Extend' },
  { route: 'Mcp', label: 'MCP servers', hint: 'Tools this desktop can call', group: 'Extend' },
  { route: 'Config', label: 'Configuration', hint: 'Models, permissions, pairing', group: 'Configure' },
  { route: 'Remote', label: 'Remote access', hint: 'Routes and paired devices', group: 'Configure' },
  { route: 'DaemonSettings', label: 'Daemon', hint: 'The desktop process itself', group: 'Configure' },
]

/** Recent sessions shown before the list is truncated. */
const RECENT_LIMIT = 5

const GROUPS = ['Monitor', 'Extend', 'Configure'] as const

export function AppNav({ navigation, state }: DrawerContentComponentProps) {
  const active = state.routeNames[state.index]
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const desktopName = useStore((s) => s.desktopName)
  const [newOpen, setNewOpen] = React.useState(false)

  // Sessions and the pairing gate are ROOT stack screens, pushed over the
  // drawer. The drawer's own navigator does not know them, so navigating
  // 'Session' here directly would be an unhandled action at runtime.
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()

  const go = (route: keyof DrawerParamList) => {
    void haptic('light')
    navigation.navigate(route)
    navigation.closeDrawer()
  }

  const openSession = (sessionId: string) => {
    void haptic('light')
    navigation.closeDrawer()
    root?.navigate('Session', { sessionId })
  }

  const recent = React.useMemo(
    () =>
      sessions
        .filter((session) => session.status !== 'archived')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, RECENT_LIMIT),
    [sessions],
  )

  return (
    <View className="flex-1 bg-chrome">
      {/* Brand */}
      <View className="flex-row items-center gap-2.5 px-4 py-4">
        <BrandMark size={24} />
        <Text className="flex-1 text-[17px] font-bold text-ink" style={{ letterSpacing: -0.3 }}>
          AgentDeck
        </Text>
        <IconButton
          label="Close navigation"
          size={36}
          onPress={() => navigation.closeDrawer()}
        >
          <ChevronRight size={18} color={palette.ink3} style={{ transform: [{ rotate: '180deg' }] }} />
        </IconButton>
      </View>

      {/* One primary action, at the top, where a thumb reaches first. */}
      <View className="px-3 pb-3">
        <Button
          variant="primary"
          label="New task"
          accessibilityLabel="Start a new task"
          full
          icon={<Plus size={16} color={palette.accentInk} />}
          onPress={() => {
            navigation.closeDrawer()
            setNewOpen(true)
          }}
        />
      </View>

      <ScrollView contentContainerClassName="gap-1 pb-4" showsVerticalScrollIndicator={false}>
        {GROUPS.map((group) => {
          const items = DESTINATIONS.filter((entry) => entry.group === group)
          if (items.length === 0) return null
          return (
            <View key={group}>
              <Eyebrow className="px-4 pb-1 pt-3">{group}</Eyebrow>
              {items.map((entry) => (
                <NavItem
                  key={entry.route}
                  label={entry.label}
                  hint={entry.hint}
                  active={active === entry.route}
                  onPress={() => go(entry.route)}
                />
              ))}
            </View>
          )
        })}

        {/* Capped, and only when there is something to show. An empty "Recent"
            group is worse than none — it implies the list failed to load. */}
        {recent.length > 0 ? (
          <View>
            <Eyebrow className="px-4 pb-1 pt-3">Recent</Eyebrow>
            {recent.map((session) => (
              <Pressable
                key={session.id}
                accessibilityRole="button"
                accessibilityLabel={session.name}
                accessibilityHint={`${session.agent}. Opens the session.`}
                onPress={() => openSession(session.id)}
                className="min-h-11 flex-row items-center gap-2.5 px-4 active:bg-pressed"
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-[13px] text-ink-2" numberOfLines={1}>
                    {session.name}
                  </Text>
                </View>
                <ChevronRight size={15} color={palette.ink3} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <NewTaskSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(session) => openSession(session.id)}
      />

      {/* ── Device card ───────────────────────────────────────────────────
          The footer answers "am I connected, and to what?" — the two questions
          that make every other failure in the app explainable. */}
      <View className="gap-2.5 border-t border-line p-3">
        <View className="gap-2.5 rounded-md border border-line bg-surface p-3">
          <View className="flex-row items-center gap-2">
            <Dot tone={connectionTone(connection)} pulse={connection !== 'connected'} />
            <Text className="min-w-0 flex-1 text-[13px] font-semibold text-ink" numberOfLines={1}>
              {connectionLabel(connection, true)}
            </Text>
            <CopyButton
              value={deviceToken() ?? ''}
              label="Token"
              accessibilityLabel="Copy this device's API token"
            />
          </View>
          <Text className="text-[11px] text-ink-3" numberOfLines={1}>
            {desktopName}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pair another device"
          accessibilityHint="Opens the pairing screen"
          onPress={() => {
            navigation.closeDrawer()
            root?.navigate('Pairing')
          }}
          className="min-h-11 flex-row items-center gap-2.5 rounded-md px-3 active:bg-pressed"
        >
          <Text className="min-w-0 flex-1 text-[13px] text-ink-2">Pair a device</Text>
          <ChevronRight size={15} color={palette.ink3} />
        </Pressable>
      </View>
    </View>
  )
}

/**
 * A destination.
 *
 * The hint text is what makes a flat list navigable: "Configuration" and
 * "Daemon" are indistinguishable until you say what they do. The hint is
 * visually secondary and hidden from VoiceOver, which reads the label alone.
 */
function NavItem({
  label,
  hint,
  active,
  onPress,
}: {
  label: string
  hint: string
  active?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      className={[
        'min-h-12 justify-center rounded-md px-4 py-1.5',
        active ? 'bg-accent-soft' : 'active:bg-pressed',
      ].join(' ')}
    >
      <Text
        className={['text-[14px]', active ? 'font-semibold text-ink' : 'text-ink-2'].join(' ')}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  )
}

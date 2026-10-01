/**
 * The tab bar — four destinations and one verb.
 *
 * QAI · THE CONSOLE
 * -----------------
 * The desktop scatters its surface across a 56-wide rail, a centre pane and a
 * twelve-tab right rail. On a phone that becomes: four destinations a thumb can
 * reach, and one raised action in the middle that is the app's only verb.
 *
 *   Deck      triage — what needs you, the fleet band, what is live
 *   Sessions  every session, by day, searchable and filterable
 *   ✚         Command — new task, search, re-spawn, re-scan, pair
 *   Station   the daemon's world — agents, engines, terminals, MCP, usage
 *   Device    this phone — routes, alerts, pairing, about, unpair
 *
 * The active destination is *lit* the way the console lights a channel: a 2pt
 * accent bar on the bar's top edge and an accent glyph, never a fatter label.
 * The raised action is an accent tile; it is the only filled control in the
 * chrome, which is what makes it the obvious next tap.
 */

import * as React from 'react'
import {Animated, Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gauge, Layers, LayoutGrid, Plus, Smartphone } from 'lucide-react-native'

import { useStore } from '@app/store'
import { palette } from '@app/design/tokens'
import { MONO } from '@app/design/fonts'
import { openCommand } from '@app/lib/command'
import { haptic } from './ui'

export type TabRoute = 'Deck' | 'Sessions' | 'Station' | 'Device'

const META: Record<TabRoute, { label: string }> = {
  Deck: { label: 'Deck' },
  Sessions: { label: 'Sessions' },
  Station: { label: 'Station' },
  Device: { label: 'Device' },
}

const ICONS: Record<TabRoute, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  Deck: Gauge,
  Sessions: Layers,
  Station: LayoutGrid,
  Device: Smartphone,
}

// Tab labels are readouts, so they take the same mono face as every other one.
const MONO_FACE = MONO

function TabIcon({ route, active }: { route: TabRoute; active: boolean }) {
  const Icon = ICONS[route]
  return <Icon size={20} color={active ? palette.accent : palette.ink4} strokeWidth={active ? 2.1 : 1.7} />
}

export interface TabBarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> }
  navigation: { navigate: (name: string) => void }
}

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const attention = useStore((store) => store.pendingActions.length)
  const sessions = useStore((store) => store.sessions)

  // The badge is derived, not stored: a session can enter "needs you" without
  // any action being pushed, and a badge that only knew about notifications
  // would sit at zero while a session sat blocked. It rides on the Deck, which
  // carries the triage queue.
  const blocked = React.useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status === 'waiting_for_approval' ||
          session.status === 'waiting_for_input' ||
          session.status === 'error',
      ).length + attention,
    [attention, sessions],
  )

  const activeName = (state?.routes?.[state.index]?.name ?? 'Deck') as TabRoute

  const slots: Array<TabRoute | 'command'> = ['Deck', 'Sessions', 'command', 'Station', 'Device']

  return (
    <View
      style={{
        paddingBottom: Math.max(insets.bottom, 6),
        backgroundColor: palette.chrome,
        borderTopWidth: 1,
        borderTopColor: palette.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', height: 62, paddingHorizontal: 4 }}>
        {slots.map((slot) =>
          slot === 'command' ? (
            <CommandButton
              key="command"
              onPress={() => {
                void haptic('medium')
                openCommand()
              }}
            />
          ) : (
            <TabButton
              key={slot}
              route={slot}
              active={activeName === slot}
              badge={slot === 'Deck' ? blocked : 0}
              onPress={() => {
                void haptic('select')
                navigation.navigate(slot)
              }}
            />
          ),
        )}
      </View>
    </View>
  )
}

function TabButton({
  route,
  active,
  badge,
  onPress,
}: {
  route: TabRoute
  active: boolean
  badge: number
  onPress: () => void
}) {
  const progress = React.useRef(new Animated.Value(active ? 1 : 0)).current

  React.useEffect(() => {
    Animated.spring(progress, {
      toValue: active ? 1 : 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 260,
      mass: 0.6,
    }).start()
  }, [active, progress])

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        badge > 0 ? `${META[route].label}, ${badge} waiting on you` : META[route].label
      }
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 9, gap: 5 }}
    >
      {/* The channel light: a short accent bar on the bar's top edge. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -1,
          width: 34,
          height: 2,
          backgroundColor: palette.accent,
          opacity: progress,
          transform: [{ scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }}
      />
      <View>
        <TabIcon route={route} active={active} />
        {badge > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -5,
              right: -9,
              minWidth: 16,
              height: 16,
              borderRadius: 4,
              paddingHorizontal: 4,
              alignItems: 'center',
              justifyContent: 'center',
              // Attention is the app's inversion — paper ink, not a red dot.
              backgroundColor: palette.ink,
              borderWidth: 1.5,
              borderColor: palette.chrome,
            }}
          >
            <Text style={{ color: palette.canvas, fontSize: 9.5, fontWeight: '800' }}>
              {badge > 9 ? '9+' : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: MONO_FACE,
          fontSize: 9,
          fontWeight: '600',
          letterSpacing: 0.9,
          textTransform: 'uppercase',
          color: active ? palette.accent : palette.ink4,
        }}
      >
        {META[route].label}
      </Text>
    </Pressable>
  )
}

/** The raised action: the only filled control in the chrome. */
function CommandButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Command — start a task, search a session, or re-scan"
        onPress={onPress}
        style={{
          width: 52,
          height: 52,
          marginTop: -14,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.accent,
          // The ring is the bar's own colour, so the tile reads as punched
          // through the bar rather than pasted on it.
          borderWidth: 4,
          borderColor: palette.chrome,
        }}
      >
        <Plus size={24} color={palette.accentInk} strokeWidth={2.4} />
      </Pressable>
      <Text
        style={{
          marginTop: 3,
          fontFamily: MONO_FACE,
          fontSize: 9,
          fontWeight: '600',
          letterSpacing: 0.9,
          textTransform: 'uppercase',
          color: palette.ink4,
        }}
      >
        Command
      </Text>
    </View>
  )
}

/** The height the bar occupies, for screens that need to pad past it. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets()
  return 62 + Math.max(insets.bottom, 6)
}
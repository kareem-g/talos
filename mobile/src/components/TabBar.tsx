/**
 * The tab bar — the deck's edge.
 *
 * QAI SIGNAL DECK
 * ---------------
 * The four places you *are* in this app: the command deck (what needs you and
 * what is running), the session browser (everything, searchable), the system
 * hub (the machinery: agents, MCP, browsers, tunnels), and settings (this
 * device and its pairing). Anything else is a page you open *from* one of
 * them. Those four are the tabs, and they are the tabs forever.
 *
 * WHY THE SIGNAL IS IN THE MIDDLE
 * -------------------------------
 * Starting a task is the app's only verb. A centre action puts it under the
 * thumb on both hands rather than in a corner. The row is 2 | 1 | 2 so the
 * composition stays symmetrical. The button is a machined accent tile — cut
 * corners, not a bubble — that grows on press: a primary control findable
 * without reading.
 *
 * The active tab gets a 2pt signal tick on the bar's top edge rather than a
 * filled background: on a dense dark deck, selection reads as *lit*, not as
 * *heavier*.
 */

import * as React from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gauge, MessagesSquare, Plus, Server, Settings } from 'lucide-react-native'

import { useStore } from '@app/store'
import { palette, radius, spring } from '@app/design/tokens'
import { haptic } from './ui'

export type TabRoute = 'Deck' | 'Sessions' | 'System' | 'Settings'

/** Left of the action, then right of it. Symmetric, so the FAB reads centred. */
const LEFT: TabRoute[] = ['Deck', 'Sessions']
const RIGHT: TabRoute[] = ['System', 'Settings']

const META: Record<TabRoute, { label: string }> = {
  Deck: { label: 'Deck' },
  Sessions: { label: 'Sessions' },
  System: { label: 'System' },
  Settings: { label: 'Settings' },
}

const ICONS: Record<TabRoute, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  Deck: Gauge,
  Sessions: MessagesSquare,
  System: Server,
  Settings: Settings,
}

function TabIcon({ route, active }: { route: TabRoute; active: boolean }) {
  const Icon = ICONS[route]
  return <Icon size={21} color={active ? palette.accent : palette.ink3} strokeWidth={active ? 2.2 : 1.8} />
}

export interface TabBarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> }
  navigation: { navigate: (name: string) => void }
  onNewTask: () => void
}

export function TabBar({ state, navigation, onNewTask }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const attention = useStore((store) => store.pendingActions.length)
  const sessions = useStore((store) => store.sessions)

  // The badge is derived, not stored: a session row can enter "needs you"
  // without any action being pushed, and a badge that only knows about
  // notifications would sit at zero while a session sat blocked.
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

  return (
    <View
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
        backgroundColor: 'transparent',
      }}
    >
      {/* Translucent deck chrome: a real blur under a wash of chrome, so
          content reads through the bar without tinting the glyphs. */}
      <BlurView intensity={52} tint="dark" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: `${palette.chrome}F0`,
          borderTopWidth: 1,
          borderTopColor: palette.line,
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 58, paddingHorizontal: 6 }}>
        {LEFT.map((route) => (
          <TabButton
            key={route}
            route={route}
            active={activeName === route}
            badge={route === 'Deck' ? blocked : 0}
            onPress={() => {
              void haptic('select')
              navigation.navigate(route)
            }}
            flex
          />
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new task"
          accessibilityHint="Choose a workspace, an agent, and a first prompt"
          onPress={() => {
            void haptic('medium')
            onNewTask()
          }}
          style={{ width: 76, alignItems: 'center', justifyContent: 'center' }}
        >
          <ComposeButton />
        </Pressable>

        {RIGHT.map((route) => (
          <TabButton
            key={route}
            route={route}
            active={activeName === route}
            badge={0}
            onPress={() => {
              void haptic('select')
              navigation.navigate(route)
            }}
            flex
          />
        ))}
      </View>
    </View>
  )
}

/**
 * The compose button.
 *
 * It sits proud of the bar and grows on press. The growth is the point: it is
 * the app's primary verb, it is the one control the user reaches for without
 * looking, and a control that is only findable by reading its label is not a
 * primary control.
 */
function ComposeButton() {
  const progress = React.useRef(new Animated.Value(0)).current
  const enter = React.useRef(new Animated.Value(0)).current

  React.useEffect(() => {
    const animation = Animated.spring(enter, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    })
    animation.start()
  }, [enter])

  return (
    <Animated.View
      style={{
        transform: [
          {
            translateY: Animated.add(
              Animated.multiply(enter, -7),
              Animated.multiply(progress, 3),
            ),
          },
          { scale: Animated.multiply(enter, Animated.add(1, Animated.multiply(progress, 0.08))) },
        ],
        opacity: enter,
      }}
    >
      <Pressable
        onPressIn={() =>
          Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.snappy }).start()
        }
        onPressOut={() =>
          Animated.spring(progress, { toValue: 0, useNativeDriver: true, ...spring.snappy }).start()
        }
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.accent,
          // A hairline of signal separates the tile from the blur behind it:
          // planes separate with light, not heavy outlines.
          borderWidth: 1,
          borderColor: palette.accentBorder,
          shadowColor: palette.accent,
          shadowOpacity: 0.35,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        <Plus size={22} color={palette.accentInk} strokeWidth={2.8} />
      </Pressable>
    </Animated.View>
  )
}

function TabButton({
  route,
  active,
  badge,
  onPress,
  flex,
}: {
  route: TabRoute
  active: boolean
  badge: number
  onPress: () => void
  flex?: boolean
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
      style={{ flex: flex ? 1 : undefined, alignItems: 'center', justifyContent: 'center' }}
    >
      {/* The signal tick: a 2pt accent bar on the top edge, grown from the
          centre. Selection as "lit", not as "heavier". */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          height: 2,
          width: 22,
          borderRadius: 1,
          backgroundColor: palette.accent,
          opacity: progress,
          transform: [{ scaleX: progress }],
        }}
      />
      <Animated.View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          paddingTop: 8,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
          ],
        }}
      >
        <View>
          <TabIcon route={route} active={active} />
          {badge > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -3,
                right: -6,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                paddingHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.danger,
                borderWidth: 1.5,
                borderColor: palette.canvas,
              }}
            >
              {/* Near-white rather than the accent's ink: the badge sits on a
                  danger fill, and `accentInk` is a blue-black that muddies it. */}
              <Text style={{ color: palette.badgeInk, fontSize: 9.5, fontWeight: '800' }}>
                {badge > 9 ? '9+' : badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 10,
            fontWeight: active ? '700' : '500',
            color: active ? palette.ink : palette.ink3,
            letterSpacing: 0.05,
          }}
        >
          {META[route].label}
        </Text>
      </Animated.View>
    </Pressable>
  )
}

/** The height the bar occupies, for screens that need to pad past it. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets()
  return 58 + Math.max(insets.bottom, 8)
}

export { radius, BlurView }

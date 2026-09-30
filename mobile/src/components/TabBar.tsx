/**
 * The tab bar — the desktop rail's destinations, thumb-reachable.
 *
 * QAI · WARM STUDIO
 * -----------------
 * The desktop's mobile shell puts every destination in a left drawer (ported
 * here as `components/Drawer`). The tab bar is the fast path to the five the
 * rail groups under Get started / Products / Manage — Home, Agents, Browsers,
 * History, Usage — so the common hops never need the drawer. Configuration
 * lives in the drawer and on Home, exactly where the desktop puts it.
 *
 * The bar wears the desktop's sidebar tone with a hairline top edge. The
 * active destination is lit the way the rail lights it: an accent-tinted pill
 * behind the glyph and ink on the label — selection reads as *lit*, never as
 * *heavier*.
 */

import * as React from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BarChart3, Bot, Globe, History as HistoryIcon, Home } from 'lucide-react-native'

import { useStore } from '@app/store'
import { palette } from '@app/design/tokens'
import { haptic } from './ui'

export type TabRoute = 'Home' | 'Agents' | 'Browsers' | 'History' | 'Usage'

const ORDER: TabRoute[] = ['Home', 'Agents', 'Browsers', 'History', 'Usage']

const META: Record<TabRoute, { label: string }> = {
  Home: { label: 'Home' },
  Agents: { label: 'Agents' },
  Browsers: { label: 'Browsers' },
  History: { label: 'History' },
  Usage: { label: 'Usage' },
}

const ICONS: Record<TabRoute, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  Home,
  Agents: Bot,
  Browsers: Globe,
  History: HistoryIcon,
  Usage: BarChart3,
}

function TabIcon({ route, active }: { route: TabRoute; active: boolean }) {
  const Icon = ICONS[route]
  return <Icon size={19} color={active ? palette.accent : palette.ink3} strokeWidth={active ? 2.1 : 1.8} />
}

export interface TabBarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> }
  navigation: { navigate: (name: string) => void }
}

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets()
  const attention = useStore((store) => store.pendingActions.length)
  const sessions = useStore((store) => store.sessions)

  // The badge is derived, not stored: a session row can enter "needs you"
  // without any action being pushed, and a badge that only knows about
  // notifications would sit at zero while a session sat blocked. It rides on
  // Home, which carries the triage queue.
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

  const activeName = (state?.routes?.[state.index]?.name ?? 'Home') as TabRoute

  return (
    <View
      style={{
        paddingBottom: Math.max(insets.bottom, 6),
        backgroundColor: palette.chrome,
        borderTopWidth: 1,
        borderTopColor: palette.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'stretch', height: 56, paddingHorizontal: 4 }}>
        {ORDER.map((route) => (
          <TabButton
            key={route}
            route={route}
            active={activeName === route}
            badge={route === 'Home' ? blocked : 0}
            onPress={() => {
              void haptic('select')
              navigation.navigate(route)
            }}
          />
        ))}
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
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
    >
      {/* The lit pill behind the glyph — the rail's active treatment. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 4,
          width: 52,
          height: 28,
          borderRadius: 14,
          backgroundColor: palette.accentSoft,
          opacity: progress,
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
        }}
      />
      <View>
        <TabIcon route={route} active={active} />
        {badge > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -3,
              right: -7,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              paddingHorizontal: 4,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.danger,
              borderWidth: 1.5,
              borderColor: palette.chrome,
            }}
          >
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
    </Pressable>
  )
}

/** The height the bar occupies, for screens that need to pad past it. */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets()
  return 56 + Math.max(insets.bottom, 6)
}

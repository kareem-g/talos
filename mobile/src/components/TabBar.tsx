/**
 * The tab bar.
 *
 * EMBER CLAY — the kiln shelf.
 *
 * The four things you do with this app are *check what needs you*, *see what
 * the agents are*, *look back at what happened*, and *change how it is
 * configured*. Those are the four tabs, and they are the tabs forever — not
 * because four is a magic number, but because anything else is a page you open
 * *from* one of them, not a place you *are*.
 *
 * WHY THE EMBER IS IN THE MIDDLE
 * -------------------------------
 * Starting a task is the app's only verb. A centre action puts it under the
 * thumb on both hands rather than in a corner. The tab row is 2 | 2 around it
 * so the composition stays symmetrical. The ember ingot sits proud of the
 * shelf and grows on press — a primary control findable without reading.
 *
 * The whole shelf is translucent warm chrome with a real blur, because it
 * floats over content.
 */

import * as React from 'react'
import { Animated, Pressable, Text, View, type LayoutChangeEvent } from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus } from 'lucide-react-native'

import { useStore } from '@app/store'
import { palette, radius, spring } from '@app/design/tokens'
import { haptic } from './ui'

export type TabRoute = 'Deck' | 'Agents' | 'Activity' | 'Settings'

/** Left of the action, then right of it. Symmetric, so the FAB reads centred. */
const LEFT: TabRoute[] = ['Deck', 'Agents']
const RIGHT: TabRoute[] = ['Activity', 'Settings']

const META: Record<TabRoute, { label: string }> = {
  Deck: { label: 'Deck' },
  Agents: { label: 'Agents' },
  Activity: { label: 'Activity' },
  Settings: { label: 'Settings' },
}

const ICONS: Record<TabRoute, keyof typeof GLYPHS> = {
  Deck: 'layers',
  Agents: 'bot',
  Activity: 'pulse',
  Settings: 'sliders',
}

/**
 * Icons drawn as views rather than imported from an icon set.
 *
 * The tab bar is the one place in the app where icon *style* has to be
 * perfectly consistent — four glyphs, one weight, one optical size, sitting
 * 4pt apart. Pulling four glyphs from a general-purpose icon set guarantees
 * they are not: they are drawn on different grids with different terminals and
 * different visual weights, and the mismatch is obvious the moment you see two
 * of them next to each other. Four small drawings on one 24-unit grid do not
 * have that problem, and they can animate (the active tab's glyph lifts) which
 * a static set cannot.
 */
type Shape =
  | { kind: 'bar'; x: number; y: number; w: number; h: number; r?: number }
  | { kind: 'box'; x: number; y: number; w: number; h: number; r: number }
  | { kind: 'dot'; cx: number; cy: number; r: number }

const GLYPHS: Record<string, Shape[]> = {
  layers: [
    { kind: 'bar', x: 4, y: 6, w: 16, h: 1.8 },
    { kind: 'bar', x: 4, y: 11, w: 16, h: 1.8 },
    { kind: 'bar', x: 4, y: 16, w: 16, h: 1.8 },
  ],
  bot: [
    { kind: 'box', x: 4.5, y: 7.5, w: 15, h: 11, r: 5 },
    { kind: 'bar', x: 11.1, y: 3.2, w: 1.8, h: 4.3, r: 1 },
    { kind: 'dot', cx: 9, cy: 12.5, r: 1.5 },
    { kind: 'dot', cx: 15, cy: 12.5, r: 1.5 },
  ],
  pulse: [
    { kind: 'bar', x: 3, y: 9, w: 4, h: 1.8 },
    { kind: 'bar', x: 7, y: 13, w: 4, h: 1.8 },
    { kind: 'bar', x: 11, y: 6, w: 4, h: 1.8 },
    { kind: 'bar', x: 15, y: 11, w: 4, h: 1.8 },
  ],
  sliders: [
    { kind: 'bar', x: 3.5, y: 7, w: 17, h: 1.6 },
    { kind: 'bar', x: 3.5, y: 12.6, w: 17, h: 1.6 },
    { kind: 'bar', x: 3.5, y: 18.2, w: 17, h: 1.6 },
    { kind: 'dot', cx: 9, cy: 7.8, r: 2.5 },
    { kind: 'dot', cx: 15, cy: 13.4, r: 2.5 },
    { kind: 'dot', cx: 8, cy: 19, r: 2.5 },
  ],
}

function TabIcon({ route, active }: { route: TabRoute; active: boolean }) {
  const color = active ? palette.accent : palette.ink3
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 24, height: 24 }}
    >
      {GLYPHS[ICONS[route]].map((shape, index) => {
        if (shape.kind === 'bar') {
          return (
            <View
              key={index}
              style={{
                position: 'absolute',
                left: shape.x,
                top: shape.y,
                width: shape.w,
                height: shape.h,
                borderRadius: shape.r ?? 1,
                backgroundColor: color,
              }}
            />
          )
        }
        if (shape.kind === 'box') {
          return (
            <View
              key={index}
              style={{
                position: 'absolute',
                left: shape.x,
                top: shape.y,
                width: shape.w,
                height: shape.h,
                borderRadius: shape.r,
                borderWidth: 1.8,
                borderColor: color,
              }}
            />
          )
        }
        return (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: shape.cx - shape.r,
              top: shape.cy - shape.r,
              width: shape.r * 2,
              height: shape.r * 2,
              borderRadius: shape.r,
              backgroundColor: color,
            }}
          />
        )
      })}
    </View>
  )
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
      {/* Translucent kiln chrome: a real blur under a wash of warm chrome, so
          content reads through the shelf without tinting the glyphs. */}
      <BlurView intensity={52} tint="dark" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: 'rgba(20,18,16,0.86)',
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
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
    // A short delay: the bar slides in first, then the button lands on it, so
    // the two do not arrive as one flat object.
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
          width: 50,
          height: 50,
          borderRadius: 25,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.accent,
          // A hairline of kiln light separates the ingot from the blur behind
          // it: planes separate with light, not heavy outlines.
          borderWidth: 1,
          borderColor: palette.accentBorder,
          shadowColor: palette.accent,
          shadowOpacity: 0.5,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 5 },
          elevation: 9,
        }}
      >
        <Plus size={23} color={palette.accentInk} strokeWidth={2.8} />
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
      style={{ flex: flex ? 1 : undefined, alignItems: 'center', justifyContent: 'center', paddingTop: 6 }}
    >
      <Animated.View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          // A 1.5pt lift and a hair more scale. Enough to read as "this one is
          // selected" in peripheral vision; not enough to bounce.
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }) },
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
                right: -5,
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
            fontSize: 10.5,
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
export type { LayoutChangeEvent }

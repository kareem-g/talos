/**
 * Screen scaffolding — the deck every page is mounted on.
 *
 * QAI SIGNAL DECK
 * ---------------
 * A large title that *collapses into* a compact app bar as the page scrolls,
 * like iOS and like the desktop's sticky header. The title is the headline,
 * not chrome; the bar earns its hairline only once content slides under it.
 * Every section header carries a 2pt signal tick beside its eyebrow, so a long
 * page reads as one instrument panel rather than a stack of unrelated cards.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, WifiOff } from 'lucide-react-native'

import { cn } from '@/lib/format'
import { useStore } from '@app/store'
import { palette, radius, toneColor } from '../design/tokens'
import { EASE_OUT } from './motion'
import { Eyebrow, IconButton, haptic } from './ui'

/** Scroll distance at which the large title has fully become the app bar. */
const COLLAPSE_START = 12
const COLLAPSE_END = 56

interface LargeHeaderProps {
  title: string
  eyebrow?: string
  subtitle?: string
  /** Rendered on the right of the app bar, and beside the large title. */
  actions?: React.ReactNode
  /** Rendered under the large title — a search field, a filter row. */
  below?: React.ReactNode
}

/**
 * The scrolling head of a page.
 *
 * Driven by the parent's `scrollY` so the two stay in lockstep; the parent
 * renders this *inside* the scroll container (so it scrolls away) while the app
 * bar it cross-fades with sits outside.
 */
function LargeHeader({ title, eyebrow, subtitle, actions, below }: LargeHeaderProps) {
  const { scrollY } = useScrollProgress()
  const largeOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_END],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })
  const largeShift = scrollY.interpolate({
    inputRange: [0, COLLAPSE_END],
    outputRange: [0, -14],
    extrapolate: 'clamp',
  })
  const detailOpacity = scrollY.interpolate({
    inputRange: [COLLAPSE_START, COLLAPSE_START + 30],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10 }}>
      <Animated.View
        style={{
          opacity: largeOpacity,
          transform: [{ translateY: largeShift }],
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, gap: 3 }}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <Text
            accessibilityRole="header"
            className="text-[24px] leading-[30px] font-bold text-ink"
            style={{ letterSpacing: -0.5 }}
            numberOfLines={2}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text className="mt-1 text-[13px] leading-[18px] text-ink-2">{subtitle}</Text>
          ) : null}
        </View>
        {actions}
      </Animated.View>

      {below ? (
        <Animated.View style={{ opacity: detailOpacity, marginTop: 8 }}>
          {below}
        </Animated.View>
      ) : null}
    </View>
  )
}

/** The compact bar the large title collapses into. */
export function AppBar({
  title,
  subtitle,
  left,
  right,
  scrollY,
  borderless,
}: {
  title: string
  subtitle?: string
  left?: React.ReactNode
  right?: React.ReactNode
  scrollY?: Animated.Value
  borderless?: boolean
}) {
  const insets = useSafeAreaInsets()
  const titleOpacity = scrollY
    ? scrollY.interpolate({
        inputRange: [COLLAPSE_START, COLLAPSE_END],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      })
    : new Animated.Value(1)
  const borderOpacity = scrollY
    ? scrollY.interpolate({
        inputRange: [0, COLLAPSE_START + 8],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      })
    : new Animated.Value(1)

  return (
    <View style={{ paddingTop: insets.top }}>
      <BlurView intensity={70} tint="dark" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: `${palette.chrome}E6` }} />
      <View
        className="min-h-[52px] flex-row items-center gap-2 px-2"
        style={borderless ? undefined : { borderBottomWidth: 1, borderBottomColor: palette.line }}
      >
        {left}
        <Animated.View
          accessibilityRole="header"
          style={{ flex: 1, opacity: titleOpacity, paddingHorizontal: 6 }}
        >
          <Text className="text-[16px] font-semibold text-ink" style={{ letterSpacing: -0.25 }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-[11px] leading-[14px] text-ink-3" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Animated.View>
        {right}
      </View>
      {borderless ? null : (
        <Animated.View
          pointerEvents="none"
          style={{ height: 1, backgroundColor: palette.line, opacity: borderOpacity }}
        />
      )}
    </View>
  )
}

/** A back button that knows the safe area. Used by every pushed screen. */
export function BackButton({ onPress, label = 'Back' }: { onPress: () => void; label?: string }) {
  return (
    <IconButton label={label} size={40} onPress={() => { void haptic('light'); onPress() }}>
      <ChevronLeft size={22} color={palette.ink} />
    </IconButton>
  )
}

/* ── Scroll progress ────────────────────────────────────────────────────────────
 * One `Animated.Value` per screen, shared by the large header and the app bar
 * through context. Two independent listeners on the same scroll offset is how
 * the two halves of a collapsing header end up a frame apart. */

const ScrollProgressContext = React.createContext<{ scrollY: Animated.Value }>({
  scrollY: new Animated.Value(0),
})

function useScrollProgress() {
  return React.useContext(ScrollProgressContext)
}

export function ScreenScaffold({
  title,
  eyebrow,
  subtitle,
  actions,
  below,
  children,
  onRefresh,
  refreshing,
  contentClassName,
  scroll = true,
  bottomInset = 0,
  keyboardAware = false,
  headerRight,
  headerLeft,
  style,
}: {
  title: string
  eyebrow?: string
  subtitle?: string
  actions?: React.ReactNode
  below?: React.ReactNode
  children: React.ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  contentClassName?: string
  scroll?: boolean
  /** Extra bottom padding, e.g. to clear the tab bar. */
  bottomInset?: number
  keyboardAware?: boolean
  headerRight?: React.ReactNode
  headerLeft?: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const scrollY = React.useRef(new Animated.Value(0)).current
  const context = React.useMemo(() => ({ scrollY }), [scrollY])

  const body = scroll ? (
    <Animated.ScrollView
      className="flex-1"
      contentContainerClassName={cn('pb-6', contentClassName)}
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      })}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={palette.ink3}
            colors={[palette.accent]}
            progressBackgroundColor={palette.surface}
          />
        ) : undefined
      }
    >
      <ConnectionStrip />
      <LargeHeader title={title} eyebrow={eyebrow} subtitle={subtitle} actions={actions} below={below} />
      {children}
    </Animated.ScrollView>
  ) : (
    <View className={cn('flex-1', contentClassName)}>
      <ConnectionStrip />
      {children}
    </View>
  )

  return (
    <ScrollProgressContext.Provider value={context}>
      <View className="flex-1 bg-canvas" style={style}>
        <AppBar title={title} subtitle={subtitle} left={headerLeft} right={headerRight} scrollY={scrollY} />
        {keyboardAware ? (
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
        {bottomInset > 0 ? <View style={{ height: bottomInset }} /> : null}
      </View>
    </ScrollProgressContext.Provider>
  )
}

/* ── Connection strip ─────────────────────────────────────────────────────────────
 * The single most important piece of ambient chrome in the app.
 *
 * A phone in a pocket is the thing you are least likely to be looking at and
 * most likely to be confused by. Every other state in this app is legible from
 * a row; "the desktop is unreachable" is not, because the rows just stop
 * updating and look identical to "nothing is happening". So connection trouble
 * is *never* silent: the strip slides in under the app bar, says what is wrong,
 * and offers the one action that can fix it.
 *
 * It animates rather than pops because appearing and disappearing should not
 * steal the content's position without warning. */

/**
 * The app bar's sibling: a strip that appears under the bar when the daemon is
 * unreachable. Internal to `ScreenScaffold` — a screen that wants an offline
 * banner is a screen that should not have its own connection model.
 */
function ConnectionStrip() {
  const connection = useStore((state) => state.connection)
  const loadSnapshot = useStore((state) => state.loadSnapshot)

  const troubled = connection !== 'connected'
  const progress = React.useRef(new Animated.Value(0)).current
  const visible = React.useRef(false)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    if (troubled && !visible.current) {
      visible.current = true
      setMounted(true)
      progress.setValue(0)
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: false, // `height` is a layout property; see useDisclosure.
        damping: 26,
        stiffness: 260,
        mass: 0.9,
      }).start()
    } else if (!troubled && visible.current) {
      visible.current = false
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: EASE_OUT,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [troubled, progress])

  if (!mounted) return null

  const reconnecting = connection === 'connecting' || connection === 'reconnecting'
  const message = reconnecting
    ? connection === 'connecting'
      ? 'Connecting to your desktop…'
      : 'Reconnecting — live updates are paused'
    : connection === 'unauthorized'
      ? 'Device revoked — pair again from Settings'
      : 'Offline — you can still read what was last synced'
  const tone = reconnecting ? 'wait' : 'danger'

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        opacity: progress,
        height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 40] }),
        overflow: 'hidden',
      }}
    >
      <View
        className="min-h-10 flex-row items-center gap-2.5 px-4"
        style={{ backgroundColor: tone === 'wait' ? palette.waitSoft : palette.dangerSoft }}
      >
        {reconnecting ? (
          <ActivityIndicator size="small" color={toneColor[tone]} />
        ) : (
          <WifiOff size={14} color={toneColor[tone]} />
        )}
        <Text className="min-w-0 flex-1 text-[12px] leading-[16px]" style={{ color: toneColor[tone] }} numberOfLines={2}>
          {message}
        </Text>
        {!reconnecting ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try reconnecting"
            onPress={() => {
              void haptic('light')
              void loadSnapshot()
            }}
            hitSlop={10}
            className="min-h-8 items-center justify-center rounded-sm px-3 active:opacity-70"
            style={{ backgroundColor: `${toneColor[tone]}22` }}
          >
            <Text className="text-[11.5px] font-semibold" style={{ color: toneColor[tone] }}>
              Retry
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  )
}

/* ── Section ──────────────────────────────────────────────────────────────────────
 * A titled block of a scrolling page, in the deck grammar: signal tick +
 * eyebrow + title + action. The `enter` index staggers the first few sections
 * so a page assembles itself rather than appearing all at once. */

export function Section({
  eyebrow,
  title,
  action,
  children,
  className,
  enterIndex,
}: {
  eyebrow?: string
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  enterIndex?: number
}) {
  const enter = React.useRef(
    new Animated.Value(enterIndex === undefined ? 1 : 0),
  ).current

  React.useEffect(() => {
    if (enterIndex === undefined) return
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: Math.min(enterIndex, 5) * 45,
      easing: EASE_OUT,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [enter, enterIndex])

  return (
    <Animated.View
      className={cn('gap-3 px-4', className)}
      style={
        enterIndex === undefined
          ? undefined
          : {
              opacity: enter,
              transform: [
                { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
              ],
            }
      }
    >
      {eyebrow || title || action ? (
        <View className="flex-row items-end justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            {eyebrow ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: palette.accent }} />
                <Eyebrow>{eyebrow}</Eyebrow>
              </View>
            ) : null}
            {title ? (
              <Text className="text-[16px] leading-[21px] font-bold text-ink" style={{ letterSpacing: -0.25 }} numberOfLines={2}>
                {title}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </Animated.View>
  )
}

/**
 * A group of rows with hairlines between them.
 *
 * The rules a scrollable page needs and a plain `View` cannot express: the
 * card clips its children to its radius (so a pressed row's fill does not
 * square off the corner), and each divider is *inset* by the row's own
 * leading-icon width, so the line starts where the text does rather than at
 * the card's edge. That inset is the whole difference between a list that looks
 * typeset and one that looks like a spreadsheet.
 */
export function ListCard({
  children,
  className,
  style,
  inset = 0,
}: {
  children: React.ReactNode
  className?: string
  style?: StyleProp<ViewStyle>
  /** Where the dividers start — the width of the row's leading slot. */
  inset?: number
}) {
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <View
      className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}
      style={style}
    >
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View className="h-px bg-line" style={{ marginLeft: inset }} /> : null}
          {child}
        </View>
      ))}
    </View>
  )
}

/** A card with a header row, the desktop's `PanelHeader` as a mobile row. */
export function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}
      style={style}
    >
      {children}
    </View>
  )
}

export { radius }

/**
 * Motion — the app's animation vocabulary.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this, every screen animated itself: some with core `Animated`, one
 * with `LayoutAnimation`, the sheets with `Modal animationType`, and the
 * composer with a per-component `Animated.loop`. The result was eleven
 * different entrances, four of which overshot, and a "premium" feel that was
 * really just inconsistency you only notice when you scrub back.
 *
 * Motion in this app has exactly three jobs, and every animation must serve
 * one of them:
 *
 *   1. **Explain a change of state.** A session moves from *working* to
 *      *needs approval* — the status pill, the row, and the notification all
 *      change, and the motion says "this changed, this is why".
 *   2. **Explain a change of space.** A sheet covers the screen; a plan
 *      expands; a row is inserted into the list. The motion shows where the
 *      content came from and where it went.
 *   3. **Acknowledge a finger.** A control pressed on must respond inside
 *      `duration.instant` (90ms) or it feels broken. This is the only job
 *      where the animation is for the person touching it rather than for the
 *      person reading.
 *
 * Anything that serves none of those is decoration, and decoration on a screen
 * that also streams text, diffs and status is a cost paid every second the
 * screen is open. There is deliberately no idle animation anywhere in the app
 * except the one thing that is genuinely in flight.
 *
 * THE MODEL
 * ---------
 * Core `Animated` with `useNativeDriver: true`, everywhere.
 *
 * Reanimated is installed and would put gesture worklets on the UI thread.
 * It is not used, for three reasons that all show up in practice:
 *   - every transform here is opacity/translate/scale, which the native driver
 *     already runs off the JS thread, so the win is close to zero;
 *   - Reanimated ships a *second* `Animated` and a Babel worklet plugin, so the
 *     app would have two animation models and one of them can fail to build;
 *   - it needs a test setup shim, and a component that only mounts under a
 *     shim is a component nobody tests.
 *
 * So: one model, one place that owns `Animated.Value` lifecycles, and
 * `design/tokens` owning every number. A screen cannot invent a timing.
 */

import * as React from 'react'
import {
  Animated,
  Easing,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { duration, palette, spring } from '../design/tokens'

/* ── The one easing ─────────────────────────────────────────────────────────
 * The desktop's `cubic-bezier(0.23, 1, 0.32, 1)`, expressed as a native
 * `Easing.bezier`. Every *enter* in the app uses it. It is front-loaded — most
 * of the distance is covered early and the last 20% settles — which is what
 * makes a sheet feel like it is being placed rather than dragged out. */

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

/* ── Enter / exit ────────────────────────────────────────────────────────────
 * `0 → 1`. Screens, sheets, cards and rows all mount with this so nothing in
 * the app ever simply *appears*. */

export function useEnter(delay = 0, disabled = false): Animated.Value {
  const value = React.useRef(new Animated.Value(disabled ? 1 : 0)).current
  React.useEffect(() => {
    if (disabled) {
      value.setValue(1)
      return
    }
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: duration.normal,
      delay,
      easing: EASE_OUT,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [value, delay, disabled])
  return value
}

/** Style for a view that fades and lifts 10pt into place. */
export function enterStyle(progress: Animated.Value, lift = 10) {
  return {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [lift, 0] }) },
    ],
  }
}

/** Style for a view that fades and scales up from 96% — dialogs, popovers. */
export function popStyle(progress: Animated.Value, from = 0.94) {
  return {
    opacity: progress,
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
  }
}

/**
 * A "just appeared" style for list items.
 *
 * The lift is 6pt, not 10: in a list, a 10pt rise reads as the whole list
 * jumping. 6pt reads as one row arriving.
 */
export function rowEnterStyle(progress: Animated.Value) {
  return {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
    ],
  }
}

/* ── Collapse ────────────────────────────────────────────────────────────────
 * Height transitions, for expanding a plan, a step group, a commit box.
 *
 * The height is *measured* rather than clamped to a magic number: an
 * animation hard-coded to `maxHeight: 300` is either too slow for a two-line
 * plan or visibly truncated for a ten-line one. Measuring on layout means the
 * same component animates a chip and a full transcript block at the right
 * speed. */

export interface CollapseResult {
  style: {
    height: Animated.AnimatedInterpolation<string | number>
    opacity: Animated.AnimatedInterpolation<number>
    overflow: 'hidden'
  }
  onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void
  /** True until the first layout pass, so callers can skip the animation. */
  measured: boolean
}

export function useCollapse(open: boolean, durationMs: number = duration.normal): CollapseResult {
  const progress = React.useRef(new Animated.Value(open ? 1 : 0)).current
  const [height, setHeight] = React.useState<number | null>(null)
  const [measured, setMeasured] = React.useState(false)

  React.useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: durationMs,
      easing: EASE_OUT,
      // `height` is not a native-driver-able property, so this one runs on the
      // JS thread. It is a layout-only animation on a small subtree, which is
      // the case the native driver cannot help with anyway.
      useNativeDriver: false,
    })
    animation.start()
    return () => animation.stop()
  }, [open, progress, durationMs])

  const onLayout = React.useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const next = event.nativeEvent.layout.height
      setHeight((current) => (current === next ? current : next))
      setMeasured(true)
    },
    [],
  )

  return {
    style: {
      height: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, height ?? 0],
      }),
      opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.4, 1] }),
      overflow: 'hidden',
    },
    onLayout,
    measured,
  }
}

/* ── Press ───────────────────────────────────────────────────────────────────
 * A pressable with spring feedback.
 *
 * `Pressable`'s `active` styles are instant, which is correct for colour but
 * wrong for scale: a hard cut on a transform reads as a glitch, because the
 * eye tracks the object's silhouette and a silhouette cannot teleport. This
 * springs the scale instead, and springs it *back* faster than it goes in —
 * release is the part the finger is watching.
 */

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>
  /**
   * Visual size of the glyph. The *target* is grown to `TOUCH_MIN` with
   * `hitSlop` by the caller, so this only ever describes the picture.
   */
  scaleTo?: number
  /** How far it compresses. 0.97 is a nudge; 0.9 is a button you can feel. */
  scaleAmount?: number
  children: React.ReactNode
}

/** Android's 48dp / iOS's 44pt. The stricter one, everywhere. */
export const TOUCH_MIN = 48

export function Touchable({
  scaleTo = 0.96,
  scaleAmount = 1,
  disabled,
  style,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: TouchableProps) {
  const scale = React.useRef(new Animated.Value(1)).current

  const animate = React.useCallback(
    (to: number, config: { damping: number; stiffness: number; mass: number }) => {
      Animated.spring(scale, {
        toValue: to,
        useNativeDriver: true,
        ...config,
      }).start()
    },
    [scale],
  )

  return (
    <Pressable
      onPressIn={(event) => {
        animate(1 - (1 - scaleTo) * scaleAmount, spring.snappy)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        animate(1, spring.snappy)
        onPressOut?.(event)
      }}
      disabled={disabled}
      {...rest}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]} pointerEvents="box-none">
        {children}
      </Animated.View>
    </Pressable>
  )
}

/* ── Live motion ─────────────────────────────────────────────────────────────
 * The only looping animations in the app, and each one means something:
 *
 *   `usePulse`  — a session is genuinely in flight. This is the desktop's
 *                 `.breathe`, and it is reserved for `working`/`starting`/
 *                 `resuming`. A waiting-for-you session does NOT pulse: it is
 *                 static and orange, because motion would imply "it is
 *                 progressing" and it is not — it is stuck on you.
 *   `useShimmer`— a surface has unknown content. The band runs once per
 *                 `duration.loop`; a slower band reads as "stuck", not "loading".
 */

export function usePulse(active: boolean, periodMs = 1800): Animated.Value {
  const value = React.useRef(new Animated.Value(1)).current
  React.useEffect(() => {
    if (!active) {
      value.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.32, duration: periodMs / 2, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: periodMs / 2, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [active, value, periodMs])
  return value
}

export function useShimmer(active: boolean, periodMs = 1400): Animated.Value {
  const value = React.useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    if (!active) return
    const loop = Animated.loop(
      Animated.timing(value, {
        toValue: 1,
        duration: periodMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [active, value, periodMs])
  return value
}

/**
 * A breathing halo around a live dot.
 *
 * A pulsing dot is a *change* in opacity, which most people perceive as a
 * flicker. A halo that scales and fades reads as a ripple travelling outward
 * — "this is emitting" — and it does not compete with the dot's own colour for
 * attention. It is also `pointerEvents="none"`, so it can never eat a tap on
 * the control it decorates.
 */
export function LiveHalo({ color = palette.ok, size = 22 }: { color?: string; size?: number }) {
  const progress = usePulse(true)
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        left: -size / 2,
        top: -size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }],
      }}
    />
  )
}

/* ── Skeleton ────────────────────────────────────────────────────────────────
 * The loading state for anything with a known shape.
 *
 * A spinner says "something is happening" and tells you nothing about what is
 * about to arrive, which is why every list in the old app flashed three dots
 * and then jumped to a completely different layout. A skeleton occupies the
 * space the content will occupy, so the screen does not reflow when it lands.
 */

export function Skeleton({
  width,
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | `${number}%`
  height?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}) {
  const shimmer = useShimmer(true)
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: radius,
          backgroundColor: palette.raised,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          width: '60%',
          height: '100%',
          backgroundColor: palette.shimmer,
          transform: [
            {
              translateX: shimmer.interpolate({
                inputRange: [0, 1],
                outputRange: [-220, 420],
              }),
            },
            // A skew sells the direction of travel; without it the band looks
            // like the block itself is sliding.
            { rotate: '-8deg' },
          ],
        }}
      />
    </View>
  )
}

/** The list-row skeleton: a dot, two lines of text, and a trailing pill. */
export function RowSkeleton() {
  const enter = useEnter(0, false)
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, enterStyle(enter, 6)]}
    >
      <Skeleton width={22} height={22} radius={11} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width="62%" height={13} />
        <Skeleton width="38%" height={10} />
      </View>
      <Skeleton width={54} height={20} radius={10} />
    </Animated.View>
  )
}

/* ── Staggered lists ─────────────────────────────────────────────────────────────
 * `staggerDelay(index)` is the entrance delay for row *n* of a batch.
 *
 * A stagger is only right when the rows appear *together*. If a list streams in
 * over time (a transcript), staggering is wrong — it delays content the user is
 * already waiting for. So this is for a list loaded as a batch, and every list
 * that uses it is loaded as one.
 *
 * The cap matters more than the step: 26ms × 10 is 260ms, and past that the
 * last row lands later than a person will keep looking at an already-loaded
 * list. A 30-row list therefore shows its first ten staggered and the rest
 * together, which reads as "the list finished arriving" rather than as a wait.
 */

const STAGGER_MS = 26
const STAGGER_CAP = 10

export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_MS
}

/* ── Disclosure ────────────────────────────────────────────────────────────────
 * Show or hide a block of *content*, as opposed to `useCollapse` which shows
 * or hides a block of *chrome* inside something already measured.
 *
 * The subtlety is that the two halves of this animation cannot share a driver.
 * Height is a layout property, and the native driver refuses to animate it —
 * asking it to logs a warning and silently falls back, which is exactly the
 * kind of thing that works on one platform and janks on another. So: height
 * runs on the JS driver, opacity and translate run natively, and the two
 * values are written by the same call. A user watching a disclosure sees the
 * content fade in while the box grows around it, and neither half drops a
 * frame.
 */

export interface DisclosureResult {
  /** Attach to the container. Animates opacity, translateY and height. */
  style: {
    opacity: Animated.AnimatedInterpolation<number>
    transform: Array<{ translateY: Animated.AnimatedInterpolation<number> }>
    height: Animated.AnimatedInterpolation<string | number> | number | undefined
    overflow: 'hidden'
  }
  onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void
  /** Apply to the trigger: the chevron that rotates. */
  indicatorStyle: { transform: Array<{ rotate: Animated.AnimatedInterpolation<string> }> }
}

export function useDisclosure(open: boolean, durationMs: number = duration.normal): DisclosureResult {
  // Layout — JS driver, because `height` is not a native-driver property.
  const layout = React.useRef(new Animated.Value(open ? 1 : 0)).current
  // Visual — native driver, because these are transform and opacity only.
  const visual = React.useRef(new Animated.Value(open ? 1 : 0)).current
  const [height, setHeight] = React.useState<number | null>(null)

  React.useEffect(() => {
    const toValue = open ? 1 : 0
    Animated.timing(layout, {
      toValue,
      duration: durationMs,
      easing: EASE_OUT,
      useNativeDriver: false,
    }).start()
    Animated.timing(visual, {
      toValue,
      duration: durationMs,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start()
  }, [layout, open, visual, durationMs])

  const onLayout = React.useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const next = event.nativeEvent.layout.height
      setHeight((current) => (current === next ? current : next))
    },
    [],
  )

  return {
    style: {
      opacity: visual,
      transform: [
        { translateY: visual.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
      ],
      height:
        height === null
          ? undefined
          : layout.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
      overflow: 'hidden',
    },
    onLayout,
    indicatorStyle: {
      transform: [
        { rotate: visual.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) },
      ],
    },
  }
}


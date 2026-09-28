/**
 * Glass — the iOS 26 liquid-glass chrome, with a fallback that keeps the desktop
 * look everywhere else.
 *
 * `@callstack/liquid-glass` is the native effect (not a blurred-image imitation):
 * it renders `UIVisualEffectView`-style glass that adapts to whatever scrolls
 * behind it. It only exists on iOS 26+, so on older iOS and on Android this falls
 * back to the desktop's own surface token — the same `#26262b` the dashboard
 * uses, with the same hairline — so the app never looks half-finished.
 *
 * Where it is used deliberately: chrome only. Headers, the rail bars, the
 * composer card and the floating action sit over scrolling content, which is
 * exactly what glass is for. Content cards stay solid `bg-surface`, because that
 * is what the desktop does and glass behind body text costs legibility.
 */

import * as React from 'react'
import { Platform, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { cssInterop } from 'react-native-css-interop'
import { isLiquidGlassSupported, LiquidGlassView, LiquidGlassContainerView } from '@callstack/liquid-glass'

import { cn } from '@/lib/format'

/** True only where the native effect actually renders. */
export const GLASS = Platform.OS === 'ios' && isLiquidGlassSupported

// Lets NativeWind apply `className` to the native view, so call sites do not have
// to branch on platform for styling.
cssInterop(LiquidGlassView, { className: 'style' })

/** The desktop's surface + hairline, used wherever glass is unavailable. */
const FALLBACK = 'border border-line bg-surface'

export function GlassSurface({
  effect = 'regular',
  interactive,
  tint,
  radius = 16,
  className,
  style,
  children,
  ...rest
}: ViewProps & {
  effect?: 'clear' | 'regular' | 'none'
  /** Grows and shimmers on touch — for buttons and tappable bars. */
  interactive?: boolean
  tint?: string
  radius?: number
}) {
  if (!GLASS) {
    return (
      <View className={cn(FALLBACK, className)} style={style} {...rest}>
        {children}
      </View>
    )
  }
  return (
    <LiquidGlassView
      effect={effect}
      interactive={interactive}
      tintColor={tint}
      colorScheme="dark"
      className={className}
      style={[{ borderRadius: radius, overflow: 'hidden' }, style as StyleProp<ViewStyle>]}
      {...rest}
    >
      {children}
    </LiquidGlassView>
  )
}

/**
 * Groups several glass elements so they merge into one material as they get
 * close — the behaviour iOS uses for a toolbar of separate buttons.
 */
export function GlassGroup({
  spacing = 8,
  className,
  style,
  children,
}: ViewProps & { spacing?: number }) {
  if (!GLASS) {
    return (
      <View className={cn('flex-row items-center', className)} style={style}>
        {children}
      </View>
    )
  }
  return (
    <LiquidGlassContainerView
      spacing={spacing}
      className={className}
      style={style as StyleProp<ViewStyle>}
    >
      {children}
    </LiquidGlassContainerView>
  )
}

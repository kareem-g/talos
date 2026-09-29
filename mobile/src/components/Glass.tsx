/**
 * Glass — iOS 26 liquid-glass chrome.
 *
 * Apple's design principle: "Translucent materials convey hierarchy."
 * Glass is used for chrome that floats over scrolling content (headers,
 * toolbars, sheets, floating pills). Content cards stay solid bg-surface
 * because glass behind body text costs legibility.
 *
 * Material weight encodes hierarchy:
 *   - Headers/toolbars: regular effect (medium blur)
 *   - Floating pills/sheets: regular + interactive (grows on touch)
 *   - Subtle overlays: clear effect (light tint, minimal blur)
 *
 * Fallback: when liquid glass is unavailable (Android, older iOS), surfaces
 * use a refined dark tone with a bright top-edge hairline that mimics light
 * catching the edge of a physical material.
 */

import * as React from 'react'
import { Platform, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { cssInterop } from 'react-native-css-interop'
import { isLiquidGlassSupported, LiquidGlassView, LiquidGlassContainerView } from '@callstack/liquid-glass'

import { cn } from '@/lib/format'

export const GLASS = Platform.OS === 'ios' && isLiquidGlassSupported

cssInterop(LiquidGlassView, { className: 'style' })

/** Refined fallback: surface with a bright top edge to simulate light catch. */
const FALLBACK_BASE = 'bg-surface border-b border-line-strong'

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
  interactive?: boolean
  tint?: string
  radius?: number
}) {
  if (!GLASS) {
    return (
      <View
        className={cn(FALLBACK_BASE, className)}
        style={[{ borderRadius: radius, overflow: 'hidden' }, style as StyleProp<ViewStyle>]}
        {...rest}
      >
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
 * Groups glass elements so they merge into one material when close —
 * the behaviour iOS uses for toolbar buttons.
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

/**
 * `Text` — React Native's, with the app's default face.
 *
 * React has no cascade and RN has no global font, so a bundled family only
 * reaches text that names it. The app has ~300 `<Text>` elements across 37
 * files, and rewriting every one of them into a typography component would be a
 * large, risky change to get one property onto them.
 *
 * So this file is a thin pass-through with exactly one job: supply
 * `fontFamily: SpaceGrotesk-Medium` when the caller has not asked for a family
 * of their own. Every mono surface in the app sets `fontFamily` inline (there
 * are no `font-mono` classes), so an explicit family always wins and nothing
 * that should be monospaced gets rendered in the UI face.
 *
 * Change an import, not 300 call sites.
 */

import * as React from 'react'
import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native'

import { SANS } from '@app/design/fonts'

export type TextProps = RNTextProps

export const Text = React.forwardRef<RNText, RNTextProps>(function Text({ style, ...props }, ref) {
  // `flatten` rather than a shallow check: callers pass arrays, and a family
  // nested one level down would otherwise be missed and overridden.
  const resolved = React.useMemo(() => {
    const flat = StyleSheet.flatten(style) as { fontFamily?: string } | undefined
    if (flat?.fontFamily) return style
    return [{ fontFamily: SANS }, style]
  }, [style])

  return <RNText ref={ref} {...props} style={resolved} />
})
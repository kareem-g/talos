/**
 * fonts — the JetBrains Mono faces ship as assets for machine text; the sans
 * ramp is the platform system face, addressed through distinct weight
 * sentinels so semibold and bold resolve honestly.
 */

import JetBrainsRegular from '../../assets/fonts/JetBrainsMono-Regular.ttf'
import JetBrainsSemiBold from '../../assets/fonts/JetBrainsMono-SemiBold.ttf'

export const FONT_ASSETS = {
  'JetBrainsMono-Regular': JetBrainsRegular,
  'JetBrainsMono-SemiBold': JetBrainsSemiBold,
} as const

export const MONO = 'JetBrainsMono-Regular'
export const MONO_BOLD = 'JetBrainsMono-SemiBold'

export const W_MEDIUM = 'sans:500'
export const W_SEMI = 'sans:600'
export const W_BOLD = 'sans:700'

export function fontOf(token?: string): { fontFamily?: string; fontWeight?: '400' | '500' | '600' | '700' } {
  switch (token) {
    case W_MEDIUM:
      return { fontWeight: '500' }
    case W_SEMI:
      return { fontWeight: '600' }
    case W_BOLD:
      return { fontWeight: '700' }
    case MONO:
      return { fontFamily: MONO }
    case MONO_BOLD:
      return { fontFamily: MONO, fontWeight: '600' }
    default:
      return {}
  }
}

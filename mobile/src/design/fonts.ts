/**
 * The app's faces.
 *
 * Three families, each with one job — the same division the boards use:
 *
 *   Space Grotesk  the instrument's voice: chrome, labels, headings, readouts.
 *                  A grotesque with a little character in the counters, which
 *                  is what stops a dense control surface reading as a settings
 *                  screen.
 *   Inter          the one place a human reading face is correct — the prose an
 *                  agent wrote. Grotesques tire the eye over paragraphs.
 *   JetBrains Mono every id, path, count, timestamp and status word, so the
 *                  app reads in columns.
 *
 * These are static instances (one file per weight) fetched from Google Fonts
 * under the OFL, bundled in `assets/fonts` and registered by `expo-font` at
 * boot. RN cannot interpolate a variable font, which is why they are static
 * rather than one variable file per family.
 */

import SpaceGroteskMedium from '../../assets/fonts/SpaceGrotesk-Medium.ttf'
import SpaceGroteskSemiBold from '../../assets/fonts/SpaceGrotesk-SemiBold.ttf'
import InterRegular from '../../assets/fonts/Inter-Regular.ttf'
import InterMedium from '../../assets/fonts/Inter-Medium.ttf'
import InterSemiBold from '../../assets/fonts/Inter-SemiBold.ttf'
import JetBrainsMonoRegular from '../../assets/fonts/JetBrainsMono-Regular.ttf'
import JetBrainsMonoSemiBold from '../../assets/fonts/JetBrainsMono-SemiBold.ttf'

/** Passed straight to `useFonts`. The keys ARE the family names. */
export const FONT_ASSETS = {
  'SpaceGrotesk-Medium': SpaceGroteskMedium,
  'SpaceGrotesk-SemiBold': SpaceGroteskSemiBold,
  'Inter-Regular': InterRegular,
  'Inter-Medium': InterMedium,
  'Inter-SemiBold': InterSemiBold,
  'JetBrainsMono-Regular': JetBrainsMonoRegular,
  'JetBrainsMono-SemiBold': JetBrainsMonoSemiBold,
} as const

/** The default UI face. Every `Text` in the app gets this unless it says otherwise. */
export const SANS = 'SpaceGrotesk-Medium'
export const SANS_SEMIBOLD = 'SpaceGrotesk-SemiBold'

/** Long-form agent prose. */
export const PROSE = 'Inter-Regular'
export const PROSE_MEDIUM = 'Inter-Medium'
export const PROSE_SEMIBOLD = 'Inter-SemiBold'

/** Data. */
export const MONO = 'JetBrainsMono-Regular'
export const MONO_SEMIBOLD = 'JetBrainsMono-SemiBold'
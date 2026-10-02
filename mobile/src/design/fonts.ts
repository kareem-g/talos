/**
 * The app's faces.
 *
 * THE UI IS THE SYSTEM FONT, ON PURPOSE.
 * -------------------------------------
 * The reference for this app is iOS itself: the page is black, the cards are
 * Apple's greys, the controls are capsules, and the type is SF Pro. A bundled
 * grotesque — which is what this file used to load — fights all of that. It made
 * every screen read as "an app with a brand font" instead of "the phone",
 * which is the opposite of the quiet, native feel the design is after.
 *
 * So the UI face is the platform's own: no `fontFamily`, and the type scale
 * carries the weight. That also means there is nothing to load at boot for the
 * UI, and nothing to fall back from.
 *
 * THE MONO FACE IS BUNDLED, because it is a *readout*, not prose. Every id,
 * path, count, timestamp and status word is set in it so the app reads in
 * columns, and the platform monos (Menlo, Droid Sans Mono) are the one thing
 * iOS and Android do not agree on. JetBrains Mono is what the desktop uses, so
 * a diff on the phone and a diff in the browser are the same typeface.
 */

import JetBrainsMonoRegular from '../../assets/fonts/JetBrainsMono-Regular.ttf'
import JetBrainsMonoSemiBold from '../../assets/fonts/JetBrainsMono-SemiBold.ttf'

/** Passed straight to `useFonts`. The keys ARE the family names. */
export const FONT_ASSETS = {
  'JetBrainsMono-Regular': JetBrainsMonoRegular,
  'JetBrainsMono-SemiBold': JetBrainsMonoSemiBold,
} as const

/**
 * The UI face. `undefined` means "let the platform choose" — SF Pro on iOS,
 * Roboto on Android — which is the whole point.
 */
export const SANS: string | undefined = undefined
export const SANS_SEMIBOLD: string | undefined = undefined

/** Long-form prose the agent wrote: also the system face, for the same reason. */
export const PROSE: string | undefined = undefined
export const PROSE_MEDIUM: string | undefined = undefined
export const PROSE_SEMIBOLD: string | undefined = undefined

/** Data. */
export const MONO = 'JetBrainsMono-Regular'
export const MONO_SEMIBOLD = 'JetBrainsMono-SemiBold'
/**
 * The navigation container ref — in its own module, deliberately.
 *
 * `navigation.tsx` imports every screen, and screens import this ref to navigate
 * (the drawer, the workspace rail, the command sheet, the new-task host, the
 * Deck's connection card). Keeping the ref inside `navigation.tsx` therefore
 * created require cycles — `navigation → SessionScreen → CommandPalette →
 * navigation` — and Metro warns about them for a reason: a cycle can hand a
 * module an uninitialized binding, and this ref is exactly the kind of
 * module-level value that would silently become `undefined`.
 *
 * This module imports nothing but a type, so nothing can cycle through it.
 *
 * The param list is imported as a TYPE only, which is erased at build time and
 * therefore cannot reintroduce the cycle it was extracted to avoid.
 */

import { createNavigationContainerRef } from '@react-navigation/native'

import type { RootStackParamList } from '@app/navigation'

export const navigationRef = createNavigationContainerRef<RootStackParamList>()
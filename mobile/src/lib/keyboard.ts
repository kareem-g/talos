/**
 * The keyboard's height, in points.
 *
 * Edge-to-edge rendering stops Android from resizing the window for the IME —
 * `adjustResize` is ignored and the keyboard draws *over* the app. Anything
 * anchored to the bottom then disappears behind it: the composer became
 * unreachable the moment a user started typing.
 *
 * Reading the height straight from the keyboard events and padding for it
 * gives the same result the resize used to: the composer sits on top of the
 * keyboard and the transcript keeps whatever room is left.
 */

import * as React from 'react'
import { Keyboard, Platform } from 'react-native'

export function useKeyboardHeight(): number {
  const [height, setHeight] = React.useState(0)
  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (event) => setHeight(event.endCoordinates?.height ?? 0))
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}
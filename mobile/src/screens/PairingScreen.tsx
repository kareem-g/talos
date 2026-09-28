/**
 * Pairing — scan the desktop's QR (or paste the code) to exchange it for a device
 * token. Phase C implements the camera scanner (expo-camera) and the manual
 * fallback via `parsePairingLink` + `pairingApi.verify`; this is the placeholder
 * route so the navigator is complete.
 */

import * as React from 'react'
import { Text, View } from 'react-native'

export function PairingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-canvas px-6">
      <Text className="text-base text-ink">Pair with your desktop</Text>
      <Text className="mt-2 text-center text-xs text-ink-3">
        QR scanning and manual pairing arrive in Phase C.
      </Text>
    </View>
  )
}

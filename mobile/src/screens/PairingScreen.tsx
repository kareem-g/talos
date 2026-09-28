/**
 * Pairing — exchange the desktop's QR (or a pasted link) for a device token.
 *
 * The daemon shows a `<base>/mobile/pair?offer=…&secret=…` URL as a QR. We scan
 * it (expo-camera) or let the user paste it, parse it with the same
 * `parsePairingLink` the web shell uses, POST it to `/api/pair/verify`, and store
 * the returned token + origin. Then connect the socket and hand off to Home.
 *
 * The camera is a convenience, never a requirement: scanning needs permission
 * and a working sensor, so the manual paste path is always available.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SafeAreaView } from 'react-native-safe-area-context'

import { pairingApi, ApiError } from '@app/lib/api'
import { parsePairingLink } from '@app/lib/native'
import { deviceKey, deviceName, savePairing } from '@app/lib/pairing'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { Button, ScreenHeader } from '@app/components/ui'

export function PairingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [permission, requestPermission] = useCameraPermissions()
  const [manual, setManual] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [scanned, setScanned] = React.useState(false)

  async function handlePairingText(text: string) {
    if (busy) return
    setError(null)
    const parsed = parsePairingLink(text)
    if (!parsed) {
      setError('That does not look like an AgentDeck pairing code. Scan the QR on your desktop, or paste the full link.')
      return
    }
    setBusy(true)
    try {
      const result = await pairingApi.verify({
        offerId: parsed.offerId,
        secret: parsed.secret,
        deviceKey: deviceKey(),
        deviceName: deviceName(),
      })
      await savePairing(parsed.baseUrl, result.token)
      // The store already wired its frame/state listeners at boot; now that the
      // origin and token exist, connect and pull the first snapshot.
      socket.connect()
      void useStore.getState().loadSnapshot()
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
    } catch (cause) {
      setBusy(false)
      setScanned(false) // allow a re-scan after a failure
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Pairing failed. Check the code is current (offers expire in two minutes) and the daemon is reachable.',
      )
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <ScreenHeader title="Pair with your desktop" subtitle="Scan the code AgentDeck is showing" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="gap-4 p-4">
          {/* Scanner */}
          <View className="overflow-hidden rounded-card border border-line bg-inset">
            {permission?.granted ? (
              <CameraView
                style={{ height: 260 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={
                  scanned || busy
                    ? undefined
                    : ({ data }) => {
                        setScanned(true)
                        void handlePairingText(data)
                      }
                }
              />
            ) : (
              <View className="items-center justify-center px-6" style={{ height: 260 }}>
                <Text className="mb-3 text-center text-xs text-ink-3">
                  {permission && !permission.granted && !permission.canAskAgain
                    ? 'Camera access is off. Paste the pairing link below instead.'
                    : 'Allow the camera to scan the pairing code, or paste the link below.'}
                </Text>
                {permission?.canAskAgain !== false ? (
                  <Button variant="primary" label="Enable camera" onPress={() => void requestPermission()} />
                ) : null}
              </View>
            )}
          </View>

          {/* Manual fallback */}
          <View className="gap-2">
            <Text className="text-xs font-medium text-ink-2">Or paste the pairing link</Text>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder="https://…/mobile/pair?offer=…&secret=…"
              placeholderTextColor="#7e7e86"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              className="rounded-control border border-line bg-field px-3 py-3 text-[13px] text-ink"
            />
            <Button
              variant="primary"
              label={busy ? 'Pairing…' : 'Pair'}
              disabled={busy || manual.trim().length === 0}
              onPress={() => void handlePairingText(manual.trim())}
              className="self-start"
            />
          </View>

          {error ? (
            <View className="rounded-control border border-red-border bg-red-tint px-3 py-2.5">
              <Text className="text-xs leading-5 text-red">{error}</Text>
            </View>
          ) : null}

          <Text className="text-[11px] leading-5 text-ink-3">
            On your desktop, open the AgentDeck dashboard's Remote screen to show a pairing code.
            Offers expire after two minutes and work once.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/**
 * Pairing — exchange the desktop's QR (or a pasted link) for a device token.
 *
 * Layout mirrors the desktop's `NativePairingGate`, which is the same screen for
 * the same audience: brand tile, "Pair with your desktop", one primary scan
 * action, and the manual link tucked behind a toggle. The desktop bundles that
 * screen into its native shell; here it is native for real.
 *
 * The offer is tried against EVERY origin the QR advertised, not just the one it
 * was encoded with. The daemon lists the tailnet MagicDNS name first because it
 * is the best route when it works, but a phone with MagicDNS off cannot resolve
 * `.ts.net` — and a phone away from home cannot use the LAN address. Trying each
 * in order is what stopped a tailnet QR from failing against a daemon that was
 * perfectly reachable on its other routes.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SafeAreaView } from 'react-native-safe-area-context'

import { pairingApi, ApiError } from '@app/lib/api'
import { parsePairingLink, setDeviceBaseUrl } from '@app/lib/native'
import { deviceKey, deviceName, savePairing } from '@app/lib/pairing'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { BrandMark, Button, Mono, TextField } from '@app/components/ui'

/**
 * True when the failure is transport-level rather than "this offer is no good".
 * Only a transport failure is worth retrying against another advertised route;
 * an expired or already-spent offer answers the same way from every host.
 */
function isRouteUnreachable(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 0 || cause.code === 'network_error')
}

export function PairingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [permission, requestPermission] = useCameraPermissions()
  const [scanning, setScanning] = React.useState(false)
  const [showPaste, setShowPaste] = React.useState(false)
  const [manual, setManual] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [scanned, setScanned] = React.useState(false)
  const [route, setRoute] = React.useState<string | null>(null)

  async function handlePairingText(text: string) {
    if (busy) return
    setError(null)
    const parsed = parsePairingLink(text)
    if (!parsed) {
      setError('That does not look like an AgentDeck pairing code. Scan the QR on your desktop, or paste the full link.')
      return
    }
    setBusy(true)
    const routes = parsed.baseUrls
    let lastError: unknown
    for (const candidate of routes) {
      try {
        // Set the daemon origin BEFORE verifying. React Native has no page origin
        // to resolve a relative URL against, so without this the verify request
        // goes to a bare "/api/pair/verify" and never reaches the daemon.
        setRoute(candidate)
        setDeviceBaseUrl(candidate)
        const result = await pairingApi.verify({
          offerId: parsed.offerId,
          secret: parsed.secret,
          deviceKey: deviceKey(),
          deviceName: deviceName(),
        })
        // Keep the whole route list, winner first, so the socket can fail over
        // later without the phone having to be re-paired.
        await savePairing(candidate, result.token, routes)
        socket.connect()
        void useStore.getState().loadSnapshot()
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] })
        return
      } catch (cause) {
        lastError = cause
        // A spent or expired offer fails identically on every route — retrying
        // the others would only burn time.
        if (!isRouteUnreachable(cause)) break
      }
    }
    setBusy(false)
    setScanned(false) // allow a re-scan after a failure
    setError(
      lastError instanceof ApiError && !isRouteUnreachable(lastError)
        ? lastError.message
        : 'Could not reach your desktop on any advertised route. Check the daemon is running and that this phone is on the same Wi‑Fi or signed in to the same tailnet.',
    )
  }

  function startScanning() {
    setError(null)
    setScanned(false)
    if (permission?.granted) {
      setScanning(true)
      return
    }
    void requestPermission().then((next) => setScanning(next.granted))
  }

  if (scanning && permission?.granted) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 overflow-hidden">
          <CameraView
            style={{ flex: 1 }}
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
        </View>
        <View className="gap-3 p-4">
          {busy && route ? <Mono className="text-[11px]">Reaching {route}…</Mono> : null}
          {error ? (
            <View className="rounded-xl border border-red-border bg-red-tint px-3 py-2.5">
              <Text className="text-[12px] leading-5 text-ink">{error}</Text>
            </View>
          ) : (
            <Mono className="text-[11px]">Point the camera at the code on your desktop.</Mono>
          )}
          <Button
            variant="surface"
            label={busy ? 'Pairing…' : 'Cancel'}
            disabled={busy}
            onPress={() => setScanning(false)}
          />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow items-center justify-center gap-6 px-6 py-10">
          <View className="items-center gap-2">
            <View className="size-11 items-center justify-center rounded-lg bg-surface">
              <BrandMark size={26} />
            </View>
            <Text className="text-[17px] font-semibold text-ink">Pair with your desktop</Text>
            <Text className="max-w-[34ch] text-center text-[12.5px] leading-5 text-ink-3">
              Open AgentDeck on your computer, go to the pairing page, and scan the code with this
              device.
            </Text>
          </View>

          <View className="w-full max-w-sm gap-3">
            <Button variant="primary" label="Scan pairing code" onPress={startScanning} />

            <Pressable
              onPress={() => setShowPaste((open) => !open)}
              accessibilityRole="button"
              className="items-center py-1"
            >
              <Text className="text-[12px] font-medium text-ink-3">
                {showPaste ? 'Hide manual entry' : 'Enter the link manually'}
              </Text>
            </Pressable>

            {showPaste ? (
              <View className="gap-2">
                <TextField
                  value={manual}
                  onChangeText={setManual}
                  placeholder="http://192.168.1.8:9120/mobile/pair?offer=…&secret=…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                />
                <Button
                  variant="surface"
                  label={busy ? 'Pairing…' : 'Pair this device'}
                  disabled={busy || manual.trim().length === 0}
                  onPress={() => void handlePairingText(manual.trim())}
                />
              </View>
            ) : null}

            {busy && route ? <Mono className="text-[11px]">Reaching {route}…</Mono> : null}

            {error ? (
              <View className="rounded-xl border border-red-border bg-red-tint px-3 py-2.5">
                <Text className="text-[12px] leading-5 text-ink">{error}</Text>
              </View>
            ) : null}

            <Text className="text-center text-[11px] leading-4 text-ink-3">
              Codes expire after two minutes and work once. If the tailnet name does not resolve here,
              the same code also carries the tailnet IP and the home LAN address.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

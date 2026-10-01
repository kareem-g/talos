/**
 * Pairing — exchange the desktop's QR (or a pasted link) for a device token.
 *
 * QAI SIGNAL DECK
 * ---------------
 * Scanning is the primary state (a phone scans; a browser cannot), manual
 * entry one tap below. Every advertised route is tried in turn — tailnet name
 * first, then IP, then LAN — because the best route when it works is unusable
 * when MagicDNS is off or the phone is away. Transport failures retry across
 * routes; spent offers stop immediately. The reticle glows accent on a
 * true-black viewfinder; the landing stacks the QAI mark over one promise
 * and the scan button.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { QrCode } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ApiError, pairingApi } from '@app/lib/api'
import { parsePairingLink, setDeviceBaseUrl } from '@app/lib/native'
import { deviceKey, deviceName, savePairing } from '@app/lib/pairing'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { Touchable, enterStyle, useEnter } from '@app/components/motion'
import {
  BrandMark,
  Button,
  Card,
  ErrorState,
  Field,
  Mono,
  haptic,
  toast,
} from '@app/components/ui'

/**
 * True when the failure is transport-level rather than "this offer is no good".
 * Only a transport failure is worth retrying against another advertised route.
 */
function isRouteUnreachable(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 0 || cause.code === 'network_error')
}

/** Reticle geometry. Corner brackets, not a full frame: brackets say how big
    the code needs to be; a frame only says where it is. */
const RETICLE_SIZE = 244
const RETICLE_CORNER = 44

export function PairingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [scanning, setScanning] = React.useState(false)
  const [showPaste, setShowPaste] = React.useState(false)
  const [manual, setManual] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [scanned, setScanned] = React.useState(false)
  const [route, setRoute] = React.useState<string | null>(null)

  const heroEnter = useEnter(0, false)
  const actionsEnter = useEnter(70, false)

  async function handlePairingText(text: string) {
    if (busy) return
    setError(null)
    const parsed = parsePairingLink(text)
    if (!parsed) {
      setError('That does not look like a QAI pairing code. Scan the QR on your desktop, or paste the full link.')
      void haptic('error')
      return
    }
    setBusy(true)
    void haptic('medium')
    const routes = parsed.baseUrls
    let lastError: unknown
    for (const candidate of routes) {
      try {
        // Set the daemon origin BEFORE verifying. React Native has no page
        // origin to resolve a relative URL against, so without this the verify
        // request goes to a bare "/api/pair/verify" and never reaches the
        // daemon.
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
        void haptic('success')
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
        : 'Could not reach your desktop on any advertised route. Check that the daemon is running and that this phone is on the same Wi-Fi, or signed in to the same tailnet.',
    )
    void haptic('error')
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

  /* ── Scanner ────────────────────────────────────────────────────────────
     The camera is full-bleed on a true-black viewfinder — the viewfinder is
     not part of the app's surface ramp, and tinting it would tint the live
     image the user is trying to read. Chrome floats over it: a rounded corner
     reticle in the accent, and a pill rail at the bottom for status and
     Cancel, each on a scrim so it stays readable against whatever the camera
     is pointing at. */
  if (scanning && permission?.granted) {
    return (
      <View className="flex-1 bg-viewfinder">
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

        {/* Reticle. Four rounded corner brackets in the accent — the one place
            decoration and function are the same thing: the brackets ARE the
            aiming aid. */}
        <View pointerEvents="none" style={{ ...StyleSheetAbsolute, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: RETICLE_SIZE, height: RETICLE_SIZE }}>
            {[
              { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
              { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
              { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
              { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
            ].map((corner, index) => (
              <View
                key={index}
                style={{
                  position: 'absolute',
                  width: RETICLE_CORNER,
                  height: RETICLE_CORNER,
                  borderRadius: 18,
                  borderColor: palette.accent,
                  ...corner,
                }}
              />
            ))}
          </View>
        </View>

        {/* Bottom rail — status, then the Cancel pill. Every element sits on
            its own scrim so it survives a bright camera frame. */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          }}
        >
          {busy && route ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.lineStrong,
                backgroundColor: palette.scrim,
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}
            >
              <ActivityIndicator size="small" color={palette.accent} />
              <Mono className="flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
                Reaching {route}…
              </Mono>
            </View>
          ) : null}

          {error ? (
            <View
              accessibilityRole="alert"
              style={{
                width: '100%',
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.dangerBorder,
                backgroundColor: palette.dangerSoft,
                padding: 12,
              }}
            >
              <Text className="text-[13px] leading-[18px] text-ink">{error}</Text>
            </View>
          ) : (
            <Text
              className="text-center text-[13px] leading-[18px] text-ink-2"
              style={{
                maxWidth: 320,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.lineStrong,
                backgroundColor: palette.scrim,
                paddingHorizontal: 16,
                paddingVertical: 8,
                overflow: 'hidden',
              }}
            >
              Point the camera at the pairing code in QAI on your desktop.
            </Text>
          )}

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Cancel scanning"
            disabled={busy}
            onPress={() => setScanning(false)}
            scaleTo={0.96}
          >
            <View
              style={{
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.lineStrong,
                backgroundColor: palette.scrim,
                paddingHorizontal: 28,
                opacity: busy ? 0.45 : 1,
              }}
            >
              <Text className="text-[14.5px] leading-[21px] font-semibold text-ink">
                {busy ? 'Pairing…' : 'Cancel'}
              </Text>
            </View>
          </Touchable>
        </View>
      </View>
    )
  }

  /* ── Landing ──────────────────────────────────────────────────────────────
     The app's first impression: the mark, one display line, one promise, and
     the scan button. Everything else is below the fold of attention. */
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingVertical: 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[{ alignItems: 'center', gap: 18 }, enterStyle(heroEnter, 12)]}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.line,
            }}
          >
            <BrandMark size={44} />
          </View>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Text
              accessibilityRole="header"
              className="text-center text-[28px] leading-[34px] font-bold text-ink"
              style={{ letterSpacing: -0.6 }}
            >
              Pair with your desktop
            </Text>
            <Text className="text-center text-[11px] leading-[14px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 1.4 }}>
              QAI · mobile command centre
            </Text>
            <Text className="max-w-[34ch] text-center text-[13px] leading-[18px] text-ink-2">
              Open QAI on your computer, go to the pairing page, and scan the code with this
              device. It takes about ten seconds.
            </Text>
          </View>
        </Animated.View>

        <Animated.View style={[{ width: '100%', maxWidth: 400, gap: 12, marginTop: 40 }, enterStyle(actionsEnter, 10)]}>
          <Button
            variant="primary"
            label="Scan the pairing code"
            icon={<QrCode size={18} color={palette.accentInk} />}
            full
            size="lg"
            onPress={startScanning}
          />

          <Touchable
            accessibilityRole="button"
            accessibilityLabel={showPaste ? 'Hide manual entry' : 'Enter the link manually'}
            onPress={() => setShowPaste((open) => !open)}
            scaleTo={0.98}
            style={{ alignSelf: 'center' }}
          >
            <View style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
              <Text className="text-[13px] leading-[18px] font-semibold text-accent">
                {showPaste ? 'Hide manual entry' : 'Enter the link manually'}
              </Text>
            </View>
          </Touchable>

          {showPaste ? (
            <Card className="p-4" style={{ gap: 12 }}>
              <Field
                value={manual}
                onChangeText={setManual}
                placeholder="http://192.168.1.8:9120/mobile/pair?offer=…&secret=…"
                accessibilityLabel="Pairing link"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                mono
              />
              <Button
                variant="secondary"
                label={busy ? 'Pairing…' : 'Pair this device'}
                disabled={busy || manual.trim().length === 0}
                full
                onPress={() => void handlePairingText(manual.trim())}
              />
            </Card>
          ) : null}

          {busy && route ? (
            <View
              accessibilityLiveRegion="polite"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4 }}
            >
              <ActivityIndicator size="small" color={palette.accent} />
              <Mono className="flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
                Reaching {route}…
              </Mono>
            </View>
          ) : null}

          {error ? <ErrorState message={error} /> : null}

          <Text className="px-2 pt-1 text-center text-[12px] leading-[17px] text-ink-3">
            Codes expire after two minutes and work once. If the tailnet name does not resolve on
            this phone, the same code also carries the tailnet IP and your home LAN address, and the
            app tries each in turn.
          </Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const StyleSheetAbsolute = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 }

export { toast }

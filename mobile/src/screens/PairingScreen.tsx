/**
 * Pairing — exchange the desktop's QR (or a pasted link) for a device token.
 *
 * The same screen the desktop shows in its native shell, for the same audience,
 * but rebuilt around the one thing a phone does that a browser does not: it can
 * *scan*. So scanning is the screen's primary state, not a button that reveals
 * it, and the manual-link path is one tap below rather than a hidden toggle.
 *
 * WHY EVERY ADVERTISED ROUTE IS TRIED
 * ----------------------------------
 * The offer is tried against EVERY origin the QR carried, not just the one it
 * was encoded with. The daemon lists the tailnet MagicDNS name first because it
 * is the best route when it works, but a phone with MagicDNS off cannot resolve
 * `.ts.net` — and a phone away from home cannot use the LAN address. Trying each
 * in order is what stopped a tailnet QR from failing against a daemon that was
 * perfectly reachable on its other routes.
 *
 * A *transport* failure is worth retrying against another route. An expired or
 * already-spent offer answers the same way from every host, so the loop stops
 * immediately rather than burning the user's time on four doomed requests.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
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
import {
  BrandMark,
  Button,
  Card,
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

  async function handlePairingText(text: string) {
    if (busy) return
    setError(null)
    const parsed = parsePairingLink(text)
    if (!parsed) {
      setError('That does not look like an AgentDeck pairing code. Scan the QR on your desktop, or paste the full link.')
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
     The camera is full-bleed with a cut-out reticle drawn over it, because a
     full-bleed viewfinder is the only thing that makes finding a QR on a
     second monitor practical. The sheet of controls at the bottom is a solid
     surface so the buttons are readable against whatever the camera is
     pointing at. */
  if (scanning && permission?.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.viewfinder }}>
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

        {/* Reticle. Four corner marks, not a full frame: a full frame tells you
            where the code is, corner marks tell you how big it needs to be. */}
        <View pointerEvents="none" style={{ ...StyleSheetAbsolute, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 220, height: 220 }}>
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
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  borderColor: palette.accent,
                  ...corner,
                }}
              />
            ))}
          </View>
        </View>

        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: palette.canvas,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: Math.max(insets.bottom, 20) + 8,
            gap: 12,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: 1,
            borderTopColor: palette.line,
          }}
        >
          {busy && route ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  borderWidth: 2,
                  borderColor: palette.accent,
                  borderTopColor: 'transparent',
                }}
              />
              <Mono className="flex-1 text-[12px] text-ink-2" numberOfLines={1}>
                Reaching {route}…
              </Mono>
            </View>
          ) : null}

          {error ? (
            <View
              style={{
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
            <Text className="text-[13px] leading-[18px] text-ink-3">
              Point the camera at the pairing code in AgentDeck on your desktop.
            </Text>
          )}

          <Button
            variant="secondary"
            label={busy ? 'Pairing…' : 'Cancel'}
            disabled={busy}
            full
            onPress={() => setScanning(false)}
          />
        </View>
      </View>
    )
  }

  /* ── Landing ────────────────────────────────────────────────────────────── */
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
          gap: 28,
          paddingHorizontal: 24,
          paddingVertical: 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.line,
            }}
          >
            <BrandMark size={30} />
          </View>
          <Text
            className="text-center text-[22px] font-bold text-ink"
            style={{ letterSpacing: -0.35 }}
          >
            Pair with your desktop
          </Text>
          <Text className="max-w-[36ch] text-center text-[14px] leading-[20px] text-ink-3">
            Open AgentDeck on your computer, go to the pairing page, and scan the code with this
            device. It takes about ten seconds.
          </Text>
        </View>

        <View style={{ width: '100%', maxWidth: 400, gap: 14 }}>
          <Button
            variant="primary"
            label="Scan the pairing code"
            icon={<QrCode size={18} color={palette.accentInk} />}
            full
            size="lg"
            onPress={startScanning}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPaste ? 'Hide manual entry' : 'Enter the link manually'}
            onPress={() => setShowPaste((open) => !open)}
            style={({ pressed }) => ({
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              backgroundColor: pressed ? palette.raised : 'transparent',
            })}
          >
            <Text className="text-[13.5px] font-semibold text-ink-3">
              {showPaste ? 'Hide manual entry' : 'Enter the link manually'}
            </Text>
          </Pressable>

          {showPaste ? (
            <Card>
              <View style={{ gap: 12, padding: 14 }}>
                <Field
                  value={manual}
                  onChangeText={setManual}
                  placeholder="http://192.168.1.8:9120/mobile/pair?offer=…&secret=…"
                  placeholderTextColor={palette.ink4}
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
              </View>
            </Card>
          ) : null}

          {busy && route ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4 }}>
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  borderWidth: 2,
                  borderColor: palette.accent,
                  borderTopColor: 'transparent',
                }}
              />
              <Mono className="flex-1 text-[12px] text-ink-2" numberOfLines={1}>
                Reaching {route}…
              </Mono>
            </View>
          ) : null}

          {error ? (
            <View
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.dangerBorder,
                backgroundColor: palette.dangerSoft,
                padding: 13,
              }}
            >
              <Text className="text-[13.5px] leading-[19px] text-ink">{error}</Text>
            </View>
          ) : null}

          <Text className="px-2 text-center text-[12px] leading-[17px] text-ink-3">
            Codes expire after two minutes and work once. If the tailnet name does not resolve on
            this phone, the same code also carries the tailnet IP and your home LAN address, and the
            app tries each in turn.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const StyleSheetAbsolute = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 }

export { toast }

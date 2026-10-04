/**
 * Pair — the gate. Scan the QR the dashboard shows, or type the address and
 * paste the offer. Verify exchanges the offer for a device token; the token
 * lands in the Keychain and the app boots into Home.
 */

import * as React from 'react'
import { Animated, ScrollView, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { deviceKey, deviceName, savePairing } from '@/lib/pairing'
import { parsePairingLink, setDeviceBaseUrl } from '@/lib/native'
import { pairingApi, type PairedDevice } from '@/lib/api'
import { Brand, Btn, Field, Tap, Text, haptic } from '../ui'
import { Alert } from '../design/icons'
import { color } from '../design/tokens'

type Step = 'scan' | 'manual' | 'connecting' | 'failed'

export function PairScreen() {
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [step, setStep] = React.useState<Step>('scan')
  const [error, setError] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState('')
  const [offer, setOffer] = React.useState('')
  const [scanned, setScanned] = React.useState(false)
  const [finderH, setFinderH] = React.useState(0)

  const pair = React.useCallback(async (offerText: string, baseUrlHint?: string) => {
    setStep('connecting')
    setError(null)
    try {
      const link = parsePairingLink(offerText)
      const parsed = link
        ? { offer_id: link.offerId, secret: link.secret, url: link.baseUrl }
        : (JSON.parse(offerText) as { offer_id?: string; secret?: string; url?: string })
      if (!parsed.offer_id || !parsed.secret) throw new Error('That is not a pairing offer.')
      const baseUrl = ((baseUrlHint ?? '').trim() || link?.baseUrl || parsed.url || '').replace(/\/+$/, '')
      if (!baseUrl) throw new Error('Enter the desktop address, e.g. http://192.168.1.10:9120')
      setDeviceBaseUrl(baseUrl)
      const result: PairedDevice = await pairingApi.verify({
        offerId: parsed.offer_id,
        secret: parsed.secret,
        deviceKey: deviceKey(),
        deviceName: deviceName(),
      })
      await savePairing(baseUrl, result.token, link?.baseUrls)
      void haptic('success')
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { navigationRef } = require('../navigation') as typeof import('../navigation')
        if (navigationRef.isReady()) navigationRef.resetRoot({ index: 0, routes: [{ name: 'Tabs' }] })
      }, 400)
    } catch (cause) {
      void haptic('error')
      setError(cause instanceof Error ? cause.message : 'Pairing failed')
      setStep('failed')
    }
  }, [])

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 24,
          paddingTop: insets.top + 28,
          paddingBottom: 24,
        }}
      >
        <View className="items-center gap-2">
          <Brand size={68} />
          <Text className="mt-5 text-[24px] font-bold text-ink" style={{ letterSpacing: -0.5 }}>
            Pair with your desktop
          </Text>
          <Text className="mt-2 max-w-[290px] text-center text-[14.5px] leading-[21px] text-ink-2">
            {step === 'scan' ? (
              <>
                Open the dashboard on your machine, choose <Text className="font-semibold text-ink-2">Pair a Device</Text>, then point the camera at its QR code.
              </>
            ) : (
              <>Paste the pairing offer the dashboard shows, then exchange it for a device token.</>
            )}
          </Text>
        </View>

        {step === 'scan' ? (
          <View
            className="relative mt-6 aspect-square overflow-hidden rounded-[20px]"
            style={{ backgroundColor: color.finder }}
            onLayout={(event) => setFinderH(event.nativeEvent.layout.height)}
          >
            {permission?.granted ? (
              <>
                <CameraView
                  style={{ flex: 1 }}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : ({ data }) => {
                    setScanned(true)
                    void pair(data)
                  }}
                />
                <Corners />
                <Sweep height={finderH} />
              </>
            ) : (
              <View className="flex-1 items-center justify-center gap-3 p-6">
                <Text className="text-center text-[15px] text-ink-2">The camera is needed to read the QR.</Text>
                <Btn kind="primary" label="Allow camera" onPress={() => void requestPermission()} />
              </View>
            )}
          </View>
        ) : null}
        {step === 'scan' ? (
          <Text className="mt-3.5 text-center text-[12px] text-ink-3">Point at the QR code — it pairs automatically</Text>
        ) : null}

        {error ? (
          <View className="mt-6 flex-row items-start gap-2.5 rounded-[14px] bg-red-tint px-3.5 py-3">
            <View className="mt-0.5">
              <Alert size={14} color={color.red} />
            </View>
            <Text className="min-w-0 flex-1 text-[13px] leading-[19px] text-ink">{error}</Text>
          </View>
        ) : null}

        {step === 'connecting' ? (
          <Text className="mt-5 text-center text-[13px] text-ink-3" style={{ fontFamily: 'JetBrainsMono-Regular' }}>
            Exchanging the offer for a device token…
          </Text>
        ) : null}

        <View className="mt-7">
          <View className="mb-3 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-line" />
            <Text className="text-[11px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.8 }}>
              Or pair manually
            </Text>
            <View className="h-px flex-1 bg-line" />
          </View>
          <View className="gap-2.5">
            <Field
              value={url}
              onChangeText={setUrl}
              placeholder="http://192.168.1.10:9120"
              accessibilityLabel="Desktop base URL"
              autoCapitalize="none"
              autoCorrect={false}
              mono
            />
            <Field
              value={offer}
              onChangeText={setOffer}
              placeholder="Paste the offer JSON from the dashboard"
              accessibilityLabel="Pairing offer JSON"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              className="min-h-[88px] items-start py-3"
              style={{ textAlignVertical: 'top' }}
              mono
            />
            {step === 'scan' ? (
              <Tap accessibilityRole="button" onPress={() => setStep('manual')} hitSlop={8} className="self-center py-2">
                <Text className="text-[13.5px] font-medium text-accent">Hide the camera and type instead</Text>
              </Tap>
            ) : (
              <Tap
                accessibilityRole="button"
                onPress={() => {
                  setScanned(false)
                  setStep('scan')
                  setError(null)
                }}
                hitSlop={8}
                className="self-center py-2"
              >
                <Text className="text-[13.5px] font-medium text-accent">Scan the QR code instead</Text>
              </Tap>
            )}
          </View>
        </View>
      </ScrollView>

      {/* The action, pinned. A scrolling primary action is a primary action the
          user can lose; one at the very bottom edge is one the system gesture
          strip can eat. */}
      <View
        className="gap-2 px-6 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) + 12 }}
      >
        <Btn
          kind="primary"
          size="lg"
          label={step === 'connecting' ? 'Pairing…' : 'Pair'}
          wide
          disabled={!offer.trim() || step === 'connecting'}
          onPress={() => void pair(offer, url.trim() || undefined)}
        />
      </View>
    </View>
  )
}

function Corners() {
  const corner = { position: 'absolute' as const, width: 30, height: 30, borderColor: color.ink }
  return (
    <>
      <View style={{ ...corner, top: 20, left: 20, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 3 }} />
      <View style={{ ...corner, top: 20, right: 20, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 3 }} />
      <View style={{ ...corner, bottom: 20, left: 20, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 3 }} />
      <View style={{ ...corner, bottom: 20, right: 20, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 3 }} />
    </>
  )
}

function Sweep({ height }: { height: number }) {
  const sweep = React.useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1300, useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1300, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [sweep])
  return (
    <Animated.View
      accessibilityElementsHidden
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: height * 0.18,
        left: '14%',
        right: '14%',
        height: 2.5,
        borderRadius: 2,
        backgroundColor: color.accent,
        transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, height * 0.62)] }) }],
      }}
    />
  )
}

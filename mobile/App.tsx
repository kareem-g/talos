/**
 * App entry — providers, navigation, and the store/socket/notification bootstrap.
 *
 * Order matters: credentials hydrate from the Keychain first, because the
 * navigator's initial route (Pairing vs the Deck) and the socket's first
 * `Authenticate` frame both depend on the stored token. Only then do we render
 * the navigator, connect the store, and start the notification controller.
 *
 * Fonts load from bundled assets in parallel with the credential read, so the
 * boot screen covers both — and its gate is `loaded || error`, because a
 * typeface that fails to decode must degrade to the system face rather than
 * hold the app on a splash.
 *
 * The two boot states are the app's only bespoke screens, and both exist for
 * the same reason: a phone is asked to open this app on a bad connection more
 * often than a browser is, so every path that is not "connected" has to look
 * designed rather than like a loading failure.
 */

import 'react-native-gesture-handler'
import './global.css'

import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'

import { Navigation, navigateToAction } from '@app/navigation'
import { NewTaskHost } from '@app/components/NewTaskHost'
import { DrawerHost } from '@app/components/Drawer'
import { CommandHost } from '@app/components/CommandPalette'
import { useStore } from '@app/store'
import { hydrateCredentials } from '@app/lib/secureStore'
import { startNotifications } from '@app/lib/notifications'
import { BrandMark } from '@app/components/ui'
import { ToastHost } from '@app/components/Toast'
import { palette } from '@app/design/tokens'
import { useEnter } from '@app/components/motion'
import { FONT_ASSETS } from '@app/design/fonts'

export default function App() {
  // The faces ship with the app, so this resolves from disk in a few ms. The
  // gate is `loaded || error` rather than `loaded`: a font that fails to decode
  // must leave the app running in the system face, never on a boot screen
  // forever — a missing typeface is a downgrade, a blank app is a bug.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let stopNotifications: (() => void) | undefined
    let cancelled = false
    void hydrateCredentials()
      .then(() => {
        if (cancelled) return
        useStore.getState().start()
        // Taps route to the session/approval; the controller stays out of React.
        stopNotifications = startNotifications(navigateToAction)
        setReady(true)
      })
      .catch((cause) => {
        if (cancelled) return
        setFailed(cause instanceof Error ? cause.message : 'Could not read this device’s credentials')
      })
    return () => {
      cancelled = true
      stopNotifications?.()
    }
  }, [nonce])

  if (failed) {
    return (
      <SafeAreaProvider>
        <BootScreen
          title="Could not start"
          body={failed}
          action="Try again"
          onAction={() => {
            setFailed(null)
            setReady(false)
            setNonce((value) => value + 1)
          }}
        />
        <StatusBar style="light" />
      </SafeAreaProvider>
    )
  }

  if (!ready || (!fontsLoaded && !fontError)) {
    return (
      <SafeAreaProvider>
        <BootScreen title="QAI" body="Restoring your pairing…" />
        <StatusBar style="light" />
      </SafeAreaProvider>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Navigation />
        {/* Root-mounted chrome, above the navigator: the new-task sheet and
            the navigation drawer are app-level surfaces that any screen can
            summon through their emitters, and a toast can land over both. */}
        <NewTaskHost />
        <DrawerHost />
        <CommandHost />
        <ToastHost />
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/**
 * The boot screen.
 *
 * It is a screen rather than a bare spinner for a reason that is not cosmetic:
 * if the Keychain read hangs, a spinner is the same thing the user saw a
 * second ago and they cannot tell whether the app opened. A mark, a name and a
 * line of text that says what is happening is distinguishable from a hang at a
 * glance, and it is the same surface they will see if the boot genuinely fails.
 */
function BootScreen({
  title,
  body,
  action,
  onAction,
}: {
  title: string
  body: string
  action?: string
  onAction?: () => void
}) {
  const enter = useEnter(0, false)
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.canvas,
        gap: 14,
        padding: 32,
        opacity: enter,
      }}
    >
      {/* The signal mark sits on a tile, so the boot screen has the same first
          frame as the pairing screen it usually precedes. */}
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.line,
          marginBottom: 4,
        }}
      >
        <BrandMark size={40} />
      </View>
      <Text
        style={{
          color: palette.ink,
          fontSize: 24,
          lineHeight: 30,
          fontWeight: '800',
          letterSpacing: title === 'QAI' ? 2 : -0.5,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: palette.ink3,
          fontSize: 13,
          lineHeight: 18,
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        {body}
      </Text>
      {action && onAction ? (
        <Text
          accessibilityRole="button"
          onPress={onAction}
          style={{
            color: palette.accent,
            fontSize: 14,
            fontWeight: '600',
            marginTop: 6,
            paddingVertical: 10,
            paddingHorizontal: 18,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: palette.accentBorder,
            overflow: 'hidden',
          }}
        >
          {action}
        </Text>
      ) : null}
    </View>
  )
}

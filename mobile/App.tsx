/**
 * App entry — providers, navigation, and the store/socket/notification bootstrap.
 *
 * Order matters: credentials hydrate from the Keychain first, because the
 * navigator's initial route (Pairing vs the Deck) and the socket's first
 * `Authenticate` frame both depend on the stored token. Only then do we render
 * the navigator, connect the store, and start the notification controller.
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

import { Navigation, navigateToAction } from '@app/navigation'
import { useStore } from '@app/store'
import { hydrateCredentials } from '@app/lib/secureStore'
import { startNotifications } from '@app/lib/notifications'
import { BrandMark } from '@app/components/ui'
import { ToastHost } from '@app/components/Toast'
import { palette } from '@app/design/tokens'
import { useEnter } from '@app/components/motion'

export default function App() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

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
  }, [])

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
          }}
        />
        <StatusBar style="light" />
      </SafeAreaProvider>
    )
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <BootScreen title="AgentDeck" body="Restoring your pairing…" />
        <StatusBar style="light" />
      </SafeAreaProvider>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Navigation />
        {/* Above the navigator, so a toast can land over a sheet, a dialog and
            a pushed screen without any of them knowing it exists. */}
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
      <BrandMark size={34} />
      <Text style={{ color: palette.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.35 }}>
        {title}
      </Text>
      <Text
        style={{
          color: palette.ink3,
          fontSize: 13.5,
          lineHeight: 19,
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
            fontSize: 14.5,
            fontWeight: '600',
            marginTop: 6,
            paddingVertical: 10,
            paddingHorizontal: 18,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: palette.accentBorder,
          }}
        >
          {action}
        </Text>
      ) : null}
    </View>
  )
}

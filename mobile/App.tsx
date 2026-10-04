/**
 * App — boot: restore the pairing, start the store/socket and the
 * notification controller, load the mono faces, then present the navigator
 * under the shell (which owns the new-task wizard).
 */

import 'react-native-gesture-handler'
import './global.css'

import { useEffect, useState } from 'react'
import { Text as RNText, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'

import { Navigation, navigateToSession } from './src/navigation'
import { ShellProvider } from './src/shell'
import { useStore } from '@/store'
import { hydrateCredentials } from '@/lib/secureStore'
import { startNotifications } from '@/lib/notifications'
import { color } from './src/design/tokens'
import { FONT_ASSETS } from './src/design/fonts'
import { Brand, Btn, Loader } from './src/ui'

export default function App() {
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
        stopNotifications = startNotifications(navigateToSession)
        setReady(true)
      })
      .catch((cause) => {
        if (cancelled) return
        setFailed(cause instanceof Error ? cause.message : "Could not read this device's credentials")
      })
    return () => {
      cancelled = true
      stopNotifications?.()
    }
  }, [nonce])

  if (failed) {
    return (
      <Shell>
        <Boot title="Could not start" body={failed} action="Try again" onAction={() => {
          setFailed(null)
          setNonce((value) => value + 1)
        }} />
      </Shell>
    )
  }

  if (!ready || (!fontsLoaded && !fontError)) {
    return (
      <Shell>
        <Boot title="QAI" body="Restoring your pairing…" />
      </Shell>
    )
  }

  return (
    <Shell>
      <Navigation />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ShellProvider>{children}</ShellProvider>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Boot({
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
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, gap: 12, padding: 32 }}>
      <Brand size={68} />
      <RNText style={{ color: color.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 }}>{title}</RNText>
      <RNText style={{ color: color.ink2, fontSize: 15, textAlign: 'center', maxWidth: 320, lineHeight: 22 }}>{body}</RNText>
      {title === 'QAI' ? (
        <Loader label="Connecting to the daemon" />
      ) : action && onAction ? (
        <Btn kind="plate" label={action} onPress={onAction} />
      ) : null}
    </View>
  )
}
/**
 * App entry — providers, navigation, and the store/socket/notification bootstrap.
 *
 * Order matters: credentials hydrate from the Keychain first, because the
 * navigator's initial route (Pairing vs Home) and the socket's first
 * Authenticate frame both depend on the stored token. Only then do we render the
 * navigator, connect the store, and start the notification controller.
 */

import 'react-native-gesture-handler'
import './global.css'

import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { Navigation, navigateToAction } from '@app/navigation'
import { useStore } from '@app/store'
import { hydrateCredentials } from '@app/lib/secureStore'
import { startNotifications } from '@app/lib/notifications'
import { Spinner } from '@app/components/ui'

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stopNotifications: (() => void) | undefined
    let cancelled = false
    void hydrateCredentials().then(() => {
      if (cancelled) return
      useStore.getState().start()
      // Taps route to the session/approval; the controller stays out of React.
      stopNotifications = startNotifications(navigateToAction)
      setReady(true)
    })
    return () => {
      cancelled = true
      stopNotifications?.()
    }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {ready ? (
          <Navigation />
        ) : (
          <View className="flex-1 items-center justify-center bg-canvas">
            <Spinner />
          </View>
        )}
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

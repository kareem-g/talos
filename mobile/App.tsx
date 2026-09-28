/**
 * App entry — providers, navigation, and the store/socket/notification bootstrap.
 *
 * Order matters: credentials hydrate from the Keychain first (so the socket can
 * authenticate on its first frame), then the store connects and starts routing
 * frames, then the notification controller subscribes to the same socket to page
 * the user when an agent needs them and the app is not in the foreground.
 */

import 'react-native-gesture-handler'
import './global.css'

import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { Navigation, navigateToAction } from '@app/navigation'
import { useStore } from '@app/store'
import { hydrateCredentials } from '@app/lib/secureStore'
import { startNotifications } from '@app/lib/notifications'

export default function App() {
  useEffect(() => {
    let stopNotifications: (() => void) | undefined
    let cancelled = false
    void hydrateCredentials().then(() => {
      if (cancelled) return
      useStore.getState().start()
      // Taps route to the session/approval; the controller stays out of React.
      stopNotifications = startNotifications(navigateToAction)
    })
    return () => {
      cancelled = true
      stopNotifications?.()
    }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Navigation />
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

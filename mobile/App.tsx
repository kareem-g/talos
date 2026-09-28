/**
 * App entry — providers, navigation, and the store/socket bootstrap.
 *
 * Phase A wires the foundation: gesture + safe-area roots, React Navigation, and
 * a single placeholder screen that proves the whole import graph (store → mobile
 * api/socket → the shared `@/lib/events` reducer and `@/types`) resolves and
 * bundles. Real screens (pairing, home, session) land in Phase C.
 *
 * Credentials hydrate from the Keychain before the socket connects, so the first
 * frame can authenticate; the store then owns the connection lifecycle.
 */

import 'react-native-gesture-handler'
import './global.css'

import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'

import { useStore } from '@app/store'
import { hydrateCredentials } from '@app/lib/secureStore'

const Stack = createNativeStackNavigator()

function HomeScreen() {
  const connection = useStore((state) => state.connection)
  const sessions = useStore((state) => state.sessions)
  return (
    <View className="flex-1 items-center justify-center bg-canvas px-6">
      <Text className="text-lg font-medium text-ink">AgentDeck</Text>
      <Text className="mt-2 text-sm text-ink-3">
        {connection} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
      </Text>
    </View>
  )
}

export default function App() {
  useEffect(() => {
    let cancelled = false
    void hydrateCredentials().then(() => {
      if (!cancelled) useStore.getState().start()
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer theme={DarkTheme}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home" component={HomeScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

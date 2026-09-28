/**
 * Navigation — the root stack, a ref for navigating from outside React (the
 * notification tap handler), and the deep-link config.
 *
 * Three screens mirror the web app's three routes (list / session / pairing).
 * The notification system navigates through `navigationRef`, so a tap on a local
 * notification lands on the session that paged, with the approval id to focus.
 */

import * as React from 'react'
import {
  createNavigationContainerRef,
  DarkTheme,
  NavigationContainer,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import * as Linking from 'expo-linking'
import { HomeScreen } from './screens/HomeScreen'
import { SessionScreen } from './screens/SessionScreen'
import { PairingScreen } from './screens/PairingScreen'

export type RootStackParamList = {
  Home: undefined
  Session: { sessionId: string; approvalId?: string }
  Pairing: undefined
}

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

const Stack = createNativeStackNavigator<RootStackParamList>()

/** The URL prefix for this app's deep links (scheme `agentdeck`). */
const linking = {
  prefixes: [Linking.createURL('/'), 'agentdeck://'],
  config: {
    screens: {
      Home: '',
      Session: 'session/:sessionId',
      Pairing: 'pair',
    } as const,
  },
}

/**
 * Route to the session (and approval) a notification was about. Called from the
 * notification tap handler, which lives outside the React tree.
 */
export function navigateToAction(data: { sessionId: string; approvalId?: string }): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Session', { sessionId: data.sessionId, approvalId: data.approvalId })
}

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Session" component={SessionScreen} />
      <Stack.Screen name="Pairing" component={PairingScreen} />
    </Stack.Navigator>
  )
}

export function Navigation() {
  return (
    <NavigationContainer ref={navigationRef} theme={DarkTheme} linking={linking}>
      <RootNavigator />
    </NavigationContainer>
  )
}

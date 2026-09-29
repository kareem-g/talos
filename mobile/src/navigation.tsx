/**
 * Navigation — the root stack and the rail drawer.
 *
 * Mirrors the desktop shell: one rail (Get started / Products / Manage) whose
 * destinations are `Home | Agents | History | Usage | Configuration`, with a
 * session pushed full-screen on top of it — the same thing the desktop does when
 * a session is open. Pairing is a gate, not a tab: it is the initial route until
 * a device token exists, and reachable again from the device card.
 *
 * `navigationRef` still exists so the notification tap handler can route from
 * outside the React tree.
 */

import * as React from 'react'
import {
  createNavigationContainerRef,
  DarkTheme,
  NavigationContainer,
  useNavigation,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { createDrawerNavigator } from '@react-navigation/drawer'
import * as Linking from 'expo-linking'

import { HomeScreen } from './screens/HomeScreen'
import { SessionScreen } from './screens/SessionScreen'
import { PairingScreen } from './screens/PairingScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { AgentsScreen } from './screens/AgentsScreen'
import { BrowsersScreen } from './screens/BrowsersScreen'
import { UsageScreen } from './screens/UsageScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { McpScreen } from './screens/McpScreen'
import { RemoteScreen } from './screens/RemoteScreen'
import { DaemonSettingsScreen } from './screens/DaemonSettingsScreen'
import { AppNav } from './components/AppNav'
import { isPaired } from './lib/pairing'

/** Rail destinations — the desktop's exact `NavPage` set, plus management screens. */
export type DrawerParamList = {
  Home: undefined
  Agents: undefined
  Browsers: undefined
  History: undefined
  Usage: undefined
  Config: undefined
  Mcp: undefined
  Remote: undefined
  DaemonSettings: undefined
}

export type RootStackParamList = {
  Main: undefined
  Session: { sessionId: string; approvalId?: string }
  Pairing: undefined
}

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

const Stack = createNativeStackNavigator<RootStackParamList>()
const Drawer = createDrawerNavigator<DrawerParamList>()

/** The URL prefix for this app's deep links (scheme `agentdeck`). */
const linking = {
  prefixes: [Linking.createURL('/'), 'agentdeck://'],
  config: {
    screens: {
      Main: {
        screens: {
          Home: '',
          Agents: 'agents',
          Browsers: 'browsers',
          History: 'history',
          Usage: 'usage',
          Config: 'config',
          Mcp: 'mcp',
          Remote: 'remote',
          DaemonSettings: 'daemon-settings',
        },
      },
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

/**
 * Open a session from inside the rail.
 *
 * A session is a ROOT stack screen, pushed over the drawer, while rail screens
 * only know Home/Agents/History/Usage/Config — so the navigation has to bubble up
 * to the parent navigator that owns `Session`.
 */
export function useOpenSession(): (sessionId: string, approvalId?: string) => void {
  const navigation = useNavigation()
  return React.useCallback(
    (sessionId: string, approvalId?: string) => {
      const parent = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()
      // `getParent` is undefined only before the drawer has mounted under the
      // stack; falling back to the local navigator keeps the call total and
      // simply no-ops in that window rather than throwing.
      const target =
        parent ?? (navigation as unknown as NativeStackNavigationProp<RootStackParamList>)
      target.navigate('Session', { sessionId, approvalId })
    },
    [navigation],
  )
}

/** The rail. Same width as the desktop aside (224px) and its own sidebar surface. */
function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <AppNav {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: 264, backgroundColor: '#17171b', borderRightColor: '#34343a' },
        overlayColor: 'rgba(0,0,0,0.65)',
        swipeEdgeWidth: 44,
      }}
    >
      <Drawer.Screen name="Home" component={HomeScreen} />
      <Drawer.Screen name="Agents" component={AgentsScreen} />
      <Drawer.Screen name="Browsers" component={BrowsersScreen} />
      <Drawer.Screen name="History" component={HistoryScreen} />
      <Drawer.Screen name="Usage" component={UsageScreen} />
      <Drawer.Screen name="Config" component={SettingsScreen} />
      <Drawer.Screen name="Mcp" component={McpScreen} />
      <Drawer.Screen name="Remote" component={RemoteScreen} />
      <Drawer.Screen name="DaemonSettings" component={DaemonSettingsScreen} />
    </Drawer.Navigator>
  )
}

export function RootNavigator() {
  // Land on Pairing until a device token exists, then the rail. Evaluated at
  // render, which App gates on credential hydration, so the first paint is right.
  const initialRouteName = isPaired() ? 'Main' : 'Pairing'
  return (
    <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainDrawer} />
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

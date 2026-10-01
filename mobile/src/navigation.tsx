/**
 * Navigation.
 *
 * QAI — the desktop's mobile shell, natively.
 * -------------------------------------------
 * ```
 * Pairing ──▶ Main (tabs)  ─┬─ Deck      triage: blocked first, fleet band, live
 *                           ├─ Sessions  every session, by day, searchable
 *                           ├─ Station   the daemon's world: agents, engines,
 *                           │            terminals, rooms, MCP, tunnels, usage
 *                           └─ Device    this phone: routes, alerts, pairing
 *                                ✚ Command sits between them — the app's verb
 *
 * (root stack, pushed over the tabs)
 *   Session          one conversation — the desktop's SessionView, full screen
 *   SessionPanel     that session's workspace rail — deep-linkable full screen
 *   Agents · Browsers · Usage       the machinery Station opens
 *   Providers        API providers  — pushed from Station
 *   AgentDetail      one agent in full — rises as a sheet
 *   Mcp · Remote · Daemon           pushed from Station and Device
 *
 * There is one configuration surface, the Device tab. The desktop splits its
 * preferences across a page and modals; a phone does not have room for two
 * doors onto the same room.
 * ```
 *
 * Two navigation surfaces, exactly like the desktop's responsive shell:
 *
 * **The drawer** (components/Drawer) is the full AppNav — New task, every
 * destination, the live History list, Quick Access and the device card. It is
 * mounted at the app root and opened from any page's menu button.
 *
 * **The tab bar** is the fast path: four destinations — Deck, Sessions,
 * Station, Device — plus a raised Command action between them. New task is one
 * tap from anywhere, in the bar, the drawer and the screen headers.
 *
 * Deep links: every destination is addressable (`qai://` + path), because a
 * notification, a push link and a shared URL all need to land somewhere
 * specific rather than "on the home tab".
 */

import * as React from 'react'
import {
  createNavigationContainerRef,
  DarkTheme,
  NavigationContainer,
  useNavigation,
  type LinkingOptions,
  type NavigatorScreenParams,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as Linking from 'expo-linking'

import { HomeScreen } from './screens/HomeScreen'
import { AgentsScreen, AgentDetailScreen } from './screens/AgentsScreen'
import { BrowsersScreen } from './screens/BrowsersScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { UsageScreen } from './screens/UsageScreen'
import { ConfigScreen } from './screens/ConfigScreen'
import { StationScreen } from './screens/StationScreen'
import { ProvidersScreen } from './screens/ProvidersScreen'
import { RoomsScreen } from './screens/RoomsScreen'
import { SessionScreen } from './screens/SessionScreen'
import { SessionPanelScreen, type PanelTabId } from './screens/SessionPanelScreen'
import { McpScreen } from './screens/McpScreen'
import { RemoteScreen } from './screens/RemoteScreen'
import { DaemonSettingsScreen } from './screens/DaemonSettingsScreen'
import { PairingScreen } from './screens/PairingScreen'
import { TabBar } from './components/TabBar'
import { openNewTask } from './lib/newTask'
import { isPaired } from './lib/pairing'
import { palette } from '@app/design/tokens'

/** The four destinations, plus the raised Command action between them. */
export type TabParamList = {
  Deck: undefined
  Sessions: undefined
  Station: undefined
  Device: undefined
}

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined
  Session: { sessionId: string; approvalId?: string }
  Agents: undefined
  Browsers: undefined
  Usage: undefined
  Providers: undefined
  Rooms: undefined
  SessionPanel: { sessionId: string; tab?: PanelTabId }
  AgentDetail: { agentId: string }
  Mcp: undefined
  Remote: undefined
  Daemon: undefined
  Pairing: undefined
}

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator<TabParamList>()

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'qai://'],
  config: {
    screens: {
      Main: {
        screens: {
          Deck: '',
          // `history` and `config` are the paths this app shipped before the
          // rename. A saved link, a home-screen shortcut or a bookmark from the
          // old build must still land somewhere sensible, so they are aliases
          // rather than silently broken routes.
          Sessions: { path: 'sessions', alias: ['history'] },
          Station: 'station',
          Device: { path: 'device', alias: ['config'] },
        },
      },
      Agents: 'agents',
      Browsers: 'browsers',
      Usage: 'usage',
      Providers: 'providers',
      Rooms: 'rooms',
      Session: 'session/:sessionId',
      SessionPanel: 'session/:sessionId/panel',
      AgentDetail: 'agent/:agentId',
      Mcp: 'mcp',
      Remote: 'remote',
      Daemon: 'daemon',
      Pairing: 'pair',
    },
  },
}

/**
 * Route to the session (and approval) a notification was about.
 *
 * Called from the notification tap handler, which lives outside the React tree,
 * so it cannot use a hook and has to go through the ref.
 */
export function navigateToAction(data: { sessionId: string; approvalId?: string }): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Session', { sessionId: data.sessionId, approvalId: data.approvalId })
}

/** Route to a tab from anywhere below the root stack (drawer, dialog, toast). */
export function navigateToTab(tab: keyof TabParamList): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', { screen: tab })
}

/**
 * Open a session from anywhere below the root stack.
 *
 * A session is a ROOT stack screen, pushed over the tabs, while tab screens
 * only know the five tab names — so the navigation has to bubble up to the
 * navigator that owns `Session`.
 */
export function useOpenSession(): (sessionId: string, approvalId?: string) => void {
  const navigation = useNavigation()
  return React.useCallback(
    (sessionId: string, approvalId?: string) => {
      const parent = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()
      // `getParent` is undefined only before the tabs have mounted under the
      // stack; falling back to the local navigator keeps the call total and
      // no-ops in that window rather than throwing.
      const target = parent ?? (navigation as unknown as NativeStackNavigationProp<RootStackParamList>)
      target.navigate('Session', { sessionId, approvalId })
    },
    [navigation],
  )
}

/** Open a session's workspace rail. The desktop's right rail, as a screen. */
export function useOpenPanel(): (sessionId: string, tab?: PanelTabId) => void {
  const navigation = useNavigation()
  return React.useCallback(
    (sessionId: string, tab?: PanelTabId) => {
      const parent = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()
      const target = parent ?? (navigation as unknown as NativeStackNavigationProp<RootStackParamList>)
      target.navigate('SessionPanel', { sessionId, tab })
    },
    [navigation],
  )
}

/**
 * The new-task flow is a root-mounted host (components/NewTaskHost) reached
 * through the `lib/newTask` emitter — the same architecture as the drawer and
 * the toasts, so the app's primary verb presents identically from every
 * screen and is never owned (or swallowed) by one.
 */
export function useNewTask(): (agentId?: string, project?: string) => void {
  return openNewTask
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.canvas } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Deck" component={HomeScreen} />
      <Tab.Screen name="Sessions" component={HistoryScreen} />
      <Tab.Screen name="Station" component={StationScreen} />
      <Tab.Screen name="Device" component={ConfigScreen} />
    </Tab.Navigator>
  )
}

/* ── Screen transitions ───────────────────────────────────────────────────────
 * A session slides from the RIGHT (you went deeper). Reference lookups —
 * agent detail, config surfaces — rise from the BOTTOM as sheets, because they
 * are lookups you dismiss back down, not places you go. Pairing fades: it is a
 * gate, not a destination. */

export function RootNavigator() {
  // Land on Pairing until a device token exists. Evaluated at render, and App
  // gates the navigator on credential hydration, so the first paint is right.
  const initialRouteName = isPaired() ? 'Main' : 'Pairing'
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        contentStyle: { backgroundColor: palette.canvas },
      }}
    >
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen name="Session" component={SessionScreen} />
      {/* Station's destinations: deeper into the machinery, so they push. */}
      <Stack.Screen name="Agents" component={AgentsScreen} />
      <Stack.Screen name="Browsers" component={BrowsersScreen} />
      <Stack.Screen name="Usage" component={UsageScreen} />
      <Stack.Screen name="Providers" component={ProvidersScreen} />
      <Stack.Screen name="Rooms" component={RoomsScreen} />
      <Stack.Screen name="SessionPanel" component={SessionPanelScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AgentDetail" component={AgentDetailScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Mcp" component={McpScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Remote" component={RemoteScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Daemon" component={DaemonSettingsScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen
        name="Pairing"
        component={PairingScreen}
        options={{ animation: 'fade', gestureEnabled: false }}
      />
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

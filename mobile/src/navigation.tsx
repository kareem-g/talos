/**
 * Navigation.
 *
 * QAI — the signal map.
 * ---------------------
 * ```
 * Pairing ──▶ Main (tabs)  ─┬─ Deck        what needs you, what is running
 *                           ├─ Sessions    everything that has run, searchable
 *                           ├─ System      the machinery: agents, MCP, tunnels
 *                           └─ Settings    this device, pairing, alerts
 *
 * (root stack, pushed over the tabs)
 *   Session          one conversation — slides in from the right (deeper)
 *   SessionPanel     that session's workbench — slides in from the right
 *   Agents           the engine roster — rises as a deck sheet
 *   AgentDetail      one agent in full — rises as a deck sheet
 *   Usage · Mcp · Browsers · Remote · Daemon — rise as deck sheets
 * ```
 *
 * Three decisions live here.
 *
 * **Tabs, not a drawer.** Four tabs cover what you *do* and what you *check*;
 * everything else is a page you open *from* one of them. Starting a task is
 * the app's only verb, so it sits in the tab shelf where a thumb already is.
 *
 * **Panes open by kind.** Conversations and workbenches slide from the RIGHT
 * (you went deeper / the tools live over there). Reference surfaces — agents,
 * usage, MCP, browsers, remote, daemon — rise from the BOTTOM as deck sheets,
 * because they are lookups you dismiss back down, not places you go.
 * Sheets and pickers handle their own spring entrance.
 *
 * Deep links: every destination is addressable, because a notification, a push
 * link and a shared URL all need to land somewhere specific rather than "on the
 * home tab".
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

import { DeckScreen } from './screens/DeckScreen'
import { SessionsScreen } from './screens/SessionsScreen'
import { SystemScreen } from './screens/SystemScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SessionScreen } from './screens/SessionScreen'
import { SessionPanelScreen, type PanelTabId } from './screens/SessionPanelScreen'
import { AgentsScreen, AgentDetailScreen } from './screens/AgentsScreen'
import { UsageScreen } from './screens/UsageScreen'
import { McpScreen } from './screens/McpScreen'
import { BrowsersScreen } from './screens/BrowsersScreen'
import { RemoteScreen } from './screens/RemoteScreen'
import { DaemonSettingsScreen } from './screens/DaemonSettingsScreen'
import { PairingScreen } from './screens/PairingScreen'
import { NewTaskSheet } from './components/NewTaskSheet'
import { TabBar } from './components/TabBar'
import { isPaired } from './lib/pairing'
import { palette } from '@app/design/tokens'

/** The four places you can *be*. */
export type TabParamList = {
  Deck: undefined
  Sessions: undefined
  System: undefined
  Settings: undefined
}

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined
  Session: { sessionId: string; approvalId?: string }
  SessionPanel: { sessionId: string; tab?: PanelTabId }
  Agents: undefined
  AgentDetail: { agentId: string }
  Usage: undefined
  Mcp: undefined
  Browsers: undefined
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
          Sessions: 'sessions',
          System: 'system',
          Settings: 'settings',
        },
      },
      Session: 'session/:sessionId',
      SessionPanel: 'session/:sessionId/panel',
      Agents: 'agents',
      AgentDetail: 'agent/:agentId',
      Usage: 'usage',
      Mcp: 'mcp',
      Browsers: 'browsers',
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

/** Route to a tab from anywhere below the root stack (notification, dialog). */
export function navigateToTab(tab: keyof TabParamList): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', { screen: tab })
}

/**
 * Open a session from anywhere below the root stack.
 *
 * A session is a ROOT stack screen, pushed over the tabs, while tab screens
 * only know the four tab names — so the navigation has to bubble up to the
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

/** Open a session's tool panel. The desktop's right rail, as a screen. */
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

/* ── The new-task sheet is mounted once, above the navigator ───────────────────
 * The FAB lives in the tab bar, but the *flow* it opens is modal and belongs
 * to the whole app: you can start a task from the Deck, from a session, or
 * from the panel, and it should behave identically and present identically
 * each time. Mounting it once at the root is what guarantees that — a sheet
 * owned by a screen unmounts with that screen, and then the FAB has to be
 * duplicated. */

const NewTaskContext = React.createContext<{
  open: (agentId?: string, project?: string) => void
}>({ open: () => {} })

export function useNewTask(): (agentId?: string, project?: string) => void {
  return React.useContext(NewTaskContext).open
}

function MainTabs() {
  // `MainTabs` is a screen *of the root stack*, so the hook's parent lookup
  // falls through to the local navigator — which is the stack that owns
  // `Session`. Pushing from here lands on the session with the deck behind it.
  const openSession = useOpenSession()
  const [newOpen, setNewOpen] = React.useState(false)
  const [presetAgent, setPresetAgent] = React.useState<string | undefined>()
  const [presetProject, setPresetProject] = React.useState<string | undefined>()

  const open = React.useCallback((agentId?: string, project?: string) => {
    setPresetAgent(agentId)
    setPresetProject(project)
    setNewOpen(true)
  }, [])

  const context = React.useMemo(() => ({ open }), [open])

  return (
    <NewTaskContext.Provider value={context}>
      <Tab.Navigator
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.canvas } }}
        tabBar={(props) => <TabBar {...props} onNewTask={() => open()} />}
      >
        <Tab.Screen name="Deck" component={DeckScreen} />
        <Tab.Screen name="Sessions" component={SessionsScreen} />
        <Tab.Screen name="System" component={SystemScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>

      <NewTaskSheet
        open={newOpen}
        initialAgent={presetAgent}
        initialProject={presetProject}
        onClose={() => setNewOpen(false)}
        onCreated={(created) => openSession(created.id)}
      />
    </NewTaskContext.Provider>
  )
}

/* ── Screen transitions ───────────────────────────────────────────────────────
 * Panes open by kind: conversations and the workbench slide from the RIGHT
 * (iOS convention — you went deeper / the tools live over there). Reference
 * sheets rise from the BOTTOM as deck sheets (a lookup you dismiss back down,
 * not a place you go). Pairing fades — it is a gate, not a destination.
 *
 * `gestureEnabled` stays on for the session and its workbench. Deck sheets
 * keep the swipe-down-to-dismiss gesture and lose the edge-swipe, so a form
 * with typed text cannot be flung away sideways. */

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
      {/* The workbench slides in from the RIGHT, like a pushed screen, because
          that is the direction "this session's tools live over there" on a
          phone. slide_from_bottom would read as a modal, and a tool surface
          is not a modal. */}
      <Stack.Screen name="SessionPanel" component={SessionPanelScreen} options={{ animation: 'slide_from_right' }} />
      {/* Deck sheets: lookups that rise and dismiss back down. */}
      <Stack.Screen name="Agents" component={AgentsScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="AgentDetail" component={AgentDetailScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Usage" component={UsageScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Mcp" component={McpScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      <Stack.Screen name="Browsers" component={BrowsersScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
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

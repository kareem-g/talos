/**
 * Navigation.
 *
 * THE STRUCTURE, AND WHY
 * ----------------------
 * ```
 * Pairing ──▶ Main (tabs)  ─┬─ Deck        what needs you, what is live
 *                           ├─ Agents      what can run here
 *                           ├─ Activity    what happened, and what it cost
 *                           └─ Settings    how this is configured
 *
 * (root stack, pushed over the tabs)
 *   Session          one conversation
 *   SessionPanel     that session's tools — the desktop's right rail
 *   AgentDetail      one agent in full
 *   Usage · Browsers · Mcp · Remote · Daemon
 * ```
 *
 * Three decisions live here.
 *
 * **Tabs, not a drawer.** The app had a 300pt swipe-in drawer with nine
 * destinations in three invented groups. On a phone that makes every screen
 * two taps away and costs a hamburger in every header. Four tabs cover what
 * you *do*; everything else is a screen you open *from* one of them, which is
 * what a pushed stack is for.
 *
 * **The action bar is a FAB, not a header button.** Starting a task is the
 * app's only verb. It has no home on any page, it is used more than any other
 * action, and it should be reachable without looking — so it sits in the tab
 * bar where a thumb already is. See `TabBar.tsx`.
 *
 * **The desktop's right rail becomes a pushed screen, not a sheet.** The rail
 * holds a plan, a diff, a file tree and a terminal. A sheet caps at 88% of the
 * screen and its body has to share that with a header; at phone width a diff
 * with line numbers in a 60%-height sheet is unreadable. Full screen, with its
 * own tab strip and its own header, is the mobile-native version of a
 * resizable side panel. `SessionPanelScreen` is that screen.
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
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as Linking from 'expo-linking'

import { DeckScreen } from './screens/DeckScreen'
import { AgentsScreen, AgentDetailScreen } from './screens/AgentsScreen'
import { ActivityScreen } from './screens/ActivityScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SessionScreen } from './screens/SessionScreen'
import { SessionPanelScreen, type PanelTabId } from './screens/SessionPanelScreen'
import { UsageScreen } from './screens/UsageScreen'
import { BrowsersScreen } from './screens/BrowsersScreen'
import { McpScreen } from './screens/McpScreen'
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
  Agents: undefined
  Activity: undefined
  Settings: undefined
}

export type RootStackParamList = {
  Main: undefined
  Session: { sessionId: string; approvalId?: string }
  SessionPanel: { sessionId: string; tab?: PanelTabId }
  AgentDetail: { agentId: string }
  Usage: undefined
  Browsers: undefined
  Mcp: undefined
  Remote: undefined
  Daemon: undefined
  Pairing: undefined
}

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator<TabParamList>()

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'agentdeck://'],
  config: {
    screens: {
      Main: {
        screens: {
          Deck: '',
          Agents: 'agents',
          Activity: 'activity',
          Settings: 'settings',
        },
      },
      Session: 'session/:sessionId',
      SessionPanel: 'session/:sessionId/panel',
      AgentDetail: 'agent/:agentId',
      Usage: 'usage',
      Browsers: 'browsers',
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
        <Tab.Screen name="Agents" component={AgentsScreen} />
        <Tab.Screen name="Activity" component={ActivityScreen} />
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
 * Pushed screens slide from the right (iOS convention, and the direction that
 * matches "you went deeper"). Sheets and modals handle their own entrance, so
 * they are `presentation: 'modal'` with no animation of their own.
 *
 * `gestureEnabled` is on for the session and its panel and off for settings
 * pages: an interactive back-swipe on a settings page you arrived at from a
 * settings list is a nice touch, and on a form it is a way to lose what you
 * typed. */

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
      {/* The desktop's right rail: the panel slides in from the RIGHT, like a
          pushed screen, because that is the direction "this session's tools
          live over there" on a phone. slide_from_bottom read as a modal, and a
          tool surface is not a modal. */}
      <Stack.Screen name="SessionPanel" component={SessionPanelScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AgentDetail" component={AgentDetailScreen} />
      <Stack.Screen name="Usage" component={UsageScreen} />
      <Stack.Screen name="Browsers" component={BrowsersScreen} />
      <Stack.Screen name="Mcp" component={McpScreen} />
      <Stack.Screen name="Remote" component={RemoteScreen} />
      <Stack.Screen name="Daemon" component={DaemonSettingsScreen} />
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

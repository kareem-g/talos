/**
 * nav — five tabs over one stack: Home, History, Agents, Usage, Config,
 * with Session pushing from the right and Pairing as the gate. Deep links
 * ride `qai://`.
 */

import { DarkTheme, NavigationContainer, type LinkingOptions, type NavigatorScreenParams } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Chrome } from './ui'
import * as Linking from 'expo-linking'

import { navigationRef } from '@/lib/navigationRef'
import { isPaired } from '@/lib/pairing'
import { color } from './design/tokens'
import { Bot, Chart, Clock, Home, Monitor, Sliders } from './design/icons'

import { HomeScreen } from './screens/Home'
import { HistoryScreen } from './screens/History'
import { SessionScreen } from './screens/Session'
import { AgentsScreen } from './screens/Agents'
import { UsageScreen } from './screens/Usage'
import { ConfigScreen } from './screens/Config'
import { RemoteScreen } from './screens/Remote'
import { RemoteViewScreen } from './screens/RemoteView'
import { PairScreen } from './screens/Pair'

export type TabList = {
  Home: undefined
  History: undefined
  Agents: undefined
  Usage: undefined
  Remote: undefined
  Config: undefined
}

export type RootStackParamList = RootStack

export type RootStack = {
  Tabs: NavigatorScreenParams<TabList>
  Session: { sessionId: string }
  /** The live remote screen. `targetKey` is `desktop` | `display:<id>` | `window:<id>`. */
  RemoteView: { targetKey: string; label: string }
  Pairing: undefined
}

export { navigationRef }

const Stack = createNativeStackNavigator<RootStack>()
const Tab = createBottomTabNavigator<TabList>()

const linking: LinkingOptions<RootStack> = {
  prefixes: [Linking.createURL('/'), 'qai://'],
  config: {
    screens: {
      Tabs: { screens: { Home: '', History: 'history', Agents: 'agents', Usage: 'usage', Remote: 'remote', Config: 'config' } },
      Session: 'session/:sessionId',
      RemoteView: 'remote-view',
      Pairing: 'pair',
    },
  },
}

/**
 * The tab bar's chrome. The bar is drawn by the navigator, outside the screen
 * it floats over, so there is no view to hand a blur target — and a BlurView
 * with no target renders nothing at all. The mockup's `.chrome` colour is
 * opaque enough to read as the same bar without the blur.
 */
function TabChrome() {
  return <Chrome />
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.ink3,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarIconStyle: { marginTop: 6 },
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'transparent',
          borderTopWidth: 0.5,
          borderTopColor: color.line,
          elevation: 0,
        },
        tabBarBackground: TabChrome,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home', tabBarIcon: ({ color: ink }) => <Home color={ink} stroke={1.6} /> }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'History', tabBarIcon: ({ color: ink }) => <Clock color={ink} stroke={1.6} /> }} />
      <Tab.Screen name="Agents" component={AgentsScreen} options={{ title: 'Agents', tabBarIcon: ({ color: ink }) => <Bot color={ink} stroke={1.6} /> }} />
      <Tab.Screen name="Usage" component={UsageScreen} options={{ title: 'Usage', tabBarIcon: ({ color: ink }) => <Chart color={ink} stroke={1.6} /> }} />
      <Tab.Screen name="Remote" component={RemoteScreen} options={{ title: 'Portal', tabBarIcon: ({ color: ink }) => <Monitor color={ink} stroke={1.6} /> }} />
      <Tab.Screen name="Config" component={ConfigScreen} options={{ title: 'Config', tabBarIcon: ({ color: ink }) => <Sliders color={ink} stroke={1.6} /> }} />
    </Tab.Navigator>
  )
}

/** Route to the session a notification was about. */
export function navigateToSession(data: { sessionId: string }): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Session', { sessionId: data.sessionId })
}

export function RootNav() {
  const initial = isPaired() ? 'Tabs' : 'Pairing'
  return (
    <Stack.Navigator
      initialRouteName={initial}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        contentStyle: { backgroundColor: color.bg },
      }}
    >
      <Stack.Screen name="Tabs" component={Tabs} options={{ animation: 'fade' }} />
      <Stack.Screen name="Session" component={SessionScreen} />
      {/* Full-bleed: the remote screen owns the whole display, no tab bar. */}
      <Stack.Screen name="RemoteView" component={RemoteViewScreen} options={{ animation: 'fade', presentation: 'fullScreenModal' }} />
      <Stack.Screen name="Pairing" component={PairScreen} options={{ animation: 'fade', gestureEnabled: false }} />
    </Stack.Navigator>
  )
}

export function Navigation() {
  return (
    <NavigationContainer ref={navigationRef} theme={DarkTheme} linking={linking}>
      <RootNav />
    </NavigationContainer>
  )
}
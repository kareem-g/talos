/**
 * A smoke test that renders every screen.
 *
 * Typechecking proves the screens compile. It does not prove they render: a
 * screen can pass `tsc` and still throw on first mount because a hook is called
 * in the wrong order, a token is `undefined` at import time, or a component
 * reads a store field that does not exist yet. Those failures are exactly the
 * ones a user hits on a cold start, and they are invisible until runtime.
 *
 * So every screen is mounted here with the store and navigation mocked to a
 * minimal, known state. A screen that renders its empty and error states
 * without throwing is one that will at least open.
 *
 * What this deliberately does NOT assert: layout, colours, or copy. Those are
 * design review; a test that froze them would make every redesign a test
 * rewrite. This asserts only "it mounts".
 *
 * It also runs the same check twice — once empty and once populated — because
 * an empty list and a full list exercise different code. A screen that only
 * ever renders its empty state is a screen nobody has tested.
 */

import * as React from 'react'
import TestRenderer from 'react-test-renderer'

import { DeckScreen } from '@app/screens/DeckScreen'
import { SessionScreen } from '@app/screens/SessionScreen'
import { SessionPanelScreen } from '@app/screens/SessionPanelScreen'
import { AgentsScreen, AgentDetailScreen } from '@app/screens/AgentsScreen'
import { ActivityScreen } from '@app/screens/ActivityScreen'
import { SettingsScreen } from '@app/screens/SettingsScreen'
import { UsageScreen } from '@app/screens/UsageScreen'
import { McpScreen } from '@app/screens/McpScreen'
import { RemoteScreen } from '@app/screens/RemoteScreen'
import { DaemonSettingsScreen } from '@app/screens/DaemonSettingsScreen'
import { BrowsersScreen } from '@app/screens/BrowsersScreen'
import { PairingScreen } from '@app/screens/PairingScreen'

/* ── Mocks ────────────────────────────────────────────────────────────────────
 * The screens reach for navigation, the store, and the API. Each is stubbed to
 * the shape it uses, and to never resolve — an unmounted screen should not fire
 * a real request, and a pending one is exactly the cold-start state. */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    reset: jest.fn(),
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    getParent: jest.fn(() => ({ navigate: jest.fn(), push: jest.fn(), reset: jest.fn() })),
  }),
  useRoute: () => ({
    params: { sessionId: 'test-session', tab: 'plan', agentId: 'claude' },
    key: 'k',
    name: 'Session',
  }),
  useFocusEffect: jest.fn(),
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  DarkTheme: {},
  DefaultTheme: {},
}))

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: () => null,
  }),
}))

jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}))

jest.mock('expo-blur', () => ({
  BlurView: 'BlurView',
}))

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))

jest.mock('@app/lib/notifications', () => ({
  startNotifications: () => () => {},
  scheduleApprovalNotification: jest.fn(),
}))

jest.mock('@app/lib/notify', () => ({
  // Real signatures, not stand-ins: the previous mock returned a string where
  // the module exports a function, and the screen crashed on mount. A mock that
  // does not match the real shape is worse than no mock.
  permissionState: jest.fn(async () => 'undetermined'),
  requestPermission: jest.fn(async () => 'undetermined'),
  present: jest.fn(),
  openSystemNotificationSettings: jest.fn(),
}))

/** The API layer. Nothing resolves — screens must survive a pending request. */
jest.mock('@app/lib/api', () => {
  const never = () => new Promise(() => {})
  const api = {
    deviceToken: () => 'test-token',
    setDeviceToken: jest.fn(),
    ApiError: class ApiError extends Error {},
    pairingApi: { verify: never, me: never },
    mobileApi: {
      me: never,
      snapshot: never,
      pending: never,
      agents: never,
      session: never,
      createSession: never,
      kill: never,
      archive: never,
      restore: never,
      remove: never,
      config: never,
      resume: never,
      fork: never,
      switchEngine: never,
      spawnSubagent: never,
      orchestrate: never,
      trajectories: never,
    },
    attachmentsApi: { upload: never },
    gitApi: {
      branches: never,
      log: never,
      checkout: never,
      createBranch: never,
      commit: never,
      diff: never,
    },
    workspaceApi: {
      dirs: never,
      overview: never,
      sessionOverview: never,
      file: never,
      serveStatus: never,
      serveStart: never,
      serveStop: never,
      worktrees: never,
    },
    browserApi: { status: never, start: never, stop: never, state: never, tool: never, screenshot: never },
    skillsApi: {
      list: never,
      available: never,
      installed: never,
      toggle: never,
      install: never,
      content: never,
      uninstall: never,
    },
    roomsApi: { list: never },
    mcpApi: { list: never, add: never, remove: never },
    providersApi: { list: never, refresh: never },
    settingsApi: { get: never, update: never },
    terminalsApi: { list: never, create: never, close: never },
    remoteApi: {
      endpoints: never,
      status: never,
      start: never,
      stop: never,
      devices: never,
      revoke: never,
    },
    memoryApi: { config: never, setConfig: never, list: never, delete: never },
    syncApi: { discover: never, sync: never },
  }
  return { ...api, __esModule: true }
})

jest.mock('@app/lib/native', () => ({
  resolveApiUrl: (path: string) => `http://localhost:9120${path}`,
  deviceBaseUrl: () => 'http://localhost:9120',
  deviceRoutes: () => ['http://localhost:9120'],
  setDeviceBaseUrl: jest.fn(),
  parsePairingLink: () => null,
}))

jest.mock('@app/lib/socket', () => ({
  socket: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onState: jest.fn(() => jest.fn()),
    onFrame: jest.fn(() => jest.fn()),
    send: jest.fn(),
    sendInput: jest.fn(),
    respondToApproval: jest.fn(),
    answerQuestion: jest.fn(),
    stopSession: jest.fn(),
    interruptSession: jest.fn(),
    setConfig: jest.fn(),
    state: 'offline',
  },
}))

/**
 * A store snapshot that can be emptied or filled, per `describe` block.
 *
 * Named `mockStore` rather than `storeState` because Jest hoists `jest.mock`
 * factories above the module body and refuses to let them close over anything
 * that is not itself prefixed `mock` — the guard exists to stop a mock reading
 * a variable before its initialiser has run.
 */
let mockStore: Record<string, unknown> = {}

jest.mock('@app/store', () => {
  const emptyConversation = () => ({
    messages: [],
    seenEvents: new Set<string>(),
    lastEventId: 0,
    terminal: '',
    activity: undefined,
    commands: [],
    mode: undefined,
  })
  const useStore = (selector: (s: Record<string, unknown>) => unknown) => selector(mockStore)
  useStore.getState = () => mockStore
  return {
    useStore,
    getConversation: emptyConversation,
    useConversation: emptyConversation,
    __esModule: true,
  }
})

jest.mock('@app/navigation', () => ({
  useOpenSession: () => jest.fn(),
  useOpenPanel: () => jest.fn(),
  useNewTask: () => () => {},
  navigationRef: { navigate: jest.fn(), isReady: () => false },
  navigateToAction: jest.fn(),
  __esModule: true,
}))

/* ── The test ──────────────────────────────────────────────────────────────────
 * Real `SafeAreaProvider` and `SafeAreaView`, with the insets pinned to a
 * notched phone.
 *
 * jest-expo auto-mocks this module, and its `SafeAreaProvider` stub is a
 * constructor that returns nothing — so a screen wrapped in it renders `null`
 * and the test passes vacuously while proving nothing. Replacing both with real
 * implementations is what makes "the screen mounted" a meaningful claim; the
 * pinned insets (notch top, home indicator bottom) are what make a missing
 * bottom inset visible rather than accidental. `expo-blur` is stubbed too,
 * because a real BlurView needs a native view behind it that the test tree does
 * not have.
 */
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react')
  const { View } = require('react-native')
  const insets = { top: 47, bottom: 34, left: 0, right: 0 }
  const frame = { x: 0, y: 0, width: 390, height: 844 }

  const SafeAreaInsetsContext = ReactModule.createContext(insets)
  const SafeAreaFrameContext = ReactModule.createContext(frame)

  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(
        SafeAreaInsetsContext.Provider,
        { value: insets },
        ReactModule.createElement(SafeAreaFrameContext.Provider, { value: frame }, children),
      ),
    SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(View, props, children),
    SafeAreaConsumer: ({ children }: { children: (i: unknown) => React.ReactNode }) =>
      ReactModule.createElement(insets, null, children(insets)),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    withSafeAreaInsets: (Component: React.ComponentType<Record<string, unknown>>) => Component,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    initialWindowMetrics: { insets, frame },
    initialWindowSafeAreaInsets: insets,
  }
})

const SCREENS: Array<{ name: string; Component: () => React.ReactElement }> = [
  { name: 'Deck', Component: DeckScreen },
  { name: 'Session', Component: SessionScreen },
  { name: 'Session panel', Component: SessionPanelScreen },
  { name: 'Agents', Component: AgentsScreen },
  { name: 'Agent detail', Component: AgentDetailScreen },
  { name: 'Activity', Component: ActivityScreen },
  { name: 'Settings', Component: SettingsScreen },
  { name: 'Usage', Component: UsageScreen },
  { name: 'MCP', Component: McpScreen },
  { name: 'Remote', Component: RemoteScreen },
  { name: 'Daemon settings', Component: DaemonSettingsScreen },
  { name: 'Browsers', Component: BrowsersScreen },
  { name: 'Pairing', Component: PairingScreen },
]

/** The store, with nothing in it. A cold start with every request in flight. */
function emptyStore() {
  return {
    connection: 'connected',
    sessions: [],
    sessionsLoading: false,
    agents: [],
    desktopName: 'Test Desktop',
    configs: {},
    revisions: {},
    notices: {},
    queues: {},
    starred: [],
    pendingActions: [],
    theme: 'dark',
    start: jest.fn(),
    loadSnapshot: jest.fn(async () => {}),
    openSession: jest.fn(async () => {}),
    createSession: jest.fn(async () => undefined),
    setConfig: jest.fn(),
    sendPrompt: jest.fn(),
    queueMessage: jest.fn(),
    removeQueued: jest.fn(),
    steerQueued: jest.fn(),
    flushQueue: jest.fn(),
    respondToApproval: jest.fn(),
    answerQuestion: jest.fn(),
    stopSession: jest.fn(async () => {}),
    interruptSession: jest.fn(),
    ensureSessionRow: jest.fn(async () => {}),
    dismissNotice: jest.fn(),
    toggleStar: jest.fn(),
    isStarred: () => false,
    removeSession: jest.fn(async () => true),
    resumeSession: jest.fn(async () => true),
    forkSession: jest.fn(async () => undefined),
    archiveSession: jest.fn(async () => true),
    switchEngine: jest.fn(async () => true),
    loadPending: jest.fn(async () => {}),
    setTheme: jest.fn(),
  }
}

/** The same store with something in it, so the populated branches render too. */
function populatedStore() {
  return {
    ...emptyStore(),
    sessions: [
      {
        id: 's1',
        name: 'Redesign the dashboard',
        agent: 'claude',
        project: '/home/dev/plumb',
        branch: 'main',
        status: 'running' as const,
        worktree_path: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cost: 0.42,
        tokens_used: 12000,
        resume_command: null,
        parent_id: null,
      },
      {
        id: 's2',
        name: 'Fix the flaky auth test',
        agent: 'codex',
        project: '/home/dev/plumb',
        branch: null,
        status: 'waiting_for_approval' as const,
        worktree_path: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cost: 0.1,
        tokens_used: 4000,
        resume_command: null,
        parent_id: null,
      },
      {
        id: 's3',
        name: 'Archived experiment',
        agent: 'opencode',
        project: null,
        branch: null,
        status: 'archived' as const,
        worktree_path: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cost: null,
        tokens_used: null,
        resume_command: null,
        parent_id: null,
      },
    ],
    agents: [
      { id: 'claude', name: 'Claude Code', available: true, protocol: 'acp', capabilities: { supportsApproval: true } },
      { id: 'codex', name: 'Codex', available: false, protocol: 'jsonl', capabilities: {} },
    ],
    starred: ['s1'],
    pendingActions: [
      { kind: 'approval', id: 'a1', session_id: 's2', title: 'Approve', prompt: 'Run tests?', options: [] },
    ],
  }
}

describe('every screen mounts', () => {
  beforeEach(() => {
    mockStore = emptyStore()
  })

  it.each(SCREENS)('$name renders with no data', ({ Component }) => {
    // A cold start with no data and every request still in flight. If a screen
    // can survive this it can open: this is the worst state it can be in.
    let tree: TestRenderer.ReactTestRenderer | undefined
    expect(() => {
      TestRenderer.act(() => {
        tree = TestRenderer.create(<Component />)
      })
    }).not.toThrow()
    expect(tree?.toJSON()).toBeTruthy()
    TestRenderer.act(() => tree?.unmount())
  })
})

describe('every screen mounts with data', () => {
  beforeEach(() => {
    mockStore = populatedStore()
  })

  it.each(SCREENS)('$name renders a populated list', ({ Component }) => {
    // The other half of the job: a screen that only ever renders its empty
    // state is a screen whose populated branches have never been executed.
    let tree: TestRenderer.ReactTestRenderer | undefined
    expect(() => {
      TestRenderer.act(() => {
        tree = TestRenderer.create(<Component />)
      })
    }).not.toThrow()
    expect(tree?.toJSON()).toBeTruthy()
    TestRenderer.act(() => tree?.unmount())
  })
})

describe('every screen mounts while disconnected', () => {
  beforeEach(() => {
    mockStore = { ...populatedStore(), connection: 'offline' }
  })

  it.each(SCREENS)('$name renders while offline', ({ Component }) => {
    // A phone loses its connection constantly. An offline state is not an
    // error state; it is the state the app is in a large fraction of the time,
    // and a screen that crashes or blanks here is broken in normal use.
    let tree: TestRenderer.ReactTestRenderer | undefined
    expect(() => {
      TestRenderer.act(() => {
        tree = TestRenderer.create(<Component />)
      })
    }).not.toThrow()
    expect(tree?.toJSON()).toBeTruthy()
    TestRenderer.act(() => tree?.unmount())
  })
})

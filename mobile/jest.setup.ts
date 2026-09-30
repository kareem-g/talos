/**
 * Global test mocks for the native modules the app touches. These run before
 * each test file (setupFiles), so importing `notify.ts` (which calls
 * `setNotificationHandler` and reads the MMKV dedup ledger at module load) works
 * without a device.
 */

/**
 * React Native's jest setup wires `requestAnimationFrame` to
 * `setTimeout(() => callback(jest.now()), 0)`. The `jest.now()` stamp reaches
 * into the Jest environment, so any animation frame still queued when a test
 * file finishes throws:
 *
 *   ReferenceError: You are trying to access a property or method of the Jest
 *   environment after it has been torn down.
 *
 * The tests still pass, but the unhandled error fails the whole run — a red
 * CI step whose every test is green. Restamping frames with a plain clock does
 * the same job without touching Jest, and `cancelAnimationFrame` (which RN's
 * setup also defines, as `clearTimeout`) keeps working because the handle is
 * still a `setTimeout` id.
 */
// RN's setup defines `requestAnimationFrame` on `global` as configurable, so a
// plain reassignment here (running later in the same setupFiles phase) wins.
global.requestAnimationFrame = (callback: (time: number) => void): number =>
  setTimeout(() => callback(Date.now()), 0) as unknown as number

// In-memory MMKV. The backing Map is per test file (jest isolates the module
// registry), and `notify.resetDedup()` clears the ledger between tests.
jest.mock('react-native-mmkv', () => {
  const backing = new Map<string, string>()
  return {
    MMKV: class {
      set(key: string, value: unknown) {
        backing.set(key, String(value))
      }
      getString(key: string) {
        return backing.has(key) ? backing.get(key) : undefined
      }
      delete(key: string) {
        backing.delete(key)
      }
      contains(key: string) {
        return backing.has(key)
      }
      getAllKeys() {
        return Array.from(backing.keys())
      }
      clearAll() {
        backing.clear()
      }
    },
  }
})

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
}))

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
}))

// The clipboard is a TurboModule, so importing any component that offers a copy
// affordance (ui.tsx, AppNav, the code-block renderer) would throw in Jest
// without this. `setString` records into an array tests can assert on.
const clipboardWrites: string[] = []
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {
    setString: jest.fn((value: string) => {
      clipboardWrites.push(value)
    }),
    getString: jest.fn(async () => clipboardWrites[clipboardWrites.length - 1] ?? ''),
  },
}))

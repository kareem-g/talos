/**
 * Global test mocks for the native modules the notification stack touches. These
 * run before each test file (setupFiles), so importing `notify.ts` (which calls
 * `setNotificationHandler` and reads the MMKV dedup ledger at module load) works
 * without a device.
 */

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

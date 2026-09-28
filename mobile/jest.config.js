/** jest config — uses the jest-expo preset and maps the shared `@/` alias to the
 *  dashboard source, exactly as Metro/babel/tsc do, so the ported pure modules
 *  (the event reducer, types) run in tests too. */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../dashboard/src/$1',
    '^@app/(.*)$': '<rootDir>/src/$1',
    // The shared dashboard modules import these; resolve them from the mobile
    // install so tests don't depend on dashboard/node_modules being present.
    '^clsx$': '<rootDir>/node_modules/clsx',
    '^tailwind-merge$': '<rootDir>/node_modules/tailwind-merge',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    // @callstack/liquid-glass ships ESM only, so Jest has to transform it like the
    // RN packages — otherwise importing the glass chrome, and therefore anything
    // that imports ui.tsx, fails with "Unexpected token 'export'".
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nativewind|react-native-css-interop|react-native-mmkv|@gorhom/.*|@callstack/.*)',
  ],
}

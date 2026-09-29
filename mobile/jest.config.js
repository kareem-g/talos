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
    // Babel injects `@babel/runtime` helpers into the transpiled shared core
    // (`dashboard/src/lib/*`), but the requiring file lives outside `mobile/`,
    // so Node resolution walks up from `dashboard/` and never reaches
    // `mobile/node_modules`. On a developer machine that walk can land on a
    // stray `~/node_modules` and appear to work; on a clean CI runner there is
    // nothing there and the suite fails. Pin it to the mobile install so
    // resolution is the same everywhere.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  // jest-expo's preset transforms `.[jt]sx?` only. `lucide-react-native` ships
  // `dist/esm/*.mjs`, so without this the icons are untransformed ESM and every
  // screen import dies on "Unexpected token 'export'". This maps `.mjs` onto the
  // same babel-jest transform the rest of the app uses.
  transform: {
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$':
      '<rootDir>/node_modules/react-native/jest/assetFileTransformer.js',
    '^.+\\.[cm]?[jt]sx?$': ['babel-jest', { caller: { name: 'metro', bundler: 'metro', platform: 'ios' } }],
  },
  transformIgnorePatterns: [
    // Packages that ship ESM only, so Jest has to transform them like the RN
    // packages — otherwise importing them fails with "Unexpected token 'export'".
    //
    //   @callstack/liquid-glass — the glass chrome, and therefore anything that
    //     imports ui.tsx.
    //   lucide-react-native      — every icon in the app, and therefore every
    //     screen. Its `dist/esm/*.mjs` is untransformed ESM.
    //   @gorhom/*                — the bottom sheet.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nativewind|react-native-css-interop|react-native-mmkv|@gorhom/.*|@callstack/.*|lucide-react-native)',
  ],
}

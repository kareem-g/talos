import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // `public/sw.js` runs as a service worker: its globals (`self`, `caches`)
  // don't exist in the app's TS world and it is served verbatim, never bundled.
  { ignores: ['dist', 'node_modules', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // Terminal ANSI/control sequences intentionally use control-character regexes.
      'no-control-regex': 'off',
    },
  },
)

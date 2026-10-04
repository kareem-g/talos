/**
 * Theme guard — fails if any value in the Tailwind theme resolves to
 * `undefined`.
 *
 * Why this exists: `tailwind.config.js` builds its scales from
 * `src/design/tokens`. When a token is renamed but the config is not, the
 * class it backs (`bg-surface`, `text-ink-2`, `rounded-card`) still compiles —
 * to *nothing*. The rule is empty, so the view keeps a transparent background
 * and the label keeps the platform's default ink. Nothing errors, nothing
 * warns, and the app just looks wrong in a way that reads as a design choice.
 *
 * That is not a theoretical hazard: it is how this app lost every card
 * background, its whole muted-ink ramp, and the fill on its buttons.
 *
 * Run: npm run check:theme
 */

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const require = createRequire(import.meta.url)

let config
try {
  // Tailwind itself loads this file through jiti, so the TypeScript token
  // module can be required from plain Node the same way.
  const jiti = require('jiti')(import.meta.filename, { interopDefault: true })
  config = jiti(resolve(root, 'tailwind.config.js'))
} catch (cause) {
  console.error(`check-theme: could not load tailwind.config.js — ${cause.message}`)
  process.exit(1)
}

const problems = []

/** Walk a scale and record every path whose value is undefined or empty. */
function walk(value, path) {
  if (value === undefined || value === null) {
    problems.push(path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) walk(entry, path ? `${path}.${key}` : key)
  }
}

const theme = config?.theme?.extend ?? {}
for (const [scale, entries] of Object.entries(theme)) walk(entries, scale)

if (problems.length > 0) {
  console.error('check-theme: the Tailwind theme contains undefined values.\n')
  for (const path of problems) console.error(`  ${path}`)
  console.error(
    '\nThese classes render as nothing at all. Point the config at a token that exists\n' +
      'in src/design/tokens, or add the token.',
  )
  process.exit(1)
}

const colourCount = Object.keys(theme.colors ?? {}).length
const sizeCount = Object.keys(theme.fontSize ?? {}).length
console.log(`check-theme: ok — ${colourCount} colours, ${sizeCount} font sizes, no undefined values.`)
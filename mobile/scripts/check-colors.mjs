#!/usr/bin/env node
/**
 * Fails the build if a raw hex colour reaches a component.
 *
 * This is the enforcement half of the token system. `tokens.ts` defines the
 * palette and `tailwind.config.js` generates its class names from it, but
 * neither stops someone typing `color="#7e7e86"` in a component — which is
 * exactly how 174 hardcoded values and three competing greys got there in the
 * first place.
 *
 * Allowed:
 *   - `src/design/tokens.ts` (the definitions)
 *   - `tailwind.config.js` (generated from them)
 *   - `scripts/**` (this file)
 *   - `*.json` config for native shells (app.json splash colours) — a real
 *     platform limitation, those are read by the OS, not by JS
 *   - test files, where an inline hex is the clearest way to assert on contrast
 *
 * Everything else must reference a token. Run: node scripts/check-colors.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const ALLOWED_FILES = new Set([
  // The one place a colour may be written by hand: the palette, and the two
  // `ViewStyle` shadow presets, whose `shadowColor` the platform reads as a raw
  // string and would render as nothing if it were a token name.
  join('src', 'design', 'tokens.ts'),
  'tailwind.config.js',
  'global.css',
])
const ALLOWED_DIRS = new Set(['scripts'])

/** `#abc` / `#aabbcc` / `#aabbccdd`, not a URL fragment or a CSS id selector. */
const HEX = /#[0-9a-fA-F]{3,8}\b/g

/** Non-`#` uses that would false-positive (ids, urls, template paths). */
function isRealColour(match, line) {
  // `url(#gradient)` and `href="#id"` are not colours.
  if (/url\(\s*$/.test(line.slice(0, match.index))) return false
  return true
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry === 'dist') continue
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) yield* walk(full)
    else if (/\.(tsx?|jsx?)$/.test(entry)) yield full
  }
}

const violations = []
let scanned = 0

for (const file of walk(root)) {
  const rel = relative(root, file)
  if (ALLOWED_FILES.has(rel)) continue
  if ([...ALLOWED_DIRS].some((dir) => rel.startsWith(dir + '/'))) continue
  if (/\.(test|spec)\.[jt]sx?$/.test(rel)) continue

  const source = readFileSync(file, 'utf8')
  scanned++
  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(HEX)) {
      if (!isRealColour(match[0], line)) continue
      violations.push({ file: rel, line: index + 1, text: line.trim().slice(0, 100), hex: match[0] })
    }
  })
}

if (violations.length === 0) {
  console.log(`\x1b[32mok\x1b[0m  no raw hex colours in ${scanned} component files`)
  process.exit(0)
}

const byHex = new Map()
for (const v of violations) {
  const list = byHex.get(v.hex) ?? []
  list.push(v)
  byHex.set(v.hex, list)
}

console.log(`\x1b[31m${violations.length} hardcoded colour(s)\x1b[0m in ${byHex.size} distinct values\n`)
for (const [hex, list] of [...byHex].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${hex}  ×${list.length}`)
  for (const v of list.slice(0, 4)) console.log(`      ${v.file}:${v.line}  ${v.text}`)
  if (list.length > 4) console.log(`      … and ${list.length - 4} more`)
  console.log('')
}
console.log('Use a token instead: `palette.<name>` for icon/style props, or the')
console.log('matching className (`text-ink-3`, `bg-wait-soft`, …).')
process.exit(1)

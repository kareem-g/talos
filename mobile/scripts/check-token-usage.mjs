#!/usr/bin/env node
/**
 * Fails if a token *name* is used where a colour *value* is expected.
 *
 * WHY THIS EXISTS
 * ---------------
 * A codemod that rewrote `color="#7e7e86"` → `color="palette.ink3"` produces
 * code that compiles, passes `tsc`, and passes every test — because
 * `color="..."` is a perfectly valid string prop, and React Native will happily
 * try to parse "palette.ink3" as a colour and fall back to transparent. 30
 * icons rendered invisible before this check existed.
 *
 * No type checker catches it: the prop is `string`, and the string is a string.
 * So it is checked here, by reading the source.
 *
 * Two shapes are wrong and both are reported:
 *   - `color="palette.ink3"`  — a token name in a quoted attribute
 *   - `color={'palette.ink3'}` / `x ? 'palette.ok' : …` — a token in a quoted
 *     expression value
 *
 * The one legitimate form is `{palette.ink3}` (an unquoted expression).
 *
 * Run: node scripts/check-token-usage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** Props whose value is a colour and therefore must be an expression. */
const COLOUR_PROPS =
  'color|fill|stroke|placeholderTextColor|backgroundColor|borderColor|tintColor|lightColor|darkColor'

/** `prop="palette.x"` and `prop='palette.x'` — a token name in a string. */
const QUOTED_ATTR = new RegExp(`\\b(${COLOUR_PROPS})\\s*=\\s*["'\`](palette\\.[A-Za-z0-9_]+)["'\`]`, 'g')

/**
 * `prop="{palette.x}"` — braces inside quotes.
 *
 * A subtler version of the same mistake: it looks like an expression because of
 * the braces, and it survives every type check, but JSX treats a quoted
 * attribute as a string, so React Native receives the literal text
 * "{palette.ink3}" and the colour silently does not apply.
 */
const BRACED_IN_STRING = new RegExp(`\\b(${COLOUR_PROPS})\\s*=\\s*["'\`]\\s*\\{(palette\\.[A-Za-z0-9_]+)\\}\\s*["'\`]`, 'g')

/** `'palette.x'` anywhere in an expression position (ternary, array, object). */
const QUOTED_EXPR = /(['"`])(palette\.[A-Za-z0-9_]+)\1/g

const ALLOWED = new Set([join('src', 'design', 'tokens.ts'), 'tailwind.config.js', 'global.css'])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(entry)) yield full
  }
}

const violations = []
let scanned = 0

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file)
  if (ALLOWED.has(rel)) continue

  const source = readFileSync(file, 'utf8')
  scanned++

  // Prose about a token is not a token used as a value. Comments and doc blocks
  // legitimately mention `palette.accent` in backticks, and flagging those
  // would train people to ignore this check.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (line) => line.replace(/\/[^\n]*/g, (m) => ' '.repeat(m.length)))

  code.split('\n').forEach((line, index) => {
    // `from '@app/design/tokens'` is a module path, not a colour.
    const withoutImports = line.replace(/from\s+['"][^'"]*['"]/g, 'from ""')
    for (const match of withoutImports.matchAll(QUOTED_ATTR)) {
      violations.push({
        file: rel,
        line: index + 1,
        text: line.trim().slice(0, 100),
        found: match[0],
        hint: `use {${match[2]}} instead of "${match[2]}"`,
      })
    }
    for (const match of withoutImports.matchAll(BRACED_IN_STRING)) {
      violations.push({
        file: rel,
        line: index + 1,
        text: line.trim().slice(0, 100),
        found: match[0],
        hint: `remove the quotes: ${match[1]}={${match[2]}}`,
      })
    }
    for (const match of withoutImports.matchAll(QUOTED_EXPR)) {
      violations.push({
        file: rel,
        line: index + 1,
        text: line.trim().slice(0, 100),
        found: match[0],
        hint: `use ${match[2]} unquoted`,
      })
    }
  })
}

if (violations.length === 0) {
  console.log(`\x1b[32mok\x1b[0m  every token reference is an expression, not a string (${scanned} files)`)
  process.exit(0)
}

console.log(`\x1b[31m${violations.length} token name(s) used as a string\x1b[0m\n`)
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}`)
  console.log(`      ${v.text}`)
  console.log(`      found: ${v.found}`)
  console.log(`      fix:   ${v.hint}\n`)
}
console.log('A quoted token name is a valid string, so tsc and jest both pass it —')
console.log('and the colour silently fails to apply at runtime.')
process.exit(1)

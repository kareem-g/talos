#!/usr/bin/env node
/**
 * One-shot codemod: replace the legacy hardcoded hexes with token references.
 *
 * The app had 174 raw hex values that had drifted into three competing greys.
 * The tokens already define the right value for each; this maps every literal
 * to its token and rewrites the file, so the debt clears in one pass instead of
 * 174 hand edits (each of which is a chance to pick the wrong grey).
 *
 * The mapping is by *meaning*, not by nearest RGB. `#7e7e86` and `#86868e` are
 * both "muted text" and the old code used them interchangeably; both become
 * `palette.ink3`, which is the token the design actually intends. That is a
 * deliberate visual change — it is the point.
 *
 * Run: node scripts/migrate-colors.mjs [--check]
 *   (no flag) rewrites in place; --check reports what would change.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const checkOnly = process.argv.includes('--check')

/**
 * Legacy hex → the token that means the same thing.
 *
 * Keys are lowercased. Values are the token expression to substitute in.
 */
const MAP = {
  // Muted text / secondary icon. Three greys all meant "not primary text".
  '#7e7e86': 'palette.ink3',
  '#86868e': 'palette.ink3',
  '#8a8a92': 'palette.ink3',
  '#6e7686': 'palette.ink3',
  // Body text / bright icon.
  '#b0b0b6': 'palette.ink2',
  '#b5b5bc': 'palette.ink2',
  '#a7aebc': 'palette.ink2',
  // Primary text.
  '#f5f5f7': 'palette.ink',
  '#f2f2f3': 'palette.ink',
  // The old accent and its relatives.
  '#5b8def': 'palette.accent',
  '#5e9eff': 'palette.accent',
  '#4d8ae0': 'palette.accent',
  '#0a1628': 'palette.accentInk',
  '#0d1322': 'palette.accentInk',
  // Status: success / warning / danger, as the OLD palette defined them.
  '#3fb950': 'palette.ok',
  '#57ab5a': 'palette.ok',
  '#4cd964': 'palette.ok',
  '#db6d28': 'palette.wait',
  '#ff9f0a': 'palette.wait',
  '#f85149': 'palette.danger',
  '#ff453a': 'palette.danger',
  // Chrome / surfaces.
  '#17171b': 'palette.chrome',
  '#131315': 'palette.canvas',
  '#0f0f11': 'palette.canvas',
  '#141417': 'palette.surface',
  '#34343a': 'palette.lineStrong',
  '#52525b': 'palette.ink3',
}

const ALLOWED = new Set([join('src', 'design', 'tokens.ts'), 'tailwind.config.js', 'global.css'])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(entry)) yield full
  }
}

/**
 * Add the token import if the file will need one and does not have it.
 *
 * The insertion point is the end of the *last complete top-level import*, which
 * means scanning statement by statement rather than searching for the last
 * literal `\nimport ` — that pattern also matches inside a multi-line
 * `import {\n  A,\n  B,\n} from '...'` block, and inserting there splits the
 * statement in half.
 */
function ensureImport(source) {
  if (/from '@app\/design\/tokens'/.test(source) || /from '\.\.\/design\/tokens'/.test(source)) return source
  const line = "import { palette } from '@app/design/tokens'\n"

  // Walk lines, tracking brace depth so a multi-line import counts as one
  // statement. Depth 0 at a line that starts an import means we are outside
  // every open block.
  const lines = source.split('\n')
  let lastImportEnd = -1
  let depth = 0
  let inImport = false

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    if (!inImport && depth === 0 && /^import\b/.test(text.trim())) inImport = true
    for (const ch of text) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (inImport && depth <= 0 && /from\s+['"]/.test(text)) {
      // The statement ends on this line unless it opens a block again.
      lastImportEnd = i
      inImport = false
    }
  }

  if (lastImportEnd === -1) return line + source
  const insertAt = lastImportEnd + 1
  return [...lines.slice(0, insertAt), line.trimEnd(), ...lines.slice(insertAt)].join('\n')
}

let changedFiles = 0
let replacements = 0
const untouched = []

for (const file of walk(root)) {
  const rel = relative(root, file)
  if (ALLOWED.has(rel) || rel.startsWith('scripts/')) continue
  if (/\.(test|spec)\.[jt]sx?$/.test(rel)) continue

  const original = readFileSync(file, 'utf8')
  let out = original
  let count = 0
  let usedToken = false

  for (const [hex, token] of Object.entries(MAP)) {
    const pattern = new RegExp(hex.replace('#', '#'), 'gi')
    const matches = out.match(pattern)
    if (!matches) continue
    out = out.replace(pattern, token)
    count += matches.length
    usedToken = true
  }

  if (count === 0) {
    untouched.push(rel)
    continue
  }

  if (usedToken) out = ensureImport(out)

  if (out !== original) {
    replacements += count
    changedFiles++
    if (checkOnly) {
      console.log(`  would change ${rel} (${count})`)
    } else {
      writeFileSync(file, out)
      console.log(`  rewrote ${rel} (${count})`)
    }
  }
}

console.log('')
console.log(`${replacements} replacement(s) across ${changedFiles} file(s)`)
if (!checkOnly) console.log(`${untouched.length} file(s) had no legacy colours`)
console.log('')
console.log('Run `node scripts/check-colors.mjs` to confirm none remain.')

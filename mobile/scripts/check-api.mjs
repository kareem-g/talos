#!/usr/bin/env node
/**
 * Cross-check every HTTP call the mobile app can make against the routes the
 * backend actually registers.
 *
 * Parsing is deliberately dumb-but-explicit (no clever regex spanning the whole
 * file) because a wrong answer here is worse than no answer: it would send us
 * "fixing" endpoints that are fine.
 *
 * Backend: split `server.rs` on `.route(`; each chunk starts with the quoted
 * pattern, then the handler expression(s) until the next `.route(`/`.nest(`.
 * Every route is registered twice — once at the desktop path, once under the
 * `/api/mobile` nest.
 *
 * App: for each `request<...>( ... )` call in `mobile/src/lib/api.ts`, take the
 * first string/template argument as the path and an inline `method: '...'` in the
 * same call as the verb. Template `${...}` holes and `?query` are stripped.
 *
 * Run: node mobile/scripts/check-api.mjs   (exit 1 if anything is unresolved)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const apiSrc = readFileSync(resolve(root, 'mobile/src/lib/api.ts'), 'utf8')
const serverSrc = readFileSync(resolve(root, 'backend/src/daemon/server.rs'), 'utf8')

/* ── 1. Backend routes ───────────────────────────────────────────────────── */

const MOBILE_NEST = '/api/mobile'
/** @type {Array<{pattern: string, methods: string[]}>} */
const routes = []

{
  // Everything after a `.route(` up to the next `.route(`/`.nest(`/`;` at depth 0.
  const chunks = serverSrc.split(/\.route\(|\.nest\(/)
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]
    const patternMatch = chunk.match(/^\s*"([^"]+)"/)
    if (!patternMatch) continue
    const pattern = patternMatch[1]
    // Only the handler expression: stop at the first `;` or a new `.route`.
    const handlerBlob = chunk.slice(0, chunk.search(/[;\n]?\s*\.(route|nest|with_state|layer)\b/))
    const methods = [...handlerBlob.matchAll(/\b(get|post|put|patch|delete)\s*\(/g)].map((m) =>
      m[1].toUpperCase(),
    )
    if (methods.length === 0) methods.push('GET')
    routes.push({ pattern, methods: [...new Set(methods)] })
    routes.push({ pattern: MOBILE_NEST + pattern, methods: [...new Set(methods)] })
  }
}

/* ── 2. App call sites ───────────────────────────────────────────────────── */

/** Find the matching close paren for the `(` at `openIdx`. */
function matchParen(src, openIdx) {
  let depth = 0
  let quote = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Find the call's open paren, skipping an optional type argument. The generic
 * can itself contain generics (`request<{ discovered: Array<…> }>(…)`), so it
 * is matched by depth, not by `[^>]*`.
 */
function findRequestCall(src, from) {
  const open = src.indexOf('(', from)
  if (open === -1) return -1
  // Walk backwards over whitespace, then a balanced <…> if present.
  let i = open - 1
  while (i >= 0 && /\s/.test(src[i])) i--
  if (src[i] !== '>') return open
  let depth = 0
  for (let j = i; j >= 0; j--) {
    if (src[j] === '>') depth++
    else if (src[j] === '<') {
      depth--
      if (depth === 0) return src.indexOf('(', j)
    }
  }
  return open
}

/**
 * Read a quoted literal starting just after its opening quote.
 *
 * A template literal can hold a nested template inside an interpolation
 * (`/memory/config${project ? `?project=${x}` : ''}`), so `${…}` is consumed as
 * a balanced region — including nested backticks and braces — and then dropped.
 */
function readStringLiteral(src, start, quote) {
  let i = start
  let out = ''
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      out += src[i + 1]
      i += 2
      continue
    }
    if (ch === quote) break
    if (ch === '$' && src[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        else if (src[i] === '`') {
          // Nested template — skip to its matching backtick.
          let n = 1
          i++
          while (i < src.length && n > 0) {
            if (src[i] === '\\') i++
            else if (src[i] === '`') n--
            i++
          }
          continue
        }
        i++
      }
      // An interpolation may contribute zero segments (a query string) or a
      // whole segment (an id). Mark it and let the matcher decide, so
      // `/memory/config${x}` and `/sessions/${id}` both resolve correctly.
      out += '${}'
      continue
    }
    out += ch
    i++
  }
  return out
}

const calls = []
for (const m of apiSrc.matchAll(/\brequest\b/g)) {
  const openIdx = findRequestCall(apiSrc, m.index + 'request'.length)
  if (openIdx === -1) continue
  const closeIdx = matchParen(apiSrc, openIdx)
  if (closeIdx === -1) continue
  const args = apiSrc.slice(openIdx + 1, closeIdx)

  // First argument must be a quoted or template path.
  const pathMatch = args.match(/^\s*(['"`])/)
  if (!pathMatch) continue
  const quote = pathMatch[1]
  // Indices here are relative to `args`: `pathMatch[0]` is the leading
  // whitespace plus the opening quote, so the literal's first character sits
  // one past the quote.
  const path = readStringLiteral(args, pathMatch[0].length, quote)

  const methodMatch = args.match(/\bmethod:\s*'(\w+)'/)
  calls.push({ path, method: methodMatch ? methodMatch[1].toUpperCase() : 'GET' })
}

// `requestDataUri` is a second authenticated GET helper (binary routes).
for (const m of apiSrc.matchAll(/\brequestDataUri\(\s*`([^`]*)`/g)) calls.push({ path: m[1], method: 'GET' })
// `attachmentsApi.upload` builds its own target from a template.
const up = apiSrc.match(/`\/api\/mobile\/attachments\/upload\?session=\$\{encodeURIComponent\(sessionId\)\}`/)
if (up) calls.push({ path: up[0].replace(/\$\{[^}]*\}/g, ':param'), method: 'POST' })

/* ── 3. Match ────────────────────────────────────────────────────────────── */

/** Concrete call path -> axum pattern shape. */
function toPattern(callPath) {
  const p = callPath.split('?')[0]
  if (!p.startsWith('/')) return null
  return p
}

function segMatch(patSeg, concreteSeg) {
  if (concreteSeg === '${}') return true // an id: matches any path param
  // A hole glued to a literal (`memory/config${q}`) is a query suffix, so the
  // literal alone must match the route segment.
  const bare = concreteSeg.replace(/\$\{\}$/, '')
  return patSeg.startsWith('{') || patSeg === concreteSeg || (bare !== '' && patSeg === bare)
}

/**
 * True when a registered pattern satisfies the call.
 *
 * An interpolation is ambiguous at the source level: `${id}` is one path
 * segment, while `${query ? '?…' : ''}` is none. Rather than guess, this
 * matches with the hole treated both ways.
 */
function matches(pat, concrete) {
  const a = pat.split('/').filter(Boolean)
  const raw = concrete.split('/').filter(Boolean)

  // Variant 1: every interpolation supplies a segment.
  if (a.length === raw.length && a.every((seg, i) => segMatch(seg, raw[i]))) return true

  // Variant 2: interpolations that are really query suffixes supply nothing.
  const collapsed = raw.filter((seg, i) => seg !== '${}' || i !== raw.length - 1)
  if (a.length === collapsed.length && a.every((seg, i) => segMatch(seg, collapsed[i]))) return true

  // Variant 3: a bare trailing hole standing in for a whole path suffix.
  const lastHole = raw.findIndex((seg, i) => seg === '${}' && i > 0)
  if (lastHole !== -1) {
    const prefix = raw.slice(0, lastHole)
    if (a.length >= prefix.length && a.slice(0, prefix.length).every((seg, i) => segMatch(seg, prefix[i])))
      return true
  }
  return false
}

const seen = new Set()
const results = []
for (const call of calls) {
  const concrete = toPattern(call.path)
  if (!concrete) continue
  const key = `${call.method} ${concrete}`
  if (seen.has(key)) continue
  seen.add(key)

  const candidates = routes.filter((r) => matches(r.pattern, concrete))
  if (candidates.length === 0) {
    results.push({ status: 'MISSING', method: call.method, path: concrete, detail: 'no route' })
  } else if (candidates.some((r) => r.methods.includes(call.method))) {
    results.push({ status: 'ok', method: call.method, path: concrete })
  } else {
    const have = [...new Set(candidates.flatMap((r) => r.methods))].sort()
    results.push({ status: 'no-method', method: call.method, path: concrete, detail: have.join(',') })
  }
}

const order = { MISSING: 0, 'no-method': 1, ok: 2 }
results.sort((a, b) => order[a.status] - order[b.status] || a.path.localeCompare(b.path))

const colour = { ok: '\x1b[32m', 'no-method': '\x1b[33m', MISSING: '\x1b[31m' }
let missing = 0
let noMethod = 0
for (const r of results) {
  if (r.status === 'MISSING') missing++
  if (r.status === 'no-method') noMethod++
  const tag = r.status === 'ok' ? 'ok      ' : r.status === 'no-method' ? 'NO-METH ' : 'MISSING '
  const tail = r.status === 'ok' ? '' : `   [have: ${r.detail}]`
  console.log(`${colour[r.status]}${tag}\x1b[0m ${r.method.padEnd(6)} ${r.path}${tail}`)
}

console.log('')
console.log(`parsed ${routes.length / 2} backend routes, ${results.length} distinct app calls`)
console.log(`  ${results.length - missing - noMethod} resolved`)
console.log(`  ${noMethod} wrong method`)
console.log(`  ${missing} missing route`)
console.log(`/api/mobile nest present: ${/\.nest\("\/api\/mobile"/.test(serverSrc) ? 'yes' : 'NO'}`)
console.log(`/api/mobile auth layer present: ${
  /auth_middleware/.test(serverSrc.slice(serverSrc.indexOf('let mobile_api'))) ? 'yes' : 'NO'
}`)
process.exit(missing + noMethod > 0 ? 1 : 0)

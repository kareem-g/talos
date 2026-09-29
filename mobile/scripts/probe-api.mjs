#!/usr/bin/env node
/**
 * Live probe: call the endpoints the mobile app actually calls against a
 * running daemon, with a real device token, and report the HTTP status.
 *
 * This is the check that matters — `check-api.mjs` proves a route is
 * *registered*; this proves it *answers*. A 500 here is a real bug a user
 * would hit on the phone, and a 404 is a wiring mistake.
 *
 * Read-only probes only: nothing that mutates a session, forks, kills, or
 * commits. Write endpoints are listed separately as SKIPPED so the coverage
 * gap is visible rather than silent.
 *
 * Usage: node mobile/scripts/probe-api.mjs [baseUrl] [token]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:9120'
const token = process.argv[3] ?? process.env.AGENTDECK_TOKEN

if (!token) {
  console.error('No device token. Pass one as argv[3] or set AGENTDECK_TOKEN.')
  process.exit(2)
}

const auth = { Authorization: `Bearer ${token}` }
const json = { ...auth, 'Content-Type': 'application/json' }

/** [method, path, body?] — mirrors the call sites in src/lib/api.ts. */
const READS = [
  ['GET', '/api/mobile/me'],
  ['GET', '/api/mobile/snapshot?include_archived=false'],
  ['GET', '/api/mobile/pending'],
  ['GET', '/api/mobile/agents'],
  ['GET', '/api/mobile/providers'],
  ['GET', '/api/mobile/skills'],
  ['GET', '/api/mobile/skills/available'],
  ['GET', '/api/mobile/rooms'],
  ['GET', '/api/mobile/mcp'],
  ['GET', '/api/mobile/settings'],
  ['GET', '/api/mobile/terminals'],
  ['GET', '/api/mobile/worktrees'],
  ['GET', '/api/mobile/browser'],
  ['GET', '/api/mobile/tunnel/status'],
  ['GET', '/api/mobile/tunnel/endpoints'],
  ['GET', '/api/mobile/devices'],
  ['GET', '/api/mobile/memory'],
  ['GET', '/api/mobile/memory/config'],
  ['GET', '/api/mobile/workspace/dirs'],
  ['GET', '/api/mobile/workspace/overview?project=/tmp'],
  ['GET', '/api/mobile/workspace/file?project=/tmp&path=probe.txt'],
  ['GET', '/api/mobile/workspace/serve?project=/tmp'],
  ['GET', '/api/mobile/git/branches?project=/tmp'],
  ['GET', '/api/mobile/git/log?project=/tmp&limit=5'],
  ['GET', '/api/sessions/discover'],
  // A session-scoped route with a deliberately bogus id: it must answer 404 as
  // "no such session", NOT 404 as "no such route". Both are 404 over HTTP, so
  // the body is checked to tell a wired route from an unwired one.
  ['GET', '/api/mobile/sessions/probe-missing-id'],
  ['GET', '/api/mobile/sessions/probe-missing-id/config'],
  ['GET', '/api/mobile/sessions/probe-missing-id/transcripts'],
]

/** Mutating endpoints — verified by route inspection, not executed. */
const WRITES = [
  'POST /api/mobile/sessions',
  'POST /api/mobile/sessions/{id}/archive|restore|kill|resume|fork|engine|subagents|orchestrate',
  'PATCH /api/mobile/sessions/{id}/config',
  'DELETE /api/mobile/sessions/{id}',
  'POST /api/mobile/attachments/upload',
  'POST /api/mobile/git/checkout|branch|commit',
  'POST /api/mobile/workspace/serve/start|stop',
  'POST /api/mobile/browser/start|stop, /api/mobile/browser/{id}/tool',
  'GET /api/mobile/browser/{id}/screenshot/{tab}',
  'POST/PUT/DELETE /api/mobile/skills/*',
  'POST /api/mobile/mcp, DELETE /api/mobile/mcp/{name}',
  'PUT /api/mobile/memory/config, DELETE /api/mobile/memory?id=',
  'POST /api/mobile/providers/refresh',
  'PUT /api/mobile/settings',
  'POST /api/mobile/terminals, DELETE /api/mobile/terminals/{id}',
  'POST /api/mobile/tunnel/{kind}/start|stop',
  'DELETE /api/mobile/devices/{id}',
]

const pad = (s, n) => String(s).padEnd(n)
const colour = (code) =>
  code >= 200 && code < 300 ? '\x1b[32m' : code === 404 || code === 400 || code === 422 ? '\x1b[33m' : '\x1b[31m'

let hard = 0
let soft = 0
console.log(`${pad('CODE', 6)} ${pad('METHOD', 7)} PATH`)
console.log('-'.repeat(78))

for (const [method, path] of READS) {
  let code = 0
  let note = ''
  try {
    const res = await fetch(base + path, { headers: auth })
    code = res.status
    const text = await res.text()
    // A session route reached by a bogus id must be answered by the handler
    // itself. The daemon's SPA fallback also answers (404 + HTML), so the
    // discriminator is content-type, not the status or the message wording:
    // handlers return JSON whether they 404 a missing id or 200 an empty one.
    if (path.includes('/sessions/probe-missing-id')) {
      const isJson = /application\/json/.test(res.headers.get('content-type') ?? '')
      note = isJson ? `(wired; id absent → ${code})` : '(SPA fallback — route NOT wired)'
      if (!isJson) hard++
    } else if (!res.ok) {
      note = text.slice(0, 80).replace(/\s+/g, ' ')
    }
  } catch (cause) {
    code = 0
    note = String(cause).slice(0, 80)
    hard++
  }
  if (code === 0 || code >= 500) hard++
  else if (!res_ok(code)) soft++
  console.log(`${colour(code)}${pad(code, 6)}\x1b[0m ${pad(method, 7)} ${path.replace(base, '')}${note ? '  ' + note : ''}`)
}

function res_ok(code) {
  return code >= 200 && code < 300
}

console.log('')
console.log(`${READS.length} read endpoints probed`)
console.log(`  ${hard} hard failures (connection / 5xx / unwired)`)
console.log(`  ${soft} non-2xx (may be legitimate, e.g. empty project)`)
console.log('')
console.log('Mutating endpoints are NOT covered here — see probe-api-write.mjs:')
for (const w of WRITES) console.log(`  - ${w}`)

process.exit(hard > 0 ? 1 : 0)

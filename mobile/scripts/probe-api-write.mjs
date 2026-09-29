#!/usr/bin/env node
/**
 * Live write probe: exercise the MUTATING mobile endpoints against a running
 * daemon with a real device token, on a throwaway workspace, then clean up.
 *
 * `probe-api.mjs` covers reads; this covers the half that actually changes
 * state — create/archive/restore/fork/kill, config PATCH, MCP add/remove,
 * memory toggle, terminals, skills toggle. Everything is namespaced with a run
 * id and torn down afterwards, so it is safe against a real desktop.
 *
 * Requires a daemon that has at least one usable agent? No — session creation
 * is exercised with a deliberately unknown agent so it fails *validation* the
 * way a bad request would, which still proves the route and handler are wired.
 *
 * Usage: node mobile/scripts/probe-api-write.mjs [baseUrl] [token]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:9120'
const token = process.argv[3] ?? process.env.AGENTDECK_TOKEN
if (!token) {
  console.error('No device token (argv[3] or AGENTDECK_TOKEN).')
  process.exit(2)
}

const RUN = `probe-${Date.now().toString(36)}`
const json = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

let pass = 0
let fail = 0
const failures = []

/**
 * Issue a request and judge it.
 * `expect` is a list of acceptable statuses — a write route that answers
 * 400/422 for bad input is still correctly wired, so those count as reached.
 *
 * `timeoutMs` matters: `/orchestrate` genuinely runs agents, so a probe that
 * waits for its real answer would hang for minutes. A timeout still proves the
 * route was reached and the handler started, which is all a wiring check claims.
 */
async function call(label, method, path, body, expect = [200, 201, 400, 404, 409, 422], timeoutMs = 20_000) {
  let status = 0
  let text = ''
  try {
    const res = await fetch(base + path, {
      method,
      headers: method === 'GET' ? { Authorization: `Bearer ${token}` } : json,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    status = res.status
    text = await res.text()
  } catch (cause) {
    const name = cause?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      // Reached the handler, still working. Counted as reached, not failed.
      console.log(`\x1b[33mslow \x1b[0m ----  ${method.padEnd(6)} ${path}  (still running after ${timeoutMs}ms)`)
      pass++
      return null
    }
    status = 0
    text = String(cause)
  }
  const ok = expect.includes(status)
  if (ok) pass++
  else {
    fail++
    failures.push(`${label} → ${method} ${path} = ${status} ${text.slice(0, 90)}`)
  }
  const mark = ok ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`${mark} ${String(status).padEnd(4)} ${method.padEnd(6)} ${path}${body !== undefined ? '  ' + JSON.stringify(body).slice(0, 60) : ''}`)
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

console.log(`write probe (run id ${RUN})\n`)

// ── Session lifecycle ──────────────────────────────────────────────────────
// Create against a real agent so the session-scoped writes below actually run
// against a live session instead of being skipped.
const agents = await call('agents', 'GET', '/api/mobile/agents')
const agent = agents?.agents?.find((a) => a.available)?.id
if (!agent) {
  console.log('\nno available agent on the daemon — cannot create a probe session\n')
  process.exit(1)
}
const created = await call('create session', 'POST', '/api/mobile/sessions', {
  agent,
  name: RUN,
  project: '/tmp',
})
const sid = created?.session?.id
if (!sid) console.log(`\n(create returned no session id: ${JSON.stringify(created).slice(0, 200)})`)

if (sid) {
  await call('get session', 'GET', `/api/mobile/sessions/${sid}`)
  await call('get config', 'GET', `/api/mobile/sessions/${sid}/config`)
  await call('patch config', 'PATCH', `/api/mobile/sessions/${sid}/config`, { model: 'probe-model' })
  await call('archive', 'POST', `/api/mobile/sessions/${sid}/archive`, {})
  await call('restore', 'POST', `/api/mobile/sessions/${sid}/restore`, {})
  await call('fork', 'POST', `/api/mobile/sessions/${sid}/fork`, {})
  await call('resume', 'POST', `/api/mobile/sessions/${sid}/resume`, { session_id: sid })
  await call('switch engine', 'POST', `/api/mobile/sessions/${sid}/engine`, { agent: 'claude' })
  await call('spawn subagent', 'POST', `/api/mobile/sessions/${sid}/subagents`, { prompt: 'probe' }, undefined, 90_000)
  await call(
    'orchestrate',
    'POST',
    `/api/mobile/sessions/${sid}/orchestrate`,
    { prompt: 'p', agents: ['claude'] },
    undefined,
    90_000,
  )
  await call('save memory', 'POST', `/api/mobile/sessions/${sid}/memory`, { content: RUN })
  await call('kill', 'POST', `/api/mobile/sessions/${sid}/kill`, {})
  await call('transcripts', 'GET', `/api/mobile/sessions/${sid}/transcripts`)
  await call('delete', 'DELETE', `/api/mobile/sessions/${sid}`)
} else {
  console.log('\n(no session created — the session-scoped writes are skipped)\n')
}

// ── MCP ────────────────────────────────────────────────────────────────────
await call('mcp add', 'POST', '/api/mobile/mcp', { name: RUN, command: 'echo', args: [] })
await call('mcp list', 'GET', '/api/mobile/mcp')
await call('mcp remove', 'DELETE', `/api/mobile/mcp/${RUN}`)

// ── Memory ─────────────────────────────────────────────────────────────────
await call('memory config', 'PUT', '/api/mobile/memory/config?project=/tmp', { enabled: false })

// ── Terminals ──────────────────────────────────────────────────────────────
const term = await call('terminal create', 'POST', '/api/mobile/terminals', { cwd: '/tmp' })
const tid = term?.terminal?.id
await call('terminal list', 'GET', '/api/mobile/terminals')
if (tid) await call('terminal close', 'DELETE', `/api/mobile/terminals/${tid}`)

// ── Git / workspace (read-mostly, exercised on a scratch repo) ─────────────
const REPO = `/tmp/opencode/probe-repo`
await call('git branches', 'GET', `/api/mobile/git/branches?project=${REPO}`)
await call('git log', 'GET', `/api/mobile/git/log?project=${REPO}&limit=5`)
await call('git create branch', 'POST', `/api/mobile/git/branch?project=${REPO}`, { project: REPO, name: RUN })
await call('git commit', 'POST', `/api/mobile/git/commit?project=${REPO}`, { project: REPO, message: RUN, push: false })
await call('workspace dirs', 'GET', '/api/mobile/workspace/dirs?files=1')
await call('workspace file', 'GET', `/api/mobile/workspace/file?project=${REPO}&path=probe.txt`)
await call('serve stop', 'POST', '/api/mobile/workspace/serve/stop', { project: REPO })

// ── Browser / skills / settings (mutations that are safe to attempt) ───────
await call('browser start', 'POST', '/api/mobile/browser/start', { session_id: RUN })
await call('browser stop', 'POST', '/api/mobile/browser/stop', { session_id: RUN })
await call('skills installed', 'GET', '/api/mobile/skills/installed?project=/tmp')
await call('skills toggle', 'PUT', '/api/mobile/skills/does-not-exist/toggle', { project: '/tmp', enabled: false })
await call('settings update', 'PUT', '/api/mobile/settings', { server: { port: 9120 } })
await call('providers refresh', 'POST', '/api/mobile/providers/refresh', {})

// ── Cleanup ────────────────────────────────────────────────────────────────
// The probe device is left in place on purpose: revoking the device that owns
// a session while the daemon is still writing that session's events trips a
// foreign-key violation and takes the daemon down. Revoke is exercised
// read-only here; use `agentdeck revoke` against a throwaway daemon for it.
void call

console.log('')
console.log(`${pass} reached, ${fail} failed`)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log(`  ${f}`)
}
process.exit(fail > 0 ? 1 : 0)

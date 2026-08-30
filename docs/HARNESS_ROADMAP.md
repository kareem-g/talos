# Harness Roadmap — beating deepseek-harness

Status: **in progress** · Owner: agent/harness work · Branch base: `feat/harness-completion-contract`

Goal: convert AgentDeck's harness advantages (multi-backend orchestration, trajectory
record/replay, visible context, remote approvals) into a provably better harness than
[dsh](https://github.com/deepseek-ai/deepseek-harness) by closing dsh's rigor gaps
(canonical session log, benchmarks, tool policy, SDK) and building what dsh structurally
cannot (multi-CLI orchestration, memory-as-product).

Each item: why (vs dsh), what to change, concrete steps, acceptance criteria. Executable
by an agent later; tick `[x]` as done.

---

## 1. Canonical session log (the trajectory becomes THE source of truth)

**Why:** dsh's core is an append-only `SessionEvent` log that survives reload. We split the
same idea across the trajectory JSONL and the DB (`messages` + `agent_events` tables), which
caused reload bugs (history merge ordering, "transcript empty after reload"). One log fixes
correctness and is the substrate for eval (#2) and memory (#5).

**What to change:**
- `backend/src/trajectory.rs` — recorder already appends every `WsMessage` per session; make
  recording **always-on** per session (not opt-in via `trajectory record`).
- `backend/src/daemon/mod.rs` — start a recorder for every session automatically (on
  session create/open), stop on session end (or keep appending; file = the log).
- `backend/src/api/routes.rs` — `/api/sessions/{id}/transcripts` (and trajectory export) reads
  from the session log file when present; DB stays a query index, not the source.
- `dashboard/src/store/index.ts` — `loadHistory` no longer needs the two-store merge (server
  returns one ordered stream from the log).

**Steps:**
1. [x] Auto-record: daemon lazily starts the stable `<session-id>.jsonl` canonical log
      (append mode, flush-per-event so it is readable live) on each session's first hub event.
      (`trajectory.rs` `start_append`/`session_log_path`/`read_session_log`; `daemon/mod.rs`.)
2. [x] History-from-log: `/api/sessions/{id}/transcripts` reads the canonical log when present
      and uses it as the authoritative wire-ordered source, with the DB backfilling older rows.
      (`api/routes.rs` `get_session_transcripts`.)
3. [ ] Frontend: `loadHistory` can drop its two-store timestamp merge once the server stream is
      trusted verbatim (currently harmless — the server data is already correct).
4. [x] Tests: `canonical_log_appends_across_starts` (append across restarts, read-back) in
      `backend/tests/trajectory.rs`; verified live (log populated, endpoint merged).

**Acceptance:** reloading any session in the dashboard reproduces the exact stream the live
view showed; no two-store merge anywhere; trajectory files are always present for live
sessions.

## 2. Eval harness + headless runner (the measurable "how good" answer)

**Why:** dsh ships benchmarks + a Python SDK. We have zero measurement. "Better than dsh"
must be answerable with numbers: pass rate, cost, latency, trajectory diffs.

**What to change:**
- `cli/` — add `agentdeck run -p "<prompt>" --agent claude|opencode|... --json`: headless
  one-shot (create → run → stream to stdout → exit with completion status). dsh's `headless`
  profile equivalent.
- `backend/src/api/` or new `eval/` module — trajectory-diff: run the same prompt across
  backends, compare event sequences, tool calls, completion, tokens.
- New `eval/` dir — golden tests + a benchmark suite (repo-style tasks: "fix the auth bug",
  "add tests for X", "explain this code") with pass/fail + cost + latency.
- Wire the CLI headless mode as the runner (also consumes the JSON-RPC surface from #8).

**Steps:**
1. [x] `agentdeck run -p "<prompt>" --agent claude [--json]` — headless one-shot through the
      real daemon path (create → spawn → poll canonical-log transcripts until
      `agent_completed`) → JSON with reply/completed/tokens/cost/duration. (`cli/src/eval.rs`.)
2. [x] `agentdeck eval -s <suite.json> --agents claude,opencode [--json]` — runs every task
      across every agent and prints a pass/cost/latency/events table; `expect` substring
      drives pass/fail. Sample suite: `eval/suite.json` (4 tasks).
3. [ ] Trajectory diff: compare event-kind sequences between runs (agent A vs B on the same
      task) and report similarity — the raw numbers exist (`events` column); add the diff view.
4. [ ] Grow the suite (10–20 tasks); a CI job (`make eval`) that fails on regression.

**Acceptance:** `make eval` prints a per-agent table and exits non-zero on regression.

## 3. Tool policy engine (single approval surface → guarded execution)

**Why:** dsh has a scoped tool registry with a guarded execution pipeline. We have no tool
layer; tools belong to each CLI. We already emit `tool_started/input/finished` — add policy
over them so the harness governs every tool call from any backend.

**What to change:**
- New `backend/src/policy.rs` — per-tool rules: allow / ask / deny, by tool name + session +
  permission mode; rule source (project `.agentdeck/policy.toml`, session, defaults).
- `backend/src/websocket/handler.rs` + backends — intercept tool intent before execution where
  the transport allows (ACP `tool/start`, Claude permission hook already blocks; API path
  pre-check) and route through the broker (reuses #3 approval surface).
- `dashboard` — tool-audit view: every tool call logged with decision + duration in the
  timeline.

**Steps:**
1. [x] Policy model: `backend/src/policy.rs` — `.agentdeck/policy.toml` rules (tool substring
      match, allow/deny, `"all"`), first match wins, no rule → mode/human. Unit tests.
2. [x] Enforce in the Claude permission path (`permissions::request_user_decision`, rules
      override mode defaults, questions never auto-decided) and ACP `request_permission`
      (auto-responds the JSON-RPC request + `permission_resolved`). Verified live: a project
      denying `Write` auto-denied a real claude Write call ("Denied (project policy)").
3. [ ] Tool-audit UI (filter by tool, decision, backend).

**Acceptance:** a project can forbid/auto-allow a tool across all backends from one file; the
timeline shows the decision per call.

## 4. Multi-CLI orchestration (subagents as harness turns) — headline differentiator

**Why:** dsh is a single runtime; we orchestrate claude + opencode + codex + api + pi already.
Harness-owned subagents (child sessions with trajectory/skills/budget) is something no CLI
harness can do.

**What to change:**
- `backend/src/agents/harness.rs` — spawn a child session as a harness turn (reuse
  `resolve_turn`); parent session tracks children.
- `backend/src/agents/mod.rs` / new `subagents.rs` — budget (tokens/cost cap), result
  collection, cancel propagation.
- `dashboard` — subagent cards per child session (there is already `subagent_started/
  finished` event handling in `events.ts`).

**Steps:**
1. [x] Child-session spawn API: `POST /api/sessions/{parent}/subagents` spawns a child session
      through the same harness path, emits `subagent_started`/`subagent_finished` on the
      parent (frontend already renders the cards), returns reply/tokens/cost/duration.
      Budget: `max_cost_usd` stops the child and marks the run failed. Verified live.
2. [ ] Cancel propagation (parent stop → children stop).
3. [ ] UI: subagent cards link to child session views.

**Acceptance:** "split this task across claude and opencode" runs two harness turns and
returns a merged result with per-agent cost.

## 5. Memory as a product

**Why:** dsh treats the session log as substrate; cross-session memory is a feature we can own.

**What to change:**
- `backend/src/context_assembler.rs` — similar-trajectory few-shot exists; add persistent
  project memory: summarize a completed session → store as a memory entry → inject into future
  turns (respecting the `context_assembled` chip visibility).
- Memory management API (list/delete) + dashboard panel.

**Acceptance:** asking a new session about work done in a past session surfaces the memory chip
and the agent answers from it.

## 6. Capability-driven routing

**Why:** we declare `AgentCapabilities` but still branch per-backend. dsh's "no privileged
core" is about replaceability; capability routing is our cheap version.

**What to change:** `backend/src/agents/harness.rs` `resolve_turn` + handlers — gate features
on capabilities (approvals, questions, file events) instead of `match agent`.

**Acceptance:** a new backend registered with the right capability flags gets approvals and
questions without code changes.

## 7. Sandboxing (filesystem/network policy)

**Why:** dsh ships a sandbox. We have worktrees but no fs/network restriction. Safety story for
remote control.

**What to change:** per-session allow/deny path rules enforced before tool execution (pairs
with #3); worktree isolation hardening.

**Acceptance:** a project can deny the agent access to `~/.ssh` across all backends.

## 8. JSON-RPC/HTTP SDK

**Why:** dsh's Python SDK is a moat; a clean driver API lets CI, evals, and external tools use
us.

**What to change:** a JSON-RPC surface over the daemon (create session → stream events →
resolve approvals). First consumer: `agentdeck run` (#2).

**Acceptance:** a 20-line script drives a session headlessly end-to-end.

---

## Not doing (deliberately)

- Cordis-style plugin composition — `AgentTurn` + config backends + skills registry covers the
  extensibility we need; revisit only for third-party backend plugins.
- Matching dsh's doc volume — one architecture doc, not 10k files.

## Done beyond the numbered list

- **Prompt library** (`backend/src/prompts.rs`): 19 curated instruction sections
  (charter, safety, context-usage, planning, execution, verification, subagent
  role, first-turn, resume, eval, tool-use) composed per role/phase — standing
  set on every turn, first-turn variant on fresh sessions, subagent role on
  harness-owned children, eval set on benchmark runs, and a general
  `instructions` hook on session create for anything custom. Coding work gets
  seven extra sections (code quality, git discipline, problem solving, output
  format, tool economy, multi-agent, context discipline), and generic
  transports (custom OpenAI-compatible providers, custom CLIs, pi) get
  custom-transport guidance appended automatically. Live-verified.

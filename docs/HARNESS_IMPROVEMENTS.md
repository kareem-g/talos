# Harness improvements — executable spec

Status: **in progress** · Priority order reflects impact vs effort. Tick `[x]` as
done. Each item: why / what to change / steps / acceptance.

---

## 1. OpenAI-compatible tool parity

**Why:** the tool loop + executor (Bash/Read/Write/Edit/Glob/Grep/GitStatus/
GitDiff/TodoWrite) and effort/max_tokens wiring only exist on the
Anthropic-compatible path (`call_anthropic_stream`). OpenAI-compatible custom
providers (omnirouter, etc.) still get a text-only turn — "any custom provider"
is not true until this is ported.

**What to change:** `backend/src/agents/api.rs` `call_openai_stream` —
advertise `tools` in OpenAI function-calling format, parse `tool_calls` from
the stream, execute through the same `api_tools::execute_api_tool`, append
`tool` role messages, loop. Also send `reasoning_effort` + `max_tokens` from
pending_config like the anthropic path.

**Steps:**
1. [x] Add `tools` (OpenAI `{type:"function", function:{name,description,parameters}}`
      from `api_tools::tool_definitions`) to the request body.
2. [x] Stream: accumulate `delta.tool_calls` by index (id, name, arguments).
3. [x] After the stream, execute completed tool calls via
      `api_tools::execute_api_tool` and append assistant + `tool` messages.
4. [x] Loop up to `MAX_API_TOOL_ITERATIONS` until no tool calls remain.
5. [x] Honor pending_config `effort` → `reasoning_effort`, `max_tokens`.

**Acceptance:** an OpenAI-compatible provider calls Bash/Read/Write through the
same permission pipeline, with the same tool events and plan support as the
Anthropic path.

## 2. Verification gate (the "harness proves it" step)

**Why:** the plan lifecycle ends at "completed" and the harness trusts the
agent's word that it verified. The high-value difference: after a turn that
changed code, the harness runs the project's tests and broadcasts a real
pass/fail the user can see.

**What to change:**
- New `backend/src/verification.rs`: detect the project's test command
  (`cargo test` / `pnpm test` / `npm test` / `pytest` / `make test`), run it
  with a timeout, broadcast `verification` events.
- `backend/src/daemon/mod.rs` (or the plan tracker): trigger after
  `agent_completed` when the turn had successful file-edit tool calls
  (write/edit) or a completed plan.
- `dashboard`: a `VerificationPart` (kind `verification`) rendered as a small
  card with command + pass/fail + truncated output.

**Steps:**
1. [x] `verification.rs`: detect command, run, cap output, return status.
2. [x] Trigger on code-changing turns; broadcast `verification_started` /
      `verification_finished {status, command, output}`.
3. [x] Frontend reducer + card.
4. [ ] Gate option: `verification_required` config — when on, a failed
      verification marks the turn `failed` instead of `completed`.

**Acceptance:** after a code change, the chat shows "Tests: 12 passed" (or
failed with the failing output) without the user asking.

## 3. Eval depth: trajectory diff + bigger suite + CI gate

**Why:** 4 tasks and a pass/cost/latency table don't prove much. Trajectory
diff (agent A vs B on the same task) plus a 10–20 task suite with a `make eval`
CI gate makes "better than dsh" measurable.

**What to change:** `cli/src/eval.rs` — add `--diff` comparing event-kind
sequences between runs (normalized Levenshtein); `eval/suite.json` grow; CI
step that fails on regression.

## 4. WebFetch / WebSearch tool for custom providers

**Why:** the natural next tool. **Requires a network policy decision first**
(deny-by-default, allowlist of domains) — otherwise it's an exfiltration
vector. Pair with the path-policy pattern (`policy.toml` `[[network]]` rules).

## 5. Unified tool registry

**Why:** every backend owns its tools (claude native, ACP native, api's 9).
A harness-level registry with guarded execution makes policy, telemetry, and
approvals apply uniformly to every tool call from every backend.

## 6. Multi-agent orchestration depth

**Why:** subagents exist but one-level. Finish: "split this task across
agentrouter + claude + opencode and merge", parent→child cancel propagation,
per-child budget already present.

## 7. Memory: auto-save + conventions

**Why:** memory is keyword-ranked and requires a manual save. Add auto-save on
plan completion / explicit "remember this" gesture, a memory-management panel,
and convention entries (project rules the agent should always follow).

## 8. Sandbox isolation

**Why:** path policy is a guardrail. Real isolation (bubblewrap/firejail,
network deny, no `/home` mount) is the credible safety story for remote
control.

## 9. Small UX wins

- Token-budget warnings in the composer.
- Thinking toggle for providers that support reasoning.
- Log rotation / compaction for canonical session files.
- Per-tool allowlist UI (manage "always allow Bash, ask for Write" without
  editing TOML).
- Effort + context-window controls already render via config options — ensure
  they apply on the OpenAI-compatible path too (folded into #1).

# PLAN — AI Event Parts + Orchestration Gateway & Intent Classifier

> **For the next AI agent run.** This is a self-contained execution plan. Read
> §1–§2 before touching anything: they contain the architecture map, exact file
> anchors, and environment gotchas discovered the hard way. Execute phases in
> order; each is independently shippable.

---

## 0. Mission

Turn AgentDeck's right panel and composer from *derived* views into
**event-driven** ones, then add an **Orchestration Gateway + Intent Classifier**
so an incoming user message is analyzed and routed to the right execution
architecture (provider, mode, model, permission, worktree, fan-out).

Deliverables:

1. **Context assembly** — `#` session mentions become structured context, not text.
2. **Real AI event parts** — first-class `task` (subagent) and `progress` events,
   backend-emitted, rendered as parts.
3. **Orchestration Gateway + Intent Classifier** — backend-native intercept of
   `send_prompt`, classify → route → dispatch, with decisions visible in the UI.
4. **Right-panel polish** — remove "This Workspace · N", agent-click → live
   timeline, HUD gains Git/Plan/Goal/Agents quick actions, HUD bg lighter,
   composer `@`/`$`/`#` fixes.

**Non-goals:** no protocol (`PROTOCOL.md`) breaking changes; no orchestration of
PTY providers mid-run; no rewriting the WS reducer model.

---

## 1. Read-me-first: architecture map (verified on this repo)

### Backend — `backend/src/` (Rust, axum + sqlx/sqlite, workspace `agentdeck-backend`)
| Module | Role |
|---|---|
| `api/routes.rs` | HTTP API. **Prompt entry points: `send_prompt(&session.id, &clean_prompt)` at ~line 1647 and ~2108.** These are the gateway intercept sites. |
| `agents/acp.rs` | opencode/ACP adapter. **Line ~316 `"plan" =>` maps ACP `plan` session-updates (with live `entries: pending/in_progress/completed`) to our `plan` event.** Add `task`/`progress` mappings here. |
| `agents/claude_stream.rs` | claude stream-json mapping (`text`, `thought`, `tool_call`, `usage`, `end` aliases normalized). |
| `agent_events.rs`, `transcript.rs` | Event persistence; `event_id` replay cursor. |
| `mcp/{manager,pool}.rs` | Runtime MCP server registry (`/api/mcp`). |
| `worktree/` | Git worktree sandboxing. |
| `websocket/handler.rs` | WS broadcast + replay. `AgentEvent.kind` is an **open string** — new kinds need no protocol change. |
| `config/` | `~/.config/agentdeck/config.toml` (see `[tunnel.tailscale]` for section style). |

There is **no orchestrator module today** — add `backend/src/gateway/`.

### Frontend — `dashboard/src/` (React + vite, zustand)
| File | Role |
|---|---|
| `lib/events.ts` | Event reducer → conversation parts. `normalizeKind` at ~line 72 maps provider aliases. **Add new event cases here.** Unknown kinds are safely ignored. |
| `types/conversation.ts` | `MessagePart` union — add new parts here. |
| `store/index.ts` | zustand; `sendPrompt`; `handleFrame` (unknown frames ignored). |
| `components/desktop/session/RightRail.tsx` | Multi-tab panel. Exposes `RightRailHandle.openTab(id)` via forwardRef (used by SubagentsStrip). |
| `components/desktop/session/rightTabs.ts` | Tab registry (`plan, agents, git-diff, git-files, goal, browser, subsessions`). |
| `components/desktop/session/RightRailViews.tsx` | Views. `AgentsView` currently has: primary card, "Launched subagents", "This workspace · N" (**to remove**), "Activity" timeline. |
| `components/desktop/session/ProgressCard.tsx` | Exports `PlanStepList` + `StatusIcon`; card bg is `bg-hover/90` (lighter than canvas). |
| `components/desktop/session/FloatingProgressMenu.tsx` | The floating HUD over the timeline. **HUD enrichment lands here.** |
| `components/desktop/session/SubagentsStrip.tsx` | Chips above composer; click → `RightRailHandle.openTab('agents')`. |
| `components/desktop/session/workspaceData.ts` | `tasksFromPlanParts` (structured `plan` part → **falls back to `tasksFromEvents`** = real tool/command/file parts — markdown parsing was deliberately REMOVED), `deriveSubagents`, `deriveAgentActivity`, `useTodos`, `useWorkspaceStats`, `useGitBranchSummary`. |
| `components/desktop/session/TasksAndExecution.tsx` | Composer chips: `PermissionChip` (text-only now, main), `SessionModeChip` (opencode build/plan), `InlineOptionChip`. Dedupe rules live in `ComposerControls` (`permission_mode` and live `mode` excluded from inline). |
| `components/Composer.tsx` | `@` files (`loadAt`), `$` skills (`loadSkills`), `#` mentions (`loadMentions`), `parseSegments`/`activeToken`. **Buggy — see Phase 4.** |

### Current behavior (so you don't re-derive it)
- **Plan/todos** = newest structured `plan` part; fallback = the agent's real
  `tool`/`command`/`file` parts (live status). Markdown parsing is gone by design.
- **Subagents** = `deriveSubagents` reads `Agent`-named tools OR any tool whose
  input JSON has `description`+`prompt` (opencode task tools).
- **Neither claude nor opencode/LongCat emits a `plan` event** — they write plans
  as prose. That's why the fallback exists; Phase 2 makes subagents/progress
  first-class instead of derived.

---

## 2. Environment gotchas (learned the hard way)

1. **Daemon:** `agentdeck daemon start` (CLI) spawns the **stale system binary**
   `/usr/local/bin/agentdeck-backend` and it fails with
   `Hostname must end with '.local.'`. Always run the fresh build directly:
   `./target/debug/agentdeck-backend` (listens on :9120). Backend log noise from
   `mdns_sd` ("Interrupted system call") is harmless.
2. **Frontend dev:** `cd dashboard && npm run dev` (:3000, proxies `/api` + `/ws`
   → :9120). Build: `npm run build` (tsc + vite). Tests: `npm test` (vitest).
3. **Pre-existing test failure:** `src/lib/events.test.ts` "approvals > carries
   structured options…" expects lowercase option labels — **unrelated, do not chase.**
4. **Tailwind colors are hex CSS vars** wrapped by a `tone()` helper in
   `tailwind.config.js` that emits `color-mix()` for `/NN` opacity. **Never plug
   `var(--x)` directly into `theme.colors`** — opacity variants silently vanish.
5. **LongCat routes:** opencode `opencode-go/longcat-2.0` (free) **hangs**; use
   `x1openai/lc/LongCat-2.0` (OmniRoute) or claude `lc/LongCat-2.0`.
6. **Test sessions cost tokens.** Use read-only prompts ("do NOT edit files…").
7. Rebuild backend after Rust edits: `cargo build` (workspace), then restart the
   direct binary. `pkill` patterns must not match your own command line.

---

## Phase 1 — Context assembly (`#` mentions → structured context)  *(~0.5 day)*

Goal: `#Session` mentions stop being decorative text and become **real context
the prompt carries**. This is also the prerequisite for the classifier (§Phase 3).

**Backend**
- `api/routes.rs` `send_prompt` path: accept an optional structured payload —
  extend the prompt request body with
  `context?: { sessions?: string[]; files?: string[]; note?: string }`.
- Assemble a context block (read referenced session summaries via
  `transcript.rs`, file snippets via `workspace.rs`) and prepend it to
  `clean_prompt` **or** pass through the provider adapter as a system-ish
  preamble. Keep the raw user text intact for the transcript; persist the
  context refs on the message/event payload (`context_refs`) so the UI can
  render chips.
- Emit the refs on the `user_message` echo so the frontend can render them.

**Frontend**
- `Composer.tsx`: `#` trigger keeps autocomplete, but selection pushes into a
  **structured `contextRefs` list** (chips rendered above the textarea, removable),
  not into the draft text. `onSend(text, contextRefs)` → `store.sendPrompt`.
- `store/index.ts` `sendPrompt` passes refs to the API.
- Render received `context_refs` in the timeline as small chips.

**Accept:** sending with a `#` mention makes the referenced session's summary
appear in the agent's received context (verify via transcript payload), and the
chip list survives Enter/blur.

---

## Phase 2 — Real AI event parts: `task` (subagents) + `progress`  *(~1 day)*

Goal: subagents and progress become **backend-emitted events**, not frontend
derivations. `AgentEvent.kind` is open — only emitters and reducer cases change.

**Backend emitters**
- `agents/acp.rs`: map ACP task/subagent session-updates →
  - `task_started`  `{ task_id, name, kind?, source }`
  - `task_finished` `{ task_id, status: "completed"|"failed", duration_ms }`
  - `progress`      `{ percent?, message?, step? }` (when the agent emits it)
  Mirror the existing `"plan" =>` arm (~line 316) and its test style at the
  bottom of `acp.rs` (`maps_plan_update`).
- `agents/claude_stream.rs`: claude exposes subagents as `Agent` tool calls —
  on `tool_call`/`tool_call_update` where `name == "Agent"`, ALSO emit
  `task_started`/`task_finished` with `name = payload.description` and
  `kind = payload.subagent_type`. (Keep the plain `tool_*` events too.)
- opencode task tools (`description`+`prompt` in input): same dual emit.

**Frontend**
- `types/conversation.ts`:
  ```ts
  export interface SubagentPart { kind:'subagent'; id:string; name:string;
    subagentType?:string; status:'running'|'completed'|'failed';
    durationMs?:number; createdAt:string }
  export interface ProgressPart { kind:'progress'; percent?:number;
    message?:string; step?:string }
  ```
- `lib/events.ts`: reducer cases `task_started`/`task_finished` → **upsert**
  `SubagentPart` by `task_id` (idempotent like approvals); `progress` → upsert
  one `ProgressPart` per turn. Add `normalizeKind` aliases if providers differ.
- `components/chat.tsx` `Part` switch: render `subagent` as a compact row
  (status dot, name, kind, duration) and `progress` as a thin bar.
- `workspaceData.ts`: `deriveSubagents` now **prefers `SubagentPart`s**; keep the
  tool-part fallback for old transcripts. `PlanView`/HUD may read `ProgressPart`.
- Tests: `events.test.ts` reducer cases (upsert, idempotency, failure).

**Accept:** a claude or opencode LongCat run shows subagents from real
`task_*` events (verify event kinds in `/api/sessions/{id}/transcripts`), and
`deriveSubagents` prefers them.

---

## Phase 3 — Orchestration Gateway + Intent Classifier (backend-native)  *(~2–3 days)*

Goal: analyze the incoming user message **before** dispatch and route it to the
right execution architecture. Backend-native intercept = one choke point, works
for every CLI, decisions are visible events.

**New module `backend/src/gateway/`**
- `classifier.rs` — classify(prompt, context) → `IntentDecision`:
  ```json
  { "intent": "code_change | review | question | research | ops | ambiguous",
    "confidence": 0.0-1.0,
    "route": { "agent": "opencode", "model": "…", "mode": "build|plan",
               "permission_mode": "…", "new_session": false, "worktree": null,
               "fanout": [] },
    "reasoning": "short why" }
  ```
  Implementation: **rules-first** (regex/keyword pass, <10 ms, always runs) and
  an **LLM refinement** using a cheap model through the existing provider
  registry (`haiku`-class / `opencode-go/glm-5.3-flash`). Hard budget ~1.5 s;
  on timeout/failure fall back to rules result. Cache by prompt hash.
- `router.rs` — policy table from `config.toml`:
  ```toml
  [gateway]
  enabled = false            # ship off by default
  classifier_model = "…"
  classify_timeout_ms = 1500
  [gateway.routes]           # intent → execution architecture
  code_change = { agent = "claude", mode = "build", permission_mode = "auto_edit" }
  review      = { agent = "opencode", mode = "plan" }
  question    = { agent = "claude", model = "haiku" }
  ```
- `orchestrator.rs` — v1: single route (apply config to the target session via
  existing `sessions/config.rs`, optionally create a session via
  `POST /api/sessions` semantics, optionally pick a worktree). v2 (separate PR):
  `fanout` → N sub-sessions each in its own worktree + a join state machine
  persisted in sqlite.
- `mod.rs` — the intercept called from **both** `send_prompt` sites in
  `api/routes.rs` (~1647, ~2108): classify → apply route → dispatch → emit.
- Emit a **`gateway_decision`** AgentEvent
  `{ intent, confidence, route, reasoning, dry_run }` — the timeline renders it.
- `POST /api/gateway/route` — dry-run classify (no execution) for UI preview.
- Settings UI: toggle + model picker (frontend `Settings` screen reads/writes
  `/api/settings`).

**Frontend**
- `types/conversation.ts`: `GatewayDecisionPart { kind:'gateway_decision'; intent;
  confidence; route: Record<string,unknown>; reasoning?: string }`.
- `lib/events.ts`: case `gateway_decision` → part (idempotent per event_id).
- `components/chat.tsx`: render a slim "Routed → opencode · plan · 0.92" row.
- Agents tab: a "Routing" section listing recent decisions.

**Accept:** with `[gateway] enabled = true`, sending a message produces a
`gateway_decision` event whose route matches the policy table; `enabled = false`
behaves exactly as today. Dry-run endpoint returns JSON without executing.

**Caveats:** PTY providers (codex/chatgpt/cmd) can be routed *to* but not
controlled mid-run; classifier must never block dispatch beyond the timeout;
never send the raw prompt to the classifier log.

---

## Phase 4 — Right-panel / composer polish  *(~0.5–1 day)*

1. **Remove `This workspace · N`** section from `AgentsView`
   (`RightRailViews.tsx`) — sibling switching stays in the Sub-sessions tab.
   Also drop the now-unused `siblingSessions` binding if orphaned.
2. **Agent click → live timeline:** clicking a subagent (strip chip or
   Launched-subagents row) focuses the Agents tab on that agent: new
   `AgentDetailView` rendering the real event timeline **attributed to that
   subagent** (tool/command/file parts between its `task_started`/`task_finished`,
   or from its `SubagentPart` id). Requires Phase 2. Caveat to document in-UI:
   CLIs don't stream a subagent's internal steps — the timeline shows its tool
   lifecycle.
3. **HUD enrichment** (`FloatingProgressMenu.tsx` / `ProgressCard.tsx`): keep the
   Progress header, add a compact action rail:
   `Git tools` (branch · `+N −N` · changed count → `openTab('git-diff')`),
   `Plan X/Y` → `openTab('plan')`, `Goal` → `openTab('goal')`,
   `Agents N` → `openTab('agents')`.
   Wire via a prop `onOpenTab?: (id: RightTabType) => void` passed from
   `RightRail` → `FloatingProgressMenu` (RightRail owns `addTab`).
4. **HUD background:** keep `bg-hover/90` (verified lighter than canvas/surface);
   if contrast is still weak, add a `--hud` token ~`#20202a` and use it.
5. **Composer `@` / `$` fixes** (`Composer.tsx`): reproduce first — suspected
   stale `atListing` when switching paths (drill-in/out), `$` skills list not
   refreshing after daemon skill changes, and menu not closing on outside click
   (blur timeout race at `onBlurCapture`). Fix with: keyed reload on `projectPath`
   change, explicit `open` state machine for the menu, and AbortController on
   in-flight `workspaceApi.dirs` calls.
6. **Permission chip:** keep text-only; if the user reports duplication again,
   assert `permission_mode` and live `mode` each render exactly once in
   `ComposerControls` (dedupe already exists — add a unit test for `ordered`).

---

## Phase 6 — Governance state (LoopX-inspired): durable control plane, backend + frontend  *(~2–3 days)*

Goal: fold the proven state model from [github.com/huangruiteng/loopx]
(Kernel/Capability/Provider; objective · gates · todos · evidence · quota ·
claims/leases · recovery · scheduling · audited safe fallbacks) into our
gateway/orchestrator so long-horizon work survives runs, coordinates peers, and
keeps the human in the loop — **with full UI on both sides of every concept**.
LoopX runs on top of harnesses (incl. ZCode) as a control plane; we borrow its
state model, not its Python layer.

### 6.1 Data model (new sqlite tables)
- `objectives(id, session_id, text, updated_at)` — durable lifetime goal
- `gates(id, session_id, key, title, description, status[open|approved|denied], requires, decided_by, decided_at)`
- `todos(id, session_id, title, status, owner, claim_expires_at, priority, evidence_ids, source)` — **replaces the localStorage-derived todo hack**
- `evidence(id, session_id, kind[diff|test|screenshot|tool|note], ref, summary, created_at)`
- `quota(id, session_id, budget_usd, budget_tokens, budget_seconds, spent_usd, spent_tokens, started_at)`
- `claims(id, todo_id, agent, lease_until)`
- `orchestration_state(session_id, state TEXT json, updated_at)` — recovery checkpoint after every transition

### 6.2 Per-concept implementation (Backend → Frontend)

**Objective — durable lifetime goal**
- BE: `PATCH /api/sessions/{id}/objective`; persisted; gateway seeds it from the classified intent; included in context assembly + classifier prompts.
- FE: **Goal tab becomes editable** (inline textarea → save); objective shows in Goal tab, Plan tab header, and HUD tooltip.

**Gates — concrete user checkpoints (human in the loop)**
- BE: gate registry seeded by policy (high-risk intents auto-open gates: deploy, prod writes, mass edits, publish); orchestrator **blocks** at an open gate; `POST /api/gates/{id}/decide`; every decision audited (`decided_by/at`).
- FE: **gate cards in the timeline** (reuse the approval card component, `kind:'gate'`: title, why, effect of approve/deny, Decide buttons); "Gates" list in the Goal tab (open/approved/denied + who/when); HUD gate indicator (⛔ N open).

**Todos (peer-owned, claims/leases) — durable, not derived**
- BE: real `todos` table; `todo_claim` (lease TTL), `todo_update`, `todo_complete` events; expired leases re-open; ownership visible.
- FE: **Plan tab becomes a board** — owner chip + lease countdown, claim indicator, status; check-off writes to the backend (removes the localStorage override); optional **Kanban projection** (pending/claimed/in-progress/blocked/done) — the board is a projection, the backend is truth.

**Evidence — every outcome carries proof**
- BE: auto-collect evidence (tool outputs, file diffs, test results, browser screenshots) linked to todos/cards; `evidence_added` events.
- FE: evidence chips on todos; click → inline diff (reuse `DiffViewer`) / screenshot / test output; "Evidence" section in the Goal tab + per-todo evidence drawer.

**Quota — steering / budget**
- BE: per-session quota (USD/tokens/time); orchestrator checks `should-run` before each step (LoopX tick semantics: `quota should-run → todo claim → todo update → refresh-state → quota spend-slot`); auto-pause at budget and ask the human.
- FE: **budget meter in the HUD** (spent vs budget, colored); ≥80% banner; spend-slot rows in the timeline.

**Recovery & scheduling — survive runs**
- BE: persist `orchestration_state` after each transition; on resume restore objective/gates/todos/quota and replay missed events (`lastEventId`); scheduler (wakeups / periodic steps, `ScheduleWakeup` semantics).
- FE: resume card lists what was restored ("resumed: 3 todos, 1 open gate, $1.20 spent"); "recovered from interruption" notice; schedule UI (recurring runs) in Settings.

**Claims/leases + typed continuations — peer coordination (no leader)**
- BE: `claims`/`claims` leases on todos; `handoff { from, to, continuation, evidence }` records; peers coordinate via claims, no durable leader.
- FE: **handoff cards in the timeline** (from → to, continuation snippet, evidence links); Agents tab shows who claims what.

**Capabilities — one bounded, verifiable outcome**
- BE: `Capability` trait (Review, IssueFix, Explore, DecisionContext, PeriodicReport, …): input from kernel state, output = verified outcome + evidence; gateway routes intent → capability.
- FE: capability chips in the timeline + Agents tab ("running capability: Review"); result rows with pass/fail + evidence links.

**Safe fallbacks (audited) — nothing silently dead-ends**
- BE: on capability/todo failure, run the configured fallback (revert / notify / safe default) and log it; `fallback_ran` events.
- FE: fallback notices in the timeline ("step failed → reverted (audited)") linking to the audit log.

### 6.3 New events + frontend parts
Events: `objective_updated, gate_opened, gate_decided, todo_claimed, todo_updated, todo_completed, evidence_added, quota_update, handoff, capability_started, capability_completed, fallback_ran`.
Parts (shapes like Appendix A2): `GatePart, EvidencePart, QuotaPart, HandoffPart, CapabilityPart` — each rendered by `components/chat.tsx` `Part` switch + the relevant tab (Gate→timeline+Goal, Evidence→Plan+Goal, Quota→HUD+timeline, Handoff→timeline+Agents, Capability→timeline+Agents).

### 6.4 Acceptance
- A long run that survives a backend restart resumes with objective/gates/todos/quota intact and the UI showing the restored state.
- An open gate blocks the orchestrator; deciding it resumes; the decision is audited and visible in the timeline.
- Todos show owners/claims; an expired lease re-opens the todo; check-off persists server-side (no localStorage).
- Quota pauses the run at budget, with a HUD meter + banner.
- A handoff between two sessions shows a typed continuation + evidence.

---

## Phase 5 — Verification checklist

```bash
# backend
cargo build && cargo test          # acp mappings, gateway unit tests
# frontend
cd dashboard && npm run build && npm test && npm run lint
# run
./target/debug/agentdeck-backend &          # NOT `agentdeck daemon start`
cd dashboard && npm run dev
```

Live matrix (browser at :3000):
- claude `lc/LongCat-2.0` session + opencode `x1openai/lc/LongCat-2.0` session
  (avoid `opencode-go/longcat-2.0` — hangs).
- Verify: `task_*`/`progress`/`gateway_decision` events in
  `/api/sessions/{id}/transcripts`; Plan tab reflects real events; Agents tab has
  no "This workspace" and clicking a subagent opens its timeline; HUD rail opens
  each tab; `#` mention sends `context_refs` and the agent receives the context
  block; `@`/`$` menus behave across path changes; gateway off = byte-identical
  behavior to today.

---

## Execution order, effort, risk

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| 1 Context assembly | BE+FE | 0.5d | low |
| 2 AI event parts | BE+FE | 1d | low (open-kind events) |
| 3 Gateway + classifier | BE (+small FE) | 2–3d | medium (new subsystem) |
| 4 Panel/composer polish | FE | 0.5–1d | low |
| 6 Governance state (LoopX) | BE+FE | 2–3d | medium (state model + tables) |

Do 1 → 2 → 4 → 3 if you want user-visible wins early; do 1 → 2 → 3 → 4 → 6 if
the gateway + governance are the priority. **Phase 6 builds on Phase 3** (it uses
the orchestrator's kernel state); the durable tables land in Phase 6 and the
frontend todos board replaces the localStorage hack at the same time. Ship each
phase separately; `[gateway] enabled` defaults off so Phases 3/6 land dark.

## Non-goals / standing caveats
- No mid-run control for PTY providers; gateway routes sessions, not their internals.
- Subagent *internal* steps are not streamed by CLIs — timelines show task lifecycle.
- Classifier output is advisory; a low-confidence route must degrade to current behavior.
- Never log raw prompts in the classifier.

---

# Appendix A — Exact data shapes

## A1. New `AgentEvent` payloads (backend → WS, snake_case, mirror existing)

```json
// task_started
{ "kind": "task_started",
  "payload": { "task_id": "t_01", "name": "Review uncommitted git diff",
               "kind": "Explore", "source": "acp|claude|opencode" } }

// task_finished
{ "kind": "task_finished",
  "payload": { "task_id": "t_01", "status": "completed",   // or "failed"
               "duration_ms": 81365, "error": null } }

// progress  (only when the agent emits it; optional fields)
{ "kind": "progress",
  "payload": { "percent": 62, "message": "Reading files…", "step": "3/5" } }

// gateway_decision
{ "kind": "gateway_decision",
  "payload": { "intent": "review", "confidence": 0.92,
               "route": { "agent": "opencode", "model": "x1openai/lc/LongCat-2.0",
                          "mode": "plan", "permission_mode": "ask",
                          "new_session": false, "worktree": null, "fanout": [] },
               "reasoning": "message asks to review the diff", "dry_run": false } }
```

Emit via the same helper the `plan`/`tool_*` arms use in `agents/acp.rs` so they
flow through `agent_events` + WS + replay automatically (the `kind` string is
open — no `PROTOCOL.md` change needed).

## A2. New frontend `MessagePart`s (`dashboard/src/types/conversation.ts`)

```ts
export interface SubagentPart {
  kind: 'subagent'
  id: string
  name: string
  subagentType?: string
  status: 'running' | 'completed' | 'failed'
  durationMs?: number
  /** Turn the task belongs to (for attribution in the Agents tab). */
  turnMessageId?: string
  createdAt: string
}

export interface ProgressPart {
  kind: 'progress'
  percent?: number
  message?: string
  step?: string
}

export interface GatewayDecisionPart {
  kind: 'gateway_decision'
  intent: string
  confidence?: number
  route: Record<string, unknown>
  reasoning?: string
}
```

Add all three to the `MessagePart` union (the reducer `Part` switch in
`components/chat.tsx` must handle them; it uses `default:` for unknown kinds, so
only add explicit rows for `subagent` / `progress` / `gateway_decision`).

---

# Appendix B — Reducer code patterns

## B1. `lib/events.ts` — task start/finish (upsert by id, idempotent)

Mirror the `approval` upsert style already in the file:

```ts
case 'task_started': {
  const turn = currentTurn(conversation, event)
  const taskId = str(payload, 'task_id')
  if (!taskId) return false
  // Re-delivered start must not create a second row.
  if (turn.parts.some((p) => p.kind === 'subagent' && p.id === taskId)) return false
  turn.parts.push({
    kind: 'subagent',
    id: taskId,
    name: str(payload, 'name') ?? 'Subagent',
    subagentType: str(payload, 'kind'),
    status: 'running',
    turnMessageId: turn.id,
    createdAt: new Date(event.timestamp ?? Date.now()).toISOString(),
  })
  return true
}

case 'task_finished': {
  const turn = currentTurn(conversation, event)
  const taskId = str(payload, 'task_id')
  if (!taskId) return false
  const part = turn.parts.find((p): p is SubagentPart => p.kind === 'subagent' && p.id === taskId)
  if (part) {
    part.status = str(payload, 'status') === 'failed' ? 'failed' : 'completed'
    part.durationMs = num(payload, 'duration_ms')
  }
  return true
}
```

## B2. `lib/events.ts` — progress (one per turn)

```ts
case 'progress': {
  const turn = currentTurn(conversation, event)
  const existing = turn.parts.find((p): p is ProgressPart => p.kind === 'progress')
  if (existing) {
    if (typeof payload['percent'] === 'number') existing.percent = payload['percent'] as number
    existing.message = str(payload, 'message') ?? existing.message
    existing.step = str(payload, 'step') ?? existing.step
  } else {
    turn.parts.push({ kind: 'progress', percent: num(payload, 'percent'),
      message: str(payload, 'message'), step: str(payload, 'step') })
  }
  return true
}
```

## B3. `lib/events.ts` — gateway decision

```ts
case 'gateway_decision': {
  const turn = currentTurn(conversation, event)
  const route = typeof payload['route'] === 'object' && payload['route'] !== null
    ? (payload['route'] as Record<string, unknown>) : {}
  turn.parts.push({
    kind: 'gateway_decision',
    intent: str(payload, 'intent') ?? 'unknown',
    confidence: num(payload, 'confidence'),
    route,
    reasoning: str(payload, 'reasoning'),
  })
  return true
}
```

---

# Appendix C — Test patterns (copy the existing style)

## C1. Backend (`backend/src/agents/acp.rs` bottom — mirror `maps_plan_update`)

```rust
#[test]
fn maps_task_lifecycle() {
    // Feed a session-update ACP message for a task, assert we emit
    // task_started then task_finished with the right payloads, and that a
    // re-delivered task_started does not emit twice.
}
```

## C2. Frontend (`dashboard/src/lib/events.test.ts` — mirror existing reducer tests)

```ts
it('upserts subagent parts from task_started/task_finished', () => {
  // apply task_started twice (idempotent), then task_finished
  // expect exactly one SubagentPart, status 'completed', durationMs set
})

it('coalesces progress into one part per turn', () => {
  // apply two progress events, expect one ProgressPart with the newest percent
})

it('renders gateway_decision as a part', () => {
  // apply one gateway_decision, expect GatewayDecisionPart with route + intent
})
```

## C3. Gateway classifier fixtures

Golden JSON for the classifier prompt → `IntentDecision` mapping, covering:
`code_change`, `review`, `question`, `research`, `ops`, and an ambiguous case
that must fall back to rules with `confidence < 0.5`.

---

# Appendix D — MCP-gateway alternative (if you prefer not to touch `send_prompt`)

Implement the gateway as an MCP server registered via the existing
`mcp/manager.rs` (`/api/mcp`). The agent calls a `route_intent` tool; the
response is the `IntentDecision` JSON, and the agent applies it itself.

- **Pros:** zero intercept changes; works with claude (MCP) and ACP(opencode) natively; visible to the user as a normal tool call.
- **Cons:** PTY providers can't call it; routing decisions are agent-mediated (the agent must honor them); no automatic enforcement.
- **Where:** new crate module `backend/src/mcp/servers/gateway.rs` following the existing MCP server pattern; register in `mcp/mod.rs`.

Recommended only as a companion to the backend-native intercept (native = the
enforcement layer; MCP = the in-agent assistance layer).

---

# Appendix E — Quick-start runbook for the next agent

1. `git status` — confirm branch `fix/askuserquestion-duplicate-approval` state; read `docs/GATEWAY_AND_AI_EVENTS_PLAN.md` (§1–§2 first).
2. Backend: `cargo build`; run `./target/debug/agentdeck-backend` (NOT `agentdeck daemon start`).
3. Frontend: `cd dashboard && npm run dev`.
4. Config sanity: `~/.config/agentdeck/config.toml` — `[gateway] enabled = false` until Phase 3 is done.
5. Reproduce before fixing: create a claude `lc/LongCat-2.0` session and an opencode `x1openai/lc/LongCat-2.0` session; watch `/api/sessions/{id}/transcripts` event kinds.
6. Phase order 1→2→4→3 if you want visible wins fast; 1→2→3→4 if the gateway is the priority.
7. Keep `npm run build` + `cargo test` green between phases; the only pre-existing failing test is `events.test.ts` approvals (unrelated).

## Final non-negotiables
- No markdown plan parsing — todos come from real events or derived from real tool/command/file parts.
- No direct `var(--x)` in Tailwind `theme.colors` (use `tone()`).
- Gateway ships dark (`enabled = false`) and never blocks dispatch beyond its timeout.
- Never log raw prompts.

---

# Appendix F — Direct-API providers: your own harness, CLIs kept

Optional Phase 6 (parallel to Phases 1–4). Goal: add a provider whose *executor*
is your own harness talking straight to a model HTTP API (OpenAI-compatible,
Anthropic messages, …), while claude/opencode/codex keep running as CLI
executors. The backend only ever sees canonical events, so nothing downstream
changes.

## F1. The seam (verified)

- `backend/src/providers/types.rs` — `Transport` enum: `pty | acp | stream_json`. **Add `Http`** (keep omission → "probe ACP, fall back to PTY").
- `backend/src/providers/registry.rs:43` — `CustomProvider { id, name, executable, args, env, transport: Option<Transport> }`. `env` is explicitly designed to hold API keys (server-side only, never serialized). Register via `config.toml` `[agents] providers = [...]`.
- `backend/src/agents/` — adapters (`acp.rs`, `claude_stream.rs`, `pi_stream.rs`) are all subprocess-shaped. **There is no direct-HTTP adapter yet** — that is the new harness.
- `providers/native.rs` is *not* related to direct APIs (it surfaces models CLIs route to, like `openrouter/…`). Don't confuse the two.

## F2. What to build

1. `Transport::Http` variant (+ serde rename `"http"`).
2. New adapter `backend/src/agents/http_llm.rs` implementing the **same driver trait** as `acp.rs`/`claude_stream.rs` (check `agents/mod.rs` for the trait; mirror its method set: start / send_prompt / send_text / stop / observe).
3. Capability advertisement: `streaming=true, approval=true, plan=true, file_changes=true, terminal=false, reasoning=true` (whatever your harness supports) so routing/UI treat it like any provider.
4. Config:
   ```toml
   [agents]
   providers = [{
     id = "my-openai", name = "My OpenAI Harness",
     executable = "agentdeck-llm-driver",        # or a stub; the harness is in-process
     transport = "http",
     env = { OPENAI_API_KEY = "…", OPENAI_BASE_URL = "https://api.openai.com/v1" }
   }]
   ```
   (The `executable` field stays for CLI-shaped providers; for `Http`, the driver runs in-process — document that in the probe/registry handling.)

## F3. `http_llm.rs` skeleton (build on this)

```rust
//! Direct-to-API harness: the agent loop runs HERE, not in a CLI.
//! Emits the same canonical events as acp.rs so sessions/events/UI are unchanged.

use std::sync::Arc;
use reqwest::Client;

pub struct HttpLlmConfig {
    pub base_url: String,      // e.g. https://api.openai.com/v1
    pub api_key: String,       // from CustomProvider.env, never logged/serialized
    pub model: String,
    pub max_tokens: Option<u32>,
}

/// One in-flight turn. Owns the streaming loop + the tool-call loop.
pub struct HttpLlmDriver {
    client: Client,
    config: HttpLlmConfig,
    // outbound event channel — same pattern as acp.rs reader/writer tasks
    // (session_id → event), so websocket/transcript/UI need zero changes.
    outbound: mpsc::UnboundedSender<AgentEvent>,
}

impl HttpLlmDriver {
    pub async fn start(
        &self,
        session_id: &str,
        prompt: &str,
        config: &SessionConfig,   // mode/permission/model from the gateway
    ) -> Result<()> {
        // 1. Build messages: system preamble (context refs from Phase 1) + user prompt.
        // 2. POST {base}/chat/completions { model, messages, stream: true,
        //    tools: self.tool_schemas(config) }
        // 3. Spawn the streaming loop (see run_turn).
        Ok(())
    }

    async fn run_turn(&self, session_id: &str, messages: Vec<ChatMessage>) -> Result<()> {
        let mut stream = self.client.post(format!("{}/chat/completions", self.config.base_url))
            .bearer_auth(&self.config.api_key)
            .json(&serde_json::json!({ "model": self.config.model,
                "messages": messages, "stream": true,
                "tools": self.tool_schemas() }))
            .send().await?
            .bytes_stream();

        let mut tool_calls: Vec<PartialToolCall> = vec![];
        let mut text_buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            for delta in parse_sse_deltas(&chunk) {           // SSE → chat.completion.chunk
                if let Some(t) = delta.choices[0].delta.content {
                    text_buf.push_str(&t);
                    self.emit_text(session_id, &t);           // → assistant_text
                }
                for tc in delta.choices[0].delta.tool_calls {
                    upsert_tool_call(&mut tool_calls, tc);    // accumulate fragments
                }
                if let Some(u) = delta.usage { self.emit_usage(session_id, u); }
            }
        }

        // Tool-calling loop: execute each completed tool call via the BACKEND's
        // own tools (workspace.rs, git, mcp/manager) — not a CLI's.
        for call in tool_calls {
            let result = self.execute_tool(&call).await;       // read/write file, git, mcp
            if needs_approval(&call) {
                self.emit_approval(session_id, &call).await;   // → approval event (existing UI)
                let decision = self.await_approval(session_id).await?; // user/policy route
                if !decision.allowed { continue }
            }
            messages.push(tool_result_message(&call, &result));
        }
        if !tool_calls.is_empty() { return self.run_turn(session_id, messages).await } // loop
        self.emit_completed(session_id);                        // → agent_completed
        Ok(())
    }

    fn tool_schemas(&self) -> Vec<serde_json::Value> {
        // JSON-schema descriptions of the backend tool surface:
        //   workspace.read(path), workspace.write(path, content),
        //   git.status/diff/commit, mcp.invoke(server, tool, args), …
        // This is YOUR tool contract — different from any CLI's.
        vec![]
    }
}
```

Key mappings (identical shapes to what `acp.rs`/`claude_stream.rs` emit):
- text delta → `assistant_text`
- `tool_calls` → `tool_started`/`tool_input`/`tool_finished` (name + input JSON + result)
- file edits you perform → `file_edited`
- your plan step bookkeeping → `plan` (with `entries` live statuses — this makes
  **your** harness produce real `plan` events, which the Plan tab reads directly)
- consent-gated tools → `approval` (existing permission UI + `permission_mode`)
- usage → `usage`; turn end → `agent_completed` with cost/tokens

## F4. Keeping the CLI stuff

Providers are **additive in the registry** — auto-detected claude/opencode/codex
stay untouched. The gateway (§Phase 3) routes per intent: `{ CLI executor |
your HTTP harness }`. ACP + stream-json CLIs remain fully observable; PTY CLIs
stay fire-and-forget; the HTTP harness is fully observable because *you* write
the loop.

## F5. Caveats / non-negotiables

- You now own the model loop: streaming errors, rate limits, retries, token
  budget, context packing, summarization. That is the "custom harness" work.
- Never log `api_key` or prompts; keys only in `CustomProvider.env`.
- OpenAI-compatible endpoints are the easiest first target; Anthropic messages
  API is a second thin transport in the same adapter.
- Add `Transport::Http` with `#[serde(default)]` semantics so existing configs
  (omitted transport → probe ACP → PTY) are unaffected.
- Test with a **mock SSE server** (fixtures for text/tool/usage chunks) before
  pointing at a real API; mirror the test style at the bottom of `acp.rs`.

## F6. Acceptance

- With a fake OpenAI-compatible endpoint, a session runs a full tool-calling
  turn; events appear in `/api/sessions/{id}/transcripts`; Plan tab shows live
  `plan` entries; an approval-gated tool pauses on the existing permission card;
  claude/opencode sessions still work unchanged alongside.

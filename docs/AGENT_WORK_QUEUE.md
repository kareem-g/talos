# AGENT WORK QUEUE — Autonomous Implementation Runbook

> **For a fresh AI agent session.** This file is the **executable task queue**.
> The full design detail lives in `docs/GATEWAY_AND_AI_EVENTS_PLAN.md` (read it
> once, then work here). Your job: work the tasks **top to bottom without
> stopping for user input**. If you hit an ambiguous decision, pick the safest
> option, note it in your summary, and keep going. Only stop when every task is
> checked and the verification matrix passes.

---

## ⚙️ How to run this document

1. Read `docs/GATEWAY_AND_AI_EVENTS_PLAN.md` (§1 architecture map + §2 gotchas first).
2. Set up the environment (below) and confirm both servers respond.
3. Work tasks **in order**. Tick `[x]` only after that task's acceptance criteria pass (verified, not assumed).
4. After each task: `cargo build`/`cargo test` (backend) or `npm run build`/`npm test` (dashboard), then commit with a clear message on the current branch.
5. **Resume rule:** if this run is interrupted, the next agent reads this file and starts at the first unchecked task. Always update the checkboxes as you go.

---

## 🖥️ Environment (do first, before any task)

```bash
cd /home/kareem/Documents/agentdeck-linux
cargo build                     # rebuild backend (workspace)
./target/debug/agentdeck-backend &   # ← ALWAYS the built binary. NOT `agentdeck daemon start`
                                     #   (CLI spawns the STALE /usr/local/bin/agentdeck-backend → fails)
cd dashboard && npm run dev &       # :3000, proxies /api + /ws → :9120
```

Sanity: `curl -s localhost:9120/api/status` → 200 ; `curl -s localhost:3000/api/status` → 200.

**Gotchas that will waste time if ignored:**
- Backend log noise from `mdns_sd` ("Interrupted system call") is harmless.
- `pkill` patterns must not match your own command line (use `[a]gentdeck-backend` bracket trick or a separate command).
- Model routes: claude `lc/LongCat-2.0` and opencode `x1openai/lc/LongCat-2.0` work; `opencode-go/longcat-2.0` **hangs** — avoid it.
- `events.test.ts` has ONE pre-existing failure (approval labels) — **do not chase it**.
- Tailwind: never put `var(--x)` directly in `theme.colors` (opacity classes vanish). The `tone()` helper already exists — reuse it.
- Test prompts must be non-destructive ("do NOT edit files…"). Sessions cost tokens.

---

## ✅ Task 1 — Context assembly: `#` mentions become structured context

**Goal:** `#Session` mentions attach real context to the prompt instead of inserting decorative text. (Prerequisite for the gateway.)

**Key files:** `backend/src/api/routes.rs` (~1647, ~2108 `send_prompt`), `backend/src/transcript.rs`, `dashboard/src/components/Composer.tsx`, `dashboard/src/store/index.ts` (`sendPrompt`).

**Steps:**
1. Backend: extend the prompt request with `context?: { sessions?: string[]; files?: string[]; note?: string }`.
2. Assemble a context block (referenced session summaries from `transcript.rs`, file snippets from `workspace.rs`) and prepend to `clean_prompt`. Persist `context_refs` on the user-message event so the UI can render chips.
3. Frontend: `Composer.tsx` — `#` autocomplete now pushes into a structured `contextRefs` chip list (rendered above the textarea, removable), NOT into draft text. `onSend(text, contextRefs)`.
4. Render received `context_refs` as small chips in the timeline.

**Acceptance:** sending with a `#` mention puts the referenced session summary in the agent's received context (verify in the transcript payload), chips survive Enter/blur, removal works.

**Status:** [ ] not started · [ ] in progress · [ ] done

---

## ✅ Task 2 — Real AI event parts: `task` (subagents) + `progress`

**Goal:** subagents and progress are backend-emitted events, not frontend derivations. (`AgentEvent.kind` is an open string — emitters + reducer cases only.)

**Key files:** `backend/src/agents/acp.rs` (~line 316 `"plan" =>` arm + tests at bottom), `backend/src/agents/claude_stream.rs`, `dashboard/src/types/conversation.ts`, `dashboard/src/lib/events.ts`.

**Steps:**
1. Backend `acp.rs`: map ACP task/subagent session-updates → `task_started`/`task_finished` `{ task_id, name, kind?, status, duration_ms }`; map `progress` `{ percent?, message?, step? }`. Mirror the `"plan" =>` arm + its test style.
2. `claude_stream.rs`: on `Agent` tool calls, ALSO emit `task_started`/`task_finished` (name = `description`, kind = `subagent_type`). Keep the `tool_*` events too.
3. Frontend: add `SubagentPart` + `ProgressPart` to `types/conversation.ts` (exact shapes in Plan Appendix A2). Add reducer cases in `events.ts` (upsert by `task_id`, idempotent; progress coalesces to one per turn — copy-paste patterns in Plan Appendix B).
4. `workspaceData.deriveSubagents` now **prefers `SubagentPart`s**; keep tool-part fallback for old transcripts.
5. Render `subagent`/`progress` rows in `components/chat.tsx` `Part` switch.

**Acceptance:** a claude + opencode LongCat run shows `task_*`/`progress` events in `/api/sessions/{id}/transcripts`; subagents come from real events; reducer tests pass.

**Status:** [ ] not started · [ ] in progress · [ ] done

---

## ✅ Task 3 — Orchestration Gateway + Intent Classifier (backend-native, ships dark)

**Goal:** analyze each incoming message before dispatch; route to the right execution architecture. `[gateway] enabled` defaults `false` — behavior identical to today when off.

**Key files:** new `backend/src/gateway/{mod,classifier,router,orchestrator}.rs`; intercept both `send_prompt` sites in `api/routes.rs`; `backend/src/config/settings.rs` (`[gateway]`); `dashboard/src/types/conversation.ts` + `events.ts` (`gateway_decision` part).

**Steps:**
1. `classifier.rs`: rules-first (regex/keyword, <10 ms) → `IntentDecision { intent, confidence, route, reasoning }`; optional LLM refinement via an existing cheap model (hard budget ~1.5 s, fallback to rules on timeout/failure). Cache by prompt hash.
2. `router.rs`: policy table from `config.toml [gateway.routes]` (intent → agent/model/mode/permission).
3. `orchestrator.rs`: v1 single route (apply config via `sessions/config.rs`, optionally new session/worktree). v2 fan-out = later task, stub it.
4. `mod.rs`: intercept at both `send_prompt` sites → classify → apply route → dispatch → emit `gateway_decision` event.
5. Frontend: `GatewayDecisionPart` + reducer case + slim "Routed → …" row in the timeline. `POST /api/gateway/route` dry-run endpoint. Settings toggle.
6. Never log raw prompts. Classifier output is advisory — low confidence must degrade to current behavior.

**Acceptance:** with gateway on, a message yields a `gateway_decision` matching the policy; with gateway off, byte-identical behavior to today; dry-run returns JSON without executing.

**Status:** [ ] not started · [ ] in progress · [ ] done

---

## ✅ Task 4 — Right-panel / composer polish

**Goal:** the UI fixes from the queue. All frontend-only.

**Steps (each independently verifiable):**
1. **Remove `This workspace · N`** from `RightRailViews.tsx` `AgentsView` (drop the `siblingSessions` binding if it becomes orphaned; sibling switching stays in the Sub-sessions tab).
2. **Agent click → live timeline:** clicking a subagent (strip chip or Launched row) focuses the Agents tab on that agent via a new `AgentDetailView` — real event timeline attributed to that subagent (tool/command/file between its `task_started`/`task_finished`, from `SubagentPart.id`). Requires Task 2. Document the in-UI caveat: CLIs don't stream a subagent's internal steps.
3. **HUD enrichment:** `FloatingProgressMenu`/`ProgressCard` add a compact action rail — `Git tools` (branch · +N −N → `openTab('git-diff')`), `Plan X/Y` → `openTab('plan')`, `Goal` → `openTab('goal')`, `Agents N` → `openTab('agents')`. Wire `onOpenTab` from `RightRail` (it owns `addTab`).
4. **HUD background:** keep `bg-hover/90`; if contrast is weak add `--hud: #20202a` token and use it.
5. **Composer `@`/`$` fixes** (`Composer.tsx`): reproduce first — suspected stale `atListing` on path change, `$` skills not refreshing, menu not closing on outside click. Fix with: reload on `projectPath` change, explicit menu open state machine, AbortController on in-flight `workspaceApi.dirs`.
6. **Permission chip:** keep text-only; assert `permission_mode` + live `mode` each render once (add a unit test for `ComposerControls.ordered`).

**Acceptance:** all six sub-items verified in the live app; no horizontal overflow at 480px/360px; `npm test` green (except the known `events.test.ts` failure).

**Status:** [ ] not started · [ ] in progress · [ ] done

---

## ✅ Task 5 — Direct-API custom harness (`Transport::Http`)

**Goal:** own the model loop against OpenAI-compatible endpoints; custom providers run through your harness; CLIs stay untouched. (Full detail: Plan Appendix F.)

**Key files:** `backend/src/providers/types.rs` (`Transport` enum), `backend/src/providers/registry.rs`, new `backend/src/agents/http_llm.rs`, `dashboard` UI picker (read models/capabilities from the provider — already generic).

**Steps:**
1. Add `Transport::Http` (serde `"http"`), backward-compatible (omitted → probe ACP → PTY).
2. Write `http_llm.rs`: streaming SSE `chat/completions`, fragment-accumulating tool calls, tool-calling loop executing the **backend's** tools (workspace/git/MCP), approval-gated tools → `approval` events, and emit `plan` (with live entries) + `usage` + `agent_completed`. Skeleton + event mappings in Plan Appendix F3.
3. Capability advertisement per provider (streaming/tools/approval/plan).
4. Config example + registration via `[agents] providers`; keys only in `CustomProvider.env`.
5. Test against a **mock SSE server** first (fixtures for text/tool/usage chunks), mirroring `acp.rs` test style.

**Acceptance:** with a fake OpenAI-compatible endpoint, a full tool-calling turn streams correct events; Plan tab shows live plan entries; an approval-gated tool pauses on the existing permission card; claude/opencode sessions still work unchanged alongside.

**Status:** [ ] not started · [ ] in progress · [ ] done

---

## ✅ Task 6 — Governance state (LoopX-inspired): durable control plane, BE + FE

**Goal:** fold LoopX's proven governance model (objective · gates · todos · evidence · quota · claims/leases · recovery · capability · safe fallbacks) into the gateway/orchestrator. Every concept has both backend tables/events and frontend UI. (Full detail: `docs/GATEWAY_AND_AI_EVENTS_PLAN.md` Phase 6.)

**Key files:** new sqlite migrations in `backend/src/`; `backend/src/gateway/` (kernel state, scheduler, gates, quotas, claims, capabilities, evidence); `dashboard/src/components/desktop/session/RightRailViews.tsx` (Goal tab editable, Plan tab board, Gates, Evidence, Quota HUD); `dashboard/src/lib/events.ts` (new reducer cases); `components/chat.tsx` (render gate/evidence/quota/handoff/capability parts).

**Steps (each sub-item is BE+FE):**
1. **Objective:** BE `PATCH /api/sessions/{id}/objective` + persisted; FE Goal tab editable inline textarea → save; objective in HUD + Plan tab header.
2. **Gates:** BE gate registry + policy (high-risk intents auto-open gates); orchestrator blocks at open gate; `POST /api/gates/{id}/decide`; audited. FE gate cards in timeline (reuse approval card, `kind:'gate'`), "Gates" list in Goal tab, HUD gate indicator (⛔ N open).
3. **Todos (peer-owned, claims/leases):** BE real `todos` table; `todo_claim/update/complete` events; leases expire → re-open. FE Plan tab becomes a board (owner chip, lease countdown, claim indicator, status); check-off writes to backend (removes the localStorage hack); optional Kanban projection.
4. **Evidence:** BE auto-collect (tool outputs, diffs, screenshots, test results) linked to todos; `evidence_added` events. FE evidence chips on todos; click → inline diff/screenshot per todo; "Evidence" section in Goal tab.
5. **Quota:** BE per-session budget (USD/tokens/time); `should-run` check before each step; auto-pause at budget. FE budget meter in HUD (spent vs budget, colored), ≥80% banner, spend-slot rows in timeline.
6. **Recovery & scheduling:** BE persist `orchestration_state` after each transition; on resume restore objective/gates/todos/quota + replay; scheduler (wakeups/periodic). FE resume card shows restored state; "recovered from interruption" notice; schedule UI in Settings.
7. **Claims/leases + typed continuations:** BE `claims` table, `handoff` records; no leader. FE handoff cards in timeline, agents tab shows claims.
8. **Capabilities:** BE `Capability` trait (Review, IssueFix, Explore, …); gateway routes intent → capability. FE capability chips in timeline + Agents tab; result rows with pass/fail + evidence.
9. **Safe fallbacks:** BE on failure run configured fallback (revert, notify, safe default); `fallback_ran` events. FE fallback notices in timeline linking to audit log.

**Acceptance:** a run surviving restart resumes with objective/gates/todos/quota intact (UI shows restored state); a gate blocks the orchestrator and deciding it resumes (audited, visible in timeline); todos show owners/claims/leases and check-off persists server-side; quota pauses at budget with HUD meter + banner.

**Status:** [ ] not started · [ ] in progress · [ ] done

---

## 🧪 Verification matrix (run once at the end)

```bash
cargo build && cargo test          # backend
cd dashboard && npm run build && npm test && npm run lint
./target/debug/agentdeck-backend &  # fresh
cd dashboard && npm run dev &
```

Live matrix (browser at :3000):
- claude `lc/LongCat-2.0` + opencode `x1openai/lc/LongCat-2.0` sessions.
- Confirm: `task_*`/`progress`/`gateway_decision` events in `/api/sessions/{id}/transcripts`; Plan tab = real events; Agents tab has no "This workspace", clicking a subagent opens its timeline; HUD rail opens each tab; `#` sends `context_refs`; `@`/`$` behave across path changes; gateway off = identical to today.
- Record a screenshot of: HUD, Plan tab, Agents tab, composer, gateway row (if enabled).

---

## 🛑 Autonomy rules & end condition

- **Do not stop to ask the user.** Pick the safest option on ambiguity, note it in the final summary, keep going.
- **Never break existing CLI providers** — all changes are additive; verify a claude + opencode session still streams after each task.
- **Gateway ships dark** (`enabled = false`); never log raw prompts or API keys.
- After every task: build + test + commit (message like `feat(gateway): …`, `feat(events): …`).
- **End condition:** all six tasks `[done]` AND the verification matrix passes. Then write a final summary (what shipped, screenshots, any safe-option decisions, remaining follow-ups) and stop. Do not invent further work.

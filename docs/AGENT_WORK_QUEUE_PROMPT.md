# Initial Prompt — Autonomous Agent Run (copy/paste into a new agent session)

> Workspace: `/home/kareem/Documents/agentdeck-linux` (AgentDeck — Rust backend +
> React dashboard for an agentic dev environment).

You are starting an autonomous implementation run for the AgentDeck workspace at
`/home/kareem/Documents/agentdeck-linux`.

## Mission
Execute the runbook at `docs/AGENT_WORK_QUEUE.md` — complete **all six tasks in
order** (context assembly, real AI event parts, orchestration gateway + intent
classifier, panel/composer polish, direct-API custom harness, and the
LoopX-inspired governance state — backend tables **and** frontend UI for every
concept), verify each one live, and finish with a summary. Work **without stopping
to ask the user questions**.

## Procedure
1. **Read first:** `docs/AGENT_WORK_QUEUE.md` (the executable queue) and
   `docs/GATEWAY_AND_AI_EVENTS_PLAN.md` (the reference design — architecture map,
   data shapes, reducer code patterns, appendices). Use the queue to work, the
   plan for detail.
2. **Set up the environment** per the runbook:
   - `cargo build` (rebuild backend), then run `./target/debug/agentdeck-backend`
     — **NOT** `agentdeck daemon start` (that CLI spawns a stale system binary
     and fails with `Hostname must end with '.local.'`).
   - `cd dashboard && npm run dev` (port 3000, proxies `/api` + `/ws` → 9120).
   - Verify `curl -s localhost:9120/api/status` and `curl -s localhost:3000/api/status` return 200.
3. **Work tasks top-to-bottom.** Tick `[x]` in the runbook **only after** the
   task's acceptance criteria pass (verified live, not assumed). Keep the
   checkboxes current so an interrupted run can resume.
4. **Do not stop to ask.** On ambiguity, pick the safest option — all changes are
   additive, the gateway ships dark (`enabled = false`), never break existing CLI
   providers (claude/opencode/codex), never log raw prompts or API keys — note
   the decision in the final summary, and keep going.
5. **After each task:** run `cargo test` / `npm test` / `npm run lint`, then
   commit with a clear message (`feat(gateway): …`, `feat(events): …`, etc.).
6. **Ignore the known pre-existing failure:** `dashboard/src/lib/events.test.ts`
   "approvals" (option-label mismatch) — it is unrelated; do not chase it.
7. **End condition:** all six tasks `[done]` AND the verification matrix passes.
   Then write a final summary (what shipped, screenshots of HUD/Plan/Agents/
   composer, any safe-option decisions, follow-ups) and stop. Do not invent
   further work.

## Hard guardrails
- Changes must stay additive; verify a claude session and an opencode session
  still stream after every task.
- Never log or persist raw prompts or API keys in a way that reaches logs.
- Use `x1openai/lc/LongCat-2.0` or claude `lc/LongCat-2.0` for live tests —
  `opencode-go/longcat-2.0` hangs.
- Test prompts must be non-destructive ("do NOT edit files…").
- Tailwind: never put `var(--x)` directly in `theme.colors` (use the existing
  `tone()` helper).

Start now with **Task 1 — Context assembly**.

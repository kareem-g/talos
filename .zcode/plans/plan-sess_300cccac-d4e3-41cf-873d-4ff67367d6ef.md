## Stage 2 — Unified agent turn harness

### What the exploration found (and how it reshapes the plan)

The approved sketch (`AgentTurn::start_turn(ctx) -> TurnHandle` with per-turn process handles, `TurnContext` carrying model/system_prompt/conversation/tools) doesn't match reality:

- **No backend executes tools** — the agent subprocess/API does; the backend only relays permission decisions. So no tool-result loop to unify.
- **No system prompt, no tool-definition array** exist anywhere in the backend (`api.rs` sends neither to OpenAI/Anthropic).
- **Two real lifecycle shapes**:
  - *On-demand* (api, pi): each prompt = a fresh self-contained turn. `spawn_api_turn`/`spawn_pi_turn` already own the full lifecycle (broadcast Message → Running → stream → Idle).
  - *Resident-process* (acp, claude): spawned once, then `send_prompt(session_id, text)` per turn; the process owns history.
- **The actual duplication** is the dispatch if-chains in `websocket/handler.rs` (`handle_input` lines 294-444, `handle_command` lines 446-630): `if agent=="pi" / is_api_provider / has_active_session(acp) / has_active_session(claude) / pty-fallback`, repeated with slightly different logic for prompt injection and interrupts. This is where a harness earns its keep — one interface so Stage 3 (DeepSeek) and future backends implement a trait instead of editing 5 branches.

So Stage 2 is a **turn-lifecycle harness**: a trait + factory that unifies the per-message and command dispatch, leaving the config-heavy spawn/resume paths (routes.rs) as-is for a later slice.

### 1. New: `backend/src/agents/harness.rs`

```rust
pub struct TurnContext {
    pub session: crate::sessions::Session,
    pub prompt: String,          // raw user prompt (no injection)
}

#[async_trait::async_trait]
pub trait AgentTurn: Send + Sync {
    fn name(&self) -> &'static str;
    /// Whether this backend has a live process for the session id
    /// (api/pi are always "live" — on-demand).
    async fn is_live(&self, state: &AppState, session_id: &str) -> bool;
    /// Run one full turn: broadcast user Message, mark Running, stream
    /// events, mark Idle/completion. Returns when the turn finishes.
    async fn start_turn(&self, state: &AppState, ctx: TurnContext) -> crate::Result<()>;
    /// Interrupt the current turn (default: stop + mark resumable).
    async fn interrupt(&self, state: &AppState, session_id: &str) -> crate::Result<()> { self.stop(state, session_id).await }
    /// Stop and kill the session.
    async fn stop(&self, state: &AppState, session_id: &str) -> crate::Result<()>;
    /// Answer a native approval request (ACP only; no-op default).
    async fn respond_approval(&self, state: &AppState, session_id: &str, request_id: &str, decision: &str) -> crate::Result<()> { Ok(()) }
}
```

Four thin impls (each owns its backend's exact current behavior — no behavior change):

| Impl | `start_turn` does | `is_live` | `stop` |
|------|-------------------|-----------|--------|
| `ApiTurn` | `crate::agents::api::spawn_api_turn(state, session, prompt)` | `api_manager.has_active_session` | no-op (`kill_session` is already `Ok(())`) |
| `PiTurn` | `crate::api::routes::spawn_pi_turn(state, session, prompt)` | true (on-demand) | `pi_stream.kill_session` |
| `AcpTurn` | broadcast Message + StateChange running, then `acp_manager.send_prompt` with `browser_skill_prompt_injection_for(prompt)` prepended | `acp_manager.has_active_session` | `acp_manager.kill_session` |
| `ClaudeTurn` | broadcast Message + StateChange running, then `claude_stream.send_prompt` with injection | `claude_stream.has_active_session` | `claude_stream.kill_session` + `update_status(NeedsResume)` |

Factory:
```rust
/// Classify a session into the backend that owns it. Order matches the
/// current dispatch: pi → api → acp (live) → claude (live) → None (pty/unknown).
pub async fn resolve_turn(state: &AppState, session: &Session) -> Option<Box<dyn AgentTurn>>
```

Plus a pure, testable classifier:
```rust
pub enum TurnKind { OnDemand, Api, Acp, Claude, Pty }
pub fn classify(agent: &str, is_api: bool, acp_live: bool, claude_live: bool) -> TurnKind
```

### 2. `backend/src/agents/mod.rs` — `pub mod harness;`

### 3. Refactor `backend/src/websocket/handler.rs`

**`handle_input` (294-444)**: replace the pi/api/acp/claude branches with:
```rust
let state = Arc::clone(state);
let session = session.clone();
let prompt = clean_data.clone();
if let Some(turn) = crate::agents::harness::resolve_turn(&state, &session).await {
    if !turn.is_live(&state, &session.id).await {
        // broadcast SessionError session_not_running (same as today)
        return;
    }
    tokio::spawn(async move {
        let _ = turn.start_turn(&state, TurnContext { session, prompt }).await;
    });
    return;
}
// unchanged pty fallback: begin_assistant_turn + send_input + Enter
```
The liveness guard (351-365) and the shared Message/StateChange broadcast (367-380) move into the trait impls (`ApiTurn`/`PiTurn` already broadcast internally; `AcpTurn`/`ClaudeTurn` add the broadcast before `send_prompt`, matching today's behavior exactly — including the browser-skill injection which moves into the acp/claude impls).

**`handle_command` (446-630)**:
- `"interrupt"`: resolve_turn → `turn.interrupt(...)`; else pty branch (unchanged `\x03` path).
- `"stop"|"kill"`: resolve_turn → `turn.stop(...)`; else pty kill (unchanged fallback).
- `"approval_response"`: keep the permission-broker path for claude (backend-agnostic, stays in handler), then acp via `turn.respond_approval` when resolve_turn yields AcpTurn; pty fallback unchanged.

### 4. Tests

- Unit: `classify` table test (pi/api/acp/claude/pty + live flags) — pure, no AppState.
- Unit: `resolve_turn` ordering — construct a minimal test `AppState` (config with an api_provider row) and assert pi/api/acp/claude resolve correctly; assert pty/unknown → None.
- Keep existing handler tests green; `cargo test -p agentdeck-backend` full suite.

### 5. Docs

- `docs/trajectory.md` gains a short "Harness" section pointing at `harness.rs`, listing the trait contract and how to add a backend (the Stage 3 DeepSeek path).

### Scope guardrails

- **Not changed**: `routes.rs` spawn/resume dispatchers, ACP's `AcpManager` internals, `claude_stream.rs` internals, the pty path, session status handling. The four impls are thin wrappers — behavior is preserved exactly.
- **Risk**: the handler refactor touches the heart of message routing; mitigated by keeping each impl's logic byte-for-byte equivalent to today's branch, plus the full test suite.

### Verification

- `cargo build -p agentdeck-backend`, `cargo test -p agentdeck-backend` (all green), `cargo clippy` (my new code clean; pre-existing `never_loop` in routes.rs:2325 remains — out of scope, untouched), `cargo fmt` on the files I touch.
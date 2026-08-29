//! Unified agent-turn harness.
//!
//! Every structured-stream backend (api, pi, acp, claude) exposes the same
//! per-turn lifecycle through [`AgentTurn`], so the websocket message and
//! command dispatchers route through one interface instead of per-backend
//! if-chains. Adding a backend (e.g. DeepSeek) means implementing the trait,
//! not editing the dispatch logic.
//!
//! The trait covers the *turn* lifecycle only — broadcasting the user message,
//! marking the session running, streaming events, and marking completion. The
//! config-heavy spawn/resume paths stay in `routes.rs`; this module is about
//! what happens once a session exists.

use crate::Result;
use crate::agent_events::AgentEvent;
use crate::config::AppState;
use crate::sessions::Session;
use crate::websocket::WsMessage;
use crate::websocket::broadcast::BroadcastHub;
use async_trait::async_trait;

/// Everything a turn needs from its caller: the session and the raw user
/// prompt. Backend-specific prompt transformation (e.g. browser-skill
/// injection) is the backend's own concern, applied inside `start_turn`.
pub struct TurnContext {
    pub session: Session,
    /// Raw user prompt, exactly as the user typed it.
    pub prompt: String,
    /// Optional enriched context (environment, skills, similar trajectories)
    /// assembled before the turn. When `None`, no context is injected.
    pub injected_context: Option<String>,
}

impl TurnContext {
    /// The prompt with injected context prepended (if any). Used when
    /// constructing the text that reaches the agent — the raw `prompt` is
    /// reserved for the chat-history broadcast.
    pub fn enriched_prompt(&self) -> String {
        match &self.injected_context {
            Some(ctx) => format!("{ctx}\n\n{}", self.prompt),
            None => self.prompt.clone(),
        }
    }
}

/// A backend that can run an agent turn.
#[async_trait]
pub trait AgentTurn: Send + Sync {
    /// Backend id: "api", "pi", "acp", or "claude".
    fn name(&self) -> &'static str;

    /// Whether this backend has a live session/process for the id. On-demand
    /// backends (api, pi) are always "live" — they handle prompts without a
    /// resident process.
    async fn is_live(&self, state: &AppState, session_id: &str) -> bool;

    /// Run one full turn: broadcast the user message, mark the session
    /// running, stream events, and mark completion. Returns when the turn
    /// finishes (or fails).
    async fn start_turn(&self, state: &AppState, ctx: TurnContext) -> Result<()>;

    /// Interrupt the current turn. Defaults to stopping the session; backends
    /// with a graceful cancel override this (e.g. ACP `session/cancel`).
    async fn interrupt(&self, state: &AppState, session_id: &str) -> Result<()> {
        self.stop(state, session_id).await
    }

    /// Stop and kill the session.
    async fn stop(&self, state: &AppState, session_id: &str) -> Result<()>;

    /// Answer a native approval request (ACP only). No-op for backends whose
    /// approvals flow through the permission broker instead.
    async fn respond_approval(
        &self,
        _state: &AppState,
        _session_id: &str,
        _request_id: &str,
        _decision: &str,
    ) -> Result<()> {
        Ok(())
    }
}

/// Classification of a session into its backend kind, used by the pure
/// `classify` helper and by tests. Mirrors the dispatch order: pi → api →
/// acp → claude → pty/unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnKind {
    OnDemand,
    Api,
    Acp,
    Claude,
    Pty,
}

/// Pure classification, independent of `AppState`. Used by tests and kept
/// separate from [`resolve_turn`] so ordering can be verified cheaply.
pub fn classify(agent: &str, is_api: bool, acp_live: bool, claude_live: bool) -> TurnKind {
    if agent == "pi" {
        TurnKind::OnDemand
    } else if is_api {
        TurnKind::Api
    } else if acp_live {
        TurnKind::Acp
    } else if claude_live {
        TurnKind::Claude
    } else {
        TurnKind::Pty
    }
}

/// Resolve the backend that owns a session, or `None` if it's not a
/// structured-stream backend (PTY path or unknown).
pub async fn resolve_turn(state: &AppState, session: &Session) -> Option<Box<dyn AgentTurn>> {
    if session.agent == "pi" {
        return Some(Box::new(PiTurn));
    }
    if state
        .api_manager
        .is_api_provider(state, &session.agent)
        .await
    {
        return Some(Box::new(ApiTurn));
    }
    if state.acp_manager.has_active_session(&session.id).await {
        return Some(Box::new(AcpTurn));
    }
    if state.claude_stream.has_active_session(&session.id).await {
        return Some(Box::new(ClaudeTurn));
    }
    None
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

pub struct ApiTurn;

#[async_trait]
impl AgentTurn for ApiTurn {
    fn name(&self) -> &'static str {
        "api"
    }

    async fn is_live(&self, state: &AppState, session_id: &str) -> bool {
        state
            .api_manager
            .has_active_session(state, session_id)
            .await
    }

    async fn start_turn(&self, state: &AppState, ctx: TurnContext) -> Result<()> {
        crate::agents::api::spawn_api_turn(state, &ctx.session, &ctx.enriched_prompt())
            .await
            .map_err(crate::AgentDeckError::Unknown)
    }

    async fn stop(&self, _state: &AppState, _session_id: &str) -> Result<()> {
        // API sessions have no resident process to stop.
        Ok(())
    }
}

pub struct PiTurn;

#[async_trait]
impl AgentTurn for PiTurn {
    fn name(&self) -> &'static str {
        "pi"
    }

    async fn is_live(&self, _state: &AppState, _session_id: &str) -> bool {
        // Pi is on-demand: every prompt is its own headless turn.
        true
    }

    async fn start_turn(&self, state: &AppState, ctx: TurnContext) -> Result<()> {
        crate::api::routes::spawn_pi_turn(state, &ctx.session, &ctx.enriched_prompt())
            .await
            .map_err(crate::AgentDeckError::Unknown)
    }

    async fn stop(&self, state: &AppState, session_id: &str) -> Result<()> {
        state.pi_stream.kill_session(session_id).await
    }
}

pub struct AcpTurn;

#[async_trait]
impl AgentTurn for AcpTurn {
    fn name(&self) -> &'static str {
        "acp"
    }

    async fn is_live(&self, state: &AppState, session_id: &str) -> bool {
        state.acp_manager.has_active_session(session_id).await
    }

    async fn start_turn(&self, state: &AppState, ctx: TurnContext) -> Result<()> {
        let session_id = ctx.session.id.clone();
        let prompt = format!(
            "{}{}",
            crate::api::routes::browser_skill_prompt_injection_for(&ctx.prompt).await,
            ctx.enriched_prompt()
        );
        broadcast_user_message(state, &session_id, &ctx.prompt).await;
        state.acp_manager.send_prompt(&session_id, &prompt).await
    }

    async fn interrupt(&self, state: &AppState, session_id: &str) -> Result<()> {
        state.acp_manager.interrupt_session(session_id).await
    }

    async fn stop(&self, state: &AppState, session_id: &str) -> Result<()> {
        state.acp_manager.kill_session(session_id).await
    }

    async fn respond_approval(
        &self,
        state: &AppState,
        session_id: &str,
        request_id: &str,
        decision: &str,
    ) -> Result<()> {
        state
            .acp_manager
            .respond_approval(session_id, request_id, decision)
            .await
            .map(|_| ())
    }
}

pub struct ClaudeTurn;

#[async_trait]
impl AgentTurn for ClaudeTurn {
    fn name(&self) -> &'static str {
        "claude"
    }

    async fn is_live(&self, state: &AppState, session_id: &str) -> bool {
        state.claude_stream.has_active_session(session_id).await
    }

    async fn start_turn(&self, state: &AppState, ctx: TurnContext) -> Result<()> {
        let session_id = ctx.session.id.clone();
        let prompt = format!(
            "{}{}",
            crate::api::routes::browser_skill_prompt_injection_for(&ctx.prompt).await,
            ctx.enriched_prompt()
        );
        broadcast_user_message(state, &session_id, &ctx.prompt).await;
        state.claude_stream.send_prompt(&session_id, &prompt).await
    }

    async fn interrupt(&self, state: &AppState, session_id: &str) -> Result<()> {
        // Claude stream has no graceful interrupt; the process must go. Mark
        // it resumable (not exited) so a follow-up brings it back cleanly.
        state.claude_stream.kill_session(session_id).await?;
        state
            .session_manager
            .update_status(session_id, crate::sessions::SessionStatus::NeedsResume)
            .await?;
        state
            .broadcast
            .broadcast(crate::websocket::WsMessage::StateChange {
                session_id: session_id.to_string(),
                state: "needs_resume".to_string(),
            });
        Ok(())
    }

    async fn stop(&self, state: &AppState, session_id: &str) -> Result<()> {
        state.claude_stream.kill_session(session_id).await
    }
}

/// Broadcast the user's message and mark the session running — the shared
/// front of a resident-process turn. On-demand backends (api, pi) do this
/// inside their own turn functions, so they don't call this.
async fn broadcast_user_message(state: &AppState, session_id: &str, content: &str) {
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::Message {
            message: crate::agent_events::AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: session_id.to_string(),
                role: "user".to_string(),
                content: content.to_string(),
                timestamp: chrono::Utc::now(),
            },
        });
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::StateChange {
            session_id: session_id.to_string(),
            state: "running".to_string(),
        });
}

/// Complete a turn successfully — the shared end of the turn lifecycle.
///
/// Every backend ends a successful turn the same way: an `agent_completed`
/// event followed by an `idle` state change. The daemon's StateChange listener
/// persists the session as idle, so resident-process backends (acp, claude)
/// that finish turns asynchronously in their stream readers must call this
/// from there instead of doing their own completion bookkeeping.
pub fn complete_turn(broadcast: &BroadcastHub, session_id: &str, payload: serde_json::Value) {
    broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "agent_completed",
        payload,
    ));
    broadcast.broadcast(WsMessage::StateChange {
        session_id: session_id.to_string(),
        state: "idle".to_string(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_routes_in_dispatch_order() {
        // pi is on-demand regardless of the live flags.
        assert_eq!(classify("pi", false, false, false), TurnKind::OnDemand);
        // api beats acp/claude (api is on-demand HTTP).
        assert_eq!(classify("deepseek", true, true, true), TurnKind::Api);
        // acp beats claude; claude last; everything else is pty.
        assert_eq!(classify("opencode", false, true, true), TurnKind::Acp);
        assert_eq!(classify("claude", false, false, true), TurnKind::Claude);
        assert_eq!(classify("codex", false, false, false), TurnKind::Pty);
        assert_eq!(classify("unknown", false, false, false), TurnKind::Pty);
    }

    #[test]
    fn complete_turn_broadcasts_completion_then_idle() {
        let hub = BroadcastHub::new();
        let mut rx = hub.subscribe();

        complete_turn(&hub, "s1", serde_json::json!({ "source": "test" }));

        let first = rx.try_recv().unwrap().message;
        match first {
            WsMessage::AgentEvent { event } => {
                assert_eq!(event.session_id, "s1");
                assert_eq!(event.kind, "agent_completed");
                assert_eq!(event.payload["source"], "test");
            }
            other => panic!("expected agent_completed first, got {other:?}"),
        }
        let second = rx.try_recv().unwrap().message;
        match second {
            WsMessage::StateChange { session_id, state } => {
                assert_eq!(session_id, "s1");
                assert_eq!(state, "idle");
            }
            other => panic!("expected idle state change, got {other:?}"),
        }
        // The contract is exactly two messages — nothing else.
        assert!(matches!(rx.try_recv(), Err(tokio::sync::broadcast::error::TryRecvError::Empty)));
    }
}

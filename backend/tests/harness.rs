//! Integration tests for the unified agent-turn harness (`agents/harness.rs`).
//!
//! The pure dispatch ordering (`classify`) has unit tests next to the code.
//! These tests cover the parts that need a real `AppState`:
//!
//! - `TurnContext::enriched_prompt` context injection
//! - `resolve_turn` mapping sessions onto the right backend kind
//! - the resident-process turn lifecycle (broadcast user message → running →
//!   stream → completion/failure), observable on the `BroadcastHub`
//!
//! The ACP/Claude "live session" branches of `resolve_turn` require a real
//! agent subprocess (the session maps are private and only populated by
//! `spawn_session`), so their priority is pinned by the `classify` unit test
//! instead; here we verify the pi, configured-API-provider, and fallback paths
//! plus the broadcast lifecycle that every resident-process turn shares.

use agentdeck_backend::agents::harness::{AcpTurn, AgentTurn, ApiTurn, ClaudeTurn, TurnContext, resolve_turn};
use agentdeck_backend::config::{AppState, Config};
use agentdeck_backend::providers::api::{ApiProvider, ApiTransport};
use agentdeck_backend::sessions::Session;
use agentdeck_backend::sessions::manager::SessionManager;
use agentdeck_backend::websocket::WsMessage;
use agentdeck_backend::websocket::broadcast::BroadcastHub;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

/// In-memory state: migrated SQLite session manager, plus a config that has
/// one registered API provider (`fakeapi`) pointing at a dead local URL so
/// turns resolve a provider and then fail deterministically at the HTTP call.
async fn test_state() -> AppState {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let session_manager = Arc::new(SessionManager::new(pool).await.unwrap());

    let config = Arc::new(tokio::sync::RwLock::new(Config::load().await.unwrap()));
    config
        .write()
        .await
        .settings_mut()
        .agents
        .api_providers
        .push(ApiProvider {
            id: "fakeapi".to_string(),
            name: "Fake API".to_string(),
            api_url: "http://127.0.0.1:1/v1".to_string(),
            api_key: None,
            transport: ApiTransport::OpenAiCompatible,
            models: vec!["fake-model".to_string()],
            default_model: Some("fake-model".to_string()),
            extra_headers: BTreeMap::new(),
            max_output_tokens: None,
        });

    AppState {
        config,
        session_manager,
        pty_manager: Arc::new(agentdeck_backend::pty::manager::PtyManager::new(
            BroadcastHub::new(),
        )),
        acp_manager: Arc::new(agentdeck_backend::agents::acp::AcpManager::new(
            BroadcastHub::new(),
        )),
        claude_stream: Arc::new(
            agentdeck_backend::agents::claude_stream::ClaudeStreamManager::new(BroadcastHub::new()),
        ),
        providers: Arc::new(agentdeck_backend::providers::ProviderRegistry::new()),
        devices: Arc::new(agentdeck_backend::auth::devices::DeviceStore::new(
            sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap(),
        )),
        hook_tokens: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        hook_starts: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        permissions: Arc::new(agentdeck_backend::permissions::PermissionBroker::default()),
        pi_stream: Arc::new(agentdeck_backend::agents::pi_stream::PiStreamManager::new()),
        api_manager: Arc::new(agentdeck_backend::agents::api::ApiManager::new()),
        app_servers: Arc::new(agentdeck_backend::workspace_serve::WorkspaceServers::default()),
        broadcast: BroadcastHub::new(),
        transcript_tails: None,
        browser_manager: Arc::new(agentdeck_backend::browser::manager::BrowserManager::new()),
        trajectories: Arc::new(agentdeck_backend::trajectory::TrajectoryRecorder::new()),
        push: {
            let push_pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::migrate!("./migrations").run(&push_pool).await.unwrap();
            agentdeck_backend::notifications::push::PushService::new(push_pool)
                .await
                .unwrap()
        },
        remote: agentdeck_backend::remote::RemoteManager::headless(),
    }
}

async fn create_session(state: &AppState, id: &str, agent: &str) -> Session {
    state
        .session_manager
        .create_session(id, agent, Some("/tmp"))
        .await
        .unwrap()
}

/// Drain the next `n` broadcasts and panic if anything else arrives within a
/// short window — pins the *exact* event sequence of a turn.
async fn expect_broadcasts(
    rx: &mut tokio::sync::broadcast::Receiver<agentdeck_backend::websocket::broadcast::BroadcastEvent>,
    n: usize,
) -> Vec<WsMessage> {
    let mut messages = Vec::with_capacity(n);
    for _ in 0..n {
        messages.push(rx.recv().await.unwrap().message);
    }
    match tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        Err(_) => {}
        Ok(Ok(event)) => panic!("turn broadcast unexpected extra event: {:?}", event.message),
        Ok(Err(_)) => panic!("broadcast channel closed unexpectedly"),
    }
    messages
}

#[tokio::test]
async fn enriched_prompt_prepends_injected_context() {
    let state = test_state().await;
    let session = create_session(&state, "s-ctx", "claude").await;

    let with_ctx = TurnContext {
        session: session.clone(),
        prompt: "fix the bug".to_string(),
        injected_context: Some("ENV: linux\nSKILLS: tdd".to_string()),
    };
    assert_eq!(
        with_ctx.enriched_prompt(),
        "ENV: linux\nSKILLS: tdd\n\nfix the bug"
    );

    let bare = TurnContext {
        session,
        prompt: "fix the bug".to_string(),
        injected_context: None,
    };
    assert_eq!(bare.enriched_prompt(), "fix the bug");
}

#[tokio::test]
async fn resolve_turn_routes_pi_sessions() {
    let state = test_state().await;
    let session = create_session(&state, "s-pi", "pi").await;

    let turn = resolve_turn(&state, &session).await.expect("pi resolves");
    assert_eq!(turn.name(), "pi");
}

#[tokio::test]
async fn resolve_turn_routes_configured_api_providers() {
    let state = test_state().await;
    let session = create_session(&state, "s-api", "fakeapi").await;

    let turn = resolve_turn(&state, &session).await.expect("api resolves");
    assert_eq!(turn.name(), "api");
}

#[tokio::test]
async fn resolve_turn_falls_back_to_none_for_unstructured_backends() {
    let state = test_state().await;
    let session = create_session(&state, "s-pty", "codex").await;

    // Nothing live, no provider configured for "codex": PTY path, not the harness.
    assert!(resolve_turn(&state, &session).await.is_none());
}

#[tokio::test]
async fn acp_turn_broadcasts_user_message_and_running_before_failing_without_process() {
    let state = test_state().await;
    let session = create_session(&state, "s-acp", "opencode").await;
    let session_id = session.id.clone();
    let mut rx = state.broadcast.subscribe();

    let ctx = TurnContext {
        session,
        prompt: "hello acp".to_string(),
        injected_context: None,
    };
    let result = AcpTurn.start_turn(&state, ctx).await;
    assert!(result.is_err(), "no live ACP process must fail the turn");

    let messages = expect_broadcasts(&mut rx, 2).await;
    match &messages[0] {
        WsMessage::Message { message } => {
            assert_eq!(message.session_id, session_id);
            assert_eq!(message.role, "user");
            assert_eq!(message.content, "hello acp");
        }
        other => panic!("expected user message first, got {other:?}"),
    }
    match &messages[1] {
        WsMessage::StateChange { session_id: sid, state } => {
            assert_eq!(sid, &session_id);
            assert_eq!(state, "running");
        }
        other => panic!("expected running state change, got {other:?}"),
    }
}

#[tokio::test]
async fn claude_turn_broadcasts_user_message_and_running_before_failing_without_process() {
    let state = test_state().await;
    let session = create_session(&state, "s-claude", "claude").await;
    let session_id = session.id.clone();
    let mut rx = state.broadcast.subscribe();

    let ctx = TurnContext {
        session,
        prompt: "hello claude".to_string(),
        injected_context: None,
    };
    let result = ClaudeTurn.start_turn(&state, ctx).await;
    assert!(result.is_err(), "no live Claude process must fail the turn");

    let messages = expect_broadcasts(&mut rx, 2).await;
    match &messages[0] {
        WsMessage::Message { message } => {
            assert_eq!(message.session_id, session_id);
            assert_eq!(message.role, "user");
            assert_eq!(message.content, "hello claude");
        }
        other => panic!("expected user message first, got {other:?}"),
    }
    match &messages[1] {
        WsMessage::StateChange { session_id: sid, state } => {
            assert_eq!(sid, &session_id);
            assert_eq!(state, "running");
        }
        other => panic!("expected running state change, got {other:?}"),
    }
}

#[tokio::test]
async fn api_turn_failure_broadcasts_full_error_lifecycle() {
    let state = test_state().await;
    let session = create_session(&state, "s-api-turn", "fakeapi").await;
    let session_id = session.id.clone();
    let mut rx = state.broadcast.subscribe();

    let ctx = TurnContext {
        session,
        prompt: "hello api".to_string(),
        injected_context: None,
    };
    let result = ApiTurn.start_turn(&state, ctx).await;
    assert!(result.is_err(), "dead API endpoint must fail the turn");

    // user message → running → agent_error → session error → error → update.
    let messages = expect_broadcasts(&mut rx, 6).await;
    match &messages[0] {
        WsMessage::Message { message } => {
            assert_eq!(message.session_id, session_id);
            assert_eq!(message.content, "hello api");
        }
        other => panic!("expected user message first, got {other:?}"),
    }
    match &messages[1] {
        WsMessage::StateChange { session_id: sid, state } => {
            assert_eq!(sid, &session_id);
            assert_eq!(state, "running");
        }
        other => panic!("expected running state change, got {other:?}"),
    }
    match &messages[2] {
        WsMessage::AgentEvent { event } => assert_eq!(event.kind, "agent_error"),
        other => panic!("expected agent_error event, got {other:?}"),
    }
    match &messages[3] {
        WsMessage::SessionError { session_id: sid, code, .. } => {
            assert_eq!(sid, &session_id);
            assert_eq!(code, "api_error");
        }
        other => panic!("expected SessionError, got {other:?}"),
    }
    match &messages[4] {
        WsMessage::StateChange { session_id: sid, state } => {
            assert_eq!(sid, &session_id);
            assert_eq!(state, "error");
        }
        other => panic!("expected error state change, got {other:?}"),
    }
    match &messages[5] {
        WsMessage::SessionUpdate { session } => assert_eq!(session.id, session_id),
        other => panic!("expected SessionUpdate, got {other:?}"),
    }

    // The session must have been flipped to error status in the DB too.
    let status = state
        .session_manager
        .get_session(&session_id)
        .await
        .unwrap()
        .unwrap()
        .status;
    assert!(matches!(
        status,
        agentdeck_backend::sessions::SessionStatus::Error
    ));
}

/// Worker identity is transport-agnostic: context assembly (the single
/// funnel feeding API, ACP, Claude-stream, pi, and PTY-spawn turns) keeps
/// custom instruction sets first, so a worker's name always opens its prompt
/// no matter which backend runs it.
#[tokio::test]
async fn worker_instructions_open_with_identity() {
    let state = test_state().await;
    let session = create_session(&state, "s-worker", "fakeapi").await;
    let instructions = format!(
        "{}\n\n{}",
        agentdeck_backend::prompts::worker_identity_block("Room X", "Nova"),
        agentdeck_backend::prompts::subagent_prompt(),
    );
    let (ctx, _) =
        agentdeck_backend::context_assembler::assemble(&state, &session, "do the thing", Some(&instructions))
            .await
            .unwrap();
    let full = ctx.enriched_prompt();
    assert!(
        full.starts_with("# You are Nova"),
        "identity must open the assembled prompt, got: {}",
        &full[..120.min(full.len())]
    );
}

/// Room channels get lead identity through the same assembly funnel —
/// again independent of transport.
#[tokio::test]
async fn room_channel_turns_carry_lead_identity() {
    let state = test_state().await;
    let session = create_session(&state, "s-channel", "fakeapi").await;
    sqlx::query("INSERT INTO rooms (id, data) VALUES (?1, ?2)")
        .bind("room-t1")
        .bind(serde_json::json!({
            "id": "room-t1",
            "name": "Team T",
            "workers": [{"name": "Nova", "skills": ["tdd"]}],
            "chief": "Nova",
            "sessionId": session.id,
        }).to_string())
        .execute(&state.session_manager.pool())
        .await
        .unwrap();
    let (ctx, _) =
        agentdeck_backend::context_assembler::assemble(&state, &session, "hello team", None)
            .await
            .unwrap();
    let full = ctx.enriched_prompt();
    assert!(full.contains("You lead the AgentDeck Room"), "missing lead framing");
    assert!(full.contains("Nova"), "missing roster worker");
    assert!(full.contains("tdd"), "missing worker skills");
}

#[tokio::test]
async fn custom_provider_sessions_get_transport_guidance() {
    let state = test_state().await;
    // fakeapi is the registered custom OpenAI-compatible provider.
    let session = create_session(&state, "s-generic", "fakeapi").await;

    let (ctx, breakdown) =
        agentdeck_backend::context_assembler::assemble(&state, &session, "fix the bug", None)
            .await
            .unwrap();
    let context = ctx.injected_context.expect("context injected");
    // The generic-transport section is appended for custom providers…
    assert!(context.contains("## Custom transport"), "missing transport guidance");
    // …alongside the coding work sections.
    assert!(context.contains("## Code quality"));
    assert!(context.contains("Lead with the outcome"));
}

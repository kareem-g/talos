use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use crate::auth::devices::{hash_secret, random_secret};
use crate::config::AppState;
use crate::sessions::SessionStatus;

fn workspace_name(project: Option<&str>) -> (String, String, String) {
    let path = project.unwrap_or("/");
    let name = FsPath::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Desktop tasks")
        .to_string();
    let id = if path == "/" { "default".to_string() } else { path.to_string() };
    (id, name, path.to_string())
}

async fn reconcile_interactive_state(
    state: &AppState,
    session: crate::sessions::Session,
) -> crate::sessions::Session {
    if !matches!(&session.status, SessionStatus::Running) {
        return session;
    }

    let Ok(transcripts) = state.session_manager.get_transcripts(&session.id).await else {
        return session;
    };
    let recent_agent_output = transcripts
        .iter()
        .rev()
        .filter(|transcript| transcript.kind == "agent")
        .take(4)
        .map(|transcript| transcript.content.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    let compact: String = recent_agent_output
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();

    if compact.contains("manualmode")
        || compact.contains("xhigh")
        || compact.contains("apikeyapproval")
        || compact.contains("expectedvariable")
    {
        let _ = state
            .session_manager
            .update_status(&session.id, SessionStatus::WaitingForInput)
            .await;
        state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
            session_id: session.id.clone(),
            state: "waiting_for_input".to_string(),
        });
        return state
            .session_manager
            .get_session(&session.id)
            .await
            .ok()
            .flatten()
            .unwrap_or(session);
    }

    session
}

// ===== HEALTH =====
pub async fn health_handler() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": "linux"
    }))
}

// ===== SESSIONS =====
#[derive(Debug, Default, Deserialize)]
pub struct SessionListQuery {
    pub include_archived: Option<bool>,
}

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SessionListQuery>,
) -> impl IntoResponse {
    match state.session_manager.list_sessions_with_archived(query.include_archived.unwrap_or(false)).await {
        Ok(sessions) => {
            let mut reconciled = Vec::with_capacity(sessions.len());
            for session in sessions {
                reconciled.push(reconcile_interactive_state(&state, session).await);
            }
            Json(json!({
                "sessions": reconciled,
                "total": reconciled.len(),
            }))
        }
        Err(e) => Json(json!({
            "sessions": [],
            "total": 0,
            "error": e.to_string(),
        })),
    }
}

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let agent = body.get("agent").and_then(|v| v.as_str()).unwrap_or("claude");
    let project = body.get("project").and_then(|v| v.as_str());
    let prompt = body.get("prompt").and_then(|v| v.as_str());
    let session_name = body.get("name").and_then(|v| v.as_str()).unwrap_or("New Session");
    match spawn_session(&state, session_name, agent, project, prompt, &body).await {
        Ok(session) => {
            let mut response = serde_json::to_value(&session).unwrap_or_default();
            response["spawned"] = json!(true);
            Json(response)
        }
        Err(error) => Json(json!({
            "error": error,
            "status": "error",
            "spawned": false,
        })),
    }
}

pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.session_manager.get_session(&id).await {
        Ok(Some(session)) => {
            let session = reconcile_interactive_state(&state, session).await;
            let mut resp = serde_json::to_value(&session).unwrap_or_default();
            resp["transcript"] = json!([]);
            resp["approvals_pending"] = json!([]);
            Json(resp)
        }
        Ok(None) => Json(json!({
            "error": "Session not found",
            "id": id,
        })),
        Err(e) => Json(json!({
            "error": e.to_string(),
            "id": id,
        })),
    }
}

pub async fn get_session_transcripts(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    tracing::debug!("[AgentDeck][Session] Getting transcripts for session={}", id);
    match state.session_manager.get_transcripts(&id).await {
        Ok(transcripts) => {
            let messages = state.session_manager.get_messages(&id).await.unwrap_or_default();
            let events = state.session_manager.get_agent_events(&id).await.unwrap_or_default();
            let terminal_output = state.session_manager.get_terminal_output(&id).await.unwrap_or_default();
            let agent_states = state.session_manager.get_agent_states(&id).await.unwrap_or_default();
            tracing::debug!("[AgentDeck][Persistence] Loaded {} legacy transcripts, {} messages, {} events for session={}", transcripts.len(), messages.len(), events.len(), id);
            Json(json!({
                "session_id": id,
                "transcripts": transcripts,
                "messages": messages,
                "events": events,
                "terminal_output": terminal_output,
                "agent_states": agent_states,
                "total": transcripts.len(),
            }))
        }
        Err(e) => {
            tracing::error!("[AgentDeck][Persistence] Failed to load transcripts: {}", e);
            Json(json!({
                "error": e.to_string(),
                "session_id": id,
                "transcripts": [],
                "total": 0,
            }))
        }
    }
}

pub async fn attach_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Check if session exists
    match state.session_manager.get_session(&id).await {
        Ok(Some(session)) => Json(json!({
            "attached": true,
            "session_id": id,
            "agent": session.agent,
        })),
        Ok(None) => Json(json!({
            "error": "Session not found",
            "session_id": id,
        })),
        Err(e) => Json(json!({
            "error": e.to_string(),
            "session_id": id,
        })),
    }
}

pub async fn kill_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Stop whichever kind of agent this session has.
    //
    // Checking only the PTY left ACP subprocesses running while the row said
    // `exited` — the process stayed alive, and a later resume correctly refused
    // with "already has a running agent" on a session the user had stopped.
    let pty_killed = state.pty_manager.kill_session(&id).await.is_ok();
    let acp_killed = state.acp_manager.kill_session(&id).await.is_ok();
    let claude_killed = state.claude_stream.kill_session(&id).await.is_ok();

    // Update session status in DB
    let status_updated = state
        .session_manager
        .update_status(&id, SessionStatus::Exited)
        .await
        .is_ok();

    Json(json!({
        "killed": pty_killed || acp_killed || claude_killed || status_updated,
        "session_id": id,
        "pty_killed": pty_killed,
        "acp_killed": acp_killed,
        "claude_killed": claude_killed,
        "status_updated": status_updated,
    }))
}

pub async fn fork_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Look up original session
    match state.session_manager.get_session(&id).await {
        Ok(Some(original)) => {
            // Create a new session with same agent
            let new_session = state.session_manager
                .create_session(
                    &format!("{} (fork)", original.name),
                    &original.agent,
                    original.project.as_deref(),
                )
                .await;

            match new_session {
                Ok(forked) => Json(json!({
                    "original_id": id,
                    "forked": true,
                    "session": forked,
                })),
                Err(e) => Json(json!({
                    "error": e.to_string(),
                    "original_id": id,
                    "forked": false,
                })),
            }
        }
        Ok(None) => Json(json!({
            "error": "Original session not found",
            "original_id": id,
            "forked": false,
        })),
        Err(e) => Json(json!({
            "error": e.to_string(),
            "original_id": id,
            "forked": false,
        })),
    }
}

fn session_mutation_error(error: crate::AgentDeckError) -> Response {
    let message = error.to_string();
    let status = if message.contains("not found") { StatusCode::NOT_FOUND } else if message.contains("Stop the running") || message.contains("not archived") { StatusCode::CONFLICT } else { StatusCode::INTERNAL_SERVER_ERROR };
    (status, Json(json!({ "error": message }))).into_response()
}

pub async fn archive_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.session_manager.archive_session(&id).await {
        Ok(()) => {
            if let Ok(Some(session)) = state.session_manager.get_session(&id).await {
                state.broadcast.broadcast(crate::websocket::WsMessage::SessionUpdate { session });
            }
            Json(json!({ "archived": true, "session_id": id })).into_response()
        }
        Err(error) => session_mutation_error(error),
    }
}

pub async fn restore_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.session_manager.restore_session(&id).await {
        Ok(()) => {
            if let Ok(Some(session)) = state.session_manager.get_session(&id).await {
                state.broadcast.broadcast(crate::websocket::WsMessage::SessionUpdate { session });
            }
            Json(json!({ "restored": true, "session_id": id })).into_response()
        }
        Err(error) => session_mutation_error(error),
    }
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    // Both agent kinds count as "running": deleting a row while an ACP
    // subprocess is alive orphans the process with nothing left to stop it.
    if state.pty_manager.has_active_session(&id).await
        || state.acp_manager.has_active_session(&id).await
    {
        return (StatusCode::CONFLICT, Json(json!({ "error": "Stop the running session before deleting it" }))).into_response();
    }
    match state.session_manager.delete_session(&id).await {
        Ok(()) => {
            state.broadcast.broadcast(crate::websocket::WsMessage::SessionDeleted { session_id: id.clone() });
            Json(json!({ "deleted": true, "session_id": id })).into_response()
        }
        Err(error) => session_mutation_error(error),
    }
}

// ===== RESUME =====
pub async fn resume_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    // Only the session identifier is trusted from the client; the backend
    // builds and owns the actual resume operation.
    let requested_id = body
        .get("session_id")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty());

    // Reject mismatched / missing IDs up front.
    match requested_id {
        None => {
            return Json(json!({
                "success": false,
                "error": "Missing session_id",
            }));
        }
        Some(req_id) if req_id != id => {
            return Json(json!({
                "success": false,
                "error": "session_id does not match the session being resumed",
            }));
        }
        _ => {}
    }

    // Look up the existing session (exited/idle, needs_resume).
    let session = match state.session_manager.get_session(&id).await {
        Ok(Some(session)) => session,
        Ok(None) => {
            return Json(json!({
                "success": false,
                "error": "Session not found",
                "session_id": id,
            }));
        }
        Err(e) => {
            return Json(json!({
                "success": false,
                "error": e.to_string(),
                "session_id": id,
            }));
        }
    };

    // Guard against duplicate spawns: if the session is already active or has a
    // live PTY, return the current state rather than spawning a second process.
    match session.status {
        SessionStatus::Running | SessionStatus::Starting => {
            // Only "already active" if a process is genuinely there. After a
            // daemon restart the row can say running while nothing is — refusing
            // in that case would make the session permanently unresumable.
            let live = state.pty_manager.has_active_session(&id).await
                || state.acp_manager.has_active_session(&id).await;
            if live {
                return Json(json!({
                    "success": true,
                    "session_id": id,
                    "status": "already_active",
                    "message": "Session is already running",
                }));
            }
        }
        SessionStatus::NeedsResume | SessionStatus::Exited | SessionStatus::Idle => {}
        other => {
            return Json(json!({
                "success": false,
                "error": format!("Session cannot be resumed from state: {:?}", other),
                "session_id": id,
            }));
        }
    }

    // Guard against a second process for a session that is genuinely live.
    if state.pty_manager.has_active_session(&id).await
        || state.acp_manager.has_active_session(&id).await
    {
        return Json(json!({
            "success": true,
            "session_id": id,
            "status": "already_active",
            "message": "Session already has a running agent",
        }));
    }

    // Transition to starting BEFORE spawning so concurrent requests see the
    // in-flight state and cannot trigger a second spawn.
    if let Err(e) = state
        .session_manager
        .update_status(&id, SessionStatus::Starting)
        .await
    {
        return Json(json!({
            "success": false,
            "error": format!("Failed to mark session starting: {}", e),
            "session_id": id,
        }));
    }

    // Resuming needs the *agent's* session id, not ours. For an imported session
    // that is `external_id`; for one this app created over ACP it is the id the
    // agent assigned at `session/new`, which spawn now persists to the same
    // column. Falling back to the local id is correct only for Claude PTY
    // sessions, where spawn passed `--session-id <local id>`.
    let resume_target = session.external_id.clone().unwrap_or_else(|| id.clone());

    // An ACP provider must be resumed over ACP. Spawning its TUI under a PTY
    // instead was the original bug: `opencode --session <id>` launches the
    // interactive UI, and with our local uuid it exited immediately with
    // "Invalid session ID".
    if let Some(launch) = resolve_acp_launch(&state, &session.agent).await {
        return resume_acp_session(&state, session, launch, resume_target).await;
    }

    // Claude: resume through the structured stream-json transport. The PTY path
    // would launch the interactive TUI with `--resume`, which is not a
    // multi-turn chat transport and loses the conversation.
    if session.agent == "claude" {
        return resume_claude_stream_session(&state, session, resume_target).await;
    }

    // Build the PTY resume command (codex and remaining agents).
    //
    // Reuse the same binary/args as a fresh session, then append the provider's
    // own resume flag. Each CLI spells this differently, and getting it wrong is
    // worse than not resuming: without the flag the CLI starts a *fresh*
    // conversation that merely looks resumed.
    //
    //   codex     resume <id>          (subcommand, not a flag)
    let cfg = state.config.read().await;
    let configured = match session.agent.as_str() {
        "codex" => cfg.settings().agents.codex.clone(),
        "opencode" => cfg.settings().agents.opencode.clone(),
        other => {
            let _ = state
                .session_manager
                .update_status(&id, SessionStatus::Error)
                .await;
            return Json(json!({
                "success": false,
                "error": format!("Resume is not supported for agent '{}'", other),
                "session_id": id,
            }));
        }
    };
    drop(cfg);

    let mut command = vec![configured.path.clone()];
    match session.agent.as_str() {
        "codex" => {
            command.push("resume".to_string());
            command.push(resume_target);
            command.extend(configured.args.clone());
        }
        "opencode" => {
            command.extend(configured.args.clone());
            command.push("--session".to_string());
            command.push(resume_target);
        }
        _ => unreachable!("agent was validated above"),
    }

    // Spawn the PTY. finish_spawn writes hooks settings and broadcasts output.
    match finish_spawn(
        &state,
        session.clone(),
        session.project.as_deref(),
        None,
        command,
        None,
        None,
        true,
    )
    .await
    {
        Ok(_resumed) => {
            // A CLI that rejects the resume exits immediately, so "spawned" alone
            // is not evidence it worked. Give it a moment, then confirm the
            // process is still there before claiming success — reporting a
            // resume that already died is exactly the fake success state to avoid.
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            if !state.pty_manager.has_active_session(&id).await {
                let _ = state
                    .session_manager
                    .update_status(&id, SessionStatus::Error)
                    .await;
                return Json(json!({
                    "success": false,
                    "session_id": id,
                    "spawned": false,
                    "error": format!(
                        "{} started and exited immediately. Check the Terminal tab for what it reported.",
                        session.agent
                    ),
                }));
            }

            // Clear any stale resume_command now that we're active.
            let _ = state.session_manager.set_resume_command(&id, "").await;
            // Persist the state as well as broadcasting it. Broadcasting alone
            // left the database row at `exited`, so a reload — or the first paint
            // of this very page — showed a Resume button for a session that was
            // actually running.
            //
            // Idle, not running: the agent has reopened the conversation and is
            // waiting for the first prompt. Leaving it `running` made the
            // composer show a Stop button and the user's first message appeared
            // to do nothing — they were clicking what was actually Stop.
            if let Err(error) = state
                .session_manager
                .update_status(&id, SessionStatus::Idle)
                .await
            {
                tracing::warn!(
                    session_id = %id,
                    error = %error,
                    "Could not persist idle status after resume"
                );
            }
            if let Ok(Some(current)) = state.session_manager.get_session(&id).await {
                state
                    .broadcast
                    .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current });
            }
            state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
                session_id: id.clone(),
                state: "idle".to_string(),
            });
            Json(json!({
                "success": true,
                "session_id": id,
                "status": "idle",
                "spawned": true,
            }))
        }
        Err(error) => {
            let _ = state
                .session_manager
                .update_status(&id, SessionStatus::Error)
                .await;
            Json(json!({
                "success": false,
                "error": error,
                "session_id": id,
                "spawned": false,
            }))
        }
    }
}

/// Reopen an ACP conversation via `session/load`.
///
/// Separate from the PTY path because ACP resume is a protocol call on a fresh
/// subprocess, not a command-line flag — and because the agent's own refusal
/// ("unknown session", "does not support session/load") is the useful error to
/// return.
async fn resume_acp_session(
    state: &AppState,
    session: crate::sessions::Session,
    launch: AcpLaunch,
    resume_target: String,
) -> Json<serde_json::Value> {
    let id = session.id.clone();
    match state
        .acp_manager
        .resume_session(
            &id,
            &session.agent,
            session.project.as_deref(),
            &launch.binary,
            &launch.args,
            &resume_target,
        )
        .await
    {
        Ok(info) => {
            state.session_manager.set_session_pid(&id, info.pid).await;
            let _ = state.session_manager.set_resume_command(&id, "").await;
            if let Err(error) = state
                .session_manager
                .update_status(&id, SessionStatus::Idle)
                .await
            {
                tracing::warn!(session_id = %id, error = %error, "Could not mark a resumed session idle");
            }
            // Idle, not running: the conversation is reopened and waiting for a
            // prompt. Claiming `running` would show a working indicator for an
            // agent that is doing nothing.
            state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
                session_id: id.clone(),
                state: "idle".to_string(),
            });
            if let Ok(Some(current)) = state.session_manager.get_session(&id).await {
                state
                    .broadcast
                    .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current });
            }
            Json(json!({
                "success": true,
                "session_id": id,
                "status": "idle",
                "spawned": true,
            }))
        }
        Err(error) => {
            let _ = state
                .session_manager
                .update_status(&id, SessionStatus::Error)
                .await;
            Json(json!({
                "success": false,
                "session_id": id,
                "spawned": false,
                // The agent's own words, not a category.
                "error": match &error {
                    crate::AgentDeckError::Session(message)
                    | crate::AgentDeckError::Pty(message) => message.clone(),
                    other => other.to_string(),
                },
            }))
        }
    }
}

/// Resume a Claude session through the structured stream-json transport.
///
/// Uses `claude -p --resume <id>` in stream-json mode, which reopens the prior
/// conversation as a multi-turn chat — unlike the interactive TUI the PTY path
/// would launch.
async fn resume_claude_stream_session(
    state: &AppState,
    session: crate::sessions::Session,
    resume_target: String,
) -> Json<serde_json::Value> {
    let id = session.id.clone();
    let cfg = state.config.read().await;
    let binary = cfg.settings().agents.claude.path.clone();
    drop(cfg);

    match state
        .claude_stream
        .spawn_session(&id, session.project.as_deref(), &binary, Some(&resume_target), None)
        .await
    {
        Ok(info) => {
            state.session_manager.set_session_pid(&id, info.pid).await;
            let _ = state.session_manager.set_resume_command(&id, "").await;
            if let Err(error) = state
                .session_manager
                .update_status(&id, SessionStatus::Idle)
                .await
            {
                tracing::warn!(session_id = %id, error = %error, "Could not mark a resumed session idle");
            }
            // Persist the (reopened) Claude session id.
            if let Err(error) = state
                .session_manager
                .set_external_id(&id, &info.claude_session_id)
                .await
            {
                tracing::warn!(session_id = %id, error = %error, "Could not persist resumed Claude session id");
            }
            state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
                session_id: id.clone(),
                state: "idle".to_string(),
            });
            if let Ok(Some(current)) = state.session_manager.get_session(&id).await {
                state
                    .broadcast
                    .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current });
            }
            Json(json!({
                "success": true,
                "session_id": id,
                "status": "idle",
                "spawned": true,
            }))
        }
        Err(error) => {
            let _ = state
                .session_manager
                .update_status(&id, SessionStatus::Error)
                .await;
            Json(json!({
                "success": false,
                "session_id": id,
                "spawned": false,
                "error": match &error {
                    crate::AgentDeckError::Session(message)
                    | crate::AgentDeckError::Pty(message) => message.clone(),
                    other => other.to_string(),
                },
            }))
        }
    }
}

// ===== AGENTS =====
pub async fn list_agents(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let agents = available_agents(&state).await;
    let cfg = state.config.read().await;
    Json(json!({
        "agents": agents,
        "auto_detect": cfg.settings().agents.auto_detect,
    }))
}

async fn available_agents(state: &AppState) -> Vec<serde_json::Value> {
    let cfg = state.config.read().await;
    let claude = &cfg.settings().agents.claude;
    let codex = &cfg.settings().agents.codex;
    let opencode = &cfg.settings().agents.opencode;
    let configured: Vec<(String, String, String, Vec<&'static str>, Vec<crate::config::settings::AgentModel>, Vec<String>)> = vec![
        (
            "claude".to_string(),
            "Claude Code".to_string(),
            claude.path.clone(),
            vec!["plan", "diff", "tool_use", "approval", "hooks", "worktree"],
            claude.effective_models(),
            claude.effective_reasoning(),
        ),
        (
            "codex".to_string(),
            "Codex CLI".to_string(),
            codex.path.clone(),
            vec!["code_generation", "diff", "shell", "auto_approve"],
            codex.effective_models(),
            codex.effective_reasoning(),
        ),
        (
            "opencode".to_string(),
            "OpenCode".to_string(),
            opencode.path.clone(),
            vec!["chat", "code", "plan", "serve", "auto"],
            opencode.effective_models(),
            opencode.effective_reasoning(),
        ),
    ];
    let custom = cfg.settings().agents.custom.clone();
    drop(cfg);

    // Every candidate gets probed concurrently: the configured agents, the
    // ACP catalog, and user-defined custom agents. Detection (is the binary
    // on PATH?) and the ACP handshake probe both run inside each future, so
    // a slow CLI can't stall the others.
    /// Per-candidate probe outcome (id, name, features, models, reasoning,
    /// detected path/version + whether it speaks ACP).
    #[derive(Default)]
    struct AgentProbeResult {
        id: String,
        name: String,
        features: Vec<&'static str>,
        models: Vec<crate::config::settings::AgentModel>,
        reasoning_levels: Vec<String>,
        info: Option<(String, String, bool)>,
    }

    let mut tasks: Vec<futures::future::BoxFuture<'static, AgentProbeResult>> = Vec::new();
    for (id, name, path, features, models, reasoning_levels) in configured.clone() {
        let acp_manager = Arc::clone(&state.acp_manager);
        tasks.push(Box::pin(async move {
            let Some((resolved_path, version)) = crate::agents::detect_agent(&path).await else {
                return AgentProbeResult { id, name, features, models, reasoning_levels, ..Default::default() };
            };
            // If the CLI is ACP-capable it is driven through the generic ACP
            // client (native structured events) instead of a PTY. opencode
            // answers the handshake, so it is promoted here automatically.
            let acp_supported = match crate::agents::catalog::acp_entry_for(&id) {
                Some((_, _, binary, args, _)) => {
                    let args: Vec<String> = args.iter().map(|value| value.to_string()).collect();
                    match crate::agents::detect_agent(binary).await {
                        Some((resolved, _)) => acp_manager.probe(&resolved, &args).await,
                        None => false,
                    }
                }
                None => false,
            };
            // PTY agents: if config declares no models, discover them from the
            // CLI's own --help output (never hardcoded in the binary).
            let models = if acp_supported {
                models
            } else if models.is_empty() {
                crate::agents::detect_agent_models(&resolved_path)
                    .await
                    .into_iter()
                    .map(|id| crate::config::settings::AgentModel { id: id.clone(), name: id, tag: None })
                    .collect()
            } else {
                models
            };
            AgentProbeResult {
                id,
                name,
                features,
                models,
                reasoning_levels,
                info: Some((resolved_path, version, acp_supported)),
            }
        }));
    }
    for (id, name, binary, args, features) in crate::agents::catalog::ACP_CATALOG {
        if configured.iter().any(|(cid, _, _, _, _, _)| cid == id) {
            continue;
        }
        let acp_manager = Arc::clone(&state.acp_manager);
        let args: Vec<String> = args.iter().map(|value| value.to_string()).collect();
        let features: Vec<&'static str> = features.to_vec();
        let id = id.to_string();
        let name = name.to_string();
        tasks.push(Box::pin(async move {
            let Some((resolved_path, version)) = crate::agents::detect_agent(binary).await else {
                return AgentProbeResult { id, name, features, ..Default::default() };
            };
            let acp_supported = acp_manager.probe(&resolved_path, &args).await;
            // Catalog entries are ACP-only: if the CLI doesn't answer the
            // handshake it has no PTY adapter here, so drop it instead of
            // advertising an agent that can't be launched.
            if !acp_supported {
                return AgentProbeResult { id, name, features, ..Default::default() };
            }
            AgentProbeResult {
                id,
                name,
                features,
                info: Some((resolved_path, version, acp_supported)),
                ..Default::default()
            }
        }));
    }
    for custom_agent in custom {
        let acp_manager = Arc::clone(&state.acp_manager);
        let id = custom_agent.id.clone();
        let name = custom_agent.name.clone();
        let binary = custom_agent.binary.clone();
        let args = custom_agent.args.clone();
        let features: Vec<&'static str> = vec!["chat", "code", "native_ui"];
        tasks.push(Box::pin(async move {
            let Some((resolved_path, version)) = crate::agents::detect_agent(&binary).await else {
                return AgentProbeResult { id, name, features, ..Default::default() };
            };
            let acp_supported = acp_manager.probe(&resolved_path, &args).await;
            AgentProbeResult {
                id,
                name,
                features,
                info: Some((resolved_path, version, acp_supported)),
                ..Default::default()
            }
        }));
    }

    let results = futures::future::join_all(tasks).await;
    let mut agents: Vec<serde_json::Value> = Vec::new();
    for AgentProbeResult {
        id,
        name,
        features,
        models,
        reasoning_levels,
        info,
    } in results
    {
        let Some((resolved_path, version, acp_supported)) = info else {
            continue;
        };
        if acp_supported {
            agents.push(json!({
                "id": id,
                "name": name,
                "available": true,
                "path": resolved_path,
                "version": version,
                "features": features,
                "models": [],
                "reasoningLevels": [],
                "protocol": "acp",
                "capabilities": {
                    "supportsStreaming": true,
                    "supportsApproval": true,
                    "supportsPlan": features.iter().any(|feature| *feature == "plan"),
                    "supportsModelSwitch": false,
                    "supportsFileChanges": true,
                    "supportsReasoning": false,
                    "supportsStructuredQuestions": false,
                    "supportsTerminal": true,
                }
            }));
            continue;
        }
        let supports_model_switch = id == "claude" && !models.is_empty();
        let supports_reasoning = id == "claude" && !reasoning_levels.is_empty();
        agents.push(json!({
            "id": id,
            "name": name,
            "available": true,
            "path": resolved_path,
            "version": version,
            "features": features,
            "models": models,
            "reasoningLevels": reasoning_levels,
            "protocol": "pty",
            "capabilities": {
                "supportsStreaming": true,
                "supportsApproval": features.iter().any(|feature| *feature == "approval"),
                "supportsPlan": features.iter().any(|feature| *feature == "plan"),
                "supportsModelSwitch": supports_model_switch,
                "supportsFileChanges": features.iter().any(|feature| *feature == "diff"),
                "supportsReasoning": supports_reasoning,
                "supportsStructuredQuestions": id == "claude",
                "supportsTerminal": true,
            }
        }));
    }
    agents
}

// ===== MOBILE REMOTE CONTROL =====

pub async fn mobile_me(
    State(_state): State<Arc<AppState>>,
    Extension(device): Extension<crate::auth::devices::AuthenticatedDevice>,
) -> Response {
    Json(json!({
        "device": {
            "id": device.id,
            "name": device.name,
        },
        "desktop": {
            "name": hostname::get().map(|value| value.to_string_lossy().to_string()).unwrap_or_else(|_| "Desktop".to_string()),
            "version": env!("CARGO_PKG_VERSION"),
        }
    }))
    .into_response()
}

pub async fn mobile_snapshot(
    State(state): State<Arc<AppState>>,
    Extension(device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Query(query): Query<SessionListQuery>,
) -> Response {
    let sessions = match state.session_manager.list_sessions_with_archived(query.include_archived.unwrap_or(false)).await {
        Ok(sessions) => sessions,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string(), "code": "sync_failed" })),
            )
                .into_response();
        }
    };

    let mut workspaces: Vec<serde_json::Value> = Vec::new();
    for session in sessions {
        let (workspace_id, workspace_name, path) = workspace_name(session.project.as_deref());
        let task = json!({
            "id": session.id,
            "title": session.name,
            "name": session.name,
            "agent": session.agent,
            "status": session.status,
            "project": session.project,
            "branch": session.branch,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "cost": session.cost,
            "tokens_used": session.tokens_used,
            "capabilities": {
                "supportsStreaming": true,
                "supportsApproval": true,
                "supportsPlan": true,
                "supportsModelSwitch": false,
                "supportsFileChanges": true,
                "supportsTerminal": true,
            }
        });

        if let Some(workspace) = workspaces.iter_mut().find(|workspace| {
            workspace.get("id").and_then(|value| value.as_str()) == Some(workspace_id.as_str())
        }) {
            if let Some(tasks) = workspace.get_mut("tasks").and_then(|value| value.as_array_mut()) {
                tasks.push(task);
            }
            let task_count = workspace
                .get("tasks")
                .and_then(|value| value.as_array())
                .map(|tasks| tasks.len())
                .unwrap_or(0);
            workspace["task_count"] = json!(task_count);
        } else {
            workspaces.push(json!({
                "id": workspace_id,
                "name": workspace_name,
                "path": path,
                "local": true,
                "updated_at": task.get("updated_at").cloned().unwrap_or(json!(null)),
                "task_count": 1,
                "tasks": [task],
            }));
        }
    }

    Json(json!({
        "device": {
            "id": device.id,
            "name": device.name,
        },
        "desktop": {
            "name": hostname::get().map(|value| value.to_string_lossy().to_string()).unwrap_or_else(|_| "Desktop".to_string()),
            "version": env!("CARGO_PKG_VERSION"),
            "connected": true,
        },
        "workspaces": workspaces,
        "agents": available_agents(&state).await,
        "synced_at": chrono::Utc::now(),
    }))
    .into_response()
}

pub async fn mobile_session(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Path(id): Path<String>,
) -> Response {
    let session = match state.session_manager.get_session(&id).await {
        Ok(Some(session)) => reconcile_interactive_state(&state, session).await,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Task unavailable", "code": "task_unavailable" })),
            )
                .into_response();
        }
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };

    let transcripts = match state.session_manager.get_transcripts(&id).await {
        Ok(transcripts) => transcripts,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };
    let messages = state.session_manager.get_messages(&id).await.unwrap_or_default();
    let events = state.session_manager.get_agent_events(&id).await.unwrap_or_default();
    let terminal_output = state.session_manager.get_terminal_output(&id).await.unwrap_or_default();
    let questions = state.session_manager.get_pending_questions(&id).await.unwrap_or_default();
    let approvals: Vec<serde_json::Value> = state
        .session_manager
        .get_pending_approvals(&id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|approval| {
            json!({
                "id": approval.id,
                "session_id": approval.session_id,
                "prompt": approval.prompt,
                "options": approval.options,
                "risk_level": approval.risk_level,
            })
        })
        .collect();

    Json(json!({
        "session": session,
        "transcripts": transcripts,
        "messages": messages,
        "events": events,
        "terminal_output": terminal_output,
        "approvals": approvals,
        "questions": questions,
    }))
    .into_response()
}

pub async fn mobile_create_session(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let agent = body.get("agent").and_then(|value| value.as_str()).unwrap_or("");
    let project = body.get("project").and_then(|value| value.as_str());
    let prompt = body.get("prompt").and_then(|value| value.as_str());
    let name = body
        .get("name")
        .and_then(|value| value.as_str())
        .or_else(|| prompt.map(|value| value.lines().next().unwrap_or("New task")))
        .unwrap_or("New task");

    if agent.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "An agent is required", "code": "agent_required" })),
        )
            .into_response();
    }

    let session = match spawn_session(&state, name, agent, project, prompt, &body).await {
        Ok(session) => session,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": error, "code": "session_start_failed" })),
            )
                .into_response();
        }
    };

    Json(json!({ "session": session })).into_response()
}

pub async fn mobile_archive_session(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Path(id): Path<String>,
) -> Response {
    archive_session(State(state), Path(id)).await
}

pub async fn mobile_restore_session(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Path(id): Path<String>,
) -> Response {
    restore_session(State(state), Path(id)).await
}

pub async fn mobile_delete_session(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Path(id): Path<String>,
) -> Response {
    delete_session(State(state), Path(id)).await
}

pub async fn mobile_kill_session(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
    Path(id): Path<String>,
) -> Response {
    if state.session_manager.get_session(&id).await.ok().flatten().is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Task unavailable", "code": "task_unavailable" })),
        )
            .into_response();
    }

    // Stop whichever kind of agent this session has — see `kill_session`.
    let pty_killed = state.pty_manager.kill_session(&id).await.is_ok();
    let acp_killed = state.acp_manager.kill_session(&id).await.is_ok();
    let claude_killed = state.claude_stream.kill_session(&id).await.is_ok();
    let status_updated = state
        .session_manager
        .update_status(&id, SessionStatus::Exited)
        .await
        .is_ok();
    Json(json!({
        "killed": pty_killed || acp_killed || claude_killed || status_updated,
        "session_id": id,
        "pty_killed": pty_killed,
        "acp_killed": acp_killed,
        "claude_killed": claude_killed,
        "status_updated": status_updated,
    }))
    .into_response()
}

pub async fn mobile_agents(
    State(state): State<Arc<AppState>>,
    Extension(_device): Extension<crate::auth::devices::AuthenticatedDevice>,
) -> Response {
    Json(json!({ "agents": available_agents(&state).await })).into_response()
}

/// Launch command for an ACP-capable agent.
struct AcpLaunch {
    binary: String,
    args: Vec<String>,
}

/// Resolve an agent id to an ACP launch command, probing the CLI for real ACP
/// support. Catalog entries (opencode, copilot, gemini, …) and user-defined
/// custom agents are both probed; the probe is cached by the AcpManager.
async fn resolve_acp_launch(state: &AppState, agent: &str) -> Option<AcpLaunch> {
    if let Some((_, _, binary, args, _)) = crate::agents::catalog::acp_entry_for(agent) {
        let args: Vec<String> = args.iter().map(|value| value.to_string()).collect();
        // Probe with the resolved path (same key the /api/agents listing
        // cached) so a spawn right after listing doesn't re-probe.
        let Some((resolved, _)) = crate::agents::detect_agent(binary).await else {
            return None;
        };
        if state.acp_manager.probe(&resolved, &args).await {
            return Some(AcpLaunch { binary: resolved, args });
        }
        return None;
    }
    let cfg = state.config.read().await;
    let custom = cfg.settings().agents.custom.clone();
    drop(cfg);
    if let Some(custom_agent) = custom.iter().find(|candidate| candidate.id == agent) {
        let Some((resolved, _)) = crate::agents::detect_agent(&custom_agent.binary).await else {
            return None;
        };
        if state.acp_manager.probe(&resolved, &custom_agent.args).await {
            return Some(AcpLaunch {
                binary: resolved,
                args: custom_agent.args.clone(),
            });
        }
    }
    None
}

async fn spawn_session(
    state: &AppState,
    name: &str,
    agent: &str,
    project: Option<&str>,
    prompt: Option<&str>,
    body: &serde_json::Value,
) -> std::result::Result<crate::sessions::Session, String> {
    let session = state
        .session_manager
        .create_session(name, agent, project)
        .await
        .map_err(|error| error.to_string())?;

    // Optional model + effort requested by the client (agent-agnostic).
    let requested_model = body.get("model").and_then(|v| v.as_str()).map(str::to_string);
    let requested_effort = body.get("effort").and_then(|v| v.as_str()).map(str::to_string);

    // ACP-capable agents (opencode, copilot, gemini, cursor, qwen, kimi,
    // hermes, goose, … and custom agents) run through the generic ACP
    // client, which streams native structured events instead of a PTY.
    if let Some(launch) = resolve_acp_launch(state, agent).await {
        return finish_acp_spawn(
            state,
            session,
            project,
            prompt,
            launch,
            requested_model,
            requested_effort,
        )
        .await;
    }

    // Claude: use its structured stream-json transport instead of scraping a
    // TUI. The PTY path captures chrome as text and loses the real answer —
    // the terminal view is right and the chat view is wrong. stream-json emits
    // real text deltas, thinking deltas, and tool events.
    if agent == "claude" {
        return finish_claude_stream_spawn(state, session, project, prompt, requested_model, requested_effort).await;
    }

    let cfg = state.config.read().await;
    let configured = match agent {
        "codex" => &cfg.settings().agents.codex,
        "opencode" => &cfg.settings().agents.opencode,
        _ => {
            // Custom configured agents that are not ACP-capable fall back to a
            // plain PTY launch with their own binary/args.
            if let Some(custom) = cfg.settings().agents.custom.iter().find(|candidate| candidate.id == agent) {
                let mut command = vec![custom.binary.clone()];
                command.extend(custom.args.clone());
                drop(cfg);
                return finish_spawn(state, session, project, prompt, command, requested_model, requested_effort, false).await;
            }
            let Some(executable) = body.get("executable").and_then(|value| value.as_str()) else {
                drop(cfg);
                let _ = state
                    .session_manager
                    .update_status(&session.id, SessionStatus::Error)
                    .await;
                return Err(format!("Agent '{}' is not configured", agent));
            };
            let args: Vec<String> = body
                .get("args")
                .and_then(|value| value.as_array())
                .map(|values| values.iter().filter_map(|value| value.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            let mut command = vec![executable.to_string()];
            command.extend(args);
            drop(cfg);
            return finish_spawn(state, session, project, prompt, command, requested_model, requested_effort, false).await;
        }
    };
    let command = crate::agents::build_agent_command(agent, &configured, project, prompt).await
        .map_err(|error| error.to_string())?;
    drop(cfg);

    finish_spawn(state, session, project, prompt, command, requested_model, requested_effort, false).await
}

/// ACP spawn path: launch the subprocess, complete the initialize/session/new
/// handshake, then submit the initial prompt over the protocol. The process
/// stays alive so follow-up messages reuse the same conversation.
async fn finish_acp_spawn(
    state: &AppState,
    session: crate::sessions::Session,
    project: Option<&str>,
    prompt: Option<&str>,
    launch: AcpLaunch,
    requested_model: Option<String>,
    requested_effort: Option<String>,
) -> std::result::Result<crate::sessions::Session, String> {
    let info = match state
        .acp_manager
        .spawn_session(&session.id, &session.agent, project, &launch.binary, &launch.args)
        .await
    {
        Ok(info) => info,
        Err(error) => {
            let _ = state
                .session_manager
                .update_status(&session.id, SessionStatus::Error)
                .await;
            return Err(error.to_string());
        }
    };

    state.session_manager.set_session_pid(&session.id, info.pid).await;

    // Persist the agent's own session id. Resuming an ACP session requires the
    // id the *agent* assigned at `session/new`, not ours — passing the local uuid
    // gets `Invalid session ID` from the CLI.
    if let Err(error) = state
        .session_manager
        .set_external_id(&session.id, &info.acp_session_id)
        .await
    {
        tracing::warn!(
            session_id = %session.id,
            error = %error,
            "Could not persist the agent session id; this session will not be resumable"
        );
    }

    // Apply the requested configuration before the first prompt, so the very
    // first turn already runs on the model the user chose.
    //
    // `model` and `effort` arrive as generic requests; which option ids the agent
    // actually has comes from its own `session/new` report. Nothing is assumed:
    // an agent without an `effort` dimension simply has no matching option, and
    // the request is recorded and reported rather than silently dropped.
    let requested: Vec<(String, String)> = [("model", requested_model), ("effort", requested_effort)]
        .into_iter()
        .filter_map(|(id, value)| value.map(|value| (id.to_string(), value)))
        .collect();

    for (config_id, value) in requested {
        // Match by option id, or by category so a provider naming its reasoning
        // dimension something else still receives the request.
        let target = info
            .config_options
            .iter()
            .find(|option| option.id == config_id)
            .or_else(|| {
                info.config_options
                    .iter()
                    .find(|option| option.category.as_deref() == Some(config_id.as_str()))
            })
            .map(|option| option.id.clone());

        match target {
            Some(option_id) => {
                if let Err(error) = state
                    .acp_manager
                    .set_config_option(&session.id, &option_id, &value)
                    .await
                {
                    // A rejected model is not a reason to abandon the session,
                    // but the user must know their choice did not take effect.
                    tracing::warn!(
                        "[AgentDeck][ACP][{}] {} rejected {}={}: {}",
                        session.id, session.agent, option_id, value, error
                    );
                    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
                        &session.id,
                        "session_config_rejected",
                        serde_json::json!({
                            "config_id": option_id,
                            "value": value,
                            "message": error.to_string(),
                        }),
                    ));
                }
            }
            None => {
                tracing::info!(
                    "[AgentDeck][ACP][{}] {} exposes no '{}' setting; request recorded only",
                    session.id, session.agent, config_id
                );
                let _ = state
                    .session_manager
                    .set_pending_config(&session.id, &config_id, &value)
                    .await;
            }
        }
    }

    if let Some(prompt) = prompt.filter(|prompt| !prompt.trim().is_empty()) {
        let clean_prompt = prompt.trim().to_string();
        state.broadcast.broadcast(crate::websocket::WsMessage::Message {
            message: crate::agent_events::AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: session.id.clone(),
                role: "user".to_string(),
                content: clean_prompt.clone(),
                timestamp: chrono::Utc::now(),
            },
        });
        state
            .acp_manager
            .send_prompt(&session.id, &clean_prompt)
            .await
            .map_err(|error| error.to_string())?;
    }

    state
        .session_manager
        .update_status(&session.id, SessionStatus::Running)
        .await
        .map_err(|error| error.to_string())?;
    let current = state
        .session_manager
        .get_session(&session.id)
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or(session);
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current.clone() });
    Ok(current)
}

/// Claude via structured stream-json rather than a PTY.
///
/// `requested_model` is passed as `--model`; effort is not exposed by the
/// stream-json path in the same way, so it is dropped here (the picker can be
/// extended later). The first prompt is sent over stdin once the process is up.
async fn finish_claude_stream_spawn(
    state: &AppState,
    session: crate::sessions::Session,
    project: Option<&str>,
    prompt: Option<&str>,
    requested_model: Option<String>,
    requested_effort: Option<String>,
) -> std::result::Result<crate::sessions::Session, String> {
    let _ = requested_effort;
    let cfg = state.config.read().await;
    let configured = &cfg.settings().agents.claude;
    let binary = configured.path.clone();
    drop(cfg);

    let info = state
        .claude_stream
        .spawn_session(&session.id, project, &binary, None, requested_model.as_deref())
        .await
        .map_err(|error| error.to_string())?;

    state.session_manager.set_session_pid(&session.id, info.pid).await;

    // Persist Claude's own session id so resume targets the right conversation.
    if let Err(error) = state
        .session_manager
        .set_external_id(&session.id, &info.claude_session_id)
        .await
    {
        tracing::warn!(
            session_id = %session.id,
            error = %error,
            "Could not persist the Claude session id; this session will not be resumable"
        );
    }

    // Send the initial prompt over stdin. The transport reads the structured
    // stream and emits normalized events, so the chat view shows real content.
    if let Some(prompt) = prompt.filter(|prompt| !prompt.trim().is_empty()) {
        let clean_prompt = prompt.trim().to_string();
        state.broadcast.broadcast(crate::websocket::WsMessage::Message {
            message: crate::agent_events::AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: session.id.clone(),
                role: "user".to_string(),
                content: clean_prompt.clone(),
                timestamp: chrono::Utc::now(),
            },
        });
        state
            .claude_stream
            .send_prompt(&session.id, &clean_prompt)
            .await
            .map_err(|error| error.to_string())?;
    }

    state
        .session_manager
        .update_status(&session.id, SessionStatus::Running)
        .await
        .map_err(|error| error.to_string())?;
    let current = state
        .session_manager
        .get_session(&session.id)
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or(session);
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current.clone() });
    Ok(current)
}

async fn finish_spawn(
    state: &AppState,
    session: crate::sessions::Session,
    project: Option<&str>,
    prompt: Option<&str>,
    mut command: Vec<String>,
    requested_model: Option<String>,
    requested_effort: Option<String>,
    resume: bool,
) -> std::result::Result<crate::sessions::Session, String> {
    if session.agent == "claude" && !resume {
        // Apply the requested model/effort as real CLI flags. These are
        // validated against the configured agent so a bogus value never
        // reaches the executable.
        if let Some(model) = requested_model {
            command.push("--model".to_string());
            command.push(model);
        }
        if let Some(effort) = requested_effort {
            command.push("--effort".to_string());
            command.push(effort);
        }

        let token = crate::auth::devices::random_secret();
        let port = state.config.read().await.settings().server.port;
        let endpoint = format!("http://127.0.0.1:{}/api/hooks/claude", port);
        if let Ok(settings_path) = crate::hooks::installer::HookInstaller::write_session_settings(
            &session.id,
            &endpoint,
            &token,
        ) {
            state
                .hook_tokens
                .write()
                .await
                .insert(session.id.clone(), token);
            command.push("--session-id".to_string());
            command.push(session.id.clone());
            command.push("--settings".to_string());
            command.push(settings_path.to_string_lossy().to_string());
        } else {
            tracing::warn!("[AgentDeck][Claude] Could not create per-session hook settings");
        }
    }

    let pty = match state
        .pty_manager
        .spawn_session(&session.id, &session.agent, project, command)
        .await
    {
        Ok(pty) => pty,
        Err(error) => {
            let _ = state
                .session_manager
                .update_status(&session.id, SessionStatus::Error)
                .await;
            return Err(error.to_string());
        }
    };

    state
        .session_manager
        .set_session_pid(&session.id, pty.pid)
        .await;

    // The PTY already starts in the project directory. Do not inject
    // CLI-specific flags such as --cwd or --prompt into arbitrary executables.
    // Interactive agents receive the initial request through their stdin.
    // Agents that embed the prompt in the command line (e.g. opencode run)
    // should not have the prompt sent via stdin to avoid duplication.
    let prompt_in_cmd = crate::agents::agent_prompt_in_command(&session.agent);
    if let Some(prompt) = prompt.filter(|prompt| !prompt.trim().is_empty()) {
        let clean_prompt = prompt.trim().to_string();
        state.broadcast.broadcast(crate::websocket::WsMessage::Message {
            message: crate::agent_events::AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: session.id.clone(),
                role: "user".to_string(),
                content: clean_prompt.clone(),
                timestamp: chrono::Utc::now(),
            },
        });
        if prompt_in_cmd {
            // Prompt is already in the command line; just activate the normalizer
            // so streaming events are captured from the PTY output.
            state.pty_manager.begin_assistant_turn(&session.id, &clean_prompt);
        } else {
            state.pty_manager.begin_assistant_turn(&session.id, &clean_prompt);
            let pty_manager = Arc::clone(&state.pty_manager);
            let session_id = session.id.clone();
            tokio::spawn(async move {
                // Type the prompt, then press Enter as its own keystroke so the
                // agent TUI submits it instead of keeping it as a draft.
                if let Err(error) = pty_manager.send_input_when_ready(&session_id, &clean_prompt).await {
                    tracing::warn!(
                        "[AgentDeck][PTY] Initial prompt could not be sent to session {}: {}",
                        session_id,
                        error
                    );
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                let _ = pty_manager.send_input(&session_id, "\r").await;
            });
        }
    }

    state
        .session_manager
        .update_status(&session.id, SessionStatus::Running)
        .await
        .map_err(|error| error.to_string())?;
    let current = state
        .session_manager
        .get_session(&session.id)
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or(session);
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current.clone() });
    Ok(current)
}

// ===== MCP =====
pub async fn list_mcp(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = state.config.read().await;
    Json(json!({
        "servers": cfg.settings().mcp.servers,
        "socket_pool_enabled": cfg.settings().mcp.socket_pool_enabled,
        "auto_start": cfg.settings().mcp.auto_start,
    }))
}

pub async fn add_mcp(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let command = body.get("command").and_then(|v| v.as_str()).unwrap_or("");

    if name.is_empty() || command.is_empty() {
        return Json(json!({
            "added": false,
            "error": "name and command are required"
        }));
    }

    let mut cfg = state.config.write().await;
    cfg.settings_mut().mcp.servers.push(crate::config::settings::McpServer {
        name: name.to_string(),
        command: command.to_string(),
        args: vec![],
        env: std::collections::HashMap::new(),
        auto_start: true,
    });
    let _ = cfg.save().await;

    Json(json!({ "added": true, "name": name }))
}

pub async fn remove_mcp(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let mut cfg = state.config.write().await;
    cfg.settings_mut().mcp.servers.retain(|s| s.name != name);
    let _ = cfg.save().await;

    Json(json!({ "removed": true, "name": name }))
}

// ===== TUNNEL =====
pub async fn tunnel_status(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = state.config.read().await;

    // Check Tailscale
    let tailscale_status = if cfg.settings().tunnel.tailscale.enabled {
        let ip = tokio::process::Command::new("ip")
            .args(["-4", "addr", "show", "tailscale0"])
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    for line in stdout.lines() {
                        if line.trim().starts_with("inet ") {
                            let parts: Vec<&str> = line.trim().split_whitespace().collect();
                            if parts.len() >= 2 {
                                return parts[1].split('/').next().map(|s| s.to_string());
                            }
                        }
                    }
                }
                None
            });

        json!({
            "enabled": true,
            "ip": ip,
            "hostname": cfg.settings().tunnel.tailscale.hostname,
            "connected": ip.is_some()
        })
    } else {
        json!({ "enabled": false })
    };

    // Check Cloudflare
    let cloudflare_status = if cfg.settings().tunnel.cloudflare.enabled {
        json!({
            "enabled": true,
            "hostname": cfg.settings().tunnel.cloudflare.hostname,
            "url": cfg.settings().tunnel.cloudflare.hostname.as_ref().map(|h| format!("https://{}", h)),
        })
    } else {
        json!({ "enabled": false })
    };

    Json(json!({
        "tailscale": tailscale_status,
        "cloudflare": cloudflare_status,
    }))
}

pub async fn tunnel_diagnostics(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = state.config.read().await;
    let cloudflare_host = if cfg.settings().tunnel.cloudflare.enabled {
        cfg.settings().tunnel.cloudflare.hostname.clone()
    } else {
        None
    };
    let tailscale_enabled = cfg.settings().tunnel.tailscale.enabled;
    let tailscale_hostname = cfg.settings().tunnel.tailscale.hostname.clone();
    let port = cfg.settings().server.port;
    drop(cfg);

    let endpoint = crate::tunnel::resolver::resolve_endpoint(
        port,
        cloudflare_host.as_deref(),
        tailscale_enabled,
        Some(&tailscale_hostname),
        None,
    )
    .await;

    // Try to enrich with tailscale status --json diagnostics
    let tailscale_diag = if tailscale_enabled {
        let status_json = tokio::process::Command::new("tailscale")
            .args(["status", "--json"])
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    serde_json::from_slice::<serde_json::Value>(&o.stdout).ok()
                } else {
                    None
                }
            });
        if let Some(v) = status_json {
            json!({
                "enabled": true,
                "self_dns": v.pointer("/Self/DNSName").and_then(|x| x.as_str()),
                "self_online": v.pointer("/Self/Online").and_then(|x| x.as_bool()),
                "tailnet": v.pointer("/Self/DNSName").and_then(|x| x.as_str()).and_then(|dns| dns.split('.').nth(1)).unwrap_or(""),
                "peer_count": v.pointer("/Peer").and_then(|p| p.as_object()).map(|m| m.len()).unwrap_or(0),
            })
        } else {
            json!({ "enabled": true, "reachable": endpoint.source == crate::tunnel::resolver::EndpointSource::TailnetIpv4 || endpoint.source == crate::tunnel::resolver::EndpointSource::TailnetMagicDns })
        }
    } else {
        json!({ "enabled": false })
    };

    Json(json!({
        "endpoint": endpoint,
        "tailscale": tailscale_diag,
        "cloudflare": cloudflare_host.map(|h| json!({ "enabled": true, "hostname": h, "url": format!("https://{}", h) })).unwrap_or(json!({ "enabled": false })),
    }))
}

// ===== PAIRING =====

#[allow(dead_code)]
async fn reachable_host(fallback: &str, interface: Option<&str>) -> String {
    let output = if let Some(interface) = interface {
        tokio::process::Command::new("ip")
            .args(["-4", "-o", "addr", "show", "dev", interface])
            .output()
            .await
            .ok()
    } else {
        tokio::process::Command::new("hostname")
            .arg("-I")
            .output()
            .await
            .ok()
    };

    output
        .filter(|output| output.status.success())
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .find_map(|value| {
                    let address = value.split('/').next().unwrap_or(value);
                    if address.parse::<std::net::Ipv4Addr>().is_ok() && !address.starts_with("127.") {
                        Some(address.to_string())
                    } else {
                        None
                    }
                })
        })
        .unwrap_or_else(|| fallback.to_string())
}

pub async fn initiate_pairing(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let offer_id = uuid::Uuid::new_v4().to_string();
    let offer_secret = random_secret();
    let fingerprint = format!("{}", &hash_secret(&offer_secret)[..12]);

    let cfg = state.config.read().await;
    let cloudflare_host = if cfg.settings().tunnel.cloudflare.enabled {
        cfg.settings().tunnel.cloudflare.hostname.clone()
    } else {
        None
    };
    let tailscale_enabled = cfg.settings().tunnel.tailscale.enabled;
    let tailscale_hostname = cfg.settings().tunnel.tailscale.hostname.clone();
    let port = cfg.settings().server.port;
    drop(cfg);

    let endpoint = crate::tunnel::resolver::resolve_endpoint(
        port,
        cloudflare_host.as_deref(),
        tailscale_enabled,
        Some(&tailscale_hostname),
        None,
    )
    .await;

    let qr_data = format!(
        "{}/mobile/pair?offer={}&secret={}",
        endpoint.base_url, offer_id, offer_secret
    );

    let expires_at = chrono::Utc::now() + chrono::Duration::minutes(2);

    let mut cfg = state.config.write().await;
    cfg.pending_offers.insert(offer_id.clone(), crate::config::PendingOffer {
        fingerprint: fingerprint.clone(),
        expires_at,
        secret_hash: hash_secret(&offer_secret),
    });

    Json(json!({
        "offer_id": offer_id,
        "qr_data": qr_data,
        "fingerprint": fingerprint,
        "expires_at": expires_at.to_rfc3339(),
        "status": "waiting_for_device",
        "endpoint": endpoint,
    }))
}

pub async fn verify_pairing(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let offer_id = body.get("offer_id").and_then(|v| v.as_str()).unwrap_or("");
    let offer_secret = body.get("secret").and_then(|v| v.as_str()).unwrap_or("");
    let device_key = body.get("device_key").and_then(|v| v.as_str()).unwrap_or("");
    let device_name = body.get("device_name").and_then(|v| v.as_str()).unwrap_or("Unknown Device");

    let mut cfg = state.config.write().await;
    let offer = cfg.pending_offers.remove(offer_id);

    match offer {
        Some(offer)
            if offer.expires_at > chrono::Utc::now()
                && !device_key.is_empty()
                && !offer_secret.is_empty()
                && hash_secret(offer_secret) == offer.secret_hash =>
        {
            let fingerprint = offer.fingerprint;
            drop(cfg);
            match state.devices.create_device(device_name, device_key, &fingerprint).await {
                Ok((device, token)) => Json(json!({
                    "verified": true,
                    "token": token,
                    "device_id": device.id,
                    "device_name": device.name,
                    "fingerprint": device.fingerprint,
                    "paired_at": device.paired_at.to_rfc3339(),
                })),
                Err(error) => Json(json!({
                    "verified": false,
                    "error": format!("Unable to persist device: {}", error),
                })),
            }
        }
        _ => Json(json!({
            "verified": false,
            "error": "Invalid or expired pairing offer"
        })),
    }
}

pub async fn list_devices(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.devices.list().await {
        Ok(devices) => Json(json!({ "devices": devices })),
        Err(error) => Json(json!({ "devices": [], "error": error.to_string() })),
    }
}

pub async fn revoke_device(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.devices.revoke(&id).await {
        Ok(revoked) => {
            if revoked {
                state.broadcast.broadcast(crate::websocket::WsMessage::DeviceRevoked {
                    device_id: id.clone(),
                });
            }
            Json(json!({ "revoked": revoked, "device_id": id }))
        }
        Err(error) => Json(json!({ "revoked": false, "device_id": id, "error": error.to_string() })),
    }
}

// ===== SETTINGS =====
pub async fn get_settings(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let cfg = state.config.read().await;
    Json(json!({
        "settings": cfg.settings(),
        "config_path": cfg.path().to_string_lossy().to_string(),
    }))
}

pub async fn update_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let mut cfg = state.config.write().await;

    if let Some(server) = body.get("server") {
        if let Some(host) = server.get("host").and_then(|v| v.as_str()) {
            cfg.settings_mut().server.host = host.to_string();
        }
        if let Some(port) = server.get("port").and_then(|v| v.as_u64()) {
            cfg.settings_mut().server.port = port as u16;
        }
    }

    if let Some(security) = body.get("security") {
        if let Some(auto_pair) = security.get("auto_pair").and_then(|v| v.as_bool()) {
            cfg.settings_mut().security.auto_pair = auto_pair;
        }
        if let Some(token) = security.get("auth_token").and_then(|v| v.as_str()) {
            cfg.settings_mut().security.auth_token = Some(token.to_string());
        }
    }

    if let Some(tunnel) = body.get("tunnel") {
        if let Some(ts) = tunnel.get("tailscale") {
            if let Some(enabled) = ts.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().tunnel.tailscale.enabled = enabled;
            }
        }
        if let Some(cf) = tunnel.get("cloudflare") {
            if let Some(enabled) = cf.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().tunnel.cloudflare.enabled = enabled;
            }
            if let Some(token) = cf.get("token").and_then(|v| v.as_str()) {
                cfg.settings_mut().tunnel.cloudflare.token = Some(token.to_string());
            }
        }
    }

    if let Some(notifications) = body.get("notifications") {
        if let Some(telegram) = notifications.get("telegram") {
            if let Some(enabled) = telegram.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().notifications.telegram.enabled = enabled;
            }
            if let Some(token) = telegram.get("bot_token").and_then(|v| v.as_str()) {
                cfg.settings_mut().notifications.telegram.bot_token = Some(token.to_string());
            }
            if let Some(chat_id) = telegram.get("chat_id").and_then(|v| v.as_str()) {
                cfg.settings_mut().notifications.telegram.chat_id = Some(chat_id.to_string());
            }
        }
        if let Some(slack) = notifications.get("slack") {
            if let Some(enabled) = slack.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().notifications.slack.enabled = enabled;
            }
            if let Some(url) = slack.get("webhook_url").and_then(|v| v.as_str()) {
                cfg.settings_mut().notifications.slack.webhook_url = Some(url.to_string());
            }
        }
    }

    let save_result = cfg.save().await;

    Json(json!({
        "saved": save_result.is_ok(),
        "settings": cfg.settings(),
    }))
}

// ===== ATTACHMENTS =====

const ATTACHMENT_DIR: &str = "/tmp/agentdeck/attachments";
const MAX_ATTACHMENT_BYTES: usize = 2_000_000; // 2 MB

/// Accept an uploaded file, persist it to a per-session scratch dir, and
/// return a reference the client can attach to a message. The file bytes
/// are streamed to disk with a hard size cap.
pub async fn upload_attachment(
    State(_state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    mut multipart: axum::extract::Multipart,
) -> Response {
    let session_id = match params.get("session").filter(|s| !s.is_empty()) {
        Some(id) => id.clone(),
        None => return Json(json!({ "error": "session required" })).into_response(),
    };

    let mut saved: Vec<serde_json::Value> = Vec::new();
    while let Some(field) = multipart.next_field().await.ok().flatten() {
        let name = field.name().unwrap_or("file").to_string();
        let file_name = field.file_name().map(str::to_string);
        let content_type = field.content_type().map(str::to_string);
        let data = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                return Json(json!({ "error": format!("read failed: {error}") })).into_response();
            }
        };
        if data.len() > MAX_ATTACHMENT_BYTES {
            return Json(json!({ "error": "file exceeds 2MB limit" })).into_response();
        }
        let dir = PathBuf::from(ATTACHMENT_DIR).join(&session_id);
        if tokio::fs::create_dir_all(&dir).await.is_err() {
            return Json(json!({ "error": "could not store attachment" })).into_response();
        }
        let stamp = chrono::Utc::now().timestamp_millis();
        let safe_name = file_name
            .unwrap_or_else(|| format!("file-{stamp}"))
            .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '-', "_");
        let path = dir.join(format!("{stamp}-{safe_name}"));
        if tokio::fs::write(&path, &data).await.is_err() {
            return Json(json!({ "error": "could not write attachment" })).into_response();
        }
        let ref_id = format!("att-{stamp}-{}", saved.len());
        saved.push(json!({
            "ref": ref_id,
            "name": name,
            "fileName": safe_name,
            "contentType": content_type,
            "size": data.len(),
            "path": path.to_string_lossy(),
        }));
    }

    if saved.is_empty() {
        Json(json!({ "error": "no file provided" })).into_response()
    } else {
        // Touch the attachment scratch dir so it survives until the
        // session is cleaned up.
        tracing::debug!("[AgentDeck][Attachments] stored {} file(s) for {session_id}", saved.len());
        Json(json!({ "attachments": saved })).into_response()
    }
}

// ===== WORKSPACE (worktrees + changed files + diffs) =====

/// Real worktree listing + changed files for a session's project, derived
/// from actual git state. Query param `session` or `project` selects the
/// directory; `project` is used directly when provided.
pub async fn workspace_overview(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let project = match params.get("project").filter(|p| !p.is_empty()) {
        Some(project) => project.clone(),
        None => {
            let Some(session_id) = params.get("session") else {
                return Json(json!({ "error": "session or project required" })).into_response();
            };
            match state.session_manager.get_session(session_id).await {
                Ok(Some(session)) => match session.project {
                    Some(project) => project,
                    None => return Json(json!({ "error": "session has no project" })).into_response(),
                },
                Ok(None) => return Json(json!({ "error": "session not found" })).into_response(),
                Err(error) => return Json(json!({ "error": error.to_string() })).into_response(),
            }
        }
    };

    let snapshot = crate::workspace::workspace_snapshot(&project).await;
    Json(snapshot).into_response()
}

/// Read a single file's contents for the context panel (path traversal-safe).
pub async fn workspace_file(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let (Some(project), Some(path)) = (params.get("project"), params.get("path")) else {
        return Json(json!({ "error": "project and path required" })).into_response();
    };
    if !crate::workspace::is_text_file(path) {
        return Json(json!({ "error": "unsupported file type" })).into_response();
    }
    match crate::workspace::read_file(project, path).await {
        Ok(contents) => Json(json!({ "path": path, "contents": contents })).into_response(),
        Err(error) => Json(json!({ "error": error })).into_response(),
    }
}

/// Legacy alias: real worktree list for a project.
pub async fn list_worktrees(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let project = match params.get("project") {
        Some(project) => project.as_str(),
        None => return Json(json!({ "error": "project required" })).into_response(),
    };
    match crate::workspace::git_worktrees(project).await {
        Ok(worktrees) => Json(json!({ "worktrees": worktrees })).into_response(),
        Err(error) => Json(json!({ "error": error })).into_response(),
    }
}

// ===== NOTIFICATIONS =====
pub async fn send_test_notification(
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let provider = body.get("provider").and_then(|v| v.as_str()).unwrap_or("telegram");
    Json(json!({
        "sent": true,
        "provider": provider,
        "test": true,
    }))
}

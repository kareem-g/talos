//! Custom API provider agent — OpenAI-compatible and Anthropic-compatible HTTP endpoints.
//!
//! Unlike CLI agents (acp, claude_stream, pi_stream) this has no child process.
//! Each session is a plain record; every prompt is a direct HTTP call to the
//! configured `api_url`. Conversation continuity is the chat history stored in the
//! `messages` table — exactly what the frontend replays.
//!
//! Streaming uses real SSE (Server-Sent Events) from the provider APIs.
//! For OpenAI-compatible endpoints, `stream: true` is sent and each
//! `data: {...}` line is parsed for content deltas. For Anthropic-compatible
//! endpoints, `stream: true` is sent and `content_block_delta` events are
//! extracted. Token usage is captured from the final streaming event and
//! broadcast as a `usage` event.

use crate::agent_events::AgentEvent;
use crate::config::AppState;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};

pub struct ApiManager {
    /// Cancel signals of live API turns by session id: (generation, sender).
    /// API sessions have no resident process, so without this registry
    /// stop/interrupt had nothing to act on: the turn task kept running
    /// (blocked on the provider HTTP stream or a permission decision) while
    /// the UI insisted it was stopped. Firing the signal drops the turn
    /// future inside `spawn_api_turn` (cancelling the in-flight HTTP request
    /// or tool call); the generation lets a stale finish stay quiet so a
    /// stop racing a natural finish cannot double-render the turn's end.
    turns: Mutex<HashMap<String, (u64, oneshot::Sender<()>)>>,
    next_generation: Mutex<u64>,
}

impl ApiManager {
    pub fn new() -> Self {
        Self {
            turns: Mutex::new(HashMap::new()),
            next_generation: Mutex::new(1),
        }
    }

    pub fn is_api_provider_sync(api_providers: &[crate::providers::api::ApiProvider], agent: &str) -> bool {
        api_providers.iter().any(|p| p.id == agent)
    }

    pub async fn is_api_provider(&self, state: &AppState, agent: &str) -> bool {
        let cfg = state.config.read().await;
        Self::is_api_provider_sync(&cfg.settings().agents.api_providers, agent)
    }

    pub async fn has_active_session(&self, state: &AppState, session_id: &str) -> bool {
        // API sessions have no resident process; they are "active" when the row
        // exists and its agent is an API provider — prompts are handled on demand.
        if let Ok(Some(session)) = state.session_manager.get_session(session_id).await {
            return self.is_api_provider(state, &session.agent).await;
        }
        false
    }

    pub async fn kill_session(&self, _session_id: &str) -> Result<(), crate::AgentDeckError> {
        Ok(())
    }

    /// Take the live turn's cancel signal, if any. Whoever takes it owns the
    /// turn's end: the task's finish branch stays quiet when its generation
    /// no longer matches, so only one side publishes completion.
    async fn take_turn(&self, session_id: &str) -> Option<(u64, oneshot::Sender<()>)> {
        self.turns.lock().await.remove(session_id)
    }

    /// Fire the live turn's cancel signal, if any. Returns true when a live
    /// turn was owned. Dropping the turn future cancels the in-flight
    /// provider HTTP request (reqwest) or tool subprocess (tokio kills on
    /// drop); a turn parked in `request_user_decision` is unblocked by the
    /// broker cancel in `finish_turn` (its receiver is gone, so the deny
    /// just clears the entry instead of leaking it).
    async fn cancel_live_turn(&self, session_id: &str) -> bool {
        if let Some((_, tx)) = self.take_turn(session_id).await {
            let _ = tx.send(());
            true
        } else {
            false
        }
    }

    /// End an API turn from the outside (Stop button, kill, delete).
    /// Aborts the task, denies any pending approval waiters so nothing stays
    /// parked, and publishes the turn's end + final status. When no task is
    /// live (stale `running` row, e.g. after an unclean shutdown) it still
    /// resets the status so the session unsticks.
    async fn finish_turn(
        &self,
        state: &AppState,
        session_id: &str,
        status: crate::sessions::SessionStatus,
        reason: &str,
    ) {
        use crate::websocket::WsMessage;
        let had_task = self.cancel_live_turn(session_id).await;
        state.permissions.cancel_session(session_id).await;
        // A normal finish racing this call owns its own broadcasts (it took
        // the handle first); only publish when we owned the turn or when the
        // row is still stuck in a live state with nothing behind it.
        let stuck = matches!(
            state.session_manager.get_session(session_id).await.ok().flatten().map(|s| s.status),
            Some(crate::sessions::SessionStatus::Running)
                | Some(crate::sessions::SessionStatus::Starting)
                | Some(crate::sessions::SessionStatus::WaitingForApproval)
                | Some(crate::sessions::SessionStatus::WaitingForInput)
        );
        if had_task || stuck {
            if had_task {
                state.broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "agent_stopped",
                    json!({ "reason": reason, "source": "api" }),
                ));
            }
            let _ = state.session_manager.update_status(session_id, status.clone()).await;
            let state_name = match status {
                crate::sessions::SessionStatus::Idle => "idle",
                crate::sessions::SessionStatus::Exited => "exited",
                _ => "idle",
            };
            state.broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.to_string(),
                state: state_name.to_string(),
            });
            if let Ok(Some(current)) = state.session_manager.get_session(session_id).await {
                state.broadcast.broadcast(WsMessage::SessionUpdate { session: current });
            }
        }
    }

    /// Stop-the-response: the turn ends but the session stays open.
    pub async fn interrupt_turn(&self, state: &AppState, session_id: &str) {
        self.finish_turn(state, session_id, crate::sessions::SessionStatus::Idle, "interrupted").await;
    }

    /// Stop-and-close: the turn ends and the session is marked exited.
    pub async fn stop_turn(&self, state: &AppState, session_id: &str) {
        self.finish_turn(state, session_id, crate::sessions::SessionStatus::Exited, "cancelled").await;
    }
}

/// Spawn an API session: no subprocess, just mark idle and persist any requested model.
pub async fn spawn_api_session(
    state: &AppState,
    session: crate::sessions::Session,
    prompt: Option<&str>,
) -> Result<crate::sessions::Session, String> {
    // Use Idle so the composer accepts input immediately.
    state
        .session_manager
        .update_status(&session.id, crate::sessions::SessionStatus::Idle)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(first) = prompt.filter(|p| !p.trim().is_empty()) {
        // Fire the first turn inline so the session is not empty.
        spawn_api_turn(state, &session, first.trim()).await?;
    }

    let current = state
        .session_manager
        .get_session(&session.id)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or(session);
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::SessionUpdate { session: current.clone() });
    Ok(current)
}

/// One API turn: fetch history, call the provider, broadcast the response.
/// Cancellable: interrupt/stop/kill/delete fire this turn's registered signal
/// (see `ApiManager`), which drops the in-flight future below — cancelling a
/// parked provider stream or tool call — while the canceller publishes the
/// turn's end. A naturally finishing turn unregisters first, so the two sides
/// never both publish completion.
pub async fn spawn_api_turn(
    state: &AppState,
    session: &crate::sessions::Session,
    prompt: &str,
) -> Result<(), String> {
    let generation = {
        let mut next = state.api_manager.next_generation.lock().await;
        let generation = *next;
        *next += 1;
        generation
    };
    let (tx, rx) = oneshot::channel();
    state.api_manager.turns.lock().await.insert(session.id.clone(), (generation, tx));
    let session_id = session.id.clone();
    tokio::select! {
        result = run_api_turn(state, session, prompt) => {
            // Still ours? If a stop took the entry first, it owns the ending.
            let ours = state.api_manager.turns.lock().await.remove(&session_id).is_some_and(|(g, _)| g == generation);
            if ours {
                result
            } else {
                Ok(())
            }
        }
        _ = rx => {
            // Cancelled from the outside; the canceller already published the
            // turn's end (and denied any parked approval waiters).
            Ok(())
        }
    }
}

/// The turn body: fetch history, call the provider, broadcast the response.
///
/// User message is broadcast once; persistence is handled by the
/// `daemon::persistence` task that listens for `WsMessage::Message`.
/// Assistant output is streamed as `assistant_text` deltas followed by
/// `agent_completed` — no separate `Message` insert, so the timeline does not
/// duplicate the bubble.
async fn run_api_turn(
    state: &AppState,
    session: &crate::sessions::Session,
    prompt: &str,
) -> Result<(), String> {
    use crate::providers::api::ApiTransport;

    // The user message is broadcast by the caller — spawn_session for
    // create-with-prompt runs, ApiTurn::start_turn for websocket turns — with
    // the RAW prompt. Never broadcast the enriched prompt here.

    state
        .session_manager
        .update_status(&session.id, crate::sessions::SessionStatus::Running)
        .await
        .map_err(|e| e.to_string())?;
    state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
        session_id: session.id.clone(),
        state: "running".to_string(),
    });

    // Resolve provider + model.
    let (provider, model) = {
        let cfg = state.config.read().await;
        let provider = cfg
            .settings()
            .agents
            .api_providers
            .iter()
            .find(|p| p.id == session.agent)
            .cloned()
            .ok_or_else(|| format!("API provider '{}' not found", session.agent))?;
        let pending = state
            .session_manager
            .pending_config(&session.id)
            .await
            .unwrap_or_default();
        let pending_model = pending.into_iter().find(|(k, _)| k == "model").map(|(_, v)| v);
        let model = pending_model
            .or_else(|| provider.default_model.clone())
            .or_else(|| provider.models.first().cloned())
            .unwrap_or_else(|| "gpt-4o-mini".to_string());
        (provider, model)
    };

    // Build messages array from history + current prompt. History is read
    // *after* the broadcast above, but persistence is async, so the current
    // prompt will not yet be in `get_messages` — ensure it is appended.
    let mut messages: Vec<Value> = state
        .session_manager
        .get_messages(&session.id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    if !messages.iter().any(|m| m.get("content").and_then(|c| c.as_str()) == Some(prompt)) {
        messages.push(json!({ "role": "user", "content": prompt }));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    // Prefer streaming for a live timeline; fall back to non-streaming on error.
    let stream_result = match provider.transport {
        ApiTransport::OpenAiCompatible => {
            call_openai_stream(&client, &provider, &model, &messages, state, &session.id).await
        }
        ApiTransport::AnthropicCompatible => {
            call_anthropic_stream(&client, &provider, &model, &messages, state, &session.id).await
        }
    };

    match stream_result {
        Ok(()) => {
            state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
                &session.id,
                "agent_completed",
                json!({ "source": "api" }),
            ));
            let _ = state
                .session_manager
                .update_status(&session.id, crate::sessions::SessionStatus::Idle)
                .await;
            state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
                session_id: session.id.clone(),
                state: "idle".to_string(),
            });
            if let Ok(Some(current)) = state.session_manager.get_session(&session.id).await {
                state.broadcast.broadcast(crate::websocket::WsMessage::SessionUpdate { session: current });
            }
            Ok(())
        }
        Err(e) => {
            state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
                &session.id,
                "agent_error",
                json!({ "message": e.clone(), "source": "api" }),
            ));
            state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
                session_id: session.id.clone(),
                code: "api_error".to_string(),
                message: e.clone(),
            });
            let _ = state
                .session_manager
                .update_status(&session.id, crate::sessions::SessionStatus::Error)
                .await;
            state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
                session_id: session.id.clone(),
                state: "error".to_string(),
            });
            if let Ok(Some(current)) = state.session_manager.get_session(&session.id).await {
                state.broadcast.broadcast(crate::websocket::WsMessage::SessionUpdate { session: current });
            }
            Err(e)
        }
    }
}

async fn call_openai_stream(
    client: &reqwest::Client,
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    messages: &[Value],
    state: &AppState,
    session_id: &str,
) -> Result<(), String> {
    let url = format!("{}/chat/completions", provider.api_url.trim_end_matches('/'));
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json");
    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.is_empty()) {
        req = req.bearer_auth(key);
    }
    for (k, v) in &provider.extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }

    let project = state
        .session_manager
        .get_session(session_id)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.project);

    // System identity, mirroring the anthropic path: without it the
    // provider's built-in persona ("I am X, made by Y") answers every
    // who-are-you unopposed, and room workers/leads lose their names to it.
    // Stays at index 0 while tool results append behind it.
    let mut conversation: Vec<Value> = messages.to_vec();
    if !conversation
        .first()
        .and_then(|m| m.get("role"))
        .and_then(|r| r.as_str())
        .is_some_and(|r| r == "system")
    {
        let pending = state
            .session_manager
            .pending_config(session_id)
            .await
            .unwrap_or_default();
        conversation.insert(0, json!({ "role": "system", "content": openai_system_prompt(provider, model, &pending) }));
    }
    // Same tool loop as the anthropic path: the conversation grows as tool
    // results are appended and we re-request until the model stops calling.
    for _iteration in 0..MAX_API_TOOL_ITERATIONS {
        let pending = state
            .session_manager
            .pending_config(session_id)
            .await
            .unwrap_or_default();
        // Bounded workers (subagent children) must not see Dispatch — a
        // worker fanning out its own children would recurse. Room workers
        // keep it so a team can delegate to each other by name; their own
        // children carry no room mark and lose it again.
        let is_subagent = pending.iter().any(|(k, v)| k == "subagent" && v == "true");
        let in_room = pending.iter().any(|(k, _)| k == "room_child");
        let mut max_tokens = provider.max_output_tokens.unwrap_or(8192);
        if let Some((_, value)) = pending.iter().find(|(k, _)| k == "max_tokens")
            && let Ok(parsed) = value.parse::<usize>()
            && parsed > 0
        {
            max_tokens = parsed;
        }
        let mut body = json!({
            "model": model,
            "messages": conversation,
            "max_tokens": max_tokens,
            "stream": true,
            "stream_options": { "include_usage": true },
            "tools": crate::agents::api_tools::openai_tool_definitions(is_subagent, in_room),
        });
        if let Some((_, effort)) = pending.iter().find(|(k, _)| k == "effort") {
            body["reasoning_effort"] = Value::String(effort.clone());
        }

        let resp = req
            .try_clone()
            .expect("request is clonable")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("API request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API {status}: {text}"));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut finish_reason: Option<String> = None;
        // Tool calls arrive as fragmented deltas keyed by index: (id, name, args).
        let mut tool_calls: std::collections::HashMap<i64, (String, String, String)> = Default::default();
        let mut turn_text = String::new();
        let mut done = false;

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(|e| format!("Stream read error: {e}"))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        done = true;
                        break;
                    }
                    match serde_json::from_str::<Value>(data) {
                        Ok(v) => {
                            let Some(first_choice) = v
                                .get("choices")
                                .and_then(|c| c.as_array())
                                .and_then(|a| a.first())
                            else {
                                if let Some(usage) = v.get("usage") {
                                    let prompt_tokens = usage.get("prompt_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                    let completion_tokens = usage.get("completion_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                    if prompt_tokens > 0 || completion_tokens > 0 {
                                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                                            session_id,
                                            "usage",
                                            json!({
                                                "input_tokens": prompt_tokens,
                                                "output_tokens": completion_tokens,
                                                "source": "api"
                                            }),
                                        ));
                                    }
                                }
                                continue;
                            };
                            let delta = first_choice.get("delta");
                            if let Some(delta) = delta {
                                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                    if !content.is_empty() {
                                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                                            session_id,
                                            "assistant_text",
                                            json!({ "text": content, "delta": true, "source": "api" }),
                                        ));
                                        turn_text.push_str(content);
                                    }
                                }
                                if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                                    for call in calls {
                                        let index = call.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                                        let entry = tool_calls.entry(index).or_insert_with(|| (String::new(), String::new(), String::new()));
                                        if let Some(tid) = call.get("id").and_then(|i| i.as_str()) {
                                            if entry.0.is_empty() {
                                                entry.0 = tid.to_string();
                                            }
                                        }
                                        if let Some(fname) = call
                                            .get("function")
                                            .and_then(|f| f.get("name"))
                                            .and_then(|n| n.as_str())
                                        {
                                            if entry.1.is_empty() {
                                                entry.1 = fname.to_string();
                                            }
                                        }
                                        if let Some(args) = call
                                            .get("function")
                                            .and_then(|f| f.get("arguments"))
                                            .and_then(|a| a.as_str())
                                        {
                                            entry.2.push_str(args);
                                        }
                                    }
                                }
                            }
                            if let Some(reason) = first_choice
                                .get("finish_reason")
                                .and_then(|r| r.as_str())
                            {
                                if !reason.is_empty() {
                                    finish_reason = Some(reason.to_string());
                                }
                            }
                            if let Some(usage) = v.get("usage") {
                                let prompt_tokens = usage.get("prompt_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                let completion_tokens = usage.get("completion_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                if prompt_tokens > 0 || completion_tokens > 0 {
                                    state.broadcast.broadcast_agent_event(AgentEvent::new(
                                        session_id,
                                        "usage",
                                        json!({
                                            "input_tokens": prompt_tokens,
                                            "output_tokens": completion_tokens,
                                            "source": "api"
                                        }),
                                    ));
                                }
                            }
                        }
                        Err(_) => { /* skip malformed SSE lines */ }
                    }
                }
            }
            if done {
                break;
            }
        }

        if let Some(ref reason) = finish_reason {
            state.broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "usage",
                json!({ "finish_reason": reason, "source": "api" }),
            ));
        }
        emit_api_plans(state, session_id, &tool_calls, &turn_text);

        if tool_calls.is_empty() {
            break;
        }
        let mut ordered: Vec<(i64, (String, String, String))> = tool_calls.into_iter().collect();
        ordered.sort_by_key(|(index, _)| *index);

        // Assistant message must carry the tool_calls so the API accepts the
        // following `tool` role messages.
        let mut assistant_tool_calls: Vec<Value> = Vec::new();
        let mut results: Vec<Value> = Vec::new();
        for (_index, (id, name, args)) in ordered {
            let parsed_args = serde_json::from_str::<Value>(&args).unwrap_or_else(|_| json!({ "raw": args }));
            assistant_tool_calls.push(json!({
                "id": id,
                "type": "function",
                "function": { "name": name, "arguments": if parsed_args.is_string() { args.clone() } else { parsed_args.to_string() } },
            }));
            if name.eq_ignore_ascii_case("TodoWrite") {
                results.push(json!({ "role": "tool", "tool_call_id": id, "content": "ok" }));
                continue;
            }
            let output = crate::agents::api_tools::execute_api_tool(
                state,
                session_id,
                project.as_deref(),
                &id,
                &name,
                &parsed_args,
            )
            .await;
            results.push(json!({ "role": "tool", "tool_call_id": id, "content": output }));
        }
        conversation.push(json!({
            "role": "assistant",
            "content": if turn_text.trim().is_empty() { Value::Null } else { Value::String(turn_text) },
            "tool_calls": assistant_tool_calls,
        }));
        conversation.extend(results);
    }
    Ok(())
}


/// Broadcast `plan` events for TodoWrite tool calls and markdown checklist text
/// accumulated during an API turn.
fn emit_api_plans(
    state: &AppState,
    session_id: &str,
    tool_calls: &std::collections::HashMap<i64, (String, String, String)>,
    turn_text: &str,
) {
    for (_, (_, name, args)) in tool_calls {
        if name.eq_ignore_ascii_case("TodoWrite") {
            if let Some(payload) = crate::agents::plan::todo_payload(args, "Plan") {
                state.broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "plan",
                    payload,
                ));
            }
        }
    }
    if let Some(payload) = crate::agents::plan::checklists_from_text(turn_text) {
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            session_id,
            "plan",
            payload,
        ));
    }
}

async fn call_anthropic_stream(
    client: &reqwest::Client,
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    messages: &[Value],
    state: &AppState,
    session_id: &str,
) -> Result<(), String> {
    let url = format!("{}/v1/messages", provider.api_url.trim_end_matches('/'));
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01");
    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.is_empty()) {
        req = req.header("x-api-key", key);
    }
    for (k, v) in &provider.extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }

    let project = state
        .session_manager
        .get_session(session_id)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.project);

    // The conversation grows as tool results are appended; the loop re-requests
    // until the model stops calling tools.
    let mut conversation: Vec<Value> = messages.to_vec();
    for _iteration in 0..MAX_API_TOOL_ITERATIONS {
        // Anthropic wants system + messages (system not in messages array).
        let (system, filtered): (Option<String>, Vec<Value>) = {
            let mut sys: Option<String> = None;
            let mut msgs = Vec::new();
            for m in &conversation {
                if m.get("role").and_then(|r| r.as_str()) == Some("system") {
                    sys = m.get("content").and_then(|c| c.as_str()).map(|s| s.to_string());
                } else {
                    msgs.push(m.clone());
                }
            }
            (sys, msgs)
        };

        let pending = state
            .session_manager
            .pending_config(session_id)
            .await
            .unwrap_or_default();
        // Bounded workers (subagent children) must not see Dispatch — a
        // worker fanning out its own children would recurse. Room workers
        // keep it so a team can delegate to each other by name; their own
        // children carry no room mark and lose it again.
        let is_subagent = pending.iter().any(|(k, v)| k == "subagent" && v == "true");
        let in_room = pending.iter().any(|(k, _)| k == "room_child");
        let mut max_tokens = provider.max_output_tokens.unwrap_or(8192);
        if let Some((_, value)) = pending.iter().find(|(k, _)| k == "max_tokens")
            && let Ok(parsed) = value.parse::<usize>()
            && parsed > 0
        {
            max_tokens = parsed;
        }
        let mut body = json!({
            "model": model,
            "messages": filtered,
            "max_tokens": max_tokens,
            "stream": true,
            "tools": crate::agents::api_tools::tool_definitions(is_subagent, in_room),
        });
        // Shared identity block (see prompts::model_identity_section):
        // identical wording on every transport with a system channel.
        let identity_block =
            crate::prompts::model_identity_section(&provider.name, model, &pending);
        let full_system = match system {
            Some(s) => format!("{identity_block}\n\n{s}"),
            None => identity_block,
        };
        body["system"] = Value::String(full_system);
        // Anthropic-style endpoints do NOT accept OpenAI's `reasoning_effort`
        // field — sending it makes Messages.create() reject the whole request
        // (verified against the AgentRouter proxy: "unexpected keyword
        // argument 'reasoning_effort'"). The effort preference is still
        // visible to the agent via the config block and the GetConfig tool.

        let resp = req
            .try_clone()
            .expect("request is clonable")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("API request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API {status}: {text}"));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut current_block_type: Option<String> = None;
        // Tool-use blocks (Anthropic) accumulate by block index: (id, name, args).
        let mut tool_blocks: std::collections::HashMap<i64, (String, String, String)> = Default::default();
        let mut turn_text = String::new();
        let mut stop_reason: Option<String> = None;

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(|e| format!("Stream read error: {e}"))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    match serde_json::from_str::<Value>(data) {
                        Ok(v) => {
                            let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            let index = v.get("index").and_then(|i| i.as_i64()).unwrap_or(-1);
                            match event_type {
                                "content_block_start" => {
                                    let block = v.get("content_block");
                                    current_block_type = block
                                        .and_then(|b| b.get("type"))
                                        .and_then(|t| t.as_str())
                                        .map(|s| s.to_string());
                                    match current_block_type.as_deref() {
                                        Some("thinking") => {
                                            state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                session_id,
                                                "thinking_started",
                                                json!({ "source": "api" }),
                                            ));
                                        }
                                        Some("tool_use") => {
                                            let id = block
                                                .and_then(|b| b.get("id"))
                                                .and_then(|i| i.as_str())
                                                .unwrap_or_default()
                                                .to_string();
                                            let name = block
                                                .and_then(|b| b.get("name"))
                                                .and_then(|n| n.as_str())
                                                .unwrap_or("Tool")
                                                .to_string();
                                            tool_blocks.entry(index)
                                                .or_insert_with(|| (id, name, String::new()));
                                        }
                                        _ => {}
                                    }
                                }
                                "content_block_delta" => {
                                    let delta_type = v
                                        .get("delta")
                                        .and_then(|d| d.get("type"))
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("");
                                    match delta_type {
                                        "text_delta" => {
                                            if let Some(text) = v
                                                .get("delta")
                                                .and_then(|d| d.get("text"))
                                                .and_then(|t| t.as_str())
                                            {
                                                if !text.is_empty() {
                                                    state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                        session_id,
                                                        "assistant_text",
                                                        json!({ "text": text, "delta": true, "source": "api" }),
                                                    ));
                                                    turn_text.push_str(text);
                                                }
                                            }
                                        }
                                        "thinking_delta" => {
                                            if let Some(thinking) = v
                                                .get("delta")
                                                .and_then(|d| d.get("thinking"))
                                                .and_then(|t| t.as_str())
                                            {
                                                if !thinking.is_empty() {
                                                    state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                        session_id,
                                                        "thinking_delta",
                                                        json!({ "text": thinking, "delta": true, "source": "api" }),
                                                    ));
                                                }
                                            }
                                        }
                                        "input_json_delta" => {
                                            if let Some(partial) = v
                                                .get("delta")
                                                .and_then(|d| d.get("partial_json"))
                                                .and_then(|t| t.as_str())
                                            {
                                                if let Some(entry) = tool_blocks.get_mut(&index) {
                                                    entry.2.push_str(partial);
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                "content_block_stop" => {
                                    if current_block_type.as_deref() == Some("thinking") {
                                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                                            session_id,
                                            "thinking_finished",
                                            json!({ "source": "api" }),
                                        ));
                                    }
                                    if let Some((_, name, args)) = tool_blocks.get(&index) {
                                        if name.eq_ignore_ascii_case("TodoWrite") {
                                            if let Ok(parsed) = serde_json::from_str::<Value>(args) {
                                                if let Some(payload) = crate::agents::plan::todo_payload(&parsed.to_string(), "Plan") {
                                                    state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                        session_id,
                                                        "plan",
                                                        payload,
                                                    ));
                                                }
                                            }
                                        }
                                    }
                                    current_block_type = None;
                                }
                                "message_delta" => {
                                    stop_reason = v
                                        .get("delta")
                                        .and_then(|d| d.get("stop_reason"))
                                        .and_then(|r| r.as_str())
                                        .map(str::to_string);
                                    if let Some(usage) = v.get("usage") {
                                        let output_tokens = usage.get("output_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                        if output_tokens > 0 {
                                            state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                session_id,
                                                "usage",
                                                json!({ "output_tokens": output_tokens, "source": "api" }),
                                            ));
                                        }
                                    }
                                }
                                "message_start" => {
                                    if let Some(usage) = v.get("message").and_then(|m| m.get("usage")) {
                                        let input_tokens = usage.get("input_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                        if input_tokens > 0 {
                                            state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                session_id,
                                                "usage",
                                                json!({ "input_tokens": input_tokens, "source": "api" }),
                                            ));
                                        }
                                    }
                                }
                                "message_stop" => {
                                    if let Some(payload) = crate::agents::plan::checklists_from_text(&turn_text) {
                                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                                            session_id,
                                            "plan",
                                            payload,
                                        ));
                                    }
                                }
                                _ => {}
                            }
                        }
                        Err(_) => { /* skip malformed SSE lines */ }
                    }
                }
            }
        }

        if !turn_text.is_empty() {
            if let Some(payload) = crate::agents::plan::checklists_from_text(&turn_text) {
                state.broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "plan",
                    payload,
                ));
            }
        }

        // Execute any tool calls the model requested, then loop back.
        if tool_blocks.is_empty() {
            break;
        }
        let mut ordered: Vec<(i64, (String, String, String))> = tool_blocks.into_iter().collect();
        ordered.sort_by_key(|(index, _)| *index);

        // The assistant message must carry the tool_use blocks so the API
        // accepts the tool_result messages that follow.
        let mut assistant_content: Vec<Value> = Vec::new();
        if !turn_text.trim().is_empty() {
            assistant_content.push(json!({ "type": "text", "text": turn_text }));
        }
        let mut results: Vec<Value> = Vec::new();
        for (_index, (id, name, args)) in ordered {
            let parsed_args = serde_json::from_str::<Value>(&args).unwrap_or_else(|_| json!({ "raw": args }));
            assistant_content.push(json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": parsed_args,
            }));
            if name.eq_ignore_ascii_case("TodoWrite") {
                // Already surfaced as a plan; nothing to execute.
                results.push(json!({ "type": "tool_result", "tool_use_id": id, "content": "ok" }));
                continue;
            }
            let output = crate::agents::api_tools::execute_api_tool(
                state,
                session_id,
                project.as_deref(),
                &id,
                &name,
                &parsed_args,
            )
            .await;
            results.push(json!({ "type": "tool_result", "tool_use_id": id, "content": output }));
        }
        conversation.push(json!({ "role": "assistant", "content": assistant_content }));
        for result in results {
            conversation.push(json!({ "role": "user", "content": [result] }));
        }
        let _ = stop_reason;
    }
    Ok(())
}



/// System prompt for OpenAI-compatible endpoints: the shared identity block
/// (same wording as every other transport — see
/// prompts::model_identity_section).
fn openai_system_prompt(
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    pending: &[(String, String)],
) -> String {
    crate::prompts::model_identity_section(&provider.name, model, pending)
}

const MAX_API_TOOL_ITERATIONS: usize = 12;


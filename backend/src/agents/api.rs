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
use std::time::Duration;

pub struct ApiManager;

impl ApiManager {
    pub fn new() -> Self {
        Self
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
///
/// User message is broadcast once; persistence is handled by the
/// `daemon::persistence` task that listens for `WsMessage::Message`.
/// Assistant output is streamed as `assistant_text` deltas followed by
/// `agent_completed` — no separate `Message` insert, so the timeline does not
/// duplicate the bubble.
pub async fn spawn_api_turn(
    state: &AppState,
    session: &crate::sessions::Session,
    prompt: &str,
) -> Result<(), String> {
    use crate::providers::api::ApiTransport;

    // Single broadcast for the user turn — daemon persistence will insert it.
    state.broadcast.broadcast(crate::websocket::WsMessage::Message {
        message: crate::agent_events::AgentMessage {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session.id.clone(),
            role: "user".to_string(),
            content: prompt.to_string(),
            timestamp: chrono::Utc::now(),
        },
    });

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
    let body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true }
    });
    let resp = req.json(&body).send().await.map_err(|e| format!("API request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API {status}: {text}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut finish_reason: Option<String> = None;
    // Accumulate tool calls by index (name + arguments) and assistant text so
    // TodoWrite tools and markdown checklists can become `plan` events.
    let mut tool_calls: std::collections::HashMap<i64, (String, String)> = Default::default();
    let mut turn_text = String::new();

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
                    // Broadcast usage if we captured a finish_reason
                    if let Some(ref reason) = finish_reason {
                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                            session_id,
                            "usage",
                            json!({ "finish_reason": reason, "source": "api" }),
                        ));
                    }
                    emit_api_plans(state, session_id, &tool_calls, &turn_text);
                    return Ok(());
                }
                match serde_json::from_str::<Value>(data) {
                    Ok(v) => {
                        let Some(first_choice) = v
                            .get("choices")
                            .and_then(|c| c.as_array())
                            .and_then(|a| a.first())
                        else {
                            // Capture usage from the final chunk (some providers include it)
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
                            // Tool calls arrive as fragmented deltas keyed by index.
                            if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                                for call in calls {
                                    let index = call.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                                    let entry = tool_calls.entry(index).or_insert_with(|| (String::new(), String::new()));
                                    if let Some(fname) = call
                                        .get("function")
                                        .and_then(|f| f.get("name"))
                                        .and_then(|n| n.as_str())
                                    {
                                        if entry.0.is_empty() {
                                            entry.0 = fname.to_string();
                                        }
                                    }
                                    if let Some(args) = call
                                        .get("function")
                                        .and_then(|f| f.get("arguments"))
                                        .and_then(|a| a.as_str())
                                    {
                                        entry.1.push_str(args);
                                    }
                                }
                            }
                        }
                        // Capture finish_reason from the choices
                        if let Some(reason) = first_choice
                            .get("finish_reason")
                            .and_then(|r| r.as_str())
                        {
                            if !reason.is_empty() {
                                finish_reason = Some(reason.to_string());
                            }
                        }
                        // Capture usage from the final chunk (some providers include it)
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
    }

    // Stream ended without [DONE] — broadcast whatever we have
    if let Some(ref reason) = finish_reason {
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            session_id,
            "usage",
            json!({ "finish_reason": reason, "source": "api" }),
        ));
    }
    emit_api_plans(state, session_id, &tool_calls, &turn_text);
    Ok(())
}

/// Broadcast `plan` events for TodoWrite tool calls and markdown checklist text
/// accumulated during an API turn.
fn emit_api_plans(
    state: &AppState,
    session_id: &str,
    tool_calls: &std::collections::HashMap<i64, (String, String)>,
    turn_text: &str,
) {
    for (_, (name, args)) in tool_calls {
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

    // Anthropic wants system + messages (system not in messages array)
    let (system, filtered): (Option<String>, Vec<Value>) = {
        let mut sys: Option<String> = None;
        let mut msgs = Vec::new();
        for m in messages {
            if m.get("role").and_then(|r| r.as_str()) == Some("system") {
                sys = m.get("content").and_then(|c| c.as_str()).map(|s| s.to_string());
            } else {
                msgs.push(m.clone());
            }
        }
        (sys, msgs)
    };

    let mut body = json!({
        "model": model,
        "messages": filtered,
        "max_tokens": provider.max_output_tokens.unwrap_or(8192),
        "stream": true
    });
    if let Some(s) = system {
        body["system"] = Value::String(s);
    }

    let resp = req.json(&body).send().await.map_err(|e| format!("API request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API {status}: {text}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    // Track content block type for thinking support
    let mut current_block_type: Option<String> = None;
    // Tool-use blocks (Anthropic) accumulate input by block index so a
    // TodoWrite tool can be promoted to a `plan` event.
    let mut tool_blocks: std::collections::HashMap<i64, (String, String)> = Default::default();
    let mut turn_text = String::new();

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
                                // If this is a thinking block, emit thinking_started
                                match current_block_type.as_deref() {
                                    Some("thinking") => {
                                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                                            session_id,
                                            "thinking_started",
                                            json!({ "source": "api" }),
                                        ));
                                    }
                                    Some("tool_use") => {
                                        let name = block
                                            .and_then(|b| b.get("name"))
                                            .and_then(|n| n.as_str())
                                            .unwrap_or("Tool");
                                        tool_blocks.entry(index)
                                            .or_insert_with(|| (name.to_string(), String::new()));
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
                                        // Anthropic streams tool input as partial JSON.
                                        if let Some(partial) = v
                                            .get("delta")
                                            .and_then(|d| d.get("partial_json"))
                                            .and_then(|t| t.as_str())
                                        {
                                            if let Some(entry) = tool_blocks.get_mut(&index) {
                                                entry.1.push_str(partial);
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            "content_block_stop" => {
                                // Emit thinking_finished if we were in a thinking block
                                if current_block_type.as_deref() == Some("thinking") {
                                    state.broadcast.broadcast_agent_event(AgentEvent::new(
                                        session_id,
                                        "thinking_finished",
                                        json!({ "source": "api" }),
                                    ));
                                }
                                // Promote TodoWrite tool blocks to a plan event.
                                if let Some((name, args)) = tool_blocks.remove(&index) {
                                    if name.eq_ignore_ascii_case("TodoWrite") {
                                        if let Some(payload) = crate::agents::plan::todo_payload(&args, "Plan") {
                                            state.broadcast.broadcast_agent_event(AgentEvent::new(
                                                session_id,
                                                "plan",
                                                payload,
                                            ));
                                        }
                                    }
                                }
                                current_block_type = None;
                            }
                            "message_delta" => {
                                // Capture stop_reason and usage from message_delta
                                let stop_reason = v
                                    .get("delta")
                                    .and_then(|d| d.get("stop_reason"))
                                    .and_then(|r| r.as_str());
                                if let Some(reason) = stop_reason {
                                    state.broadcast.broadcast_agent_event(AgentEvent::new(
                                        session_id,
                                        "usage",
                                        json!({ "finish_reason": reason, "source": "api" }),
                                    ));
                                }
                                if let Some(usage) = v.get("usage") {
                                    let output_tokens = usage.get("output_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                                    if output_tokens > 0 {
                                        state.broadcast.broadcast_agent_event(AgentEvent::new(
                                            session_id,
                                            "usage",
                                            json!({
                                                "output_tokens": output_tokens,
                                                "source": "api"
                                            }),
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
                                            json!({
                                                "input_tokens": input_tokens,
                                                "source": "api"
                                            }),
                                        ));
                                    }
                                }
                            }
                            "message_stop" => {
                                // Markdown checklists written in prose still
                                // become a plan for the HUD Progress section.
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

    // Stream ended without message_stop — still flush any checklist-derived plan.
    if !turn_text.is_empty() {
        if let Some(payload) = crate::agents::plan::checklists_from_text(&turn_text) {
            state.broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "plan",
                payload,
            ));
        }
    }
    Ok(())
}

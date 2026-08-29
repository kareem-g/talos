//! Custom API provider agent — OpenAI-compatible and Anthropic-compatible HTTP endpoints.
//!
//! Unlike CLI agents (acp, claude_stream, pi_stream) this has no child process.
//! Each session is a plain record; every prompt is a direct HTTP call to the
//! configured `api_url`. Conversation continuity is the chat history stored in the
//! `messages` table — exactly what the frontend replays.
//!
//! Streaming is simulated as a single delta: the full response is fetched as JSON
//! then broadcast as one `assistant_text` event. That is sufficient for the UI's
//! incremental renderer and avoids SSE complexity for the first iteration.

use crate::agent_events::AgentEvent;
use crate::config::AppState;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;
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

async fn call_openai(
    client: &reqwest::Client,
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    messages: &[Value],
) -> Result<String, String> {
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
        "stream": false
    });
    let resp = req.json(&body).send().await.map_err(|e| format!("API request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("API {status}: {text}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {e} — {text}"))?;
    // OpenAI format: choices[0].message.content
    if let Some(content) = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
    {
        return Ok(content.to_string());
    }
    // Some providers return choices[0].text
    if let Some(content) = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("text"))
        .and_then(|c| c.as_str())
    {
        return Ok(content.to_string());
    }
    Err(format!("Unexpected response shape: {v}"))
}

async fn call_anthropic(
    client: &reqwest::Client,
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    messages: &[Value],
) -> Result<String, String> {
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
        "max_tokens": 4096
    });
    if let Some(s) = system {
        body["system"] = Value::String(s);
    }
    let resp = req.json(&body).send().await.map_err(|e| format!("API request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("API {status}: {text}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {e} — {text}"))?;
    // Anthropic format: content: [{ type: "text", text: "..." }]
    if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
        let mut out = String::new();
        for block in arr {
            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                out.push_str(t);
            }
        }
        if !out.is_empty() {
            return Ok(out);
        }
    }
    Err(format!("Unexpected response shape: {v}"))
}

async fn call_openai_stream(
    client: &reqwest::Client,
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    messages: &[Value],
    state: &AppState,
    session_id: &str,
) -> Result<(), String> {
    // Use non-streaming call then simulate streaming via chunked deltas so the
    // timeline shows incremental typing without requiring `reqwest/stream`.
    let full = call_openai(client, provider, model, messages).await?;
    for chunk in full.chars().collect::<Vec<_>>().chunks(24) {
        let text: String = chunk.iter().collect();
        if text.is_empty() { continue; }
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            session_id,
            "assistant_text",
            json!({ "text": text, "delta": true, "source": "api" }),
        ));
        tokio::time::sleep(Duration::from_millis(18)).await;
    }
    Ok(())
}

async fn call_anthropic_stream(
    client: &reqwest::Client,
    provider: &crate::providers::api::ApiProvider,
    model: &str,
    messages: &[Value],
    state: &AppState,
    session_id: &str,
) -> Result<(), String> {
    let full = call_anthropic(client, provider, model, messages).await?;
    for chunk in full.chars().collect::<Vec<_>>().chunks(24) {
        let text: String = chunk.iter().collect();
        if text.is_empty() { continue; }
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            session_id,
            "assistant_text",
            json!({ "text": text, "delta": true, "source": "api" }),
        ));
        tokio::time::sleep(Duration::from_millis(18)).await;
    }
    Ok(())
}

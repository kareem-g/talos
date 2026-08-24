//! Interactive tool permissions for the Claude stream transport.
//!
//! `claude -p` has nowhere to ask a human, so unattended runs silently deny
//! every gated tool — which surfaced as agents claiming they "don't have
//! permission to make external network requests". The supported escape hatch
//! is `--permission-prompt-tool mcp__<server>__<tool>`: Claude calls that MCP
//! tool whenever a permission decision is needed, and its return value decides.
//!
//! Two halves live here:
//!
//! 1. [`PermissionBroker`] — daemon-side registry of in-flight decisions.
//!    The HTTP callback registers a waiter and broadcasts an approval card;
//!    the WebSocket `approval_response` command resolves it.
//! 2. [`run_mcp_server`] — the MCP stdio half, run by re-invoking this same
//!    binary with a hidden argument (see `main.rs`). It speaks just enough
//!    JSON-RPC for Claude's client: initialize, tools/list, and one tool whose
//!    call blocks on an HTTP round-trip to the daemon until you answer.

use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};

/// How long a permission card stays open before auto-deny. Generous on
/// purpose: the whole point of remote control is answering from your phone
/// minutes later.
const DECISION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

type Waiter = oneshot::Sender<String>;

#[derive(Default)]
pub struct PermissionBroker {
    pending: Mutex<HashMap<String, Waiter>>,
}

impl PermissionBroker {
    /// Register a wait for `request_id`; resolve it later with a raw decision
    /// string ("allow…" / anything else means deny).
    pub async fn register(&self, request_id: String) -> oneshot::Receiver<String> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id, tx);
        rx
    }

    /// Resolve a pending decision. Returns the owning session when one matched.
    pub async fn resolve(&self, request_id: &str, decision: String) -> bool {
        if let Some(tx) = self.pending.lock().await.remove(request_id) {
            let _ = tx.send(decision);
            true
        } else {
            false
        }
    }
}

/// One queued permission question, as the HTTP callback receives it.
pub struct PermissionQuery {
    pub session_id: String,
    pub tool_name: String,
    pub input: Value,
}

pub struct PermissionOutcome {
    pub allowed: bool,
    /// The (possibly original) input to hand back on allow.
    pub input: Value,
    pub reason: String,
    /// Wall time the card was open, for telemetry.
    pub waited_ms: u64,
}

/// Ask the human. Broadcasts the approval card and blocks until they answer
/// (or the timeout auto-denies).
pub async fn request_user_decision(
    state: &crate::config::AppState,
    query: PermissionQuery,
) -> PermissionOutcome {
    use crate::websocket::WsMessage;

    let started = std::time::Instant::now();
    let request_id = uuid::Uuid::new_v4().to_string();

    // Compact, readable rendering of what the tool would do.
    let input_preview = match &query.input {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let prompt = format!("{} {}", query.tool_name, truncate(&input_preview, 220));
    let risk = risk_for(&query.tool_name);

    let rx = state.permissions.register(request_id.clone()).await;

    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
        &query.session_id,
        "permission_required",
        json!({
            "id": request_id,
            "prompt": prompt,
            "options": ["allow", "deny"],
            "risk_level": risk,
            "tool_name": query.tool_name,
            "source": "claude-stream",
        }),
    ));
    state.broadcast.broadcast(WsMessage::ApprovalRequest {
        session_id: query.session_id.clone(),
        request: crate::websocket::ApprovalRequest {
            id: request_id.clone(),
            prompt: prompt.clone(),
            options: vec!["allow".to_string(), "deny".to_string()],
            risk_level: crate::websocket::RiskLevel::Medium,
            timestamp: chrono::Utc::now(),
        },
    });
    state.broadcast.broadcast(WsMessage::StateChange {
        session_id: query.session_id.clone(),
        state: "waiting_for_approval".to_string(),
    });

    let decision = tokio::time::timeout(DECISION_TIMEOUT, rx)
        .await
        .ok()
        .and_then(|result| result.ok())
        .unwrap_or_else(|| "deny".to_string());

    let allowed = decision.starts_with("allow")
        || decision.eq_ignore_ascii_case("yes")
        || decision.eq_ignore_ascii_case("always");

    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
        &query.session_id,
        "permission_resolved",
        json!({
            "request_id": request_id,
            "decision": if allowed { "allow" } else { "deny" },
            "source": "claude-stream",
        }),
    ));
    state.broadcast.broadcast(WsMessage::StateChange {
        session_id: query.session_id.clone(),
        state: "running".to_string(),
    });

    PermissionOutcome {
        allowed,
        input: query.input,
        reason: if allowed {
            "Approved by user".to_string()
        } else if started.elapsed() >= DECISION_TIMEOUT {
            "Auto-denied: no response within 5 minutes".to_string()
        } else {
            "Denied by user".to_string()
        },
        waited_ms: started.elapsed().as_millis() as u64,
    }
}

fn risk_for(tool_name: &str) -> &'static str {
    let name = tool_name.to_lowercase();
    if name.contains("bash") || name.contains("exec") || name.contains("write") || name.contains("edit") || name.contains("delete") || name.contains("remove") {
        "high"
    } else {
        "low"
    }
}

fn truncate(text: &str, max: usize) -> String {
    let flat = text.replace('\n', " ");
    if flat.len() <= max {
        flat
    } else {
        format!("{}…", &flat[..flat.char_indices().take_while(|(i, _)| *i < max).count()])
    }
}

/// Entry point for `agentdeck-backend __permission-mcp`.
///
/// Minimal MCP stdio server: newline-delimited JSON-RPC on stdin/out. Only the
/// pieces Claude's client actually exercises are implemented; unknown methods
/// get a clean method-not-found so future probes fail loudly instead of hanging.
pub async fn run_mcp_server() -> std::io::Result<()> {
    let base_url = std::env::var("AGENTDECK_URL").unwrap_or_else(|_| "http://127.0.0.1:9120".to_string());
    let token = std::env::var("AGENTDECK_TOKEN").unwrap_or_default();
    let session_id = std::env::var("AGENTDECK_SESSION").unwrap_or_default();
    let client = reqwest::Client::new();

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();

    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 {
            break; // EOF: Claude closed the pipe
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let _ = std::fs::OpenOptions::new().create(true).append(true)
            .open("/tmp/agentdeck-mcp.log").and_then(|mut f| std::io::Write::write_all(&mut f, format!("IN  {trimmed}\n").as_bytes()));
        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        // Notifications carry no id and expect no reply.
        let Some(id) = message.get("id").cloned() else { continue };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");

        let result: Result<Value, String> = match method {
            "initialize" => Ok(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "agentdeck-permissions", "version": env!("CARGO_PKG_VERSION") },
            })),
            "notifications/initialized" => continue,
            "tools/list" => Ok(json!({
                "tools": [{
                    "name": "request_permission",
                    "description": "Ask the user to approve or deny a tool call. Returns {behavior: \"allow\"|\"deny\"}.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "tool_name": { "type": "string", "description": "The tool requesting permission" },
                            "input": { "type": "object", "description": "The exact input the tool would run with" },
                        },
                        "required": ["tool_name"],
                    },
                }],
            })),
            "tools/call" => {
                let params = message.get("params").cloned().unwrap_or_default();
                let tool_name = params
                    .pointer("/arguments/tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown_tool")
                    .to_string();
                let input = params.pointer("/arguments/input").cloned().unwrap_or(json!({}));

                let payload = json!({
                    "session_id": session_id,
                    "tool_name": tool_name,
                    "input": input,
                });
                let url = format!(
                    "{base_url}/api/hooks/permission?token={token}&session_id={}",
                    session_id.replace(" ", "%20")
                );
                match client.post(&url).json(&payload).send().await {
                    Ok(response) => match response.json::<Value>().await {
                        // Claude validates permission results STRICTLY: the
                        // result must carry exactly one text block whose text
                        // is the JSON decision — no structuredContent, no
                        // isError, nothing else.
                        Ok(outcome) => Ok(json!({
                            "content": [{ "type": "text", "text": outcome.to_string() }],
                        })),
                        Err(error) => Ok(mcp_error(format!("Bad decision payload: {error}"))),
                    },
                    Err(error) => Ok(mcp_error(format!("Could not reach AgentDeck: {error}"))),
                }
            }
            other => Err(format!("Method not found: {other}")),
        };

        let reply = match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(message) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": message },
            }),
        };
        let _ = std::fs::OpenOptions::new().create(true).append(true)
            .open("/tmp/agentdeck-mcp.log").and_then(|mut f| std::io::Write::write_all(&mut f, format!("OUT {}\n", reply.to_string()).as_bytes()));
        stdout.write_all(reply.to_string().as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }
    Ok(())
}

/// A denied-by-infrastructure tool result: Claude treats isError results as
/// tool failures rather than permission denials, so deny answers are healthy
/// responses carrying `{behavior:"deny"}` instead.
fn mcp_error(message: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": json!({ "behavior": "deny", "message": message }).to_string() }],
    })
}

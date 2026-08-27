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
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};

use crate::questions::QuestionOption;

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
    /// Optional structured answer options the agent provided (id/label/etc.).
    /// When empty, the card falls back to a plain allow/deny choice.
    pub options: Vec<QuestionOption>,
    /// When true the user may supply arbitrary free text instead of (or in
    /// addition to) picking a listed option.
    pub allows_custom_text: bool,
    /// "single" | "multi" — whether one or several options may be chosen.
    pub selection_mode: String,
}

pub struct PermissionOutcome {
    pub allowed: bool,
    /// The (possibly original) input to hand back on allow.
    pub input: Value,
    pub reason: String,
    /// Wall time the card was open, for telemetry.
    pub waited_ms: u64,
}

/// Linux reports an executable that has been replaced in place as
/// `"/path/to/binary (deleted)"` through `/proc/self/exe`. A running daemon is
/// commonly rebuilt during development, so strip that kernel suffix before
/// handing the path to Claude's child-process launcher.
pub fn usable_executable_path(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    raw.strip_suffix(" (deleted)")
        .map(PathBuf::from)
        .unwrap_or(path)
}

/// Ask the human. Broadcasts the approval card and blocks until they answer
/// (or the timeout auto-denies). Respects the session's `permission_mode`
/// setting: `auto_edit` auto-allows file edits, `plan` auto-denies writes,
/// `full` auto-allows everything, `ask` prompts every time.
pub async fn request_user_decision(
    state: &crate::config::AppState,
    query: PermissionQuery,
) -> PermissionOutcome {
    use crate::websocket::WsMessage;

    let started = std::time::Instant::now();
    let request_id = uuid::Uuid::new_v4().to_string();

    // Check if the session has a permission_mode override.
    let permission_mode = match state.session_manager.pending_config(&query.session_id).await {
        Ok(pending) => pending
            .iter()
            .find(|(k, _)| k == "permission_mode")
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| "ask".to_string()),
        Err(_) => "ask".to_string(),
    };

    // Auto-allow or auto-deny based on permission_mode.
    let is_file_edit = matches!(&query.input, Value::String(_) | Value::Object(_))
        && matches!(
            query.tool_name.as_str(),
            "write" | "edit" | "str_replace" | "create_file" | "delete_file"
        );
    let is_high_risk = matches!(
        query.tool_name.as_str(),
        "bash" | "run_command" | "exec"
    );

    match permission_mode.as_str() {
        "full" => {
            // Auto-allow everything.
            state.permissions.resolve(&request_id, "allow".to_string()).await;
            return PermissionOutcome {
                allowed: true,
                input: query.input,
                reason: "Auto-approved (full access)".to_string(),
                waited_ms: 0,
            };
        }
        "auto_edit" => {
            if is_file_edit {
                // Auto-allow file edits.
                state.permissions.resolve(&request_id, "allow".to_string()).await;
                return PermissionOutcome {
                    allowed: true,
                    input: query.input,
                    reason: "Auto-approved (auto-edit mode)".to_string(),
                    waited_ms: 0,
                };
            }
            // Fall through to prompt for non-file edits.
        }
        "plan" => {
            if is_file_edit || is_high_risk {
                // Auto-deny destructive operations in plan mode.
                state.permissions.resolve(&request_id, "deny".to_string()).await;
                return PermissionOutcome {
                    allowed: false,
                    input: query.input,
                    reason: "Denied (plan mode: read-only)".to_string(),
                    waited_ms: 0,
                };
            }
            // Allow reads/queries.
            state.permissions.resolve(&request_id, "allow".to_string()).await;
            return PermissionOutcome {
                allowed: true,
                input: query.input,
                reason: "Approved (plan mode: read operation)".to_string(),
                waited_ms: 0,
            };
        }
        _ => {
            // "ask" mode: fall through to normal prompting.
        }
    }

    // Compact, readable rendering of what the tool would do.
    let input_preview = match &query.input {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let prompt = format!("{} {}", query.tool_name, truncate(&input_preview, 220));
    let risk = risk_for(&query.tool_name);

    let rx = state.permissions.register(request_id.clone()).await;

    // Structured options: prefer what the agent supplied, else the default
    // allow/deny pair. The card renders whatever is here verbatim, so richer
    // option data (labels, descriptions, custom-text) flows straight through.
    let option_values: Vec<String> = if query.options.is_empty() {
        vec!["allow".to_string(), "deny".to_string()]
    } else {
        query.options.iter().map(|o| o.id.clone()).collect()
    };
    let selection_mode = if query.selection_mode.is_empty() { "single" } else { &query.selection_mode };

    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
        &query.session_id,
        "permission_required",
        json!({
            "id": request_id,
            "prompt": prompt,
            "options": option_values,
            "option_data": query.options,
            "selection_mode": selection_mode,
            "allows_custom_text": query.allows_custom_text,
            "risk_level": risk,
            "tool_name": query.tool_name,
            "source": "claude-stream",
            "permission_mode": permission_mode,
        }),
    ));
    state.broadcast.broadcast(WsMessage::ApprovalRequest {
        session_id: query.session_id.clone(),
        request: crate::websocket::ApprovalRequest {
            id: request_id.clone(),
            prompt: prompt.clone(),
            options: option_values.clone(),
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

#[cfg(test)]
mod tests {
    use super::usable_executable_path;
    use std::path::PathBuf;

    #[test]
    fn removes_linux_deleted_executable_suffix() {
        let path = usable_executable_path(PathBuf::from("/tmp/agentdeck-backend (deleted)"));
        assert_eq!(path, PathBuf::from("/tmp/agentdeck-backend"));
    }

    #[test]
    fn leaves_normal_executable_paths_unchanged() {
        let path = PathBuf::from("/tmp/agentdeck-backend");
        assert_eq!(usable_executable_path(path.clone()), path);
    }
}

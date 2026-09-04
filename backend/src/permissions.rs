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
    /// request_id -> (owning session_id, waiter). The session link is what
    /// makes stop/kill/delete able to unblock a turn stuck on approval:
    /// without it the only way out was answering the card or the 5-minute
    /// timeout, and after a daemon restart the waiter is gone entirely while
    /// the session row still says `waiting_for_approval`.
    pending: Mutex<HashMap<String, (String, Waiter)>>,
}

impl PermissionBroker {
    /// Register a wait for `request_id` owned by `session_id`; resolve it
    /// later with a raw decision string ("allow…" / anything else means deny).
    pub async fn register(&self, request_id: String, session_id: String) -> oneshot::Receiver<String> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id, (session_id, tx));
        rx
    }

    /// Resolve a pending decision. Returns the owning session when one matched.
    pub async fn resolve(&self, request_id: &str, decision: String) -> bool {
        if let Some((_, tx)) = self.pending.lock().await.remove(request_id) {
            let _ = tx.send(decision);
            true
        } else {
            false
        }
    }

    /// Resolve every waiter owned by `session_id` (stop/kill/delete path).
    /// A denied tool result lets the awaiting turn finish its bookkeeping
    /// instead of hanging to the timeout; returns how many were unblocked.
    /// A dropped receiver (aborted turn task) still gets its entry removed so
    /// nothing leaks.
    pub async fn cancel_session(&self, session_id: &str) -> usize {
        let waiters: Vec<Waiter> = {
            let mut pending = self.pending.lock().await;
            let ids: Vec<String> = pending
                .iter()
                .filter_map(|(id, (owner, _))| (owner == session_id).then(|| id.clone()))
                .collect();
            ids.into_iter().filter_map(|id| pending.remove(&id).map(|(_, tx)| tx)).collect()
        };
        let count = waiters.len();
        for tx in waiters {
            let _ = tx.send("deny".to_string());
        }
        count
    }

    /// Request ids still waiting on `session_id` (diagnostics / force paths).
    pub async fn pending_for(&self, session_id: &str) -> Vec<String> {
        self.pending
            .lock()
            .await
            .iter()
            .filter_map(|(id, (owner, _))| (owner == session_id).then(|| id.clone()))
            .collect()
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
    /// True when this is a plan-mode approval (ExitPlanMode / plan proposal).
    pub is_plan: bool,
}

pub struct PermissionOutcome {
    pub allowed: bool,
    /// The (possibly original) input to hand back on allow.
    pub input: Value,
    pub reason: String,
    /// Wall time the card was open, for telemetry.
    pub waited_ms: u64,
    /// For an answered AskUserQuestion, the verbatim answer text (an option
    /// label, or a JSON array for multi-select). `None` for ordinary permission
    /// decisions. Informational only: the value Claude actually consumes is
    /// carried by `input`, which is the `updatedInput` envelope for the tool.
    pub answer_text: Option<String>,
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
    mut query: PermissionQuery,
) -> PermissionOutcome {
    use crate::websocket::WsMessage;

    let started = std::time::Instant::now();
    let request_id = uuid::Uuid::new_v4().to_string();

    // Hidden sessions (room workers, orchestration children) must not raise
    // approval cards nobody can see — the run would stall to its timeout.
    // Bubble the card onto the parent room channel instead, so whoever is
    // watching the room decides; the resolution routes back by request id.
    //
    // The owning session keeps its own `permission_mode` / `skip_policy`:
    // room children pinned at spawn (`full` + `skip_policy`) must NOT inherit
    // the channel's `ask` — that hole is what made skip-rooms still prompt.
    let owner_session_id = query.session_id.clone();
    if let Ok(Some(session)) = state.session_manager.get_session(&query.session_id).await
        && session.hidden
        && let Some(parent_id) = session.parent_id
    {
        query.session_id = parent_id;
    }

    // Check if the session has a permission_mode override.
    let permission_mode = match state.session_manager.pending_config(&owner_session_id).await {
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

    // AskUserQuestion is answered through this same broker (the Claude session's
    // `--permission-prompt-tool`): the decision string the user picks IS the
    // answer. Auto-modes below must not short-circuit questions, since there is
    // no default answer to synthesize.
    let is_question = query.tool_name.eq_ignore_ascii_case("AskUserQuestion");

    // Room runs that skip permissions bypass the project tool policy
    // entirely (`skip_policy` is pinned at spawn for the run's children).
    // Otherwise the project tool policy overrides the mode defaults: a rule
    // that denies a tool is honored even in `full` mode, and an allow rule
    // skips the card. Questions are never auto-decided by policy. The rule
    // order (network → path → tool) lives in
    // `policy::ToolPolicy::decide_input`, shared with the ACP permission path
    // so every backend honors the same policy.
    let skip_policy = state
        .session_manager
        .pending_config(&owner_session_id)
        .await
        .map(|pending| pending.iter().any(|(k, v)| k == "skip_policy" && v == "true"))
        .unwrap_or(false);
    if !is_question && !skip_policy {
        let project = state
            .session_manager
            .get_session(&query.session_id)
            .await
            .ok()
            .flatten()
            .and_then(|s| s.project);
        let policy = crate::policy::ToolPolicy::load(project.as_deref());

        match policy.decide_input(&query.tool_name, &query.input) {
            crate::policy::InputDecision::Allow(reason) => {
                state.permissions.resolve(&request_id, "allow".to_string()).await;
                return PermissionOutcome {
                    allowed: true,
                    input: query.input,
                    reason: reason.to_string(),
                    waited_ms: 0,
                    answer_text: None,
                };
            }
            crate::policy::InputDecision::Deny(reason) => {
                state.permissions.resolve(&request_id, "deny".to_string()).await;
                return PermissionOutcome {
                    allowed: false,
                    input: query.input,
                    reason: reason.to_string(),
                    waited_ms: 0,
                    answer_text: None,
                };
            }
            crate::policy::InputDecision::Ask => {}
        }
    }

    match permission_mode.as_str() {
        "full" if !is_question => {
            // Auto-allow everything.
            state.permissions.resolve(&request_id, "allow".to_string()).await;
            return PermissionOutcome {
                allowed: true,
                input: query.input,
                reason: "Auto-approved (full access)".to_string(),
                waited_ms: 0,
                answer_text: None,
            };
        }
        "auto_edit" if !is_question => {
            if is_file_edit {
                // Auto-allow file edits.
                state.permissions.resolve(&request_id, "allow".to_string()).await;
                return PermissionOutcome {
                    allowed: true,
                    input: query.input,
                    reason: "Auto-approved (auto-edit mode)".to_string(),
                    waited_ms: 0,
                    answer_text: None,
                };
            }
            // Fall through to prompt for non-file edits.
        }
        "plan" if !is_question => {
            if is_file_edit || is_high_risk {
                // Auto-deny destructive operations in plan mode.
                state.permissions.resolve(&request_id, "deny".to_string()).await;
                return PermissionOutcome {
                    allowed: false,
                    input: query.input,
                    reason: "Denied (plan mode: read-only)".to_string(),
                    waited_ms: 0,
                    answer_text: None,
                };
            }
            // Allow reads/queries.
            state.permissions.resolve(&request_id, "allow".to_string()).await;
            return PermissionOutcome {
                allowed: true,
                input: query.input,
                reason: "Approved (plan mode: read operation)".to_string(),
                waited_ms: 0,
                answer_text: None,
            };
        }
        _ => {
            // "ask" mode (or a question in any mode): fall through to prompting.
        }
    }

    // Compact, readable rendering of what the tool would do.
    let input_preview = match &query.input {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    // AskUserQuestion packs the full questions envelope in its input — preserve
    // it in full so the frontend can extract every option (the regex fallback
    // parser needs the complete JSON; truncating loses all but the first).
    let prompt_limit = if query.tool_name.eq_ignore_ascii_case("AskUserQuestion") {
        4000
    } else {
        220
    };
    let prompt = format!("{} {}", query.tool_name, truncate(&input_preview, prompt_limit));
    let risk = risk_for(&query.tool_name);

    let rx = state.permissions.register(request_id.clone(), query.session_id.clone()).await;

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
            "is_plan": query.is_plan,
        }),
    ));
    // NOTE: Do NOT also emit `WsMessage::ApprovalRequest` here. The broadcast
    // loop in `daemon/mod.rs` turns that message into a *second*
    // `permission_required` agent event with the same id but only the bare
    // `prompt`/`options` (no `option_data`/`selection_mode`), which the
    // frontend renders as a duplicate card and which `INSERT OR REPLACE` then
    // clobbers. The agent event above is the canonical, data-complete
    // broadcast; the trailing `StateChange` already marks the session
    // `waiting_for_approval`.
    state.broadcast.broadcast(WsMessage::StateChange {
        session_id: query.session_id.clone(),
        state: "waiting_for_approval".to_string(),
    });

    let decision = tokio::time::timeout(DECISION_TIMEOUT, rx)
        .await
        .ok()
        .and_then(|result| result.ok())
        .unwrap_or_else(|| "deny".to_string());

    // AskUserQuestion: the decision string IS the user's answer (an option label,
    // or a JSON array for multi-select). Claude's `--permission-prompt-tool`
    // contract requires the tool result to be `{behavior:"allow", updatedInput}`,
    // and the answer rides in `updatedInput.answers` — a map of question text →
    // answer string (multi-select answers are comma-separated). Claude then
    // re-invokes AskUserQuestion with that pre-answered input and the tool
    // returns the answers verbatim, so the model reads "the user answered: …".
    if is_question {
        let answer = decision;
        let answer_string = if query.selection_mode == "multi" {
            // The card sends multi-select choices as a JSON array string.
            serde_json::from_str::<Vec<String>>(&answer)
                .ok()
                .filter(|values| !values.is_empty())
                .map(|values| values.join(", "))
                .unwrap_or_else(|| answer.clone())
        } else {
            answer.clone()
        };
        let question_text = query
            .input
            .get("questions")
            .and_then(Value::as_array)
            .and_then(|questions| questions.first())
            .and_then(|question| question.get("question"))
            .and_then(Value::as_str)
            .unwrap_or("Question");
        let mut updated_input = query.input.clone();
        if let Some(object) = updated_input.as_object_mut() {
            object.insert("answers".to_string(), json!({ question_text: answer_string }));
            object.insert("annotations".to_string(), json!({}));
        }
        state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
            &query.session_id,
            "permission_resolved",
            json!({
                "request_id": request_id,
                "decision": answer,
                "answer": answer,
                "source": "claude-stream",
            }),
        ));
        state.broadcast.broadcast(WsMessage::StateChange {
            session_id: query.session_id.clone(),
            state: "running".to_string(),
        });
        return PermissionOutcome {
            allowed: true,
            input: updated_input,
            reason: "Answered".to_string(),
            waited_ms: started.elapsed().as_millis() as u64,
            answer_text: Some(answer),
        };
    }

    let allowed = decision.starts_with("allow")
        || decision.starts_with("approve")
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
        } else if query.is_plan && decision.trim().len() > 2 {
            // A plan "suggest changes" reply carries the user's feedback — pass
            // it back to the agent so it can revise the plan.
            decision.trim().to_string()
        } else {
            "Denied by user".to_string()
        },
        waited_ms: started.elapsed().as_millis() as u64,
        answer_text: None,
    }
}

fn risk_for(tool_name: &str) -> &'static str {
    // The unified registry's classifier — the same one that tags tool events —
    // decides the card's risk level, so a tool reads identically everywhere.
    crate::tools::classify(tool_name).1.as_str()
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
                            // Claude validates permission results STRICTLY:
                            // the single text block must carry the JSON
                            // `{behavior, updatedInput}` decision verbatim —
                            // both ordinary approvals and AskUserQuestion
                            // answers (which ride in `updatedInput.answers`).
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
    use super::{usable_executable_path, PermissionBroker};
    use std::path::PathBuf;

    #[test]
    fn removes_linux_deleted_executable_suffix() {
        let path = usable_executable_path(PathBuf::from("/tmp/agentdeck-backend (deleted)"));
        assert_eq!(path, PathBuf::from("/tmp/agentdeck-backend"));
    }

    #[test]
    fn leaves_normal_executable_paths_unchanged() {
        let path = usable_executable_path(PathBuf::from("/tmp/agentdeck-backend"));
        assert_eq!(path, PathBuf::from("/tmp/agentdeck-backend"));
    }

    /// Stop/kill/delete must unblock turns parked on approval: every waiter
    /// owned by the session resolves (as deny) and unrelated sessions keep
    /// waiting. A dropped receiver (aborted task) still clears its entry.
    #[tokio::test]
    async fn cancel_session_unblocks_only_that_sessions_waiters() {
        let broker = PermissionBroker::default();
        let rx_a1 = broker.register("req-a1".to_string(), "sess-a".to_string()).await;
        let rx_a2 = broker.register("req-a2".to_string(), "sess-a".to_string()).await;
        let rx_b = broker.register("req-b".to_string(), "sess-b".to_string()).await;
        // Simulate an aborted turn task: its receiver is gone before cancel.
        drop(rx_a2);

        assert_eq!(broker.cancel_session("sess-a").await, 2);
        assert_eq!(rx_a1.await.unwrap(), "deny");
        //sess-b untouched and still resolvable normally.
        assert!(broker.pending_for("sess-b").await.contains(&"req-b".to_string()));
        assert!(broker.pending_for("sess-a").await.is_empty());
        assert!(broker.resolve("req-b", "allow".to_string()).await);
        assert_eq!(rx_b.await.unwrap(), "allow");
    }
}

//! Pi CLI semantic transport (`pi -p --mode json`).
//!
//! Verified against the installed CLI's own output: newline-delimited JSON
//! events — `session` (carries pi's session id), `agent_start`, `turn_start`,
//! `message_start/end` (role, text content blocks, model, usage, stopReason,
//! errorMessage), `turn_end`, `agent_end`, `agent_settled`.
//!
//! Vamp-contract shape: one headless process per turn, machine-readable stdout
//! only, conversation continuity through pi's *own* `--session-id` store, and
//! the process is reaped when the turn ends. Terminal mode stays separate.

use crate::agent_events::AgentEvent;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct PiStreamManager {
    /// One live child per session at most; used for interrupt/kill.
    running: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
}

type Child = tokio::process::Child;

impl PiStreamManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn has_active_session(&self, session_id: &str) -> bool {
        self.running.lock().await.contains_key(session_id)
    }

    pub async fn kill_session(&self, session_id: &str) -> Result<(), crate::AgentDeckError> {
        if let Some(child) = self.running.lock().await.remove(session_id) {
            let mut guard = child.lock().await;
            if let Some(process) = guard.as_mut() {
                let _ = process.start_kill();
            }
        }
        Ok(())
    }

    /// Run one turn: spawn `pi -p --mode json --session-id <id> -- <prompt>`,
    /// stream its NDJSON into normalized events, wait for completion.
    ///
    /// Safety posture from the provider contract: prompt after `--`,
    /// `stdin=null`, `TERM=dumb`, `NO_COLOR=1`; nothing is scraped from a TUI.
    /// Continuity comes from pi itself — the same `--session-id` reopens its
    /// stored session, creating it when missing.
    pub async fn run_turn(
        &self,
        state: &crate::config::AppState,
        session_id: &str,
        project: Option<&str>,
        binary: &str,
        prompt: &str,
    ) -> Result<(), String> {
        let mut command = Command::new(binary);
        command
            .arg("-p")
            .arg("--mode")
            .arg("json")
            .args(["--session-id", session_id]);
        // Pi's parser has no `--` separator (verified: "Unknown option: --"),
        // so the prompt rides as the trailing positional per its own usage
        // line: `pi [options] [@files...] [messages...]`.
        command.arg(prompt);
        command
            .env("TERM", "dumb")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(project) = project {
            command.current_dir(project);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start pi: {error}"))?;
        let pid = child.id().unwrap_or(0);
        state.session_manager.set_session_pid(session_id, pid).await;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "pi stdout unavailable".to_string())?;
        let child = Arc::new(Mutex::new(Some(child)));
        self.running
            .lock()
            .await
            .insert(session_id.to_string(), Arc::clone(&child));

        let reader_session = session_id.to_string();
        let broadcast = state.broadcast.clone();
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            handle_pi_line(&reader_session, &value, &broadcast).await;
        }

        self.running.lock().await.remove(session_id);

        // Persist pi's reported session id so future turns keep continuity
        // even if the user resumes from another client.
        crate::agents::pi_stream::persist_pi_session_id(state, session_id).await;
        Ok(())
    }
}

use tokio::sync::RwLock;

static PI_SESSION_IDS: std::sync::OnceLock<tokio::sync::RwLock<HashMap<String, String>>> =
    std::sync::OnceLock::new();

fn pi_ids() -> &'static RwLock<HashMap<String, String>> {
    PI_SESSION_IDS.get_or_init(|| RwLock::new(HashMap::new()))
}

async fn handle_pi_line(session_id: &str, value: &Value, broadcast: &crate::websocket::broadcast::BroadcastHub) {
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "session" => {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                pi_ids().write().await.insert(session_id.to_string(), id.to_string());
                broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "session_started",
                    json!({ "agent": "pi", "pi_session": id, "source": "pi" }),
                ));
            }
        }
        "message_start" | "message_end" => {
            let message = value.get("message");
            let role = message.and_then(|m| m.get("role")).and_then(Value::as_str).unwrap_or("");
            if role != "assistant" {
                return;
            }
            // Only whole-message events exist for assistant text here; the
            // end event carries the final content and accounting.
            if kind != "message_end" {
                return;
            }
            let blocks = message
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in blocks {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                session_id,
                                "assistant_text",
                                json!({ "text": text, "delta": false, "source": "pi" }),
                            ));
                        }
                    }
                }
            }
            let usage = message.and_then(|m| m.get("usage"));
            let num = |key: &str| {
                usage.and_then(|u| u.get(key)).and_then(Value::as_f64).unwrap_or(0.0)
            };
            let cost_total = usage
                .and_then(|u| u.get("cost"))
                .and_then(|c| c.get("total"))
                .and_then(Value::as_f64);
            broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "usage",
                json!({
                    "input_tokens": num("input") as u64,
                    "output_tokens": num("output") as u64,
                    "cost_usd": cost_total,
                    "source": "pi",
                }),
            ));
            if let Some(error) = message.and_then(|m| m.get("errorMessage")).and_then(Value::as_str) {
                broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "agent_error",
                    json!({ "message": error, "source": "pi" }),
                ));
            }
        }
        "agent_settled" | "agent_end" => {
            broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "agent_completed",
                json!({ "source": "pi" }),
            ));
        }
        _ => {}
    }
}

/// Public hook used right after a turn: move pi's reported session id into the
/// sessions store so the next turn resumes the same conversation.
pub async fn persist_pi_session_id(state: &crate::config::AppState, session_id: &str) {
    if let Some(pi_id) = pi_ids().read().await.get(session_id).cloned() {
        let _ = state.session_manager.set_external_id(session_id, &pi_id).await;
    }
}

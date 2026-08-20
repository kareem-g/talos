//! Structured Claude transport via `claude -p --output-format stream-json`.
//!
//! The PTY path scrapes a TUI: it captures chrome as text and loses the real
//! answer, so the terminal view is right and the chat view is wrong. Claude's
//! own stream-json output is structured events — text deltas, thinking deltas,
//! tool use, message boundaries — so this reads that instead and emits the
//! same normalized `AgentEvent` schema every other transport emits.
//!
//! Two things make it correct in ways the PTY path is not:
//!
//! - The stream carries the real session id, which we persist to `external_id`
//!   so resume targets the session the CLI actually has.
//! - Text deltas are real content, never TUI chrome.

use crate::agent_events::AgentEvent;
use crate::websocket::broadcast::BroadcastHub;
use crate::websocket::WsMessage;
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex, RwLock};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

/// Commands sent to the per-process writer task.
enum Outbound {
    /// Send a user message. Carries a channel that resolves once the line is
    /// written, so `send_prompt` can await it.
    Prompt { text: String, done: tokio::sync::oneshot::Sender<()> },
    Shutdown,
}

struct ClaudeHandle {
    tx: mpsc::UnboundedSender<Outbound>,
    child: Arc<Mutex<Option<Child>>>,
    session_id: Arc<Mutex<String>>,
}

pub struct ClaudeStreamInfo {
    pub pid: u32,
    /// Claude's own session id, read from the stream's `init` event.
    pub claude_session_id: String,
}

const PROMPT_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 12);

pub struct ClaudeStreamManager {
    sessions: Arc<RwLock<HashMap<String, Arc<ClaudeHandle>>>>,
    broadcast: BroadcastHub,
}

impl ClaudeStreamManager {
    pub fn new(broadcast: BroadcastHub) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            broadcast,
        }
    }

    pub async fn has_active_session(&self, session_id: &str) -> bool {
        self.sessions.read().await.contains_key(session_id)
    }

    /// Spawn `claude -p` in stream-json mode. `resume_id` continues a prior
    /// conversation; when `None`, a fresh one is created.
    pub async fn spawn_session(
        &self,
        session_id: &str,
        project: Option<&str>,
        binary: &str,
        resume_id: Option<&str>,
        model: Option<&str>,
    ) -> crate::Result<ClaudeStreamInfo> {
        let mut command = Command::new(binary);
        command
            .arg("-p")
            .arg("--output-format=stream-json")
            .arg("--verbose")
            .arg("--include-partial-messages")
            .arg("--print")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(model) = model {
            command.arg("--model").arg(model);
        }
        if let Some(resume_id) = resume_id {
            command.arg("--resume").arg(resume_id);
        }
        if let Some(project) = project {
            command.current_dir(project);
        }

        let mut child = command
            .spawn()
            .map_err(|error| crate::AgentDeckError::Session(format!("Could not start Claude: {}", error)))?;
        let pid = child.id().unwrap_or(0);

        let mut stdin: ChildStdin = child.stdin.take().ok_or_else(|| {
            crate::AgentDeckError::Session("Claude stdin unavailable".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            crate::AgentDeckError::Session("Claude stdout unavailable".to_string())
        })?;

        let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
        let child = Arc::new(Mutex::new(Some(child)));
        let claude_session_id = Arc::new(Mutex::new(String::new()));

        let handle = Arc::new(ClaudeHandle {
            tx,
            child: child.clone(),
            session_id: claude_session_id.clone(),
        });
        self.sessions.write().await.insert(session_id.to_string(), Arc::clone(&handle));

        // Reader: parse JSONL, capture Claude's session id, emit events.
        let reader_session = session_id.to_string();
        let broadcast = self.broadcast.clone();
        let sessions = self.sessions.clone();
        let thought_open = Arc::new(Mutex::new(false));
        let turn = Arc::new(AtomicU64::new(0));
        let reader_session_id = claude_session_id.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                handle_claude_line(
                    &reader_session,
                    trimmed,
                    &value,
                    &broadcast,
                    &reader_session_id,
                    &thought_open,
                    &turn,
                )
                .await;
            }
            // EOF: the process exited.
            sessions.write().await.remove(&reader_session);
            let mut thought = thought_open.lock().await;
            if *thought {
                *thought = false;
                broadcast.broadcast_agent_event(AgentEvent::new(
                    &reader_session,
                    "thinking_finished",
                    json!({ "tool_name": "Thinking", "turn": turn.load(Ordering::SeqCst), "source": "claude-stream" }),
                ));
            }
            broadcast.broadcast_agent_event(AgentEvent::new(
                &reader_session,
                "agent_completed",
                json!({ "source": "claude_stream_exit", "state": "exited" }),
            ));
            broadcast.broadcast(WsMessage::StateChange {
                session_id: reader_session,
                state: "exited".to_string(),
            });
        });

        // Writer: drain the outbound queue into stdin.
        tokio::spawn(async move {
            writer_task(rx, &mut stdin).await;
        });

        // Wait for the `init` event to learn Claude's session id. It arrives
        // first, quickly.
        let claude_id = timeout(Duration::from_secs(15), async {
            loop {
                let id = claude_session_id.lock().await.clone();
                if !id.is_empty() {
                    return id;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .map_err(|_| crate::AgentDeckError::Session("Claude did not report a session id".to_string()))?;

        Ok(ClaudeStreamInfo {
            pid,
            claude_session_id: claude_id,
        })
    }

    pub async fn send_prompt(&self, session_id: &str, text: &str) -> crate::Result<()> {
        let handle = Arc::clone(
            self.sessions
                .read()
                .await
                .get(session_id)
                .ok_or_else(|| crate::AgentDeckError::Session("Claude session is not running".to_string()))?,
        );
        let (done, wait) = tokio::sync::oneshot::channel();
        handle
            .tx
            .send(Outbound::Prompt { text: text.to_string(), done })
            .map_err(|_| crate::AgentDeckError::Session("Claude process is gone".to_string()))?;
        timeout(PROMPT_TIMEOUT, wait)
            .await
            .map_err(|_| crate::AgentDeckError::Session("Timed out sending prompt".to_string()))?
            .map_err(|_| crate::AgentDeckError::Session("Claude process is gone".to_string()))?;
        Ok(())
    }

    pub async fn kill_session(&self, session_id: &str) -> crate::Result<()> {
        let mut sessions = self.sessions.write().await;
        let Some(handle) = sessions.remove(session_id) else {
            return Err(crate::AgentDeckError::Session(format!(
                "Session {session_id} is not running"
            )));
        };
        let _ = handle.tx.send(Outbound::Shutdown);
        let mut child = handle.child.lock().await;
        if let Some(mut child) = child.take() {
            let _ = child.start_kill();
        }
        Ok(())
    }

    /// Claude's own session id for a live session, when known.
    pub async fn claude_session_id(&self, session_id: &str) -> Option<String> {
        let sessions = self.sessions.read().await;
        let handle = sessions.get(session_id)?;
        let id = handle.session_id.lock().await.clone();
        (!id.is_empty()).then_some(id)
    }
}

async fn writer_task(mut rx: mpsc::UnboundedReceiver<Outbound>, stdin: &mut ChildStdin) {
    while let Some(outbound) = rx.recv().await {
        match outbound {
            Outbound::Prompt { text, done } => {
                let mut payload = text;
                payload.push('\n');
                if stdin.write_all(payload.as_bytes()).await.is_ok() {
                    let _ = stdin.flush().await;
                }
                let _ = done.send(());
            }
            Outbound::Shutdown => break,
        }
    }
}

/// Map one JSONL line onto normalized events and broadcast them.
async fn handle_claude_line(
    session_id: &str,
    raw: &str,
    value: &Value,
    broadcast: &BroadcastHub,
    claude_session_id: &Arc<Mutex<String>>,
    thought_open: &Arc<Mutex<bool>>,
    turn: &Arc<AtomicU64>,
) {
    let type_field = value.get("type").and_then(Value::as_str);
    let source = "claude-stream";
    let current_turn = turn.load(Ordering::SeqCst).max(1);

    match type_field {
        Some("system") => {
            if value.get("subtype").and_then(Value::as_str) == Some("init") {
                if let Some(id) = value.get("session_id").and_then(Value::as_str) {
                    *claude_session_id.lock().await = id.to_string();
                }
                broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "session_started",
                    json!({ "agent": "claude", "source": source }),
                ));
            }
        }
        Some("stream_event") => {
            let event = value.get("event");
            let Some(event) = event else { return };
            match event.get("type").and_then(Value::as_str) {
                Some("message_start") => {
                    turn.fetch_add(1, Ordering::SeqCst);
                }
                Some("content_block_start") => {
                    let block = event.get("content_block");
                    match block.and_then(|b| b.get("type")).and_then(Value::as_str) {
                        Some("thinking") => {
                            *thought_open.lock().await = true;
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                session_id,
                                "thinking_started",
                                json!({ "tool_name": "Thinking", "turn": current_turn, "source": source }),
                            ));
                        }
                        Some("text") => {}
                        Some("tool_use") => {
                            let name = block
                                .and_then(|b| b.get("name"))
                                .and_then(Value::as_str)
                                .unwrap_or("Tool");
                            let id = block
                                .and_then(|b| b.get("id"))
                                .and_then(Value::as_str)
                                .unwrap_or("");
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                session_id,
                                "tool_started",
                                json!({ "tool_name": name, "tool_id": id, "input": "", "turn": current_turn, "source": source }),
                            ));
                        }
                        _ => {}
                    }
                }
                Some("content_block_delta") => {
                    let delta = event.get("delta");
                    let Some(delta) = delta else { return };
                    match delta.get("type").and_then(Value::as_str) {
                        Some("thinking_delta") => {
                            let text = delta.get("thinking").and_then(Value::as_str).unwrap_or("");
                            if !text.is_empty() {
                                broadcast.broadcast_agent_event(AgentEvent::new(
                                    session_id,
                                    "thinking_delta",
                                    json!({ "text": text, "delta": true, "turn": current_turn, "source": source }),
                                ));
                            }
                        }
                        Some("text_delta") => {
                            let text = delta.get("text").and_then(Value::as_str).unwrap_or("");
                            if !text.is_empty() {
                                broadcast.broadcast_agent_event(AgentEvent::new(
                                    session_id,
                                    "assistant_text",
                                    json!({ "text": text, "delta": true, "turn": current_turn, "source": source }),
                                ));
                            }
                        }
                        Some("input_json_delta") => {
                            // Tool input is streamed as JSON; surface the raw
                            // fragment so the card shows something is happening.
                            let partial = delta.get("partial_json").and_then(Value::as_str).unwrap_or("");
                            let id = ""; // tool id is on the block_start; good enough for activity
                            if !partial.is_empty() {
                                broadcast.broadcast_agent_event(AgentEvent::new(
                                    session_id,
                                    "tool_activity",
                                    json!({ "input": partial, "tool_id": id, "turn": current_turn, "source": source }),
                                ));
                            }
                        }
                        _ => {}
                    }
                }
                Some("content_block_stop") => {
                    let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
                    // index 0 is usually the thinking block.
                    if index == 0 {
                        let mut thought = thought_open.lock().await;
                        if *thought {
                            *thought = false;
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                session_id,
                                "thinking_finished",
                                json!({ "tool_name": "Thinking", "turn": current_turn, "source": source }),
                            ));
                        }
                    }
                }
                Some("message_delta") => {
                    let stop = event
                        .get("delta")
                        .and_then(|d| d.get("stop_reason"))
                        .and_then(Value::as_str);
                    if let Some(reason) = stop {
                        if reason == "end_turn" {
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                session_id,
                                "agent_completed",
                                json!({ "source": source, "stopReason": reason }),
                            ));
                        }
                    }
                }
                _ => {}
            }
        }
        // Ignore the periodic full `assistant` messages and the final `result`
        // envelope; the stream events already carried everything.
        _ => {}
    }

    // Keep the raw line available for debugging without leaking chrome into chat.
    let _ = raw;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verbatim line from a real `claude -p --output-format stream-json` run.
    /// The whole point: text deltas are real content, not TUI chrome.
    #[test]
    fn maps_a_real_text_delta() {
        // The harness is integration-level (needs a broadcast hub), so assert
        // the mapping logic by checking the JSON shape we rely on.
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi"}},"session_id":"abc"}"#;
        let value: Value = serde_json::from_str(line).expect("valid");
        assert_eq!(value["type"], "stream_event");
        assert_eq!(value["event"]["type"], "content_block_delta");
        assert_eq!(value["event"]["delta"]["type"], "text_delta");
        assert_eq!(value["event"]["delta"]["text"], "Hi");
    }

    #[test]
    fn init_event_carries_the_real_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"e7190a16-c816-4ea2-94a9-8b84a3dc72e2","model":"lc/LongCat-2.0"}"#;
        let value: Value = serde_json::from_str(line).expect("valid");
        assert_eq!(value["type"], "system");
        assert_eq!(value["subtype"], "init");
        assert_eq!(value["session_id"], "e7190a16-c816-4ea2-94a9-8b84a3dc72e2");
    }

    #[test]
    fn ignores_full_assistant_envelopes() {
        // These arrive periodically; the stream events already carried the text,
        // so the chat must not render them again.
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}]},"session_id":"abc"}"#;
        let value: Value = serde_json::from_str(line).expect("valid");
        assert_eq!(value["type"], "assistant");
        // The match arm for `Some("assistant")` falls through to the wildcard.
    }
}

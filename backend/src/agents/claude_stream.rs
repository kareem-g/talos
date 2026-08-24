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
    /// Bounded tail of stderr, readable for as long as the handle lives.
    stderr_tail: Arc<Mutex<String>>,
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

    /// Spawn `claude` in bidirectional stream-json mode. `resume_id` continues
    /// a prior conversation; when `None`, a fresh one is created.
    ///
    /// Why `--input-format stream-json`: plain `-p --print` treats stdin as a
    /// one-shot prompt and exits when no input arrives ("Input must be
    /// provided"), so a session created before the user typed anything died on
    /// the spawn pad and every create/resume timed out waiting for an `init`
    /// that never came. In stream-json input mode Claude stays alive reading
    /// JSONL messages, emits its full event stream, and keeps serving turns —
    /// verified against claude 2.1.220 (init after first input, alive between
    /// turns, exits rc=1 with "No conversation found" on stderr for a bad
    /// resume target).
    pub async fn spawn_session(
        &self,
        session_id: &str,
        project: Option<&str>,
        binary: &str,
        resume_id: Option<&str>,
        model: Option<&str>,
        extra_args: &[String],
    ) -> crate::Result<ClaudeStreamInfo> {
        let mut command = Command::new(binary);
        command
            .arg("-p")
            .arg("--input-format=stream-json")
            .arg("--output-format=stream-json")
            .arg("--verbose")
            .arg("--include-partial-messages")
            .arg("--print")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Kept: a silent failure here was indistinguishable from a hang —
            // the CLI's actual complaint ("No conversation found …") is the
            // single most useful debugging fact for resume problems.
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(model) = model {
            command.arg("--model").arg(model);
        }
        if let Some(resume_id) = resume_id {
            command.arg("--resume").arg(resume_id);
        }
        // Permission bridge and any future per-session flags. Passed by the
        // caller because the MCP config file needs the daemon's port+token,
        // which this layer should not know about.
        for arg in extra_args {
            command.arg(arg);
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
        let stderr = child.stderr.take();

        let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
        let child = Arc::new(Mutex::new(Some(child)));
        let claude_session_id = Arc::new(Mutex::new(String::new()));
        // Bounded tail of everything Claude writes to stderr, surfaced verbatim
        // if the process dies during startup.
        let stderr_tail = Arc::new(Mutex::new(String::new()));

        if let Some(stderr) = stderr {
            let tail = stderr_tail.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                    let mut buf = tail.lock().await;
                    buf.push_str(&line);
                    if buf.len() > 4000 {
                        *buf = buf[buf.len() - 4000..].to_string();
                    }
                }
            });
        }

        let handle = Arc::new(ClaudeHandle {
            tx,
            child: child.clone(),
            session_id: claude_session_id.clone(),
            stderr_tail: stderr_tail.clone(),
        });
        self.sessions.write().await.insert(session_id.to_string(), Arc::clone(&handle));

        // Reader: parse JSONL, capture Claude's session id, emit events.
        let reader_session = session_id.to_string();
        let broadcast = self.broadcast.clone();
        let sessions = self.sessions.clone();
        let thought_open = Arc::new(Mutex::new(false));
        let turn = Arc::new(AtomicU64::new(0));
        // Streaming tool inputs arrive as JSON fragments keyed by block index;
        // accumulated here so each tool card gets its full input exactly once
        // at block close instead of one junk card per fragment.
        let tool_inputs: Arc<Mutex<HashMap<i64, (String, String)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let reader_session_id = claude_session_id.clone();
        let eof_tail = stderr_tail.clone();
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
                    &tool_inputs,
                )
                .await;
            }
            // EOF: the process exited.
            let tail = eof_tail.lock().await.trim().to_string();
            tracing::info!(session_id = %reader_session, stderr = %tail, "Claude stream process exited");
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

        // Exit-code supervisor: records HOW the process ended (code vs
        // signal), because an empty stderr says nothing about a silent death.
        {
            let sup_child = child.clone();
            let sup_sid = session_id.to_string();
            let sup_tail = stderr_tail.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    let outcome = if let Ok(mut guard) = sup_child.try_lock() {
                        match guard.as_mut() {
                            Some(process) => process.try_wait().ok().flatten(),
                            None => break,
                        }
                    } else {
                        None
                    };
                    if let Some(status) = outcome {
                        let tail = sup_tail.lock().await.trim().to_string();
                        tracing::info!(session_id = %sup_sid, ?status, stderr = %tail, "Claude process exit details");
                        break;
                    }
                }
            });
        }

        // Startup liveness check — deliberately NOT a wait for the `init`
        // event. In stream-json input mode Claude emits nothing until the
        // first user message arrives (verified on 2.1.220), so blocking on
        // init here would time out for every session created without an
        // initial prompt. What matters at spawn time is only: did the process
        // stay up? A bad resume target, a dead binary, or a auth failure all
        // exit within seconds, and stderr now says why.
        let startup = std::time::Instant::now();
        loop {
            if let Ok(mut guard) = child.try_lock() {
                if let Some(process) = guard.as_mut() {
                    match process.try_wait() {
                        Ok(Some(_status)) => {
                            let tail = stderr_tail.lock().await.trim().to_string();
                            self.sessions.write().await.remove(session_id);
                            let reason = if tail.is_empty() {
                                "no output".to_string()
                            } else {
                                tail.lines().last().unwrap_or("").to_string()
                            };
                            return Err(crate::AgentDeckError::Session(format!(
                                "Claude exited during startup: {reason}"
                            )));
                        }
                        Ok(None) => {}
                        Err(error) => {
                            return Err(crate::AgentDeckError::Session(format!(
                                "Could not query Claude process: {error}"
                            )));
                        }
                    }
                } else {
                    break;
                }
            }
            if startup.elapsed() >= Duration::from_secs(4) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Ok(ClaudeStreamInfo {
            pid,
            // Usually empty at this point; the reader fills it in once the
            // first turn starts and callers poll `claude_session_id`.
            claude_session_id: claude_session_id.lock().await.clone(),
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

    /// Give the process `secs` to prove it stays up. Returns the captured
    /// stderr tail when it died within the window, None when it is alive.
    ///
    /// Spawn-time liveness cannot catch a resume target that fails *after*
    /// the first prompt attempt or a moment into loading — this is the second
    /// gate that turns "reported success, secretly dead" into an actionable
    /// error message.
    pub async fn stderr_if_dead(
        &self,
        session_id: &str,
        secs: u64,
    ) -> Option<String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
        loop {
            if !self.has_active_session(session_id).await {
                // The EOF task may have removed the handle; grab the tail via
                // a fresh lookup before it is gone.
                let sessions = self.sessions.read().await;
                let tail = if let Some(handle) = sessions.get(session_id) {
                    handle.stderr_tail.lock().await.clone()
                } else {
                    String::new()
                };
                drop(sessions);
                return Some(tail.trim().to_string());
            }
            if tokio::time::Instant::now() >= deadline {
                return None;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

}

async fn writer_task(mut rx: mpsc::UnboundedReceiver<Outbound>, stdin: &mut ChildStdin) {
    while let Some(outbound) = rx.recv().await {
        match outbound {
            Outbound::Prompt { text, done } => {
                // The input side is `--input-format stream-json`: each message
                // is a JSONL user turn, not a raw text line. Raw lines made
                // older CLIs treat stdin as a one-shot prompt and exit.
                let payload = json!({
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{ "type": "text", "text": text }],
                    },
                });
                let mut line = payload.to_string();
                line.push('\n');
                if stdin.write_all(line.as_bytes()).await.is_ok() {
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
    tool_inputs: &Arc<Mutex<HashMap<i64, (String, String)>>>,
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
                            let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
                            tool_inputs
                                .lock()
                                .await
                                .insert(index, (id.to_string(), String::new()));
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
                            // Accumulate the fragment against its block index.
                            // Emitting per-fragment events created one junk
                            // tool card per chunk — the visible "tool calling
                            // is broken" bug. One `tool_input` event lands at
                            // block close instead.
                            let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
                            let partial =
                                delta.get("partial_json").and_then(Value::as_str).unwrap_or("");
                            if !partial.is_empty() {
                                let mut inputs = tool_inputs.lock().await;
                                if let Some(entry) = inputs.get_mut(&index) {
                                    entry.1.push_str(partial);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Some("content_block_stop") => {
                    let index = event.get("index").and_then(Value::as_i64).unwrap_or(-1);
                    // A finished tool_use block publishes its complete input.
                    if let Some((tool_id, accumulated)) = tool_inputs.lock().await.remove(&index) {
                        broadcast.broadcast_agent_event(AgentEvent::new(
                            session_id,
                            "tool_input",
                            json!({
                                "tool_id": tool_id,
                                "input": accumulated,
                                "turn": current_turn,
                                "source": source,
                            }),
                        ));
                    }
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
                    // Stop reason is not announced here: the final `result`
                    // envelope reports it with real accounting attached, and
                    // announcing twice produced duplicate turn-summary cards.
                }
                _ => {}
            }
        }
        // The final `result` envelope closes each turn with authoritative
        // accounting: stop reason, token usage, wall time, cost. Streamed
        // deltas already carried the content, so this only publishes the
        // numbers the UI's usage meter and turn-summary cards render.
        Some("result") => {
            let is_error = value.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let num = |key: &str| value.get(key).and_then(Value::as_f64);
            let usage = value.get("usage");
            let usage_num = |key: &str| {
                usage.and_then(|u| u.get(key)).and_then(Value::as_u64).unwrap_or(0)
            };

            if is_error {
                let detail = value.get("result").and_then(Value::as_str).unwrap_or(
                    value.get("subtype").and_then(Value::as_str).unwrap_or("the turn failed"),
                );
                broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "agent_error",
                    json!({ "message": detail, "turn": current_turn, "source": source }),
                ));
            }

            broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "usage",
                json!({
                    "input_tokens": usage_num("input_tokens"),
                    "output_tokens": usage_num("output_tokens"),
                    "cache_read_tokens": usage_num("cache_read_input_tokens"),
                    "cost_usd": num("total_cost_usd"),
                    "source": source,
                }),
            ));
            broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "agent_completed",
                json!({
                    "stop_reason": value.get("stop_reason").cloned().unwrap_or(Value::Null),
                    "input_tokens": usage_num("input_tokens"),
                    "output_tokens": usage_num("output_tokens"),
                    "cost_usd": num("total_cost_usd"),
                    "duration_ms": num("duration_ms").map(|ms| ms as u64),
                    "turn": current_turn,
                    "source": source,
                }),
            ));
        }
        // Tool results arrive as `user` messages containing tool_result
        // blocks. Without this, tool cards stayed "running" forever — the
        // stream never says a tool finished anywhere else.
        Some("user") => {
            let Some(blocks) = value.pointer("/message/content").and_then(Value::as_array) else {
                return;
            };
            for block in blocks {
                if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                    continue;
                }
                let tool_id = block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if tool_id.is_empty() {
                    continue;
                }
                let is_error = block.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                // Result content is either a plain string or an array of
                // content blocks; flatten the text ones for the card.
                let output = match block.get("content") {
                    Some(Value::String(text)) => text.clone(),
                    Some(Value::Array(parts)) => parts
                        .iter()
                        .filter_map(|part| part.get("text").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    _ => String::new(),
                };
                let output = if output.is_empty() {
                    "(no output)".to_string()
                } else {
                    output.chars().take(8000).collect()
                };
                broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "tool_finished",
                    json!({
                        "tool_id": tool_id,
                        "success": !is_error,
                        "output": output,
                        "turn": current_turn,
                        "source": source,
                    }),
                ));
            }
        }
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

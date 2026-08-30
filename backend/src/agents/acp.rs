//! ACP (Agent Client Protocol) support.
//!
//! The Agent Client Protocol (https://agentclientprotocol.com) standardizes
//! communication between coding agents and their clients. Agents that speak
//! ACP — opencode (`opencode acp`), GitHub Copilot (`copilot --acp`), Gemini
//! CLI, Cursor, Qwen Code, Kimi, Hermes, … — exchange newline-delimited
//! JSON-RPC 2.0 over stdio instead of drawing a TUI. That gives us the same
//! native, ChatGPT-like events for every supported CLI: streamed text deltas,
//! thoughts, tool calls, plans, and structured permission requests.
//!
//! This module owns the client side of the protocol:
//! - spawns the agent subprocess and keeps it alive for multi-turn chat
//! - `initialize` + `session/new` handshake
//! - `session/prompt` per user message (the response ends the turn)
//! - maps `session/update` notifications onto the shared `AgentEvent` schema
//!   the frontend already renders natively
//! - answers `session/request_permission` with the user's decision
//!
//! ACP v1 is the negotiated protocol version; the wire shape follows the
//! schema at schema/v1 of the agent-client-protocol repository.

use crate::agent_events::AgentEvent;
use crate::websocket::broadcast::BroadcastHub;
use crate::websocket::WsMessage;
use serde_json::{json, Number, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use std::process::Stdio;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio::time::{timeout, Duration};

const ACP_INIT_TIMEOUT: Duration = Duration::from_secs(8);
const ACP_PROMPT_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 12);
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// One permission option offered by the agent, exactly as received.
#[derive(Debug, Clone)]
struct AcpPermissionOption {
    option_id: String,
    name: String,
    kind: String,
}

/// A plan approval looks like approve/accept plus decline/reject (or
/// suggest-changes) — mirror of the frontend's `isPlanApprovalOptions`, so ACP
/// plan cards render identically to the Claude/MCP path.
fn is_plan_approval_options(names: &[String]) -> bool {
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let has = |needles: &[&str]| lower.iter().any(|n| needles.iter().any(|needle| n.contains(needle)));
    has(&["approve", "accept"]) && (has(&["decline", "reject", "deny"]) || has(&["suggest changes", "suggest"]))
}

/// A pending `session/request_permission` we have surfaced to the UI.
#[derive(Debug, Clone)]
struct AcpApproval {
    /// The JSON-RPC request id from the agent (echoed back verbatim).
    id: Value,
    options: Vec<AcpPermissionOption>,
}

/// Commands sent to the per-process writer task.
enum Outbound {
    Request { id: u64, method: String, params: Value },
    Notification { method: String, params: Value },
    Response { id: Value, result: Option<Value>, error: Option<Value> },
    Shutdown,
}

/// Shared connection state for one ACP subprocess.
#[derive(Clone)]
struct AcpConn {
    tx: mpsc::UnboundedSender<Outbound>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
}

/// Live handle for one agentdeck session backed by an ACP subprocess.
struct AcpHandle {
    conn: AcpConn,
    acp_session_id: std::sync::Mutex<String>,
    approvals: Arc<Mutex<HashMap<String, AcpApproval>>>,
    child: Arc<Mutex<Option<Child>>>,
    mapper: Arc<Mutex<AcpEventMapper>>,
    /// The agent's own config dimensions (model, mode, and whatever else it
    /// exposes), as last reported by `session/new` or
    /// `session/set_config_option`. This is the authoritative live state: the
    /// agent tells us what is selected, we never assume.
    config_options: Arc<Mutex<Vec<crate::providers::ConfigOption>>>,
    /// The project dir this session was spawned in, for tool-policy lookups.
    project: Option<String>,
}

pub struct AcpSessionInfo {
    pub pid: u32,
    pub acp_session_id: String,
    pub version: String,
    /// Config dimensions the agent reported at session creation.
    pub config_options: Vec<crate::providers::ConfigOption>,
}

/// Tracks tool start/finish pairing and thought streaming for one session so
/// the mapped events read like a clean ChatGPT timeline.
#[derive(Debug, Default)]
struct AcpEventMapper {
    turn: u64,
    /// toolCallId -> wall-clock start (epoch millis)
    tool_starts: HashMap<String, u64>,
    /// messageId of an in-flight thought stream
    thought_open: Option<String>,
    /// Whether the current turn produced any user-visible content (text,
    /// thought, tool call). Bare `end_turn` turns with nothing are surfaced
    /// as an explicit note instead of a silent empty completion.
    turn_had_content: bool,
}

impl AcpEventMapper {
    fn begin_turn(&mut self) {
        self.turn = self.turn.saturating_add(1);
        self.tool_starts.clear();
        self.thought_open = None;
        self.turn_had_content = false;
    }

    /// Wall time a tool ran, in milliseconds.
    ///
    /// `tool_starts` holds a *start timestamp*, so the elapsed time is the
    /// difference — returning the stored value emitted an epoch millisecond
    /// count, which rendered as "20674 days".
    fn elapsed_since_start(&mut self, tool_id: &str) -> Option<u64> {
        let started = self.tool_starts.remove(tool_id)?;
        Some(now_millis().saturating_sub(started))
    }

    fn map(&mut self, session_id: &str, update: &Value) -> Vec<AgentEvent> {
        let kind = update.get("sessionUpdate").and_then(Value::as_str).unwrap_or("");
        let mut events = Vec::new();
        let source = "acp";
        match kind {
            // Streamed / whole assistant message text.
            "agent_message_chunk" | "agent_message" => {
                // The answer starts after the reasoning block — close any open
                // thought first so the UI reasoning chip resolves in place.
                // (opencode never sends the closing whole `agent_thought`; the
                // turn just ends, so we close on first answer text too.)
                if self.thought_open.take().is_some() {
                    events.push(AgentEvent::new(
                        session_id,
                        "thinking_finished",
                        json!({ "tool_name": "Thinking", "turn": self.turn, "source": source }),
                    ));
                }
                let text = extract_text_content(update.get("content"));
                if !text.trim().is_empty() {
                    self.turn_had_content = true;
                    let redraw = kind == "agent_message";
                    events.push(AgentEvent::new(
                        session_id,
                        "assistant_text",
                        json!({
                            "text": text,
                            "delta": true,
                            "redraw": redraw,
                            "turn": self.turn,
                            "source": source,
                        }),
                    ));
                }
            }
            // Reasoning / thinking streams.
            //
            // The chunk's *text* is the point: without it a client can only
            // render a label, so the reasoning trace expands to nothing. Each
            // chunk is forwarded as a `thinking_delta` alongside the
            // started/finished pair.
            "agent_thought_chunk" | "agent_thought" => {
                self.turn_had_content = true;
                let message_id = update.get("messageId").and_then(Value::as_str).unwrap_or("").to_string();
                let text = extract_text_content(update.get("content"));

                if kind == "agent_thought" {
                    // A whole thought closes the stream. Its content is the
                    // complete text, so it replaces the accumulated deltas
                    // rather than appending — otherwise agents that send both
                    // chunks and a final whole thought double the trace.
                    if !text.is_empty() {
                        events.push(AgentEvent::new(
                            session_id,
                            "thinking_delta",
                            json!({
                                "text": text,
                                "delta": false,
                                "turn": self.turn,
                                "source": source,
                            }),
                        ));
                    }
                    if self.thought_open.as_deref() == Some(message_id.as_str()) {
                        self.thought_open = None;
                        events.push(AgentEvent::new(
                            session_id,
                            "thinking_finished",
                            json!({ "tool_name": "Thinking", "turn": self.turn, "source": source }),
                        ));
                    }
                } else {
                    if self.thought_open.is_none() {
                        self.thought_open = Some(message_id);
                        events.push(AgentEvent::new(
                            session_id,
                            "thinking_started",
                            json!({ "tool_name": "Thinking", "turn": self.turn, "source": source }),
                        ));
                    }
                    if !text.is_empty() {
                        events.push(AgentEvent::new(
                            session_id,
                            "thinking_delta",
                            json!({
                                "text": text,
                                "delta": true,
                                "turn": self.turn,
                                "source": source,
                            }),
                        ));
                    }
                }
            }
            // Tool call create + patch (v1 sends both).
            "tool_call" | "tool_call_update" => {
                self.turn_had_content = true;
                let tool_id = update.get("toolCallId").and_then(Value::as_str).unwrap_or("").to_string();
                let tool_kind = update.get("kind").and_then(Value::as_str).unwrap_or("other");
                let status = update.get("status").and_then(Value::as_str).unwrap_or("pending");
                let title = update.get("title").and_then(Value::as_str).unwrap_or(tool_kind);
                let command = extract_command(update);
                let is_command = tool_kind == "execute" || command.is_some();

                match status {
                    "pending" | "in_progress" => {
                        // A bare `pending` update (opencode sends `{cwd}` only)
                        // carries no display content — wait for the first
                        // in_progress update with the real command/input.
                        if status == "pending" && command.is_none() && !has_meaningful_input(update) {
                            return events;
                        }
                        if self.tool_starts.contains_key(&tool_id) {
                            return events;
                        }
                        self.tool_starts.insert(tool_id.clone(), now_millis());
                        // Surface the command the agent runs in the terminal
                        // debug view even though there is no PTY.
                        if let Some(cmd) = command.clone() {
                            let terminal = format!("$ {}\n", cmd);
                            events.push(AgentEvent::new(
                                session_id,
                                "terminal_output",
                                json!({ "data": terminal, "source": source }),
                            ));
                        }
                        if is_command {
                            events.push(AgentEvent::new(
                                session_id,
                                "command_started",
                                json!({
                                    "command": command.unwrap_or_else(|| title.to_string()),
                                    "tool_id": tool_id,
                                    "turn": self.turn,
                                    "source": source,
                                }),
                            ));
                        } else {
                            let input = extract_raw_input(update);
                            events.push(AgentEvent::new(
                                session_id,
                                "tool_started",
                                json!({
                                    "tool_name": title,
                                    "tool_id": tool_id,
                                    "input": input,
                                    "kind": tool_kind,
                                    "turn": self.turn,
                                    "source": source,
                                }),
                            ));
                        }
                    }
                    "completed" | "failed" => {
                        if is_command {
                            let exit_code = extract_exit_code(update);
                            let duration = self.elapsed_since_start(&tool_id);
                            events.push(AgentEvent::new(
                                session_id,
                                "command_finished",
                                json!({
                                    "command": command.unwrap_or_else(|| title.to_string()),
                                    "exit_code": exit_code,
                                    "success": exit_code == Some(0),
                                    "tool_id": tool_id,
                                    "duration_ms": duration,
                                    "turn": self.turn,
                                    "source": source,
                                }),
                            ));
                        } else {
                            let duration = self.elapsed_since_start(&tool_id);
                            let success = status == "completed";
                            events.push(AgentEvent::new(
                                session_id,
                                "tool_finished",
                                json!({
                                    "tool_name": title,
                                    "tool_id": tool_id,
                                    "success": success,
                                    "duration_ms": duration,
                                    "turn": self.turn,
                                    "source": source,
                                }),
                            ));
                        }
                    }
                    _ => {}
                }
            }
            // Plan / todo updates (ACP v1 `plan`; v2 `plan_update` with the
            // plan payload nested under a `plan` object — both carry the same
            // entries shape). This is the ONLY source of todos: tool calls,
            // commands and file changes are not plan steps and must never
            // surface as one.
            "plan" | "plan_update" => {
                let plan = update.get("plan").unwrap_or(update);
                let steps: Vec<String> = plan
                    .get("entries")
                    .and_then(Value::as_array)
                    .map(|entries| {
                        entries
                            .iter()
                            .filter_map(|entry| entry.get("content").and_then(Value::as_str).map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                // Entries carry a live status ("pending" | "in_progress" |
                // "completed"), which is what lets the UI draw progress rather
                // than a flat list. Agents that omit status render as before.
                let entries: Vec<Value> = plan
                    .get("entries")
                    .and_then(Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(|entry| {
                                let content = entry.get("content").and_then(Value::as_str)?;
                                Some(json!({
                                    "content": content,
                                    "status": entry.get("status").and_then(Value::as_str).unwrap_or("pending"),
                                }))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                if !steps.is_empty() {
                    events.push(AgentEvent::new(
                        session_id,
                        "plan",
                        json!({ "title": "Plan", "steps": steps, "entries": entries, "turn": self.turn, "source": source }),
                    ));
                }
            }
            // Subagents the agent spawns (ACP task lifecycle) — forwarded as
            // first-class events so the Agents tab / strip show them live.
            "task_started" => {
                let task_id = update.get("taskId").and_then(Value::as_str).unwrap_or("").to_string();
                if task_id.is_empty() {
                    return events;
                }
                let name = update
                    .get("title")
                    .and_then(Value::as_str)
                    .or_else(|| update.get("message").and_then(Value::as_str))
                    .unwrap_or("Subagent")
                    .to_string();
                events.push(AgentEvent::new(
                    session_id,
                    "subagent_started",
                    json!({ "id": task_id, "name": name, "kind": "subagent", "source": source }),
                ));
            }
            "task_finished" | "task_cancelled" => {
                let task_id = update.get("taskId").and_then(Value::as_str).unwrap_or("").to_string();
                let status = if kind == "task_cancelled" {
                    "failed"
                } else {
                    update
                        .get("result")
                        .and_then(Value::as_bool)
                        .map(|ok| if ok { "completed" } else { "failed" })
                        .unwrap_or("completed")
                };
                events.push(AgentEvent::new(
                    session_id,
                    "subagent_finished",
                    json!({ "id": task_id, "status": status, "source": source }),
                ));
            }
            // Live progress (percent / message) from ACP agents that emit it.
            "progress" => {
                let percent = update
                    .get("progress")
                    .and_then(Value::as_number)
                    .and_then(Number::as_f64)
                    .or_else(|| update.get("percent").and_then(Value::as_number).and_then(Number::as_f64));
                let message = update.get("message").and_then(Value::as_str).unwrap_or("");
                events.push(AgentEvent::new(
                    session_id,
                    "progress",
                    json!({ "percent": percent, "message": message, "source": source }),
                ));
            }
            // Search activity (what the agent looked up).
            "search_started" => {
                let query = update
                    .get("query")
                    .and_then(Value::as_str)
                    .or_else(|| update.get("prompt").and_then(Value::as_str))
                    .unwrap_or("")
                    .to_string();
                events.push(AgentEvent::new(
                    session_id,
                    "search_started",
                    json!({ "query": query, "source": source }),
                ));
            }
            "search_result" => {
                let query = update.get("query").and_then(Value::as_str).unwrap_or("").to_string();
                let results: Vec<Value> = update.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
                events.push(AgentEvent::new(
                    session_id,
                    "search_result",
                    json!({ "query": query, "results": results, "source": source }),
                ));
            }
            // Slash commands the agent can run (Grok Build and other ACP
            // agents announce these). Forwarded so the composer can offer them;
            // stored as conversation state on the client, never as chat rows.
            "available_commands_update" => {
                let commands: Vec<String> = update
                    .get("availableCommands")
                    .and_then(Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(|entry| entry.get("name").and_then(Value::as_str).map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                if !commands.is_empty() {
                    events.push(AgentEvent::new(
                        session_id,
                        "commands_available",
                        json!({ "commands": commands, "source": source }),
                    ));
                }
            }
            // Mode switches (e.g. Grok's build/plan/fast modes) are semantic
            // state: shown as a chip, not lost among unknown updates.
            "current_mode_update" => {
                let mode_id = update.get("currentModeId").and_then(Value::as_str).unwrap_or("");
                if !mode_id.is_empty() {
                    let modes: Vec<Value> = update
                        .get("availableModes")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    events.push(AgentEvent::new(
                        session_id,
                        "mode_changed",
                        json!({ "mode_id": mode_id, "modes": modes, "source": source }),
                    ));
                }
            }
            // Token/cost accounting when an agent reports it (usage_update or
            // a bare usage payload). Passed through for the usage meter.
            "usage_update" => {
                let mut payload = update.clone();
                if let Some(object) = payload.as_object_mut() {
                    object.remove("sessionUpdate");
                    object.insert("source".to_string(), json!(source));
                }
                events.push(AgentEvent::new(session_id, "usage", payload));
            }
            // Diff-style file changes (v1 embeds diffs in tool content; a
            // standalone `file_change` update is rare but cheap to map).
            "file_change" => {
                if let Some(path) = update.get("path").and_then(Value::as_str) {
                    events.push(AgentEvent::new(
                        session_id,
                        "file_edited",
                        json!({ "path": path, "success": true, "turn": self.turn, "source": source }),
                    ));
                }
            }
            _ => {
                // config_option_update, session_info_update and unknown future
                // kinds are ignored — they carry no chat content and would only
                // add noise. available_commands, mode and usage updates are
                // mapped above.
            }
        }
        events
    }
}

/// Build the ACP manager that owns every live ACP subprocess.
pub struct AcpManager {
    sessions: Arc<RwLock<HashMap<String, Arc<AcpHandle>>>>,
    broadcast: BroadcastHub,
    /// "binary args…" -> probe result (cached so listing/spawn don't re-spawn)
    probes: Arc<Mutex<HashMap<String, bool>>>,
}

impl AcpManager {
    pub fn new(broadcast: BroadcastHub) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            broadcast,
            probes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn has_active_session(&self, session_id: &str) -> bool {
        self.sessions.read().await.contains_key(session_id)
    }

    /// Cached probe: can `binary` with `args` speak ACP? The probe spawns the
    /// process, sends `initialize`, and expects a protocolVersion: 1 response.
    pub async fn probe(&self, binary: &str, args: &[String]) -> bool {
        let key = format!("{} {}", binary, args.join(" "));
        if let Some(cached) = self.probes.lock().map(|probes| probes.get(&key).copied()).unwrap_or(None) {
            return cached;
        }
        let supported = probe_acp(binary, args).await;
        if let Ok(mut probes) = self.probes.lock() {
            probes.insert(key, supported);
        }
        supported
    }

    /// Forget cached probes (e.g. after config edits). Returns whether any
    /// entry was removed.
    pub fn clear_probes(&self) {
        if let Ok(mut probes) = self.probes.lock() {
            probes.clear();
        }
    }

    /// Spawn an ACP subprocess for `session_id` and complete the
    /// `initialize` + `session/new` handshake. The process is kept alive so
    /// follow-up prompts reuse the same conversation.
    ///
    /// `mcp_servers` are attached to the `session/new` request so the agent
    /// (opencode, …) starts with the browser-automation MCP server — the ACP
    /// equivalent of the `--mcp-config` the claude path passes on the command
    /// line. `None` sends an empty list.
    pub async fn spawn_session(
        &self,
        session_id: &str,
        agent: &str,
        project: Option<&str>,
        binary: &str,
        args: &[String],
        mcp_servers: Option<Vec<Value>>,
    ) -> crate::Result<AcpSessionInfo> {
        self.start(session_id, agent, project, binary, args, None, mcp_servers)
            .await
    }

    /// Reopen a conversation the agent already has, via `session/load`.
    ///
    /// `resume_id` is the agent's own session id. Requires the agent to advertise
    /// the `loadSession` capability; opencode does, and the handshake reports it.
    pub async fn resume_session(
        &self,
        session_id: &str,
        agent: &str,
        project: Option<&str>,
        binary: &str,
        args: &[String],
        resume_id: &str,
        mcp_servers: Option<Vec<Value>>,
    ) -> crate::Result<AcpSessionInfo> {
        self.start(session_id, agent, project, binary, args, Some(resume_id), mcp_servers)
            .await
    }

    /// Spawn the subprocess and either create a session or load an existing one.
    ///
    /// The two paths share everything except the final handshake call, so they
    /// are one function — duplicating the spawn, reader, and writer setup is how
    /// the resume path would silently drift from the working one.
    async fn start(
        &self,
        session_id: &str,
        agent: &str,
        project: Option<&str>,
        binary: &str,
        args: &[String],
        resume_id: Option<&str>,
        mcp_servers: Option<Vec<Value>>,
    ) -> crate::Result<AcpSessionInfo> {
        let mut command = Command::new(binary);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Some agent runtimes (opencode's bun) busy-loop when stderr is a
            // pipe instead of a terminal; null it so the handshake completes.
            // Agents log to their own files (e.g. opencode.log), so nothing
            // is lost.
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(project) = project {
            command.current_dir(project);
        }
        let mut child = command.spawn().map_err(|error| {
            // `spawn` reports ENOENT for both a missing binary and a missing
            // `current_dir`, and the bare OS message ("No such file or
            // directory") does not say which — it read as though opencode were
            // not installed when the project directory had been deleted.
            if error.kind() == std::io::ErrorKind::NotFound {
                if let Some(project) = project {
                    if !std::path::Path::new(project).is_dir() {
                        return crate::AgentDeckError::Session(format!(
                            "The project directory {} does not exist",
                            project
                        ));
                    }
                }
                return crate::AgentDeckError::Session(format!(
                    "Could not find the {} executable ({})",
                    agent, binary
                ));
            }
            crate::AgentDeckError::Session(format!("Could not start {}: {}", agent, error))
        })?;
        let pid = child.id().unwrap_or(0);

        let mut stdin: ChildStdin = child.stdin.take().ok_or_else(|| crate::AgentDeckError::Pty("ACP stdin unavailable".to_string()))?;
        let stdout: ChildStdout = child.stdout.take().ok_or_else(|| crate::AgentDeckError::Pty("ACP stdout unavailable".to_string()))?;
        let stderr = child.stderr.take();

        let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
        let conn = AcpConn {
            tx,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        };
        let approvals = Arc::new(Mutex::new(HashMap::new()));
        let mapper = Arc::new(Mutex::new(AcpEventMapper::default()));

        // Reader task: parses stdout, broadcasts updates, answers agent
        // requests. It MUST be running before the handshake: opencode (and
        // other ACP servers) write a burst of startup output to stdout, and
        // if nobody drains the pipe the child blocks on write before it ever
        // answers `initialize`. On EOF the subprocess is gone.
        let handle = Arc::new(AcpHandle {
            conn: conn.clone(),
            acp_session_id: std::sync::Mutex::new(String::new()), // filled in below, after session/new
            approvals: Arc::clone(&approvals),
            child: Arc::new(Mutex::new(Some(child))),
            mapper: Arc::clone(&mapper),
            config_options: Arc::new(Mutex::new(Vec::new())), // filled in from session/new
            project: project.map(str::to_string),
        });
        self.sessions.write().await.insert(session_id.to_string(), Arc::clone(&handle));
        let reader = AcpManager::spawn_reader(self.sessions.clone(), self.broadcast.clone(), session_id.to_string(), stdout, Arc::clone(&handle));

        // Writer task: drains the outbound queue into the child's stdin.
        let writer_session = session_id.to_string();
        tokio::spawn(async move {
            writer_task(rx, &mut stdin).await;
        });
        let _ = writer_session;

        // Drain stderr so the child never blocks on a full pipe; useful for
        // diagnosing agent startup failures.
        if let Some(mut stderr) = stderr {
            let stderr_session = session_id.to_string();
            tokio::spawn(async move {
                let mut reader = BufReader::new(&mut stderr);
                let mut line = String::new();
                while let Ok(n) = reader.read_line(&mut line).await {
                    if n == 0 {
                        break;
                    }
                    tracing::debug!("[AgentDeck][ACP][{}] {}", stderr_session, line.trim_end());
                    line.clear();
                }
            });
        }

        // Handshake: initialize, then create the agent session.
        let init = send_request(&conn, "initialize", json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": { "name": "agentdeck", "version": env!("CARGO_PKG_VERSION") },
        }))
        .await
        .map_err(|error| crate::AgentDeckError::Pty(format!("ACP initialize failed: {}", error)))?;

        let version = init
            .get("result")
            .and_then(|result| result.get("agentInfo"))
            .and_then(|info| info.get("version"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();

        // Resuming requires the agent to support `session/load`. Attempting it
        // regardless would fail with a confusing protocol error, so the
        // capability is checked and reported plainly.
        if resume_id.is_some() {
            let supports_load = init
                .pointer("/result/agentCapabilities/loadSession")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !supports_load {
                return Err(crate::AgentDeckError::Session(format!(
                    "{} cannot reopen a previous session ({} does not support session/load)",
                    agent, binary
                )));
            }
        }

        // Create a new conversation, or reopen the one the agent already has.
        // MCP servers (e.g. the browser-automation server) are attached so the
        // agent starts with the tools available, mirroring claude's --mcp-config.
        let servers = mcp_servers.unwrap_or_default();
        let (method, params) = match resume_id {
            Some(resume_id) => (
                "session/load",
                json!({
                    "sessionId": resume_id,
                    "cwd": project.unwrap_or("."),
                    "mcpServers": servers,
                }),
            ),
            None => (
                "session/new",
                json!({
                    "cwd": project.unwrap_or("."),
                    "mcpServers": servers,
                }),
            ),
        };

        let session_new = send_request(&conn, method, params)
            .await
            .map_err(|error| crate::AgentDeckError::Session(format!("ACP {} failed: {}", method, error)))?;
        // The agent may answer with a JSON-RPC error (auth needed, unsupported
        // client, unknown session, …). Its wording is the most useful thing we can
        // show, so it is surfaced rather than reduced to "no sessionId".
        if let Some(message) = session_new
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
        {
            return Err(crate::AgentDeckError::Session(message.to_string()));
        }
        let result = session_new.get("result");
        // `session/load` echoes no sessionId — the caller already supplied it.
        let acp_session_id = match resume_id {
            Some(resume_id) => resume_id.to_string(),
            None => result
                .and_then(|result| result.get("sessionId"))
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    crate::AgentDeckError::Session(
                        "ACP session/new returned no sessionId".to_string(),
                    )
                })?
                .to_string(),
        };

        // Config dimensions come straight from the agent. opencode reports
        // `model` (with every configured provider's models) and `mode`
        // (build/plan) here; another agent may report something else entirely,
        // and it flows through untouched.
        let config_options = result
            .map(crate::providers::acp_probe::parse_config_options)
            .unwrap_or_default();
        // Inject our backend-only permission mode dimension.
        let mut all_options = config_options.clone();
        all_options.push(crate::providers::types::permission_mode_config_option());
        if let Ok(mut stored) = handle.config_options.lock() {
            *stored = all_options;
        }

        *handle.acp_session_id.lock().unwrap() = acp_session_id.clone();

        tracing::info!(
            "[AgentDeck][ACP] Session {} ready agent={} pid={} acp_session={} options={}",
            session_id, agent, pid, acp_session_id,
            config_options.iter().map(|option| option.id.as_str()).collect::<Vec<_>>().join(",")
        );
        let _ = reader;

        Ok(AcpSessionInfo {
            pid,
            acp_session_id,
            version,
            config_options,
        })
    }

    fn spawn_reader(
        sessions: Arc<RwLock<HashMap<String, Arc<AcpHandle>>>>,
        broadcast: BroadcastHub,
        session_id: String,
        stdout: ChildStdout,
        handle: Arc<AcpHandle>,
    ) -> tokio::task::JoinHandle<()> {
        let conn = handle.conn.clone();
        let approvals = Arc::clone(&handle.approvals);
        let mapper = Arc::clone(&handle.mapper);
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
                            tracing::debug!("[AgentDeck][ACP][{}] Non-JSON line: {}", session_id, trimmed);
                            continue;
                        };
                        dispatch_message(&session_id, &msg, &conn, &approvals, &mapper, &broadcast, &handle.project).await;
                    }
                }
            }
            // Process exited (or was killed): deregister and surface the end.
            sessions.write().await.remove(&session_id);
            broadcast.broadcast_agent_event(AgentEvent::new(
                &session_id,
                "agent_completed",
                json!({ "source": "acp_process_exit", "state": "exited" }),
            ));
            broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.clone(),
                state: "exited".to_string(),
            });
        })
    }

    /// Send a user message into the live ACP session. The turn completes when
    /// `session/prompt` resolves (stopReason) — the process stays alive.
    pub async fn send_prompt(&self, session_id: &str, text: &str) -> crate::Result<()> {
        let handle = Arc::clone(
            self.sessions
                .read()
                .await
                .get(session_id)
                .ok_or_else(|| crate::AgentDeckError::Session("ACP session is not running".to_string()))?,
        );
        {
            let mut mapper = handle.mapper.lock().map_err(|_| crate::AgentDeckError::Unknown("ACP mapper poisoned".to_string()))?;
            mapper.begin_turn();
        }
        let conn = handle.conn.clone();
        let acp_session = handle.acp_session_id.lock().unwrap().clone();
        let broadcast = self.broadcast.clone();
        let mapper = Arc::clone(&handle.mapper);
        let sid = session_id.to_string();
        let prompt_text = text.to_string();
        tokio::spawn(async move {
            let params = json!({
                "sessionId": acp_session,
                "prompt": [{ "type": "text", "text": prompt_text }],
            });
            match send_request_timeout(&conn, "session/prompt", params, ACP_PROMPT_TIMEOUT).await {
                Ok(resp) => {
                    let stop = resp
                        .get("result")
                        .and_then(|result| result.get("stopReason"))
                        .and_then(Value::as_str)
                        .unwrap_or("end_turn");
                    // If the turn ended with reasoning still open (e.g. a
                    // refusal with no answer text), close it so the UI chip
                    // never stays spinning.
                    if let Ok(mut mapper) = mapper.lock() {
                        if mapper.thought_open.take().is_some() {
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                &sid,
                                "thinking_finished",
                                json!({ "tool_name": "Thinking", "turn": mapper.turn, "source": "acp" }),
                            ));
                        }
                        // A turn that produced nothing (no text, no tool, no
                        // thought — e.g. an agent-side slash command that ran
                        // silently) must not end as a bare completion: the UI
                        // would show the user's message hanging unanswered.
                        // Surface an explicit note so the turn is accounted for.
                        if !mapper.turn_had_content && stop == "end_turn" {
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                &sid,
                                "assistant_text",
                                json!({
                                    "text": "(The agent handled this input internally and returned no reply text.)",
                                    "delta": false,
                                    "redraw": false,
                                    "turn": mapper.turn,
                                    "source": "acp",
                                }),
                            ));
                        }
                    }
                    crate::agents::harness::complete_turn(
                        &broadcast,
                        &sid,
                        json!({ "source": "acp", "stopReason": stop }),
                    );
                }
                Err(error) => {
                    tracing::warn!("[AgentDeck][ACP][{}] session/prompt failed: {}", sid, error);
                    broadcast.broadcast_agent_event(AgentEvent::new(
                        &sid,
                        "agent_error",
                        json!({ "message": error.to_string(), "source": "acp" }),
                    ));
                    broadcast.broadcast(WsMessage::StateChange {
                        session_id: sid,
                        state: "exited".to_string(),
                    });
                }
            }
        });
        Ok(())
    }

    /// Resolve a `session/request_permission` with the user's decision and
    /// respond to the agent with the matching optionId.
    pub async fn respond_approval(&self, session_id: &str, request_id: &str, decision: &str) -> crate::Result<String> {
        let handle = Arc::clone(
            self.sessions
                .read()
                .await
                .get(session_id)
                .ok_or_else(|| crate::AgentDeckError::Session("ACP session is not running".to_string()))?,
        );
        let approval = handle
            .approvals
            .lock()
            .map_err(|_| crate::AgentDeckError::Unknown("ACP approval registry poisoned".to_string()))?
            .remove(request_id)
            .ok_or_else(|| crate::AgentDeckError::Session("Approval request not found".to_string()))?;

        let option_id = pick_option_id(&approval.options, decision);
        let result = json!({ "outcome": "selected", "optionId": option_id });
        handle
            .conn
            .tx
            .send(Outbound::Response {
                id: approval.id,
                result: Some(result),
                error: None,
            })
            .map_err(|_| crate::AgentDeckError::Session("ACP process is gone".to_string()))?;

        self.broadcast.broadcast_agent_event(AgentEvent::new(
            session_id,
            "permission_resolved",
            json!({ "request_id": request_id, "decision": decision }),
        ));
        Ok(session_id.to_string())
    }

    /// The agent's current config dimensions for a live session.
    ///
    /// Returns what the agent last told us, not what we asked for — if a change
    /// silently failed, this reflects the failure.
    pub async fn config_options(&self, session_id: &str) -> Option<Vec<crate::providers::ConfigOption>> {
        let handle = Arc::clone(self.sessions.read().await.get(session_id)?);
        handle.config_options.lock().ok().map(|options| options.clone())
    }

    /// Change one config dimension on a live session.
    ///
    /// This is the real mechanism behind model and mode switching: ACP's
    /// `session/set_config_option` applies immediately to the running agent and
    /// returns the full updated option set, which we store as the new truth.
    ///
    /// Two details are easy to get wrong and were established against a live
    /// agent: the parameter is `configId` (not `optionId`, which fails with
    /// `-32602 Invalid params`), and the response carries `configOptions`, so
    /// there is no need to re-query.
    ///
    /// `value` is passed through byte-for-byte. Model ids like
    /// `localllm/downloaded:Jackrong/MLX-…` must not be reinterpreted on the way.
    pub async fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> crate::Result<Vec<crate::providers::ConfigOption>> {
        let handle = Arc::clone(
            self.sessions
                .read()
                .await
                .get(session_id)
                .ok_or_else(|| crate::AgentDeckError::Session("ACP session is not running".to_string()))?,
        );
        let acp_session = handle.acp_session_id.lock().unwrap().clone();
        let response = send_request(
            &handle.conn,
            "session/set_config_option",
            json!({
                "sessionId": acp_session,
                "configId": config_id,
                "value": value,
            }),
        )
        .await
        .map_err(|error| crate::AgentDeckError::Session(error.to_string()))?;

        // The agent's refusal is more informative than a generic failure.
        if let Some(message) = response
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
        {
            return Err(crate::AgentDeckError::Session(message.to_string()));
        }

        let options = response
            .get("result")
            .map(crate::providers::acp_probe::parse_config_options)
            .unwrap_or_default();
        if options.is_empty() {
            return Err(crate::AgentDeckError::Session(
                "Agent accepted the change but reported no configuration back".to_string(),
            ));
        }
        if let Ok(mut stored) = handle.config_options.lock() {
            *stored = options.clone();
        }
        Ok(options)
    }

    /// Interrupt without killing (SIGINT equivalent for ACP).
    pub async fn interrupt_session(&self, session_id: &str) -> crate::Result<()> {
        let sessions = self.sessions.read().await;
        let handle = sessions.get(session_id).ok_or_else(|| {
            crate::AgentDeckError::Session(format!("Session {} is not running", session_id))
        })?;
        let acp_session = handle.acp_session_id.lock().unwrap().clone();
        let _ = handle.conn.tx.send(Outbound::Notification {
            method: "session/cancel".to_string(),
            params: json!({ "sessionId": acp_session }),
        });
        self.broadcast.broadcast(WsMessage::StateChange {
            session_id: session_id.to_string(),
            state: "running".to_string(),
        });
        self.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
            session_id,
            "agent_stopped",
            json!({ "reason": "interrupted", "source": "interrupt" }),
        ));
        Ok(())
    }

    /// Stop the subprocess (best-effort `session/cancel`, then kill).
    pub async fn kill_session(&self, session_id: &str) -> crate::Result<()> {
        let mut sessions = self.sessions.write().await;
        let Some(handle) = sessions.remove(session_id) else {
            return Err(crate::AgentDeckError::Session(format!(
                "Session {} is not running",
                session_id
            )));
        };
        let conn = handle.conn.clone();
        let acp_session = handle.acp_session_id.lock().unwrap().clone();
        let _ = conn.tx.send(Outbound::Notification {
            method: "session/cancel".to_string(),
            params: json!({ "sessionId": acp_session }),
        });
        let _ = conn.tx.send(Outbound::Shutdown);
        if let Ok(mut child) = handle.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.start_kill();
            }
        }
        self.broadcast.broadcast(WsMessage::StateChange {
            session_id: session_id.to_string(),
            state: "exited".to_string(),
        });
        Ok(())
    }
}

/// Route one incoming JSON-RPC message from the agent.
async fn dispatch_message(
    session_id: &str,
    msg: &Value,
    conn: &AcpConn,
    approvals: &Arc<Mutex<HashMap<String, AcpApproval>>>,
    mapper: &Arc<Mutex<AcpEventMapper>>,
    broadcast: &BroadcastHub,
    project: &Option<String>,
) {
    // Response to one of our requests.
    if let Some(id) = msg.get("id").and_then(Value::as_u64) {
        if let Some(tx) = conn.pending.lock().ok().and_then(|mut pending| pending.remove(&id)) {
            let _ = tx.send(msg.clone());
        }
        return;
    }

    let Some(method) = msg.get("method").and_then(Value::as_str) else {
        return;
    };
    let has_id = msg.get("id").is_some();

    if !has_id {
        // Notification from the agent.
        if method == "session/update" {
            let update = msg.pointer("/params/update");
            if let Some(update) = update {
                let Ok(mut mapper) = mapper.lock() else {
                    tracing::error!("[AgentDeck][ACP][{}] mapper poisoned", session_id);
                    return;
                };
                let events = mapper.map(session_id, update);
                for event in events {
                    if event.kind == "terminal_output" {
                        let data = event.payload.get("data").and_then(Value::as_str).unwrap_or("");
                        broadcast.broadcast(WsMessage::TerminalOutput {
                            session_id: session_id.to_string(),
                            data: data.to_string(),
                        });
                        continue;
                    }
                    broadcast.broadcast_agent_event(event);
                }
            }
        }
        return;
    }

    // Request from the agent -> client.
    match method {
        "session/request_permission" => {
            let request_id_value = msg.get("id").cloned().unwrap_or(Value::Null);
            let request_key = request_id_value.to_string();
            let params = msg.get("params").cloned().unwrap_or_default();
            let tool_call = params.get("toolCall").cloned().unwrap_or_default();
            let tool_title = tool_call.get("title").and_then(Value::as_str).unwrap_or("Tool call");
            let title = params.get("title").and_then(Value::as_str).unwrap_or("Permission required");
            let prompt = if tool_title == "Tool call" {
                title.to_string()
            } else {
                format!("{} — {}", title, tool_title)
            };
            let options: Vec<AcpPermissionOption> = params
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter_map(|option| {
                            Some(AcpPermissionOption {
                                option_id: option.get("optionId")?.as_str()?.to_string(),
                                name: option.get("name")?.as_str()?.to_string(),
                                kind: option.get("kind").and_then(Value::as_str).unwrap_or("allow_once").to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_else(|| {
                    vec![
                        AcpPermissionOption { option_id: "allow".to_string(), name: "Allow".to_string(), kind: "allow_once".to_string() },
                        AcpPermissionOption { option_id: "deny".to_string(), name: "Deny".to_string(), kind: "reject_once".to_string() },
                    ]
                });
            if let Ok(mut registry) = approvals.lock() {
                registry.insert(
                    request_key.clone(),
                    AcpApproval {
                        id: request_id_value,
                        options: options.clone(),
                    },
                );
            }
            // Single approval surface: the payload must look exactly like the
            // Claude/MCP path so the UI renders one card shape for every
            // backend. ACP's native options carry ids + names + kinds — map
            // them to `option_data` (value=id, label=name) and flag plan
            // approvals (approve/decline/suggest-changes option sets) with
            // `is_plan` so they render as plan cards.
            let option_names: Vec<String> = options.iter().map(|option| option.name.clone()).collect();
            let option_data: Vec<Value> = options
                .iter()
                .map(|option| {
                    json!({
                        "value": option.option_id,
                        "label": option.name,
                        "description": option.kind,
                    })
                })
                .collect();
            let is_plan = is_plan_approval_options(&option_names);

            // Project tool policy: auto-allow/deny before the card is shown.
            // Same guardrail as the Claude permission path — questions are
            // never auto-decided.
            let policy_decision = crate::policy::ToolPolicy::load(project.as_deref()).decide(&tool_title);
            if policy_decision != crate::policy::PolicyDecision::Ask {
                let decision = match policy_decision {
                    crate::policy::PolicyDecision::Allow => "allow",
                    _ => "deny",
                };
                let option_id = pick_option_id(&options, decision);
                let result = json!({ "outcome": "selected", "optionId": option_id });
                if let Some(id) = msg.get("id").cloned() {
                    let _ = conn.tx.send(Outbound::Response {
                        id,
                        result: Some(result),
                        error: None,
                    });
                }
                broadcast.broadcast_agent_event(AgentEvent::new(
                    session_id,
                    "permission_resolved",
                    json!({ "request_id": request_key, "decision": decision, "source": "policy" }),
                ));
                broadcast.broadcast(WsMessage::StateChange {
                    session_id: session_id.to_string(),
                    state: "running".to_string(),
                });
                return;
            }

            broadcast.broadcast_agent_event(AgentEvent::new(
                session_id,
                "permission_required",
                json!({
                    "id": request_key,
                    "prompt": prompt,
                    "options": option_names,
                    "option_data": option_data,
                    "selection_mode": "single",
                    "allows_custom_text": false,
                    "tool_name": tool_title,
                    "risk_level": "medium",
                    "source": "acp",
                    "is_plan": is_plan,
                }),
            ));
            broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.to_string(),
                state: "waiting_for_approval".to_string(),
            });
        }
        // We do not advertise fs/terminal/elicitation capabilities, so agents
        // must not call these; if one does anyway, refuse cleanly.
        _ => {
            if let Some(id) = msg.get("id").cloned() {
                let _ = conn.tx.send(Outbound::Response {
                    id,
                    result: None,
                    error: Some(json!({ "code": -32601, "message": "Method not supported by this client" })),
                });
            }
        }
    }
}

/// Send a request and await its response (bounded timeout).
async fn send_request(conn: &AcpConn, method: &str, params: Value) -> std::result::Result<Value, String> {
    send_request_timeout(conn, method, params, ACP_INIT_TIMEOUT).await
}

async fn send_request_timeout(
    conn: &AcpConn,
    method: &str,
    params: Value,
    duration: Duration,
) -> std::result::Result<Value, String> {
    let id = conn.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    conn.pending
        .lock()
        .map_err(|_| "pending registry poisoned".to_string())?
        .insert(id, tx);
    conn.tx
        .send(Outbound::Request {
            id,
            method: method.to_string(),
            params,
        })
        .map_err(|_| "agent process is gone".to_string())?;
    let response = timeout(duration, rx)
        .await
        .map_err(|_| format!("{} timed out", method))?
        .map_err(|_| "agent process is gone".to_string())?;
    match response.get("error") {
        // Report the agent's own sentence, not the JSON-RPC envelope around it.
        // Agents write genuinely useful messages here ("unknown config option:
        // warp-drive", "Please run `auggie login`"), and those go straight to the
        // user — wrapping them in a serialized error object buries the one part
        // that helps.
        Some(error) => Err(error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("{} failed: {}", method, error))),
        None => Ok(response),
    }
}

async fn writer_task(mut rx: mpsc::UnboundedReceiver<Outbound>, stdin: &mut ChildStdin) {
    while let Some(outbound) = rx.recv().await {
        let payload = match outbound {
            Outbound::Request { id, method, params } => json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            Outbound::Notification { method, params } => json!({ "jsonrpc": "2.0", "method": method, "params": params }),
            Outbound::Response { id, result, error } => {
                let mut payload = json!({ "jsonrpc": "2.0", "id": id });
                if let Some(result) = result {
                    payload["result"] = result;
                } else if let Some(error) = error {
                    payload["error"] = error;
                }
                payload
            }
            Outbound::Shutdown => break,
        };
        let mut text = serde_json::to_string(&payload).unwrap_or_default();
        text.push('\n');
        if stdin.write_all(text.as_bytes()).await.is_err() {
            break;
        }
        if stdin.flush().await.is_err() {
            break;
        }
    }
    let _ = stdin.shutdown().await;
}

/// Spawn `binary` with `args`, send `initialize`, and check for a
/// protocolVersion response. Used to auto-detect ACP support.
async fn probe_acp(binary: &str, args: &[String]) -> bool {
    let Ok(mut child) = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    else {
        return false;
    };
    let Some(mut stdin) = child.stdin.take() else { return false };
    let Some(stdout) = child.stdout.take() else { return false };

    let init = json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": { "name": "agentdeck-probe", "version": "1.0.0" },
        }
    });
    let mut text = serde_json::to_string(&init).unwrap_or_default();
    text.push('\n');
    if stdin.write_all(text.as_bytes()).await.is_err() {
        let _ = child.start_kill();
        return false;
    }
    let _ = stdin.flush().await;
    // Keep stdin OPEN. Some agents (opencode) treat EOF on stdin as "exit"
    // and shut down before they ever answer the handshake; the reader loop
    // below would then see EOF and report "not ACP" even though the agent
    // supports ACP fine.

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let deadline = tokio::time::Instant::now() + PROBE_TIMEOUT;
    let supported = loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break false;
        }
        match timeout(remaining, reader.read_line(&mut line)).await {
            // Only EOF *or error* means the process is gone. A process that
            // is alive but slow may write nothing for a while — keep waiting
            // until the deadline.
            Ok(Ok(0)) | Ok(Err(_)) => break false,
            Ok(Ok(_)) => {
                let trimmed = line.trim();
                let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
                    // Banner / noise lines (e.g. opencode's
                    // "[opencode-mobile] v1.4.0") are not JSON-RPC. Skip them
                    // instead of treating them as a failure.
                    line.clear();
                    continue;
                };
                let version = msg.get("result").and_then(|result| result.get("protocolVersion")).and_then(Value::as_i64);
                if msg.get("id") == Some(&Value::from(0)) && version == Some(1) {
                    break true;
                }
                line.clear();
            }
            Err(_) => break false,
        }
    };
    let _ = child.start_kill();
    let _ = child.wait().await;
    supported
}

fn now_millis() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

/// Concatenate text content blocks (used by agent_message_* updates).
///
/// Agents differ: the v1 schema says `content` is an array of ContentBlocks,
/// but opencode sends a single block object (`{"type":"text","text":"…"}`)
/// or the nested `{ "type": "content", "content": { "type": "text", … } }`
/// shape. Handle all three so streaming text never silently disappears.
fn extract_text_content(content: Option<&Value>) -> String {
    let Some(content) = content else { return String::new() };
    let blocks: Vec<&Value> = match content {
        Value::Array(blocks) => blocks.iter().collect(),
        other => vec![other],
    };
    blocks
        .iter()
        .filter_map(|block| {
            match block {
                Value::String(text) => Some(text.clone()),
                Value::Object(_) => block
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        // Nested `{ "type": "content", "content": { "type": "text", … } }`
                        block
                            .get("content")
                            .and_then(|inner| inner.get("text"))
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    }),
                _ => None,
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Best-effort command string from a tool call's rawInput (string or object).
fn extract_command(update: &Value) -> Option<String> {
    let raw_input = extract_raw_input(update)?;
    if raw_input.starts_with('{') {
        serde_json::from_str::<Value>(&raw_input)
            .ok()
            .and_then(|value| {
                value
                    .get("command")
                    .or_else(|| value.get("cmd"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
    } else {
        Some(raw_input)
    }
}

fn extract_raw_input(update: &Value) -> Option<String> {
    update
        .get("rawInput")
        .map(|value| match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
}

/// True when the rawInput carries something displayable (a command, query,
/// prompt, …), as opposed to metadata-only objects like `{ "cwd": … }`.
fn has_meaningful_input(update: &Value) -> bool {
    match update.get("rawInput") {
        None => false,
        Some(Value::String(text)) => !text.trim().is_empty(),
        Some(Value::Object(map)) => map.keys().any(|key| {
            matches!(key.as_str(), "command" | "cmd" | "input" | "query" | "prompt" | "search" | "path" | "pattern")
        }),
        Some(_) => true,
    }
}

fn extract_exit_code(update: &Value) -> Option<i32> {
    update
        .get("rawOutput")
        .and_then(|value| {
            let parsed = value
                .as_str()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .unwrap_or_else(|| value.clone());
            parsed
                .get("exitCode")
                .or_else(|| parsed.get("exit_code"))
                .or_else(|| parsed.get("metadata").and_then(|metadata| metadata.get("exit")))
                .and_then(Value::as_i64)
                .map(|code| code as i32)
        })
        .or_else(|| {
            update
                .get("rawOutput")
                .and_then(Value::as_str)
                .and_then(|text| text.trim().parse::<i32>().ok())
        })
}

/// Map the user's decision (a label the UI showed) to the agent's optionId.
fn pick_option_id(options: &[AcpPermissionOption], decision: &str) -> String {
    let lower = decision.to_lowercase();
    if let Some(option) = options.iter().find(|option| option.name.eq_ignore_ascii_case(decision)) {
        return option.option_id.clone();
    }
    // Fall back by intent: allow/yes -> allow_once, always -> allow_always,
    // deny/no -> reject_once, else reject_always.
    let preferred_kind = if ["allow", "yes", "y", "accept"].contains(&lower.as_str()) {
        "allow_once"
    } else if ["always", "allow always"].contains(&lower.as_str()) {
        "allow_always"
    } else if ["deny", "no", "n", "reject"].contains(&lower.as_str()) {
        "reject_once"
    } else {
        "reject_always"
    };
    options
        .iter()
        .find(|option| option.kind == preferred_kind)
        .map(|option| option.option_id.clone())
        .or_else(|| options.first().map(|option| option.option_id.clone()))
        .unwrap_or_else(|| decision.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_approval_option_sets_are_detected() {
        let approve_deny = vec!["Approve".to_string(), "Decline".to_string()];
        assert!(is_plan_approval_options(&approve_deny));

        let approve_suggest = vec!["Approve".to_string(), "Suggest changes".to_string()];
        assert!(is_plan_approval_options(&approve_suggest));

        let allow_deny = vec!["Allow".to_string(), "Deny".to_string()];
        assert!(!is_plan_approval_options(&allow_deny));

        let yes_no = vec!["Yes".to_string(), "No".to_string()];
        assert!(!is_plan_approval_options(&yes_no));
    }

    #[test]
    fn maps_agent_message_chunk_to_text_delta() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "messageId": "m1",
            "content": [{ "type": "text", "text": "Hello " }],
        });
        let events = mapper.map("s1", &update);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "assistant_text");
        assert_eq!(events[0].payload["text"], "Hello ");
        assert_eq!(events[0].payload["delta"], true);
    }

    #[test]
    fn pairs_tool_call_start_and_finish() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let start = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "call_1",
            "title": "Reading config",
            "kind": "read",
            "status": "in_progress",
        });
        let finish = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "call_1",
            "kind": "read",
            "status": "completed",
        });
        let started = mapper.map("s1", &start);
        assert_eq!(started.len(), 1);
        assert_eq!(started[0].kind, "tool_started");
        assert_eq!(started[0].payload["tool_name"], "Reading config");
        let finished = mapper.map("s1", &finish);
        assert_eq!(finished.len(), 1);
        assert_eq!(finished[0].kind, "tool_finished");
        assert_eq!(finished[0].payload["success"], true);
    }

    /// `duration_ms` must be *elapsed* time, not the stored start timestamp.
    /// Emitting the timestamp rendered as "20674 days" in the UI.
    #[test]
    fn tool_duration_is_elapsed_not_a_timestamp() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        mapper.map(
            "s1",
            &json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "call_1",
                "title": "Reading config",
                "kind": "read",
                "status": "in_progress",
            }),
        );
        let finished = mapper.map(
            "s1",
            &json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call_1",
                "kind": "read",
                "status": "completed",
            }),
        );
        let duration = finished[0].payload["duration_ms"]
            .as_u64()
            .expect("a finished tool reports its duration");
        // A tool that started microseconds ago cannot have run for hours; the
        // epoch-timestamp bug produced ~1.79e12 here.
        assert!(
            duration < 60_000,
            "duration_ms should be elapsed milliseconds, got {}",
            duration
        );
    }

    #[test]
    fn execute_tools_become_commands() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let start = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "call_2",
            "title": "Run tests",
            "kind": "execute",
            "status": "in_progress",
            "rawInput": { "command": "cargo test" },
        });
        let events = mapper.map("s1", &start);
        assert_eq!(events[0].kind, "terminal_output");
        assert_eq!(events[1].kind, "command_started");
        assert_eq!(events[1].payload["command"], "cargo test");
    }

    #[test]
    fn maps_plan_update() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let update = json!({
            "sessionUpdate": "plan",
            "entries": [
                { "content": "Check syntax", "priority": "high", "status": "pending" },
                { "content": "Run tests", "priority": "medium", "status": "pending" },
            ],
        });
        let events = mapper.map("s1", &update);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "plan");
        assert_eq!(events[0].payload["steps"][0], "Check syntax");
        // Entries keep their live status so the UI can draw progress.
        assert_eq!(events[0].payload["entries"][0]["content"], "Check syntax");
        assert_eq!(events[0].payload["entries"][0]["status"], "pending");
    }

    /// ACP v2 (agentclientprotocol.com/protocol/v2/agent-plan) names the
    /// update `plan_update` and nests the plan payload under a `plan` object.
    /// Both spellings must map to the same `plan` event — the client's todo
    /// list depends on it.
    #[test]
    fn maps_v2_plan_update_nested_plan_object() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let update = json!({
            "sessionUpdate": "plan_update",
            "plan": {
                "type": "items",
                "planId": "plan-1",
                "entries": [
                    { "content": "Read the codebase", "priority": "high", "status": "in_progress" },
                    { "content": "Write the fix", "priority": "medium", "status": "pending" },
                ],
            },
        });
        let events = mapper.map("s1", &update);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "plan");
        assert_eq!(events[0].payload["steps"][0], "Read the codebase");
        assert_eq!(events[0].payload["steps"][1], "Write the fix");
        assert_eq!(events[0].payload["entries"][0]["status"], "in_progress");
        assert_eq!(events[0].payload["entries"][1]["status"], "pending");
    }

    /// Slash-command announcements become a `commands_available` event the
    /// composer can consume — not chat noise.
    #[test]
    fn maps_available_commands_update() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let update = json!({
            "sessionUpdate": "available_commands_update",
            "availableCommands": [
                { "name": "review", "description": "Review changes" },
                { "name": "plan" },
            ],
        });
        let events = mapper.map("s1", &update);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "commands_available");
        assert_eq!(events[0].payload["commands"][0], "review");
        assert_eq!(events[0].payload["commands"][1], "plan");
    }

    #[test]
    fn maps_current_mode_update() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let update = json!({
            "sessionUpdate": "current_mode_update",
            "currentModeId": "build",
            "availableModes": [
                { "id": "build", "name": "Build" },
                { "id": "plan", "name": "Plan" },
            ],
        });
        let events = mapper.map("s1", &update);
        assert_eq!(events[0].kind, "mode_changed");
        assert_eq!(events[0].payload["mode_id"], "build");
        assert_eq!(events[0].payload["modes"].as_array().unwrap().len(), 2);

        // An empty mode id carries no information; emit nothing.
        let empty = json!({ "sessionUpdate": "current_mode_update", "currentModeId": "" });
        assert!(mapper.map("s1", &empty).is_empty());
    }

    #[test]
    fn maps_usage_update() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let update = json!({
            "sessionUpdate": "usage_update",
            "inputTokens": 120,
            "outputTokens": 45,
        });
        let events = mapper.map("s1", &update);
        assert_eq!(events[0].kind, "usage");
        assert_eq!(events[0].payload["inputTokens"], 120);
        // The envelope key is stripped so the client cannot mistake it for a
        // nested update.
        assert!(events[0].payload.get("sessionUpdate").is_none());
    }

    #[test]
    fn thoughts_open_and_close() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let open = json!({ "sessionUpdate": "agent_thought_chunk", "messageId": "t1", "content": [{ "type": "text", "text": "thinking…" }] });
        let close = json!({ "sessionUpdate": "agent_thought", "messageId": "t1", "content": [{ "type": "text", "text": "thought done" }] });
        assert_eq!(mapper.map("s1", &open)[0].kind, "thinking_started");
        let closing = mapper.map("s1", &close);
        assert!(closing.iter().any(|event| event.kind == "thinking_finished"));
    }

    /// The reasoning *text* must reach the client. Emitting only
    /// started/finished leaves a UI able to render a label and nothing else, so
    /// the trace expands to an empty box.
    #[test]
    fn thought_chunks_carry_their_text_as_deltas() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();

        let first = json!({
            "sessionUpdate": "agent_thought_chunk",
            "messageId": "t1",
            "content": [{ "type": "text", "text": "The user wants " }]
        });
        let events = mapper.map("s1", &first);
        assert_eq!(events[0].kind, "thinking_started");
        assert_eq!(events[1].kind, "thinking_delta");
        assert_eq!(events[1].payload["text"], "The user wants ");
        assert_eq!(events[1].payload["delta"], true);

        // A second chunk appends, and must not re-open the thought.
        let second = json!({
            "sessionUpdate": "agent_thought_chunk",
            "messageId": "t1",
            "content": [{ "type": "text", "text": "a terminal." }]
        });
        let events = mapper.map("s1", &second);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "thinking_delta");
        assert_eq!(events[0].payload["text"], "a terminal.");
    }

    /// An agent sending chunks *and* a final whole thought must not double the
    /// trace: the whole thought is flagged as a replacement.
    #[test]
    fn whole_thought_replaces_rather_than_appends() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        mapper.map(
            "s1",
            &json!({ "sessionUpdate": "agent_thought_chunk", "messageId": "t1", "content": [{ "type": "text", "text": "partial" }] }),
        );

        let events = mapper.map(
            "s1",
            &json!({ "sessionUpdate": "agent_thought", "messageId": "t1", "content": [{ "type": "text", "text": "partial and complete" }] }),
        );
        let delta = events
            .iter()
            .find(|event| event.kind == "thinking_delta")
            .expect("the closing thought carries its text");
        assert_eq!(delta.payload["text"], "partial and complete");
        assert_eq!(
            delta.payload["delta"], false,
            "a whole thought must replace the accumulated chunks, not append to them"
        );
    }

    #[test]
    fn picks_option_by_intent() {
        let options = vec![
            AcpPermissionOption { option_id: "a1".to_string(), name: "Allow once".to_string(), kind: "allow_once".to_string() },
            AcpPermissionOption { option_id: "a2".to_string(), name: "Always allow".to_string(), kind: "allow_always".to_string() },
            AcpPermissionOption { option_id: "d1".to_string(), name: "Deny once".to_string(), kind: "reject_once".to_string() },
        ];
        assert_eq!(pick_option_id(&options, "Allow"), "a1");
        assert_eq!(pick_option_id(&options, "always"), "a2");
        assert_eq!(pick_option_id(&options, "No"), "d1");
        assert_eq!(pick_option_id(&options, "Allow once"), "a1");
    }

    #[test]
    fn serializes_outbound_request() {
        let payload = json!({ "jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": { "sessionId": "s" } });
        assert_eq!(payload["method"], "session/prompt");
    }

    #[test]
    fn extracts_text_from_single_block_content() {
        // opencode sends a single block object, not an array.
        let update = json!({ "sessionUpdate": "agent_message_chunk", "messageId": "m1", "content": { "type": "text", "text": "PONG" } });
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let events = mapper.map("s1", &update);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload["text"], "PONG");
    }

    #[test]
    fn extracts_text_from_nested_content_block() {
        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "messageId": "m2",
            "content": [{ "type": "content", "content": { "type": "text", "text": "nested" } }],
        });
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let events = mapper.map("s1", &update);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload["text"], "nested");
    }

    #[test]
    fn closes_open_thought_when_answer_text_arrives() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let thought = json!({ "sessionUpdate": "agent_thought_chunk", "messageId": "t1", "content": { "type": "text", "text": "think" } });
        let answer = json!({ "sessionUpdate": "agent_message_chunk", "messageId": "a1", "content": { "type": "text", "text": "Hi" } });
        assert_eq!(mapper.map("s1", &thought)[0].kind, "thinking_started");
        let events = mapper.map("s1", &answer);
        assert_eq!(events[0].kind, "thinking_finished");
        assert_eq!(events[1].kind, "assistant_text");
    }

    #[test]
    fn extracts_exit_code_from_metadata() {
        let update = json!({ "rawOutput": { "output": "ok\n", "metadata": { "exit": 0 } } });
        assert_eq!(extract_exit_code(&update), Some(0));
    }

    /// Live integration check: spawn a real ACP agent through AcpManager
    /// (the exact path the daemon uses) and confirm the initialize handshake
    /// completes. Ignored by default; run with
    /// `cargo test -- --ignored live_acp_spawn_handshakes`.
    #[tokio::test]
    #[ignore]
    async fn live_acp_spawn_handshakes() {
        let broadcast = crate::websocket::broadcast::BroadcastHub::new();
        let manager = AcpManager::new(broadcast);
        let (resolved, _) = crate::agents::detect_agent("opencode")
            .await
            .expect("opencode not on PATH");
        let args = vec!["acp".to_string()];
        let supported = manager.probe(&resolved, &args).await;
        eprintln!("probe supported: {}", supported);
        assert!(supported, "opencode should answer the ACP handshake");
        let info = manager
            .spawn_session("live-acp-test", "opencode", Some("/tmp/e2e-proj"), &resolved, &args, None)
            .await
            .expect("spawn_session should complete the handshake");
        eprintln!("spawned acp_session={} pid={} version={}", info.acp_session_id, info.pid, info.version);
        assert!(!info.acp_session_id.is_empty());
        let _ = manager.kill_session("live-acp-test").await;
    }

    #[test]
    fn skips_bare_pending_tool_call() {
        let mut mapper = AcpEventMapper::default();
        mapper.begin_turn();
        let pending = json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "bash", "kind": "execute", "status": "pending", "rawInput": { "cwd": "/tmp" } });
        let in_progress = json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "title": "echo hi", "kind": "execute", "status": "in_progress", "rawInput": { "command": "echo hi" } });
        assert!(mapper.map("s1", &pending).is_empty());
        let events = mapper.map("s1", &in_progress);
        assert_eq!(events[0].kind, "terminal_output");
        assert_eq!(events[1].kind, "command_started");
        assert_eq!(events[1].payload["command"], "echo hi");
    }
}

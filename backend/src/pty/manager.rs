use crate::{
    agent_events::AgentEvent,
    pty::{PtySession, PtyState},
    websocket::{broadcast::BroadcastHub, WsMessage},
};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot, RwLock};

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, PtySessionHandle>>>,
    pty_system: NativePtySystem,
    broadcast: BroadcastHub,
    pending_approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    terminated: Arc<Mutex<HashSet<String>>>,
    last_states: Arc<Mutex<HashMap<String, String>>>,
    semantic_text: Arc<Mutex<HashMap<String, SemanticTextStream>>>,
    normalizers: Arc<Mutex<HashMap<String, crate::agents::stream::AgentStreamNormalizer>>>,
}

#[derive(Debug, Default)]
struct SemanticTextStream {
    active: bool,
    previous: String,
    submitted: Option<String>,
    turn: u64,
}

pub struct PtySessionHandle {
    pub session: PtySession,
    pub tx: mpsc::UnboundedSender<String>,
    pub resize_tx: mpsc::UnboundedSender<ResizeRequest>,
}

pub struct ResizeRequest {
    pub size: PtySize,
    pub result: oneshot::Sender<Result<(), String>>,
}

#[derive(Debug, Clone)]
pub struct PendingApproval {
    pub id: String,
    pub session_id: String,
    pub prompt: String,
}

impl PtyManager {
    pub fn new(broadcast: BroadcastHub) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            pty_system: NativePtySystem::default(),
            broadcast,
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            terminated: Arc::new(Mutex::new(HashSet::new())),
            last_states: Arc::new(Mutex::new(HashMap::new())),
            semantic_text: Arc::new(Mutex::new(HashMap::new())),
            normalizers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn spawn_session(
        &self,
        session_id: &str,
        agent: &str,
        project: Option<&str>,
        command: Vec<String>,
    ) -> crate::Result<PtySession> {
        let id = session_id.to_string();
        if command.is_empty() || command[0].is_empty() {
            return Err(crate::AgentDeckError::Pty("Agent command is empty".to_string()));
        }

        let pair = self
            .pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| crate::AgentDeckError::Pty(error.to_string()))?;

        let mut command_builder = CommandBuilder::new(&command[0]);
        for arg in &command[1..] {
            command_builder.arg(arg);
        }
        if let Some(project) = project {
            command_builder.cwd(project);
        }
        command_builder.env("TERM", "xterm-256color");

        tracing::info!(
            "[AgentDeck][PTY] Spawning session={} agent={} command={:?} cwd={:?}",
            session_id, agent, command, project
        );

        let mut child = pair.slave.spawn_command(command_builder).map_err(|error| {
            // The underlying error is an opaque ENOENT naming neither the binary
            // nor the directory. Check the likely cause so the user is told
            // which one it is.
            if let Some(project) = project {
                if !std::path::Path::new(project).is_dir() {
                    return crate::AgentDeckError::Session(format!(
                        "The project directory {} does not exist",
                        project
                    ));
                }
            }
            crate::AgentDeckError::Session(format!(
                "Could not start {} ({}): {}",
                agent, command[0], error
            ))
        })?;

        let session = PtySession {
            id: id.clone(),
            agent: agent.to_string(),
            project: project.map(str::to_string),
            pid: child.process_id().unwrap_or(0),
            state: PtyState::Running,
            created_at: chrono::Utc::now(),
        };

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<ResizeRequest>();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| crate::AgentDeckError::Pty(error.to_string()))?;

        let broadcast = self.broadcast.clone();
        let agent_name = agent.to_string();
        let session_id = id.clone();
        let semantic_text = Arc::clone(&self.semantic_text);
        let normalizers = Arc::clone(&self.normalizers);
        tokio::task::spawn_blocking(move || {
            let mut buffer = [0_u8; 4096];
            if let Ok(mut all_normalizers) = normalizers.lock() {
                all_normalizers.insert(session_id.clone(), crate::agents::stream::AgentStreamNormalizer::new(&agent_name));
            }
            loop {
                match std::io::Read::read(&mut reader, &mut buffer) {
                    Ok(size) if size > 0 => {
                        let data = String::from_utf8_lossy(&buffer[..size]).to_string();

                        // This is the raw terminal stream. It is always kept
                        // for the debug view; for CLIs without a structured
                        // hooks protocol it is also parsed into incremental
                        // semantic events so the chat streams live.
                        broadcast.broadcast(WsMessage::TerminalOutput {
                            session_id: session_id.clone(),
                            data: data.clone(),
                        });

                        if agent_name != "claude" {
                            if let Ok(mut all_normalizers) = normalizers.lock() {
                                if let Some(normalizer) = all_normalizers.get_mut(&session_id) {
                                    for event in normalizer.parse(&session_id, &data) {
                                        broadcast.broadcast_agent_event(event);
                                    }
                                }
                            }
                        } else if let Some(text) = crate::agents::agent_text_fragment(&data) {
                            // Claude's hooks provide authoritative tool and
                            // approval events, but its JSONL transcript is
                            // written only after a complete turn. Normalize
                            // its live terminal redraws into true text deltas.
                            let delta = semantic_text
                                .lock()
                                .ok()
                                .and_then(|mut streams| {
                                    let stream = streams.entry(session_id.clone()).or_default();
                                    if !stream.active {
                                        return None;
                                    }
                                    if !looks_like_claude_answer(&text) {
                                        return None;
                                    }
                                    if stream.submitted.as_deref().is_some_and(|submitted| normalize_semantic_text(submitted) == normalize_semantic_text(&text)) {
                                        stream.submitted = None;
                                        return None;
                                    }
                                    if text == stream.previous || stream.previous.ends_with(&text) {
                                        return None;
                                    }
                                    let delta = if text.starts_with(&stream.previous) {
                                        text[stream.previous.len()..].to_string()
                                    } else {
                                        if !stream.previous.is_empty() {
                                            "\n".to_string() + &text
                                        } else {
                                            text.clone()
                                        }
                                    };
                                    stream.previous = text;
                                    (!delta.trim().is_empty()).then_some((delta, stream.turn))
                                });
                            if let Some((delta, turn)) = delta {
                                broadcast.broadcast_agent_event(AgentEvent::new(
                                    &session_id,
                                    "assistant_text",
                                    serde_json::json!({
                                        "text": delta,
                                        "source": "pty",
                                        "turn": turn,
                                        "delta": true,
                                    }),
                                ));
                            }
                        }

                        if agent_name == "claude"
                            && crate::pty::parser::detect_terminal_state(&data) == Some("waiting_for_input")
                        {
                            if let Ok(mut streams) = semantic_text.lock() {
                                if let Some(stream) = streams.get_mut(&session_id) {
                                    stream.active = false;
                                    stream.previous.clear();
                                }
                            }
                        }
                    }
                    Ok(_) | Err(_) => break,
                }
            }
        });

        let broadcast = self.broadcast.clone();
        let terminated = Arc::clone(&self.terminated);
        let sessions = Arc::clone(&self.sessions);
        let normalizers = Arc::clone(&self.normalizers);
        let session_id = id.clone();
        tokio::task::spawn_blocking(move || {
            let was_terminated = terminated
                .lock()
                .map(|mut sessions| sessions.remove(&session_id))
                .unwrap_or(false);
            let state = match child.wait() {
                Ok(_status) if was_terminated => "exited".to_string(),
                Ok(status) if status.success() => "completed".to_string(),
                Ok(status) => format!("error:{}", status.exit_code()),
                Err(_) => "exited".to_string(),
            };
            sessions.blocking_write().remove(&session_id);
            if let Ok(mut normalizers) = normalizers.lock() {
                if let Some(normalizer) = normalizers.get_mut(&session_id) {
                    normalizer.finish_turn();
                }
                normalizers.remove(&session_id);
            }
            broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.clone(),
                state: state.clone(),
            });
            broadcast.broadcast_agent_event(AgentEvent::new(
                &session_id,
                "agent_completed",
                serde_json::json!({ "source": "process_exit", "state": state }),
            ));
        });

        let mut writer = pair
            .master
            .take_writer()
            .map_err(|error| crate::AgentDeckError::Pty(error.to_string()))?;
        tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                let _ = std::io::Write::write_all(&mut writer, data.as_bytes());
                let _ = std::io::Write::flush(&mut writer);
            }
        });

        let master = pair.master;
        tokio::spawn(async move {
            while let Some(request) = resize_rx.recv().await {
                let result = master.resize(request.size).map_err(|error| error.to_string());
                let _ = request.result.send(result);
            }
        });

        self.sessions
            .write()
            .await
            .insert(id.clone(), PtySessionHandle { session: session.clone(), tx, resize_tx });
        self.broadcast.broadcast_agent_event(AgentEvent::new(
            &id,
            "session_started",
            serde_json::json!({ "agent": agent }),
        ));

        Ok(session)
    }

    pub async fn send_input(&self, session_id: &str, data: &str) -> crate::Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(handle) = sessions.get(session_id) {
            let _ = handle.tx.send(data.to_string());
            Ok(())
        } else {
            Err(crate::AgentDeckError::Session(format!(
                "Session {} not found",
                session_id
            )))
        }
    }

    pub async fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> crate::Result<()> {
        let (result_tx, result_rx) = oneshot::channel();
        {
            let sessions = self.sessions.read().await;
            let handle = sessions.get(session_id).ok_or_else(|| {
                crate::AgentDeckError::Session(format!("Session {} not found", session_id))
            })?;
            handle
                .resize_tx
                .send(ResizeRequest {
                    size: PtySize { rows, cols, pixel_width: 0, pixel_height: 0 },
                    result: result_tx,
                })
                .map_err(|_| crate::AgentDeckError::Pty("PTY resize channel closed".to_string()))?;
        }

        match tokio::time::timeout(tokio::time::Duration::from_secs(2), result_rx).await {
            Ok(Ok(Ok(()))) => Ok(()),
            Ok(Ok(Err(error))) => Err(crate::AgentDeckError::Pty(error)),
            Ok(Err(_)) => Err(crate::AgentDeckError::Pty("PTY resize worker stopped".to_string())),
            Err(_) => Err(crate::AgentDeckError::Pty("PTY resize timed out".to_string())),
        }
    }

    /// True when the session currently has a live PTY process. Used by the
    /// resume endpoint to avoid spawning a duplicate Claude process.
    pub async fn has_active_session(&self, session_id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions.contains_key(session_id)
    }

    /// Live standalone terminals (`term-*`), for the right sidebar's
    /// Terminals tab. Not agent sessions — raw shells.
    pub async fn list_terminals(&self) -> Vec<PtySession> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .filter(|handle| handle.session.id.starts_with("term-"))
            .map(|handle| handle.session.clone())
            .collect()
    }

    /// Begin one chat-generated assistant turn. Claude's terminal uses screen
    /// redraws, so this resets the delta baseline before the next response.
    pub fn begin_assistant_turn(&self, session_id: &str, submitted: &str) {
        if let Ok(mut normalizers) = self.normalizers.lock() {
            if let Some(normalizer) = normalizers.get_mut(session_id) {
                normalizer.begin_turn(submitted);
            }
        }
        if let Ok(mut streams) = self.semantic_text.lock() {
            let stream = streams.entry(session_id.to_string()).or_default();
            stream.active = true;
            stream.previous.clear();
            stream.submitted = Some(submitted.to_string());
            stream.turn = stream.turn.saturating_add(1);
        }
        if let Ok(mut states) = self.last_states.lock() {
            states.insert(session_id.to_string(), "running".to_string());
        }
    }

    /// Stop accepting PTY text as assistant output once the provider marks a
    /// turn complete. Idle prompt redraws must remain terminal-only.
    pub fn end_assistant_turn(&self, session_id: &str) {
        if let Ok(mut streams) = self.semantic_text.lock() {
            if let Some(stream) = streams.get_mut(session_id) {
                stream.active = false;
                stream.previous.clear();
            }
        }
    }

    pub async fn send_input_when_ready(&self, session_id: &str, data: &str) -> crate::Result<()> {
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(8);
        loop {
            let ready = self
                .last_states
                .lock()
                .map(|states| {
                    matches!(
                        states.get(session_id).map(String::as_str),
                        Some("waiting_for_input") | Some("waiting_for_approval")
                    )
                })
                .unwrap_or(false);
            if ready || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        self.send_input(session_id, data).await
    }

    pub fn mark_waiting_for_input(&self, session_id: &str) {
        if let Ok(mut states) = self.last_states.lock() {
            states.insert(session_id.to_string(), "waiting_for_input".to_string());
        }
    }

    pub fn register_approval(&self, approval: PendingApproval) {
        if let Ok(mut approvals) = self.pending_approvals.lock() {
            approvals.insert(approval.id.clone(), approval);
        }
    }

    pub async fn answer_question(
        &self,
        question: &crate::questions::Question,
        answer: &crate::questions::QuestionAnswer,
    ) -> crate::Result<()> {
        let agent = self
            .sessions
            .read()
            .await
            .get(&question.session_id)
            .map(|handle| handle.session.agent.clone())
            .ok_or_else(|| crate::AgentDeckError::Session("Session is no longer running".to_string()))?;
        let inputs = crate::agents::question_input(&agent, question, answer)?;
        for (index, input) in inputs.into_iter().enumerate() {
            self.send_input(&question.session_id, &input).await?;
            if index == 0 {
                tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            }
        }
        Ok(())
    }

    pub async fn kill_session(&self, session_id: &str) -> crate::Result<()> {
        let mut sessions = self.sessions.write().await;
        if let Some(handle) = sessions.remove(session_id) {
            if let Ok(mut terminated) = self.terminated.lock() {
                terminated.insert(session_id.to_string());
            }
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(handle.session.pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
            self.broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.to_string(),
                state: "exited".to_string(),
            });
            Ok(())
        } else {
            Err(crate::AgentDeckError::Session(format!(
                "Session {} is not running",
                session_id
            )))
        }
    }

    pub async fn respond_to_approval(&self, request_id: &str, decision: &str) -> crate::Result<String> {
        let approval = self
            .pending_approvals
            .lock()
            .map_err(|_| crate::AgentDeckError::Session("Approval registry unavailable".to_string()))?
            .remove(request_id)
            .ok_or_else(|| crate::AgentDeckError::Session("Approval request not found".to_string()))?;

        let response = match decision {
            "allow" | "yes" => "y\r",
            "always" => "always\r",
            "deny" | "no" => "n\r",
            _ => return Err(crate::AgentDeckError::Session("Unknown approval decision".to_string())),
        };
        self.send_input(&approval.session_id, response).await?;
        Ok(approval.session_id)
    }

    pub fn pending_approvals(&self) -> Vec<PendingApproval> {
        self.pending_approvals
            .lock()
            .map(|approvals| approvals.values().cloned().collect())
            .unwrap_or_default()
    }
}

/// Claude's TUI redraws prompts, status lines, tool labels and completion
/// timing alongside its answer. Only promote lines that look like actual
/// assistant prose into the semantic stream; raw output remains intact in
/// xterm regardless.
fn normalize_semantic_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

#[cfg(test)]
mod semantic_tests {
    use super::normalize_semantic_text;

    #[test]
    fn normalizes_terminal_echo_for_comparison() {
        assert_eq!(normalize_semantic_text(" Hello   Chat\n"), "hello chat");
        assert_eq!(normalize_semantic_text("hello chat"), "hello chat");
    }
}

fn looks_like_claude_answer(text: &str) -> bool {
    let lower = text.to_lowercase();
    ![
        "running stop hook",
        "manual mode",
        "agent",
        "tip:",
        "waiting for your input",
        "worked for",
        "thought for",
        "churned for",
        "running command",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

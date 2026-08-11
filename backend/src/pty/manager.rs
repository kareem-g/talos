use crate::{
    agent_events::AgentEvent,
    pty::{PtySession, PtyState},
    websocket::{broadcast::BroadcastHub, WsMessage},
};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, RwLock};

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, PtySessionHandle>>>,
    pty_system: NativePtySystem,
    broadcast: BroadcastHub,
    pending_approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    terminated: Arc<Mutex<HashSet<String>>>,
    last_states: Arc<Mutex<HashMap<String, String>>>,
}

pub struct PtySessionHandle {
    pub session: PtySession,
    pub tx: mpsc::UnboundedSender<String>,
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

        let mut child = pair
            .slave
            .spawn_command(command_builder)
            .map_err(|error| crate::AgentDeckError::Pty(error.to_string()))?;

        let session = PtySession {
            id: id.clone(),
            agent: agent.to_string(),
            project: project.map(str::to_string),
            pid: child.process_id().unwrap_or(0),
            state: PtyState::Running,
            created_at: chrono::Utc::now(),
        };

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| crate::AgentDeckError::Pty(error.to_string()))?;

        let broadcast = self.broadcast.clone();
        let agent_name = agent.to_string();
        let session_id = id.clone();
        let last_states = Arc::clone(&self.last_states);
        tokio::task::spawn_blocking(move || {
            let mut buffer = [0_u8; 4096];
            let mut fallback_started = false;
            loop {
                match std::io::Read::read(&mut reader, &mut buffer) {
                    Ok(size) if size > 0 => {
                        let data = String::from_utf8_lossy(&buffer[..size]).to_string();

                        // This is the only terminal stream. It is never converted
                        // into an assistant message or semantic tool event.
                        broadcast.broadcast(WsMessage::TerminalOutput {
                            session_id: session_id.clone(),
                            data,
                        });

                        if agent_name != "claude" && !fallback_started {
                            fallback_started = true;
                            if let Ok(mut states) = last_states.lock() {
                                states.insert(session_id.clone(), "running".to_string());
                            }
                            broadcast.broadcast_agent_event(AgentEvent::new(
                                &session_id,
                                "agent_status",
                                serde_json::json!({ "state": "running", "fallback": true }),
                            ));
                        }
                    }
                    Ok(_) | Err(_) => break,
                }
            }
        });

        let broadcast = self.broadcast.clone();
        let terminated = Arc::clone(&self.terminated);
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

        self.sessions
            .write()
            .await
            .insert(id.clone(), PtySessionHandle { session: session.clone(), tx });
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

pub mod server;
pub mod mdns;

use crate::config::{AppState, Config};
use crate::auth::devices::DeviceStore;
use crate::pty::manager::PtyManager;
use crate::sessions::manager::SessionManager;
use crate::websocket::broadcast::BroadcastHub;
use crate::Result;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct Daemon {
    config: Arc<RwLock<Config>>,
}

impl Daemon {
    pub async fn new(config: Config) -> Result<Self> {
        Ok(Self {
            config: Arc::new(RwLock::new(config)),
        })
    }

    pub async fn run(
        &self,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Result<()> {
        // Set up database
        let data_dir = Self::data_dir();
        tokio::fs::create_dir_all(&data_dir).await?;
        let db_path = data_dir.join("agentdeck.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

        // WAL keeps hook writes from blocking on PTY output writes; the
        // busy timeout covers the rare writer-vs-writer overlap.
        let options = sqlx::sqlite::SqliteConnectOptions::from_str(&db_url)?
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(5));

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        // Run migrations
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| crate::AgentDeckError::Migration(e.to_string()))?;

        // Create subsystems
        let devices = Arc::new(DeviceStore::new(pool.clone()));
        let session_manager = Arc::new(SessionManager::new(pool).await?);
        let broadcast = BroadcastHub::new();
        let pty_manager = Arc::new(PtyManager::new(broadcast.clone()));
        let state = Arc::new(AppState {
            config: Arc::clone(&self.config),
            session_manager: Arc::clone(&session_manager),
            pty_manager,
            devices,
            hook_tokens: Arc::new(RwLock::new(std::collections::HashMap::new())),
            hook_starts: Arc::new(RwLock::new(std::collections::HashMap::new())),
            broadcast,
        });

        // Persist terminal bytes and semantic streams into separate stores.
        {
            let sm = Arc::clone(&session_manager);
            let event_broadcast = state.broadcast.clone();
            let mut rx = state.broadcast.subscribe();
            tokio::spawn(async move {
                use crate::websocket::WsMessage;
                while let Ok(broadcast_event) = rx.recv().await {
                    match broadcast_event.message {
                        WsMessage::TerminalOutput { session_id, data } => {
                            if !data.is_empty() {
                                if let Err(e) = sm.insert_terminal_output(&session_id, broadcast_event.id, &data).await {
                                    tracing::error!("[AgentDeck][Persistence] Failed to persist raw output: {}", e);
                                }
                            }
                        }
                        WsMessage::Message { message } => {
                            if let Err(e) = sm.insert_message(&message).await {
                                tracing::error!("[AgentDeck][Persistence] Failed to persist message: {}", e);
                            }
                        }
                        WsMessage::AgentEvent { mut event } => {
                            if event.sequence == 0 {
                                event.sequence = broadcast_event.id;
                            }
                            if let Err(e) = sm.insert_agent_event(&event).await {
                                tracing::error!("[AgentDeck][Persistence] Failed to persist agent event: {}", e);
                            }
                        }
                        WsMessage::TranscriptChunk { session_id, chunk, kind } => {
                            let kind_str = match kind {
                                crate::websocket::TranscriptKind::User => "user",
                                crate::websocket::TranscriptKind::System => "system",
                                crate::websocket::TranscriptKind::Plan => "plan",
                                crate::websocket::TranscriptKind::Diff => "diff",
                                crate::websocket::TranscriptKind::ToolCall => "activity",
                                crate::websocket::TranscriptKind::Approval => "approval",
                                crate::websocket::TranscriptKind::Stdout
                                | crate::websocket::TranscriptKind::Stderr => "agent",
                            };
                            if !chunk.trim().is_empty() {
                                if let Err(e) = sm.insert_transcript(&session_id, kind_str, &chunk).await {
                                    tracing::error!("[AgentDeck][Persistence] Failed to persist transcript: {}", e);
                                }
                            }
                        }
                        WsMessage::ApprovalRequest { session_id, request } => {
                            let event = crate::agent_events::AgentEvent::new(
                                &session_id,
                                "permission_required",
                                serde_json::to_value(&request).unwrap_or_default(),
                            );
                            if let Err(e) = sm.insert_agent_event(&event).await {
                                tracing::error!("[AgentDeck][Persistence] Failed to persist approval event: {}", e);
                            }
                            if let Err(e) = sm.update_status(&session_id, crate::sessions::SessionStatus::WaitingForApproval).await {
                                tracing::error!("[AgentDeck][Session] Failed to mark approval state: {}", e);
                            }
                        }
                        WsMessage::ApprovalResolved { session_id, request_id, decision } => {
                            let event = crate::agent_events::AgentEvent::new(
                                &session_id,
                                "permission_resolved",
                                serde_json::json!({ "request_id": request_id, "decision": decision }),
                            );
                            if let Err(e) = sm.insert_agent_event(&event).await {
                                tracing::error!("[AgentDeck][Persistence] Failed to persist approval response: {}", e);
                            }
                            if let Err(e) = sm.update_status(&session_id, crate::sessions::SessionStatus::Running).await {
                                tracing::error!("[AgentDeck][Session] Failed to resume after approval: {}", e);
                            }
                        }
                        WsMessage::StateChange { session_id, state } => {
                            let status = match state.as_str() {
                                "running" => crate::sessions::SessionStatus::Running,
                                "waiting_for_approval" => crate::sessions::SessionStatus::WaitingForApproval,
                                "waiting_for_input" => crate::sessions::SessionStatus::WaitingForInput,
                                "idle" => crate::sessions::SessionStatus::Idle,
                                "error" => crate::sessions::SessionStatus::Error,
                                _ => crate::sessions::SessionStatus::Exited,
                            };
                            if let Err(e) = sm.update_status(&session_id, status).await {
                                tracing::error!("[AgentDeck][Session] Failed to persist state change: {}", e);
                            }
                            if state_is_terminal(&state) {
                                if let Ok(question_ids) = sm.cancel_questions(&session_id).await {
                                    for question_id in question_ids {
                                        event_broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
                                            &session_id,
                                            "question_cancelled",
                                            serde_json::json!({ "question_id": question_id, "reason": "session_stopped" }),
                                        ));
                                    }
                                }
                            }
                        }
                        WsMessage::Activity { session_id, activity } => {
                            let event = crate::agent_events::AgentEvent::new(
                                &session_id,
                                activity.kind.clone(),
                                serde_json::to_value(&activity).unwrap_or_default(),
                            );
                            if let Err(e) = sm.insert_agent_event(&event).await {
                                tracing::error!("[AgentDeck][Persistence] Failed to persist activity: {}", e);
                            }
                        }
                        _ => {}
                    }
                }
            });
        }

        let cfg = self.config.read().await;
        let settings = cfg.settings().clone();
        drop(cfg);

        // Start mDNS service
        let mdns_handle = mdns::start_service(&settings).await.ok();

        // Start HTTP/WebSocket server
        let state_clone = Arc::clone(&state);
        let server_handle = server::start(state_clone, settings.server.clone()).await?;

        // Wait for shutdown signal
        shutdown.changed().await.ok();

        // Graceful shutdown
        if let Some(h) = mdns_handle {
            h.abort();
        }
        server_handle.abort();

        Ok(())
    }

    fn data_dir() -> PathBuf {
        let xdg_dirs = xdg::BaseDirectories::with_prefix("agentdeck")
            .expect("Failed to initialize XDG directories");
        xdg_dirs.get_data_home()
    }
}

fn state_is_terminal(state: &str) -> bool {
    state == "completed" || state == "exited" || state.starts_with("error")
}

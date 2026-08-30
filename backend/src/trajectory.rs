//! Trajectory record and replay.
//!
//! A *trajectory* is the ordered, append-only JSONL recording of every
//! `WsMessage` a session produced — the exact stream the dashboard would have
//! rendered. Recording is a subscriber on the shared [`BroadcastHub`], so it
//! sees every backend (claude_stream, api, acp, pi_stream, pty) through one
//! code path.
//!
//! Replay reads a trajectory file and re-broadcasts each line through a hub,
//! so any connected WebSocket client renders the run identically without
//! re-running the agent. This is the foundation the memory feature will read:
//! the file is a cheap-to-scan, line-oriented corpus of what actually
//! happened.

use crate::Result;
use crate::agent_events::AgentEvent;
use crate::websocket::WsMessage;
use crate::websocket::broadcast::BroadcastHub;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

/// One live recording: the token used to stop it, the task that owns the file
/// handle, and the file path it is being written to.
struct TrajectorySink {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
    path: PathBuf,
}

/// Records sessions' event streams to JSONL files. One recorder is shared
/// across all sessions; each live session holds one entry in the sink map.
#[derive(Default)]
pub struct TrajectoryRecorder {
    sinks: Arc<RwLock<HashMap<String, TrajectorySink>>>,
}

impl TrajectoryRecorder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start recording `session_id` to `path`. Idempotent: if the session is
    /// already being recorded, returns the existing path unchanged.
    pub async fn start(
        &self,
        hub: &BroadcastHub,
        session_id: &str,
        path: PathBuf,
    ) -> Result<PathBuf> {
        self.start_with(hub, session_id, path, false).await
    }

    /// Start (or resume) recording a session's **canonical log**: the stable
    /// `<session-id>.jsonl` file, opened in append mode so it stays continuous
    /// across daemon restarts. Idempotent. This is the harness's source of
    /// truth for a session's stream — the DB is a query index over it.
    pub async fn start_append(&self, hub: &BroadcastHub, session_id: &str) -> Result<PathBuf> {
        let path = session_log_path(session_id)?;
        self.start_with(hub, session_id, path, true).await
    }

    async fn start_with(
        &self,
        hub: &BroadcastHub,
        session_id: &str,
        path: PathBuf,
        append: bool,
    ) -> Result<PathBuf> {
        let mut sinks = self.sinks.write().await;
        if let Some(existing) = sinks.get(session_id) {
            return Ok(existing.path.clone());
        }
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let file = if append {
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .await?
        } else {
            File::create(&path).await?
        };
        let mut writer = BufWriter::new(file);
        let mut rx = hub.subscribe();
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task_session_id = session_id.to_string();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = task_cancel.cancelled() => break,
                    recv = rx.recv() => {
                        match recv {
                            Ok(broadcast_event) => {
                                if !session_id_matches(&broadcast_event.message, &task_session_id) {
                                    continue;
                                }
                                let mut line = match serde_json::to_string(&broadcast_event.message) {
                                    Ok(line) => line,
                                    Err(_) => continue,
                                };
                                line.push('\n');
                                if writer.write_all(line.as_bytes()).await.is_err() {
                                    break;
                                }
                                // The canonical log is read live by the history
                                // endpoint, so it must be flushed per event —
                                // not just on stop.
                                if writer.flush().await.is_err() {
                                    break;
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                                // A lagging recorder drops events (gaps in the
                                // trajectory). Not fatal — log and continue.
                                tracing::warn!(
                                    "[AgentDeck][Trajectory] recorder lagged for {task_session_id}"
                                );
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                }
            }
            // Drain anything still buffered so a stop() issued right after a
            // broadcast doesn't drop the tail of the run.
            while let Ok(broadcast_event) = rx.try_recv() {
                if session_id_matches(&broadcast_event.message, &task_session_id)
                    && let Ok(line) = serde_json::to_string(&broadcast_event.message)
                {
                    let mut line = line;
                    line.push('\n');
                    if writer.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                }
            }
            let _ = writer.flush().await;
        });
        sinks.insert(
            session_id.to_string(),
            TrajectorySink {
                cancel,
                task,
                path: path.clone(),
            },
        );
        Ok(path)
    }

    /// Stop recording `session_id`, flush its file, and return the path it
    /// was written to — or `None` if the session was not being recorded.
    pub async fn stop(&self, session_id: &str) -> Result<Option<PathBuf>> {
        let mut sinks = self.sinks.write().await;
        let Some(sink) = sinks.remove(session_id) else {
            return Ok(None);
        };
        sink.cancel.cancel();
        let _ = sink.task.await;
        Ok(Some(sink.path))
    }

    pub async fn is_recording(&self, session_id: &str) -> bool {
        self.sinks.read().await.contains_key(session_id)
    }

    /// The number of sessions currently being recorded.
    pub async fn active_count(&self) -> usize {
        self.sinks.read().await.len()
    }
}

/// Reads a trajectory file and re-broadcasts every line through a hub.
pub struct TrajectoryPlayer;

impl TrajectoryPlayer {
    /// Replay `path` through `hub`, so any connected WebSocket client renders
    /// the run. When `into_session` is `Some`, all session-targeted messages
    /// are rewritten to that session instead of their recorded one — the way
    /// to watch a run in a clean, empty session. Returns the number of lines
    /// replayed.
    pub async fn replay(
        path: &Path,
        hub: &BroadcastHub,
        into_session: Option<&str>,
    ) -> Result<u64> {
        let file = File::open(path).await?;
        let mut reader = BufReader::new(file);
        let mut line = String::new();
        let mut count = 0u64;
        loop {
            line.clear();
            let n = reader.read_line(&mut line).await?;
            if n == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<WsMessage>(trimmed) else {
                // Tolerate a corrupt line instead of failing the whole replay.
                continue;
            };
            let message = match into_session {
                Some(target) => retarget(message, target),
                None => message,
            };
            match message {
                WsMessage::AgentEvent { event } => {
                    // Route through broadcast_agent_event so the event gets a
                    // fresh hub-assigned sequence for client dedup.
                    hub.broadcast_agent_event(event);
                }
                other => {
                    hub.broadcast(other);
                }
            }
            count += 1;
        }
        Ok(count)
    }
}

/// The session id a server->client message belongs to, if any.
pub fn session_id_of(message: &WsMessage) -> Option<&str> {
    match message {
        WsMessage::AgentEvent { event } => Some(&event.session_id),
        WsMessage::Message { message } => Some(&message.session_id),
        WsMessage::SessionUpdate { session } => Some(&session.id),
        WsMessage::SessionDeleted { session_id } => Some(session_id),
        WsMessage::TerminalOutput { session_id, .. } => Some(session_id),
        WsMessage::TerminalResized { session_id, .. } => Some(session_id),
        WsMessage::TranscriptChunk { session_id, .. } => Some(session_id),
        WsMessage::ApprovalRequest { session_id, .. } => Some(session_id),
        WsMessage::ApprovalResolved { session_id, .. } => Some(session_id),
        WsMessage::Activity { session_id, .. } => Some(session_id),
        WsMessage::StateChange { session_id, .. } => Some(session_id),
        WsMessage::SessionError { session_id, .. } => Some(session_id),
        // Client->server and global messages carry no session.
        _ => None,
    }
}

fn session_id_matches(message: &WsMessage, session_id: &str) -> bool {
    session_id_of(message) == Some(session_id)
}

/// Rewrite a message's session id to `target`, for replaying a recording into
/// a different session.
fn retarget(message: WsMessage, target: &str) -> WsMessage {
    match message {
        WsMessage::AgentEvent { mut event } => {
            event.session_id = target.to_string();
            WsMessage::AgentEvent { event }
        }
        WsMessage::Message { mut message } => {
            message.session_id = target.to_string();
            WsMessage::Message { message }
        }
        WsMessage::SessionUpdate { mut session } => {
            session.id = target.to_string();
            WsMessage::SessionUpdate { session }
        }
        WsMessage::SessionDeleted { session_id: _ } => WsMessage::SessionDeleted {
            session_id: target.to_string(),
        },
        WsMessage::TerminalOutput {
            session_id: _,
            data,
        } => WsMessage::TerminalOutput {
            session_id: target.to_string(),
            data,
        },
        WsMessage::TerminalResized {
            session_id: _,
            cols,
            rows,
        } => WsMessage::TerminalResized {
            session_id: target.to_string(),
            cols,
            rows,
        },
        WsMessage::TranscriptChunk {
            session_id: _,
            chunk,
            kind,
        } => WsMessage::TranscriptChunk {
            session_id: target.to_string(),
            chunk,
            kind,
        },
        WsMessage::ApprovalRequest {
            session_id: _,
            request,
        } => WsMessage::ApprovalRequest {
            session_id: target.to_string(),
            request,
        },
        WsMessage::ApprovalResolved {
            session_id: _,
            request_id,
            decision,
        } => WsMessage::ApprovalResolved {
            session_id: target.to_string(),
            request_id,
            decision,
        },
        WsMessage::Activity {
            session_id: _,
            activity,
        } => WsMessage::Activity {
            session_id: target.to_string(),
            activity,
        },
        WsMessage::StateChange {
            session_id: _,
            state,
        } => WsMessage::StateChange {
            session_id: target.to_string(),
            state,
        },
        WsMessage::SessionError {
            session_id: _,
            code,
            message,
        } => WsMessage::SessionError {
            session_id: target.to_string(),
            code,
            message,
        },
        other => other,
    }
}

/// Default trajectory directory: `$XDG_DATA_HOME/agentdeck/trajectories`.
pub fn default_dir() -> Result<PathBuf> {
    let xdg_dirs = xdg::BaseDirectories::with_prefix("agentdeck")
        .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?;
    Ok(xdg_dirs.get_data_home().join("trajectories"))
}

/// The stable canonical-log path for `session_id`: `<session-id>.jsonl`.
/// Unlike the timestamped `record` paths, this one is continuous across daemon
/// restarts and is the harness's source of truth for a session's stream.
pub fn session_log_path(session_id: &str) -> Result<PathBuf> {
    let safe = session_id.replace(['/', '\\'], "_");
    Ok(default_dir()?.join(format!("{safe}.jsonl")))
}

/// Read a session's canonical log, if one exists. Returns `None` when the
/// session has never streamed since canonical logging was enabled.
pub async fn read_session_log(session_id: &str) -> Result<Option<Vec<WsMessage>>> {
    let path = session_log_path(session_id)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_trajectory(&path).await?))
}

/// A unique trajectory path for `session_id` under the default directory.
/// The directory is not created here; the recorder creates it on start.
pub fn default_path(session_id: &str) -> Result<PathBuf> {
    let safe = session_id.replace(['/', '\\'], "_");
    Ok(default_dir()?.join(format!("{safe}-{}.jsonl", chrono::Utc::now().timestamp())))
}

/// Read every line of a trajectory file back into messages. Used by tests and
/// the future memory scanner — cheap line-by-line, tolerant of corrupt lines.
pub async fn read_trajectory(path: &Path) -> Result<Vec<WsMessage>> {
    let file = File::open(path).await?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut out = Vec::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(message) = serde_json::from_str::<WsMessage>(trimmed) {
            out.push(message);
        }
    }
    Ok(out)
}

/// Serialize agent events as a trajectory file — one `WsMessage::AgentEvent`
/// line each. Used by the export endpoint to dump a session's persisted
/// events from the database.
pub async fn write_events_jsonl(path: &Path, events: &[AgentEvent]) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let file = File::create(path).await?;
    let mut writer = BufWriter::new(file);
    for event in events {
        let message = WsMessage::AgentEvent {
            event: event.clone(),
        };
        let mut line = serde_json::to_string(&message)?;
        line.push('\n');
        writer.write_all(line.as_bytes()).await?;
    }
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn agent_event(session_id: &str, kind: &str, seq: u64) -> AgentEvent {
        AgentEvent {
            event_id: format!("e{seq}"),
            session_id: session_id.to_string(),
            sequence: seq,
            timestamp: chrono::Utc::now(),
            kind: kind.to_string(),
            payload: json!({ "text": format!("{kind}-{seq}") }),
            duration_ms: None,
        }
    }

    fn temp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentdeck-trajectory-{tag}-{}.jsonl",
            uuid::Uuid::new_v4()
        ))
    }

    #[tokio::test]
    async fn jsonl_round_trip_preserves_events() {
        let path = temp_path("roundtrip");
        let events = vec![
            agent_event("s1", "assistant_text", 1),
            agent_event("s1", "tool_started", 2),
            agent_event("s1", "plan", 3),
        ];
        write_events_jsonl(&path, &events).await.unwrap();

        let messages = read_trajectory(&path).await.unwrap();
        assert_eq!(messages.len(), 3);
        // WsMessage has no PartialEq; compare the serialized form.
        for (message, event) in messages.iter().zip(events.iter()) {
            let expected = serde_json::to_value(&WsMessage::AgentEvent {
                event: event.clone(),
            })
            .unwrap();
            assert_eq!(serde_json::to_value(message).unwrap(), expected);
        }
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn recorder_filters_to_one_session() {
        let hub = BroadcastHub::new();
        let recorder = TrajectoryRecorder::new();
        let path = temp_path("filter");
        recorder.start(&hub, "s1", path.clone()).await.unwrap();

        hub.broadcast_agent_event(agent_event("s1", "assistant_text", 1));
        hub.broadcast_agent_event(agent_event("s2", "assistant_text", 2));
        hub.broadcast_agent_event(agent_event("s1", "plan", 3));

        let stopped = recorder.stop("s1").await.unwrap();
        assert_eq!(stopped, Some(path.clone()));

        let messages = read_trajectory(&path).await.unwrap();
        assert_eq!(messages.len(), 2);
        for message in &messages {
            assert_eq!(session_id_of(message), Some("s1"));
        }
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn stop_returns_none_when_not_recording() {
        let recorder = TrajectoryRecorder::new();
        assert_eq!(recorder.stop("nope").await.unwrap(), None);
    }

    #[tokio::test]
    async fn replay_broadcasts_in_order_and_retargets() {
        let hub = BroadcastHub::new();
        let mut rx = hub.subscribe();
        let path = temp_path("replay");
        let events = vec![
            agent_event("s1", "assistant_text", 1),
            agent_event("s1", "plan", 2),
        ];
        write_events_jsonl(&path, &events).await.unwrap();

        let count = TrajectoryPlayer::replay(&path, &hub, Some("target"))
            .await
            .unwrap();
        assert_eq!(count, 2);

        let first = rx.recv().await.unwrap();
        let second = rx.recv().await.unwrap();
        let WsMessage::AgentEvent { event } = first.message else {
            panic!("expected agent event");
        };
        assert_eq!(event.session_id, "target");
        assert_eq!(event.kind, "assistant_text");
        let WsMessage::AgentEvent { event } = second.message else {
            panic!("expected agent event");
        };
        assert_eq!(event.session_id, "target");
        assert_eq!(event.kind, "plan");
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[test]
    fn session_id_of_covers_session_carrying_variants() {
        let event = WsMessage::AgentEvent {
            event: agent_event("s9", "plan", 1),
        };
        assert_eq!(session_id_of(&event), Some("s9"));
        // Global / client-side messages have no session.
        let global = WsMessage::Ping;
        assert_eq!(session_id_of(&global), None);
    }
}

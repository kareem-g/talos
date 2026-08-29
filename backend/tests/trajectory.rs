//! Integration tests for trajectory record & replay.
//!
//! These exercise the recorder/player against a real `BroadcastHub`, verifying
//! that a trajectory captures exactly one session's stream and that replaying
//! it re-broadcasts the events in order through the hub.

use agentdeck_backend::agent_events::AgentEvent;
use agentdeck_backend::trajectory::{TrajectoryPlayer, TrajectoryRecorder};
use agentdeck_backend::websocket::WsMessage;
use agentdeck_backend::websocket::broadcast::BroadcastHub;
use serde_json::json;
use std::path::PathBuf;

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
        "agentdeck-trajectory-int-{tag}-{}.jsonl",
        uuid::Uuid::new_v4()
    ))
}

#[tokio::test]
async fn records_and_replays_a_session_through_the_hub() {
    let hub = BroadcastHub::new();
    let recorder = TrajectoryRecorder::new();
    let path = temp_path("roundtrip");

    recorder.start(&hub, "s1", path.clone()).await.unwrap();

    // Interleave two sessions; only s1 must be recorded.
    hub.broadcast_agent_event(agent_event("s1", "thinking_started", 1));
    hub.broadcast_agent_event(agent_event("s2", "assistant_text", 2));
    hub.broadcast_agent_event(agent_event("s1", "assistant_text", 3));
    hub.broadcast_agent_event(agent_event("s1", "plan", 4));

    assert!(recorder.is_recording("s1").await);
    let stopped = recorder.stop("s1").await.unwrap().unwrap();
    assert_eq!(stopped, path);
    assert!(!recorder.is_recording("s1").await);
    assert_eq!(recorder.active_count().await, 0);

    // Replay into a fresh hub; the recorded events must come back in order.
    let replay_hub = BroadcastHub::new();
    let mut rx = replay_hub.subscribe();
    let count = TrajectoryPlayer::replay(&path, &replay_hub, None)
        .await
        .unwrap();
    assert_eq!(count, 3);

    let kinds: Vec<String> = {
        let mut kinds = Vec::new();
        for _ in 0..3 {
            let event = rx.recv().await.unwrap();
            if let WsMessage::AgentEvent { event } = event.message {
                kinds.push(event.kind);
            }
        }
        kinds
    };
    assert_eq!(kinds, vec!["thinking_started", "assistant_text", "plan"]);

    let _ = tokio::fs::remove_file(&path).await;
}

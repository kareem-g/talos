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

#[tokio::test]
async fn canonical_log_appends_across_starts() {
    // Isolate from the real data dir.
    let data_home = temp_path("datahome").with_extension("");
    let _ = std::fs::create_dir_all(&data_home);
    // SAFETY: test-only env isolation; no other thread reads this var.
    unsafe { std::env::set_var("XDG_DATA_HOME", &data_home) };

    let hub = BroadcastHub::new();
    let recorder = TrajectoryRecorder::new();

    // First "daemon run": start_append records to the stable per-session path.
    let path = recorder.start_append(&hub, "s-canon").await.unwrap();
    assert!(path.to_str().unwrap().ends_with("s-canon.jsonl"));
    hub.broadcast_agent_event(agent_event("s-canon", "thinking_started", 1));
    hub.broadcast_agent_event(agent_event("s-canon", "assistant_text", 2));
    recorder.stop("s-canon").await.unwrap();

    // Second "daemon run": same path, append not truncate.
    let path2 = recorder.start_append(&hub, "s-canon").await.unwrap();
    assert_eq!(path, path2);
    hub.broadcast_agent_event(agent_event("s-canon", "agent_completed", 3));
    recorder.stop("s-canon").await.unwrap();

    let log = agentdeck_backend::trajectory::read_session_log("s-canon")
        .await
        .unwrap()
        .expect("canonical log exists");
    let kinds: Vec<String> = log
        .iter()
        .filter_map(|m| match m {
            WsMessage::AgentEvent { event } => Some(event.kind.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(kinds, vec!["thinking_started", "assistant_text", "agent_completed"]);

    let _ = std::fs::remove_dir_all(&data_home);
}

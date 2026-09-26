use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub event_id: String,
    pub session_id: String,
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub kind: String,
    pub payload: Value,
    pub duration_ms: Option<u64>,
}

impl AgentEvent {
    pub fn new(session_id: &str, kind: impl Into<String>, payload: Value) -> Self {
        Self {
            event_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            sequence: 0,
            timestamp: Utc::now(),
            kind: kind.into(),
            payload,
            duration_ms: None,
        }
    }
}

/// True when a message is a backend-written lifecycle marker (an engine-switch
/// notice) rather than something the user typed.
///
/// Older daemons broadcast these with role `"user"`, so they were persisted as
/// user rows in the messages table and the trajectory log. Callers use this to
/// keep such rows off the model and out of the user-bubble rendering — they are
/// UI chrome that belongs between turns, not conversation turns.
pub fn is_lifecycle_marker(content: &str) -> bool {
    let content = content.trim();
    content.starts_with("Engine switched from ") && content.contains("continuing the same session.")
}

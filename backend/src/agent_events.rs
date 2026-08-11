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

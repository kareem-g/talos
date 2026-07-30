use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentDeckEvent {
    SessionCreated { id: String, agent: String },
    SessionUpdated { id: String, status: String },
    TranscriptReceived { session_id: String, chunk: String },
    ApprovalRequired { session_id: String, request_id: String },
    TunnelStatusChanged { kind: String, status: String },
    NotificationReceived { title: String, body: String },
}

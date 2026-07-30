pub mod handler;
pub mod broadcast;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    // Client -> Server
    Subscribe { channels: Vec<String> },
    Unsubscribe { channels: Vec<String> },
    Input { session_id: String, data: String },
    Command { action: String, params: serde_json::Value },

    // Server -> Client
    SessionUpdate { session: crate::models::session::Session },
    TranscriptChunk { session_id: String, chunk: String, kind: TranscriptKind },
    ApprovalRequest { session_id: String, request: ApprovalRequest },
    StateChange { session_id: String, state: String },
    TunnelUpdate { status: String, details: serde_json::Value },
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TranscriptKind {
    Stdout,
    Stderr,
    Plan,
    Diff,
    ToolCall,
    Approval,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub prompt: String,
    pub options: Vec<String>,
    pub risk_level: RiskLevel,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

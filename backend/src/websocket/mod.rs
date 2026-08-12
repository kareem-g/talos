pub mod handler;
pub mod broadcast;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    // Client -> Server
    Authenticate { token: String, after_event_id: Option<u64> },
    Subscribe { channels: Vec<String> },
    Unsubscribe { channels: Vec<String> },
    Input { session_id: String, data: String },
    /// Raw keystrokes from the interactive xterm view. Unlike `Input`, these
    /// bypass chat persistence and are written to the existing PTY verbatim.
    TerminalInput { session_id: String, data: String },
    Command { action: String, params: serde_json::Value },
    QuestionAnswer { answer: crate::questions::QuestionAnswer },
    Ping,

    // Server -> Client
    Authenticated { device_id: String, last_event_id: u64 },
    DeviceRevoked { device_id: String },
    SessionUpdate { session: crate::sessions::Session },
    TerminalOutput { session_id: String, data: String },
    Message { message: crate::agent_events::AgentMessage },
    AgentEvent { event: crate::agent_events::AgentEvent },
    // Legacy semantic transcript frame retained for old desktop clients.
    TranscriptChunk { session_id: String, chunk: String, kind: TranscriptKind },
    ApprovalRequest { session_id: String, request: ApprovalRequest },
    ApprovalResolved { session_id: String, request_id: String, decision: String },
    Activity { session_id: String, activity: AgentActivity },
    StateChange { session_id: String, state: String },
    TunnelUpdate { status: String, details: serde_json::Value },
    SessionError { session_id: String, code: String, message: String },
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptKind {
    User,
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
pub struct AgentActivity {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

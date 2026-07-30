use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub version: u32,
    pub nonce: String,
    pub timestamp: i64,
    pub payload: Payload,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Payload {
    SessionEvent { session_id: String, event: SessionEvent },
    AgentOutput { session_id: String, output: String },
    ApprovalRequest { id: String, prompt: String, options: Vec<String> },
    ApprovalResponse { id: String, approved: bool, always: bool },
    Command { action: String, params: serde_json::Value },
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEvent {
    Started,
    Paused,
    Resumed,
    Completed,
    Error { message: String },
    StateChanged { state: String },
}

pub mod manager;
pub mod parser;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySession {
    pub id: String,
    pub agent: String,
    pub project: Option<String>,
    pub pid: u32,
    pub state: PtyState,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PtyState {
    Starting,
    Running,
    WaitingForInput,
    WaitingForApproval,
    Idle,
    Error(String),
    Exited { code: i32 },
}

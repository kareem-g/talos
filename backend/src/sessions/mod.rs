pub mod manager;
pub mod state;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub agent: String,
    pub project: Option<String>,
    pub branch: Option<String>,
    pub status: SessionStatus,
    pub worktree_path: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub cost: Option<f64>,
    pub tokens_used: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Starting,
    Running,
    WaitingForInput,
    WaitingForApproval,
    Idle,
    Error,
    Archived,
    Exited,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: "New Session".to_string(),
            agent: "claude".to_string(),
            project: None,
            branch: None,
            status: SessionStatus::Idle,
            worktree_path: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            cost: None,
            tokens_used: None,
        }
    }
}

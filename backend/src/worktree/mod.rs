pub mod manager;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub session_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

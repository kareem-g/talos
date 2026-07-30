pub mod telegram;
pub mod slack;

use crate::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub kind: NotificationKind,
    pub title: String,
    pub body: String,
    pub session_id: Option<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    SessionStarted,
    SessionCompleted,
    ApprovalRequired,
    Error,
    CostAlert,
    Custom,
}

#[allow(async_fn_in_trait)]
pub trait NotificationProvider: Send + Sync {
    async fn send(&self, notification: &Notification) -> Result<()>;
}

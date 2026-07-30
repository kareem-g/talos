use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub agent: String,
    pub status: String,
    pub project: Option<String>,
}

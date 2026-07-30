use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliConfig {
    pub server_url: String,
    pub auth_token: Option<String>,
    pub default_agent: String,
}

impl Default for CliConfig {
    fn default() -> Self {
        Self {
            server_url: "http://localhost:9120".to_string(),
            auth_token: None,
            default_agent: "claude".to_string(),
        }
    }
}

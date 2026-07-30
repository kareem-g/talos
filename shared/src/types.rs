use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapabilities {
    pub plan: bool,
    pub diff: bool,
    pub tool_use: bool,
    pub approval: bool,
    pub mcp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub version: String,
    pub platform: String,
    pub uptime: u64,
    pub sessions_active: usize,
    pub tunnel_status: String,
}

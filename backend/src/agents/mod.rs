pub mod claude;
pub mod codex;
pub mod opencode;

use crate::Result;
use serde::{Deserialize, Serialize};
use std::process::Stdio;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub available: bool,
    pub path: String,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub binary: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
}

/// Detect if an agent CLI is installed and get its version
pub async fn detect_agent(binary: &str) -> Option<(String, String)> {
    // Try --version first
    if let Ok(output) = tokio::process::Command::new(binary)
        .arg("--version")
        .output()
        .await
    {
        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("unknown")
                .trim()
                .to_string();
            return Some((binary.to_string(), ver));
        }
    }

    // Try -v
    if let Ok(output) = tokio::process::Command::new(binary)
        .arg("-v")
        .output()
        .await
    {
        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("unknown")
                .trim()
                .to_string();
            return Some((binary.to_string(), ver));
        }
    }

    // Try which
    if let Ok(output) = tokio::process::Command::new("which")
        .arg(binary)
        .output()
        .await
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Some((path, "unknown".to_string()));
        }
    }

    None
}

pub trait AgentAdapter: Send + Sync {
    fn info(&self) -> AgentInfo;
    fn build_command(&self, project: Option<&str>, prompt: Option<&str>) -> Result<Vec<String>>;
    fn parse_output(&self, chunk: &str) -> Vec<crate::pty::parser::ParsedOutput>;
    fn detect_state(&self, output: &str) -> crate::pty::PtyState;
    fn supports_hooks(&self) -> bool;
    fn hook_events(&self) -> Vec<String>;
}

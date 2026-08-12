pub mod claude;
pub mod codex;
pub mod opencode;

use crate::Result;
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapabilities {
    pub structured_output: bool,
    pub hooks: bool,
    pub streaming: bool,
    pub approvals: bool,
    pub file_events: bool,
    pub terminal: bool,
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

/// Attempt to discover a CLI agent's supported models by probing its own
/// `--help` output. Returns the labels it finds (e.g. the aliases named in
/// claude's `--model` documentation). This is best-effort discovery from the
/// actual installed binary, not a hardcoded list — the editable config always
/// wins when present.
pub async fn detect_agent_models(binary: &str) -> Vec<String> {
    let Ok(output) = tokio::process::Command::new(binary).arg("--help").output().await else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let help = String::from_utf8_lossy(&output.stdout).to_lowercase();
    // Claude documents its model aliases in the --model help text. Pull any
    // quoted alias tokens out of that paragraph.
    let mut found = Vec::new();
    for line in help.lines() {
        let lower = line.to_lowercase();
        if lower.contains("--model") || lower.contains("model for the current session") {
            // Collect single-quoted tokens that look like model aliases.
            for token in lower.split('\'') {
                let t = token.trim();
                if t.len() >= 3 && t.len() <= 12 && t.chars().all(|c| c.is_ascii_alphanumeric()) {
                    if !found.contains(&t.to_string()) {
                        found.push(t.to_string());
                    }
                }
            }
        }
    }
    found
}

pub trait AgentAdapter: Send + Sync {
    fn info(&self) -> AgentInfo;
    fn build_command(&self, project: Option<&str>, prompt: Option<&str>) -> Result<Vec<String>>;
    fn parse_output(&self, chunk: &str) -> Vec<crate::pty::parser::ParsedOutput>;
    fn detect_state(&self, output: &str) -> crate::pty::PtyState;
    fn supports_hooks(&self) -> bool;
    fn hook_events(&self) -> Vec<String>;

    fn capabilities(&self) -> AgentCapabilities {
        AgentCapabilities {
            structured_output: false,
            hooks: self.supports_hooks(),
            streaming: true,
            approvals: false,
            file_events: false,
            terminal: true,
        }
    }

    fn parse_structured_event(&self, _payload: &serde_json::Value) -> Option<crate::agent_events::AgentEvent> {
        None
    }

    fn supports_questions(&self) -> bool {
        false
    }

    fn answer_question(
        &self,
        _question: &crate::questions::Question,
        _answer: &crate::questions::QuestionAnswer,
    ) -> Result<Vec<String>> {
        Err(crate::AgentDeckError::Unknown("This agent does not support structured questions".to_string()))
    }
}

pub fn question_input(
    agent: &str,
    question: &crate::questions::Question,
    answer: &crate::questions::QuestionAnswer,
) -> Result<Vec<String>> {
    match agent {
        "claude" => claude::answer_question_input(question, answer),
        _ => Err(crate::AgentDeckError::Unknown(
            "This agent does not support structured question answers".to_string(),
        )),
    }
}

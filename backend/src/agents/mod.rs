pub mod acp;
pub mod catalog;
pub mod claude;
pub mod claude_stream;
pub mod codex;
pub mod opencode;
pub mod stream;

use crate::pty::parser::ParsedOutput;
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

    /// Whether the prompt is already embedded in the command line (e.g.
    /// opencode's `run` subcommand). When true, `finish_spawn` skips
    /// sending the prompt via stdin to avoid duplication.
    fn prompt_in_command(&self) -> bool {
        false
    }

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

/// Whether the given agent's CLI embeds the prompt in the command line
/// (e.g. opencode's `run` subcommand). When true, the initial prompt should
/// NOT be sent via stdin to avoid duplication.
pub fn agent_prompt_in_command(agent: &str) -> bool {
    match agent {
        "opencode" => true,
        _ => false,
    }
}

/// Build the full command line for an agent using its adapter.
/// Falls back to just `[binary] + args` if the adapter is not available.
pub async fn build_agent_command(
    agent: &str,
    binary_config: &crate::config::settings::AgentBinary,
    project: Option<&str>,
    prompt: Option<&str>,
) -> Result<Vec<String>> {
    let config = AgentConfig {
        binary: binary_config.path.clone(),
        args: binary_config.args.clone(),
        env: binary_config.env.clone(),
    };
    let adapter: Option<Box<dyn AgentAdapter>> = match agent {
        "claude" => claude::ClaudeAdapter::detect(config).await.map(|a| Box::new(a) as Box<dyn AgentAdapter>),
        "codex" => codex::CodexAdapter::detect(config).await.map(|a| Box::new(a) as Box<dyn AgentAdapter>),
        "opencode" => opencode::OpenCodeAdapter::detect(config).await.map(|a| Box::new(a) as Box<dyn AgentAdapter>),
        _ => None,
    };
    if let Some(adapter) = adapter {
        adapter.build_command(project, prompt)
    } else {
        let mut cmd = vec![binary_config.path.clone()];
        cmd.extend(binary_config.args.clone());
        Ok(cmd)
    }
}
/// Only reports states that differ from "running" (the fallback used for the
/// whole session) so transition broadcasts are meaningful rather than spammy.
pub fn agent_state_transition(agent: &str, chunk: &str) -> Option<&'static str> {
    if agent == "claude" {
        return None;
    }
    match crate::pty::parser::detect_terminal_state(chunk) {
        Some(state @ ("waiting_for_input" | "waiting_for_approval")) => Some(state),
        _ => None,
    }
}

/// Extract displayable assistant text from one terminal frame. This is kept
/// separate from `agent_semantic_events`: Claude has authoritative hook events
/// for tools and approvals, but its PTY is still the only token-level source
/// while a response is being generated.
pub fn agent_text_fragment(chunk: &str) -> Option<String> {
    crate::pty::parser::OutputParser::parse_chunk(chunk)
        .into_iter()
        .find_map(|parsed| match parsed {
            ParsedOutput::Text(text) if !text.trim().is_empty() => Some(text),
            _ => None,
        })
}

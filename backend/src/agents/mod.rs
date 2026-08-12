pub mod claude;
pub mod codex;
pub mod opencode;

use crate::pty::parser::ParsedOutput;
use crate::Result;
use serde::{Deserialize, Serialize};

use crate::agent_events::AgentEvent;

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

/// Derive incremental semantic events from raw PTY output for CLIs that have
/// no structured hooks protocol (codex, opencode). The existing `OutputParser`
/// already understands the text these CLIs print — wiring it into the live
/// stream turns the chat timeline into a true stream instead of a single
/// "Working" state that resolves when the process exits.
///
/// Claude is excluded on purpose: its hooks protocol already produces
/// authoritative structured events, and feeding parser guesses on top of them
/// would double-render text and tool calls.
pub fn agent_semantic_events(session_id: &str, agent: &str, chunk: &str) -> Vec<AgentEvent> {
    if agent == "claude" {
        return Vec::new();
    }
    let mut events = Vec::new();
    let mut tool_index = 0usize;
    for parsed in crate::pty::parser::OutputParser::parse_chunk(chunk) {
        match parsed {
            ParsedOutput::Text(text) => {
                events.push(AgentEvent::new(
                    session_id,
                    "assistant_text",
                    serde_json::json!({ "text": text, "source": "parser" }),
                ));
            }
            ParsedOutput::ToolCall { name, params } => {
                let is_thinking = params
                    .get("activity")
                    .and_then(serde_json::Value::as_str)
                    == Some("thinking");
                events.push(AgentEvent::new(
                    session_id,
                    if is_thinking {
                        "thinking_started"
                    } else {
                        "tool_activity"
                    },
                    serde_json::json!({
                        "tool_name": name,
                        "input": params,
                        "tool_id": format!("parser-{tool_index}"),
                    }),
                ));
                tool_index += 1;
            }
            ParsedOutput::Plan { title, steps } => {
                events.push(AgentEvent::new(
                    session_id,
                    "plan",
                    serde_json::json!({ "title": title, "steps": steps }),
                ));
            }
            ParsedOutput::Diff { file, .. } => {
                events.push(AgentEvent::new(
                    session_id,
                    "file_edited",
                    serde_json::json!({
                        "path": file,
                        "success": true,
                        "source": "parser",
                    }),
                ));
            }
            ParsedOutput::ApprovalRequest { prompt } => {
                // Parser-detected approvals are not registered anywhere on the
                // backend — the client resolves them and the WS handler falls
                // back to typing the decision into the running CLI.
                events.push(AgentEvent::new(
                    session_id,
                    "permission_required",
                    serde_json::json!({
                        "id": uuid::Uuid::new_v4().to_string(),
                        "prompt": prompt,
                        "options": ["allow", "always", "deny"],
                        "source": "parser",
                    }),
                ));
            }
            ParsedOutput::Error(message) => {
                events.push(AgentEvent::new(
                    session_id,
                    "agent_error",
                    serde_json::json!({ "message": message, "source": "parser" }),
                ));
            }
        }
    }
    events
}

/// Detect genuine terminal states for non-Claude agents from live output.
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

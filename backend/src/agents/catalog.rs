//! Known coding-agent CLIs and their launch commands.
//!
//! Two tiers, mirroring how paseo structures providers:
//! - native (PTY) agents handled by dedicated adapters: claude, codex
//! - ACP agents: any CLI speaking the Agent Client Protocol (opencode,
//!   copilot, gemini, cursor, qwen, kimi, hermes, …) is driven through the
//!   generic `AcpManager`, which yields native structured events for every
//!   one of them.
//!
//! Detection is real, never assumed: a catalog entry only becomes available
//! after the binary is found on PATH *and* answers an ACP `initialize`
//! handshake. Users can also register custom ACP agents in config; those are
//! probed the same way.

use serde::{Deserialize, Serialize};

/// A discovered agent. `protocol` tells the UI / spawn path how to launch it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEntry {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub args: Vec<String>,
    pub protocol: AgentProtocol,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProtocol {
    Pty,
    Acp,
}

/// A user-defined agent from config (`agents.custom`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomAgent {
    pub id: String,
    pub name: String,
    pub binary: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

/// Well-known CLIs that speak ACP. The command is the one configured in
/// editors (opencode: `opencode acp`, copilot: `copilot --acp`,
/// grok: `grok agent stdio` per xAI's agent-mode docs, …).
pub const ACP_CATALOG: &[(&str, &str, &str, &[&str], &[&str])] = &[
    ("opencode", "OpenCode", "opencode", &["acp"], &["chat", "code", "plan", "auto", "native_ui"]),
    ("grok", "Grok Build", "grok", &["agent", "stdio"], &["chat", "code", "plan", "auto", "native_ui"]),
    ("copilot", "GitHub Copilot", "copilot", &["--acp"], &["chat", "code", "native_ui"]),
    ("gemini", "Gemini CLI", "gemini", &["--acp"], &["chat", "code", "plan", "native_ui"]),
    ("cursor", "Cursor", "cursor-agent", &["--acp"], &["chat", "code", "native_ui"]),
    ("qwen", "Qwen Code", "qwen-code", &["--acp"], &["chat", "code", "native_ui"]),
    ("kimi", "Kimi CLI", "kimi", &["--acp"], &["chat", "code", "native_ui"]),
    ("hermes", "Hermes", "hermes", &["--acp"], &["chat", "code", "native_ui"]),
    ("goose", "Goose", "goose", &["--acp"], &["chat", "code", "native_ui"]),
    ("augment", "Augment", "auggie", &["--acp"], &["chat", "code", "native_ui"]),
];

/// Resolve a catalog entry by agent id (ACP tier only).
pub fn acp_entry_for(agent: &str) -> Option<(&'static str, &'static str, &'static str, &'static [&'static str], &'static [&'static str])> {
    ACP_CATALOG.iter().find(|(id, ..)| *id == agent).copied()
}

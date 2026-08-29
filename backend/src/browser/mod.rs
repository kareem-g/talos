//! Built-in browser engine for AgentDeck's test-automation skill.
//!
//! The agent drives a headless Chromium instance through an MCP server (see
//! [`mcp`]) that speaks CDP (see [`cdp`]) — navigate, snapshot, locators,
//! click, type, screenshot, and a visible cursor that the dashboard mirrors
//! in real time.
//!
//! ## Architecture
//!
//! ```text
//! AgentDeck agent session (claude/opencode)
//!    │  calls MCP tools: browser_*  (gated by AgentDeck permissions)
//!    ▼
//! browser MCP server  ←──  spawned by the daemon as `agentdeck-backend __browser-mcp`
//!    │  CDP over WebSocket
//!    ▼
//! Chromium (headless, one instance per session)
//! ```
//!
//! The MCP server also runs a tiny HTTP endpoint for the dashboard to fetch
//! screenshots and cursor state, and POSTs `browser_step` / `browser_cursor_*`
//! events to the daemon for real-time mirroring.

pub mod cdp;
pub mod engine;
pub mod manager;
pub mod mcp;
pub mod snapshot;

use engine::TabInfo;
use serde::{Deserialize, Serialize};

/// The cursor state tracked by the MCP server, mirrored to the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorState {
    pub x: i32,
    pub y: i32,
    pub button: String,
    pub pressed: bool,
}

impl Default for CursorState {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            button: "left".into(),
            pressed: false,
        }
    }
}

/// A tab handle tracked by the MCP server.
#[derive(Debug, Clone)]
pub struct TabHandle {
    pub info: TabInfo,
    pub last_screenshot: Option<String>,
}

/// Parameters for the `browser_select` MCP tool.
#[derive(Debug, Deserialize)]
pub struct SelectParams {
    pub backend: String,
}
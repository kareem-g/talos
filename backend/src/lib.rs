pub mod api;
pub mod auth;
pub mod browser;
pub mod config;
pub mod context_assembler;
pub mod daemon;
pub mod hooks;
pub mod harness_charter;
pub mod mcp;
pub mod memory;
pub mod models;
pub mod notifications;
pub mod pty;
pub mod permissions;
pub mod policy;
pub mod providers;
pub mod protocol;
pub mod sessions;
pub mod skills;
pub mod transcript;
pub mod trajectory;
pub mod tunnel;
pub mod websocket;
pub mod workspace;
pub mod worktree;
pub mod agents;
pub mod agent_events;
pub mod questions;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum AgentDeckError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("PTY error: {0}")]
    Pty(String),

    #[error("WebSocket error: {0}")]
    WebSocket(String),

    #[error("Tunnel error: {0}")]
    Tunnel(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

pub type Result<T> = std::result::Result<T, AgentDeckError>;

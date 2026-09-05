//! Built-in harness agents (summarizer / planner / reviewer / worker).
//!
//! These are named roles the app can spawn automatically (or on explicit
//! commands) as hidden, parent-bound child sessions. Each role has a
//! configurable default engine under `[agents.builtin]`; when unset the child
//! follows the parent session's own engine.

pub const BUILTIN_ROLES: [&str; 4] = ["summarizer", "planner", "reviewer", "worker"];

/// The configured default engine for a built-in role, if any.
pub fn configured_engine(settings: &crate::config::settings::Settings, role: &str) -> Option<String> {
    let builtin = &settings.agents.builtin;
    let value = match role {
        "summarizer" => builtin.summarizer.as_deref(),
        "planner" => builtin.planner.as_deref(),
        "reviewer" => builtin.reviewer.as_deref(),
        "worker" => builtin.worker.as_deref(),
        _ => None,
    };
    value.map(str::trim).filter(|v| !v.is_empty()).map(str::to_string)
}

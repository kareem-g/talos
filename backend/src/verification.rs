//! The verification gate — the harness proves the work instead of trusting
//! the agent's word.
//!
//! After a turn that changed code, the daemon runs the project's test command
//! and broadcasts a `verification` event the UI renders: passed / failed /
//! skipped, with the command and truncated output. The test command is
//! detected from the project (cargo test, pnpm/npm test, pytest, make test).

use crate::agent_events::AgentEvent;
use crate::config::AppState;
use crate::sessions::manager::SessionManager;
use crate::websocket::WsMessage;
use crate::websocket::broadcast::BroadcastHub;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// How long a verification run may take before it is reported as failed.
const VERIFY_TIMEOUT: Duration = Duration::from_secs(180);
/// Cap captured test output so a verbose run cannot flood the session log.
const OUTPUT_CAP: usize = 4 * 1024;

/// Detect the test command for a project, or `None` when nothing is obvious.
async fn exists_in(base: &Path, name: &str) -> bool {
    tokio::fs::try_exists(base.join(name)).await.unwrap_or(false)
}

async fn detect_test_command(project: Option<&str>) -> Option<String> {
    let Some(project) = project else {
        return None;
    };
    let base = Path::new(project);
    if exists_in(base, "Cargo.toml").await {
        return Some("cargo test".to_string());
    }
    if exists_in(base, "pnpm-lock.yaml").await || exists_in(base, "pnpm-workspace.yaml").await {
        return Some("pnpm test".to_string());
    }
    if exists_in(base, "package.json").await {
        return Some("npm test".to_string());
    }
    if exists_in(base, "pytest.ini").await
        || exists_in(base, "pyproject.toml").await
        || exists_in(base, "tox.ini").await
        || tokio::fs::try_exists(base.join("tests")).await.unwrap_or(false)
    {
        return Some("python3 -m pytest".to_string());
    }
    if exists_in(base, "Makefile").await || exists_in(base, "makefile").await {
        return Some("make test".to_string());
    }
    None
}

/// Whether a tool call looks like a file change (write/edit family).
pub fn is_file_change_tool(tool_name: &str) -> bool {
    let lower = tool_name.to_lowercase();
    lower.contains("write")
        || lower.contains("edit")
        || lower.contains("str_replace")
        || lower.contains("create_file")
        || lower.contains("delete_file")
        || lower.contains("multi_edit")
}

async fn verify_and_broadcast(
    broadcast: &BroadcastHub,
    session_id: &str,
    project: Option<&str>,
) {
    let Some(command) = detect_test_command(project).await else {
        broadcast_verification(broadcast, session_id, "skipped", "no test command detected for this project", "");
        return;
    };

    let mut cmd = tokio::process::Command::new("sh");
    cmd.arg("-lc").arg(&command);
    if let Some(project) = project {
        cmd.current_dir(project);
    }
    let output = tokio::time::timeout(VERIFY_TIMEOUT, cmd.output()).await;
    let (status, output_text) = match output {
        Ok(Ok(out)) => {
            let code = out.status.code().unwrap_or(-1);
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            if !out.stderr.is_empty() {
                text.push_str("\n[stderr]\n");
                text.push_str(&String::from_utf8_lossy(&out.stderr));
            }
            if text.len() > OUTPUT_CAP {
                text.truncate(OUTPUT_CAP);
                text.push_str("\n…[output truncated]");
            }
            (if code == 0 { "passed" } else { "failed" }, text)
        }
        Ok(Err(e)) => ("failed", format!("could not run {command}: {e}")),
        Err(_) => ("failed", format!("timed out after {}s", VERIFY_TIMEOUT.as_secs())),
    };
    broadcast_verification(broadcast, session_id, status, &command, &output_text);
}

fn broadcast_verification(broadcast: &BroadcastHub, session_id: &str, status: &str, command: &str, output: &str) {
    broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "verification",
        json!({
            "status": status,
            "command": command,
            "output": output,
            "source": "harness",
        }),
    ));
}

/// Subscribe to the hub and run the verification gate after code-changing turns.
pub fn spawn(state: &AppState) {
    let session_manager: Arc<SessionManager> = Arc::clone(&state.session_manager);
    let broadcast = state.broadcast.clone();
    let mut rx = state.broadcast.subscribe();
    tokio::spawn(async move {
        // Per-session: did the current turn touch files?
        let mut changed: std::collections::HashSet<String> = std::collections::HashSet::new();
        // tool_id -> tool_name, populated from tool_started (tool_finished on
        // some backends omits the name).
        let mut tool_names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        while let Ok(event) = rx.recv().await {
            let WsMessage::AgentEvent { event } = event.message else {
                continue;
            };
            match event.kind.as_str() {
                "tool_started" => {
                    if let (Some(id), Some(name)) = (
                        event.payload.get("tool_id").and_then(|i| i.as_str()),
                        event.payload.get("tool_name").and_then(|n| n.as_str()),
                    ) {
                        tool_names.insert(id.to_string(), name.to_string());
                    }
                }
                "tool_finished" => {
                    let ok = event.payload.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
                    let name = event
                        .payload
                        .get("tool_name")
                        .and_then(|n| n.as_str())
                        .or_else(|| {
                            event
                                .payload
                                .get("tool_id")
                                .and_then(|i| i.as_str())
                                .and_then(|id| tool_names.get(id).map(|s| s.as_str()))
                        })
                        .unwrap_or("");
                    if ok && is_file_change_tool(name) {
                        changed.insert(event.session_id.clone());
                    }
                }
                "agent_completed" => {
                    if changed.remove(&event.session_id) {
                        let project = session_manager
                            .get_session(&event.session_id)
                            .await
                            .ok()
                            .flatten()
                            .and_then(|s| s.project);
                        verify_and_broadcast(&broadcast, &event.session_id, project.as_deref()).await;
                        // Auto-save memory for substantial turns (deduped per
                        // source session) so cross-session recall works
                        // without the user clicking save.
                        let already = project
                            .as_deref()
                            .map(|p| crate::memory::list_memories(Some(p)).iter().any(|e| e.source_session == event.session_id))
                            .unwrap_or(false);
                        if !already {
                            let _ = crate::memory::save_session_summary(
                                &session_manager,
                                &event.session_id,
                                "Auto-saved session",
                                "memory",
                            )
                            .await;
                        }
                    }
                }
                _ => {}
            }
        }
    });
}

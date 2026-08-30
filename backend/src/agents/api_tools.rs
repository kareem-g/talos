//! Tool execution for custom HTTP API providers.
//!
//! Custom providers have no CLI tool surface, so the harness gives them a
//! small built-in tool set — `Bash`, `Read`, `Write` — that it executes on
//! their behalf. Every call goes through the same permission pipeline as the
//! native backends (`permissions::request_user_decision`): permission mode,
//! project policy (including path rules), and the human approval card all
//! apply. Results are streamed back to the model as `tool_result` blocks so it
//! can continue the turn.

use crate::agent_events::AgentEvent;
use crate::config::AppState;
use crate::permissions::PermissionQuery;
use serde_json::{Value, json};
use std::path::PathBuf;
use tokio::process::Command;

/// The tool schemas advertised to the model (Anthropic `tools` array format).
pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "Bash",
            "description": "Run a shell command in the project directory. Use for builds, tests, git, and any command-line work. Output is capped.",
            "input_schema": {
                "type": "object",
                "properties": { "command": { "type": "string", "description": "The shell command to run" } },
                "required": ["command"]
            }
        }),
        json!({
            "name": "Read",
            "description": "Read a file from disk. Returns its contents, capped to a reasonable size.",
            "input_schema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute or project-relative file path" } },
                "required": ["path"]
            }
        }),
        json!({
            "name": "Write",
            "description": "Write content to a file, creating parent directories as needed. Overwrites existing content.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "Absolute or project-relative file path" },
                    "content": { "type": "string", "description": "The full file content" }
                },
                "required": ["file_path", "content"]
            }
        }),
    ]
}

/// Cap tool output so a runaway command cannot flood the conversation.
const OUTPUT_CAP: usize = 50 * 1024;

fn cap(text: String) -> String {
    let mut t = text;
    if t.len() > OUTPUT_CAP {
        t.truncate(OUTPUT_CAP);
        t.push_str("\n…[output truncated]");
    }
    t
}

/// Resolve a possibly-relative path against the session's project.
fn resolve_path(project: Option<&str>, path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        p
    } else if let Some(project) = project {
        PathBuf::from(project).join(p)
    } else {
        p
    }
}

/// Execute one tool call on behalf of an API provider. Broadcasts the
/// tool_started / tool_input / tool_finished events and returns the text to
/// send back as the `tool_result` content. Never panics; errors and denials
/// come back as result text the model can read.
pub async fn execute_api_tool(
    state: &AppState,
    session_id: &str,
    project: Option<&str>,
    tool_use_id: &str,
    name: &str,
    args: &Value,
) -> String {
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "tool_started",
        json!({ "tool_name": name, "tool_id": tool_use_id, "source": "api" }),
    ));
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "tool_input",
        json!({ "tool_id": tool_use_id, "input": args.to_string() }),
    ));

    // The same permission pipeline as native backends: mode, policy (including
    // path rules), and the approval card when it comes to that.
    let query = PermissionQuery {
        session_id: session_id.to_string(),
        tool_name: name.to_string(),
        input: args.clone(),
        options: Vec::new(),
        allows_custom_text: false,
        selection_mode: "single".to_string(),
        is_plan: false,
    };
    let outcome = crate::permissions::request_user_decision(state, query).await;
    if !outcome.allowed {
        let message = format!("Permission denied: {}", outcome.reason);
        broadcast_tool_finished(state, session_id, tool_use_id, false, &message);
        return message;
    }

    let result = match name.to_lowercase().as_str() {
        "bash" => {
            let command = args
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            run_bash(project, &command).await
        }
        "read" => {
            let path = args.get("path").and_then(Value::as_str).unwrap_or("");
            read_file(project, path).await
        }
        "write" => {
            let path = args.get("file_path").and_then(Value::as_str).unwrap_or("");
            let content = args.get("content").and_then(Value::as_str).unwrap_or("");
            write_file(project, path, content).await
        }
        other => Err(format!("Unknown tool: {other}")),
    };

    match result {
        Ok(output) => {
            let output = cap(output);
            broadcast_tool_finished(state, session_id, tool_use_id, true, &output);
            output
        }
        Err(error) => {
            let message = format!("Tool error: {error}");
            broadcast_tool_finished(state, session_id, tool_use_id, false, &message);
            message
        }
    }
}

fn broadcast_tool_finished(state: &AppState, session_id: &str, tool_use_id: &str, success: bool, output: &str) {
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "tool_finished",
        json!({ "tool_id": tool_use_id, "success": success, "output": output, "source": "api" }),
    ));
}

async fn run_bash(project: Option<&str>, command: &str) -> Result<String, String> {
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(command);
    if let Some(project) = project {
        cmd.current_dir(project);
    }
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let status = output.status.code().unwrap_or(-1);
    if status != 0 && !stderr.trim().is_empty() && !stdout.trim().is_empty() {
        return Ok(format!("{stdout}\n[stderr]\n{stderr}").trim().to_string());
    }
    let body = if !stdout.trim().is_empty() { stdout } else { stderr };
    if status != 0 && body.trim().is_empty() {
        return Ok(format!("(exit code {status})"));
    }
    Ok(body.trim().to_string())
}

async fn read_file(project: Option<&str>, path: &str) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("no path provided".to_string());
    }
    let resolved = resolve_path(project, path);
    let content = tokio::fs::read_to_string(&resolved)
        .await
        .map_err(|e| format!("{path}: {e}"))?;
    Ok(content)
}

async fn write_file(project: Option<&str>, path: &str, content: &str) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("no file_path provided".to_string());
    }
    let resolved = resolve_path(project, path);
    if let Some(parent) = resolved.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(&resolved, content)
        .await
        .map_err(|e| format!("{path}: {e}"))?;
    Ok(format!("Wrote {path} ({} bytes)", content.len()))
}

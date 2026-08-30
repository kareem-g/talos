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
        json!({
            "name": "TodoWrite",
            "description": "Write a plan as a todo list. The harness records it as the session plan. Use it before starting non-trivial work.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                            },
                            "required": ["content"]
                        }
                    }
                },
                "required": ["todos"]
            }
        }),
        json!({
            "name": "Glob",
            "description": "Find files matching a glob pattern (e.g. \"**/*.rs\", \"src/**\"). Returns matching paths relative to the project.",
            "input_schema": {
                "type": "object",
                "properties": { "pattern": { "type": "string", "description": "Glob pattern" } },
                "required": ["pattern"]
            }
        }),
        json!({
            "name": "Grep",
            "description": "Search file contents for a regex pattern in the project. Returns up to 20 matches with file:line.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex to search for" },
                    "path": { "type": "string", "description": "Optional path/dir to scope the search to" }
                },
                "required": ["pattern"]
            }
        }),
        json!({
            "name": "Edit",
            "description": "Replace the first occurrence of old_string with new_string in a file. Safer than rewriting the whole file.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "Absolute or project-relative file path" },
                    "old_string": { "type": "string", "description": "Exact text to find" },
                    "new_string": { "type": "string", "description": "Replacement text" }
                },
                "required": ["file_path", "old_string", "new_string"]
            }
        }),
        json!({
            "name": "GitStatus",
            "description": "Show the git working tree status (short format with branch).",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "GitDiff",
            "description": "Show uncommitted changes (git diff). Output is capped.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "WebFetch",
            "description": "Fetch a URL and return its text content (HTML stripped). Subject to the project's network policy — domains must be allowlisted in .agentdeck/policy.toml.",
            "input_schema": {
                "type": "object",
                "properties": { "url": { "type": "string", "description": "http(s) URL to fetch" } },
                "required": ["url"]
            }
        }),
    ]
}

/// The same tools in OpenAI function-calling format (for `/chat/completions`).
pub fn openai_tool_definitions() -> Vec<Value> {
    tool_definitions()
        .into_iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.get("name"),
                    "description": t.get("description"),
                    "parameters": t.get("input_schema"),
                }
            })
        })
        .collect()
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
        broadcast_tool_finished(state, session_id, tool_use_id, name, false, &message);
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
        "todowrite" => Ok("Plan recorded.".to_string()),
        "glob" => {
            let pattern = args.get("pattern").and_then(Value::as_str).unwrap_or("");
            glob_files(project, pattern).await
        }
        "grep" => {
            let pattern = args.get("pattern").and_then(Value::as_str).unwrap_or("");
            let scope = args.get("path").and_then(Value::as_str);
            grep_files(project, pattern, scope).await
        }
        "edit" => {
            let path = args.get("file_path").and_then(Value::as_str).unwrap_or("");
            let old = args.get("old_string").and_then(Value::as_str).unwrap_or("");
            let new = args.get("new_string").and_then(Value::as_str).unwrap_or("");
            edit_file(project, path, old, new).await
        }
        "gitstatus" => run_git(project, &["status", "--short", "--branch"]).await,
        "gitdiff" => run_git(project, &["diff"]).await,
        "webfetch" => {
            let url = args.get("url").and_then(Value::as_str).unwrap_or("");
            fetch_url(url).await
        }
        other => Err(format!("Unknown tool: {other}")),
    };

    match result {
        Ok(output) => {
            let output = cap(output);
            broadcast_tool_finished(state, session_id, tool_use_id, name, true, &output);
            output
        }
        Err(error) => {
            let message = format!("Tool error: {error}");
            broadcast_tool_finished(state, session_id, tool_use_id, name, false, &message);
            message
        }
    }
}

fn broadcast_tool_finished(state: &AppState, session_id: &str, tool_use_id: &str, name: &str, success: bool, output: &str) {
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "tool_finished",
        json!({ "tool_id": tool_use_id, "tool_name": name, "success": success, "output": output, "source": "api" }),
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


/// Find files matching a glob pattern under the project dir. Supports `*`
/// (within a path segment), `**` (across segments), and `?` (single char).
async fn glob_files(project: Option<&str>, pattern: &str) -> Result<String, String> {
    let Some(project) = project else {
        return Err("no project directory".to_string());
    };
    let pattern = pattern.trim().trim_start_matches("./");
    if pattern.is_empty() {
        return Err("no pattern provided".to_string());
    }
    let base = PathBuf::from(project);
    let mut dirs = vec![(base.clone(), String::new())];
    let mut matches: Vec<String> = Vec::new();
    while let Some((dir, rel)) = dirs.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            let rel_path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                // Skip .git and target to keep results useful.
                if name == ".git" || name == "target" || name == "node_modules" {
                    continue;
                }
                dirs.push((entry.path(), rel_path.clone()));
            }
            if glob_match(pattern, &rel_path) {
                matches.push(rel_path);
            }
        }
    }
    matches.sort();
    matches.truncate(200);
    if matches.is_empty() {
        Ok("(no matches)".to_string())
    } else {
        Ok(matches.join("\n"))
    }
}

/// Simple fnmatch-style matcher: `*` within a segment, `**` across segments.
fn glob_match(pattern: &str, path: &str) -> bool {
    fn match_here(p: &[char], s: &[char]) -> bool {
        if p.is_empty() {
            return s.is_empty();
        }
        match p[0] {
            '*' => {
                // Collapse consecutive stars.
                let mut i = 0;
                while i < p.len() && p[i] == '*' {
                    i += 1;
                }
                let double = i >= 2;
                let rest = &p[i..];
                if double {
                    // `**` matches across any characters, including '/'.
                    for k in 0..=s.len() {
                        if match_here(rest, &s[k..]) {
                            return true;
                        }
                    }
                    false
                } else {
                    // Single `*` does not cross '/'.
                    for k in 0..=s.len() {
                        if k > 0 && s[k - 1] == '/' {
                            break;
                        }
                        if match_here(rest, &s[k..]) {
                            return true;
                        }
                    }
                    false
                }
            }
            '?' => !s.is_empty() && match_here(&p[1..], &s[1..]),
            c => !s.is_empty() && s[0] == c && match_here(&p[1..], &s[1..]),
        }
    }
    match_here(&pattern.chars().collect::<Vec<_>>(), &path.chars().collect::<Vec<_>>())
}

/// Grep file contents with ripgrep, falling back to grep.
async fn grep_files(project: Option<&str>, pattern: &str, scope: Option<&str>) -> Result<String, String> {
    if pattern.trim().is_empty() {
        return Err("no pattern provided".to_string());
    }
    let mut dir = project.unwrap_or(".");
    let mut path_arg = Vec::new();
    if let Some(scope) = scope.filter(|s| !s.trim().is_empty()) {
        path_arg.push(scope.to_string());
    } else if project.is_some() {
        path_arg.push(dir.to_string());
    }
    let mut cmd = Command::new("rg");
    cmd.args(["-n", "--no-heading", "-m", "20", "--color", "never"]);
    cmd.arg(pattern);
    cmd.args(&path_arg);
    let output = cmd.output().await;
    let (code, stdout, stderr) = match output {
        Ok(o) => (o.status.code().unwrap_or(-1), String::from_utf8_lossy(&o.stdout).to_string(), String::from_utf8_lossy(&o.stderr).to_string()),
        Err(e) => return Err(e.to_string()),
    };
    if code == 2 && stderr.contains("command not found") || (code == -1) {
        // Fall back to grep.
        let mut cmd = Command::new("grep");
        cmd.args(["-rn", "-m", "20", "--color=never"]);
        cmd.arg(pattern);
        cmd.args(&path_arg);
        let output = cmd.output().await.map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Ok(if stdout.trim().is_empty() { "(no matches)".to_string() } else { stdout.trim().to_string() });
    }
    if code != 0 {
        return Ok("(no matches)".to_string());
    }
    let _ = dir;
    Ok(stdout.trim().to_string())
}

/// Replace the first occurrence of old_string in a file.
async fn edit_file(project: Option<&str>, path: &str, old: &str, new: &str) -> Result<String, String> {
    if path.trim().is_empty() || old.is_empty() {
        return Err("file_path and old_string are required".to_string());
    }
    let resolved = resolve_path(project, path);
    let content = tokio::fs::read_to_string(&resolved)
        .await
        .map_err(|e| format!("{path}: {e}"))?;
    match content.find(old) {
        Some(idx) => {
            let mut updated = content.clone();
            updated.replace_range(idx..idx + old.len(), new);
            tokio::fs::write(&resolved, updated)
                .await
                .map_err(|e| format!("{path}: {e}"))?;
            Ok(format!("Edited {path}"))
        }
        None => Err(format!("old_string not found in {path}")),
    }
}

/// Run a git command in the project dir, capping output.
async fn run_git(project: Option<&str>, args: &[&str]) -> Result<String, String> {
    let Some(project) = project else {
        return Err("no project directory".to_string());
    };
    let output = Command::new("git")
        .args(args)
        .current_dir(project)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        if !err.trim().is_empty() { return Ok(err.trim().to_string()); }
        Ok("(clean)".to_string())
    } else {
        Ok(text.trim().to_string())
    }
}


/// Fetch a URL and return its text content. The network policy gate is applied
/// in the permission pipeline (request_user_decision); this only fetches.
async fn fetch_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("only http(s) URLs are supported".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(trimmed).send().await.map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let body = String::from_utf8_lossy(&bytes);
    Ok(strip_html(&body))
}

/// Crude but sufficient HTML-to-text: drop script/style blocks and tags, decode
/// the common entities, collapse whitespace, cap the size.
fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len().min(16 * 1024));
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut in_tag = false;
    let mut in_script = false;
    while i < chars.len() {
        let c = chars[i];
        if c == '<' {
            // Detect script/style blocks to skip their bodies.
            let lower: String = chars[i..chars.len().min(i + 14)].iter().collect::<String>().to_lowercase();
            if lower.starts_with("<script") || lower.starts_with("<style") {
                in_script = true;
            }
            in_tag = true;
            i += 1;
            continue;
        }
        if c == '>' {
            in_tag = false;
            if in_script {
                // Close when we hit </script> or </style>.
                let lower: String = chars[i..chars.len().min(i + 9)].iter().collect::<String>().to_lowercase();
                if lower.starts_with("</script") || lower.starts_with("</style") {
                    in_script = false;
                }
            }
            i += 1;
            continue;
        }
        if in_tag || in_script {
            i += 1;
            continue;
        }
        match c {
            '&' => {
                let rest: String = chars[i..chars.len().min(i + 6)].iter().collect();
                let (entity, len) = if rest.starts_with("&amp;") { ("&", 5) }
                    else if rest.starts_with("&lt;") { ("<", 4) }
                    else if rest.starts_with("&gt;") { (">", 4) }
                    else if rest.starts_with("&quot;") { ("\"", 6) }
                    else if rest.starts_with("&#39;") { ("'", 5) }
                    else if rest.starts_with("&nbsp;") { (" ", 6) }
                    else { ("&", 1) };
                out.push_str(entity);
                i += len;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    // Collapse runs of whitespace.
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_space = false;
    for c in out.chars() {
        if c.is_whitespace() {
            if !prev_space {
                collapsed.push(' ');
            }
            prev_space = true;
        } else {
            collapsed.push(c);
            prev_space = false;
        }
    }
    let capped: String = collapsed.chars().take(8000).collect();
    if collapsed.len() > capped.len() {
        format!("{capped}\n…[truncated]")
    } else {
        capped
    }
}

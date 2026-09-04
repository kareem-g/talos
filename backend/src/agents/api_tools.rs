//! Tool execution for custom HTTP API providers.
//!
//! Custom providers have no CLI tool surface, so the harness gives them a
//! built-in tool set. The definitions live in the unified registry
//! (`crate::tools`); this module wires them to actual execution. Every call
//! goes through the same permission pipeline as the native backends
//! (`permissions::request_user_decision`): permission mode, project policy
//! (including path and network rules), and the human approval card all apply.
//! Results are streamed back to the model as `tool_result` blocks so it can
//! continue the turn.

use crate::agent_events::AgentEvent;
use crate::config::AppState;
use crate::permissions::PermissionQuery;
use serde_json::{Value, json};
use std::path::PathBuf;
use tokio::process::Command;

/// The tool schemas advertised to the model (Anthropic `tools` array format).
/// Served from the unified registry so both API transports and
/// `GET /api/tools` describe the same tool set.
///
/// Pure `subagent` sessions (one-shot bounded workers outside any room) do
/// not get `Dispatch`: a worker fanning out its own children would recurse,
/// and every orchestration needs exactly one dispatcher. Room workers keep
/// it — addressing fellow workers by name is how a team delegates — while
/// their own children (spawned without a room mark) lose it again, so the
/// delegation depth is bounded at one extra level.
pub fn tool_definitions(subagent: bool, in_room: bool) -> Vec<Value> {
    filter_dispatch(crate::tools::anthropic_definitions(), subagent, in_room)
}

/// The same tools in OpenAI function-calling format (for `/chat/completions`).
pub fn openai_tool_definitions(subagent: bool, in_room: bool) -> Vec<Value> {
    filter_dispatch(crate::tools::openai_definitions(), subagent, in_room)
}

/// Drop the Dispatch tool for subagent sessions outside rooms. Works on
/// either wire format by keying on the tool's name field.
fn filter_dispatch(mut definitions: Vec<Value>, subagent: bool, in_room: bool) -> Vec<Value> {
    if !subagent || in_room {
        return definitions;
    }
    definitions.retain(|tool| {
        let name = tool
            .get("name")
            .or_else(|| tool.pointer("/function/name"))
            .and_then(Value::as_str);
        name != Some(crate::tools::DISPATCH_TOOL)
    });
    definitions
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
    let started = std::time::Instant::now();
    // Registry classification rides on every tool event: the timeline, the
    // approval card, and the verification gate all read the same category and
    // risk instead of re-guessing from the tool name.
    let (category, risk) = crate::tools::classify(name);
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        session_id,
        "tool_started",
        json!({ "tool_name": name, "tool_id": tool_use_id, "source": "api", "category": category.as_str(), "risk": risk.as_str() }),
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
        broadcast_tool_finished(state, session_id, tool_use_id, name, false, &message, started.elapsed());
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
        "remember" => {
            let content = args.get("content").and_then(Value::as_str).unwrap_or("");
            if content.trim().is_empty() {
                Err("content is required".to_string())
            } else if !crate::memory::workspace_memory_enabled(project) {
                Err("workspace memory is disabled (toggle it on in the workspace settings to save notes)".to_string())
            } else {
            let title = args.get("title").and_then(Value::as_str).unwrap_or("Memory");
            let kind = args.get("kind").and_then(Value::as_str).unwrap_or("memory");
            let entry = if kind.eq_ignore_ascii_case("convention") {
                crate::memory::convention(title, content)
            } else {
                crate::memory::MemoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: title.to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    source_session: session_id.to_string(),
                    text: content.to_string(),
                    kind: "memory".to_string(),
                }
            };
                match crate::memory::save_memory(project, entry) {
                    Ok(()) => Ok(format!("Remembered: {title}")),
                    Err(e) => Err(e.to_string()),
                }
            }
        }
        "dispatch" => {
            let task = args.get("task").and_then(Value::as_str).unwrap_or("");
            let agents: Vec<String> = args
                .get("agents")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .filter(|a| !a.trim().is_empty())
                        .collect()
                })
                .unwrap_or_default();
            if task.trim().is_empty() || agents.is_empty() {
                Err("task and a non-empty agents list are required".to_string())
            } else {
                // The full orchestration primitive: fan out, wait, merge. The
                // dispatcher's own session is the parent, so the fan-out
                // renders on its timeline and dies with it.
                let body = json!({ "prompt": task, "agents": agents, "merge": true });
                let result = crate::agents::orchestrate::orchestrate(state, session_id, &body).await;
                if let Some(error) = result.get("error").and_then(Value::as_str) {
                    Err(error.to_string())
                } else {
                    // Compact report for the model: the merged answer first,
                    // then each agent's own result and status.
                    let mut report = String::new();
                    if let Some(reply) = result.get("merged_reply").and_then(Value::as_str) {
                        if !reply.trim().is_empty() {
                            report.push_str("Merged answer:\n");
                            report.push_str(reply.trim());
                            report.push_str("\n\n");
                        }
                    }
                    report.push_str("Per-agent results:");
                    for child in result
                        .get("children")
                        .and_then(Value::as_array)
                        .map(Vec::as_slice)
                        .unwrap_or_default()
                    {
                        let agent = child.get("agent").and_then(Value::as_str).unwrap_or("?");
                        let status = child.get("status").and_then(Value::as_str).unwrap_or("?");
                        let reply = child.get("reply").and_then(Value::as_str).unwrap_or("");
                        let error = child.get("error").and_then(Value::as_str);
                        report.push_str(&format!("\n## {agent} ({status})\n{reply}"));
                        if let Some(error) = error {
                            report.push_str(&format!("\nerror: {error}"));
                        }
                    }
                    Ok(report.trim().to_string())
                }
            }
        }
        "preview_app" => {
            let project = state
                .session_manager
                .get_session(session_id)
                .await
                .ok()
                .flatten()
                .and_then(|s| s.project);
            preview_app(state, session_id, project.as_deref(), args).await
        }
        "getconfig" => {
            let agent_id = state
                .session_manager
                .get_session(session_id)
                .await
                .ok()
                .flatten()
                .map(|s| s.agent)
                .unwrap_or_default();
            let cfg = state.config.read().await;
            let provider = cfg
                .settings()
                .agents
                .api_providers
                .iter()
                .find(|p| p.id == agent_id)
                .cloned();
            drop(cfg);
            let pending = state
                .session_manager
                .pending_config(session_id)
                .await
                .unwrap_or_default();
            let mut info = serde_json::Map::new();
            for (k, v) in &pending {
                info.insert(k.clone(), json!(v));
            }
            // Add provider-level info for context
            info.insert("provider".to_string(), json!(provider.as_ref().map(|p| p.name.clone())));
            Ok(serde_json::to_string_pretty(&info).unwrap_or_else(|_| "{}".to_string()))
        }
        other => Err(format!("Unknown tool: {other}")),
    };

    match result {
        Ok(output) => {
            let output = cap(output);
            broadcast_tool_finished(state, session_id, tool_use_id, name, true, &output, started.elapsed());
            output
        }
        Err(error) => {
            let message = format!("Tool error: {error}");
            broadcast_tool_finished(state, session_id, tool_use_id, name, false, &message, started.elapsed());
            message
        }
    }
}

/// Serve the session's workspace and open it in the session browser.
/// The same `preview_app` tool the model calls: static files by default, a
/// custom `{port}` command when given, then the agent's own CDP engine
/// navigates there (the run lands in the timeline like any browser step, and
/// the dashboard mirror shows the app).
async fn preview_app(
    state: &AppState,
    session_id: &str,
    project: Option<&str>,
    args: &Value,
) -> Result<String, String> {
    let Some(project) = project else {
        return Err("this session has no workspace folder to serve".to_string());
    };
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|c| !c.is_empty());
    let open = args.get("open_browser").and_then(Value::as_bool).unwrap_or(true);
    // Idempotent: an already-serving project is reused, not restarted — a
    // restart on every call churned ports and fed retry loops.
    let (port, fresh) = match state.app_servers.status(project).await {
        Some((port, _)) => (port, false),
        None => state.app_servers.start(project, command).await.map(|(port, _)| (port, true))?,
    };
    let url = format!("http://127.0.0.1:{port}");
    if !open {
        return Ok(format!("App serving at {url}."));
    }
    {
        let cfg = state.config.read().await;
        let daemon_url = format!("http://{}:{}", cfg.settings().server.host, cfg.settings().server.port);
        let token = state
            .hook_tokens
            .read()
            .await
            .get(session_id)
            .cloned()
            .unwrap_or_default();
        drop(cfg);
        state
            .browser_manager
            .ensure(session_id, &daemon_url, &token)
            .await
            .map_err(|e| format!("server is up at {url} but the browser engine failed to start: {e}"))?;
    }
    // The engine needs selecting once, then a fresh tab opened straight on
    // the URL — goto alone fails on a fresh engine with "no browser tab".
    // tab_new navigates on creation, so no separate goto is needed.
    let mut navigated = json!({});
    for tool in [
        json!({ "name": "browser_select", "arguments": { "backend": "cdp" } }),
        json!({ "name": "browser_tab_new", "arguments": { "url": url } }),
    ] {
        navigated = state
            .browser_manager
            .proxy_post(session_id, "/tool", tool)
            .await
            .map_err(|e| format!("server is up at {url} but the browser could not open it: {e}"))?;
    }
    if navigated.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        // Decisive wording matters: repeats must read as done, not as an
        // invitation to verify again with more tools.
        if fresh {
            Ok(format!("App serving at {url} and opened in the session browser. Done — no further verification needed."))
        } else {
            Ok(format!("App was already serving at {url}; it is open in the session browser. Done — no further verification needed."))
        }
    } else {
        Err(format!(
            "server is up at {url} but the browser reported: {}",
            navigated.get("error").and_then(Value::as_str).unwrap_or("unknown error")
        ))
    }
}

fn broadcast_tool_finished(
    state: &AppState,
    session_id: &str,
    tool_use_id: &str,
    name: &str,
    success: bool,
    output: &str,
    duration: std::time::Duration,
) {
    let mut event = AgentEvent::new(
        session_id,
        "tool_finished",
        json!({ "tool_id": tool_use_id, "tool_name": name, "success": success, "output": output, "source": "api" }),
    );
    event.duration_ms = Some(duration.as_millis() as u64);
    state.broadcast.broadcast_agent_event(event);
}

async fn run_bash(project: Option<&str>, command: &str) -> Result<String, String> {
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(command);
    if let Some(project) = project {
        cmd.current_dir(project);
    }
    // Bound the wait: without a timeout a hung command (a server, a pager, a
    // network stall) parks the whole turn forever — Stop is the only way out,
    // and it used to be a no-op for API sessions. 120s matches the provider
    // HTTP timeout; the model gets the partial story as result text.
    let output = tokio::time::timeout(std::time::Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| "command timed out after 120s".to_string())?
        .map_err(|e| e.to_string())?;
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

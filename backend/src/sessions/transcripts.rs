//! Converting a CLI's own transcript into this app's event stream.
//!
//! Discovery finds *that* a session exists; this reads *what happened in it*, so
//! an imported session shows its real conversation rather than an empty pane.
//!
//! Each provider writes a different format, so each needs its own reader. Both
//! produce the same normalized output — the very same `AgentEvent` kinds a live
//! session emits — which means the frontend reducer replays imported history
//! through exactly one code path. There is no separate "imported session"
//! rendering path that could drift from the live one.
//!
//! What is deliberately dropped: system prompts, skill instructions, environment
//! context, and other injected preamble. It is not conversation, and it is
//! enormous — a single Codex `developer` message runs to tens of kilobytes.

use crate::agent_events::{AgentEvent, AgentMessage};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// A session's history, normalized.
#[derive(Debug, Default)]
pub struct Transcript {
    pub messages: Vec<AgentMessage>,
    pub events: Vec<AgentEvent>,
}

impl Transcript {
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty() && self.events.is_empty()
    }
}

/// Read a session's history from whichever provider recorded it.
///
/// `Ok(None)` means the provider stores no readable transcript — not an error.
pub async fn read(
    agent: &str,
    external_id: &str,
    session_id: &str,
) -> Result<Option<Transcript>, String> {
    let home = home_dir().ok_or("HOME is not set")?;
    match agent {
        "codex" => Ok(Some(
            read_codex(&home.join(".codex").join("sessions"), external_id, session_id).await?,
        )),
        "claude" => Ok(Some(
            read_claude(&home.join(".claude").join("projects"), external_id, session_id).await?,
        )),
        // opencode keeps history in an internal store with no documented
        // export for a single session. Its sessions import as resumable
        // placeholders until there is a supported way to read them.
        _ => Ok(None),
    }
}

/* ── Codex ──────────────────────────────────────────────────────────────── */

/// Codex rollouts: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`.
///
/// The interesting records are `response_item` with `type: "message"` — roles
/// `user` and `assistant`. `developer` messages are system scaffolding and are
/// skipped, as are `user` messages that are purely injected context.
///
/// `root` is a parameter rather than derived from `$HOME` so tests can point at
/// a fixture directory without mutating process-global state — which races when
/// tests run in parallel.
async fn read_codex(
    root: &Path,
    external_id: &str,
    session_id: &str,
) -> Result<Transcript, String> {
    let path = find_file_ending_with(root, &format!("{}.jsonl", external_id))
        .await
        .ok_or_else(|| format!("no rollout file found for session {}", external_id))?;
    let contents = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("could not read {}: {}", path.display(), error))?;

    let mut transcript = Transcript::default();
    let mut sequence = 0u64;

    for line in contents.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let timestamp = record
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp);

        match record.get("type").and_then(Value::as_str) {
            Some("response_item") => {
                let payload = record.get("payload");
                let Some(payload) = payload else { continue };
                if payload.get("type").and_then(Value::as_str) != Some("message") {
                    continue;
                }
                let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
                // `developer` is system scaffolding, never conversation.
                if role != "user" && role != "assistant" {
                    continue;
                }
                let text = codex_text(payload.get("content"));
                if text.trim().is_empty() || is_injected_context(&text) {
                    continue;
                }
                sequence += 1;
                push_message(&mut transcript, session_id, role, &text, timestamp, sequence);
            }
            // Tool activity lives in `item_completed` events.
            Some("event_msg") => {
                let Some(payload) = record.get("payload") else { continue };
                if payload.get("type").and_then(Value::as_str) != Some("item_completed") {
                    continue;
                }
                if let Some(item) = payload.get("item") {
                    sequence += 1;
                    if let Some(event) =
                        codex_item_event(session_id, item, timestamp, sequence)
                    {
                        transcript.events.push(event);
                    }
                }
            }
            _ => {}
        }
    }

    Ok(transcript)
}

/// Codex content blocks: `[{ "type": "input_text", "text": "…" }]`.
fn codex_text(content: Option<&Value>) -> String {
    let Some(Value::Array(blocks)) = content else {
        return content
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_default();
    };
    blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
}

/// A completed item — a command, a file edit, a tool call — as a finished event.
///
/// Historical items are emitted already-complete rather than as a start/finish
/// pair: there is no live progress to show, and a lone start would render as a
/// spinner that never resolves.
fn codex_item_event(
    session_id: &str,
    item: &Value,
    timestamp: Option<chrono::DateTime<chrono::Utc>>,
    sequence: u64,
) -> Option<AgentEvent> {
    let item_type = item.get("type").and_then(Value::as_str)?;
    let tool_id = item
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("history-{}", sequence));

    let event = match item_type {
        "command_execution" => AgentEvent::new(
            session_id,
            "command_finished",
            json!({
                "command": item.get("command").and_then(Value::as_str).unwrap_or(""),
                "exit_code": item.get("exit_code").and_then(Value::as_i64),
                "success": item.get("exit_code").and_then(Value::as_i64) == Some(0),
                "output": item.get("aggregated_output").and_then(Value::as_str),
                "tool_id": tool_id,
                "source": "history",
            }),
        ),
        "file_change" => AgentEvent::new(
            session_id,
            "file_edited",
            json!({
                "path": item.get("path").and_then(Value::as_str).unwrap_or(""),
                "success": true,
                "source": "history",
            }),
        ),
        "reasoning" => {
            let text = item
                .get("text")
                .and_then(Value::as_str)
                .or_else(|| item.get("summary").and_then(Value::as_str))?;
            AgentEvent::new(
                session_id,
                "thinking_delta",
                json!({ "text": text, "delta": false, "source": "history" }),
            )
        }
        // Unknown item kinds are skipped rather than rendered as a mystery row.
        _ => return None,
    };

    Some(stamp(event, timestamp, sequence))
}

/* ── Claude ─────────────────────────────────────────────────────────────── */

/// Claude transcripts: `~/.claude/projects/<slug>/<uuid>.jsonl`.
///
/// Records are typed `user` / `assistant`, each carrying a `message` whose
/// `content` is either a string or an array of blocks: `text`, `thinking`,
/// `tool_use`, and (on user records) `tool_result`.
///
/// `root` is a parameter for the same reason as `read_codex`: testable without
/// mutating `$HOME`.
async fn read_claude(
    root: &Path,
    external_id: &str,
    session_id: &str,
) -> Result<Transcript, String> {
    let path = find_file_ending_with(root, &format!("{}.jsonl", external_id))
        .await
        .ok_or_else(|| format!("no transcript found for session {}", external_id))?;
    let contents = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("could not read {}: {}", path.display(), error))?;

    let mut transcript = Transcript::default();
    let mut sequence = 0u64;
    // Tool inputs, kept so a `tool_result` can be paired with its call.
    let mut pending_tools: std::collections::HashMap<String, (String, String)> =
        std::collections::HashMap::new();

    for line in contents.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let record_type = record.get("type").and_then(Value::as_str).unwrap_or("");
        if record_type != "user" && record_type != "assistant" {
            continue;
        }
        let timestamp = record
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp);
        let Some(content) = record.get("message").and_then(|message| message.get("content")) else {
            continue;
        };

        // A plain string is a simple message.
        if let Some(text) = content.as_str() {
            if !text.trim().is_empty() && !is_injected_context(text) {
                sequence += 1;
                push_message(&mut transcript, session_id, record_type, text, timestamp, sequence);
            }
            continue;
        }

        let Some(blocks) = content.as_array() else { continue };
        for block in blocks {
            let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
            match block_type {
                "text" => {
                    let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                    if text.trim().is_empty() || is_injected_context(text) {
                        continue;
                    }
                    sequence += 1;
                    push_message(&mut transcript, session_id, record_type, text, timestamp, sequence);
                }
                "thinking" => {
                    let text = block.get("thinking").and_then(Value::as_str).unwrap_or("");
                    if text.trim().is_empty() {
                        continue;
                    }
                    sequence += 1;
                    transcript.events.push(stamp(
                        AgentEvent::new(
                            session_id,
                            "thinking_delta",
                            json!({ "text": text, "delta": false, "source": "history" }),
                        ),
                        timestamp,
                        sequence,
                    ));
                }
                "tool_use" => {
                    let tool_id = block.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                    let name = block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Tool")
                        .to_string();
                    let input = stringify(block.get("input"));
                    // Held until the matching result arrives, so the pair is
                    // emitted as one finished step rather than a hanging start.
                    pending_tools.insert(tool_id, (name, input));
                }
                "tool_result" => {
                    let tool_id = block
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let (name, input) = pending_tools
                        .remove(&tool_id)
                        .unwrap_or_else(|| ("Tool".to_string(), String::new()));
                    let failed = block
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let output = stringify(block.get("content"));

                    sequence += 1;
                    let kind = if name == "Bash" { "command_finished" } else { "tool_finished" };
                    let payload = if kind == "command_finished" {
                        json!({
                            "command": bash_command(&input),
                            "success": !failed,
                            "exit_code": if failed { 1 } else { 0 },
                            "output": output,
                            "tool_id": tool_id,
                            "source": "history",
                        })
                    } else {
                        json!({
                            "tool_name": name,
                            "input": input,
                            "output": output,
                            "success": !failed,
                            "tool_id": tool_id,
                            "source": "history",
                        })
                    };
                    transcript.events.push(stamp(
                        AgentEvent::new(session_id, kind, payload),
                        timestamp,
                        sequence,
                    ));
                }
                _ => {}
            }
        }
    }

    // Tool calls whose result never appeared still happened; show them rather
    // than dropping the step entirely.
    for (tool_id, (name, input)) in pending_tools {
        sequence += 1;
        transcript.events.push(stamp(
            AgentEvent::new(
                session_id,
                "tool_finished",
                json!({
                    "tool_name": name,
                    "input": input,
                    "success": true,
                    "tool_id": tool_id,
                    "source": "history",
                }),
            ),
            None,
            sequence,
        ));
    }

    Ok(transcript)
}

/// Pull the command out of a Bash tool's input for a readable label.
fn bash_command(input: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(input) {
        if let Some(command) = value.get("command").and_then(Value::as_str) {
            return command.to_string();
        }
    }
    // Claude writes tool inputs with Python-style single quotes, which is not
    // JSON. Fall back to a targeted extraction rather than mangling the value.
    if let Some(rest) = input.split("'command': '").nth(1) {
        if let Some(end) = rest.find("', '") {
            return rest[..end].to_string();
        }
        if let Some(stripped) = rest.strip_suffix("'}") {
            return stripped.to_string();
        }
    }
    input.to_string()
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

fn push_message(
    transcript: &mut Transcript,
    session_id: &str,
    role: &str,
    text: &str,
    timestamp: Option<chrono::DateTime<chrono::Utc>>,
    sequence: u64,
) {
    transcript.messages.push(AgentMessage {
        // Deterministic so re-importing the same transcript does not duplicate
        // rows — `INSERT OR IGNORE` then makes the operation idempotent.
        id: format!("history-{}-{}", session_id, sequence),
        session_id: session_id.to_string(),
        role: role.to_string(),
        content: text.trim().to_string(),
        timestamp: timestamp.unwrap_or_else(chrono::Utc::now),
    });
}

/// Give a history event a stable id and its recorded time.
fn stamp(
    mut event: AgentEvent,
    timestamp: Option<chrono::DateTime<chrono::Utc>>,
    sequence: u64,
) -> AgentEvent {
    event.event_id = format!("history-{}-{}", event.session_id, sequence);
    event.sequence = sequence;
    if let Some(timestamp) = timestamp {
        event.timestamp = timestamp;
    }
    event
}

fn stringify(value: Option<&Value>) -> String {
    match value {
        None => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn parse_timestamp(text: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|stamp| stamp.with_timezone(&chrono::Utc))
}

/// Machine-generated context injected into a transcript, not user conversation.
///
/// These blocks are large and meaningless to a reader: environment dumps, skill
/// catalogues, caveat banners. Rendering them would bury the actual conversation.
fn is_injected_context(text: &str) -> bool {
    let head = text.trim_start();
    head.starts_with("<environment_context>")
        || head.starts_with("<skills_instructions>")
        || head.starts_with("<multi_agent_mode>")
        || head.starts_with("<system-reminder>")
        || head.starts_with("<local-command-")
        || head.starts_with("Caveat:")
        || head.starts_with("[The user rewound")
        || head.starts_with("[Request interrupted")
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Find a file whose name ends with `suffix`, searching recursively.
async fn find_file_ending_with(root: &Path, suffix: &str) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let Ok(meta) = entry.metadata().await else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(suffix))
            {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_injected_context_but_keeps_real_prompts() {
        assert!(is_injected_context("<environment_context>\n  <cwd>/home</cwd>"));
        assert!(is_injected_context("<skills_instructions>\n## Skills"));
        assert!(is_injected_context("Caveat: The messages below were generated"));
        assert!(is_injected_context("[The user rewound this conversation]"));

        assert!(!is_injected_context("hey"));
        assert!(!is_injected_context("Fix the <div> in the header"));
    }

    #[test]
    fn extracts_bash_command_from_both_input_styles() {
        // Proper JSON.
        assert_eq!(bash_command(r#"{"command":"git status"}"#), "git status");
        // Claude's Python-style dict, which is not JSON.
        assert_eq!(
            bash_command("{'command': 'pwd', 'description': 'Check the cwd'}"),
            "pwd"
        );
        assert_eq!(bash_command("{'command': 'ls -la'}"), "ls -la");
    }

    #[test]
    fn codex_text_joins_content_blocks() {
        let content = json!([
            { "type": "input_text", "text": "Hello " },
            { "type": "input_text", "text": "world" }
        ]);
        assert_eq!(codex_text(Some(&content)), "Hello world");
        assert_eq!(codex_text(Some(&json!("plain"))), "plain");
        assert_eq!(codex_text(None), "");
    }

    /// Ids must be deterministic so re-importing does not duplicate rows.
    #[test]
    fn history_ids_are_deterministic() {
        let mut transcript = Transcript::default();
        push_message(&mut transcript, "sess-1", "user", "hey", None, 3);
        assert_eq!(transcript.messages[0].id, "history-sess-1-3");

        let event = stamp(AgentEvent::new("sess-1", "file_edited", json!({})), None, 7);
        assert_eq!(event.event_id, "history-sess-1-7");
        assert_eq!(event.sequence, 7);
    }

    /// Verbatim records from a real rollout on this machine.
    #[tokio::test]
    async fn reads_a_codex_rollout_into_messages_and_events() {
        let dir = std::env::temp_dir().join(format!("adtx-codex-{}", uuid::Uuid::new_v4()));
        let sessions = dir.join("2026").join("08").join("17");
        tokio::fs::create_dir_all(&sessions).await.expect("temp dir");
        let external_id = "01a00fdb-122b-7383-9857-dd7fc2646a53";
        let path = sessions.join(format!("rollout-2026-08-17T16-13-30-{}.jsonl", external_id));

        let contents = [
            r#"{"timestamp":"2026-08-17T13:13:30.697Z","type":"session_meta","payload":{"session_id":"01a00fdb","cwd":"/home/kareem"}}"#,
            // A developer message: system scaffolding, must be dropped.
            r#"{"timestamp":"2026-08-17T13:13:31.000Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"<skills_instructions>\n## Skills"}]}}"#,
            // A user message that is only environment context: dropped.
            r#"{"timestamp":"2026-08-17T13:13:32.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>/home/kareem</cwd>"}]}}"#,
            // A real prompt: kept.
            r#"{"timestamp":"2026-08-17T13:13:33.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hey"}]}}"#,
            r#"{"timestamp":"2026-08-17T13:13:34.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"input_text","text":"Hello!"}]}}"#,
            r#"{"timestamp":"2026-08-17T13:13:35.000Z","type":"event_msg","payload":{"type":"item_completed","item":{"type":"command_execution","id":"cmd1","command":"ls -la","exit_code":0,"aggregated_output":"util.js"}}}"#,
        ]
        .join("\n");
        tokio::fs::write(&path, contents).await.expect("write");

        let transcript = read_codex(&dir, external_id, "local-1").await.expect("read");

        assert_eq!(
            transcript.messages.len(),
            2,
            "only the real prompt and reply, got {:?}",
            transcript.messages.iter().map(|m| &m.content).collect::<Vec<_>>()
        );
        assert_eq!(transcript.messages[0].role, "user");
        assert_eq!(transcript.messages[0].content, "hey");
        assert_eq!(transcript.messages[1].role, "assistant");
        assert_eq!(transcript.messages[1].content, "Hello!");

        let command = transcript
            .events
            .iter()
            .find(|event| event.kind == "command_finished")
            .expect("command event");
        assert_eq!(command.payload["command"], "ls -la");
        assert_eq!(command.payload["success"], true);
        assert_eq!(command.payload["output"], "util.js");

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    /// Verbatim block shapes from a real `~/.claude/projects` transcript.
    #[tokio::test]
    async fn reads_a_claude_transcript_with_tools_and_thinking() {
        let dir = std::env::temp_dir().join(format!("adtx-claude-{}", uuid::Uuid::new_v4()));
        let external_id = "e3037678-a234-4ff1-af94-2028cabbe4fc";
        let projects = dir.join(".claude").join("projects").join("-tmp");
        tokio::fs::create_dir_all(&projects).await.expect("temp dir");
        let path = projects.join(format!("{}.jsonl", external_id));

        let contents = [
            r#"{"type":"user","timestamp":"2026-08-17T10:00:00.000Z","message":{"content":"Tool call test"}}"#,
            // `r##` because the file content itself contains a `#` heading.
            r##"{"type":"assistant","timestamp":"2026-08-17T10:00:01.000Z","message":{"content":[{"type":"thinking","thinking":"The user wants a tool call.","signature":""},{"type":"text","text":"I'll write a file."},{"type":"tool_use","id":"call_e479","name":"Write","input":{"file_path":"/tmp/test.md","content":"# Test"}}]}}"##,
            r#"{"type":"user","timestamp":"2026-08-17T10:00:02.000Z","message":{"content":[{"tool_use_id":"call_e479","type":"tool_result","content":"File created successfully at: /tmp/test.md"}]}}"#,
            r#"{"type":"assistant","timestamp":"2026-08-17T10:00:03.000Z","message":{"content":[{"type":"tool_use","id":"call_b810","name":"Bash","input":{"command":"pwd"}}]}}"#,
            r#"{"type":"user","timestamp":"2026-08-17T10:00:04.000Z","message":{"content":[{"tool_use_id":"call_b810","type":"tool_result","content":"/tmp/gittest","is_error":false}]}}"#,
        ]
        .join("\n");
        tokio::fs::write(&path, contents).await.expect("write");

        let transcript = read_claude(&dir.join(".claude").join("projects"), external_id, "local-2")
            .await
            .expect("read");

        let texts: Vec<&str> = transcript
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect();
        assert!(texts.contains(&"Tool call test"), "got {:?}", texts);
        assert!(texts.contains(&"I'll write a file."), "got {:?}", texts);

        let kinds: Vec<&str> = transcript.events.iter().map(|e| e.kind.as_str()).collect();
        assert!(kinds.contains(&"thinking_delta"), "reasoning kept: {:?}", kinds);
        assert!(kinds.contains(&"tool_finished"), "tool paired: {:?}", kinds);
        assert!(kinds.contains(&"command_finished"), "bash became a command: {:?}", kinds);

        let tool = transcript
            .events
            .iter()
            .find(|event| event.kind == "tool_finished")
            .expect("tool event");
        assert_eq!(tool.payload["tool_name"], "Write");
        assert!(tool.payload["output"].as_str().unwrap().contains("/tmp/test.md"));

        let command = transcript
            .events
            .iter()
            .find(|event| event.kind == "command_finished")
            .expect("command event");
        assert_eq!(command.payload["command"], "pwd");
        assert_eq!(command.payload["output"], "/tmp/gittest");

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn providers_without_readable_history_return_none() {
        assert!(read("opencode", "ses_abc", "local-3").await.expect("ok").is_none());
        assert!(read("gemini", "x", "local-3").await.expect("ok").is_none());
    }
}

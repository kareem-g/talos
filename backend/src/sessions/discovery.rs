//! Discovering sessions that already exist inside each CLI's own storage.
//!
//! Agent CLIs keep their own history, and it is real work: `codex resume`,
//! `claude --resume`, and `opencode` all read from it. Before this, that history
//! was invisible here — a user's actual sessions only appeared if they had been
//! created through this app.
//!
//! Each provider stores history differently, so each needs its own reader:
//!
//! | Provider | Location | Format |
//! |---|---|---|
//! | opencode | internal store | `opencode session list --format json` |
//! | codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | first line is `session_meta` |
//! | claude | `~/.claude/projects/<slug>/<uuid>.jsonl` | `cwd`/`sessionId` on early lines |
//!
//! Two rules apply throughout:
//!
//! - **Session ids are opaque.** They are read and passed back verbatim.
//! - **Reading is read-only.** Nothing here writes to or truncates a CLI's own
//!   history; a bug must not be able to destroy a user's work.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::time::{timeout, Duration};

/// How long any single provider gets. A slow or hanging CLI must not stall the
/// others, which are probed concurrently.
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(20);

/// Newest-first cap per provider. Users have hundreds of transcripts; the recent
/// ones are what they are looking for, and an unbounded list is unusable in a UI.
const MAX_PER_PROVIDER: usize = 60;

/// A session found in a CLI's own storage.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSession {
    /// Provider id this belongs to (`claude`, `codex`, `opencode`, …).
    pub agent: String,
    /// The CLI's own session identifier. Opaque; passed back unchanged.
    pub external_id: String,
    /// Best available human label: the session's title, or its first prompt.
    pub title: String,
    /// Working directory the session ran in, when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Last activity, when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// True when this app already has a row for it.
    pub imported: bool,
}

/// Everything found, plus anything that went wrong finding it.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryReport {
    pub sessions: Vec<DiscoveredSession>,
    /// Per-provider failures, reported rather than swallowed: "no sessions
    /// found" and "could not read them" are different answers.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<DiscoveryError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryError {
    pub agent: String,
    pub message: String,
}

/// Read sessions from every provider that stores them, concurrently.
///
/// `executables` maps provider id → resolved binary path, so discovery uses the
/// same binary the app would spawn rather than re-resolving PATH.
pub async fn discover(executables: &[(String, String)]) -> DiscoveryReport {
    let mut tasks: Vec<futures::future::BoxFuture<'static, (String, Result<Vec<DiscoveredSession>, String>)>> =
        Vec::new();

    for (agent, executable) in executables {
        let agent = agent.clone();
        let executable = executable.clone();
        match agent.as_str() {
            "opencode" => tasks.push(Box::pin(async move {
                let result = timeout(PROVIDER_TIMEOUT, opencode_sessions(&executable))
                    .await
                    .unwrap_or_else(|_| Err("listing sessions timed out".to_string()));
                (agent, result)
            })),
            "codex" => tasks.push(Box::pin(async move {
                let result = timeout(PROVIDER_TIMEOUT, codex_sessions())
                    .await
                    .unwrap_or_else(|_| Err("reading session history timed out".to_string()));
                (agent, result)
            })),
            "claude" => tasks.push(Box::pin(async move {
                let result = timeout(PROVIDER_TIMEOUT, claude_sessions())
                    .await
                    .unwrap_or_else(|_| Err("reading session history timed out".to_string()));
                (agent, result)
            })),
            // Other providers expose no readable history yet. Silently skipping
            // them is correct: there is nothing to report.
            _ => {}
        }
    }

    let mut report = DiscoveryReport::default();
    for (agent, result) in futures::future::join_all(tasks).await {
        match result {
            Ok(sessions) => report.sessions.extend(sessions),
            Err(message) => report.errors.push(DiscoveryError { agent, message }),
        }
    }

    // Newest first, undated last.
    report.sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    report
}

/// `opencode session list --format json`.
///
/// The CLI has a real JSON mode, so this needs no scraping. Its stdout also
/// carries plugin chatter — and crucially that chatter is *bracketed*
/// (`[opencode-mobile] v1.4.0`), so looking for the first `[` finds a log line,
/// not the payload. The array is located by trying to parse from each candidate.
async fn opencode_sessions(executable: &str) -> Result<Vec<DiscoveredSession>, String> {
    let output = tokio::process::Command::new(executable)
        .args(["session", "list", "--format", "json", "-n"])
        .arg(MAX_PER_PROVIDER.to_string())
        .output()
        .await
        .map_err(|error| format!("could not run `{} session list`: {}", executable, error))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .lines()
            .next()
            .unwrap_or("session list failed")
            .to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let rows = extract_json_array(&stdout)
        .ok_or_else(|| "no JSON array in session list output".to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let external_id = row.get("id")?.as_str()?.to_string();
            let title = row
                .get("title")
                .and_then(serde_json::Value::as_str)
                .filter(|title| !title.trim().is_empty())
                .unwrap_or(&external_id)
                .to_string();
            Some(DiscoveredSession {
                agent: "opencode".to_string(),
                external_id,
                title,
                project: row
                    .get("directory")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                // Epoch milliseconds.
                updated_at: row
                    .get("updated")
                    .and_then(serde_json::Value::as_i64)
                    .and_then(chrono::DateTime::from_timestamp_millis),
                imported: false,
            })
        })
        .collect())
}

/// Find and parse a JSON array embedded in noisy output.
///
/// Necessary because a CLI's plugins log to stdout, and their prefixes look like
/// the start of an array. Each `[` is tried in turn; the first that parses as an
/// array of objects wins.
fn extract_json_array(text: &str) -> Option<Vec<serde_json::Value>> {
    for (index, _) in text.char_indices().filter(|(_, ch)| *ch == '[') {
        if let Ok(rows) = serde_json::from_str::<Vec<serde_json::Value>>(text[index..].trim_end()) {
            return Some(rows);
        }
    }
    None
}

/// Codex rollouts: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`.
///
/// The first line is a `session_meta` record carrying the id and cwd. Only the
/// head of each file is read — these grow to megabytes, and the metadata is at
/// the top.
async fn codex_sessions() -> Result<Vec<DiscoveredSession>, String> {
    let root = home_dir()?.join(".codex").join("sessions");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let files = newest_files(&root, "jsonl", MAX_PER_PROVIDER).await?;

    let mut sessions = Vec::new();
    for file in files {
        if let Some(session) = read_codex_rollout(&file).await {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

async fn read_codex_rollout(path: &Path) -> Option<DiscoveredSession> {
    let head = read_head(path, 64).await?;
    let mut external_id = None;
    let mut project = None;
    let mut updated_at = None;
    let mut title = None;

    for line in head.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let payload = value.get("payload");
        match value.get("type").and_then(serde_json::Value::as_str) {
            Some("session_meta") => {
                let meta = payload?;
                external_id = meta
                    .get("session_id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                project = meta
                    .get("cwd")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                updated_at = meta
                    .get("timestamp")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|stamp| chrono::DateTime::parse_from_rfc3339(stamp).ok())
                    .map(|stamp| stamp.with_timezone(&chrono::Utc));
            }
            // The first user message is a far better label than a uuid.
            Some("event_msg") => {
                if title.is_none() {
                    if let Some(payload) = payload {
                        if payload.get("type").and_then(serde_json::Value::as_str)
                            == Some("user_message")
                        {
                            title = payload
                                .get("message")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_string);
                        }
                    }
                }
            }
            _ => {}
        }
        if external_id.is_some() && title.is_some() {
            break;
        }
    }

    let external_id = external_id?;
    Some(DiscoveredSession {
        agent: "codex".to_string(),
        title: summarize(title.as_deref(), &external_id),
        external_id,
        project,
        updated_at,
        imported: false,
    })
}

/// Claude transcripts: `~/.claude/projects/<slug>/<uuid>.jsonl`.
///
/// `sessionId` and `cwd` appear on the first few records. The directory slug is
/// a mangled path (`-home-kareem-project`) and is deliberately *not* used to
/// reconstruct the cwd — that mapping is ambiguous for paths containing dashes.
/// The recorded `cwd` is authoritative.
async fn claude_sessions() -> Result<Vec<DiscoveredSession>, String> {
    let root = home_dir()?.join(".claude").join("projects");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let files = newest_files(&root, "jsonl", MAX_PER_PROVIDER).await?;

    let mut sessions = Vec::new();
    for file in files {
        if let Some(session) = read_claude_transcript(&file).await {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

async fn read_claude_transcript(path: &Path) -> Option<DiscoveredSession> {
    let head = read_head(path, 48).await?;
    let mut external_id = None;
    let mut project = None;
    let mut updated_at = None;
    let mut title = None;

    for line in head.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if external_id.is_none() {
            external_id = value
                .get("sessionId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
        }
        if project.is_none() {
            project = value
                .get("cwd")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
        }
        if updated_at.is_none() {
            updated_at = value
                .get("timestamp")
                .and_then(serde_json::Value::as_str)
                .and_then(|stamp| chrono::DateTime::parse_from_rfc3339(stamp).ok())
                .map(|stamp| stamp.with_timezone(&chrono::Utc));
        }
        // Prefer a real user prompt for the title. A transcript's first `user`
        // record is often injected preamble (caveats, rewind notices), so keep
        // reading until one survives `summarize`'s filter.
        if title.is_none() && value.get("type").and_then(serde_json::Value::as_str) == Some("user") {
            let text = value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(claude_text);
            if let Some(text) = text {
                let usable = text
                    .lines()
                    .map(str::trim)
                    .any(|line| !line.is_empty() && !is_injected_preamble(line));
                if usable {
                    title = Some(text);
                }
            }
        }
        if external_id.is_some() && title.is_some() && project.is_some() {
            break;
        }
    }

    let external_id = external_id?;
    Some(DiscoveredSession {
        agent: "claude".to_string(),
        title: summarize(title.as_deref(), &external_id),
        external_id,
        project,
        // The file's mtime is a better "last activity" than the first record's
        // timestamp, which is when the session *started*.
        updated_at: file_modified(path).await.or(updated_at),
        imported: false,
    })
}

/// Message content is either a plain string or an array of typed blocks.
fn claude_text(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(blocks) => blocks.iter().find_map(|block| {
            block
                .get("text")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        }),
        _ => None,
    }
}

/// A single-line label from a prompt, falling back to the id.
///
/// Transcripts open with injected system text — Claude's `<local-command-…>`
/// caveats, rewind notices — which makes a useless title. Those are skipped in
/// favour of the first line that looks like something a person typed.
fn summarize(text: Option<&str>, fallback: &str) -> String {
    let Some(text) = text else {
        return fallback.to_string();
    };
    // When every line is injected preamble there is no user intent to show, so
    // the id is a more honest label than a caveat banner.
    let Some(candidate) = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !is_injected_preamble(line))
    else {
        return fallback.to_string();
    };

    // Char-based truncation: byte slicing would panic mid-codepoint.
    let mut label: String = candidate.chars().take(72).collect();
    if candidate.chars().count() > 72 {
        label.push('…');
    }
    label
}

/// Lines a CLI injects into its own transcript, which are not user intent.
fn is_injected_preamble(line: &str) -> bool {
    let lowered = line.to_lowercase();
    lowered.starts_with('<')
        || lowered.starts_with("caveat:")
        || lowered.starts_with("[the user")
        || lowered.starts_with("[request interrupted")
        || lowered.starts_with("this session is being continued")
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())
}

async fn file_modified(path: &Path) -> Option<chrono::DateTime<chrono::Utc>> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    Some(meta.modified().ok()?.into())
}

/// The `limit` most recently modified files with `extension`, searched
/// recursively.
///
/// Sorting by mtime is what makes the result useful: a user wants their recent
/// sessions, and these directories accumulate hundreds of files.
async fn newest_files(root: &Path, extension: &str, limit: usize) -> Result<Vec<PathBuf>, String> {
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(entries) => entries,
            // An unreadable subdirectory should not abandon the whole scan.
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let Ok(meta) = entry.metadata().await else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some(extension) {
                if let Ok(modified) = meta.modified() {
                    found.push((modified, path));
                }
            }
        }
    }

    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found.into_iter().take(limit).map(|(_, path)| path).collect())
}

/// Read at most `lines` lines from the head of a file.
///
/// Transcripts reach hundreds of megabytes; the metadata is at the top, so
/// reading the whole file would be both slow and pointless.
async fn read_head(path: &Path, lines: usize) -> Option<String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let file = tokio::fs::File::open(path).await.ok()?;
    let mut reader = BufReader::new(file);
    let mut head = String::new();
    let mut buffer = String::new();
    for _ in 0..lines {
        buffer.clear();
        match reader.read_line(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(_) => head.push_str(&buffer),
        }
    }
    (!head.is_empty()).then_some(head)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_prefers_the_first_prompt_line() {
        assert_eq!(summarize(Some("Fix the auth bug\nmore detail"), "id"), "Fix the auth bug");
        assert_eq!(summarize(Some("   "), "fallback-id"), "fallback-id");
        assert_eq!(summarize(None, "fallback-id"), "fallback-id");
    }

    /// Real preambles seen in `~/.claude/projects` transcripts. Using them as
    /// titles produced session rows labelled "<local-command-caveat>Caveat: …".
    #[test]
    fn summarize_skips_injected_preamble() {
        let caveat = "<local-command-caveat>Caveat: The messages below were generated\nActually fix the parser";
        assert_eq!(summarize(Some(caveat), "id"), "Actually fix the parser");

        let rewind = "[The user rewound this conversation (edited a message)]\nTry again with tests";
        assert_eq!(summarize(Some(rewind), "id"), "Try again with tests");

        // Nothing but preamble falls back to the id rather than showing noise.
        assert_eq!(
            summarize(Some("<local-command-caveat>Caveat: only this"), "fallback"),
            "fallback"
        );
    }

    /// Plugin log lines are bracketed, so "find the first `[`" locates a log
    /// line rather than the JSON payload — which is exactly what broke opencode
    /// discovery with `expected value at line 1 column 2`.
    #[test]
    fn extracts_json_array_past_bracketed_log_lines() {
        let noisy = concat!(
            "[opencode-mobile] v1.4.0\n",
            "[opencode-mobile] Plugin init called\n",
            r#"[{"id":"ses_abc","title":"Real session"}]"#,
            "\n",
        );
        let rows = extract_json_array(noisy).expect("array found past the log lines");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "ses_abc");

        assert!(extract_json_array("[not json] [also not]").is_none());
        assert!(extract_json_array("no brackets at all").is_none());
    }

    /// Truncation must be char-based: byte slicing a multi-byte codepoint panics.
    #[test]
    fn summarize_truncates_without_splitting_characters() {
        let long = "日本語のテキスト".repeat(20);
        let label = summarize(Some(&long), "id");
        assert!(label.chars().count() <= 73, "got {} chars", label.chars().count());
        assert!(label.ends_with('…'));
    }

    #[test]
    fn claude_text_handles_both_content_shapes() {
        let plain = serde_json::json!("just a string");
        assert_eq!(claude_text(&plain).as_deref(), Some("just a string"));

        let blocks = serde_json::json!([
            { "type": "image" },
            { "type": "text", "text": "the prompt" }
        ]);
        assert_eq!(claude_text(&blocks).as_deref(), Some("the prompt"));

        assert_eq!(claude_text(&serde_json::json!(42)), None);
    }

    /// Real `session_meta` line from a codex rollout on disk.
    #[tokio::test]
    async fn parses_a_codex_rollout() {
        let dir = std::env::temp_dir().join(format!("adtest-codex-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.expect("temp dir");
        let path = dir.join("rollout-2026-08-17T16-13-30-01a00fdb.jsonl");

        let contents = concat!(
            r#"{"timestamp":"2026-08-17T13:13:30.697Z","ordinal":0,"type":"session_meta","payload":{"session_id":"01a00fdb-122b-7383-9857-dd7fc2646a53","cwd":"/home/kareem/project","timestamp":"2026-08-17T13:13:30.412Z","cli_version":"0.147.0"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-17T13:13:31.000Z","type":"event_msg","payload":{"type":"user_message","message":"Refactor the parser\nand add tests"}}"#,
            "\n",
        );
        tokio::fs::write(&path, contents).await.expect("write");

        let session = read_codex_rollout(&path).await.expect("parsed");
        assert_eq!(session.agent, "codex");
        assert_eq!(session.external_id, "01a00fdb-122b-7383-9857-dd7fc2646a53");
        assert_eq!(session.project.as_deref(), Some("/home/kareem/project"));
        assert_eq!(session.title, "Refactor the parser");
        assert!(session.updated_at.is_some());
        assert!(!session.imported);

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    /// Real record shape from a `~/.claude/projects` transcript.
    #[tokio::test]
    async fn parses_a_claude_transcript() {
        let dir = std::env::temp_dir().join(format!("adtest-claude-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.expect("temp dir");
        let path = dir.join("c53ac110-c602-4d4e-a6b9-13ed7cf6d310.jsonl");

        let contents = concat!(
            r#"{"type":"mode","mode":"default","sessionId":"c53ac110-c602-4d4e-a6b9-13ed7cf6d310"}"#,
            "\n",
            r#"{"type":"user","sessionId":"c53ac110-c602-4d4e-a6b9-13ed7cf6d310","cwd":"/tmp/stream-probe/work","timestamp":"2026-08-12T02:31:34.610Z","message":{"content":"Write an essay about lighthouses"}}"#,
            "\n",
        );
        tokio::fs::write(&path, contents).await.expect("write");

        let session = read_claude_transcript(&path).await.expect("parsed");
        assert_eq!(session.agent, "claude");
        assert_eq!(session.external_id, "c53ac110-c602-4d4e-a6b9-13ed7cf6d310");
        assert_eq!(session.project.as_deref(), Some("/tmp/stream-probe/work"));
        assert_eq!(session.title, "Write an essay about lighthouses");

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    /// A transcript with no session id yields nothing rather than a bogus entry.
    #[tokio::test]
    async fn skips_files_without_a_session_id() {
        let dir = std::env::temp_dir().join(format!("adtest-empty-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.expect("temp dir");
        let path = dir.join("garbage.jsonl");
        tokio::fs::write(&path, "not json at all\n{}\n").await.expect("write");

        assert!(read_claude_transcript(&path).await.is_none());
        assert!(read_codex_rollout(&path).await.is_none());

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn newest_files_sorts_by_mtime_and_respects_the_limit() {
        let dir = std::env::temp_dir().join(format!("adtest-sort-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(dir.join("nested")).await.expect("temp dir");

        for (name, contents) in [("a.jsonl", "1"), ("nested/b.jsonl", "2"), ("c.txt", "3")] {
            tokio::fs::write(dir.join(name), contents).await.expect("write");
            // Distinct mtimes so ordering is deterministic.
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        let files = newest_files(&dir, "jsonl", 10).await.expect("scan");
        assert_eq!(files.len(), 2, "only .jsonl files, found recursively");
        assert!(
            files[0].ends_with("nested/b.jsonl"),
            "newest first, got {:?}",
            files
        );

        let limited = newest_files(&dir, "jsonl", 1).await.expect("scan");
        assert_eq!(limited.len(), 1);

        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn discovery_reports_unknown_providers_as_nothing() {
        // A provider with no readable history contributes neither sessions nor
        // an error — there is nothing to report.
        let report = discover(&[("gemini".to_string(), "gemini".to_string())]).await;
        assert!(report.sessions.is_empty());
        assert!(report.errors.is_empty());
    }
}

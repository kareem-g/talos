use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::agent_events::AgentEvent;
use crate::config::AppState;

// Claude transcript tailer.
//
// Claude Code writes a JSONL transcript per session to
// `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is a
// JSON object; assistant turns appear as objects with `"type":"assistant"`
// and the text in `message.content[].text` blocks.
//
// The backend only receives the *final* assembled assistant message on the
// `Stop` hook, so the UI cannot stream. This tailer polls the transcript
// file and emits `assistant_text` events as soon as a new assistant turn is
// written, giving the UI incremental text without scraping the PTY.
//
// The encoded-cwd directory is not trivially predictable (Claude hashes the
// project path), so we glob `~/.claude/projects/*/<session-id>.jsonl`.

/// Per-session transcript streaming bookkeeping.
///
/// Two paths can emit assistant text for the same turn: the background
/// tailer (incremental) and the `Stop`-hook final flush. Both call
/// [`emit_assistant_text`], which dedupes by the transcript turn's stable
/// `sequence` (the turn uuid), so a turn is broadcast exactly once. The
/// `streamed` set tracks sessions that received at least one turn, used by
/// the `Stop` hook to decide whether to suppress its assembled final
/// `Message`.
#[derive(Debug, Default)]
pub struct TranscriptTails {
    streamed: RwLock<std::collections::HashSet<String>>,
    emitted: RwLock<std::collections::HashMap<String, std::collections::HashSet<String>>>,
}

impl TranscriptTails {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn shared() -> Arc<Self> {
        Arc::new(Self::new())
    }

    pub async fn mark_streamed(&self, session_id: &str) {
        self.streamed.write().await.insert(session_id.to_string());
    }

    pub async fn has_streamed(&self, session_id: &str) -> bool {
        self.streamed.read().await.contains(session_id)
    }

    /// Record a turn sequence as emitted. Returns `true` if this is the
    /// first time we've seen it (i.e. the caller should broadcast).
    pub async fn record_sequence(&self, session_id: &str, sequence: &str) -> bool {
        let mut emitted = self.emitted.write().await;
        let set = emitted.entry(session_id.to_string()).or_default();
        set.insert(sequence.to_string())
    }
}

/// Broadcast an assistant_text event for a turn, unless this exact turn
/// (by transcript uuid `sequence`) has already been emitted for the
/// session. Both the background tailer and the Stop-hook flush call this,
/// so incremental and final delivery never double-emit the same text.
pub async fn emit_assistant_text(state: &AppState, session_id: &str, text: &str, sequence: &str, source: &str) {
    let is_new = if let Some(tails) = &state.transcript_tails {
        tails.record_sequence(session_id, sequence).await
    } else {
        true
    };
    if !is_new {
        return;
    }
    let event = AgentEvent::new(
        session_id,
        "assistant_text",
        serde_json::json!({ "text": text, "sequence": sequence, "source": source }),
    );
    state.broadcast.broadcast_agent_event(event);
    if let Some(tails) = &state.transcript_tails {
        tails.mark_streamed(session_id).await;
    }
}

/// Resolve the transcript path for a session by globbing the Claude
/// projects directory. Returns the first matching `<session-id>.jsonl`.
pub fn find_transcript(session_id: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let base = PathBuf::from(home).join(".claude/projects");
    let prefix = format!("{session_id}.jsonl");
    // Claude nests transcripts in per-project directories; the project
    // directory name is an opaque encoding of the cwd, so we walk one
    // level deep and match on the file name (which is the session id).
    let mut entries = std::fs::read_dir(base).ok()?;
    while let Some(Ok(entry)) = entries.next() {
        let path = entry.path().join(&prefix);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Extract assistant text from a transcript line, returning `(text,
/// sequence)` where `sequence` is the turn's stable uuid (used only for
/// logging). Returns `None` for non-assistant lines or turns with no text.
fn extract_assistant_text(line: &str) -> Option<(String, String)> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let content = value.get("message")?.get("content")?.as_array()?;
    let mut text = String::new();
    for block in content {
        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(block_text) = block.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(block_text);
            }
        }
    }
    if text.trim().is_empty() {
        return None;
    }
    let sequence = value
        .get("uuid")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("offset-{}", line.len()));
    Some((text, sequence))
}

/// Spawn a background task that tails the transcript for `session_id` and
/// emits `assistant_text` events for each new assistant turn. Runs until
/// `cancel` is triggered.
pub fn spawn_transcript_tail(
    state: Arc<AppState>,
    session_id: String,
    cancel: CancellationToken,
) {
    tokio::spawn(async move {
        // Wait for the transcript file to appear (Claude writes it a moment
        // after the session starts).
        // timeout -> Result<PathBuf, Elapsed>
        let path = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                if let Some(path) = find_transcript(&session_id) {
                    return path;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await
        .ok();

        let Some(path) = path else {
            tracing::debug!(
                "[AgentDeck][Transcript] No transcript found for session {session_id}"
            );
            return;
        };

        tracing::debug!(
            "[AgentDeck][Transcript] Tailing transcript for session {session_id} at {}",
            path.display()
        );

        // Number of lines already processed. We re-read the file each poll
        // but only emit for lines beyond this count, so reconnects that
        // re-deliver already-seen frames are ignored.
        let mut last_count = 0u64;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(Duration::from_millis(500)) => {}
            }

            match File::open(&path).await {
                Ok(file) => {
                    let mut reader = BufReader::new(file);
                    let mut line = String::new();
                    let mut index = 0u64;
                    loop {
                        line.clear();
                        match reader.read_line(&mut line).await {
                            Ok(0) => break,
                            Ok(_) => {
                                index += 1;
                                if index <= last_count {
                                    continue;
                                }
                                let trimmed = line.trim();
                                if trimmed.is_empty() {
                                    continue;
                                }
                                if let Some((text, sequence)) = extract_assistant_text(trimmed) {
                                    crate::transcript::emit_assistant_text(
                                        &state,
                                        &session_id,
                                        &text,
                                        &sequence,
                                        "transcript",
                                    )
                                    .await;
                                    tracing::debug!(
                                        "[AgentDeck][Transcript] assistant_text for {session_id} ({} chars)",
                                        text.len()
                                    );
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    last_count = index;
                }
                Err(_) => {
                    // File may have been rotated/truncated; reset and retry.
                    last_count = 0;
                }
            }
        }
    });
}

/// Read the last assistant turn from the transcript, returning its
/// `(text, sequence)` using the turn's real uuid. Returns `None` if the
/// transcript has no assistant text yet.
async fn read_last_transcript_turn(session_id: &str) -> Option<(String, String)> {
    let path = find_transcript(session_id)?;
    let file = File::open(&path).await.ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut last: Option<(String, String)> = None;
    while let Ok(n) = reader.read_line(&mut line).await {
        if n == 0 {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            if let Some((text, sequence)) = extract_assistant_text(trimmed) {
                last = Some((text, sequence));
            }
        }
        line.clear();
    }
    last
}

/// Stop hook integration.
///
/// The `Stop` hook can fire a moment *before* Claude writes its final
/// transcript turn, so we poll for a few seconds to let the write land.
/// When found, the turn is emitted through the shared dedupe helper (using
/// its real uuid, so the background tailer and this flush never
/// double-emit) and we return `Some` so the caller suppresses its own
/// assembled-`Message` broadcast. If no assistant text ever appears, we
/// return `None` and the caller falls back to broadcasting the Stop
/// message as before.
pub async fn tail_final(state: &AppState, session_id: &str) -> Option<(String, String)> {
    // Poll up to ~4s for the final turn to be written.
    for _ in 0..8 {
        if let Some(found) = read_last_transcript_turn(session_id).await {
            crate::transcript::emit_assistant_text(
                state,
                session_id,
                &found.0,
                &found.1,
                "transcript-final",
            )
            .await;
            return Some(found);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::extract_assistant_text;

    #[test]
    fn extracts_text_from_assistant_turn() {
        let line = r#"{"type":"assistant","uuid":"abc","message":{"role":"assistant","content":[{"type":"text","text":"Hello world"}]}}"#;
        let (text, seq) = extract_assistant_text(line).expect("should parse");
        assert_eq!(text, "Hello world");
        assert_eq!(seq, "abc");
    }

    #[test]
    fn ignores_non_assistant_lines() {
        let line = r#"{"type":"user","uuid":"x","message":{"role":"user","content":"hi"}}"#;
        assert!(extract_assistant_text(line).is_none());
    }

    #[test]
    fn joins_multiple_text_blocks() {
        let line = r#"{"type":"assistant","uuid":"z","message":{"content":[{"type":"text","text":"a"},{"type":"tool_use","name":"x"},{"type":"text","text":"b"}]}}"#;
        let (text, _) = extract_assistant_text(line).expect("parse");
        assert_eq!(text, "a\nb");
    }

    #[test]
    fn skips_turns_without_text() {
        let line = r#"{"type":"assistant","uuid":"z","message":{"content":[{"type":"tool_use","name":"x"}]}}"#;
        assert!(extract_assistant_text(line).is_none());
    }
}

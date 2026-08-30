//! Project memory — the harness's cross-session recall.
//!
//! A session can be saved as a memory entry (`.agentdeck/memory.json` in the
//! project), distilled from its canonical log into user prompts + the final
//! reply. Future turns get the most relevant entries injected into their
//! context (see `context_assembler`), so "what did we do last time" is a
//! product feature, not a CLI's private CLAUDE.md.
//!
//! Entries are plain text, keyword-ranked against the prompt — no LLM call at
//! save or inject time, so memory costs nothing to operate.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub source_session: String,
    pub text: String,
    /// "memory" (recall-on-relevance) or "convention" (always injected project
    /// rules). Old entries without the field parse as "memory".
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "memory".to_string()
}

/// A project convention — a standing rule injected into every turn.
pub fn convention(title: &str, text: &str) -> MemoryEntry {
    MemoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        source_session: String::new(),
        text: text.to_string(),
        kind: "convention".to_string(),
    }
}

/// All convention entries (project rules), for always-on injection.
pub fn list_conventions(project: Option<&str>) -> Vec<MemoryEntry> {
    list_memories(project)
        .into_iter()
        .filter(|e| e.kind == "convention")
        .collect()
}

fn memory_path(project: &str) -> PathBuf {
    Path::new(project).join(".agentdeck/memory.json")
}

/// All memory entries for a project, oldest first. Missing/corrupt file → empty.
pub fn list_memories(project: Option<&str>) -> Vec<MemoryEntry> {
    let Some(project) = project else {
        return Vec::new();
    };
    let Ok(content) = std::fs::read_to_string(memory_path(project)) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<MemoryEntry>>(&content).unwrap_or_default()
}

/// Append a memory entry to the project store.
pub fn save_memory(project: Option<&str>, entry: MemoryEntry) -> std::io::Result<()> {
    let Some(project) = project else {
        return Ok(());
    };
    let path = memory_path(project);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut entries = list_memories(Some(project));
    entries.retain(|e| e.id != entry.id);
    entries.push(entry);
    let content = serde_json::to_string_pretty(&entries)?;
    std::fs::write(path, content)
}

/// Remove a memory entry by id. Returns whether one was removed.
pub fn delete_memory(project: Option<&str>, id: &str) -> bool {
    let Some(project) = project else {
        return false;
    };
    let mut entries = list_memories(Some(project));
    let before = entries.len();
    entries.retain(|e| e.id != id);
    if entries.len() == before {
        return false;
    }
    let Ok(content) = serde_json::to_string_pretty(&entries) else {
        return false;
    };
    std::fs::write(memory_path(project), content).is_ok()
}

/// The `max` entries most relevant to the prompt. Scoring is prompt-coverage:
/// the fraction of the prompt's words that appear in the memory's text. That
/// suits long recap documents far better than Jaccard (which collapses on
/// long texts), and `threshold` is on that 0..1 scale.
pub fn find_relevant(
    project: Option<&str>,
    prompt: &str,
    max: usize,
    threshold: f64,
) -> Vec<MemoryEntry> {
    if max == 0 {
        return Vec::new();
    }
    let prompt_words = tokenize(prompt);
    if prompt_words.is_empty() {
        return Vec::new();
    }
    let mut ranked: Vec<(f64, MemoryEntry)> = list_memories(project)
        .into_iter()
        .filter_map(|entry| {
            let memory_words = tokenize(&entry.text);
            let overlap = prompt_words.intersection(&memory_words).count();
            let score = overlap as f64 / prompt_words.len() as f64;
            (score >= threshold).then_some((score, entry))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(max);
    ranked.into_iter().map(|(_, entry)| entry).collect()
}

/// Lowercased alphabetic word tokens (mirrors `context_assembler`).
fn tokenize(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .map(|word| word.to_lowercase())
        .filter(|word| !word.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, text: &str) -> MemoryEntry {
        MemoryEntry {
            id: id.to_string(),
            title: id.to_string(),
            created_at: String::new(),
            source_session: String::new(),
            text: text.to_string(),
            kind: "memory".to_string(),
        }
    }

    #[test]
    fn relevant_memories_rank_by_overlap() {
        let dir = std::env::temp_dir().join(format!("memory-rank-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.to_str().unwrap();
        save_memory(Some(project), entry("m1", "deploy the auth service to production")).unwrap();
        save_memory(Some(project), entry("m2", "fix the payment bug in checkout")).unwrap();

        let ranked = find_relevant(Some(project), "fix the checkout payment bug", 2, 0.5);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].id, "m2");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_delete_roundtrip() {
        let dir = std::env::temp_dir().join(format!("memory-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.to_str().unwrap();

        assert!(save_memory(Some(project), entry("a", "hello world")).is_ok());
        assert_eq!(list_memories(Some(project)).len(), 1);
        assert!(delete_memory(Some(project), "a"));
        assert!(!delete_memory(Some(project), "a"));
        assert!(list_memories(Some(project)).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}


/// Distill a session's conversation (user prompts + final reply) into a memory
/// entry and save it to the project. Returns the entry id, or None when the
/// session has no conversation worth remembering.
pub async fn save_session_summary(
    session_manager: &crate::sessions::manager::SessionManager,
    session_id: &str,
    title: &str,
    kind: &str,
) -> Option<String> {
    let session = session_manager.get_session(session_id).await.ok().flatten()?;
    let mut parts: Vec<String> = Vec::new();
    for message in session_manager.get_messages(session_id).await.unwrap_or_default() {
        if message.role == "user" {
            parts.push(format!("User: {}", message.content.trim()));
        }
    }
    let mut reply = String::new();
    for event in session_manager.get_agent_events(session_id).await.unwrap_or_default() {
        if event.kind == "assistant_text"
            && let Some(text) = event.payload.get("text").and_then(serde_json::Value::as_str)
        {
            reply.push_str(text);
        }
    }
    if !reply.trim().is_empty() {
        parts.push(format!("Assistant: {}", reply.trim()));
    }
    let text: String = parts.join("\n").chars().take(3000).collect();
    if text.trim().is_empty() {
        return None;
    }
    let entry = MemoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        source_session: session_id.to_string(),
        text,
        kind: kind.to_string(),
    };
    let id = entry.id.clone();
    save_memory(session.project.as_deref(), entry).ok()?;
    Some(id)
}

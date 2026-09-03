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

// ---------------------------------------------------------------------------
// Room memory — per-room recall, separate from the workspace store.
//
// A room's runs are distilled into entries scoped to that room only
// (`.agentdeck/rooms/<room_id>.memory.json`), so a channel remembers its own
// tasks and outcomes without leaking into the workspace's memory or other
// rooms. Reads/writes are still gated by the workspace memory toggle at the
// call sites, so turning memory off for a workspace silences its rooms too.
// ---------------------------------------------------------------------------

fn room_memory_path(project: &str, room_id: &str) -> PathBuf {
    // room_id is harness-generated (`room-<ts>-<rand>`) but sanitize anyway —
    // it becomes a filename.
    let safe: String = room_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    Path::new(project).join(format!(".agentdeck/rooms/{safe}.memory.json"))
}

/// All memory entries for one room, oldest first. Missing/corrupt → empty.
pub fn list_room_memories(project: Option<&str>, room_id: &str) -> Vec<MemoryEntry> {
    let Some(project) = project else {
        return Vec::new();
    };
    let Ok(content) = std::fs::read_to_string(room_memory_path(project, room_id)) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<MemoryEntry>>(&content).unwrap_or_default()
}

/// Append a memory entry to a room's store.
pub fn save_room_memory(
    project: Option<&str>,
    room_id: &str,
    entry: MemoryEntry,
) -> std::io::Result<()> {
    let Some(project) = project else {
        return Ok(());
    };
    let path = room_memory_path(project, room_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut entries = list_room_memories(Some(project), room_id);
    entries.retain(|e| e.id != entry.id);
    entries.push(entry);
    // Keep a room's recall bounded: the newest 30 runs are its living memory.
    if entries.len() > 30 {
        let drop_count = entries.len() - 30;
        entries.drain(0..drop_count);
    }
    std::fs::write(path, serde_json::to_string_pretty(&entries)?)
}

/// The `max` room memories most relevant to `prompt`, formatted as one
/// injection block (`<room_memory>` entries) — empty string when the room has
/// nothing relevant or workspace memory is disabled.
pub fn room_memory_block(
    project: Option<&str>,
    room_id: &str,
    prompt: &str,
    max: usize,
) -> String {
    if max == 0 || !workspace_memory_enabled(project) {
        return String::new();
    }
    let prompt_words = tokenize(prompt);
    if prompt_words.is_empty() {
        return String::new();
    }
    let mut ranked: Vec<(f64, MemoryEntry)> = list_room_memories(project, room_id)
        .into_iter()
        .filter_map(|entry| {
            let memory_words = tokenize(&entry.text);
            let overlap = prompt_words.intersection(&memory_words).count();
            let score = overlap as f64 / prompt_words.len() as f64;
            (score >= 0.08).then_some((score, entry))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(max);
    if ranked.is_empty() {
        return String::new();
    }
    let sections: Vec<String> = ranked
        .into_iter()
        .map(|(_, entry)| format!("<room_memory title=\"{}\">\n{}\n</room_memory>", entry.title, entry.text))
        .collect();
    format!("<room_memories>\n{}\n</room_memories>", sections.join("\n\n"))
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


/// Per-workspace memory config: whether memory is enabled for this project.
/// Stored in `<project>/.agentdeck/memory.toml` as `[memory] enabled = true`.
/// Defaults to `true` when the file is missing.
pub fn workspace_memory_enabled(project: Option<&str>) -> bool {
    let Some(project) = project else {
        return true; // Inbox sessions: no workspace config → enabled
    };
    let path = Path::new(project).join(".agentdeck/memory.toml");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return true;
    };
    #[derive(Deserialize)]
    struct MemoryConfig {
        #[serde(default)]
        enabled: Option<bool>,
    }
    #[derive(Deserialize)]
    struct ConfigFile {
        #[serde(default)]
        memory: Option<MemoryConfig>,
    }
    toml::from_str::<ConfigFile>(&content)
        .ok()
        .and_then(|c| c.memory)
        .and_then(|m| m.enabled)
        .unwrap_or(true)
}

/// Set the workspace-level memory enabled flag.
pub fn set_workspace_memory_enabled(project: Option<&str>, enabled: bool) -> std::io::Result<()> {
    let Some(project) = project else {
        return Ok(());
    };
    let dir = Path::new(project).join(".agentdeck");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("memory.toml");
    std::fs::write(&path, format!("[memory]
enabled = {}
", if enabled { "true" } else { "false" }))
}

#[cfg(test)]
mod room_tests {
    use super::*;

    fn room_entry(id: &str, text: &str) -> MemoryEntry {
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
    fn room_memories_are_scoped_per_room() {
        let dir = std::env::temp_dir().join(format!("room-mem-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.to_str().unwrap();

        save_room_memory(Some(project), "room-a", room_entry("m1", "deploy auth service")).unwrap();
        save_room_memory(Some(project), "room-b", room_entry("m2", "write rust tests")).unwrap();

        assert_eq!(list_room_memories(Some(project), "room-a").len(), 1);
        assert_eq!(list_room_memories(Some(project), "room-a")[0].id, "m1");
        assert_eq!(list_room_memories(Some(project), "room-b")[0].id, "m2");
        // Workspace store untouched by room saves.
        assert!(list_memories(Some(project)).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn room_memory_block_recalls_relevant_runs_only() {
        let dir = std::env::temp_dir().join(format!("room-mem-block-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.to_str().unwrap();

        save_room_memory(
            Some(project),
            "room-a",
            room_entry("r1", "migrated the auth module to oauth sessions"),
        )
        .unwrap();
        save_room_memory(
            Some(project),
            "room-a",
            room_entry("r2", "flaky payment checkout test isolated"),
        )
        .unwrap();

        let block = room_memory_block(Some(project), "room-a", "migrate the auth module again", 2);
        assert!(block.contains("<room_memories>"));
        assert!(block.contains("r1"));

        let empty = room_memory_block(Some(project), "room-a", "unrelated quantum recipe", 2);
        assert!(empty.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn room_memory_block_respects_workspace_toggle() {
        let dir = std::env::temp_dir().join(format!("room-mem-toggle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.to_str().unwrap();

        save_room_memory(Some(project), "room-a", room_entry("m1", "auth deploy run")).unwrap();
        set_workspace_memory_enabled(Some(project), false).unwrap();
        assert!(room_memory_block(Some(project), "room-a", "auth deploy", 2).is_empty());
        set_workspace_memory_enabled(Some(project), true).unwrap();
        assert!(!room_memory_block(Some(project), "room-a", "auth deploy", 2).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

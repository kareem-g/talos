//! Context assembly: enrich a raw user prompt with environment, skills, and
//! similar-trajectory context before it reaches the agent.
//!
//! [`assemble`] is the single entry point the websocket handler calls before
//! `start_turn`. It builds an `injected_context` string from up to three
//! sources, each independently gated by `ContextAssemblyConfig` and each
//! failing gracefully to empty:
//!
//! 1. **Environment** — git status/branch/recent changes, OS, working dir.
//! 2. **Skills** — project `.agentdeck/skills/*/SKILL.md` bodies.
//! 3. **Similar trajectories** — past `idle`/`needs_resume` sessions ranked by
//!    Jaccard word overlap with the prompt, replayed as few-shot examples.
//!
//! If every source yields nothing, `injected_context` is `None` and the turn
//! proceeds exactly as before.

use crate::config::AppState;
use crate::sessions::Session;
use crate::trajectory;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Structured summary of what the harness injected into a turn — the
/// machine-readable counterpart of `injected_context`, so the UI can render a
/// "context" chip instead of hiding the enrichment. Serialized into the
/// `context_assembled` agent event.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ContextBreakdown {
    pub environment: bool,
    pub skills: Vec<String>,
    pub trajectories: Vec<TrajectoryRef>,
    pub memories: Vec<MemoryRef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrajectoryRef {
    pub session_id: String,
    pub similarity: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryRef {
    pub id: String,
    pub title: String,
}

/// Assemble the enriched context for a turn. Returns the [`TurnContext`] plus
/// a [`ContextBreakdown`] naming exactly what was injected (which skills,
/// which similar runs), for broadcasting the assembly to the UI. Every source
/// is individually disabled by config or skipped on error; the caller-facing
/// contract is "never fail, never block the turn".
///
/// `instructions` overrides the standing instruction set (used by subagents
/// and eval runs); when `None`, the standing set is used — the first-turn
/// variant when the session has no prior conversation, otherwise the plain
/// standing set.
pub async fn assemble(
    state: &AppState,
    session: &Session,
    prompt: &str,
    instructions: Option<&str>,
) -> crate::Result<(
    crate::agents::harness::TurnContext,
    ContextBreakdown,
)> {
    let cfg = state.config.read().await;
    let context_assembly = cfg.settings().context_assembly.clone();
    drop(cfg);

    let mut sections: Vec<String> = Vec::new();
    let mut breakdown = ContextBreakdown::default();

    // Standing instructions — always first, never gated, never shown in the
    // context chip (it is the agent's instruction set, not per-turn
    // enrichment). First turns get the first-turn variant; custom instruction
    // sets (subagent role, eval determinism) replace the standing set.
    // A custom set also means "identity already handled" (room workers carry
    // their own) — only standing-set turns get the room-lead check below.
    let custom = instructions.is_some();
    let mut instructions = match instructions {
        Some(custom) => custom.to_string(),
        None => {
            let has_history = !state
                .session_manager
                .get_messages(&session.id)
                .await
                .unwrap_or_default()
                .is_empty();
            if has_history {
                crate::prompts::work_prompt()
            } else {
                crate::prompts::first_turn_prompt()
            }
        }
    };
    // Generic transports (custom OpenAI-compatible providers, custom CLIs, pi)
    // get the custom-transport guidance appended — they have a different tool
    // surface than the native backends.
    {
        let cfg = state.config.read().await;
        let settings = cfg.settings();
        let is_generic = settings.agents.api_providers.iter().any(|p| p.id == session.agent)
            || settings.agents.custom.iter().any(|c| c.id == session.agent)
            || session.agent == "pi";
        drop(cfg);
        if is_generic && !instructions.contains("## Custom transport") {
            instructions.push('\n');
            instructions.push_str(crate::prompts::CUSTOM_TRANSPORT.trim());
        }
    }
    // Room channel sessions talk to the user as the room's lead — but the
    // channel agent is spawned bare, so without this it answers as a generic
    // agent that has never heard of its own roster. Workers already carry
    // their identity in the custom set and skip this.
    if !custom
        && let Some(info) = crate::api::rooms::find_room_by_channel(state, &session.id).await
    {
        instructions.push('\n');
        instructions.push_str(&crate::prompts::room_lead_section(
            &info.name,
            &info.roster,
            info.chief.as_deref(),
        ));
    }
    sections.push(instructions);

    // The session's harness configuration (model, effort, max tokens, context
    // window, permission mode) — so ANY agent, CLI or API, can answer
    // questions about its own settings ("what effort are you running at?")
    // from its prompt instead of claiming it cannot know.
    {
        let pending = state
            .session_manager
            .pending_config(&session.id)
            .await
            .unwrap_or_default();
        let mut lines: Vec<String> = Vec::new();
        for (key, value) in &pending {
            if key == "subagent" {
                continue;
            }
            lines.push(format!("- {key}: {value}"));
        }
        if !lines.is_empty() {
            sections.push(format!(
                "<harness_configuration>\n{}\n</harness_configuration>\n\
                 The values above are YOUR OWN session's actual harness settings \
                 (model, reasoning effort, token limits, permission mode). Quote \
                 them when asked about your configuration.",
                lines.join("\n")
            ));
        }
    }

    // Project conventions (kind = "convention") are standing rules injected
    // into every turn, not keyword-ranked like memories. Both conventions and
    // memory recall are gated by the workspace's memory toggle.
    let workspace_memory = crate::memory::workspace_memory_enabled(session.project.as_deref());
    let conventions = if workspace_memory {
        crate::memory::list_conventions(session.project.as_deref())
    } else {
        Vec::new()
    };
    if !conventions.is_empty() {
        let mut conv_sections: Vec<String> = Vec::new();
        for convention in &conventions {
            conv_sections.push(format!(
                "<convention title=\"{}\">\n{}\n</convention>",
                convention.title, convention.text
            ));
        }
        sections.push(format!(
            "<project_conventions>\n{}\n</project_conventions>",
            conv_sections.join("\n\n")
        ));
    }

    if context_assembly.environment_enabled {
        let env_ctx = environment_context(session.project.as_deref()).await;
        if !env_ctx.trim().is_empty() {
            sections.push(env_ctx);
            breakdown.environment = true;
        }
    }

    if context_assembly.skills_enabled {
        let (skills_ctx, names) = load_skills(session.project.as_deref()).await;
        if !skills_ctx.trim().is_empty() {
            sections.push(skills_ctx);
            breakdown.skills = names;
        }
    }

    let trajectory_ctx = if context_assembly.trajectory_injection_enabled {
        find_similar_trajectories(
            state,
            session,
            prompt,
            context_assembly.max_trajectories,
            context_assembly.similarity_threshold,
        )
        .await
        .unwrap_or(None)
    } else {
        None
    };
    if let Some((trajectory_ctx, refs)) = trajectory_ctx
        && !trajectory_ctx.trim().is_empty()
    {
        sections.push(trajectory_ctx);
        breakdown.trajectories = refs;
    }

    // Project memory: saved sessions relevant to this prompt, injected as
    // first-person recap. Same Jaccard ranking as trajectories.
    if context_assembly.memory_enabled && workspace_memory {
        let memories = crate::memory::find_relevant(
            session.project.as_deref(),
            prompt,
            context_assembly.max_memories,
            context_assembly.similarity_threshold,
        );
        if !memories.is_empty() {
            let mut memory_sections: Vec<String> = Vec::new();
            for memory in &memories {
                memory_sections.push(format!(
                    "<memory id=\"{}\" title=\"{}\">\n{}\n</memory>",
                    memory.id, memory.title, memory.text
                ));
                breakdown.memories.push(MemoryRef {
                    id: memory.id.clone(),
                    title: memory.title.clone(),
                });
            }
            sections.push(format!("<memories>\n{}\n</memories>", memory_sections.join("\n\n")));
        }
    }

    let injected_context = if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    };

    Ok((
        crate::agents::harness::TurnContext {
            session: session.clone(),
            prompt: prompt.to_string(),
            injected_context,
        },
        breakdown,
    ))
}

/// Markdown section describing the working environment: OS, working
/// directory, git branch, git status, and recent commits. Returns an empty
/// string when not in a git repository or when git is unavailable.
pub async fn environment_context(project: Option<&str>) -> String {
    let cwd = project.unwrap_or(".");
    let mut lines = vec!["<environment>".to_string()];
    lines.push(format!("OS: {}", std::env::consts::OS));
    if let Ok(dir) = std::env::current_dir() {
        lines.push(format!("Daemon cwd: {}", dir.display()));
    }
    lines.push(format!("Project: {cwd}"));

    let branch = run_git(&["-C", cwd, "branch", "--show-current"]).await;
    let status = run_git(&["-C", cwd, "status", "--short", "--branch"]).await;
    let log = run_git(&["-C", cwd, "log", "--oneline", "-5"]).await;

    match (&branch, &status, &log) {
        (None, None, None) => String::new(), // not a git repo — no env context
        _ => {
            if let Some(branch) = branch
                && !branch.trim().is_empty()
            {
                lines.push(format!("Branch: {branch}"));
            }
            if let Some(status) = status {
                lines.push(format!("Git status:\n```\n{status}\n```"));
            }
            if let Some(log) = log {
                lines.push(format!("Recent commits:\n```\n{log}\n```"));
            }
            lines.push("</environment>".to_string());
            lines.join("\n")
        }
    }
}

/// Markdown section listing the project's enabled skills (`.agentdeck/skills/`),
/// plus the injected skill names for the [`ContextBreakdown`]. A `.disabled`
/// marker file in a skill directory excludes it. Returns empty text (and no
/// names) when the directory is missing or empty.
pub async fn load_skills(project: Option<&str>) -> (String, Vec<String>) {
    let Some(base) = project else {
        return (String::new(), Vec::new());
    };
    let skills_dir = Path::new(base).join(".agentdeck/skills");
    let mut entries = match tokio::fs::read_dir(&skills_dir).await {
        Ok(entries) => entries,
        Err(_) => return (String::new(), Vec::new()),
    };

    let mut sections: Vec<String> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // A `.disabled` marker excludes the skill from context.
        if path.join(".disabled").exists() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        let Ok(content) = tokio::fs::read_to_string(&skill_md).await else {
            continue;
        };
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        names.push(name.to_string());
        sections.push(format!("<skill name=\"{name}\">\n{content}\n</skill>"));
    }

    if sections.is_empty() {
        (String::new(), Vec::new())
    } else {
        let mut out = "<skills>".to_string();
        out.push_str(&sections.join("\n\n"));
        out.push_str("\n</skills>");
        (out, names)
    }
}

/// Find past completed sessions whose trajectories are most similar to
/// `prompt` (Jaccard word overlap), read their trajectory files, and format
/// the key turns as few-shot examples. Returns the formatted section plus the
/// referenced runs (for the [`ContextBreakdown`]); `None` when nothing clears
/// `threshold` or the feature can't find usable data.
pub async fn find_similar_trajectories(
    state: &AppState,
    session: &Session,
    prompt: &str,
    max: usize,
    threshold: f64,
) -> crate::Result<Option<(String, Vec<TrajectoryRef>)>> {
    if max == 0 {
        return Ok(None);
    }

    // Rank completed sessions by how well their user messages overlap the
    // current prompt.
    let prompt_words = tokenize(prompt);
    let completed = state.session_manager.list_completed_sessions().await?;
    let mut ranked: Vec<(f64, String)> = Vec::new();
    for past in completed.iter().filter(|s| s.id != session.id) {
        let Ok(messages) = state.session_manager.get_messages(&past.id).await else {
            continue;
        };
        let user_text: String = messages
            .iter()
            .filter(|m| m.role == "user")
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let score = jaccard(&prompt_words, &tokenize(&user_text));
        if score >= threshold {
            ranked.push((score, past.id.clone()));
        }
    }
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(max);
    if ranked.is_empty() {
        return Ok(None);
    }

    let mut examples: Vec<String> = Vec::new();
    let mut refs: Vec<TrajectoryRef> = Vec::new();
    for (score, session_id) in ranked {
        let Some(trajectory_path) = find_trajectory_for_session(&session_id).await else {
            continue;
        };
        let Ok(events) = trajectory::read_trajectory(&trajectory_path).await else {
            continue;
        };
        let Some(transcript) = format_trajectory(&events) else {
            continue;
        };
        examples.push(format!(
            "<example_trajectory session_id=\"{session_id}\" similarity=\"{score:.2}\">\n{transcript}\n</example_trajectory>"
        ));
        refs.push(TrajectoryRef {
            session_id,
            similarity: score,
        });
    }

    if examples.is_empty() {
        Ok(None)
    } else {
        Ok(Some((
            format!(
                "<similar_trajectories>\n{}\n</similar_trajectories>",
                examples.join("\n\n")
            ),
            refs,
        )))
    }
}

/// The most recently recorded trajectory file for a session
/// (`<session-id>-*.jsonl` in the trajectories dir).
async fn find_trajectory_for_session(session_id: &str) -> Option<PathBuf> {
    let dir = trajectory::default_dir().ok()?;
    let prefix = format!("{}-", session_id.replace(['/', '\\'], "_"));
    let mut entries = tokio::fs::read_dir(&dir).await.ok()?;
    let mut best: Option<PathBuf> = None;
    let mut best_name: Option<String> = None;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) && name.ends_with(".jsonl") {
            // Lexicographic works because the suffix is a unix timestamp.
            if best_name.as_ref().map(|b| name > *b).unwrap_or(true) {
                best_name = Some(name);
                best = Some(entry.path());
            }
        }
    }
    best
}

/// Render the conversational spine of a trajectory as a compact few-shot
/// example: user messages, assistant text, and tool calls.
fn format_trajectory(events: &[crate::websocket::WsMessage]) -> Option<String> {
    let mut out: Vec<String> = Vec::new();
    for message in events {
        match message {
            crate::websocket::WsMessage::Message { message } => {
                if message.role == "user" {
                    out.push(format!("User: {}", message.content.trim()));
                }
            }
            crate::websocket::WsMessage::AgentEvent { event } => match event.kind.as_str() {
                "assistant_text" => {
                    let text = event
                        .payload
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if !text.is_empty() {
                        out.push(format!("Assistant: {text}"));
                    }
                }
                "tool_started" => {
                    let name = event
                        .payload
                        .get("tool_name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool");
                    let input = event
                        .payload
                        .get("input")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if !input.is_empty() {
                        out.push(format!("Tool call: {name}({input})"));
                    } else {
                        out.push(format!("Tool call: {name}"));
                    }
                }
                "tool_finished" => {
                    let output = event
                        .payload
                        .get("output")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let preview: String = output.chars().take(400).collect();
                    if !preview.is_empty() {
                        out.push(format!("Tool result: {preview}"));
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out.join("\n"))
    }
}

/// Run a git subcommand in the background. Returns `None` on any failure
/// (not a git repo, git missing, etc.) so callers degrade gracefully.
async fn run_git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Lowercased alphabetic word tokens.
fn tokenize(text: &str) -> HashSet<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .map(|word| word.to_lowercase())
        .filter(|word| !word.is_empty())
        .collect()
}

/// Jaccard similarity between two word sets: `|A ∩ B| / |A ∪ B|`.
fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let intersection = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_splits_on_punctuation_and_case() {
        let words = tokenize("Fix the auth-bug, please!");
        assert!(words.contains("fix"));
        assert!(words.contains("auth"));
        assert!(words.contains("bug"));
        assert!(words.contains("please"));
        assert!(words.contains("the"));
        assert_eq!(words.len(), 5);
    }

    #[test]
    fn jaccard_measures_overlap() {
        let a = tokenize("fix the auth bug");
        let b = tokenize("fix the auth bug");
        assert_eq!(jaccard(&a, &b), 1.0);

        let c = tokenize("deploy to production");
        assert_eq!(jaccard(&a, &c), 0.0);

        let partial = tokenize("fix the payment bug");
        // fix, the, bug overlap → 3/5.
        let score = jaccard(&a, &partial);
        assert!((score - 0.6).abs() < 1e-9);
    }

    #[test]
    fn empty_sets_have_zero_similarity() {
        let a = HashSet::new();
        let b = HashSet::new();
        assert_eq!(jaccard(&a, &b), 0.0);
    }

    #[tokio::test]
    async fn environment_context_empty_outside_git() {
        // A nonexistent project dir makes every git command fail → empty.
        let ctx = environment_context(Some("/definitely/not/a/repo/xyz")).await;
        assert!(ctx.is_empty());
    }
}

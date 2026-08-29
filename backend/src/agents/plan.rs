//! Shared plan/todo extraction helpers.
//!
//! These functions emit `plan` AgentEvents from three sources:
//! 1. Structured `TodoWrite` tool input JSON (Claude CLI, ACP, Anthropic API)
//! 2. Markdown checklist lines in assistant text (any provider)
//!
//! The dashboard only renders todos from `plan` events, so every transport calls
//! these helpers to produce a unified todo signal.

use serde_json::{json, Value};

/// Parse a `TodoWrite` tool input JSON string.
///
/// Claude Code's `TodoWrite` tool:
/// ```json
/// { "todos": [{ "content": "Step 1", "status": "in_progress" }, ...] }
/// ```
///
/// Returns `(steps, entries)` where `steps` is the content strings and `entries`
/// is the full `{content, status}` objects.
pub fn parse_todo_input(input: &str) -> Option<(Vec<String>, Vec<Value>)> {
    let Ok(value) = serde_json::from_str::<Value>(input) else { return None };
    let todos = value.get("todos").and_then(Value::as_array)?;
    if todos.is_empty() { return None }

    let mut steps = Vec::new();
    let mut entries = Vec::new();

    for todo in todos {
        let content = todo.get("content").and_then(Value::as_str)?;
        let status = todo.get("status").and_then(Value::as_str).unwrap_or("pending");
        steps.push(content.to_string());
        entries.push(json!({
            "content": content,
            "status": status,
        }));
    }

    Some((steps, entries))
}

/// Build a `plan` AgentEvent payload from TodoWrite tool input.
pub fn todo_payload(input: &str, title: &str) -> Option<Value> {
    let (steps, entries) = parse_todo_input(input)?;
    Some(json!({
        "title": title,
        "steps": steps,
        "entries": entries,
        "source": "todo_write",
    }))
}

/// Scan text for markdown checklist lines and return plan payload.
///
/// Recognises:
/// - `- [ ] item`  → pending
/// - `- [x] item`  → completed
/// - `- [~] item`  → in_progress
/// - `- [X] item`  → completed
/// - `* [ ] item`  → pending (alternative bullet)
///
/// Also matches numbered lists: `1. [ ] item` etc.
pub fn checklists_from_text(text: &str) -> Option<Value> {
    let mut steps = Vec::new();
    let mut entries = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        let Some(checkbox_start) = trimmed.find('[') else { continue };
        // The checkbox must be at the start of the line (optionally after a
        // bullet like "- " or "1. ") — not mid-sentence.
        let prefix = &trimmed[..checkbox_start];
        let last = prefix.trim().chars().last();
        let bullet_ok = prefix.trim().is_empty() || matches!(last, Some('.') | Some('-') | Some('*'));
        if !bullet_ok {
            continue;
        }
        let rest = &trimmed[checkbox_start + 1..];
        let Some(close) = rest.find(']') else { continue };
        let marker = &rest[..close];
        let content = rest[close + 1..].trim();
        if content.is_empty() {
            continue;
        }
        let status = match marker {
            "x" | "X" => "completed",
            "~" | "o" => "in_progress",
            " " => "pending",
            _ => "pending",
        };
        steps.push(content.to_string());
        entries.push(json!({
            "content": content,
            "status": status,
        }));
    }

    if steps.is_empty() { return None }
    Some(json!({
        "title": "Plan",
        "steps": steps,
        "entries": entries,
        "text": text,
        "source": "checklist",
    }))
}

/// Parse a full plan proposal (ExitPlanMode / plan-mode text) into a plan payload.
///
/// Plans are usually markdown prose with a list of steps. We accept three shapes
/// and derive a live status where the markdown carries one:
/// - Checkboxes: `- [ ]`, `- [x]`, `- [~]` (status pending/completed/in_progress)
/// - Numbered lists: `1. Step`, `1) Step` (pending)
/// - Bullet lists: `- Step`, `* Step` (pending)
///
/// Step headers like `## Step 1 — Title` are also captured as pending steps so
/// an agent's structured plan always reaches the HUD's Progress section.
pub fn plan_from_markdown(text: &str, title: &str) -> Option<Value> {
    // A full plan proposal usually starts with a heading; give the payload a
    // real title when we can find one, else the caller's fallback.
    let mut steps = Vec::new();
    let mut entries = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Checklist item — capture status.
        if let Some(checkbox_start) = trimmed.find('[') {
            let prefix = &trimmed[..checkbox_start];
            let last = prefix.trim().chars().last();
            let bullet_ok = prefix.trim().is_empty() || matches!(last, Some('.') | Some('-') | Some('*'));
            if bullet_ok {
                let rest = &trimmed[checkbox_start + 1..];
                if let Some(close) = rest.find(']') {
                    let marker = &rest[..close];
                    let content = rest[close + 1..].trim();
                    if !content.is_empty() {
                        let status = match marker {
                            "x" | "X" => "completed",
                            "~" | "o" => "in_progress",
                            _ => "pending",
                        };
                        steps.push(content.to_string());
                        entries.push(json!({ "content": content, "status": status }));
                        continue;
                    }
                }
            }
        }
        // Numbered or bullet list item.
        let item = parse_list_item(trimmed);
        if let Some(content) = item {
            steps.push(content.clone());
            entries.push(json!({ "content": content, "status": "pending" }));
            continue;
        }
        // `## Step 1 — Title` style heading. Only headings that read as steps
        // are captured — a bare `## Plan` title is not a todo.
        let heading = trimmed
            .strip_prefix("##")
            .map(|rest| rest.trim())
            .filter(|rest| !rest.is_empty() && !rest.starts_with('#'))
            .filter(|rest| {
                let lower = rest.to_lowercase();
                lower.starts_with("step")
                    || lower.starts_with("phase")
                    || lower.starts_with("task")
                    || lower.starts_with("todo")
                    || (rest.contains(['.', '—', ':', '-']) && rest.chars().any(|c| c.is_ascii_digit()))
            });
        if let Some(content) = heading {
            steps.push(content.to_string());
            entries.push(json!({ "content": content, "status": "pending" }));
        }
    }

    if steps.is_empty() { return None }
    Some(json!({
        "title": title,
        "steps": steps,
        "entries": entries,
        "text": text,
        "source": "plan_proposal",
    }))
}

/// Extract the content after a numbered (`1.`, `1)`) or bullet (`-`, `*`)
/// list marker, if the line is one.
fn parse_list_item(trimmed: &str) -> Option<String> {
    // Bullet list: "- content" / "* content"
    if let Some(content) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
        let content = content.trim();
        if !content.is_empty() {
            return Some(content.to_string());
        }
    }
    // Numbered list: "1. content" / "1) content"
    let chars = trimmed.chars().collect::<Vec<_>>();
    let mut idx = 0;
    while idx < chars.len() && chars[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx > 0 && idx < chars.len() {
        let sep = chars[idx];
        if sep == '.' || sep == ')' {
            let content = trimmed[idx + 1..].trim();
            if !content.is_empty() {
                return Some(content.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_todo_write_input() {
        let input = r#"{"todos":[{"content":"Read the codebase","status":"in_progress"},{"content":"Write the fix","status":"pending"}]}"#;
        let (steps, entries) = parse_todo_input(input).unwrap();
        assert_eq!(steps, vec!["Read the codebase", "Write the fix"]);
        assert_eq!(entries[0]["status"], "in_progress");
        assert_eq!(entries[1]["status"], "pending");
    }

    #[test]
    fn ignores_empty_todo_input() {
        assert!(parse_todo_input(r#"{"todos":[]}"#).is_none());
        assert!(parse_todo_input(r#"{}"#).is_none());
        assert!(parse_todo_input("not json").is_none());
    }

    #[test]
    fn todo_payload_shape() {
        let payload = todo_payload(r#"{"todos":[{"content":"Step one","status":"completed"}]}"#, "Test Plan").unwrap();
        assert_eq!(payload["title"], "Test Plan");
        assert_eq!(payload["steps"][0], "Step one");
        assert_eq!(payload["entries"][0]["status"], "completed");
    }

    #[test]
    fn detects_checklist_lines() {
        let text = "\
- [ ] Step one
- [x] Step two
- [~] Step three
* [ ] Step four
1. [ ] Step five";
        let payload = checklists_from_text(text).unwrap();
        assert_eq!(payload["steps"].as_array().unwrap().len(), 5);
        assert_eq!(payload["steps"][0], "Step one");
        assert_eq!(payload["entries"][0]["status"], "pending");
        assert_eq!(payload["entries"][1]["status"], "completed");
        assert_eq!(payload["entries"][2]["status"], "in_progress");
        assert_eq!(payload["source"], "checklist");
    }

    #[test]
    fn no_checklist_lines_returns_none() {
        let text = "Just some plain text\nNo checkboxes here";
        assert!(checklists_from_text(text).is_none());
    }

    #[test]
    fn empty_text_returns_none() {
        assert!(checklists_from_text("").is_none());
    }

    #[test]
    fn plan_from_numbered_list() {
        let text = "\
## Plan

1. Read the codebase
2. Write the fix
3. Run tests";
        let payload = plan_from_markdown(text, "Proposed plan").unwrap();
        assert_eq!(payload["title"], "Proposed plan");
        assert_eq!(payload["steps"].as_array().unwrap().len(), 3);
        assert_eq!(payload["steps"][0], "Read the codebase");
        assert_eq!(payload["entries"][0]["status"], "pending");
        assert_eq!(payload["source"], "plan_proposal");
    }

    #[test]
    fn plan_from_bullets_and_checkboxes() {
        let text = "\
Plan:
- [x] Research
- [~] Implement
- Verify";
        let payload = plan_from_markdown(text, "Plan").unwrap();
        assert_eq!(payload["steps"].as_array().unwrap().len(), 3);
        assert_eq!(payload["entries"][0]["status"], "completed");
        assert_eq!(payload["entries"][1]["status"], "in_progress");
        assert_eq!(payload["entries"][2]["status"], "pending");
    }

    #[test]
    fn plan_from_step_headings() {
        let text = "## Step 1 — Investigate\nSome detail\n## Step 2 — Implement";
        let payload = plan_from_markdown(text, "Plan").unwrap();
        let steps = payload["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0], "Step 1 — Investigate");
        assert_eq!(steps[1], "Step 2 — Implement");
    }

    #[test]
    fn plan_from_plain_prose_returns_none() {
        assert!(plan_from_markdown("Just some prose without any lists.", "Plan").is_none());
    }
}
use crate::agent_events::AgentEvent;
use crate::pty::parser::{clean_terminal_output, strip_terminal_sequences, OutputParser, ParsedOutput};

#[derive(Debug, Default)]
pub struct AgentStreamNormalizer {
    agent: String,
    previous_text: String,
    submitted: Option<String>,
    state: Option<String>,
    turn: u64,
    tool_index: u64,
    text_started: bool,
    turn_active: bool,
    spinner_seen: bool,
}

impl AgentStreamNormalizer {
    pub fn new(agent: &str) -> Self {
        Self { agent: agent.to_string(), ..Self::default() }
    }

    pub fn begin_turn(&mut self, prompt: &str) {
        self.previous_text.clear();
        self.submitted = Some(normalize(prompt));
        self.state = Some("running".to_string());
        self.turn = self.turn.saturating_add(1);
        self.text_started = false;
        self.turn_active = true;
        self.spinner_seen = false;
    }

    pub fn finish_turn(&mut self) {
        self.previous_text.clear();
        self.submitted = None;
        self.text_started = false;
        self.turn_active = false;
    }

    pub fn parse(&mut self, session_id: &str, chunk: &str) -> Vec<AgentEvent> {
        if !self.turn_active {
            return Vec::new();
        }
        // Detect spinner/working indicators in the raw chunk. Codex TUI
        // redraws the entire screen each frame; the spinner text appears
        // before the actual response.
        if !self.spinner_seen {
            let lower = chunk.to_lowercase();
            if lower.contains("working") || lower.contains("worki") {
                self.spinner_seen = true;
            }
        }
        let clean = clean_agent_text(chunk, &self.agent);
        if clean.is_empty() || clean.lines().all(|line| is_terminal_chrome(line, &self.agent)) {
            return Vec::new();
        }

        let mut events = Vec::new();
        for parsed in OutputParser::parse_chunk(&clean) {
            match parsed {
                ParsedOutput::Text(text) => {
                    if let Some(event) = self.text_event(session_id, &text) {
                        events.push(event);
                    }
                }
                ParsedOutput::ToolCall { name, params } => {
                    let activity = params.get("activity").and_then(|value| value.as_str());
                    let kind = if activity == Some("thinking") { "thinking_started" } else { "tool_activity" };
                    let tool_id = format!("{}-{}", self.agent, self.tool_index);
                    self.tool_index = self.tool_index.saturating_add(1);
                    events.push(AgentEvent::new(
                        session_id,
                        kind,
                        serde_json::json!({ "tool_name": name, "input": params, "tool_id": tool_id, "turn": self.turn, "source": self.agent }),
                    ));
                }
                ParsedOutput::Plan { title, steps } => events.push(AgentEvent::new(
                    session_id,
                    "plan",
                    serde_json::json!({ "title": title, "steps": steps, "turn": self.turn, "source": self.agent }),
                )),
                ParsedOutput::Diff { file, .. } => events.push(AgentEvent::new(
                    session_id,
                    "file_edited",
                    serde_json::json!({ "path": file, "success": true, "turn": self.turn, "source": self.agent }),
                )),
                ParsedOutput::ApprovalRequest { prompt } => events.push(AgentEvent::new(
                    session_id,
                    "permission_required",
                    serde_json::json!({ "id": uuid::Uuid::new_v4().to_string(), "prompt": prompt, "options": ["allow", "always", "deny"], "source": self.agent }),
                )),
                ParsedOutput::Error(message) => events.push(AgentEvent::new(
                    session_id,
                    "agent_error",
                    serde_json::json!({ "message": message, "source": self.agent }),
                )),
            }
        }
        events.extend(self.state_event(session_id, detect_state(chunk)));
        events
    }

    fn text_event(&mut self, session_id: &str, text: &str) -> Option<AgentEvent> {
        let normalized = normalize(text);
        if normalized.is_empty() || is_terminal_chrome(text, &self.agent) {
            return None;
        }
        let prev_norm = normalize(&self.previous_text);

        // Codex's TUI redraws a "Working…" spinner before every answer; until
        // it appears, whatever text we see is prompt suggestions / chrome, not
        // the response. Other agents (opencode `run`, …) print the answer
        // directly with no spinner, so this gate must not apply to them or the
        // whole response is suppressed and streaming never shows.
        if self.agent == "codex" && !self.spinner_seen && self.submitted.is_some() {
            return None;
        }

        // Prompt echo: the submitted prompt echoed back by the agent. Clears once.
        if self.submitted.as_deref() == Some(normalized.as_str()) {
            self.submitted = None;
            return None;
        }
        // Exact re-echo of prior output → drop.
        if prev_norm == normalized {
            return None;
        }
        // Agent re-showed / shrank its prior output (spinner/status redraw) → drop.
        if prev_norm.starts_with(&normalized) {
            return None;
        }
        // Current content already appears at the tail of prior output → drop.
        if prev_norm.ends_with(&normalized) {
            return None;
        }
        // Progress redraw: the agent re-renders a spinner/status line that only
        // extends the previous line with trailing runic chars (Work→Worki→Working,
        // "…" spinners). Not assistant prose.
        if let Some(last_line) = self.previous_text.lines().last() {
            if is_progress_redraw_line(text, last_line) {
                return None;
            }
        }
        // TUI cursor artifact: codex TUI uses absolute cursor positioning to
        // animate spinners. This produces short fragments like "orking", "rking"
        // where the beginning of a word has been overwritten, or "Wor1" where
        // a timing counter is merged with partial text.
        if text.trim().len() < 8 && !text.contains(' ') {
            let t = text.trim().to_lowercase();
            // Single word with embedded digit → timing counter merged with text
            if t.chars().any(|c| c.is_ascii_digit()) {
                return None;
            }
            // Starts with lowercase → partial word from cursor overwrite
            if t.chars().next().is_some_and(|c| c.is_ascii_lowercase()) {
                return None;
            }
            // Suffix of previous text → cursor overwrite artifact
            if !self.previous_text.is_empty() && self.previous_text.to_lowercase().ends_with(&t) {
                return None;
            }
        }

        // Genuine growth: the new text extends prior output. Slice the incremental
        // suffix — but only when the raw byte prefix actually matches. A
        // whitespace-collapsed match can hide a byte-length mismatch (e.g.
        // previous "Here  is" vs current "Here is the answer") that would slice
        // mid-token and garble the delta. When unsafe, fall back to emitting the
        // full authoritative render with redraw:true (frontend replaces).
        if normalized.starts_with(&prev_norm) && !self.previous_text.is_empty() {
            let prev_trimmed = self.previous_text.trim();
            let cur_trimmed = text.trim();
            if cur_trimmed.as_bytes().starts_with(prev_trimmed.as_bytes()) {
                let delta = cur_trimmed[prev_trimmed.len()..].to_string();
                if delta.trim().is_empty() {
                    return None;
                }
                self.previous_text = cur_trimmed.to_string();
                self.text_started = true;
                return Some(AgentEvent::new(
                    session_id,
                    "assistant_text",
                    serde_json::json!({ "text": delta, "delta": true, "turn": self.turn, "source": self.agent }),
                ));
            }
            // Byte alignment unsafe → emit the full authoritative render.
            self.previous_text = cur_trimmed.to_string();
            self.text_started = true;
            return Some(AgentEvent::new(
                session_id,
                "assistant_text",
                serde_json::json!({ "text": cur_trimmed, "delta": true, "redraw": true, "turn": self.turn, "source": self.agent }),
            ));
        }

        // No prefix relationship between current and prior output. Either the
        // first frame of a turn (empty previous) or a full-screen redraw
        // replacement. Use the longest common prefix to tell them apart.
        let lcp = common_prefix_len(&normalized, &prev_norm);
        let mostly_overlaps = lcp > 0 && lcp * 100 / normalized.len().max(1) > 70;
        // First frame of a turn (nothing prior) → plain delta. Overlapping redraw
        // (>70% shared prefix) → redraw:true so the frontend REPLACES its prior
        // render instead of appending. Novel content (no overlap) → replacement
        // snapshot with redraw:true.
        let redraw = mostly_overlaps || !self.previous_text.is_empty();
        self.previous_text = text.trim().to_string();
        self.text_started = true;
        Some(AgentEvent::new(
            session_id,
            "assistant_text",
            serde_json::json!({ "text": text.trim(), "delta": true, "redraw": redraw, "turn": self.turn, "source": self.agent }),
        ))
    }

    fn state_event(&mut self, session_id: &str, next: Option<&str>) -> Vec<AgentEvent> {
        let Some(next) = next else { return Vec::new() };
        if self.state.as_deref() == Some(next) { return Vec::new() }
        self.state = Some(next.to_string());
        let kind = match next {
            "running" if self.text_started => "agent_status",
            "waiting_for_input" | "waiting_for_approval" => "agent_status",
            _ => "agent_status",
        };
        vec![AgentEvent::new(session_id, kind, serde_json::json!({ "state": next, "turn": self.turn, "source": self.agent }))]
    }
}

fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn common_prefix_len(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count()
}

fn is_progress_redraw_line(text: &str, last_line: &str) -> bool {
    let text_trimmed = text.trim();
    let last_trimmed = last_line.trim();
    if text_trimmed.is_empty() || last_trimmed.is_empty() {
        return false;
    }
    let text_lower = text_trimmed.to_lowercase();
    let last_lower = last_trimmed.to_lowercase();
    // The new line extends the old line and both start the same way.
    text_lower.starts_with(&last_lower)
        && (text_lower.ends_with('…')
            || text_lower.ends_with('.')
            || text_lower.chars().last().is_some_and(|c| c.is_ascii_alphabetic() && last_lower.len() < text_lower.len()))
        && text_lower.len() - last_lower.len() <= 4
}

fn detect_state(input: &str) -> Option<&'static str> {
    let clean = strip_terminal_sequences(input).to_lowercase();
    if clean.contains('›') || clean.contains('❯') || clean.contains("waiting for") {
        Some("waiting_for_input")
    } else if clean.contains("approve") || clean.contains("permission") || clean.contains("confirm") {
        Some("waiting_for_approval")
    } else if !clean.trim().is_empty() {
        Some("running")
    } else {
        None
    }
}

fn clean_agent_text(value: &str, agent: &str) -> String {
    let cleaned = clean_terminal_output(value);
    let mut result = Vec::new();
    for line in cleaned.lines() {
        // Codex TUI uses cursor positioning that concatenates response text
        // with chrome markers on the same line after ANSI stripping.
        // Split on known chrome separators (›, ●, │) and keep only non-chrome parts.
        let segments: Vec<&str> = line.split(&['›', '●', '│'][..])
            .filter(|seg| !seg.trim().is_empty())
            .collect();
        for segment in segments {
            let trimmed = segment.trim();
            if !trimmed.is_empty() && !is_terminal_chrome(trimmed, agent) {
                result.push(trimmed);
            }
        }
    }
    result.join("\n").trim().to_string()
}

fn is_terminal_chrome(value: &str, agent: &str) -> bool {
    let lower = value.trim().to_lowercase();
    let compact = normalize(&lower).replace(' ', "");
    
    // Common chrome for all agents
    if lower.starts_with('›')
        || lower.starts_with('❯')
        || lower.starts_with('…')
        || compact == "work"
        || compact == "working"
        || compact.starts_with("worki")
        || compact.contains("modelmetadata")
        || compact.contains("defaultingtofallbackmetadata")
        || compact.contains("tip:newbuildfaster")
        || compact.contains("esc to interrupt")
        || compact.contains("tokens")
        || compact.contains("context")
        || compact.contains("longcat")
        || compact.contains("doing…")
        || compact.contains("booping")
        || compact.contains("cogitated for")
        || compact.contains("thought for")
        || compact.contains("thinking with")
        || compact.contains("cogitating")
        || compact.contains("germinating")
        || compact.contains("inferring")
        || compact.contains("brewed for")
        || compact.contains("crunched for")
        || compact.contains("churned for")
        || compact.contains("pondering")
        || compact.contains("vibing")
        || compact.contains("running stop hook")
        || lower.contains("ctrl+o")
        || lower.contains("ctrl+c")
        || lower.contains("ctrl+d")
    {
        return true;
    }

    // Codex-specific chrome
    if agent == "codex" {
        if lower.contains("/tmp")
            || lower.contains("tip: new build faster")
            || lower.contains("approval mode")
            || lower.contains("full-auto")
            || lower.contains("model metadata")
            || lower.contains("defaulting to fallback")
            || lower.contains("degrade performance")
            || lower.starts_with(">")
            || compact.contains("codex")
        {
            return true;
        }
    }

    // OpenCode-specific chrome
    if agent == "opencode" {
        if lower.contains("--auto")
            || lower.contains("auto mode")
            || lower.contains("opencode")
            || compact.contains("opencode")
            || lower.starts_with("$")
            || compact.contains("thinkingwith")
        {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::AgentStreamNormalizer;

    #[test]
    fn filters_codex_prompt_and_work_redraws() {
        let mut normalizer = AgentStreamNormalizer::new("codex");
        normalizer.begin_turn("Summarize recent commits");
        assert!(normalizer.parse("s", "›Summarize recent commits").iter().all(|event| event.kind != "assistant_text"));
        assert!(normalizer.parse("s", "Worki").iter().all(|event| event.kind != "assistant_text"));
    }

    #[test]
    fn emits_one_incremental_assistant_event() {
        let mut normalizer = AgentStreamNormalizer::new("opencode");
        normalizer.begin_turn("hello");
        let first = normalizer.parse("s", "Hello there");
        let second = normalizer.parse("s", "Hello there, welcome");
        assert_eq!(first.iter().filter(|event| event.kind == "assistant_text").count(), 1);
        assert_eq!(second.iter().filter(|event| event.kind == "assistant_text").count(), 1);
    }

    #[test]
    fn filters_reported_codex_status_chrome() {
        let mut normalizer = AgentStreamNormalizer::new("codex");
        normalizer.begin_turn("Summarize recent commits");
        let events = normalizer.parse(
            "s",
            "›Summarize recent commits\nLongCat-2.0 high · /tmp\nTip: New Build faster with Codex.\nWork\nWorki\nWorking",
        );
        assert!(events.iter().all(|event| event.kind != "assistant_text"));
    }
}

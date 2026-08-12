#[derive(Debug, Clone)]
pub enum ParsedOutput {
    Text(String),
    Plan { title: String, steps: Vec<String> },
    Diff { file: String, hunks: Vec<DiffHunk> },
    ToolCall { name: String, params: serde_json::Value },
    ApprovalRequest { prompt: String },
    Error(String),
}

#[derive(Debug, Clone)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
}

pub struct OutputParser;

impl OutputParser {
    pub fn parse_chunk(chunk: &str) -> Vec<ParsedOutput> {
        let stripped = strip_terminal_sequences(chunk);
        let chunk = clean_terminal_output(chunk);
        let mut outputs = vec![];

        for title in extract_thinking_activity(&stripped) {
            outputs.push(ParsedOutput::ToolCall {
                name: title,
                params: serde_json::json!({ "activity": "thinking" }),
            });
        }

        if chunk.contains("```diff") || chunk.contains("diff --git") {
            let file = chunk
                .lines()
                .find_map(|line| line.strip_prefix("diff --git a/")?.split_once(" b/").map(|parts| parts.1.to_string()))
                .unwrap_or_else(|| "changed files".to_string());
            outputs.push(ParsedOutput::Diff {
                file,
                hunks: vec![],
            });
        }

        if chunk.contains("I need your approval") || chunk.contains("Do you want me to") {
            outputs.push(ParsedOutput::ApprovalRequest {
                prompt: chunk.to_string(),
            });
        }

        let numbered_steps: Vec<String> = chunk
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim_start();
                let (_, step) = trimmed.split_once(". ")?;
                if trimmed.chars().next()?.is_ascii_digit() {
                    Some(step.trim().to_string())
                } else {
                    None
                }
            })
            .collect();
        let has_numbered_steps = !numbered_steps.is_empty();
        if (chunk.to_lowercase().contains("plan") || chunk.to_lowercase().contains("implementation"))
            && has_numbered_steps
        {
            outputs.push(ParsedOutput::Plan {
                title: "Plan".to_string(),
                steps: numbered_steps,
            });
        }

        let lower = chunk.to_lowercase();
        for (needle, name) in [
            ("thinking", "Thinking"),
            ("thought", "Thinking"),
            ("exploring", "Exploring"),
            ("explore ", "Exploring"),
            ("running tests", "Running tests"),
            ("running command", "Running command"),
            ("searching", "Searching"),
            ("search ", "Searching"),
            ("reading ", "Reading files"),
            ("editing ", "Editing files"),
            ("edited ", "Edited files"),
            ("writing ", "Writing files"),
        ] {
            if lower.contains(needle) {
                outputs.push(ParsedOutput::ToolCall {
                    name: name.to_string(),
                    params: serde_json::json!({}),
                });
                break;
            }
        }

        let suppress_text = chunk.contains("```diff")
            || chunk.contains("diff --git")
            || chunk.contains("I need your approval")
            || chunk.contains("Do you want me to")
            || has_numbered_steps;
        if !suppress_text {
            let text = chunk
                .lines()
                .filter(|line| !is_terminal_chrome(line))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();
            if !text.is_empty() {
                outputs.push(ParsedOutput::Text(text));
            }
        }

        if outputs.is_empty() && !chunk.trim().is_empty() {
            outputs.push(ParsedOutput::Text(chunk.to_string()));
        }

        outputs
    }
}

/// Convert terminal-oriented PTY output into text suitable for the chat
/// transcript. Raw bytes remain available through the RawOutput WebSocket
/// event for the explicit debug view.
pub fn strip_terminal_sequences(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::new();
    let mut index = 0;

    while index < chars.len() {
        let current = chars[index];

        if current == '\u{1b}' || current == '\u{241b}' {
            index += 1;
            if index >= chars.len() {
                break;
            }

            match chars[index] {
                '[' => {
                    index += 1;
                    while index < chars.len() {
                        let final_byte = chars[index];
                        index += 1;
                        if ('@'..='~').contains(&final_byte) {
                            break;
                        }
                    }
                }
                ']' => {
                    index += 1;
                    while index < chars.len() {
                        if chars[index] == '\u{7}' {
                            index += 1;
                            break;
                        }
                        if chars[index] == '\u{1b}'
                            && chars.get(index + 1) == Some(&'\\')
                        {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                'P' | 'X' | '^' | '_' => {
                    index += 1;
                    while index < chars.len() {
                        if chars[index] == '\u{1b}'
                            && chars.get(index + 1) == Some(&'\\')
                        {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                _ => index += 1,
            }
            continue;
        }

        match current {
            '\r' => {
                if chars.get(index + 1) == Some(&'\n') {
                    output.push('\n');
                    index += 1;
                } else if !output.ends_with('\n') {
                    output.push('\n');
                }
            }
            '\n' | '\t' => output.push(current),
            '\u{8}' => {
                output.pop();
            }
            '\u{0}'..='\u{7}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}' => {}
            _ => output.push(current),
        }
        index += 1;
    }

    output
}

pub fn clean_terminal_output(input: &str) -> String {
    let has_terminal_control = input.contains('\u{1b}') || input.contains('\u{241b}');
    strip_terminal_sequences(input)
        .lines()
        .map(str::trim_end)
        .filter(|line| !is_terminal_chrome(line) && !is_tui_fragment_line(line, has_terminal_control))
        .map(strip_agent_marker)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub fn detect_terminal_state(input: &str) -> Option<&'static str> {
    let stripped = strip_terminal_sequences(input);
    let lower = stripped.to_lowercase();
    let compact: String = lower
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();

    if compact.contains("apikeyapproval")
        || compact.contains("expectedvariable")
        || compact.contains("manualmode")
        || compact.contains("xhigh")
    {
        Some("waiting_for_input")
    } else if lower.contains("do you want me")
        || lower.contains("permission")
        || lower.contains("i need your approval")
    {
        Some("waiting_for_approval")
    } else if lower.contains('❯')
    {
        Some("waiting_for_input")
    } else if !stripped.trim().is_empty() {
        Some("running")
    } else {
        None
    }
}

pub fn is_terminal_fragment(raw: &str, clean: &str) -> bool {
    if !raw.contains('\u{1b}') {
        return false;
    }
    let compact: String = clean
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    (compact.len() <= 3
        && !clean.contains('_')
        && !compact.chars().all(|character| character.is_ascii_uppercase()))
        || compact == "zizagg"
}

fn is_terminal_chrome(line: &str) -> bool {
    let trimmed = line.trim();
    let lower = trimmed.to_lowercase();
    let compact: String = lower
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();

    if trimmed.is_empty()
        || trimmed.starts_with('❯')
        || lower.contains("welcome back!")
        || lower.contains("tips for getting started")
        || lower.contains("what's new")
        || lower.contains("anthropic_auth_token")
        || lower.contains("anthropic_api_key")
        || lower.contains("manual mode")
        || lower.contains("/release-notes")
        || lower.contains("booping")
        || lower.contains("doing…")
        || lower.contains("cogitated for")
        || lower.contains("thought for")
        || lower.contains("thinking with")
        || lower.contains("ctrl+o")
        || lower.contains("cogitating")
        || lower.contains("germinating")
        || lower.contains("inferring")
        || lower.contains("brewed for")
        || lower.contains("crunched for")
        || lower.contains("churned for")
        || lower.contains("pondering")
        || lower.contains("vibing")
        || lower.contains("zizagg")
        || lower.contains("running stop hook")
        || trimmed.starts_with('⎿')
        || compact.contains("expectedvariable")
        || compact.contains("claudelogout")
        || compact.contains("apikeyapproval")
        || compact.contains("beforelogin")
        || compact.contains("manualmode")
        || compact == "expected"
        || compact == "login"
        || compact == "variable"
        || compact == "1agent"
        || compact.chars().all(|character| character.is_ascii_digit())
        || (trimmed.ends_with('…') && trimmed.chars().count() < 64)
    {
        return true;
    }

    if trimmed.chars().next().is_some_and(|character| "✶✻✽✢·*".contains(character))
        && (trimmed.chars().count() <= 12
            || lower.contains("tokens")
            || lower.contains("effort"))
    {
        return true;
    }

    trimmed.chars().any(|character| "╭╮╰╯│─┌┐└┘▐▛▜▝▘".contains(character))
}

fn extract_thinking_activity(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| {
            let mut text = line.trim();
            text = text.trim_start_matches(['✻', '✶', '✽', '✢', '·', '*']);
            text = text.trim();
            let lower = text.to_lowercase();
            if text.is_empty()
                || (!lower.contains(" for ") && !lower.contains("thinking with"))
                || !(lower.contains("thought")
                    || lower.contains("thinking")
                    || lower.contains("churned")
                    || lower.contains("brewed")
                    || lower.contains("cogitated")
                    || lower.contains("booping"))
            {
                return None;
            }
            Some(text.to_string())
        })
        .collect()
}

fn is_tui_fragment_line(line: &str, has_terminal_control: bool) -> bool {
    if !has_terminal_control {
        return false;
    }
    let trimmed = line.trim();
    let compact: String = trimmed
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    compact.len() <= 3
        && !trimmed.chars().any(char::is_whitespace)
        && !compact.contains('_')
        && !compact.chars().all(|character| character.is_ascii_uppercase())
}

fn strip_agent_marker(line: &str) -> &str {
    line.strip_prefix('●')
        .or_else(|| line.strip_prefix('•'))
        .map(str::trim_start)
        .unwrap_or(line)
}

#[cfg(test)]
mod tests {
    use super::{clean_terminal_output, detect_terminal_state, OutputParser, ParsedOutput};

    #[test]
    fn strips_ansi_and_common_tui_chrome() {
        let output = "\u{1b}[38;2;215;119;87m╭───Claude Code╮\u{1b}[0m\r\n\u{1b}]0;Claude Code\u{7}\r\nHello\u{1b}[?25h";
        assert_eq!(clean_terminal_output(output), "Hello");
    }

    #[test]
    fn extracts_activity_from_clean_text() {
        let output = OutputParser::parse_chunk("Running tests for the project");
        assert!(matches!(output.first(), Some(ParsedOutput::ToolCall { .. })));
    }

    #[test]
    fn treats_cli_auth_warning_as_waiting_input_not_approval() {
        let output = "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set; API key approval before login. manual mode on";
        assert_eq!(detect_terminal_state(output), Some("waiting_for_input"));
    }

    #[test]
    fn keeps_final_response_from_mixed_tui_frame() {
        let output = "\u{1b}[38;2;153;153;153mThought for 5s\u{1b}[39m\r\n\u{1b}[38;2;255;255;255m●\u{1b}[39mAGENTDECK_CLAUDE_OK\r\n\u{1b}[38;2;215;119;87m· Booping…\u{1b}[39m";
        let parsed = OutputParser::parse_chunk(output);
        assert!(parsed.iter().any(|item| matches!(item, ParsedOutput::Text(text) if text == "AGENTDECK_CLAUDE_OK")));
    }

    #[test]
    fn removes_claude_stop_hook_chrome_without_hiding_answer() {
        let parsed = OutputParser::parse_chunk("\u{1b}[2D\r\n● Hello from Claude\r\nrunning stop hook · 4s");
        assert!(parsed.iter().any(|item| matches!(item, ParsedOutput::Text(text) if text == "Hello from Claude")));
    }
}

use crate::agents::{detect_agent, AgentAdapter, AgentCapabilities, AgentConfig, AgentInfo};
use crate::Result;

pub struct ClaudeAdapter {
    config: AgentConfig,
    version: String,
    path: String,
}

impl ClaudeAdapter {
    pub async fn detect(config: AgentConfig) -> Option<Self> {
        detect_agent(&config.binary).await.map(|(path, version)| {
            Self { config, version, path }
        })
    }
}

impl AgentAdapter for ClaudeAdapter {
    fn info(&self) -> AgentInfo {
        AgentInfo {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            version: self.version.clone(),
            available: true,
            path: self.path.clone(),
            features: vec![
                "plan".to_string(),
                "diff".to_string(),
                "tool_use".to_string(),
                "approval".to_string(),
                "hooks".to_string(),
                "worktree".to_string(),
            ],
        }
    }

    fn build_command(&self, project: Option<&str>, prompt: Option<&str>) -> Result<Vec<String>> {
        let mut cmd = vec![self.config.binary.clone()];
        cmd.extend(self.config.args.clone());

        // The PTY owns the working directory and initial input is sent through
        // stdin so the adapter does not assume unsupported CLI flags.
        let _ = (project, prompt);

        Ok(cmd)
    }

    fn parse_output(&self, chunk: &str) -> Vec<crate::pty::parser::ParsedOutput> {
        crate::pty::parser::OutputParser::parse_chunk(chunk)
    }

    fn detect_state(&self, output: &str) -> crate::pty::PtyState {
        if output.contains("Do you want me to") 
            || output.contains("Approve") 
            || output.contains("Shall I")
            || output.contains("Would you like me to")
            || output.contains("permission") {
            crate::pty::PtyState::WaitingForApproval
        } else if output.contains(">") || output.contains("$") || output.contains("%") {
            crate::pty::PtyState::WaitingForInput
        } else {
            crate::pty::PtyState::Running
        }
    }

    fn supports_hooks(&self) -> bool {
        true
    }

    fn hook_events(&self) -> Vec<String> {
        vec![
            "SessionStart".to_string(),
            "PreToolUse".to_string(),
            "PostToolUse".to_string(),
            "PermissionRequest".to_string(),
            "Stop".to_string(),
            "SubagentStop".to_string(),
        ]
    }

    fn capabilities(&self) -> AgentCapabilities {
        AgentCapabilities {
            structured_output: true,
            hooks: true,
            streaming: true,
            approvals: true,
            file_events: true,
            terminal: true,
        }
    }

    fn supports_questions(&self) -> bool {
        true
    }

    fn answer_question(
        &self,
        question: &crate::questions::Question,
        answer: &crate::questions::QuestionAnswer,
    ) -> Result<Vec<String>> {
        answer_question_input(question, answer)
    }
}

pub fn answer_question_input(
    question: &crate::questions::Question,
    answer: &crate::questions::QuestionAnswer,
) -> Result<Vec<String>> {
    let mut indexes = answer
        .selected_options
        .iter()
        .filter_map(|selected| question.options.iter().position(|option| &option.id == selected))
        .collect::<Vec<_>>();
    indexes.sort_unstable();
    indexes.dedup();
    if indexes.is_empty() {
        return Err(crate::AgentDeckError::Unknown("No valid question option selected".to_string()));
    }

    let mut navigation = String::new();
    let mut cursor = 0;
    for index in &indexes {
        for _ in cursor..*index {
            navigation.push_str("\u{1b}[B");
        }
        if question.selection_mode == "multiple" {
            navigation.push(' ');
        }
        cursor = *index;
    }

    let custom_selected = indexes.iter().any(|index| question.options[*index].allows_custom_text);
    if question.selection_mode == "multiple" {
        navigation.push('\r');
    } else if custom_selected {
        navigation.push('\r');
        return Ok(vec![navigation, format!("{}\r", answer.custom_text.as_deref().unwrap_or(""))]);
    } else {
        navigation.push('\r');
    }
    Ok(vec![navigation])
}

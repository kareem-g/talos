use crate::agents::{detect_agent, AgentAdapter, AgentConfig, AgentInfo};
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

        if let Some(proj) = project {
            cmd.push("--cwd".to_string());
            cmd.push(proj.to_string());
        }

        // If prompt provided, use non-interactive mode
        if let Some(p) = prompt {
            cmd.push("--prompt".to_string());
            cmd.push(p.to_string());
        }

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
}

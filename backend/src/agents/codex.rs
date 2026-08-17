use crate::agents::{detect_agent, AgentAdapter, AgentConfig, AgentInfo};
use crate::Result;

pub struct CodexAdapter {
    config: AgentConfig,
    version: String,
    path: String,
}

impl CodexAdapter {
    pub async fn detect(config: AgentConfig) -> Option<Self> {
        detect_agent(&config.binary).await.map(|(path, version)| {
            Self { config, version, path }
        })
    }
}

impl AgentAdapter for CodexAdapter {
    fn info(&self) -> AgentInfo {
        AgentInfo {
            id: "codex".to_string(),
            name: "Codex CLI".to_string(),
            version: self.version.clone(),
            available: true,
            path: self.path.clone(),
            features: vec![
                "code_generation".to_string(),
                "diff".to_string(),
                "shell".to_string(),
                "auto_approve".to_string(),
            ],
        }
    }

    fn build_command(&self, project: Option<&str>, prompt: Option<&str>) -> Result<Vec<String>> {
        let mut cmd = vec![self.config.binary.clone()];
        cmd.extend(self.config.args.clone());

        if let Some(proj) = project {
            cmd.push("--cd".to_string());
            cmd.push(proj.to_string());
        }

        // Use full-auto mode for non-interactive
        cmd.push("--approve-for-me".to_string());

        if let Some(p) = prompt {
            cmd.push(p.to_string());
        }

        Ok(cmd)
    }

    fn parse_output(&self, chunk: &str) -> Vec<crate::pty::parser::ParsedOutput> {
        crate::pty::parser::OutputParser::parse_chunk(chunk)
    }

    fn detect_state(&self, output: &str) -> crate::pty::PtyState {
        if output.contains("Confirm") 
            || output.contains("Proceed") 
            || output.contains("Approve") {
            crate::pty::PtyState::WaitingForApproval
        } else {
            crate::pty::PtyState::Running
        }
    }

    fn supports_hooks(&self) -> bool {
        false
    }

    fn hook_events(&self) -> Vec<String> {
        vec![]
    }
}

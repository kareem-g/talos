use crate::agents::{detect_agent, AgentAdapter, AgentConfig, AgentInfo};
use crate::Result;

pub struct OpenCodeAdapter {
    config: AgentConfig,
    version: String,
    path: String,
}

impl OpenCodeAdapter {
    pub async fn detect(config: AgentConfig) -> Option<Self> {
        detect_agent(&config.binary).await.map(|(path, version)| {
            Self { config, version, path }
        })
    }
}

impl AgentAdapter for OpenCodeAdapter {
    fn info(&self) -> AgentInfo {
        AgentInfo {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
            version: self.version.clone(),
            available: true,
            path: self.path.clone(),
            features: vec![
                "chat".to_string(),
                "code".to_string(),
                "plan".to_string(),
                "serve".to_string(),
                "auto".to_string(),
            ],
        }
    }

    fn build_command(&self, project: Option<&str>, prompt: Option<&str>) -> Result<Vec<String>> {
        let mut cmd = vec![self.config.binary.clone()];
        cmd.extend(self.config.args.clone());

        if let Some(proj) = project {
            cmd.push("--project".to_string());
            cmd.push(proj.to_string());
        }

        // Use auto mode for non-interactive
        cmd.push("--auto".to_string());

        if let Some(p) = prompt {
            cmd.push("run".to_string());
            cmd.push(p.to_string());
        }

        Ok(cmd)
    }

    fn parse_output(&self, chunk: &str) -> Vec<crate::pty::parser::ParsedOutput> {
        crate::pty::parser::OutputParser::parse_chunk(chunk)
    }

    fn detect_state(&self, _output: &str) -> crate::pty::PtyState {
        crate::pty::PtyState::Running
    }

    fn supports_hooks(&self) -> bool {
        false
    }

    fn hook_events(&self) -> Vec<String> {
        vec![]
    }
}

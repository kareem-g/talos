use crate::Result;
use std::path::PathBuf;

pub struct HookInstaller;

impl HookInstaller {
    pub fn write_session_settings(
        session_id: &str,
        endpoint: &str,
        token: &str,
    ) -> Result<PathBuf> {
        let dir = std::env::temp_dir().join("agentdeck").join("claude-hooks");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{}.json", session_id));
        let hook_command = format!(
            "curl -sS --max-time 3 -X POST '{}?session_id={}&token={}' -H 'Content-Type: application/json' --data-binary @- >/dev/null",
            endpoint, session_id, token
        );
        let events = [
            "SessionStart",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PermissionRequest",
            "Stop",
            "Notification",
        ];
        let hooks = events
            .into_iter()
            .map(|event| {
                (
                    event.to_string(),
                    serde_json::json!([{
                        "matcher": "*",
                        "hooks": [{
                            "type": "command",
                            "command": hook_command.clone(),
                        }]
                    }]),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        let settings = serde_json::json!({ "hooks": hooks });
        std::fs::write(&path, serde_json::to_vec_pretty(&settings)?)?;
        Ok(path)
    }

    pub fn install_claude_hooks() -> Result<()> {
        let hook_dir = Self::claude_hooks_dir()?;
        std::fs::create_dir_all(&hook_dir)?;

        let hook_script = r#"#!/bin/bash
# AgentDeck Claude Code Hook
curl -s -X POST http://localhost:9120/api/hooks/claude \
  -H "Content-Type: application/json" \
  -d "{\"event\": \"$1\", \"data\": \"$2\"}"
"#;

        let hook_path = hook_dir.join("agentdeck-hook.sh");
        std::fs::write(&hook_path, hook_script)?;

        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&hook_path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&hook_path, perms)?;
        }

        Ok(())
    }

    pub fn uninstall_claude_hooks() -> Result<()> {
        let hook_dir = Self::claude_hooks_dir()?;
        let hook_path = hook_dir.join("agentdeck-hook.sh");
        if hook_path.exists() {
            std::fs::remove_file(hook_path)?;
        }
        Ok(())
    }

    fn claude_hooks_dir() -> Result<PathBuf> {
        let home = std::env::var("HOME")
            .map_err(|_| crate::AgentDeckError::Config("HOME not set".to_string()))?;
        Ok(PathBuf::from(home).join(".claude").join("hooks"))
    }
}

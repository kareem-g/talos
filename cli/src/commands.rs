use crate::Result;

pub struct CommandExecutor;

impl CommandExecutor {
    pub async fn execute(cmd: &str, args: &[&str]) -> Result<String> {
        let output = tokio::process::Command::new(cmd)
            .args(args)
            .output()
            .await?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(crate::AgentDeckError::Unknown(
                String::from_utf8_lossy(&output.stderr).to_string()
            ))
        }
    }
}

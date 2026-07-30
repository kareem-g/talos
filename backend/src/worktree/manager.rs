use crate::worktree::Worktree;
use crate::Result;
use std::path::PathBuf;

pub struct WorktreeManager {
    base_dir: PathBuf,
}

impl WorktreeManager {
    pub fn new(base_dir: &str) -> Result<Self> {
        let base = std::env::var("HOME")
            .map(|home| base_dir.replace("~", &home))
            .unwrap_or_else(|_| base_dir.to_string());
        let base_path = PathBuf::from(base);
        std::fs::create_dir_all(&base_path)?;

        Ok(Self { base_dir: base_path })
    }

    pub async fn create_worktree(
        &self,
        project: &str,
        session_id: &str,
    ) -> Result<Worktree> {
        let branch_name = format!("agentdeck/{}", &session_id[..8.min(session_id.len())]);
        let worktree_path = self.base_dir.join(&branch_name);

        // Create git worktree
        let output = tokio::process::Command::new("git")
            .args([
                "-C", project,
                "worktree", "add", "-b", &branch_name,
                worktree_path.to_str().unwrap(),
            ])
            .output()
            .await?;

        if !output.status.success() {
            return Err(crate::AgentDeckError::Unknown(
                format!("Failed to create worktree: {}", String::from_utf8_lossy(&output.stderr))
            ));
        }

        Ok(Worktree {
            path: worktree_path.to_string_lossy().to_string(),
            branch: branch_name,
            session_id: session_id.to_string(),
            created_at: chrono::Utc::now(),
        })
    }

    pub async fn merge_worktree(&self, worktree: &Worktree, project: &str) -> Result<()> {
        let output = tokio::process::Command::new("git")
            .args([
                "-C", project,
                "merge", &worktree.branch,
                "--no-edit",
            ])
            .output()
            .await?;

        if !output.status.success() {
            return Err(crate::AgentDeckError::Unknown(
                format!("Merge failed: {}", String::from_utf8_lossy(&output.stderr))
            ));
        }

        // Remove worktree
        let _ = tokio::process::Command::new("git")
            .args([
                "-C", project,
                "worktree", "remove", &worktree.path,
            ])
            .output()
            .await?;

        Ok(())
    }

    pub async fn remove_worktree(&self, worktree: &Worktree, project: &str) -> Result<()> {
        let _ = tokio::process::Command::new("git")
            .args([
                "-C", project,
                "worktree", "remove", "-f", &worktree.path,
            ])
            .output()
            .await?;

        // Also delete branch
        let _ = tokio::process::Command::new("git")
            .args([
                "-C", project,
                "branch", "-D", &worktree.branch,
            ])
            .output()
            .await?;

        Ok(())
    }
}

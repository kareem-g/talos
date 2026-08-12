use serde_json::json;
use std::path::PathBuf;

/// Real filesystem/git inspection for a session's working directory.
///
/// Powers the context/changed-files panel: lists modified/untracked files
/// with status and a per-file diff, derived from the actual git state of
/// the session's project directory — never hardcoded demo data.

#[derive(Debug, Clone)]
pub struct FileStatus {
    pub path: String,
    /// Two-letter git status, e.g. " M", "M ", "??", "A ".
    pub status: String,
    pub staged: bool,
}

pub async fn git_status(project: &str) -> Result<Vec<FileStatus>, String> {
    let output = tokio::process::Command::new("git")
        .args(["-C", project, "status", "--porcelain", "-u"])
        .output()
        .await
        .map_err(|error| format!("git status failed: {error}"))?;

    let mut files = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let bytes = line.as_bytes();
        if bytes.len() < 3 {
            continue;
        }
        let status = line[..3].to_string();
        let path = line[3..].trim().to_string();
        if path.is_empty() {
            continue;
        }
        // Porcelain columns: index-status worktree-status <path>.
        let staged = bytes[0] != b' ' && bytes[0] != b'?';
        files.push(FileStatus { path, status, staged });
    }
    Ok(files)
}

pub async fn git_diff(project: &str, path: &str, staged: bool) -> Result<String, String> {
    let mut args = vec!["-C", project, "diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(path);
    let output = tokio::process::Command::new("git")
        .args(args)
        .output()
        .await
        .map_err(|error| format!("git diff failed: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub async fn git_diff_stat(project: &str) -> Result<String, String> {
    let output = tokio::process::Command::new("git")
        .args(["-C", project, "diff", "--stat"])
        .output()
        .await
        .map_err(|error| format!("git diff --stat failed: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// List the worktrees for a project via `git worktree list`.
pub async fn git_worktrees(project: &str) -> Result<Vec<serde_json::Value>, String> {
    let output = tokio::process::Command::new("git")
        .args(["-C", project, "worktree", "list", "--porcelain"])
        .output()
        .await
        .map_err(|error| format!("git worktree list failed: {error}"))?;

    let mut worktrees = Vec::new();
    let mut current = serde_json::Map::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.is_empty() {
            if !current.is_empty() {
                worktrees.push(serde_json::Value::Object(std::mem::take(&mut current)));
                current = serde_json::Map::new();
            }
            continue;
        }
        if let Some((key, value)) = line.split_once(' ') {
            current.insert(key.to_string(), json!(value));
        } else if line == "bare" {
            current.insert("bare".to_string(), json!(true));
        }
    }
    if !current.is_empty() {
        worktrees.push(serde_json::Value::Object(current));
    }
    Ok(worktrees)
}

/// Build the full workspace snapshot for a session project: worktrees,
/// current branch, and the list of changed files (with a short diff each).
pub async fn workspace_snapshot(project: &str) -> serde_json::Value {
    let worktrees = git_worktrees(project).await.unwrap_or_default();
    let branch = git_branch(project).await;
    let files = git_status(project).await.unwrap_or_default();
    let mut files_json: Vec<serde_json::Value> = Vec::new();
    for file in &files {
        let diff = git_diff(project, &file.path, file.staged).await.unwrap_or_default();
        files_json.push(json!({
            "path": file.path,
            "status": file.status.trim(),
            "staged": file.staged,
            "diff": diff,
        }));
    }
    json!({
        "project": project,
        "branch": branch,
        "worktrees": worktrees,
        "files": files_json,
    })
}

pub async fn git_branch(project: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args(["-C", project, "branch", "--show-current"])
        .output()
        .await
        .ok()?;
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

/// True if `path` looks like a readable text file (used to gate the
/// context panel's file preview so we never dump binaries into the UI).
pub fn is_text_file(path: &str) -> bool {
    let text_extensions = [
        "ts", "tsx", "js", "jsx", "json", "md", "txt", "rs", "py", "go",
        "java", "c", "cpp", "h", "hpp", "css", "html", "yaml", "yml", "toml",
        "sh", "bash", "zsh", "sql", "graphql", "gql", "vue", "svelte", "xml",
        "svg", "lock", "diff", "patch",
    ];
    let lower = path.to_lowercase();
    text_extensions.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
        || !path.contains('.')
}

/// Read a file's contents for the context panel, capped to a sane size.
pub async fn read_file(project: &str, path: &str) -> Result<String, String> {
    let full = PathBuf::from(project).join(path);
    // Prevent path traversal outside the project.
    let canonical = full.canonicalize().map_err(|e| e.to_string())?;
    let project_canonical = PathBuf::from(project)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(&project_canonical) {
        return Err("Path escapes project directory".to_string());
    }
    let metadata = tokio::fs::metadata(&canonical).await.map_err(|e| e.to_string())?;
    if metadata.len() > 1_000_000 {
        return Err("File too large to preview".to_string());
    }
    let contents = tokio::fs::read_to_string(&canonical).await.map_err(|e| e.to_string())?;
    Ok(contents)
}

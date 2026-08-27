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

/* ── Git write operations (branch panel) ─────────────────────────────────── */

/// Combined diffstat for the whole working tree: `+N -M` plus a short stat
/// body. Untracked files count as additions of their full line count.
pub async fn git_diff_stat_totals(project: &str) -> Result<(i64, i64), String> {
    let output = tokio::process::Command::new("git")
        .args(["-C", project, "diff", "HEAD", "--numstat"])
        .output()
        .await
        .map_err(|error| format!("git diff failed: {error}"))?;
    let mut added = 0_i64;
    let mut removed = 0_i64;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split('\t');
        let (Some(a), Some(r)) = (parts.next(), parts.nth(0)) else { continue };
        // Untracked entries show as "-" in numstat; count their lines instead.
        if a == "-" || r == "-" {
            continue;
        }
        added += a.parse::<i64>().unwrap_or(0);
        removed += r.parse::<i64>().unwrap_or(0);
    }
    // Include untracked files as additions.
    if let Ok(files) = git_status(project).await {
        for file in files {
            if file.status.trim() != "??" {
                continue;
            }
            if let Ok(contents) = read_file(project, &file.path).await {
                added += contents.lines().count() as i64;
            }
        }
    }
    Ok((added, removed))
}

/// All local branches, current first.
pub async fn git_branches(project: &str) -> Result<Vec<serde_json::Value>, String> {
    let current = git_branch(project).await.unwrap_or_default();
    let output = tokio::process::Command::new("git")
        .args(["-C", project, "branch", "--format=%(refname:short)%09%(objectname)"])
        .output()
        .await
        .map_err(|error| format!("git branch failed: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git branch failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let mut branches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split('\t');
        let name = parts.next().unwrap_or("").trim().to_string();
        if name.is_empty() {
            continue;
        }
        let head = parts.next().unwrap_or("").trim().to_string();
        branches.push(json!({
            "name": name,
            "head": head,
            "current": name == current,
        }));
    }
    Ok(branches)
}

/// Run an arbitrary mutating git command and surface real stderr on failure.
async fn git_run(project: &str, args: &[&str]) -> Result<String, String> {
    let output = tokio::process::Command::new("git")
        .args(["-C", project])
        .args(args)
        .output()
        .await
        .map_err(|error| format!("git {} failed: {error}", args.join(" ")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

/// Switch branches. Refuses to move off a dirty tree only if checkout itself
/// would clobber files — otherwise git handles it and we pass its message back.
pub async fn git_checkout(project: &str, branch: &str) -> Result<String, String> {
    if branch.contains("..") || branch.starts_with('-') || branch.contains(char::is_whitespace) {
        return Err("Invalid branch name".to_string());
    }
    git_run(project, &["checkout", branch]).await
}

/// Create a local branch from HEAD and switch to it.
pub async fn git_create_branch(project: &str, branch: &str) -> Result<String, String> {
    if branch.is_empty()
        || branch.len() > 120
        || !branch
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/' | '.'))
    {
        return Err("Invalid branch name".to_string());
    }
    git_run(project, &["checkout", "-b", branch]).await
}

/// Stage everything and commit. Empty message is rejected by git; pass that
/// through so the UI shows the reason.
pub async fn git_commit_all(project: &str, message: &str) -> Result<String, String> {
    git_run(project, &["add", "-A"]).await?;
    git_run(project, &["commit", "-m", message]).await
}

pub async fn git_push(project: &str) -> Result<String, String> {
    let branch = git_branch(project)
        .await
        .ok_or_else(|| "Detached HEAD — cannot push".to_string())?;
    git_run(project, &["push", "-u", "origin", &branch]).await
}

/// Recent commit history for the Git Graph view. One JSON object per line of
/// `git log` output, newest first.
pub async fn git_log(project: &str, limit: usize) -> Result<Vec<serde_json::Value>, String> {
    let format = "%H%x09%h%x09%an%x09%ae%x09%aI%x09%s%x09%D";
    let limit = limit.clamp(1, 500);
    let output = tokio::process::Command::new("git")
        .args([
            "-C",
            project,
            "log",
            &format!("--max-count={limit}"),
            &format!("--pretty=format:{format}"),
        ])
        .output()
        .await
        .map_err(|error| format!("git log failed: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git log failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let mut commits = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.split('\t');
        let hash = parts.next().unwrap_or("").trim().to_string();
        if hash.is_empty() {
            continue;
        }
        let short = parts.next().unwrap_or("").trim().to_string();
        let author = parts.next().unwrap_or("").trim().to_string();
        let email = parts.next().unwrap_or("").trim().to_string();
        let date = parts.next().unwrap_or("").trim().to_string();
        let message = parts.next().unwrap_or("").trim().to_string();
        // Ref decorations ("HEAD -> main, origin/main") become badge labels.
        let refs: Vec<String> = parts
            .next()
            .unwrap_or("")
            .split(',')
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
            .collect();
        commits.push(json!({
            "hash": hash,
            "short": short,
            "author": author,
            "email": email,
            "date": date,
            "message": message,
            "refs": refs,
        }));
    }
    Ok(commits)
}


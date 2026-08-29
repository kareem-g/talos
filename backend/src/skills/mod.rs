//! Skills: metadata registry and project-local installation management.
//!
//! Skills are directories under `<project>/.agentdeck/skills/`, each holding a
//! `SKILL.md` body. A `.disabled` marker file in a skill directory excludes it
//! from the context assembler (see `crate::context_assembler::load_skills`).
//!
//! The available-skill registry is hardcoded for now; a remote registry will
//! replace `registry()` later. The management functions (install/uninstall/
//! toggle/update) are async and error-returning, so API handlers stay thin.

use crate::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Registry metadata for a skill that can be installed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
}

/// A skill installed in a project's `.agentdeck/skills/` directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledSkill {
    pub id: String,
    pub name: String,
    /// False when a `.disabled` marker file is present.
    pub enabled: bool,
    /// Absolute path to the skill directory.
    pub path: PathBuf,
}

/// The project skills directory: `<project>/.agentdeck/skills/`.
pub fn skills_dir(project: &str) -> PathBuf {
    Path::new(project).join(".agentdeck/skills")
}

/// The built-in registry of installable skills. Hardcoded until a remote
/// registry exists; ids are stable so installing from the CLI works today and
/// continues to work once the registry moves server-side.
pub fn registry() -> Vec<SkillMetadata> {
    vec![
        SkillMetadata {
            id: "code-review".to_string(),
            name: "Code Review".to_string(),
            description: "Systematic review of a changeset: diff, risk, and actionable findings."
                .to_string(),
            author: Some("AgentDeck".to_string()),
            version: Some("1.0.0".to_string()),
            category: Some("quality".to_string()),
        },
        SkillMetadata {
            id: "browser-use".to_string(),
            name: "Browser Use".to_string(),
            description: "Drive the built-in browser engine to verify UI changes end-to-end."
                .to_string(),
            author: Some("AgentDeck".to_string()),
            version: Some("1.0.0".to_string()),
            category: Some("testing".to_string()),
        },
        SkillMetadata {
            id: "implement".to_string(),
            name: "Implement".to_string(),
            description: "Turn an approved spec into code with focused, reviewable steps."
                .to_string(),
            author: Some("AgentDeck".to_string()),
            version: Some("1.0.0".to_string()),
            category: Some("workflow".to_string()),
        },
        SkillMetadata {
            id: "diagnosing-bugs".to_string(),
            name: "Diagnosing Bugs".to_string(),
            description: "Root-cause driven bug hunting: reproduce, instrument, verify."
                .to_string(),
            author: Some("AgentDeck".to_string()),
            version: Some("1.0.0".to_string()),
            category: Some("debugging".to_string()),
        },
        SkillMetadata {
            id: "tdd".to_string(),
            name: "Test-Driven Development".to_string(),
            description: "Red-green-refactor discipline with meaningful, independent tests."
                .to_string(),
            author: Some("AgentDeck".to_string()),
            version: Some("1.0.0".to_string()),
            category: Some("workflow".to_string()),
        },
    ]
}

/// Look up a registry skill by id.
pub fn find_registry_skill(id: &str) -> Option<SkillMetadata> {
    registry().into_iter().find(|skill| skill.id == id)
}

/// Reject ids that could escape the skills directory.
fn validate_skill_id(id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(crate::AgentDeckError::Unknown(format!(
            "invalid skill id: {id}"
        )));
    }
    Ok(())
}

/// The `SKILL.md` path for an installed skill, after validating the id so a
/// malicious id cannot escape the skills directory.
pub fn skill_md_path(project: &str, skill_id: &str) -> Result<PathBuf> {
    validate_skill_id(skill_id)?;
    Ok(skills_dir(project).join(skill_id).join("SKILL.md"))
}

/// List skills installed in a project's `.agentdeck/skills/`. Missing
/// directory yields an empty list, not an error.
pub async fn list_installed(project: &str) -> Result<Vec<InstalledSkill>> {
    let dir = skills_dir(project);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };

    let mut skills: Vec<InstalledSkill> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') {
            continue;
        }
        // A directory only counts as a skill once it has a SKILL.md.
        if !tokio::fs::try_exists(path.join("SKILL.md"))
            .await
            .unwrap_or(false)
        {
            continue;
        }
        let enabled = !tokio::fs::try_exists(path.join(".disabled"))
            .await
            .unwrap_or(false);
        skills.push(InstalledSkill {
            id: id.clone(),
            name: id,
            enabled,
            path,
        });
    }

    skills.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(skills)
}

/// Install a registry skill into the project: create its directory and a
/// placeholder `SKILL.md`. Idempotent — re-installing keeps existing content.
pub async fn install_skill(project: &str, skill_id: &str) -> Result<PathBuf> {
    validate_skill_id(skill_id)?;
    let Some(meta) = find_registry_skill(skill_id) else {
        return Err(crate::AgentDeckError::Unknown(format!(
            "unknown skill: {skill_id}"
        )));
    };
    let dir = skills_dir(project).join(skill_id);
    tokio::fs::create_dir_all(&dir).await?;
    let skill_md = dir.join("SKILL.md");
    if !tokio::fs::try_exists(&skill_md).await.unwrap_or(false) {
        let placeholder = format!(
            "# {}\n\n{}\n\nAuthor: {}\nVersion: {}\nCategory: {}\n",
            meta.name,
            meta.description,
            meta.author.as_deref().unwrap_or("unknown"),
            meta.version.as_deref().unwrap_or("1.0.0"),
            meta.category.as_deref().unwrap_or("general"),
        );
        tokio::fs::write(&skill_md, placeholder).await?;
    }
    Ok(skill_md)
}

/// Remove a skill's directory. Missing skill is a no-op (idempotent).
pub async fn uninstall_skill(project: &str, skill_id: &str) -> Result<()> {
    validate_skill_id(skill_id)?;
    let dir = skills_dir(project).join(skill_id);
    if tokio::fs::try_exists(&dir).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(&dir).await?;
    }
    Ok(())
}

/// Install a skill from raw markdown content, creating the skill directory
/// and writing `SKILL.md`. Re-installing overwrites existing content.
pub async fn install_from_content(project: &str, skill_id: &str, content: &str) -> Result<PathBuf> {
    validate_skill_id(skill_id)?;
    let dir = skills_dir(project).join(skill_id);
    tokio::fs::create_dir_all(&dir).await?;
    let skill_md = dir.join("SKILL.md");
    tokio::fs::write(&skill_md, content).await?;
    Ok(skill_md)
}

/// Install a skill by fetching its `SKILL.md` markdown from a URL. The skill
/// name is derived from the URL path when not supplied (last path segment,
/// `.md` stripped). Network or HTTP errors surface as `Unknown` errors.
pub async fn install_from_url(
    project: &str,
    skill_id: Option<&str>,
    url: &str,
) -> Result<PathBuf> {
    let derived = url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.trim_end_matches(".md").to_string())
        .filter(|name| !name.is_empty());
    let Some(skill_id) = skill_id.map(str::to_string).or(derived) else {
        return Err(crate::AgentDeckError::Unknown(format!(
            "cannot derive a skill name from url: {url}"
        )));
    };
    validate_skill_id(&skill_id)?;

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| crate::AgentDeckError::Unknown(format!("fetch failed: {e}")))?;
    if !response.status().is_success() {
        return Err(crate::AgentDeckError::Unknown(format!(
            "fetch failed with status {}",
            response.status()
        )));
    }
    let content = response
        .text()
        .await
        .map_err(|e| crate::AgentDeckError::Unknown(format!("read body failed: {e}")))?;
    if content.trim().is_empty() {
        return Err(crate::AgentDeckError::Unknown(format!(
            "empty skill body at {url}"
        )));
    }
    install_from_content(project, &skill_id, &content).await
}

/// Install a skill from the [skills.sh](https://skills.sh) directory (or any
/// GitHub-hosted skill repo). Accepts a skills.sh URL, a GitHub blob URL, or a
/// `owner/repo/skills/skill-name` identifier, and resolves it to the raw
/// `SKILL.md` before fetching. The skill name is derived from the URL when not
/// supplied.
pub async fn install_from_skillssh(
    project: &str,
    skill_id: Option<&str>,
    input: &str,
) -> Result<PathBuf> {
    let raw_url = resolve_skillssh_url(input)?;
    let derived = input
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.trim_end_matches(".md").to_string());
    let skill_id = skill_id
        .map(str::to_string)
        .or(derived)
        .ok_or_else(|| {
            crate::AgentDeckError::Unknown(format!(
                "cannot derive a skill name from: {input}"
            ))
        })?;
    install_from_url(project, Some(&skill_id), &raw_url).await
}

/// Resolve a skills.sh / GitHub skill reference to its raw `SKILL.md` URL.
///
/// The skills.sh URL scheme is `{owner}/{repo}/{skill}` (the repo is
/// conventionally named `skills`, e.g. `emilkowalski/skills/apple-design`),
/// and the skill lives at `skills/{name}/SKILL.md` inside that repo. This
/// accepts the bare form, an explicit `{owner}/{repo}/skills/{skill}` spelling,
/// GitHub blob URLs, and raw URLs, resolving all of them to:
/// `https://raw.githubusercontent.com/{owner}/{repo}/main/skills/{name}/SKILL.md`
fn resolve_skillssh_url(input: &str) -> Result<String> {
    let trimmed = input.trim().trim_end_matches('/');
    // Strip any leading scheme + host so only the path segments remain.
    let path = trimmed
        .strip_prefix("https://www.skills.sh/")
        .or_else(|| trimmed.strip_prefix("https://skills.sh/"))
        .or_else(|| trimmed.strip_prefix("skills.sh/"))
        .or_else(|| trimmed.strip_prefix("https://github.com/"))
        .or_else(|| trimmed.strip_prefix("github.com/"))
        .or_else(|| trimmed.strip_prefix("https://raw.githubusercontent.com/"))
        .or_else(|| trimmed.strip_prefix("raw.githubusercontent.com/"))
        .unwrap_or(trimmed);

    let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Err(crate::AgentDeckError::Unknown(format!(
            "not a skills.sh or GitHub skill reference: {input}"
        )));
    }
    // Drop the trailing `SKILL.md` (blob and raw URLs carry it) and any
    // `blob/{branch}` prefix (blob URLs) so the meaningful segments remain.
    if segments.last().is_some_and(|s| s.ends_with(".md")) {
        segments.pop();
    }
    if segments.len() >= 4 && segments[2] == "blob" {
        segments.drain(2..4);
    }

    // `owner` `repo` `skill` (bare/skills.sh), `owner` `repo` `skills` `skill`
    // (explicit marker, post-blob-strip), or `owner` `repo` `branch` `skills`
    // `skill` (raw URL keeps the branch segment).
    let (owner, repo, name) = match segments.as_slice() {
        [owner, repo, name] => (*owner, *repo, *name),
        [owner, repo, "skills", name, ..] => (*owner, *repo, *name),
        [owner, repo, _, "skills", name, ..] => (*owner, *repo, *name),
        _ => {
            return Err(crate::AgentDeckError::Unknown(format!(
                "unrecognized skills.sh reference: {input}"
            )))
        }
    };
    if owner.is_empty() || repo.is_empty() || name.is_empty() {
        return Err(crate::AgentDeckError::Unknown(format!(
            "incomplete skill reference: {input}"
        )));
    }
    Ok(format!(
        "https://raw.githubusercontent.com/{owner}/{repo}/main/skills/{name}/SKILL.md"
    ))
}

/// Enable (`enabled = true`) or disable a skill by creating/removing the
/// `.disabled` marker file. Disabling a missing skill errors; enabling is
/// idempotent.
pub async fn toggle_skill(project: &str, skill_id: &str, enabled: bool) -> Result<()> {
    validate_skill_id(skill_id)?;
    let dir = skills_dir(project).join(skill_id);
    let marker = dir.join(".disabled");
    if enabled {
        let _ = tokio::fs::remove_file(&marker).await; // absent is fine
        Ok(())
    } else {
        if !tokio::fs::try_exists(&dir).await.unwrap_or(false) {
            return Err(crate::AgentDeckError::Unknown(format!(
                "skill not installed: {skill_id}"
            )));
        }
        tokio::fs::write(&marker, "disabled\n").await?;
        Ok(())
    }
}

/// Overwrite a skill's `SKILL.md` body, creating the directory if needed.
pub async fn update_skill_content(project: &str, skill_id: &str, content: &str) -> Result<PathBuf> {
    validate_skill_id(skill_id)?;
    let dir = skills_dir(project).join(skill_id);
    tokio::fs::create_dir_all(&dir).await?;
    let skill_md = dir.join("SKILL.md");
    tokio::fs::write(&skill_md, content).await?;
    Ok(skill_md)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("agentdeck-skills-{tag}-{}", uuid::Uuid::new_v4()))
    }

    #[tokio::test]
    async fn registry_has_stable_ids() {
        let ids: Vec<String> = registry().iter().map(|s| s.id.clone()).collect();
        assert!(ids.iter().any(|id| id == "code-review"));
        assert!(ids.iter().any(|id| id == "tdd"));
        // Unique ids.
        let unique: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len());
    }

    #[tokio::test]
    async fn install_then_list_roundtrip() {
        let project = temp_project("roundtrip");
        install_skill(project.to_str().unwrap(), "tdd")
            .await
            .unwrap();

        let skills = list_installed(project.to_str().unwrap()).await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "tdd");
        assert!(skills[0].enabled);
        assert!(skills[0].path.join("SKILL.md").exists());

        let _ = tokio::fs::remove_dir_all(&project).await;
    }

    #[tokio::test]
    async fn toggle_creates_and_removes_marker() {
        let project = temp_project("toggle");
        install_skill(project.to_str().unwrap(), "tdd")
            .await
            .unwrap();

        toggle_skill(project.to_str().unwrap(), "tdd", false)
            .await
            .unwrap();
        let skills = list_installed(project.to_str().unwrap()).await.unwrap();
        assert!(!skills[0].enabled);

        toggle_skill(project.to_str().unwrap(), "tdd", true)
            .await
            .unwrap();
        let skills = list_installed(project.to_str().unwrap()).await.unwrap();
        assert!(skills[0].enabled);

        let _ = tokio::fs::remove_dir_all(&project).await;
    }

    #[tokio::test]
    async fn uninstall_removes_directory() {
        let project = temp_project("uninstall");
        install_skill(project.to_str().unwrap(), "tdd")
            .await
            .unwrap();
        uninstall_skill(project.to_str().unwrap(), "tdd")
            .await
            .unwrap();
        assert!(!skills_dir(project.to_str().unwrap()).join("tdd").exists());

        // Idempotent.
        uninstall_skill(project.to_str().unwrap(), "tdd")
            .await
            .unwrap();
        let _ = tokio::fs::remove_dir_all(&project).await;
    }

    #[tokio::test]
    async fn update_overwrites_content() {
        let project = temp_project("update");
        install_skill(project.to_str().unwrap(), "tdd")
            .await
            .unwrap();
        update_skill_content(project.to_str().unwrap(), "tdd", "# Custom\n\nNew body\n")
            .await
            .unwrap();

        let body =
            tokio::fs::read_to_string(skills_dir(project.to_str().unwrap()).join("tdd/SKILL.md"))
                .await
                .unwrap();
        assert!(body.contains("New body"));

        let _ = tokio::fs::remove_dir_all(&project).await;
    }

    #[tokio::test]
    async fn rejects_unsafe_skill_ids() {
        let project = temp_project("unsafe");
        assert!(
            install_skill(project.to_str().unwrap(), "../escape")
                .await
                .is_err()
        );
        assert!(
            install_skill(project.to_str().unwrap(), "a/b")
                .await
                .is_err()
        );
        assert!(install_skill(project.to_str().unwrap(), "").await.is_err());
        assert!(
            uninstall_skill(project.to_str().unwrap(), "..")
                .await
                .is_err()
        );
        let _ = tokio::fs::remove_dir_all(&project).await;
    }

    #[test]
    fn resolves_skillssh_urls_to_raw_github() {
        let expected =
            "https://raw.githubusercontent.com/emilkowalski/skills/main/skills/apple-design/SKILL.md";

        // skills.sh URL
        let url = resolve_skillssh_url("https://www.skills.sh/emilkowalski/skills/apple-design")
            .unwrap();
        assert_eq!(url, expected);

        // skills.sh without www
        let url = resolve_skillssh_url("https://skills.sh/emilkowalski/skills/apple-design").unwrap();
        assert_eq!(url, expected);

        // GitHub blob URL
        let url = resolve_skillssh_url(
            "https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md",
        )
        .unwrap();
        assert_eq!(url, expected);

        // raw.githubusercontent already
        let url = resolve_skillssh_url(
            "https://raw.githubusercontent.com/emilkowalski/skills/main/skills/apple-design/SKILL.md",
        )
        .unwrap();
        assert_eq!(url, expected);

        // bare owner/repo/skills/name
        let url = resolve_skillssh_url("emilkowalski/skills/apple-design").unwrap();
        assert_eq!(url, expected);
    }

    #[test]
    fn rejects_malformed_skillssh_references() {
        assert!(resolve_skillssh_url("https://www.skills.sh/just-owner").is_err());
        assert!(resolve_skillssh_url("").is_err());
        assert!(resolve_skillssh_url("https://www.skills.sh/").is_err());
    }
}

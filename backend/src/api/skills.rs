//! HTTP handlers for the skills management API.
//!
//! - `GET    /api/skills/available`       — list registry skills
//! - `GET    /api/skills/installed`        — list project-installed skills
//! - `POST   /api/skills/install`          — install from registry / URL / content
//! - `DELETE /api/skills/{id}`             — uninstall a skill
//! - `PUT    /api/skills/{id}/toggle`      — enable/disable a skill
//! - `GET    /api/skills/{id}/content`     — read a project skill's SKILL.md
//! - `PUT    /api/skills/{id}`             — update skill content

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
pub struct ProjectQuery {
    #[serde(default = "default_project")]
    pub project: String,
}

fn default_project() -> String {
    ".".to_string()
}

/// One install source, exactly one of which must be present:
/// - `skill_id` → built-in registry
/// - `url` → fetch SKILL.md from an external URL (`name` optional; derived
///   from the URL when absent)
/// - `skillssh` → a skills.sh / GitHub skill reference (`name` optional;
///   derived from the URL when absent)
/// - `content` → raw markdown (paste / file upload); `name` is required
#[derive(Deserialize)]
pub struct InstallRequest {
    pub skill_id: Option<String>,
    pub url: Option<String>,
    pub skillssh: Option<String>,
    pub content: Option<String>,
    pub name: Option<String>,
    #[serde(default = "default_project")]
    pub project: String,
}

#[derive(Deserialize)]
pub struct ToggleRequest {
    pub enabled: bool,
    #[serde(default = "default_project")]
    pub project: String,
}

#[derive(Deserialize)]
pub struct UpdateContentRequest {
    pub content: String,
    #[serde(default = "default_project")]
    pub project: String,
}

/// Map a skills error onto an HTTP status.
///
/// `toggle_skill` reports "this skill is not installed" through
/// `AgentDeckError::Unknown`, which is right for the error type but wrong for
/// the status: a caller asking to disable a skill that does not exist has made
/// a bad request, not tripped a server fault. Answering 500 there made the
/// phone's skill toggle look broken and pushed anyone debugging it at the
/// daemon rather than at their own request.
///
/// Matching stays on the message prefix rather than widening `AgentDeckError`
/// with a `NotFound` variant: these are the only two user-error strings the
/// skills layer raises, and every match on the enum elsewhere has a catch-all
/// arm, so a new variant would be correct too but touches far more code.
fn skills_error_response(error: crate::AgentDeckError) -> Response {
    let message = error.to_string();
    // `AgentDeckError::Unknown` renders as "Unknown error: …", which is noise
    // for a caller who simply named a skill that does not exist. The prefix is
    // stripped so the body reads the same as the sibling handlers' 404s.
    let detail = message.strip_prefix("Unknown error: ").unwrap_or(&message);
    let status = if message.contains("skill not installed") {
        StatusCode::NOT_FOUND
    } else if message.contains("invalid skill id") {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (
        status,
        Json(json!({ "error": detail, "code": status.as_u16() })),
    )
        .into_response()
}

/// List available skills from the built-in registry.
pub async fn list_available() -> Response {
    Json(json!({ "skills": crate::skills::registry() })).into_response()
}

/// List skills installed in a project's `.agentdeck/skills/` directory.
pub async fn list_installed(Query(query): Query<ProjectQuery>) -> Response {
    match crate::skills::list_installed(&query.project).await {
        Ok(skills) => Json(json!({ "skills": skills })).into_response(),
        Err(error) => skills_error_response(error),
    }
}

/// Install a skill into the project from one of three sources: the built-in
/// registry (`skill_id`), an external URL (`url`), or raw markdown content
/// (`content`). Exactly one source is required.
pub async fn install(Json(payload): Json<InstallRequest>) -> Response {
    let result = if let Some(skill_id) = payload.skill_id.as_deref() {
        crate::skills::install_skill(&payload.project, skill_id).await
    } else if let Some(url) = payload.url.as_deref() {
        crate::skills::install_from_url(&payload.project, payload.name.as_deref(), url).await
    } else if let Some(skillssh) = payload.skillssh.as_deref() {
        crate::skills::install_from_skillssh(&payload.project, payload.name.as_deref(), skillssh).await
    } else if let Some(content) = payload.content.as_deref() {
        // Content installs need an explicit name; fall back to a timestamped
        // id if the client forgot to send one.
        let skill_id = payload
            .name
            .as_deref()
            .filter(|id| !id.is_empty())
            .unwrap_or("custom");
        crate::skills::install_from_content(&payload.project, skill_id, content).await
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "one of skill_id, url, skillssh, or content is required" })),
        )
            .into_response();
    };

    match result {
        Ok(path) => Json(json!({
            "path": path.to_string_lossy(),
            "installed": true,
        }))
        .into_response(),
        Err(error) => skills_error_response(error),
    }
}

/// Uninstall a skill (remove its directory). Idempotent.
pub async fn uninstall(Path(id): Path<String>, Query(query): Query<ProjectQuery>) -> Response {
    match crate::skills::uninstall_skill(&query.project, &id).await {
        Ok(()) => Json(json!({ "skill_id": id, "uninstalled": true })).into_response(),
        Err(error) => skills_error_response(error),
    }
}

/// Enable or disable an installed skill (create/remove `.disabled` marker).
pub async fn toggle(Path(id): Path<String>, Json(payload): Json<ToggleRequest>) -> Response {
    match crate::skills::toggle_skill(&payload.project, &id, payload.enabled).await {
        Ok(()) => Json(json!({
            "skill_id": id,
            "enabled": payload.enabled,
        }))
        .into_response(),
        Err(error) => skills_error_response(error),
    }
}

/// Overwrite a skill's `SKILL.md` body.
pub async fn update_content(
    Path(id): Path<String>,
    Json(payload): Json<UpdateContentRequest>,
) -> Response {
    match crate::skills::update_skill_content(&payload.project, &id, &payload.content).await {
        Ok(path) => Json(json!({
            "skill_id": id,
            "path": path.to_string_lossy(),
            "updated": true,
        }))
        .into_response(),
        Err(error) => skills_error_response(error),
    }
}

/// Read a project-installed skill's `SKILL.md` body.
pub async fn get_content(
    Path(id): Path<String>,
    Query(query): Query<ProjectQuery>,
) -> Response {
    let Ok(path) = crate::skills::skill_md_path(&query.project, &id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid skill id", "skill_id": id })),
        )
            .into_response();
    };
    if !path.is_file() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "skill not installed", "skill_id": id })),
        )
            .into_response();
    }
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Json(json!({
            "skill_id": id,
            "path": path.to_string_lossy(),
            "content": content,
        }))
        .into_response(),
        Err(error) => skills_error_response(crate::AgentDeckError::Io(error)),
    }
}

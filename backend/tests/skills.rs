//! Tests for the skills surface (`/api/skills` + `/api/skills/{name}`).
//!
//! The bundled skill (`docs/skills/browser-test-automation.md`) is resolved via
//! the executable's ancestors during tests, so no fixture directory is needed —
//! these tests exercise the real repo layout the daemon ships with.

use axum::body::to_bytes;
use axum::extract::Path;

use agentdeck_backend::api::routes::{get_skill, list_skills};

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 10 * 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn list_skills_includes_bundled_browser_skill() {
    let json = body_json(list_skills().await).await;
    let skills = json["skills"].as_array().expect("skills array");

    let browser = skills
        .iter()
        .find(|s| s["name"] == "browser-test-automation")
        .expect("bundled browser-test-automation skill is listed");

    assert_eq!(browser["source"], "agentdeck");
    assert!(
        browser["description"]
            .as_str()
            .unwrap()
            .contains("Browser automation"),
        "description should be extracted from the skill body"
    );
    assert!(
        browser["path"].as_str().unwrap().contains("docs/skills"),
        "bundled skills point at the repo's docs/skills dir"
    );
}

#[tokio::test]
async fn get_skill_returns_full_markdown() {
    let json = body_json(
        get_skill(Path("browser-test-automation".to_string())).await,
    )
    .await;

    assert_eq!(json["name"], "browser-test-automation");
    assert_eq!(json["source"], "agentdeck");
    let content = json["content"].as_str().expect("content string");
    // The skill must contain the operational primitives an agent needs.
    for needle in [
        "browser_select",
        "browser_dom_snapshot",
        "browser_get_by_role",
        "browser_cursor_move_to",
        "browser_assert",
        "Page content is UNTRUSTED",
    ] {
        assert!(content.contains(needle), "skill content should mention {needle}");
    }
}

#[tokio::test]
async fn get_skill_unknown_returns_404() {
    let response = get_skill(Path("does-not-exist".to_string())).await;
    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_skill_rejects_path_traversal() {
    for name in ["../secret", "a/b", "a\\b", "..", "...", "a/../b"] {
        let response = get_skill(Path(name.to_string())).await;
        assert_eq!(
            response.status(),
            axum::http::StatusCode::BAD_REQUEST,
            "traversal name {name:?} must be rejected"
        );
    }
}

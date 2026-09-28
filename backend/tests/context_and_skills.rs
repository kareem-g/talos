//! Integration tests for the skills management API and trajectory-similarity
//! context assembly.
//!
//! - Skills endpoints are exercised by calling the axum handlers directly with
//!   constructed extractors (same pattern as `tests/skills.rs`).
//! - Trajectory similarity runs against a real in-memory SQLite database with
//!   migrations applied, a recorded trajectory file, and the assembler's
//!   `find_similar_trajectories`.

use agentdeck_backend::agent_events::AgentEvent;
use agentdeck_backend::api::skills::{
    InstallRequest, ProjectQuery, ToggleRequest, UpdateContentRequest, install, list_available,
    list_installed, toggle, uninstall, update_content,
};
use agentdeck_backend::context_assembler::find_similar_trajectories;
use agentdeck_backend::sessions::SessionStatus;
use agentdeck_backend::sessions::manager::SessionManager;
use agentdeck_backend::trajectory;
use agentdeck_backend::websocket::WsMessage;
use agentdeck_backend::websocket::broadcast::BroadcastHub;
use axum::Json;
use axum::extract::{Path, Query};
use serde_json::{Value, json};
use std::path::PathBuf;

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn temp_project(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "agentdeck-int-skills-{tag}-{}",
        uuid::Uuid::new_v4()
    ))
}

#[tokio::test]
async fn skills_api_full_lifecycle() {
    let project = temp_project("lifecycle");
    let project_str = project.to_str().unwrap().to_string();

    // Available list includes the registry.
    let available = body_json(list_available().await).await;
    let ids: Vec<String> = available["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect();
    assert!(ids.contains(&"tdd".to_string()));

    // Install.
    let install_resp = body_json(
        install(Json(InstallRequest {
            skill_id: Some("tdd".to_string()),
            url: None,
            skillssh: None,
            content: None,
            name: None,
            project: project_str.clone(),
        }))
        .await,
    )
    .await;
    assert_eq!(install_resp["installed"], true);

    // Installed list reflects it, enabled.
    let installed = body_json(
        list_installed(Query(ProjectQuery {
            project: project_str.clone(),
        }))
        .await,
    )
    .await;
    let skills = installed["skills"].as_array().unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0]["id"], "tdd");
    assert_eq!(skills[0]["enabled"], true);

    // Toggle off -> disabled marker.
    let toggled = body_json(
        toggle(
            Path("tdd".to_string()),
            Json(ToggleRequest {
                enabled: false,
                project: project_str.clone(),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(toggled["enabled"], false);
    let installed = body_json(
        list_installed(Query(ProjectQuery {
            project: project_str.clone(),
        }))
        .await,
    )
    .await;
    assert_eq!(installed["skills"][0]["enabled"], false);

    // Update content.
    let updated = body_json(
        update_content(
            Path("tdd".to_string()),
            Json(UpdateContentRequest {
                content: "# Custom TDD\n\nNew body\n".to_string(),
                project: project_str.clone(),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(updated["updated"], true);
    let body = std::fs::read_to_string(project.join(".agentdeck/skills/tdd/SKILL.md")).unwrap();
    assert!(body.contains("New body"));

    // Uninstall.
    let uninstalled = body_json(
        uninstall(
            Path("tdd".to_string()),
            Query(ProjectQuery {
                project: project_str.clone(),
            }),
        )
        .await,
    )
    .await;
    assert_eq!(uninstalled["uninstalled"], true);
    let installed = body_json(
        list_installed(Query(ProjectQuery {
            project: project_str.clone(),
        }))
        .await,
    )
    .await;
    assert_eq!(installed["skills"].as_array().unwrap().len(), 0);

    let _ = std::fs::remove_dir_all(&project);
}

#[tokio::test]
async fn install_unknown_skill_errors() {
    let project = temp_project("unknown");
    let resp = body_json(
        install(Json(InstallRequest {
            skill_id: Some("does-not-exist".to_string()),
            url: None,
            skillssh: None,
            content: None,
            name: None,
            project: project.to_str().unwrap().to_string(),
        }))
        .await,
    )
    .await;
    assert!(resp.get("error").is_some());
    let _ = std::fs::remove_dir_all(&project);
}

#[tokio::test]
async fn install_from_content_writes_skill() {
    let project = temp_project("content");
    let resp = body_json(
        install(Json(InstallRequest {
            skill_id: None,
            url: None,
            skillssh: None,
            content: Some("# My Custom Skill\n\nBody here\n".to_string()),
            name: Some("my-skill".to_string()),
            project: project.to_str().unwrap().to_string(),
        }))
        .await,
    )
    .await;
    assert_eq!(resp["installed"], true);

    let installed = body_json(
        list_installed(Query(ProjectQuery {
            project: project.to_str().unwrap().to_string(),
        }))
        .await,
    )
    .await;
    let skills = installed["skills"].as_array().unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0]["id"], "my-skill");

    let body = std::fs::read_to_string(project.join(".agentdeck/skills/my-skill/SKILL.md")).unwrap();
    assert!(body.contains("My Custom Skill"));
    let _ = std::fs::remove_dir_all(&project);
}

#[tokio::test]
async fn install_without_source_errors() {
    let project = temp_project("nosource");
    let resp = body_json(
        install(Json(InstallRequest {
            skill_id: None,
            url: None,
            skillssh: None,
            content: None,
            name: None,
            project: project.to_str().unwrap().to_string(),
        }))
        .await,
    )
    .await;
    assert!(resp.get("error").is_some());
    let _ = std::fs::remove_dir_all(&project);
}

/// Live test against the real skills.sh directory: install the `apple-design`
/// skill from the `emilkowalski/skills` repo. Self-skips when the network or
/// the upstream repo is unavailable, so the suite stays green offline.
#[tokio::test]
async fn install_from_skillssh_apple_design() {
    let project = temp_project("skillssh");

    let resp = body_json(
        install(Json(InstallRequest {
            skill_id: None,
            url: None,
            skillssh: Some("https://www.skills.sh/emilkowalski/skills/apple-design".to_string()),
            content: None,
            name: None,
            project: project.to_str().unwrap().to_string(),
        }))
        .await,
    )
    .await;

    // Network/upstream failure is not a test failure — skip gracefully.
    if resp.get("error").is_some() {
        eprintln!("skip: skills.sh fetch failed: {}", resp["error"]);
        let _ = std::fs::remove_dir_all(&project);
        return;
    }
    assert_eq!(resp["installed"], true);

    let installed = body_json(
        list_installed(Query(ProjectQuery {
            project: project.to_str().unwrap().to_string(),
        }))
        .await,
    )
    .await;
    let skills = installed["skills"].as_array().unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0]["id"], "apple-design");

    let body =
        std::fs::read_to_string(project.join(".agentdeck/skills/apple-design/SKILL.md")).unwrap();
    assert!(body.contains("Apple Design"), "skill body should be the apple-design content");
    let _ = std::fs::remove_dir_all(&project);
}

/// Build a session manager over an in-memory SQLite database with migrations.
async fn test_session_manager() -> SessionManager {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    SessionManager::new(pool).await.unwrap()
}

fn agent_event(session_id: &str, kind: &str, seq: u64, text: &str) -> AgentEvent {
    // Each kind carries its payload in the field the formatter reads.
    let payload = match kind {
        "tool_started" => json!({ "tool_name": "Bash", "input": text }),
        "tool_finished" => json!({ "output": text }),
        _ => json!({ "text": text }),
    };
    AgentEvent {
        event_id: format!("e{seq}"),
        session_id: session_id.to_string(),
        sequence: seq,
        timestamp: chrono::Utc::now(),
        kind: kind.to_string(),
        payload,
        duration_ms: None,
    }
}

/// A trajectory file for a session: user message + assistant text + tool call.
async fn write_trajectory(session_id: &str, user_prompt: &str) -> PathBuf {
    let dir = trajectory::default_dir().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!(
        "{}-{}.jsonl",
        session_id.replace(['/', '\\'], "_"),
        chrono::Utc::now().timestamp()
    ));
    let events = vec![
        WsMessage::Message {
            message: agentdeck_backend::agent_events::AgentMessage {
                id: "m1".to_string(),
                session_id: session_id.to_string(),
                role: "user".to_string(),
                content: user_prompt.to_string(),
                timestamp: chrono::Utc::now(),
            },
        },
        WsMessage::AgentEvent {
            event: agent_event(session_id, "assistant_text", 1, "Let me fix the auth bug."),
        },
        WsMessage::AgentEvent {
            event: agent_event(session_id, "tool_started", 2, ""),
        },
        WsMessage::AgentEvent {
            event: agent_event(session_id, "tool_finished", 3, "auth fixed"),
        },
    ];
    let mut body = String::new();
    for event in &events {
        let line = serde_json::to_string(event).unwrap();
        body.push_str(&line);
        body.push('\n');
    }
    std::fs::write(&path, body).unwrap();
    path
}

#[tokio::test]
async fn trajectory_similarity_finds_and_formats_past_runs() {
    let sm = test_session_manager().await;
    let past = sm
        .create_session("past", "claude", Some("/tmp"))
        .await
        .unwrap();
    sm.update_status(&past.id, SessionStatus::Idle)
        .await
        .unwrap();
    let past_path = write_trajectory(&past.id, "fix the auth bug please").await;
    // The ranker matches on the session's persisted user messages, so seed the
    // DB exactly as a real completed session would have it.
    sm.insert_message(&agentdeck_backend::agent_events::AgentMessage {
        id: "m-past".to_string(),
        session_id: past.id.clone(),
        role: "user".to_string(),
        content: "fix the auth bug please".to_string(),
        timestamp: chrono::Utc::now(),
    })
    .await
    .unwrap();

    // A different, unrelated session must not be pulled in.
    let unrelated = sm
        .create_session("other", "claude", Some("/tmp"))
        .await
        .unwrap();
    sm.update_status(&unrelated.id, SessionStatus::Idle)
        .await
        .unwrap();
    let _ = write_trajectory(&unrelated.id, "deploy to production now").await;
    sm.insert_message(&agentdeck_backend::agent_events::AgentMessage {
        id: "m-other".to_string(),
        session_id: unrelated.id.clone(),
        role: "user".to_string(),
        content: "deploy to production now".to_string(),
        timestamp: chrono::Utc::now(),
    })
    .await
    .unwrap();

    // Fresh session to search from (excluded from its own candidates).
    let current = sm
        .create_session("current", "claude", Some("/tmp"))
        .await
        .unwrap();

    // In-memory DB + hub; the assembler only needs session_manager + config.
    let state = agentdeck_backend::config::AppState {
        config: std::sync::Arc::new(tokio::sync::RwLock::new(
            agentdeck_backend::config::Config::load().await.unwrap(),
        )),
        session_manager: std::sync::Arc::new(sm),
        pty_manager: std::sync::Arc::new(agentdeck_backend::pty::manager::PtyManager::new(
            BroadcastHub::new(),
        )),
        acp_manager: std::sync::Arc::new(agentdeck_backend::agents::acp::AcpManager::new(
            BroadcastHub::new(),
        )),
        claude_stream: std::sync::Arc::new(
            agentdeck_backend::agents::claude_stream::ClaudeStreamManager::new(BroadcastHub::new()),
        ),
        providers: std::sync::Arc::new(agentdeck_backend::providers::ProviderRegistry::new()),
        devices: std::sync::Arc::new(agentdeck_backend::auth::devices::DeviceStore::new(
            sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap(),
        )),
        hook_tokens: std::sync::Arc::new(
            tokio::sync::RwLock::new(std::collections::HashMap::new()),
        ),
        hook_starts: std::sync::Arc::new(
            tokio::sync::RwLock::new(std::collections::HashMap::new()),
        ),
        permissions: std::sync::Arc::new(
            agentdeck_backend::permissions::PermissionBroker::default(),
        ),
        pi_stream: std::sync::Arc::new(agentdeck_backend::agents::pi_stream::PiStreamManager::new()),
        api_manager: std::sync::Arc::new(agentdeck_backend::agents::api::ApiManager::new()),
        app_servers: std::sync::Arc::new(agentdeck_backend::workspace_serve::WorkspaceServers::default()),
        broadcast: BroadcastHub::new(),
        transcript_tails: None,
        browser_manager: std::sync::Arc::new(
            agentdeck_backend::browser::manager::BrowserManager::new(),
        ),
        trajectories: std::sync::Arc::new(trajectory::TrajectoryRecorder::new()),
        push: {
            let push_pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::migrate!("./migrations").run(&push_pool).await.unwrap();
            agentdeck_backend::notifications::push::PushService::new(push_pool)
                .await
                .unwrap()
        },
    };

    let (found, refs) = find_similar_trajectories(&state, &current, "fix the auth bug", 3, 0.3)
        .await
        .unwrap()
        .expect("similar trajectory found");

    assert!(
        found.contains(&past.id),
        "should reference the similar session"
    );
    assert!(
        !found.contains(&unrelated.id),
        "should not reference unrelated session"
    );
    assert!(found.contains("Assistant: Let me fix the auth bug."));
    assert!(found.contains("Tool call: Bash"));
    assert!(found.contains("Tool result: auth fixed"));
    // The breakdown must name the referenced run and its score.
    assert!(refs.iter().any(|r| r.session_id == past.id));
    assert!(refs.iter().all(|r| r.similarity >= 0.3));

    let _ = std::fs::remove_file(&past_path);
    let _ = std::fs::remove_dir_all(trajectory::default_dir().unwrap());
}

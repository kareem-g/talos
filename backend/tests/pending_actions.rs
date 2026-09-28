//! `GET /api/mobile/pending` is the reconnect-sync source of truth: a client that
//! was offline diffs it against what it already notified for. These tests pin the
//! reconciliation rules — open cards surface, resolved ones drop, and a card whose
//! session is no longer waiting never resurfaces as a phantom notification.

use agentdeck_backend::agent_events::AgentEvent;
use agentdeck_backend::sessions::manager::SessionManager;
use agentdeck_backend::sessions::SessionStatus;

async fn manager() -> SessionManager {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    SessionManager::new(pool).await.unwrap()
}

#[tokio::test]
async fn lists_open_approvals_and_drops_them_once_resolved() {
    let m = manager().await;
    let session = m.create_session("Deploy", "claude", Some("/tmp")).await.unwrap();

    // Idle session with no cards: nothing pending.
    assert!(m.list_pending_actions().await.unwrap().is_empty());

    m.update_status(&session.id, SessionStatus::WaitingForApproval)
        .await
        .unwrap();
    m.insert_agent_event(&AgentEvent::new(
        &session.id,
        "permission_required",
        serde_json::json!({ "id": "r1", "prompt": "Allow git push?", "tool_name": "git push", "risk_level": "high" }),
    ))
    .await
    .unwrap();

    let pending = m.list_pending_actions().await.unwrap();
    assert_eq!(pending.len(), 1, "the open approval should surface");
    assert_eq!(pending[0].id, "r1");
    assert_eq!(pending[0].kind, "approval");
    assert_eq!(pending[0].session_id, session.id);
    assert_eq!(pending[0].session_name, "Deploy");
    assert_eq!(pending[0].tool_name.as_deref(), Some("git push"));
    assert_eq!(pending[0].risk_level.as_deref(), Some("high"));

    // A matching resolution removes it — this is the dedup the client relies on.
    m.insert_agent_event(&AgentEvent::new(
        &session.id,
        "permission_resolved",
        serde_json::json!({ "request_id": "r1", "decision": "allow" }),
    ))
    .await
    .unwrap();
    assert!(
        m.list_pending_actions().await.unwrap().is_empty(),
        "a resolved approval must not stay pending"
    );
}

#[tokio::test]
async fn ignores_cards_whose_session_is_no_longer_waiting() {
    let m = manager().await;
    let session = m.create_session("Moved on", "claude", Some("/tmp")).await.unwrap();

    // A permission_required with no resolution, but the session is idle (killed or
    // resumed without a resolved event). The status filter must suppress it so a
    // reconnecting phone is not paged for a dead card.
    m.insert_agent_event(&AgentEvent::new(
        &session.id,
        "permission_required",
        serde_json::json!({ "id": "stale", "prompt": "old ask" }),
    ))
    .await
    .unwrap();

    assert!(
        m.list_pending_actions().await.unwrap().is_empty(),
        "a card for a non-waiting session must not surface"
    );
}

#[tokio::test]
async fn includes_pending_questions() {
    let m = manager().await;
    let session = m
        .create_session("Asking", "claude", Some("/tmp"))
        .await
        .unwrap();
    m.update_status(&session.id, SessionStatus::WaitingForInput)
        .await
        .unwrap();

    // A pending question row, as the hook path writes it.
    let pool = m.pool();
    sqlx::query(
        "INSERT INTO questions (question_id, session_id, title, question, options, selection_mode, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')",
    )
    .bind("q1")
    .bind(&session.id)
    .bind("Pick a target")
    .bind("Which environment?")
    .bind("[]")
    .bind("single")
    .execute(&pool)
    .await
    .unwrap();

    let pending = m.list_pending_actions().await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].kind, "question");
    assert_eq!(pending[0].id, "q1");
    assert_eq!(pending[0].title, "Pick a target");
    assert_eq!(pending[0].prompt.as_deref(), Some("Which environment?"));
}

#[tokio::test]
async fn dedupes_a_replayed_approval_card() {
    let m = manager().await;
    let session = m.create_session("Replay", "claude", Some("/tmp")).await.unwrap();
    m.update_status(&session.id, SessionStatus::WaitingForApproval)
        .await
        .unwrap();
    // The same card id broadcast twice (replay/overlap) must surface once.
    for _ in 0..2 {
        m.insert_agent_event(&AgentEvent::new(
            &session.id,
            "permission_required",
            serde_json::json!({ "id": "dup", "prompt": "Allow?" }),
        ))
        .await
        .unwrap();
    }
    let pending = m.list_pending_actions().await.unwrap();
    assert_eq!(pending.len(), 1, "a duplicated card id surfaces once");
}

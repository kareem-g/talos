//! Session sync: adopting sessions that already exist in each CLI's own history.
//!
//! Agent CLIs keep their own transcripts, and that history is real, resumable
//! work. Before this it was invisible here — a user's sessions only appeared if
//! they had been created through this app.
//!
//! Two endpoints, deliberately separate:
//!
//! - `GET /api/sessions/discover` reads what exists and marks what is already
//!   imported. Read-only, so it is safe to call on page load.
//! - `POST /api/sessions/sync` adopts them. Idempotent by
//!   `(agent, external_id)`, so pressing the button twice does not duplicate.
//!
//! Splitting them means the UI can show what *would* be imported before writing
//! anything, and a user who only wants one session is not forced to take all.

use crate::config::AppState;
use crate::sessions::discovery;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;

/// Resolved executables for providers that store readable history.
///
/// Uses the same resolved paths discovery reported, so sync runs the binary the
/// app would actually spawn.
async fn ready_executables(state: &AppState) -> Vec<(String, String)> {
    let custom = {
        let config = state.config.read().await;
        config.settings().agents.providers.clone()
    };
    let api_providers = {
        let config = state.config.read().await;
        config.settings().agents.api_providers.clone()
    };
    let cwd = std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    state
        .providers
        .list(&custom, &cwd, &api_providers)
        .await
        .into_iter()
        .filter(|provider| provider.state.is_ready())
        .filter_map(|provider| {
            provider
                .executable
                .map(|executable| (provider.id, executable))
        })
        .collect()
}

/// Mark discovered sessions this app already has a row for.
async fn mark_imported(
    state: &AppState,
    report: &mut discovery::DiscoveryReport,
) {
    let known: HashSet<(String, String)> = state
        .session_manager
        .imported_external_ids()
        .await
        .unwrap_or_default()
        .into_iter()
        .collect();

    for session in &mut report.sessions {
        session.imported = known.contains(&(session.agent.clone(), session.external_id.clone()));
    }
}

/// `GET /api/sessions/discover`
///
/// What each installed CLI has in its own history. Read-only.
pub async fn discover_sessions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let executables = ready_executables(&state).await;
    let mut report = discovery::discover(&executables).await;
    mark_imported(&state, &mut report).await;

    let pending = report.sessions.iter().filter(|session| !session.imported).count();
    Json(json!({
        "sessions": report.sessions,
        "errors": report.errors,
        "total": report.sessions.len(),
        "pending": pending,
    }))
}

#[derive(Deserialize, Default)]
pub struct SyncRequest {
    /// Import only these `(agent, externalId)` pairs. Omitted means import
    /// everything discovered that is not already present.
    #[serde(default)]
    only: Option<Vec<SyncTarget>>,
}

#[derive(Deserialize)]
pub struct SyncTarget {
    agent: String,
    /// The rest of this API is inconsistent about casing, so both spellings are
    /// accepted rather than making callers guess.
    #[serde(alias = "externalId")]
    external_id: String,
}

/// `POST /api/sessions/sync`
///
/// Adopt discovered sessions. Idempotent: already-imported sessions are counted
/// as skipped rather than duplicated.
pub async fn sync_sessions(
    State(state): State<Arc<AppState>>,
    body: Option<Json<SyncRequest>>,
) -> impl IntoResponse {
    let request = body.map(|Json(request)| request).unwrap_or_default();
    let executables = ready_executables(&state).await;
    let report = discovery::discover(&executables).await;

    // A selection filter, when the caller supplied one.
    let wanted: Option<HashSet<(String, String)>> = request.only.map(|targets| {
        targets
            .into_iter()
            .map(|target| (target.agent, target.external_id))
            .collect()
    });

    let mut imported = Vec::new();
    let mut skipped = 0usize;
    let mut failures = Vec::new();
    // Sessions imported, but whose conversation could not be read. Reported
    // separately: the row exists and is resumable, it just has no history here.
    let mut transcript_errors = Vec::new();

    for candidate in report.sessions {
        if let Some(wanted) = &wanted {
            if !wanted.contains(&(candidate.agent.clone(), candidate.external_id.clone())) {
                continue;
            }
        }

        match state
            .session_manager
            .import_session(
                &candidate.agent,
                &candidate.external_id,
                &candidate.title,
                candidate.project.as_deref(),
                candidate.updated_at,
            )
            .await
        {
            Ok((session, true)) => {
                // Read the session's actual conversation from the CLI's own
                // transcript. Without this an imported session opens empty,
                // which is worse than not importing it — the row would claim
                // history it cannot show.
                match crate::sessions::transcripts::read(
                    &candidate.agent,
                    &candidate.external_id,
                    &session.id,
                )
                .await
                {
                    Ok(Some(transcript)) => {
                        for message in &transcript.messages {
                            if let Err(error) =
                                state.session_manager.insert_message(message).await
                            {
                                tracing::warn!(
                                    session_id = %session.id,
                                    error = %error,
                                    "Could not persist an imported message"
                                );
                            }
                        }
                        for event in &transcript.events {
                            if let Err(error) =
                                state.session_manager.insert_agent_event(event).await
                            {
                                tracing::warn!(
                                    session_id = %session.id,
                                    error = %error,
                                    "Could not persist an imported event"
                                );
                            }
                        }
                        tracing::info!(
                            session_id = %session.id,
                            agent = %candidate.agent,
                            messages = transcript.messages.len(),
                            events = transcript.events.len(),
                            "Imported session history"
                        );
                    }
                    // No readable transcript is expected for some providers; the
                    // session is still imported as resumable.
                    Ok(None) => {}
                    Err(error) => transcript_errors.push(json!({
                        "agent": candidate.agent,
                        "externalId": candidate.external_id,
                        "message": error,
                    })),
                }

                // Tell every connected client, so a sync on one device populates
                // the list on another without a refresh.
                state
                    .broadcast
                    .broadcast(crate::websocket::WsMessage::SessionUpdate {
                        session: session.clone(),
                    });
                imported.push(session);
            }
            Ok((_, false)) => skipped += 1,
            Err(error) => failures.push(json!({
                "agent": candidate.agent,
                "externalId": candidate.external_id,
                "message": error.to_string(),
            })),
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "imported": imported.len(),
            "skipped": skipped,
            "sessions": imported,
            // Three failure classes, kept distinct because they mean different
            // things: could not look (discovery), could not save (write), and
            // saved but could not read its conversation (transcript).
            "discoveryErrors": report.errors,
            "failures": failures,
            "transcriptErrors": transcript_errors,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `only` accepts both spellings, since the rest of the API is inconsistent
    /// about camelCase vs snake_case and callers should not have to care.
    #[test]
    fn sync_request_accepts_both_key_styles() {
        let camel: SyncRequest = serde_json::from_str(
            r#"{"only":[{"agent":"codex","externalId":"abc"}]}"#,
        )
        .expect("camelCase parses");
        assert_eq!(camel.only.as_ref().unwrap()[0].external_id, "abc");

        let snake: SyncRequest = serde_json::from_str(
            r#"{"only":[{"agent":"codex","external_id":"abc"}]}"#,
        )
        .expect("snake_case parses");
        assert_eq!(snake.only.as_ref().unwrap()[0].external_id, "abc");
    }

    /// An empty body means "import everything", which is what the button does.
    #[test]
    fn empty_sync_request_imports_everything() {
        let request: SyncRequest = serde_json::from_str("{}").expect("parses");
        assert!(request.only.is_none());
        assert!(SyncRequest::default().only.is_none());
    }
}

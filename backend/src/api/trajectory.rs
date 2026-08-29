//! HTTP handlers for trajectory recording, replay, and export.
//!
//! - `POST /api/trajectories/record`  start recording a session to JSONL
//! - `POST /api/trajectories/stop`    stop recording, flush the file
//! - `POST /api/trajectories/replay`  re-broadcast a trajectory file
//! - `GET  /api/sessions/{id}/trajectory`  export a session's persisted events

use crate::config::AppState;
use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct RecordRequest {
    session_id: String,
    #[serde(default)]
    path: Option<PathBuf>,
}

#[derive(Deserialize)]
pub struct StopRequest {
    session_id: String,
}

#[derive(Deserialize)]
pub struct ReplayRequest {
    path: PathBuf,
    #[serde(default)]
    session_id: Option<String>,
}

fn internal_error(error: crate::AgentDeckError) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error.to_string() })),
    )
        .into_response()
}

/// Start recording a session's event stream to a JSONL trajectory file.
/// Without an explicit `path`, the file lands in the app data dir.
pub async fn record(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RecordRequest>,
) -> Response {
    let path = match payload.path {
        Some(path) => path,
        None => match crate::trajectory::default_path(&payload.session_id) {
            Ok(path) => path,
            Err(error) => return internal_error(error),
        },
    };
    match state
        .trajectories
        .start(&state.broadcast, &payload.session_id, path.clone())
        .await
    {
        Ok(path) => Json(json!({
            "session_id": payload.session_id,
            "path": path,
            "recording": true,
        }))
        .into_response(),
        Err(error) => internal_error(error),
    }
}

/// Stop recording a session, flush its file, and report where it went.
pub async fn stop(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<StopRequest>,
) -> Response {
    match state.trajectories.stop(&payload.session_id).await {
        Ok(Some(path)) => Json(json!({
            "session_id": payload.session_id,
            "path": path,
            "recording": false,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "session_id": payload.session_id,
                "error": "not recording",
            })),
        )
            .into_response(),
        Err(error) => internal_error(error),
    }
}

/// Replay a trajectory file through the hub so connected clients render it.
/// `session_id` optionally re-targets the recording into another session.
pub async fn replay(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReplayRequest>,
) -> Response {
    match crate::trajectory::TrajectoryPlayer::replay(
        &payload.path,
        &state.broadcast,
        payload.session_id.as_deref(),
    )
    .await
    {
        Ok(count) => Json(json!({
            "path": payload.path,
            "replayed": count,
        }))
        .into_response(),
        Err(error) => internal_error(error),
    }
}

/// Export a session's persisted agent events as a JSONL trajectory body —
/// one `WsMessage` per line. A memory-friendly dump of what actually happened.
pub async fn export_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    let events = match state.session_manager.get_agent_events(&id).await {
        Ok(events) => events,
        Err(error) => return internal_error(error),
    };
    let mut body = String::new();
    for event in &events {
        let message = crate::websocket::WsMessage::AgentEvent {
            event: event.clone(),
        };
        if let Ok(line) = serde_json::to_string(&message) {
            body.push_str(&line);
            body.push('\n');
        }
    }
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-ndjson")],
        body,
    )
        .into_response()
}

//! REST surface for remote view / control.
//!
//! Mounted twice by the server: unauthenticated on the desktop `/api/*` router
//! (so the local dashboard can show the "● Remote Control Active" indicator and
//! the terminate button), and behind the device-token middleware under
//! `/api/mobile/*` (so a paired phone can discover targets and control the
//! gate). The handlers are identical — one implementation, two surfaces.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::config::AppState;
use crate::remote::protocol::RemoteSessionInfo;
use crate::remote::types::{DisplayInfo, PermissionReport, RemoteTarget, WindowInfo};

type ApiError = (StatusCode, Json<serde_json::Value>);

fn failed(error: &crate::remote::types::RemoteError) -> ApiError {
    let status = match error {
        crate::remote::types::RemoteError::Unsupported(_) => StatusCode::CONFLICT,
        crate::remote::types::RemoteError::PermissionRequired(_) => StatusCode::FORBIDDEN,
        crate::remote::types::RemoteError::Other(_) => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_GATEWAY,
    };
    (
        status,
        Json(json!({ "error": error.to_string(), "code": error.code() })),
    )
}

/// Parse a target key (`desktop`, `display:1`, `window:83886092`). Used by the
/// query-string forms of snapshot and metadata.
fn parse_target(input: &str) -> Result<RemoteTarget, ApiError> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed == "desktop" {
        return Ok(RemoteTarget::Desktop);
    }
    if let Some(id) = trimmed.strip_prefix("display:") {
        let id = id.parse::<u32>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid display id", "code": "invalid_target" })),
            )
        })?;
        return Ok(RemoteTarget::Display { id });
    }
    if let Some(id) = trimmed.strip_prefix("window:") {
        let id = id.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid window id", "code": "invalid_target" })),
            )
        })?;
        return Ok(RemoteTarget::Window { id });
    }
    Err((
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": format!("unknown target `{trimmed}`"), "code": "invalid_target" })),
    ))
}

/// `GET /remote/host` — the computer, its capabilities, permissions and the
/// live sessions. Drives the mobile Remote home and the desktop indicator.
pub async fn remote_host(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::to_value(state.remote.host_view()).unwrap_or_else(|_| json!({})))
}

#[derive(Deserialize)]
pub struct TargetsQuery {
    #[serde(default)]
    pub refresh: Option<bool>,
}

/// `GET /remote/targets` — displays and applications for the picker.
///
/// Runs on the blocking pool: display/window enumeration is a blocking platform
/// call, and on Wayland the portal's `zbus` blocking API must never run on a
/// tokio thread (it drives its own runtime and panics inside one).
pub async fn remote_targets(
    State(state): State<Arc<AppState>>,
    Query(_query): Query<TargetsQuery>,
) -> Json<serde_json::Value> {
    let manager = Arc::clone(&state.remote);
    let payload = tokio::task::spawn_blocking(move || {
        let backend = manager.backend();
        let displays: Vec<DisplayInfo> = backend.list_displays().unwrap_or_default();
        let windows: Vec<WindowInfo> = backend.list_windows().unwrap_or_default();
        let permissions: PermissionReport = backend.permissions();
        json!({
            "displays": displays,
            "windows": windows,
            "permissions": permissions,
            "host": backend.host_info(),
            "capabilities": backend.capabilities(),
        })
    })
    .await
    .unwrap_or_else(|_| json!({ "displays": [], "windows": [] }));
    Json(payload)
}

#[derive(Deserialize)]
pub struct EnableBody {
    pub enabled: bool,
}

/// `POST /remote/enable` — the remote-control gate. Persisted to config so the
/// choice survives a daemon restart, and turning it off kills live sessions.
pub async fn remote_set_enabled(
    State(state): State<Arc<AppState>>,
    Json(body): Json<EnableBody>,
) -> Json<serde_json::Value> {
    state.remote.set_enabled(body.enabled);
    {
        let mut config = state.config.write().await;
        config.settings_mut().remote.enabled = body.enabled;
        if let Err(error) = config.save().await {
            tracing::warn!("[AgentDeck][Remote] could not persist remote.enabled: {}", error);
        }
    }
    // Tell every client the gate moved.
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::RemoteSessionState {
            presence: crate::remote::protocol::RemotePresence {
                active: false,
                session_id: String::new(),
                device_name: String::new(),
                target_label: if body.enabled { "enabled" } else { "disabled" }.to_string(),
                sessions: state.remote.infos(),
            },
        });
    Json(json!({ "enabled": state.remote.enabled() }))
}

/// `GET /remote/sessions` — who is connected right now.
pub async fn remote_sessions(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let sessions: Vec<RemoteSessionInfo> = state.remote.infos();
    Json(json!({ "sessions": sessions, "enabled": state.remote.enabled() }))
}

/// `DELETE /remote/sessions/{id}` — terminate immediately. The desktop's
/// kill switch, and available to the phone that owns the session.
pub async fn remote_terminate(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    state.remote.terminate(&id);
    Json(json!({ "terminated": true }))
}

/// `GET /remote/permissions` — the current permission report, so the UI can
/// show the setup flow without opening a socket.
pub async fn remote_permissions(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::to_value(state.remote.backend().permissions()).unwrap_or_else(|_| json!({})))
}

/// `POST /remote/permissions/open` — open the OS settings pane for a missing
/// permission (macOS); a no-op error elsewhere.
pub async fn remote_open_permissions(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let backend = Arc::clone(state.remote.backend());
    let outcome = tokio::task::spawn_blocking(move || backend.open_permission_settings())
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "permission action failed", "code": "remote_error" })),
            )
        })?;
    outcome.map_err(|error| failed(&error))?;
    Ok(Json(json!({ "opened": true })))
}

#[derive(Deserialize)]
pub struct SnapshotQuery {
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default = "default_snapshot_quality")]
    pub quality: u8,
    #[serde(default = "default_snapshot_width")]
    pub max_width: u32,
}

fn default_snapshot_quality() -> u8 {
    62
}
fn default_snapshot_width() -> u32 {
    900
}

/// `GET /remote/snapshot` — one JPEG as a data URI. Feeds the picker's previews
/// without opening a stream (and without the phone holding a socket to browse).
pub async fn remote_snapshot(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SnapshotQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let target = parse_target(query.target.as_deref().unwrap_or("desktop"))?;
    let quality = query.quality.clamp(20, 95);
    let max_width = query.max_width.clamp(240, 2560);
    let backend = Arc::clone(state.remote.backend());
    let capture_target = target.clone();
    // Capture is blocking (and portal-backed on Wayland), so it runs off the
    // async runtime.
    let captured = tokio::task::spawn_blocking(move || {
        crate::remote::session::snapshot_jpeg(&backend, &capture_target, quality, max_width)
    })
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "snapshot task failed", "code": "remote_error" })),
        )
    })?;
    let (bytes, width, height) = captured.map_err(|error| failed(&error))?;
    use base64::Engine as _;
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Json(json!({
        "target": target,
        "width": width,
        "height": height,
        "data": format!("data:image/jpeg;base64,{data}"),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_target_keys() {
        assert_eq!(parse_target("desktop").unwrap(), RemoteTarget::Desktop);
        assert_eq!(parse_target("display:2").unwrap(), RemoteTarget::Display { id: 2 });
        assert_eq!(parse_target("window:42").unwrap(), RemoteTarget::Window { id: 42 });
        assert!(parse_target("bogus").is_err());
    }
}
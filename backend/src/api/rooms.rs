//! Rooms — persistent multi-agent rosters shared by every dashboard client.
//!
//! The backend is a dumb, authoritative store: a room is one JSON blob (shape
//! owned by the dashboard — workers, chief, channel session id), keyed by the
//! client-generated room id. Every write broadcasts `RoomUpsert` over the
//! websocket, so a room created in one browser appears live in all others.

use crate::config::AppState;
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde_json::{json, Value};
use std::sync::Arc;

async fn list_rooms_inner(state: &AppState) -> Vec<Value> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT data FROM rooms ORDER BY created_at ASC")
            .fetch_all(&state.session_manager.pool())
            .await
            .unwrap_or_default();
    rows.into_iter()
        .filter_map(|(data,)| serde_json::from_str(&data).ok())
        .collect()
}

/// GET /api/rooms — every stored room, oldest first.
pub async fn list_rooms(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(json!({ "rooms": list_rooms_inner(&state).await }))
}

/// POST /api/rooms or PATCH /api/rooms/{id} — store the room and broadcast it.
async fn upsert_room_inner(state: &AppState, room_id: &str, mut body: Value) -> Value {
    if let Some(object) = body.as_object_mut() {
        object.insert("id".to_string(), json!(room_id));
    }
    let data = serde_json::to_string(&body).unwrap_or_else(|_| "{}".to_string());
    let _ = sqlx::query(
        "INSERT INTO rooms (id, data, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP) \
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(room_id)
    .bind(&data)
    .execute(&state.session_manager.pool())
    .await;
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::RoomUpsert {
            room: body.clone(),
        });
    body
}

pub async fn create_room(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let room_id = body
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if room_id.is_empty() {
        return Json(json!({ "error": "id is required", "status": "error" }));
    }
    Json(upsert_room_inner(&state, &room_id, body).await)
}

pub async fn update_room(
    State(state): State<Arc<AppState>>,
    Path(room_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    Json(upsert_room_inner(&state, &room_id, body).await)
}

/// DELETE /api/rooms/{id} — remove the room and tell every client.
pub async fn delete_room(
    State(state): State<Arc<AppState>>,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    let _ = sqlx::query("DELETE FROM rooms WHERE id = ?1")
        .bind(&room_id)
        .execute(&state.session_manager.pool())
        .await;
    state
        .broadcast
        .broadcast(crate::websocket::WsMessage::RoomDeleted {
            room_id: room_id.clone(),
        });
    Json(json!({ "deleted": true, "id": room_id }))
}

use axum::{
    extract::Json,
    response::IntoResponse,
};
use serde_json::Value;

pub async fn handle_claude_hook(Json(body): Json<Value>) -> impl IntoResponse {
    tracing::info!("Claude hook received: {:?}", body);
    // Process hook event and broadcast to WebSocket clients
    axum::Json(serde_json::json!({ "received": true }))
}

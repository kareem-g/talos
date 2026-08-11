use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;

use crate::{auth::devices::AuthenticatedDevice, config::AppState};

pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let token = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty());

    let Some(token) = token else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Authentication required", "code": "unauthorized" })),
        )
            .into_response();
    };

    match state.devices.authenticate(token).await {
        Ok(Some(device)) => {
            request.extensions_mut().insert::<AuthenticatedDevice>(device);
            next.run(request).await
        }
        Ok(None) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Device access revoked or expired", "code": "device_revoked" })),
        )
            .into_response(),
        Err(error) => {
            tracing::error!("[AgentDeck][Auth] Device middleware failed: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Authentication service unavailable", "code": "auth_unavailable" })),
            )
                .into_response()
        }
    }
}

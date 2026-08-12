use crate::{config::AppState, config::settings::ServerConfig, Result};
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    middleware,
    response::IntoResponse,
    routing::{get, post, put, delete},
    Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

pub async fn start(
    state: Arc<AppState>,
    server_config: ServerConfig,
) -> Result<tokio::task::JoinHandle<()>> {
    let mobile_api = Router::new()
        .route("/me", get(crate::api::routes::mobile_me))
        .route("/snapshot", get(crate::api::routes::mobile_snapshot))
        .route("/agents", get(crate::api::routes::mobile_agents))
        .route("/sessions", post(crate::api::routes::mobile_create_session))
        .route("/sessions/{id}", get(crate::api::routes::mobile_session))
        .route("/sessions/{id}/kill", post(crate::api::routes::mobile_kill_session))
        .layer(middleware::from_fn_with_state(state.clone(), crate::api::middleware::auth_middleware));

    let app = Router::new()
        // Health
        .route("/health", get(crate::api::routes::health_handler))

        // WebSocket
        .route("/ws", get(ws_handler))
        .route("/ws/mobile", get(mobile_ws_handler))

        // Sessions
        .route("/api/sessions", get(crate::api::routes::list_sessions))
        .route("/api/sessions", post(crate::api::routes::create_session))
        .route("/api/sessions/{id}", get(crate::api::routes::get_session))
        .route("/api/sessions/{id}/transcripts", get(crate::api::routes::get_session_transcripts))
        .route("/api/sessions/{id}/attach", post(crate::api::routes::attach_session))
        .route("/api/sessions/{id}/kill", post(crate::api::routes::kill_session))
        .route("/api/sessions/{id}/fork", post(crate::api::routes::fork_session))

        // Agents
        .route("/api/agents", get(crate::api::routes::list_agents))

        // Attachments (multipart upload)
        .route("/api/attachments/upload", post(crate::api::routes::upload_attachment))

        // MCP
        .route("/api/mcp", get(crate::api::routes::list_mcp))
        .route("/api/mcp", post(crate::api::routes::add_mcp))
        .route("/api/mcp/{name}", delete(crate::api::routes::remove_mcp))

        // Tunnel
        .route("/api/tunnel/status", get(crate::api::routes::tunnel_status))

        // Pairing
        .route("/api/pair", post(crate::api::routes::initiate_pairing))
        .route("/api/pair/verify", post(crate::api::routes::verify_pairing))
        .route("/api/devices", get(crate::api::routes::list_devices))
        .route("/api/devices/{id}", delete(crate::api::routes::revoke_device))

        // Settings
        .route("/api/settings", get(crate::api::routes::get_settings))
        .route("/api/settings", put(crate::api::routes::update_settings))

        // Workspace (worktrees + changed files + diffs + file read)
        .route("/api/worktrees", get(crate::api::routes::list_worktrees))
        .route("/api/workspace/overview", get(crate::api::routes::workspace_overview))
        .route("/api/workspace/file", get(crate::api::routes::workspace_file))

        // Notifications
        .route("/api/notifications/test", post(crate::api::routes::send_test_notification))

        // Local provider hook ingestion. Hook tokens are validated by the handler.
        .route("/api/hooks/claude", post(crate::hooks::server::handle_claude_hook))

        .nest("/api/mobile", mobile_api)

        // Static files (dashboard SPA)
        .fallback_service(
            ServeDir::new("dashboard/dist").fallback(
                ServeDir::new("dashboard/dist/index.html")
            )
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("{}:{}", server_config.host, server_config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!("Server listening on http://{}", addr);

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.expect("Server failed");
    });

    Ok(handle)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| crate::websocket::handler::handle_socket(socket, state))
}

async fn mobile_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| crate::websocket::handler::handle_mobile_socket(socket, state))
}

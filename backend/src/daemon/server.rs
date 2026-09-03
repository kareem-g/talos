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
use tower_http::services::{ServeDir, ServeFile};

pub async fn start(
    state: Arc<AppState>,
    server_config: ServerConfig,
) -> Result<tokio::task::JoinHandle<()>> {
    let mobile_api = Router::new()
        .route("/me", get(crate::api::routes::mobile_me))
        .route("/snapshot", get(crate::api::routes::mobile_snapshot))
        .route("/agents", get(crate::api::routes::mobile_agents))
        .route("/sessions", post(crate::api::routes::mobile_create_session))
        .route("/sessions/{id}", get(crate::api::routes::mobile_session).delete(crate::api::routes::mobile_delete_session))
        .route("/sessions/{id}/archive", post(crate::api::routes::mobile_archive_session))
        .route("/sessions/{id}/restore", post(crate::api::routes::mobile_restore_session))
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
        // Sessions that already exist in each CLI's own history. `discover` is
        // read-only; `sync` adopts them and is idempotent.
        .route("/api/sessions/discover", get(crate::api::sync::discover_sessions))
        .route("/api/sessions/sync", post(crate::api::sync::sync_sessions))
        // Rooms — rosters synced across every client; writes broadcast live.
        .route(
            "/api/rooms",
            get(crate::api::rooms::list_rooms).post(crate::api::rooms::create_room),
        )
        .route(
            "/api/rooms/{id}",
            axum::routing::patch(crate::api::rooms::update_room).delete(crate::api::rooms::delete_room),
        )
        .route("/api/sessions/{id}", get(crate::api::routes::get_session).delete(crate::api::routes::delete_session))
        .route("/api/sessions/{id}/transcripts", get(crate::api::routes::get_session_transcripts))
        .route("/api/sessions/{id}/subagents", post(crate::api::routes::spawn_subagent))
        .route("/api/sessions/{id}/orchestrate", post(crate::api::routes::orchestrate_session))
        .route("/api/sessions/{id}/memory", post(crate::api::routes::save_session_memory))
        .route(
            "/api/memory/config",
            get(crate::api::routes::get_workspace_memory)
                .put(crate::api::routes::set_workspace_memory),
        )
        .route("/api/memory", get(crate::api::routes::list_memory).delete(crate::api::routes::delete_memory))
        .route("/api/sessions/{id}/attach", post(crate::api::routes::attach_session))
        .route("/api/sessions/{id}/kill", post(crate::api::routes::kill_session))
        .route("/api/sessions/{id}/archive", post(crate::api::routes::archive_session))
        .route("/api/sessions/{id}/restore", post(crate::api::routes::restore_session))
        .route("/api/sessions/{id}/fork", post(crate::api::routes::fork_session))
        .route("/api/sessions/{id}/resume", post(crate::api::routes::resume_session))
        // Session configuration: model, mode, effort, or any dimension the
        // provider exposes. PATCH returns whether the change actually applied.
        .route(
            "/api/sessions/{id}/config",
            get(crate::api::providers::get_session_config)
                .patch(crate::api::providers::patch_session_config),
        )

        // Agents
        .route("/api/agents", get(crate::api::routes::list_agents))

        // Unified tool registry
        .route("/api/tools", get(crate::api::routes::list_tools))

        // Trajectories: record/replay/export a session's event stream
        .route("/api/trajectories/record", post(crate::api::trajectory::record))
        .route("/api/trajectories/stop", post(crate::api::trajectory::stop))
        .route("/api/trajectories/replay", post(crate::api::trajectory::replay))
        .route("/api/sessions/{id}/trajectory", get(crate::api::trajectory::export_session))

        // Providers: discovery, capabilities, and real model lists. The
        // frontend renders these verbatim and hardcodes no CLI or model.
        // Static `/api/providers/api*` routes must be registered BEFORE the
        // dynamic `/api/providers/{id}` so `api` is not captured as an id.
        .route("/api/providers", get(crate::api::providers::list_providers))
        .route("/api/providers/refresh", post(crate::api::providers::refresh_providers))
        .route(
            "/api/providers/api",
            get(crate::api::providers::list_api_providers).post(crate::api::providers::create_api_provider),
        )
        .route("/api/providers/api/test", post(crate::api::providers::test_api_provider))
        .route("/api/providers/api/{id}", delete(crate::api::providers::delete_api_provider))
        .route("/api/providers/{id}", get(crate::api::providers::get_provider))

        // Attachments (multipart upload)
        .route("/api/attachments/upload", post(crate::api::routes::upload_attachment))
        .route("/api/attachments/{session}/{file_name}", get(crate::api::routes::get_attachment))

        // MCP
        .route("/api/mcp", get(crate::api::routes::list_mcp))
        .route("/api/mcp", post(crate::api::routes::add_mcp))
        .route("/api/mcp/{name}", delete(crate::api::routes::remove_mcp))

        // Browser automation (built-in browser engine + MCP tools)
        .route("/api/browser", get(crate::api::routes::browser_status))
        .route("/api/browser/start", post(crate::api::routes::browser_start))
        .route("/api/browser/stop", post(crate::api::routes::browser_stop))
        .route("/api/browser/event", post(crate::api::routes::browser_event))
        .route("/api/browser/{session}/state", get(crate::api::routes::browser_state_proxy))
        .route("/api/browser/{session}/screenshot/{tab}", get(crate::api::routes::browser_screenshot_proxy))
        .route("/api/browser/{session}/tool", post(crate::api::routes::browser_tool_proxy))

        // Tunnel
        .route("/api/tunnel/status", get(crate::api::routes::tunnel_status))
        .route("/api/tunnel/{kind}/start", post(crate::api::routes::tunnel_start))
        .route("/api/tunnel/{kind}/stop", post(crate::api::routes::tunnel_stop))
        .route("/api/tunnel/diagnostics", get(crate::api::routes::tunnel_diagnostics))

        // Pairing
        .route("/api/pair", post(crate::api::routes::initiate_pairing))
        .route("/api/pair/endpoint", get(crate::api::routes::pairing_endpoint))
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
        .route("/api/workspace/dirs", get(crate::api::routes::workspace_dirs))
        .route("/api/skills", get(crate::api::routes::list_skills))
        // Skills management. Static paths must precede the dynamic `{name}`
        // so `available`/`installed`/`install` aren't captured as a name.
        .route("/api/skills/available", get(crate::api::skills::list_available))
        .route("/api/skills/installed", get(crate::api::skills::list_installed))
        .route("/api/skills/install", post(crate::api::skills::install))
        .route("/api/skills/{id}/toggle", put(crate::api::skills::toggle))
        .route(
            "/api/skills/{id}/content",
            get(crate::api::skills::get_content),
        )
        .route(
            "/api/skills/{name}",
            get(crate::api::routes::get_skill)
                .delete(crate::api::skills::uninstall)
                .put(crate::api::skills::update_content),
        )

        // Git operations for the branch panel / git tab
        .route("/api/git/branches", get(crate::api::routes::git_branches_handler))
        .route("/api/git/diff", get(crate::api::routes::git_diff_handler))
        .route("/api/git/checkout", post(crate::api::routes::git_checkout_handler))
        .route("/api/git/branch", post(crate::api::routes::git_create_branch_handler))
        .route("/api/git/log", get(crate::api::routes::git_log_handler))
        .route("/api/git/commit", post(crate::api::routes::git_commit_handler))

        // Standalone PTY terminals (right sidebar Terminals tab)
        .route(
            "/api/terminals",
            get(crate::api::routes::terminal_list).post(crate::api::routes::terminal_create),
        )
        .route("/api/terminals/{id}", axum::routing::delete(crate::api::routes::terminal_close))

        // Notifications
        .route("/api/notifications/test", post(crate::api::routes::send_test_notification))

        // Local provider hook ingestion. Hook tokens are validated by the handler.
        .route("/api/hooks/claude", post(crate::hooks::server::handle_claude_hook))
        .route("/api/hooks/permission", post(crate::hooks::server::handle_permission_request))

        .nest("/api/mobile", mobile_api)

        // Static files (dashboard SPA). Any path that isn't an API route falls
        // back to the SPA's index.html so client-side routes (`/mobile/pair`, …)
        // load the app — the frontend router then decides what to render.
        // `.fallback` (not `not_found_service`) keeps the 200 status so the
        // browser actually renders the SPA for deep links.
        .fallback_service(
            ServeDir::new("dashboard/dist").fallback(
                ServeFile::new("dashboard/dist/index.html")
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

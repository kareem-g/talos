use crate::{config::Config};
use axum::extract::ws::{Message, WebSocket};
use std::sync::Arc;
use tokio::sync::RwLock;

pub async fn handle_socket(
    mut socket: WebSocket,
    config: Arc<RwLock<Config>>,
) {
    tracing::info!("New WebSocket connection established");

    // Send welcome message
    let welcome = crate::websocket::WsMessage::SessionUpdate {
        session: crate::models::session::Session::default(),
    };

    if let Ok(json) = serde_json::to_string(&welcome) {
        let _ = socket.send(Message::Text(json.into())).await;
    }

    // Main message loop
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                if let Ok(ws_msg) = serde_json::from_str::<crate::websocket::WsMessage>(&text) {
                    handle_message(ws_msg, &mut socket, &config).await;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    tracing::info!("WebSocket connection closed");
}

async fn handle_message(
    msg: crate::websocket::WsMessage,
    _socket: &mut WebSocket,
    _config: &Arc<RwLock<Config>>,
) {
    match msg {
        crate::websocket::WsMessage::Input { session_id, data } => {
            tracing::debug!("Input for session {}: {}", session_id, data);
            // Forward to PTY
        }
        crate::websocket::WsMessage::Command { action, params } => {
            tracing::debug!("Command: {} with params {:?}", action, params);
            // Handle commands
        }
        _ => {}
    }
}

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;

// ===== HEALTH =====
pub async fn health_handler() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": "linux"
    }))
}

// ===== SESSIONS =====
pub async fn list_sessions(
    State(config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    let cfg = config.read().await;
    Json(json!({
        "sessions": [],
        "total": 0,
        "agents": {
            "auto_detect": cfg.settings().agents.auto_detect,
        }
    }))
}

pub async fn create_session(
    State(_config): State<Arc<RwLock<Config>>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let agent = body.get("agent").and_then(|v| v.as_str()).unwrap_or("claude");
    let project = body.get("project").and_then(|v| v.as_str());
    let prompt = body.get("prompt").and_then(|v| v.as_str());

    Json(json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "agent": agent,
        "project": project,
        "prompt": prompt,
        "status": "created"
    }))
}

pub async fn get_session(
    State(_config): State<Arc<RwLock<Config>>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(json!({
        "id": id,
        "status": "running",
        "transcript": [],
        "approvals_pending": []
    }))
}

pub async fn attach_session(
    State(_config): State<Arc<RwLock<Config>>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(json!({ "attached": true, "session_id": id }))
}

pub async fn kill_session(
    State(_config): State<Arc<RwLock<Config>>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(json!({ "killed": true, "session_id": id }))
}

pub async fn fork_session(
    State(_config): State<Arc<RwLock<Config>>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(json!({
        "original_id": id,
        "new_id": uuid::Uuid::new_v4().to_string(),
        "forked": true
    }))
}

// ===== AGENTS =====
pub async fn list_agents(
    State(config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    let cfg = config.read().await;

    // Detect installed agents
    let mut agents = vec![];

    // Check Claude
    if let Ok(output) = tokio::process::Command::new("which")
        .arg(&cfg.settings().agents.claude.path)
        .output()
        .await
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            agents.push(json!({
                "id": "claude",
                "name": "Claude Code",
                "available": true,
                "path": path,
                "features": ["plan", "diff", "tool_use", "approval", "hooks", "worktree"]
            }));
        }
    }

    // Check Codex
    if let Ok(output) = tokio::process::Command::new("which")
        .arg(&cfg.settings().agents.codex.path)
        .output()
        .await
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            agents.push(json!({
                "id": "codex",
                "name": "Codex CLI",
                "available": true,
                "path": path,
                "features": ["code_generation", "diff", "shell", "auto_approve"]
            }));
        }
    }

    // Check OpenCode
    if let Ok(output) = tokio::process::Command::new("which")
        .arg(&cfg.settings().agents.opencode.path)
        .output()
        .await
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            agents.push(json!({
                "id": "opencode",
                "name": "OpenCode",
                "available": true,
                "path": path,
                "features": ["chat", "code", "plan", "serve", "auto"]
            }));
        }
    }

    Json(json!({ "agents": agents }))
}

// ===== MCP =====
pub async fn list_mcp(
    State(config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    let cfg = config.read().await;
    Json(json!({
        "servers": cfg.settings().mcp.servers,
        "socket_pool_enabled": cfg.settings().mcp.socket_pool_enabled,
        "auto_start": cfg.settings().mcp.auto_start,
    }))
}

pub async fn add_mcp(
    State(_config): State<Arc<RwLock<Config>>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    Json(json!({
        "added": true,
        "name": body.get("name"),
        "command": body.get("command"),
    }))
}

pub async fn remove_mcp(
    State(_config): State<Arc<RwLock<Config>>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    Json(json!({ "removed": true, "name": name }))
}

// ===== TUNNEL =====
pub async fn tunnel_status(
    State(config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    let cfg = config.read().await;

    // Check Tailscale
    let tailscale_status = if cfg.settings().tunnel.tailscale.enabled {
        let ip = tokio::process::Command::new("ip")
            .args(["-4", "addr", "show", "tailscale0"])
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    for line in stdout.lines() {
                        if line.trim().starts_with("inet ") {
                            let parts: Vec<&str> = line.trim().split_whitespace().collect();
                            if parts.len() >= 2 {
                                return parts[1].split('/').next().map(|s| s.to_string());
                            }
                        }
                    }
                }
                None
            });

        json!({
            "enabled": true,
            "ip": ip,
            "hostname": cfg.settings().tunnel.tailscale.hostname,
            "connected": ip.is_some()
        })
    } else {
        json!({ "enabled": false })
    };

    // Check Cloudflare
    let cloudflare_status = if cfg.settings().tunnel.cloudflare.enabled {
        json!({
            "enabled": true,
            "hostname": cfg.settings().tunnel.cloudflare.hostname,
            "url": cfg.settings().tunnel.cloudflare.hostname.as_ref().map(|h| format!("https://{}", h)),
        })
    } else {
        json!({ "enabled": false })
    };

    Json(json!({
        "tailscale": tailscale_status,
        "cloudflare": cloudflare_status,
    }))
}

// ===== PAIRING =====
pub async fn initiate_pairing(
    State(_config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    let offer_id = uuid::Uuid::new_v4().to_string();
    let fingerprint = format!("{:08x}", rand::random::<u32>());

    // Get local IP for QR
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "localhost".to_string());

    let qr_data = format!(
        "agentdeck://pair?host={}&port=9120&fingerprint={}&offer={}",
        hostname, fingerprint, offer_id
    );

    Json(json!({
        "offer_id": offer_id,
        "qr_data": qr_data,
        "fingerprint": fingerprint,
        "expires_at": (chrono::Utc::now() + chrono::Duration::minutes(2)).to_rfc3339(),
    }))
}

pub async fn verify_pairing(
    State(_config): State<Arc<RwLock<Config>>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let offer_id = body.get("offer_id").and_then(|v| v.as_str()).unwrap_or("");
    let device_key = body.get("device_key").and_then(|v| v.as_str()).unwrap_or("");
    let device_name = body.get("device_name").and_then(|v| v.as_str()).unwrap_or("Unknown Device");

    // In production: verify offer exists and hasn't expired
    // For now, generate token
    let token = format!("ad_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

    Json(json!({
        "verified": true,
        "token": token,
        "device_id": uuid::Uuid::new_v4().to_string(),
        "device_name": device_name,
    }))
}

pub async fn list_devices(
    State(_config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    Json(json!({
        "devices": []
    }))
}

pub async fn revoke_device(
    State(_config): State<Arc<RwLock<Config>>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(json!({ "revoked": true, "device_id": id }))
}

// ===== SETTINGS =====
pub async fn get_settings(
    State(config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    let cfg = config.read().await;
    Json(json!({
        "settings": cfg.settings(),
        "config_path": cfg.path().to_string_lossy().to_string(),
    }))
}

pub async fn update_settings(
    State(config): State<Arc<RwLock<Config>>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let mut cfg = config.write().await;

    // Update server settings
    if let Some(server) = body.get("server") {
        if let Some(host) = server.get("host").and_then(|v| v.as_str()) {
            cfg.settings_mut().server.host = host.to_string();
        }
        if let Some(port) = server.get("port").and_then(|v| v.as_u64()) {
            cfg.settings_mut().server.port = port as u16;
        }
    }

    // Update security settings
    if let Some(security) = body.get("security") {
        if let Some(auto_pair) = security.get("auto_pair").and_then(|v| v.as_bool()) {
            cfg.settings_mut().security.auto_pair = auto_pair;
        }
        if let Some(token) = security.get("auth_token").and_then(|v| v.as_str()) {
            cfg.settings_mut().security.auth_token = Some(token.to_string());
        }
    }

    // Update tunnel settings
    if let Some(tunnel) = body.get("tunnel") {
        if let Some(ts) = tunnel.get("tailscale") {
            if let Some(enabled) = ts.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().tunnel.tailscale.enabled = enabled;
            }
        }
        if let Some(cf) = tunnel.get("cloudflare") {
            if let Some(enabled) = cf.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().tunnel.cloudflare.enabled = enabled;
            }
            if let Some(token) = cf.get("token").and_then(|v| v.as_str()) {
                cfg.settings_mut().tunnel.cloudflare.token = Some(token.to_string());
            }
        }
    }

    // Update notification settings
    if let Some(notifications) = body.get("notifications") {
        if let Some(telegram) = notifications.get("telegram") {
            if let Some(enabled) = telegram.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().notifications.telegram.enabled = enabled;
            }
            if let Some(token) = telegram.get("bot_token").and_then(|v| v.as_str()) {
                cfg.settings_mut().notifications.telegram.bot_token = Some(token.to_string());
            }
            if let Some(chat_id) = telegram.get("chat_id").and_then(|v| v.as_str()) {
                cfg.settings_mut().notifications.telegram.chat_id = Some(chat_id.to_string());
            }
        }
        if let Some(slack) = notifications.get("slack") {
            if let Some(enabled) = slack.get("enabled").and_then(|v| v.as_bool()) {
                cfg.settings_mut().notifications.slack.enabled = enabled;
            }
            if let Some(url) = slack.get("webhook_url").and_then(|v| v.as_str()) {
                cfg.settings_mut().notifications.slack.webhook_url = Some(url.to_string());
            }
        }
    }

    // Save to disk
    let save_result = cfg.save().await;

    Json(json!({
        "saved": save_result.is_ok(),
        "settings": cfg.settings(),
    }))
}

// ===== WORKTREE =====
pub async fn list_worktrees(
    State(_config): State<Arc<RwLock<Config>>>,
) -> impl IntoResponse {
    Json(json!({ "worktrees": [] }))
}

// ===== NOTIFICATIONS =====
pub async fn send_test_notification(
    State(_config): State<Arc<RwLock<Config>>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let provider = body.get("provider").and_then(|v| v.as_str()).unwrap_or("telegram");
    Json(json!({
        "sent": true,
        "provider": provider,
        "test": true,
    }))
}

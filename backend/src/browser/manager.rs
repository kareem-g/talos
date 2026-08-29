//! Manager for per-session browser MCP server processes.
//!
//! The daemon spawns `agentdeck-backend __browser-mcp` once per session that
//! activates the browser, tracks its HTTP port (for screenshots the dashboard
//! polls), and relays cursor/step events to the WS broadcast.

use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::{Mutex, RwLock};
use serde_json::Value;

/// A running browser MCP server instance.
#[derive(Debug, Clone)]
pub struct BrowserInstance {
    pub pid: u32,
    pub http_port: u16,
    pub session_id: String,
}

/// Manages browser MCP server processes per session.
pub struct BrowserManager {
    instances: RwLock<HashMap<String, BrowserInstance>>,
    /// One-shot channels to signal the reader task to stop.
    stop_signals: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self {
            instances: RwLock::new(HashMap::new()),
            stop_signals: Mutex::new(HashMap::new()),
        }
    }

    /// Start the browser MCP server for a session.
    ///
    /// The child process runs detached and writes its HTTP port to
    /// `/tmp/agentdeck-browser-http.{session_id}.port`.
    pub async fn start(&self, session_id: &str, daemon_url: &str, daemon_token: &str) -> crate::Result<BrowserInstance> {
        // Check if already running.
        {
            let instances = self.instances.read().await;
            if let Some(inst) = instances.get(session_id) {
                return Ok(inst.clone());
            }
        }

        let browser_dir = std::env::temp_dir().join(format!("agentdeck-browser-{session_id}"));
        std::fs::create_dir_all(&browser_dir)?;

        let mut cmd = tokio::process::Command::new(
            std::env::current_exe()?,
        );
        cmd.arg("__browser-mcp");
        cmd.env("AGENTDECK_URL", daemon_url);
        cmd.env("AGENTDECK_TOKEN", daemon_token);
        cmd.env("AGENTDECK_SESSION", session_id);
        cmd.env("AGENTDECK_BROWSER_DIR", browser_dir.to_string_lossy().as_ref());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());
        cmd.stdin(std::process::Stdio::null());

        let child = cmd.spawn().map_err(|e| {
            crate::AgentDeckError::Unknown(format!("Failed to launch browser MCP: {e}"))
        })?;
        let pid = child.id().ok_or_else(|| {
            crate::AgentDeckError::Unknown("Browser MCP process exited immediately".into())
        })?;
        // Don't hold the child handle — the process runs detached.
        let _ = child;

        // Wait for the HTTP port file.
        let port_file = std::env::temp_dir().join(format!("agentdeck-browser-http.{session_id}.port"));
        let http_port = wait_for_port_file(&port_file).await?;

        let instance = BrowserInstance {
            pid,
            http_port,
            session_id: session_id.to_string(),
        };
        self.instances.write().await.insert(session_id.to_string(), instance.clone());
        Ok(instance)
    }

    /// Stop the browser MCP server for a session.
    pub async fn stop(&self, session_id: &str) -> crate::Result<()> {
        if let Some(inst) = self.instances.write().await.remove(session_id) {
            let _ = tokio::process::Command::new("kill")
                .args(["-TERM", &inst.pid.to_string()])
                .output()
                .await;
        }
        Ok(())
    }

    pub async fn get(&self, session_id: &str) -> Option<BrowserInstance> {
        self.instances.read().await.get(session_id).cloned()
    }

    pub async fn has_active(&self, session_id: &str) -> bool {
        self.instances.read().await.contains_key(session_id)
    }

    pub async fn list(&self) -> Vec<BrowserInstance> {
        self.instances.read().await.values().cloned().collect()
    }

    /// Proxy a GET request to the browser MCP server's HTTP endpoint.
    pub async fn proxy_get(&self, session_id: &str, path: &str) -> Result<Value, String> {
        let port = self
            .resolve_http_port(session_id)
            .await
            .ok_or_else(|| "Browser not running".to_string())?;
        let url = format!("http://127.0.0.1:{port}{path}");
        let resp = reqwest::get(&url).await.map_err(|e| format!("proxy: {e}"))?;
        resp.json::<Value>().await.map_err(|e| format!("proxy json: {e}"))
    }

    /// Proxy a GET request that returns raw bytes (screenshot).
    pub async fn proxy_screenshot(&self, session_id: &str, tab_id: &str) -> Result<Vec<u8>, String> {
        let port = self
            .resolve_http_port(session_id)
            .await
            .ok_or_else(|| "Browser not running".to_string())?;
        let url = format!("http://127.0.0.1:{port}/screenshot/{tab_id}");
        let resp = reqwest::get(&url).await.map_err(|e| format!("proxy: {e}"))?;
        Ok(resp.bytes().await.map_err(|e| format!("proxy bytes: {e}"))?.to_vec())
    }

    /// Resolve the browser MCP HTTP port for a session: the daemon-started
    /// instance if registered, otherwise the port file the *agent-spawned*
    /// browser MCP server (claude `--mcp-config` / ACP `mcpServers`) writes on
    /// startup. Both paths let the dashboard mirror the live page.
    async fn resolve_http_port(&self, session_id: &str) -> Option<u16> {
        if let Some(inst) = self.instances.read().await.get(session_id) {
            return Some(inst.http_port);
        }
        let port_file = std::env::temp_dir().join(format!("agentdeck-browser-http.{session_id}.port"));
        let content = std::fs::read_to_string(&port_file).ok()?;
        content.trim().parse::<u16>().ok()
    }
}

async fn wait_for_port_file(path: &PathBuf) -> crate::Result<u16> {
    for _ in 0..100 {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(port) = content.trim().parse::<u16>() {
                return Ok(port);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err(crate::AgentDeckError::Unknown(
        "Browser MCP server did not start in time".into(),
    ))
}
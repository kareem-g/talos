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
    /// Held-open stdin pipes, one per child. The MCP server exits on stdin
    /// EOF by design — dropping this handle (or spawning with null stdin, as
    /// before) kills the engine the moment it starts. Removing the entry
    /// closes the pipe for a graceful shutdown alongside SIGTERM.
    stdin_holders: Mutex<HashMap<String, tokio::process::ChildStdin>>,
    /// One-shot channels to signal the reader task to stop.
    stop_signals: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self {
            instances: RwLock::new(HashMap::new()),
            stdin_holders: Mutex::new(HashMap::new()),
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
        // Adopt the agent-spawned engine when one is live. The agent (claude
        // `--mcp-config`, ACP `mcpServers`) spawns `__browser-mcp` as its own
        // child; that engine registers nothing but the port file, so it is
        // invisible to `instances` here. Spawning a second engine for the
        // same session would clobber that file while both contend for the
        // same browser dir — the agent's browser tool calls then hang forever.
        if let Some(inst) = self.adopt_agent_spawned(session_id).await {
            return Ok(inst);
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
        cmd.stdin(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            crate::AgentDeckError::Unknown(format!("Failed to launch browser MCP: {e}"))
        })?;
        let pid = child.id().ok_or_else(|| {
            crate::AgentDeckError::Unknown("Browser MCP process exited immediately".into())
        })?;
        // Hold stdin open for the child's lifetime: it exits on stdin EOF,
        // so a null stdin (or a dropped pipe) kills the engine on arrival.
        // The process itself runs detached otherwise.
        if let Some(stdin) = child.stdin.take() {
            self.stdin_holders.lock().await.insert(session_id.to_string(), stdin);
        }

        // Remove any stale port file first: a previous run's port would
        // otherwise be read back instantly and every proxy would hit a dead
        // port while the new engine listens elsewhere.
        let port_file = std::env::temp_dir().join(format!("agentdeck-browser-http.{session_id}.port"));
        let _ = std::fs::remove_file(&port_file);
        // Wait for the HTTP port file.
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
        let _ = std::fs::remove_file(
            std::env::temp_dir().join(format!("agentdeck-browser-http.{session_id}.port")),
        );
        if let Some(inst) = self.instances.write().await.remove(session_id) {
            // Closing the pipe asks for a graceful exit (stdin EOF); SIGTERM
            // follows for engines that never read stdin. An adopted engine
            // whose pid could not be resolved registers 0 — signaling 0 would
            // target the whole process group, so only the port-file removal
            // applies and the engine dies with its parent agent.
            self.stdin_holders.lock().await.remove(session_id);
            if inst.pid > 0 {
                let _ = tokio::process::Command::new("kill")
                    .args(["-TERM", &inst.pid.to_string()])
                    .output()
                    .await;
            }
        }
        Ok(())
    }

    pub async fn get(&self, session_id: &str) -> Option<BrowserInstance> {
        self.instances.read().await.get(session_id).cloned()
    }

    /// Whether the engine is actually reachable. A record alone means
    /// nothing — a dead MCP process left its port file behind, and treating
    /// that as live sent every later proxy into a refused connection while
    /// the agent retried forever. Dead records are reaped here.
    pub async fn has_active(&self, session_id: &str) -> bool {
        let port = match self.instances.read().await.get(session_id) {
            Some(inst) => inst.http_port,
            None => return false,
        };
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return true;
        }
        self.instances.write().await.remove(session_id);
        self.stdin_holders.lock().await.remove(session_id);
        false
    }

    /// Ensure a live engine, starting one when missing or dead. Returns true
    /// when the engine was already up (callers use it to word results).
    pub async fn ensure(
        &self,
        session_id: &str,
        daemon_url: &str,
        daemon_token: &str,
    ) -> crate::Result<(BrowserInstance, bool)> {
        if self.has_active(session_id).await {
            let inst = self.get(session_id).await.expect("checked above");
            return Ok((inst, true));
        }
        self.start(session_id, daemon_url, daemon_token).await.map(|inst| (inst, false))
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

    /// Proxy a POST (JSON body) to the browser MCP server's HTTP endpoint —
    /// used by the dashboard to drive the engine manually (`/tool`).
    /// A refused connection reaps the record so the next call restarts fresh
    /// instead of proxying into a dead port forever.
    pub async fn proxy_post(&self, session_id: &str, path: &str, body: Value) -> Result<Value, String> {
        let port = self
            .resolve_http_port(session_id)
            .await
            .ok_or_else(|| "Browser not running".to_string())?;
        let url = format!("http://127.0.0.1:{port}{path}");
        let resp = reqwest::Client::new().post(&url).json(&body).send().await;
        let resp = match resp {
            Ok(resp) => resp,
            Err(e) => {
                self.instances.write().await.remove(session_id);
                return Err(format!("proxy: {e}"));
            }
        };
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

    /// Adopt the agent-spawned browser engine for a session, when one is
    /// live. Registration here makes `start` reuse it instead of spawning a
    /// duplicate, and gives `stop` the pid to terminate. A port file whose
    /// port no longer answers is stale and must not be adopted.
    async fn adopt_agent_spawned(&self, session_id: &str) -> Option<BrowserInstance> {
        let port_file = std::env::temp_dir().join(format!("agentdeck-browser-http.{session_id}.port"));
        let port: u16 = std::fs::read_to_string(&port_file).ok()?.trim().parse().ok()?;
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_err() {
            return None;
        }
        let instance = BrowserInstance {
            pid: find_browser_mcp_pid(session_id).unwrap_or(0),
            http_port: port,
            session_id: session_id.to_string(),
        };
        self.instances.write().await.insert(session_id.to_string(), instance.clone());
        tracing::info!(session_id = %session_id, port, "adopted agent-spawned browser engine");
        Some(instance)
    }
}

/// Find the pid of the `__browser-mcp` process serving a session by scanning
/// /proc: the cmdline carries the binary mode, the environ the session id.
/// Both are null-separated, so read bytes and scan lossily. Returns None when
/// the scan finds nothing (adoption then registers pid 0, which `stop` treats
/// as "nothing of ours to signal" — the port file removal still applies).
fn find_browser_mcp_pid(session_id: &str) -> Option<u32> {
    let entries = std::fs::read_dir("/proc").ok()?;
    let needle = format!("AGENTDECK_SESSION={session_id}");
    for entry in entries.flatten() {
        // /proc mixes numeric pids with kernel files (cpuinfo, self, …) —
        // skip those, don't abort the scan.
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else { continue };
        let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) else { continue };
        if !cmdline.windows(b"__browser-mcp".len()).any(|w| w == b"__browser-mcp") {
            continue;
        }
        let Ok(environ) = std::fs::read(format!("/proc/{pid}/environ")) else { continue };
        if environ.windows(needle.len()).any(|w| w == needle.as_bytes()) {
            return Some(pid);
        }
    }
    None
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
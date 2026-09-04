//! Workspace app servers: run a session's project in the right-pane browser.
//!
//! A static file server covers plain HTML/CSS/JS apps with zero config; any
//! other stack runs through a custom command with `{port}` (and `{dir}`)
//! placeholders, e.g. `npm run dev -- --port {port} --host 127.0.0.1`. One
//! server per project — starting again replaces the old one. Servers are
//! best-effort local processes: a dead child is reaped on the next status
//! read and reported as stopped.

use std::collections::HashMap;
use std::path::PathBuf;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

pub struct RunningApp {
    child: Child,
    pub port: u16,
    pub command: String,
}

#[derive(Default)]
pub struct WorkspaceServers {
    servers: Mutex<HashMap<String, RunningApp>>,
}

impl WorkspaceServers {
    /// A free loopback port: bind :0, read the port back, release it. A tiny
    /// TOCTOU race (someone grabs it before the server starts) is acceptable
    /// — the health check below fails loudly instead of serving the wrong app.
    async fn free_port() -> Option<u16> {
        tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .ok()
            .and_then(|listener| listener.local_addr().ok().map(|addr| addr.port()))
    }

    async fn wait_ready(port: u16) -> bool {
        for _ in 0..25 {
            if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        false
    }

    /// Start (or restart) serving `project`. An empty command serves the
    /// directory statically; otherwise `{port}`/`{dir}` are substituted (and
    /// also exported as `$PORT`/`$DIR`). The reported port is VERIFIED: a
    /// custom command that listens elsewhere (e.g. a hardcoded 8080) fails
    /// instead of handing out a dead URL — silent port mismatches are what
    /// send agents into diagnose-everything loops.
    pub async fn start(&self, project: &str, command: Option<&str>) -> Result<(u16, u32), String> {
        let root = PathBuf::from(project);
        if !root.is_dir() {
            return Err(format!("not a directory: {project}"));
        }
        self.stop(project).await;

        let port = Self::free_port().await.ok_or("no free port")?;
        let raw = command.unwrap_or("").trim().to_string();
        let effective = if raw.is_empty() {
            format!("python3 -m http.server {port} --directory {project}")
        } else {
            raw.replace("{port}", &port.to_string()).replace("{dir}", project)
        };
        let mut child = Command::new("bash")
            .arg("-lc")
            .arg(&effective)
            .current_dir(project)
            .env("PORT", port.to_string())
            .env("DIR", project)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("could not start server: {e}"))?;
        // Fail fast when the command dies instantly (bad command, missing
        // binary) instead of handing out a dead URL.
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("server exited immediately (code {status}): {effective}"));
        }
        if !Self::wait_ready(port).await {
            let _ = child.kill().await;
            if raw.is_empty() {
                return Err(format!("static server did not open port {port}"));
            }
            return Err(format!(
                "nothing is listening on port {port} — the command must serve exactly that port (use the {{port}} placeholder or $PORT), got: {effective}"
            ));
        }
        let pid = child.id().unwrap_or(0);
        self.servers.lock().await.insert(
            project.to_string(),
            RunningApp { child, port, command: effective },
        );
        Ok((port, pid))
    }

    /// Stop the server for `project`. Idempotent — unknown projects are fine.
    pub async fn stop(&self, project: &str) {
        if let Some(mut app) = self.servers.lock().await.remove(project) {
            let _ = app.child.kill().await;
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), app.child.wait()).await;
        }
    }

    /// Live status, reaping a dead child so a crashed server reads as
    /// stopped instead of lingering forever.
    pub async fn status(&self, project: &str) -> Option<(u16, String)> {
        let mut servers = self.servers.lock().await;
        let app = servers.get_mut(project)?;
        match app.child.try_wait() {
            Ok(None) => Some((app.port, app.command.clone())),
            _ => {
                servers.remove(project);
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspaceServers;

    #[tokio::test]
    async fn rejects_non_directories_and_stays_stopped() {
        let servers = WorkspaceServers::default();
        assert!(servers.status("/nonexistent-xyz").await.is_none());
        let err = servers.start("/nonexistent-xyz", None).await.unwrap_err();
        assert!(err.contains("not a directory"));
        // Unknown projects stop cleanly (idempotent).
        servers.stop("/nonexistent-xyz").await;
        assert!(servers.status("/nonexistent-xyz").await.is_none());
    }

    #[tokio::test]
    async fn serves_then_stops_a_real_directory() {
        let dir = std::env::temp_dir().join("agentdeck-serve-test");
        let _ = tokio::fs::create_dir_all(&dir).await;
        let servers = WorkspaceServers::default();
        let (port, _) = servers
            .start(dir.to_str().unwrap(), None)
            .await
            .expect("static server starts");
        let (seen_port, _) = servers
            .status(dir.to_str().unwrap())
            .await
            .expect("running while alive");
        assert_eq!(port, seen_port);
        servers.stop(dir.to_str().unwrap()).await;
        assert!(servers.status(dir.to_str().unwrap()).await.is_none());
    }
}

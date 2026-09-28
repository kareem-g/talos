//! Browser engine — launch a headless Chromium instance, discover its tabs,
//! and connect CDP clients to each debug target.
//!
//! Chromium is discovered via `$CHROME_PATH` → `google-chrome-stable` →
//! `google-chrome` → `chromium-browser` → `chromium` (first existing binary).
//! Launch is headless, non-sandboxed, with a random debugging port.
//! Tabs are listed by polling `http://localhost:{port}/json/list`.

use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

use crate::Result;

/// Information about a debuggable page / tab.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TabInfo {
    pub id: String,
    pub title: String,
    pub url: String,
    /// The `webSocketDebuggerUrl` the CDP client connects to.
    #[serde(rename = "webSocketDebuggerUrl")]
    pub ws_url: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

/// A running headless Chromium instance.
///
/// Dropping the engine kills the child process and cleans up the user-data-dir
/// — unless a persistent profile was requested (see [`launch`]), in which case
/// the directory is kept so logins and storage survive restarts.
pub struct BrowserEngine {
    child: Option<tokio::process::Child>,
    pub port: u16,
    pub user_data_dir: PathBuf,
    /// CSS viewport the browser was launched with (default 1280x900). The
    /// dashboard mirror and the AI-cursor overlay map coordinates against
    /// this, so it is reported via `/state` and `browser_screenshot`.
    pub viewport: (u32, u32),
    /// When true, [`Drop`] kills Chromium but keeps the user-data-dir.
    pub persistent: bool,
    /// Extra launch flags actually applied (proxy/UA/headful/profile), echoed
    /// in `/state` so the dashboard can show what this engine runs with.
    pub launch_notes: Vec<String>,
}

impl Drop for BrowserEngine {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
        // Persistent profiles survive: cookies, localStorage, and logins stay
        // for the next session. Ephemeral dirs are removed as before.
        // The caller is responsible for ensuring an ephemeral directory is a
        // dedicated temp dir.
        if !self.persistent {
            let _ = std::fs::remove_dir_all(&self.user_data_dir);
        }
    }
}

impl BrowserEngine {
    /// Find a Chromium binary on this system: `$CHROME_PATH`, then a search of
    /// PATH plus the usual install locations.
    pub fn chromium_path() -> Option<PathBuf> {
        if let Ok(path) = std::env::var("CHROME_PATH") {
            if !path.is_empty() {
                let p = PathBuf::from(&path);
                if p.exists() {
                    return Some(p);
                }
            }
        }
        let names = [
            "google-chrome-stable",
            "google-chrome",
            "chromium-browser",
            "chromium",
        ];
        let path_env = std::env::var("PATH").unwrap_or_default();
        let mut dirs: Vec<PathBuf> = path_env
            .split(':')
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .collect();
        dirs.push("/usr/bin".into());
        dirs.push("/usr/local/bin".into());
        dirs.push("/snap/bin".into());
        for dir in &dirs {
            for name in &names {
                let candidate = dir.join(name);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
        None
    }

    /// Launch a Chromium instance on a random port.
    ///
    /// `user_data_dir` should be a freshly-created temp directory; the engine
    /// owns it and deletes it on drop — unless persistence is requested:
    ///
    /// - `AGENTDECK_BROWSER_PROFILE_DIR`: absolute path used as the
    ///   user-data-dir instead (created if missing, **never deleted**), so
    ///   cookies, localStorage, and logins survive daemon restarts. Prefer a
    ///   per-purpose directory; sharing one profile between concurrent
    ///   sessions trips Chromium's profile lock.
    /// - `AGENTDECK_BROWSER_PERSIST=1`: keep the session's own
    ///   `user_data_dir` on exit instead of deleting it (per-session login
    ///   persistence with zero config).
    ///
    /// Stealth / launch tuning (all optional):
    ///
    /// - `AGENTDECK_BROWSER_PROXY`: `--proxy-server=` value
    ///   (e.g. `http://127.0.0.1:8080` or `socks5://host:1080`).
    /// - `AGENTDECK_BROWSER_USER_AGENT`: override the UA string.
    /// - `AGENTDECK_BROWSER_WINDOW_SIZE`: e.g. `1366,768` (default
    ///   `1280,900`). Reported as `viewport` via `/state` so the dashboard
    ///   cursor overlay keeps mapping correctly.
    /// - `AGENTDECK_BROWSER_HEADLESS=0`: run headful (needs a display or
    ///   Xvfb — for watching the real window / extensions that refuse
    ///   headless).
    /// - `AGENTDECK_BROWSER_PROFILE_NAME`: `--profile-directory=` (default
    ///   `Default`); only meaningful with a persistent profile dir.
    /// - Extra Chromium flags: `AGENTDECK_BROWSER_ARGS` (space-separated,
    ///   appended verbatim).
    pub async fn launch(user_data_dir: PathBuf) -> Result<Self> {
        let binary = Self::chromium_path().ok_or_else(|| {
            crate::AgentDeckError::Unknown(
                "No Chromium found. Install google-chrome or chromium-browser, or set CHROME_PATH.".into(),
            )
        })?;

        let (user_data_dir, persistent) = match std::env::var("AGENTDECK_BROWSER_PROFILE_DIR") {
            Ok(dir) if !dir.trim().is_empty() => (PathBuf::from(dir.trim()), true),
            _ if std::env::var("AGENTDECK_BROWSER_PERSIST").as_deref() == Ok("1") => (user_data_dir, true),
            _ => (user_data_dir, false),
        };
        if let Err(e) = std::fs::create_dir_all(&user_data_dir) {
            return Err(crate::AgentDeckError::Unknown(format!(
                "Browser profile dir {}: {e}",
                user_data_dir.display()
            )));
        }

        let viewport = parse_window_size(
            &std::env::var("AGENTDECK_BROWSER_WINDOW_SIZE").unwrap_or_default(),
        );
        let mut notes = Vec::new();
        if persistent {
            notes.push(format!("persistent profile: {}", user_data_dir.display()));
        }

        let port = pick_free_port().await?;
        let mut cmd = Command::new(&binary);
        let headful = std::env::var("AGENTDECK_BROWSER_HEADLESS").as_deref() == Ok("0");
        if !headful {
            cmd.arg("--headless=new");
        } else {
            notes.push("headful (needs a display)".to_string());
        }
        cmd.args([
            &format!("--remote-debugging-port={port}"),
            &format!("--user-data-dir={}", user_data_dir.display()),
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--hide-scrollbars",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--mute-audio",
            "--force-device-scale-factor=1",
            &format!("--window-size={},{}", viewport.0, viewport.1),
            "about:blank",
        ]);
        if let Ok(profile) = std::env::var("AGENTDECK_BROWSER_PROFILE_NAME") {
            if !profile.trim().is_empty() {
                cmd.arg(format!("--profile-directory={}", profile.trim()));
                notes.push(format!("profile: {}", profile.trim()));
            }
        }
        if let Ok(proxy) = std::env::var("AGENTDECK_BROWSER_PROXY") {
            if !proxy.trim().is_empty() {
                cmd.arg(format!("--proxy-server={}", proxy.trim()));
                notes.push("proxy configured".to_string());
            }
        }
        if let Ok(ua) = std::env::var("AGENTDECK_BROWSER_USER_AGENT") {
            if !ua.trim().is_empty() {
                cmd.arg(format!("--user-agent={ua}"));
                notes.push("custom user-agent".to_string());
            }
        }
        if let Ok(extra) = std::env::var("AGENTDECK_BROWSER_ARGS") {
            for flag in extra.split_whitespace() {
                cmd.arg(flag);
            }
            if !extra.trim().is_empty() {
                notes.push("extra chromium flags".to_string());
            }
        }
        // Swallow stdout/stderr — Chromium is chatty and we don't need it.
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());
        cmd.stdin(std::process::Stdio::null());

        let child = cmd.spawn().map_err(|e| {
            crate::AgentDeckError::Unknown(format!("Failed to launch Chromium: {e}"))
        })?;

        // Wait for the debugging API to be ready (poll /json/version).
        let _ = wait_for_browser(&port, Duration::from_secs(15)).await?;

        Ok(Self {
            child: Some(child),
            port,
            user_data_dir,
            viewport,
            persistent,
            launch_notes: notes,
        })
    }

    /// List all debuggable pages/tabs.
    pub async fn list_tabs(&self) -> Result<Vec<TabInfo>> {
        let url = format!("http://127.0.0.1:{}/json/list", self.port);
        let resp = reqwest::get(&url)
            .await
            .map_err(|e| crate::AgentDeckError::Unknown(format!("CDP /json/list: {e}")))?;
        let tabs: Vec<TabInfo> = resp
            .json()
            .await
            .map_err(|e| crate::AgentDeckError::Unknown(format!("CDP parse /json/list: {e}")))?;
        Ok(tabs)
    }

    /// Create a new tab (open a new page) and return its info.
    /// Chromium requires the `PUT` verb for `/json/new`.
    pub async fn new_tab(&self, url: &str) -> Result<TabInfo> {
        let create_url = format!(
            "http://127.0.0.1:{}/json/new?{}",
            self.port,
            percent_encode(url)
        );
        let resp = reqwest::Client::new()
            .put(&create_url)
            .send()
            .await
            .map_err(|e| crate::AgentDeckError::Unknown(format!("CDP /json/new: {e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(crate::AgentDeckError::Unknown(format!(
                "CDP /json/new returned {status}: {text}"
            )));
        }
        let tab: TabInfo = serde_json::from_str(&text)
            .map_err(|e| crate::AgentDeckError::Unknown(format!("CDP parse /json/new: {e}: {text}")))?;
        Ok(tab)
    }

    /// Close a tab by id.
    pub async fn close_tab(&self, id: &str) -> Result<()> {
        let close_url = format!("http://127.0.0.1:{}/json/close/{}", self.port, id);
        let _ = reqwest::get(&close_url).await;
        Ok(())
    }
}

/// Poll `/json/version` until the browser responds, then return the
/// `webSocketDebuggerUrl` (the browser-level WS for `Target` domain).
async fn wait_for_browser(port: &u16, timeout: Duration) -> Result<Option<String>> {
    let start = std::time::Instant::now();
    let url = format!("http://127.0.0.1:{port}/json/version");
    loop {
        if start.elapsed() > timeout {
            return Err(crate::AgentDeckError::Unknown(
                "Chromium did not start in time".into(),
            ));
        }
        match reqwest::get(&url).await {
            Ok(resp) => {
                if let Ok(v) = resp.json::<Value>().await {
                    let ws = v
                        .get("webSocketDebuggerUrl")
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                    return Ok(ws);
                }
            }
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

/// Pick a random free port on loopback. We try a handful of ports in the
/// ephemeral range rather than binding to :0 and reading the port back, because
/// Chromium needs the port passed at startup.
async fn pick_free_port() -> Result<u16> {
    use std::net::TcpListener;
    for _ in 0..20 {
        let port: u16 = rand::random::<u16>().saturating_add(1024).max(1024);
        if TcpListener::bind(format!("127.0.0.1:{port}")).is_ok() {
            return Ok(port);
        }
    }
    Err(crate::AgentDeckError::Unknown(
        "Could not find a free port for Chromium".into(),
    ))
}

/// Parse `AGENTDECK_BROWSER_WINDOW_SIZE` (`"1366,768"` / `"1366x768"`),
/// falling back to the 1280x900 default the dashboard mirror assumes.
fn parse_window_size(raw: &str) -> (u32, u32) {
    let cleaned = raw.trim().replace('x', ",");
    let mut parts = cleaned.split(',');
    let w = parts.next().and_then(|v| v.trim().parse().ok()).unwrap_or(1280);
    let h = parts.next().and_then(|v| v.trim().parse().ok()).unwrap_or(900);
    (w.clamp(320, 7680), h.clamp(200, 4320))
}

/// Minimal percent-encoding for a URL query parameter (just enough for `/json/new`).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
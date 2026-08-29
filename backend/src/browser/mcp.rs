//! The browser MCP server — the control surface agents use to drive the
//! built-in browser.
//!
//! Runs as a stdio MCP server (spawned by the daemon as
//! `agentdeck-backend __browser-mcp`) and exposes the `browser_*` tool set:
//! select/tabs/goto, DOM snapshot + locators, click/type/press, screenshots,
//! an AI-controlled cursor, and read-only asserts.
//!
//! It also:
//! - POSTs `browser_step` / `browser_cursor_*` events back to the daemon so
//!   the dashboard Automation screen mirrors the page and animates a cursor;
//! - runs a tiny HTTP endpoint serving screenshots + state to the dashboard.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use crate::browser::cdp::CdpClient;
use crate::browser::engine::{BrowserEngine, TabInfo};
use crate::browser::snapshot;
use crate::browser::CursorState;
use crate::Result;

// ── Shared state ──────────────────────────────────────────────────────────

pub struct BrowserMcp {
    engine: Mutex<Option<Arc<BrowserEngine>>>,
    /// tab id → (info, cdp client)
    tabs: Mutex<HashMap<String, (TabInfo, CdpClient)>>,
    /// The tab that `browser_tab_get` / `browser_tab_new` last selected; the
    /// "active tab" locator/action calls target when no `tab` is given.
    active_tab_id: Mutex<Option<String>>,
    /// Cached flat DOM snapshot per tab (locator ground truth). Stale after a
    /// short TTL, so repeated `get_by_*` calls don't re-walk the whole DOM.
    snapshot_cache: Mutex<HashMap<String, (Instant, Value)>>,
    cursor: Mutex<CursorState>,
    /// Stable ids so a `browser_step` completion can update its running part.
    next_step: AtomicU64,
    http_port: u16,
    screenshot_dir: PathBuf,
    daemon_url: String,
    daemon_token: String,
    session_id: String,
    daemon: reqwest::Client,
}

/// How long a cached locator snapshot stays fresh before the next search
/// re-walks the DOM. Mirrors control-browser's "reuse the snapshot until the
/// page changes" rule — short enough to stay correct, long enough to make
/// locator searches cheap.
const SNAPSHOT_TTL: Duration = Duration::from_millis(1500);

impl BrowserMcp {
    fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            tabs: Mutex::new(HashMap::new()),
            active_tab_id: Mutex::new(None),
            snapshot_cache: Mutex::new(HashMap::new()),
            cursor: Mutex::new(CursorState::default()),
            next_step: AtomicU64::new(0),
            http_port: std::env::var("AGENTDECK_BROWSER_HTTP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(0),
            screenshot_dir: std::env::var("AGENTDECK_BROWSER_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| std::env::temp_dir().join("agentdeck-browser")),
            daemon_url: std::env::var("AGENTDECK_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:9120".to_string()),
            daemon_token: std::env::var("AGENTDECK_TOKEN").unwrap_or_default(),
            session_id: std::env::var("AGENTDECK_SESSION").unwrap_or_default(),
            daemon: reqwest::Client::new(),
        }
    }

    /// Relay a browser event to the daemon (broadcast to the dashboard WS).
    async fn emit(&self, kind: &str, payload: Value) {
        let url = format!(
            "{}/api/browser/event?token={}&session_id={}",
            self.daemon_url,
            self.daemon_token,
            urlencode(&self.session_id)
        );
        let body = json!({ "kind": kind, "payload": payload });
        let _ = self.daemon.post(&url).json(&body).send().await;
    }

    /// Emit the "running" half of a timeline `browser_step` and return its id
    /// so the caller can complete it. The dashboard reducer upserts by `id`,
    /// so the completion must reuse this id to update (not duplicate) the part.
    async fn emit_step_start(&self, action: &str, target: &str) -> String {
        let id = format!("browser-{}", self.next_step.fetch_add(1, Ordering::Relaxed));
        self.emit(
            "browser_step",
            json!({
                "id": id,
                "action": action,
                "target": target,
                "status": "running",
                "detail": "",
            }),
        )
        .await;
        id
    }

    /// Complete a started step: `ok` or `failed`, with a human-readable detail.
    async fn emit_step_end(&self, id: &str, status: &str, detail: &str) {
        self.emit(
            "browser_step",
            json!({
                "id": id,
                "action": "",
                "target": "",
                "status": status,
                "detail": detail,
            }),
        )
        .await;
    }

    async fn set_cursor(&self, x: i32, y: i32, pressed: bool, button: &str) {
        let mut cursor = self.cursor.lock().await;
        let prev = cursor.clone();
        cursor.x = x;
        cursor.y = y;
        cursor.pressed = pressed;
        cursor.button = button.to_string();
        let event = if prev.pressed != pressed || prev.x != x || prev.y != y {
            "browser_cursor_moved"
        } else {
            "browser_cursor_moved"
        };
        drop(cursor);
        let _ = self
            .emit(
                event,
                json!({ "x": x, "y": y, "button": button, "pressed": pressed }),
            )
            .await;
    }

    /// Resolve a snapshot path to coordinates (from the page's live DOM).
    async fn coords_for_path(&self, client: &CdpClient, path: &str) -> Option<(i32, i32)> {
        snapshot::resolve_path(client, path).await.ok().flatten()
    }

    async fn ensure_tab(&self, tab_id: &str) -> Result<(TabInfo, CdpClient)> {
        let tabs = self.tabs.lock().await;
        tabs.get(tab_id)
            .cloned()
            .ok_or_else(|| crate::AgentDeckError::Unknown(format!("Unknown tab: {tab_id}")))
    }

    async fn active_tab(&self) -> Result<(TabInfo, CdpClient)> {
        let tabs = self.tabs.lock().await;
        let active = self.active_tab_id.lock().await;
        let selected = active
            .as_ref()
            .and_then(|id| tabs.get(id))
            .or_else(|| tabs.iter().next().map(|(_, v)| v));
        let Some((info, client)) = selected else {
            return Err(crate::AgentDeckError::Unknown(
                "No browser tab. Use browser_tab_new to open one.".into(),
            ));
        };
        Ok((info.clone(), client.clone()))
    }

    /// Invalidate the cached locator snapshot for a tab (navigation, tab close).
    async fn invalidate_snapshot(&self, tab_id: &str) {
        self.snapshot_cache.lock().await.remove(tab_id);
    }

    /// Return a fresh-enough DOM snapshot for locator searches. The snapshot
    /// walker is the expensive part of `get_by_*`; caching it for a short TTL
    /// keeps repeated searches fast without going stale.
    async fn snapshot_for_locators(&self, client: &CdpClient, tab_id: &str) -> Result<Value> {
        {
            let cache = self.snapshot_cache.lock().await;
            if let Some((at, snap)) = cache.get(tab_id) {
                if at.elapsed() < SNAPSHOT_TTL && snap.get("nodes").is_some() {
                    return Ok(snap.clone());
                }
            }
        }
        let snap = snapshot::dom_snapshot(client).await?;
        self.snapshot_cache
            .lock()
            .await
            .insert(tab_id.to_string(), (Instant::now(), snap.clone()));
        Ok(snap)
    }

    /// Wait for the page to reach a load state (`interactive` =
    /// domcontentloaded, `complete` = load) by polling `document.readyState`.
    /// Bounded by `timeout`; returns Ok even if the page never settles so a
    /// slow page doesn't fail the navigation that started it.
    async fn wait_for_load_state(&self, client: &CdpClient, state: &str, timeout: Duration) -> Result<Value> {
        let target = match state {
            "domcontentloaded" | "interactive" => "interactive",
            "complete" | "load" => "complete",
            other => {
                return Err(crate::AgentDeckError::Unknown(format!(
                    "Unknown load state: {other} (use \"load\" or \"domcontentloaded\")"
                )));
            }
        };
        let start = Instant::now();
        loop {
            let ready = client.evaluate("document.readyState").await.unwrap_or_default();
            if ready.as_str() == Some(target) || ready.as_str() == Some("complete") {
                return Ok(ready);
            }
            if start.elapsed() > timeout {
                return Ok(ready);
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }
}

// ── Tool implementations ───────────────────────────────────────────────────

impl BrowserMcp {
    async fn tool_select(&self, args: Value) -> Result<Value> {
        let backend = args
            .get("backend")
            .and_then(Value::as_str)
            .unwrap_or("cdp")
            .to_string();
        if backend != "cdp" {
            return Ok(json!({
                "ok": false,
                "error": format!("backend \"{backend}\" is not available; use \"cdp\""),
            }));
        }
        let mut engine = self.engine.lock().await;
        if engine.is_none() {
            std::fs::create_dir_all(&self.screenshot_dir)?;
            let engine_arc = Arc::new(BrowserEngine::launch(self.screenshot_dir.join("chromium")).await?);
            *engine = Some(engine_arc);
        }
        let tabs = self.tabs.lock().await;
        let list: Vec<Value> = tabs.values().map(|(t, _)| json!({ "id": t.id, "title": t.title, "url": t.url })).collect();
        drop(tabs);
        Ok(json!({ "ok": true, "engine": "cdp", "tabs": list }))
    }

    async fn tool_tabs_list(&self) -> Result<Value> {
        let tabs = self.tabs.lock().await;
        let list: Vec<Value> = tabs.values().map(|(t, _)| json!({ "id": t.id, "title": t.title, "url": t.url })).collect();
        Ok(json!({ "tabs": list }))
    }

    async fn tool_tab_new(&self, args: Value) -> Result<Value> {
        let url = args.get("url").and_then(Value::as_str).unwrap_or("about:blank").to_string();
        let engine = self.engine.lock().await.clone().ok_or_else(|| {
            crate::AgentDeckError::Unknown("No browser. Call browser_select {backend:\"cdp\"} first.".into())
        })?;
        // Open a blank tab, then navigate via CDP — Page.navigate handles
        // data:/file: URLs that a query-encoded /json/new would mangle.
        let tab = engine.new_tab("about:blank").await?;
        let client = CdpClient::connect(&tab.ws_url).await?;
        // Basic capabilities: DOM + Page + Runtime.
        let _ = client.call("Page.enable", json!({})).await;
        let _ = client.call("Runtime.enable", json!({})).await;
        if url != "about:blank" {
            let _ = client.call("Page.navigate", json!({ "url": url })).await;
            // Wait for the real load instead of a fixed sleep, so fast pages
            // don't pay a flat latency tax and slow pages don't get captured
            // half-loaded. Capture right after so the dashboard mirror shows
            // the loaded site even if the agent never calls browser_screenshot.
            let _ = self.wait_for_load_state(&client, "load", Duration::from_secs(30)).await;
            let _ = self.capture_screenshot(&tab.id, &client).await;
        }
        *self.active_tab_id.lock().await = Some(tab.id.clone());
        self.tabs.lock().await.insert(tab.id.clone(), (tab.clone(), client));
        let step = self.emit_step_start("goto", &url).await;
        self.emit_step_end(&step, "ok", "Opened tab").await;
        Ok(json!({ "ok": true, "id": tab.id, "title": tab.title, "url": tab.url }))
    }

    async fn tool_tab_close(&self, args: Value) -> Result<Value> {
        let id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let engine = self.engine.lock().await.clone();
        if let Some(engine) = engine {
            let _ = engine.close_tab(&id).await;
        }
        self.tabs.lock().await.remove(&id);
        self.invalidate_snapshot(&id).await;
        let mut active = self.active_tab_id.lock().await;
        if active.as_deref() == Some(&id) {
            *active = None;
        }
        Ok(json!({ "ok": true }))
    }

    /// Return a tab's info and make it the active tab (what no-`tab` actions
    /// target). Parity with control-browser's `browser.tabs.get(id)`.
    async fn tool_tab_get(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let (info, _client) = self.ensure_tab(&tab_id).await?;
        *self.active_tab_id.lock().await = Some(info.id.clone());
        Ok(json!({ "ok": true, "id": info.id, "title": info.title, "url": info.url }))
    }

    async fn tool_goto(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let url = args.get("url").and_then(Value::as_str).unwrap_or("").to_string();
        let (info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let step = self.emit_step_start("goto", &url).await;
        let result = client.call("Page.navigate", json!({ "url": url })).await?;
        // Wait for the real load, then capture so the dashboard mirror shows
        // the loaded site immediately — no fixed sleep, no broken image icon.
        let _ = self.wait_for_load_state(&client, "load", Duration::from_secs(30)).await;
        self.invalidate_snapshot(&info.id).await;
        let _ = self.capture_screenshot(&info.id, &client).await;
        *self.active_tab_id.lock().await = Some(info.id.clone());
        self.emit_step_end(&step, "ok", &format!("Navigated to {url}")).await;
        Ok(json!({ "ok": true, "result": result }))
    }

    async fn tool_dom_snapshot(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let (info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let snap = snapshot::snapshot_for_tool(&client).await?;
        // Seed the locator cache so the next get_by_* doesn't re-walk the DOM.
        self.snapshot_cache
            .lock()
            .await
            .insert(info.id, (Instant::now(), snap.get("snapshot").cloned().unwrap_or_default()));
        Ok(json!({ "ok": true, "snapshot": snap }))
    }

    /// Shared locator search: returns matching nodes from a fresh-enough
    /// snapshot (cached for a short TTL — see `snapshot_for_locators`).
    async fn find_nodes(
        &self,
        tab_id: &str,
        role: Option<&str>,
        name: Option<&str>,
        testid: Option<&str>,
    ) -> Result<Vec<Value>> {
        let (info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(tab_id).await?
        };
        let snap = self.snapshot_for_locators(&client, &info.id).await?;
        let nodes = snapshot::nodes_array(&snap);
        let name_lc = name.map(str::to_lowercase);
        let testid_lc = testid.map(str::to_lowercase);
        let mut out = Vec::new();
        for node in &nodes {
            let nrole = node.get("role").and_then(Value::as_str).unwrap_or("");
            if let Some(role) = role {
                if !nrole.eq_ignore_ascii_case(role) {
                    continue;
                }
            }
            let nname = node.get("name").and_then(Value::as_str).unwrap_or("");
            if let Some(nl) = &name_lc {
                if !nname.to_lowercase().contains(nl.as_str()) {
                    continue;
                }
            }
            // data-testid isn't part of the a11y snapshot; also probe via a
            // separate DOM query below.
            out.push(node.clone());
        }
        // If filtering by test id, run a direct DOM query for data-testid.
        if testid.is_some() && out.is_empty() {
            let expr = format!(
                "(() => {{ const els = [...document.querySelectorAll('[data-testid]')].filter(e => (e.getAttribute('data-testid')||'').toLowerCase().includes({})); return els.map(e => {{ const r = e.getBoundingClientRect(); return {{ path: 'testid', name: e.getAttribute('data-testid'), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }}; }}); }})()",
                json!(testid_lc.unwrap_or_default())
            );
            if let Ok(value) = client.evaluate(&expr).await {
                if let Some(arr) = value.as_array() {
                    for hit in arr {
                        let x = hit.get("x").and_then(Value::as_i64).unwrap_or(0) as i32;
                        let y = hit.get("y").and_then(Value::as_i64).unwrap_or(0) as i32;
                        let name = hit.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                        out.push(json!({ "path": format!("coord:{x}:{y}"), "role": "generic", "name": name }));
                    }
                }
            }
        }
        Ok(out)
    }

    async fn tool_get_by(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let role = args.get("role").and_then(Value::as_str);
        // The five locator tools all funnel into one search; each sends its
        // filter under a different key: get_by_role sends `role`+`name`,
        // get_by_text sends `text`, get_by_label sends `label`, and
        // get_by_placeholder sends `name` (the placeholder becomes the
        // accessible name of the input). All name-ish filters match the
        // accessible name substring.
        let name = args
            .get("name")
            .or_else(|| args.get("text"))
            .or_else(|| args.get("label"))
            .and_then(Value::as_str);
        let testid = args.get("test_id").and_then(Value::as_str);
        let matches = self.find_nodes(&tab_id, role, name, testid).await?;
        Ok(json!({ "ok": true, "count": matches.len(), "matches": matches }))
    }

    async fn tool_count(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let role = args.get("role").and_then(Value::as_str);
        let name = args.get("name").and_then(Value::as_str);
        let matches = self.find_nodes(&tab_id, role, name, None).await?;
        Ok(json!({ "ok": true, "count": matches.len() }))
    }

    /// Resolve a `path` (snapshot path or `coord:x:y`) to page coordinates.
    async fn resolve_target(&self, client: &CdpClient, path: &str) -> Result<(i32, i32)> {
        if let Some(coords) = path.strip_prefix("coord:") {
            let mut parts = coords.split(':');
            let x = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let y = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            return Ok((x, y));
        }
        self.coords_for_path(client, path)
            .await
            .ok_or_else(|| crate::AgentDeckError::Unknown(format!("Element not found or not visible: {path}")))
    }

    async fn dispatch_click(&self, client: &CdpClient, x: i32, y: i32, button: &str, double: bool) -> Result<()> {
        let click_count = if double { 2 } else { 1 };
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mousePressed",
                    "x": x, "y": y, "button": button, "clickCount": click_count,
                }),
            )
            .await?;
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mouseReleased",
                    "x": x, "y": y, "button": button, "clickCount": click_count,
                }),
            )
            .await?;
        self.set_cursor(x, y, false, button).await;
        Ok(())
    }

    async fn tool_click(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let path = args.get("path").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let step = self.emit_step_start("click", &format!("path: {path}")).await;
        let (x, y) = self.resolve_target(&client, &path).await?;
        self.set_cursor(x, y, true, "left").await;
        self.dispatch_click(&client, x, y, "left", false).await?;
        self.emit_step_end(&step, "ok", &format!("Clicked {path} at ({x},{y})")).await;
        Ok(json!({ "ok": true, "x": x, "y": y }))
    }

    async fn tool_type(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let path = args.get("path").and_then(Value::as_str).unwrap_or("").to_string();
        let text = args.get("text").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let step = self.emit_step_start("type", &format!("path: {path}")).await;
        if !path.is_empty() {
            let (x, y) = self.resolve_target(&client, &path).await?;
            self.dispatch_click(&client, x, y, "left", false).await?;
        }
        client.call("Input.insertText", json!({ "text": text })).await?;
        self.emit_step_end(&step, "ok", &format!("Typed {} chars", text.chars().count())).await;
        Ok(json!({ "ok": true }))
    }

    async fn tool_press(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let path = args.get("path").and_then(Value::as_str).unwrap_or("").to_string();
        let keys = args.get("keys").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        if !path.is_empty() {
            let (x, y) = self.resolve_target(&client, &path).await?;
            self.dispatch_click(&client, x, y, "left", false).await?;
        }
        dispatch_keys(&client, &keys).await?;
        Ok(json!({ "ok": true }))
    }

    async fn tool_check(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let path = args.get("path").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let (x, y) = self.resolve_target(&client, &path).await?;
        self.dispatch_click(&client, x, y, "left", false).await?;
        Ok(json!({ "ok": true }))
    }

    async fn tool_screenshot(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let (info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let step = self.emit_step_start("screenshot", "page").await;
        let Some((path, base64_data)) = self.capture_screenshot(&info.id, &client).await else {
            self.emit_step_end(&step, "failed", "Screenshot returned no data").await;
            return Ok(json!({ "ok": false, "error": "Screenshot returned no data" }));
        };
        self.emit_step_end(&step, "ok", "Captured screenshot").await;
        Ok(json!({
            "ok": true,
            "tab": tab_id,
            "path": path.to_string_lossy().to_string(),
            "data": base64_data,
            "width": 1280,
            "height": 900,
        }))
    }

    /// Capture the current page state of `client` into `{tab_id}.png` — the
    /// file the dashboard mirror serves — and return the file plus the raw
    /// PNG as base64 for the tool result. Best-effort: the mirror must never
    /// block an agent step because a capture failed.
    async fn capture_screenshot(&self, tab_id: &str, client: &CdpClient) -> Option<(std::path::PathBuf, String)> {
        let result = client
            .call("Page.captureScreenshot", json!({ "format": "png", "fromSurface": true }))
            .await
            .ok()?;
        let base64_data = result.get("data").and_then(Value::as_str).unwrap_or("").to_string();
        if base64_data.is_empty() {
            return None;
        }
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&base64_data).ok()?;
        let safe_id = tab_id.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
        let file = self.screenshot_dir.join(format!("{safe_id}.png"));
        std::fs::write(&file, &bytes).ok()?;
        Some((file, base64_data))
    }

    async fn tool_wait_for(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let role = args.get("role").and_then(Value::as_str);
        let name = args.get("name").and_then(Value::as_str);
        let state = args.get("state").and_then(Value::as_str).unwrap_or("visible");
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        for _ in 0..50 {
            let snap = snapshot::dom_snapshot(&client).await?;
            let nodes = snapshot::nodes_array(&snap);
            let hit = nodes.iter().any(|node| {
                let nrole = node.get("role").and_then(Value::as_str).unwrap_or("");
                let nname = node.get("name").and_then(Value::as_str).unwrap_or("");
                role.map(|r| nrole.eq_ignore_ascii_case(r)).unwrap_or(true)
                    && name.map(|n| nname.contains(n)).unwrap_or(true)
            });
            if hit && state == "visible" {
                return Ok(json!({ "ok": true, "state": "visible" }));
            }
            if !hit && state == "hidden" {
                return Ok(json!({ "ok": true, "state": "hidden" }));
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        Ok(json!({ "ok": false, "error": format!("Timed out waiting for {state}: {role:?} {name:?}") }))
    }

    async fn tool_wait_for_url(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let url = args.get("url").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        for _ in 0..50 {
            let current = client.evaluate("location.href").await.unwrap_or_default();
            let current = current.as_str().unwrap_or("");
            if current.contains(&url) {
                return Ok(json!({ "ok": true, "url": current }));
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        Ok(json!({ "ok": false, "error": format!("Timed out waiting for URL containing {url}") }))
    }

    async fn tool_assert(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let expression = args.get("expression").and_then(Value::as_str).unwrap_or("").to_string();
        let expected = args.get("expected").cloned().unwrap_or(Value::Null);
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let step = self.emit_step_start("assert", &expression).await;
        let actual = client.evaluate(&expression).await?;
        let pass = match (&expected, &actual) {
            (Value::String(e), Value::String(a)) => a.contains(e) || a == e,
            _ => expected == actual,
        };
        self.emit_step_end(&step, if pass { "ok" } else { "failed" }, &format!("Assert {}: {expression}", if pass { "PASS" } else { "FAIL" })).await;
        Ok(json!({ "ok": true, "pass": pass, "expected": expected, "actual": actual }))
    }

    /// Read-only JS evaluation — parity with control-browser's
    /// `tab.playwright.evaluate`. Returns the evaluated value.
    async fn tool_evaluate(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let expression = args.get("expression").and_then(Value::as_str).unwrap_or("").to_string();
        let (_, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let step = self.emit_step_start("evaluate", &expression).await;
        let value = client.evaluate(&expression).await?;
        self.emit_step_end(&step, "ok", &format!("Evaluated {expression}")).await;
        Ok(json!({ "ok": true, "result": value }))
    }

    /// Wait for a page load state (`load` / `domcontentloaded`) — parity with
    /// `waitForLoadState`.
    async fn tool_wait_for_load_state(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let state = args.get("state").and_then(Value::as_str).unwrap_or("load").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let ready = self.wait_for_load_state(&client, &state, Duration::from_secs(30)).await?;
        Ok(json!({ "ok": true, "state": ready }))
    }

    // ── Cursor (computer-use) ──────────────────────────────────────────────

    async fn tool_cursor_move(&self, args: Value) -> Result<Value> {
        let x = args.get("x").and_then(Value::as_i64).unwrap_or(0) as i32;
        let y = args.get("y").and_then(Value::as_i64).unwrap_or(0) as i32;
        self.set_cursor(x, y, false, "left").await;
        Ok(json!({ "ok": true, "x": x, "y": y }))
    }

    /// Move the cursor by a relative offset from its current position.
    async fn tool_cursor_move_by(&self, args: Value) -> Result<Value> {
        let dx = args.get("dx").and_then(Value::as_i64).unwrap_or(0) as i32;
        let dy = args.get("dy").and_then(Value::as_i64).unwrap_or(0) as i32;
        let cursor = self.cursor.lock().await;
        let (nx, ny) = (cursor.x + dx, cursor.y + dy);
        drop(cursor);
        self.set_cursor(nx, ny, false, "left").await;
        Ok(json!({ "ok": true, "x": nx, "y": ny }))
    }

    /// Double-click with the visible cursor at the given position (or the
    /// current cursor position when omitted).
    async fn tool_cursor_double_click(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let x = args.get("x").and_then(Value::as_i64).map(|v| v as i32);
        let y = args.get("y").and_then(Value::as_i64).map(|v| v as i32);
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let (x, y) = if let (Some(x), Some(y)) = (x, y) {
            (x, y)
        } else {
            let cursor = self.cursor.lock().await;
            (cursor.x, cursor.y)
        };
        self.set_cursor(x, y, true, "left").await;
        self.dispatch_click(&client, x, y, "left", true).await?;
        let _ = self.emit("browser_cursor_clicked", json!({ "x": x, "y": y, "button": "left" })).await;
        Ok(json!({ "ok": true, "x": x, "y": y }))
    }

    /// Drag with the visible cursor from one point to another (press, glide,
    /// release) — parity with control-browser's `cua.drag`.
    async fn tool_cursor_drag(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let from = args.get("from").cloned().unwrap_or_default();
        let to = args.get("to").cloned().unwrap_or_default();
        let (fx, fy) = (from.get("x").and_then(Value::as_i64).unwrap_or(0) as i32, from.get("y").and_then(Value::as_i64).unwrap_or(0) as i32);
        let (tx, ty) = (to.get("x").and_then(Value::as_i64).unwrap_or(0) as i32, to.get("y").and_then(Value::as_i64).unwrap_or(0) as i32);
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        self.set_cursor(fx, fy, true, "left").await;
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({ "type": "mousePressed", "x": fx, "y": fy, "button": "left", "clickCount": 1 }),
            )
            .await?;
        // Glide in steps so the user sees the pointer travel the path.
        const STEPS: i32 = 12;
        for i in 1..=STEPS {
            let x = fx + (tx - fx) * i / STEPS;
            let y = fy + (ty - fy) * i / STEPS;
            client
                .call(
                    "Input.dispatchMouseEvent",
                    json!({ "type": "mouseMoved", "x": x, "y": y, "button": "left", "buttons": 1 }),
                )
                .await?;
            self.set_cursor(x, y, true, "left").await;
            tokio::time::sleep(Duration::from_millis(12)).await;
        }
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({ "type": "mouseReleased", "x": tx, "y": ty, "button": "left", "clickCount": 1 }),
            )
            .await?;
        self.set_cursor(tx, ty, false, "left").await;
        let _ = self.emit("browser_cursor_clicked", json!({ "x": tx, "y": ty, "button": "left" })).await;
        Ok(json!({ "ok": true, "from": { "x": fx, "y": fy }, "to": { "x": tx, "y": ty } }))
    }

    async fn tool_cursor_move_to(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let path = args.get("path").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let (x, y) = self.resolve_target(&client, &path).await?;
        self.set_cursor(x, y, false, "left").await;
        Ok(json!({ "ok": true, "x": x, "y": y }))
    }

    async fn tool_cursor_click(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let x = args.get("x").and_then(Value::as_i64).map(|v| v as i32);
        let y = args.get("y").and_then(Value::as_i64).map(|v| v as i32);
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        let (x, y) = if let (Some(x), Some(y)) = (x, y) {
            (x, y)
        } else {
            let cursor = self.cursor.lock().await;
            (cursor.x, cursor.y)
        };
        self.set_cursor(x, y, true, "left").await;
        self.dispatch_click(&client, x, y, "left", false).await?;
        let _ = self.emit("browser_cursor_clicked", json!({ "x": x, "y": y, "button": "left" })).await;
        Ok(json!({ "ok": true, "x": x, "y": y }))
    }

    async fn tool_cursor_type(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let text = args.get("text").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        client.call("Input.insertText", json!({ "text": text })).await?;
        Ok(json!({ "ok": true }))
    }

    async fn tool_cursor_keypress(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let keys = args.get("keys").and_then(Value::as_str).unwrap_or("").to_string();
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        dispatch_keys(&client, &keys).await?;
        Ok(json!({ "ok": true }))
    }

    async fn tool_cua_scroll(&self, args: Value) -> Result<Value> {
        let tab_id = args.get("tab").and_then(Value::as_str).unwrap_or("").to_string();
        let x = args.get("x").and_then(Value::as_i64).unwrap_or(0) as i32;
        let y = args.get("y").and_then(Value::as_i64).unwrap_or(0) as i32;
        let scroll_x = args.get("scrollX").and_then(Value::as_i64).unwrap_or(0) as f64;
        let scroll_y = args.get("scrollY").and_then(Value::as_i64).unwrap_or(0) as f64;
        let (_info, client) = if tab_id.is_empty() {
            self.active_tab().await?
        } else {
            self.ensure_tab(&tab_id).await?
        };
        client
            .call(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mouseWheel", "x": x, "y": y, "deltaX": scroll_x, "deltaY": scroll_y,
                }),
            )
            .await?;
        Ok(json!({ "ok": true }))
    }

    /// Current state for the dashboard: tabs, cursor, latest screenshot path.
    async fn http_state(&self) -> Value {
        let engine_port = self.engine.lock().await.as_ref().map(|e| e.port).unwrap_or(0);
        let tabs = self.tabs.lock().await;
        let list: Vec<Value> = tabs
            .values()
            .map(|(t, _)| json!({ "id": t.id, "title": t.title, "url": t.url }))
            .collect();
        let cursor = self.cursor.lock().await.clone();
        json!({
            "ok": true,
            "engine_port": engine_port,
            "tabs": list,
            "cursor": cursor,
            "session_id": self.session_id,
        })
    }

    /// Serve the latest screenshot for a tab (as PNG bytes).
    async fn http_screenshot(&self, tab_id: &str) -> Option<Vec<u8>> {
        let safe = tab_id.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
        let file = self.screenshot_dir.join(format!("{safe}.png"));
        std::fs::read(&file).ok()
    }
}

// ── CDP key dispatch ───────────────────────────────────────────────────────

/// Key codes for special keys pressed via `browser_press` / `cursor_keypress`.
fn special_key(keys: &str) -> Option<(&'static str, &'static str, i32)> {
    // (key, code, windowsVirtualKeyCode)
    Some(match keys {
        "Enter" => ("Enter", "Enter", 13),
        "Tab" => ("Tab", "Tab", 9),
        "Escape" | "Esc" => ("Escape", "Escape", 27),
        "Backspace" => ("Backspace", "Backspace", 8),
        "ArrowUp" | "Up" => ("ArrowUp", "ArrowUp", 38),
        "ArrowDown" | "Down" => ("ArrowDown", "ArrowDown", 40),
        "ArrowLeft" | "Left" => ("ArrowLeft", "ArrowLeft", 37),
        "ArrowRight" | "Right" => ("ArrowRight", "ArrowRight", 39),
        "Home" => ("Home", "Home", 36),
        "End" => ("End", "End", 35),
        "Delete" | "Del" => ("Delete", "Delete", 46),
        "PageUp" => ("PageUp", "PageUp", 33),
        "PageDown" => ("PageDown", "PageDown", 34),
        "Meta+a" | "Control+a" | "Cmd+a" => ("a", "KeyA", 65),
        "Meta+c" | "Control+c" => ("c", "KeyC", 67),
        "Meta+v" | "Control+v" => ("v", "KeyV", 86),
        _ => return None,
    })
}

async fn dispatch_keys(client: &CdpClient, keys: &str) -> Result<()> {
    let chord = keys.starts_with("Meta+") || keys.starts_with("Control+") || keys.starts_with("Cmd+");
    if let Some((key, code, vk)) = special_key(keys.trim()) {
        let modifiers = if chord { 2 } else { 0 }; // Control
        let params = json!({
            "type": "keyDown", "key": key, "code": code,
            "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": modifiers,
        });
        client.call("Input.dispatchKeyEvent", params).await?;
        client
            .call(
                "Input.dispatchKeyEvent",
                json!({ "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": modifiers }),
            )
            .await?;
        return Ok(());
    }
    // Printable: one "char" event per character (or one insertText for the lot).
    if keys.chars().all(|c| !c.is_control()) {
        client.call("Input.insertText", json!({ "text": keys })).await?;
    }
    Ok(())
}

// ── MCP stdio server ───────────────────────────────────────────────────────

fn browser_tools() -> Vec<(&'static str, &'static str, Value)> {
    vec![
    (
        "browser_select",
        "Select the browser engine. backend must be \"cdp\" (headless Chromium owned by this session). Returns open tabs.",
        json!({
            "type": "object",
            "properties": { "backend": { "type": "string", "enum": ["cdp"], "description": "cdp = headless Chromium" } },
        }),
    ),
    (
        "browser_tabs_list",
        "List the browser's open tabs.",
        json!({ "type": "object", "properties": {} }),
    ),
    (
        "browser_tab_new",
        "Open a new tab at a URL.",
        json!({
            "type": "object",
            "properties": { "url": { "type": "string", "description": "URL to open (default about:blank)" } },
        }),
    ),
    (
        "browser_tab_close",
        "Close a tab by id.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string", "description": "Tab id" } },
            "required": ["tab"],
        }),
    ),
    (
        "browser_tab_get",
        "Get a tab's info and make it the active tab (the one no-`tab` actions target).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string", "description": "Tab id" } },
            "required": ["tab"],
        }),
    ),
    (
        "browser_goto",
        "Navigate the tab to a URL.",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string", "description": "Tab id (omit to use the active tab)" },
                "url": { "type": "string" },
            },
            "required": ["url"],
        }),
    ),
    (
        "browser_dom_snapshot",
        "Read the page as a compact accessibility tree (roles, accessible names, states). This is your locator ground truth — build locators only from facts in it.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" } },
        }),
    ),
    (
        "browser_get_by_role",
        "Find elements by ARIA role (optionally matching a name substring). Returns snapshot paths for click/type.",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string" },
                "role": { "type": "string", "description": "e.g. button, link, textbox, heading" },
                "name": { "type": "string", "description": "Substring of the accessible name" },
            },
            "required": ["role"],
        }),
    ),
    (
        "browser_get_by_text",
        "Find elements whose accessible name contains the given text.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "text": { "type": "string" } },
            "required": ["text"],
        }),
    ),
    (
        "browser_get_by_placeholder",
        "Find inputs by placeholder text.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "name": { "type": "string" } },
            "required": ["name"],
        }),
    ),
    (
        "browser_get_by_test_id",
        "Find elements by data-testid attribute (substring).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "test_id": { "type": "string" } },
            "required": ["test_id"],
        }),
    ),
    (
        "browser_count",
        "Count elements matching a role and/or name.",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string" },
                "role": { "type": "string" },
                "name": { "type": "string" },
            },
        }),
    ),
    (
        "browser_click",
        "Click an element by snapshot path (or coord:x:y).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "path": { "type": "string" } },
            "required": ["path"],
        }),
    ),
    (
        "browser_type",
        "Type text into an element (by snapshot path).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "path": { "type": "string" }, "text": { "type": "string" } },
            "required": ["text"],
        }),
    ),
    (
        "browser_press",
        "Press keys (Enter, Tab, Escape, ArrowDown, Meta+a, …) — optionally focusing an element by path first.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "path": { "type": "string" }, "keys": { "type": "string" } },
            "required": ["keys"],
        }),
    ),
    (
        "browser_check",
        "Check/click a checkbox by snapshot path.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "path": { "type": "string" } },
            "required": ["path"],
        }),
    ),
    (
        "browser_screenshot",
        "Capture a screenshot of the tab. Returns PNG bytes (shown in the Automation screen).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" } },
        }),
    ),
    (
        "browser_wait_for",
        "Wait for an element by role+name to become visible (or hidden).",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string" },
                "role": { "type": "string" },
                "name": { "type": "string" },
                "state": { "type": "string", "enum": ["visible", "hidden"] },
            },
        }),
    ),
    (
        "browser_wait_for_url",
        "Wait until the tab URL contains the given string.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "url": { "type": "string" } },
            "required": ["url"],
        }),
    ),
    (
        "browser_wait_for_load_state",
        "Wait for the page to reach a load state: \"load\" (readyState complete) or \"domcontentloaded\".",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string" },
                "state": { "type": "string", "enum": ["load", "domcontentloaded"], "description": "Default \"load\"" },
            },
        }),
    ),
    (
        "browser_assert",
        "Run a read-only JS expression and compare to expected (pass/fail for test logs).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "expression": { "type": "string" }, "expected": {} },
            "required": ["expression"],
        }),
    ),
    (
        "browser_evaluate",
        "Run a read-only JS expression and return its value.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "expression": { "type": "string" } },
            "required": ["expression"],
        }),
    ),
    (
        "browser_cursor_move",
        "Move the visible AI cursor to page coordinates.",
        json!({
            "type": "object",
            "properties": { "x": { "type": "integer" }, "y": { "type": "integer" } },
            "required": ["x", "y"],
        }),
    ),
    (
        "browser_cursor_move_by",
        "Move the visible AI cursor by a relative offset from its current position.",
        json!({
            "type": "object",
            "properties": { "dx": { "type": "integer" }, "dy": { "type": "integer" } },
            "required": ["dx", "dy"],
        }),
    ),
    (
        "browser_cursor_move_to",
        "Move the visible AI cursor onto a snapshot-proven element (by path).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "path": { "type": "string" } },
            "required": ["path"],
        }),
    ),
    (
        "browser_cursor_click",
        "Click with the visible AI cursor at current position (or given coordinates).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "x": { "type": "integer" }, "y": { "type": "integer" } },
        }),
    ),
    (
        "browser_cursor_double_click",
        "Double-click with the visible AI cursor at current position (or given coordinates).",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "x": { "type": "integer" }, "y": { "type": "integer" } },
        }),
    ),
    (
        "browser_cursor_drag",
        "Drag with the visible AI cursor from one point to another (press, glide, release).",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string" },
                "from": { "type": "object", "properties": { "x": { "type": "integer" }, "y": { "type": "integer" } } },
                "to": { "type": "object", "properties": { "x": { "type": "integer" }, "y": { "type": "integer" } } },
            },
            "required": ["from", "to"],
        }),
    ),
    (
        "browser_cursor_type",
        "Type text at the cursor position.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "text": { "type": "string" } },
            "required": ["text"],
        }),
    ),
    (
        "browser_cursor_keypress",
        "Press special keys (Enter, Tab, Meta+a, …) at the cursor position.",
        json!({
            "type": "object",
            "properties": { "tab": { "type": "string" }, "keys": { "type": "string" } },
            "required": ["keys"],
        }),
    ),
    (
        "browser_cua_scroll",
        "Scroll the page (mouse-wheel) at a point.",
        json!({
            "type": "object",
            "properties": {
                "tab": { "type": "string" }, "x": { "type": "integer" }, "y": { "type": "integer" },
                "scrollX": { "type": "integer" }, "scrollY": { "type": "integer" },
            },
        }),
    ),
]
}

fn tool_list() -> Value {
    let tools: Vec<Value> = browser_tools()
        .iter()
        .map(|(name, description, schema)| {
            json!({ "name": name, "description": description, "inputSchema": schema })
        })
        .collect();
    json!({ "tools": tools })
}

/// Run the browser MCP stdio server until EOF on stdin.
pub async fn run_mcp_server() -> std::io::Result<()> {
    let mcp = Arc::new(BrowserMcp::new());

    // Start the dashboard-facing HTTP endpoint (screenshots + state).
    let http_mcp = Arc::clone(&mcp);
    let http_port = mcp.http_port;
    let http_task = tokio::spawn(async move {
        run_http_server(http_mcp, http_port).await;
    });
    // The HTTP server picks a free port if none was provided; report it on a
    // file the daemon reads to learn the port.
    let _ = http_task;

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();

    // On SIGTERM/SIGINT (daemon `browser_stop`, session end, Ctrl-C) exit the
    // loop so the engine's Drop runs and Chromium is killed — never orphaned.
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

    loop {
        line.clear();
        tokio::select! {
            result = reader.read_line(&mut line) => {
                if result? == 0 {
                    break;
                }
            }
            _ = sigterm.recv() => break,
            _ = sigint.recv() => break,
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");

        let result: std::result::Result<Value, String> = match method {
            "initialize" => Ok(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "agentdeck-browser", "version": env!("CARGO_PKG_VERSION") },
            })),
            "notifications/initialized" => continue,
            "tools/list" => Ok(tool_list()),
            "tools/call" => {
                // Standard MCP `tools/call`: params = { name, arguments }.
                let params = message.get("params").cloned().unwrap_or_default();
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match call_tool(&mcp, &name, args).await {
                    Ok(value) => Ok(json!({
                        "content": [{ "type": "text", "text": value.to_string() }],
                    })),
                    Err(error) => Ok(json!({
                        "content": [{ "type": "text", "text": json!({ "ok": false, "error": error.to_string() }).to_string() }],
                        "isError": true,
                    })),
                }
            }
            other => Err(format!("Method not found: {other}")),
        };

        let reply = match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(message) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": message },
            }),
        };
        stdout.write_all(reply.to_string().as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }
    Ok(())
}

async fn call_tool(mcp: &Arc<BrowserMcp>, name: &str, args: Value) -> Result<Value> {
    match name {
        "browser_select" => mcp.tool_select(args).await,
        "browser_tabs_list" => mcp.tool_tabs_list().await,
        "browser_tab_new" => mcp.tool_tab_new(args).await,
        "browser_tab_close" => mcp.tool_tab_close(args).await,
        "browser_tab_get" => mcp.tool_tab_get(args).await,
        "browser_goto" => mcp.tool_goto(args).await,
        "browser_dom_snapshot" => mcp.tool_dom_snapshot(args).await,
        "browser_get_by_role" | "browser_get_by_text" | "browser_get_by_label"
        | "browser_get_by_placeholder" | "browser_get_by_test_id" => mcp.tool_get_by(args).await,
        "browser_count" => mcp.tool_count(args).await,
        "browser_click" => mcp.tool_click(args).await,
        "browser_type" => mcp.tool_type(args).await,
        "browser_press" => mcp.tool_press(args).await,
        "browser_check" => mcp.tool_check(args).await,
        "browser_screenshot" => mcp.tool_screenshot(args).await,
        "browser_wait_for" => mcp.tool_wait_for(args).await,
        "browser_wait_for_url" => mcp.tool_wait_for_url(args).await,
        "browser_wait_for_load_state" => mcp.tool_wait_for_load_state(args).await,
        "browser_assert" => mcp.tool_assert(args).await,
        "browser_evaluate" => mcp.tool_evaluate(args).await,
        "browser_cursor_move" => mcp.tool_cursor_move(args).await,
        "browser_cursor_move_by" => mcp.tool_cursor_move_by(args).await,
        "browser_cursor_move_to" => mcp.tool_cursor_move_to(args).await,
        "browser_cursor_click" => mcp.tool_cursor_click(args).await,
        "browser_cursor_double_click" => mcp.tool_cursor_double_click(args).await,
        "browser_cursor_drag" => mcp.tool_cursor_drag(args).await,
        "browser_cursor_type" => mcp.tool_cursor_type(args).await,
        "browser_cursor_keypress" => mcp.tool_cursor_keypress(args).await,
        "browser_cua_scroll" => mcp.tool_cua_scroll(args).await,
        other => Err(crate::AgentDeckError::Unknown(format!(
            "Unknown browser tool: {other}"
        ))),
    }
}

// ── Dashboard-facing HTTP endpoint ─────────────────────────────────────────

use axum::{
    extract::{Json as AxumJson, Path as AxumPath, State as AxumState},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Router,
};

async fn http_state_handler(AxumState(mcp): AxumState<Arc<BrowserMcp>>) -> impl IntoResponse {
    axum::Json(mcp.http_state().await)
}

async fn http_screenshot_handler(
    AxumState(mcp): AxumState<Arc<BrowserMcp>>,
    AxumPath(tab_id): AxumPath<String>,
) -> impl IntoResponse {
    match mcp.http_screenshot(&tab_id).await {
        Some(bytes) => (
            StatusCode::OK,
            [("content-type", "image/png")],
            bytes,
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            [("content-type", "text/plain")],
            "no screenshot yet — run browser_screenshot first".to_string(),
        )
            .into_response(),
    }
}

async fn http_snapshot_handler(
    AxumState(mcp): AxumState<Arc<BrowserMcp>>,
    AxumPath(tab_id): AxumPath<String>,
) -> impl IntoResponse {
    let _ = mcp;
    Html(format!("tab {tab_id}")) // placeholder; state endpoint carries the live snapshot
}

/// Invoke a `browser_*` tool over HTTP. Used by the dashboard to drive the
/// agent's CDP engine manually (address bar, reload, …) — the same tools the
/// agent calls over stdio, so manual actions land in the timeline too.
async fn http_tool_handler(
    AxumState(mcp): AxumState<Arc<BrowserMcp>>,
    AxumJson(body): AxumJson<Value>,
) -> impl IntoResponse {
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    let args = body.get("arguments").cloned().unwrap_or(json!({}));
    match call_tool(&mcp, &name, args).await {
        Ok(value) => (StatusCode::OK, AxumJson(json!({ "ok": true, "result": value }))),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            AxumJson(json!({ "ok": false, "error": error.to_string() })),
        ),
    }
}

async fn run_http_server(mcp: Arc<BrowserMcp>, requested_port: u16) {
    let app = Router::new()
        .route("/state", get(http_state_handler))
        .route("/screenshot/{tab}", get(http_screenshot_handler))
        .route("/snapshot/{tab}", get(http_snapshot_handler))
        .route("/tool", post(http_tool_handler))
        .with_state(mcp);

    // Bind to a random free port when none was configured.
    let addr = if requested_port == 0 {
        "127.0.0.1:0"
    } else {
        "127.0.0.1:0" // keep simple; daemon reads the actual port from the file below
    };
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("browser MCP: failed to bind HTTP: {e}");
            return;
        }
    };
    let actual_port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(_) => {
            return;
        }
    };
    // Report the actual port so the daemon can expose it to the dashboard.
    let session = std::env::var("AGENTDECK_SESSION").unwrap_or_default();
    let _ = std::fs::write(
        std::env::temp_dir().join(format!("agentdeck-browser-http.{session}.port")),
        actual_port.to_string(),
    );
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("browser MCP: HTTP server error: {e}");
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

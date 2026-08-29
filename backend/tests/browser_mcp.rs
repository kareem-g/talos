//! End-to-end smoke test for the browser MCP server (`agentdeck-backend
//! __browser-mcp`), driven over stdio exactly like the daemon drives it.
//!
//! Covers the control-browser-parity surface: select → tab_new → dom_snapshot
//! → locators → click → evaluate → wait_for_load_state → tab_get → cursor ops
//! → screenshot, plus a latency guard that locks in load-aware navigation
//! (no fixed 900ms sleep per goto). Skips when no Chromium binary is present.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

const TEST_HTML: &str = "data:text/html,
<!doctype html><html><body>
  <h1>Mcp browser smoke</h1>
  <button id=\"btn\" onclick=\"document.getElementById('out').textContent='clicked!'\">Click me</button>
  <input id=\"inp\" placeholder=\"type here\">
  <p id=\"out\"></p>
</body></html>";

/// A minimal MCP stdio client: sends JSON-RPC lines, matches replies by id.
struct McpClient {
    child: Child,
    stdin: Option<std::process::ChildStdin>,
    rx: Receiver<Value>,
    next_id: u64,
}

impl McpClient {
    fn spawn() -> Option<Self> {
        if agentdeck_backend::browser::engine::BrowserEngine::chromium_path().is_none() {
            eprintln!("skipping browser MCP test: no chromium found");
            return None;
        }
        let dir = std::env::temp_dir().join(format!("agentdeck-mcp-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).ok()?;
        let mut child = Command::new(env!("CARGO_BIN_EXE_agentdeck-backend"))
            .arg("__browser-mcp")
            .env("AGENTDECK_SESSION", "mcp-test-session")
            .env("AGENTDECK_BROWSER_DIR", &dir)
            .env("AGENTDECK_BROWSER_HTTP_PORT", "0")
            // Point the daemon-relay at a dead port: emits are best-effort.
            .env("AGENTDECK_URL", "http://127.0.0.1:1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line) {
                if n == 0 {
                    break;
                }
                let trimmed = line.trim().to_string();
                line.clear();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&trimmed) {
                    if tx.send(value).is_err() {
                        break;
                    }
                }
            }
        });
        Some(Self { child, stdin: Some(stdin), rx, next_id: 0 })
    }

    fn send(&mut self, value: Value) {
        let mut line = value.to_string();
        line.push('\n');
        self.stdin
            .as_mut()
            .unwrap()
            .write_all(line.as_bytes())
            .unwrap();
        self.stdin.as_mut().unwrap().flush().unwrap();
    }

    /// Send a request and wait for the matching response (60s budget).
    fn call(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        loop {
            let msg = self
                .rx
                .recv_timeout(Duration::from_secs(60))
                .expect("browser MCP did not answer in time");
            if msg.get("id").and_then(Value::as_u64) == Some(id) {
                return msg;
            }
        }
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    /// Call a `browser_*` tool and unwrap its structured result.
    fn tool(&mut self, name: &str, args: Value) -> Value {
        let msg = self.call("tools/call", json!({ "name": name, "arguments": args }));
        let text = msg
            .pointer("/result/content/0/text")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        serde_json::from_str(text).unwrap_or(json!({ "ok": false, "error": "unparsable result" }))
    }

    /// Graceful shutdown: closing stdin makes the MCP loop exit, which kills
    /// Chromium and removes the temp profile dir.
    fn shutdown(mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

#[tokio::test]
async fn mcp_drives_browser_end_to_end() {
    let Some(mut mcp) = McpClient::spawn() else { return };

    // Handshake.
    let init = mcp.call("initialize", json!({ "protocolVersion": "2024-11-05", "capabilities": {} }));
    assert!(init.get("result").is_some(), "initialize should succeed: {init}");
    mcp.notify("notifications/initialized", json!({}));

    // The tool manifest includes the control-browser-parity additions.
    let list = mcp.call("tools/list", json!({}));
    let names: Vec<String> = list
        .pointer("/result/tools")
        .and_then(Value::as_array)
        .expect("tools array")
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str).map(String::from))
        .collect();
    for expected in [
        "browser_select",
        "browser_tab_new",
        "browser_tab_get",
        "browser_goto",
        "browser_dom_snapshot",
        "browser_evaluate",
        "browser_wait_for_load_state",
        "browser_cursor_move_by",
        "browser_cursor_double_click",
        "browser_cursor_drag",
        "browser_screenshot",
    ] {
        assert!(names.iter().any(|n| n == expected), "missing tool {expected}");
    }

    // Select the engine and open a tab. Timing guard: load-aware navigation
    // must not burn a fixed sleep — a data: page loads in a few ms.
    let select = mcp.tool("browser_select", json!({ "backend": "cdp" }));
    assert_eq!(select.get("ok").and_then(Value::as_bool), Some(true), "select: {select}");

    let t0 = Instant::now();
    let opened = mcp.tool("browser_tab_new", json!({ "url": TEST_HTML }));
    let open_ms = t0.elapsed().as_millis();
    assert_eq!(opened.get("ok").and_then(Value::as_bool), Some(true), "tab_new: {opened}");
    let tab = opened.get("id").and_then(Value::as_str).unwrap().to_string();
    assert!(
        open_ms < 2000,
        "browser_tab_new took {open_ms}ms — the fixed 900ms sleep regressed?"
    );
    eprintln!("browser_tab_new(data: URL) = {open_ms}ms");

    // Snapshot sees the page.
    let snap = mcp.tool("browser_dom_snapshot", json!({ "tab": tab }));
    let text = snap.pointer("/snapshot/text").and_then(Value::as_str).unwrap_or("");
    assert!(text.contains("Mcp browser smoke"), "snapshot missing heading:\n{text}");

    // Locators + evaluate.
    let by_role = mcp.tool("browser_get_by_role", json!({ "tab": tab, "role": "button", "name": "Click me" }));
    assert_eq!(by_role.get("count").and_then(Value::as_u64), Some(1), "get_by_role: {by_role}");
    let eval = mcp.tool("browser_evaluate", json!({ "tab": tab, "expression": "document.querySelector('h1').textContent" }));
    assert_eq!(eval.pointer("/result").and_then(Value::as_str), Some("Mcp browser smoke"), "evaluate: {eval}");

    // Wait for a load state.
    let wait = mcp.tool("browser_wait_for_load_state", json!({ "tab": tab, "state": "load" }));
    assert_eq!(wait.get("ok").and_then(Value::as_bool), Some(true), "wait_for_load_state: {wait}");

    // tab_get makes the tab active.
    let got = mcp.tool("browser_tab_get", json!({ "tab": tab }));
    assert_eq!(got.get("ok").and_then(Value::as_bool), Some(true), "tab_get: {got}");

    // Cursor: move → move_by lands on the expected coordinates.
    let _ = mcp.tool("browser_cursor_move", json!({ "x": 100, "y": 100 }));
    let moved = mcp.tool("browser_cursor_move_by", json!({ "dx": 20, "dy": 30 }));
    assert_eq!(moved.get("x").and_then(Value::as_i64), Some(120), "move_by x: {moved}");
    assert_eq!(moved.get("y").and_then(Value::as_i64), Some(130), "move_by y: {moved}");

    // Click the button by snapshot path, verify the page reacted.
    let by_text = mcp.tool("browser_get_by_text", json!({ "tab": tab, "text": "Click me" }));
    let path = by_text.pointer("/matches/0/path").and_then(Value::as_str).unwrap().to_string();
    let click = mcp.tool("browser_click", json!({ "tab": tab, "path": path }));
    assert_eq!(click.get("ok").and_then(Value::as_bool), Some(true), "click: {click}");
    let out = mcp.tool("browser_evaluate", json!({ "tab": tab, "expression": "document.getElementById('out').textContent" }));
    assert_eq!(out.pointer("/result").and_then(Value::as_str), Some("clicked!"), "click effect: {out}");

    // Double-click with the visible cursor (aimed via move_to) still lands.
    let _ = mcp.tool("browser_cursor_move_to", json!({ "tab": tab, "path": path }));
    let dbl = mcp.tool("browser_cursor_double_click", json!({ "tab": tab }));
    assert_eq!(dbl.get("ok").and_then(Value::as_bool), Some(true), "double_click: {dbl}");

    // Drag is a no-crash coordinate path.
    let drag = mcp.tool(
        "browser_cursor_drag",
        json!({ "tab": tab, "from": { "x": 10, "y": 10 }, "to": { "x": 60, "y": 60 } }),
    );
    assert_eq!(drag.get("ok").and_then(Value::as_bool), Some(true), "drag: {drag}");

    // Screenshot returns PNG data.
    let shot = mcp.tool("browser_screenshot", json!({ "tab": tab }));
    let data = shot.get("data").and_then(Value::as_str).unwrap_or("");
    assert!(data.len() > 100, "screenshot data too small: {shot}");

    mcp.shutdown();
}

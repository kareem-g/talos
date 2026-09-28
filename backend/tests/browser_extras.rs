//! End-to-end smoke test for the second-wave browser tools
//! (`browser_extract`, `browser_find_text`, `browser_select_option`,
//! `browser_upload_file`, `browser_cua_click`, `browser_cua_keypress`,
//! `browser_screenshot{full_page}`), driven over stdio exactly like the daemon
//! drives the engine. Skips when no Chromium binary is present.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

const TEST_HTML: &str = "data:text/html,
<!doctype html><html><body>
  <h1>Extras smoke</h1>
  <p>The quick brown fox jumps over the lazy dog.</p>
  <button id=\"btn\" onclick=\"document.getElementById('out').textContent='clicked!'\">Click me</button>
  <input id=\"inp\" placeholder=\"type here\">
  <select id=\"sel\" onchange=\"document.getElementById('selout').textContent=this.value\">
    <option value=\"a\">Alpha</option><option value=\"b\">Beta</option>
  </select>
  <input id=\"file\" type=\"file\" title=\"upload resume\">
  <input id=\"key\" onkeydown=\"window.__k=event.key\">
  <p id=\"out\"></p><p id=\"selout\"></p>
</body></html>";

struct McpClient {
    child: Child,
    stdin: Option<std::process::ChildStdin>,
    rx: Receiver<Value>,
    next_id: u64,
}

impl McpClient {
    fn spawn() -> Option<Self> {
        if agentdeck_backend::browser::engine::BrowserEngine::chromium_path().is_none() {
            eprintln!("skipping browser extras test: no chromium found");
            return None;
        }
        let dir = std::env::temp_dir().join(format!("agentdeck-extras-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).ok()?;
        let mut child = Command::new(env!("CARGO_BIN_EXE_agentdeck-backend"))
            .arg("__browser-mcp")
            .env("AGENTDECK_SESSION", "extras-test-session")
            .env("AGENTDECK_BROWSER_DIR", &dir)
            .env("AGENTDECK_BROWSER_HTTP_PORT", "0")
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
        self.stdin.as_mut().unwrap().write_all(line.as_bytes()).unwrap();
        self.stdin.as_mut().unwrap().flush().unwrap();
    }

    fn call(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        loop {
            let msg = self.rx.recv_timeout(Duration::from_secs(60)).expect("browser MCP quiet");
            if msg.get("id").and_then(Value::as_u64) == Some(id) {
                return msg;
            }
        }
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
    }

    fn tool(&mut self, name: &str, args: Value) -> Value {
        let msg = self.call("tools/call", json!({ "name": name, "arguments": args }));
        let text = msg.pointer("/result/content/0/text").and_then(Value::as_str).unwrap_or("{}");
        serde_json::from_str(text).unwrap_or(json!({ "ok": false, "error": "unparsable result" }))
    }

    fn shutdown(mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

#[tokio::test]
async fn extras_end_to_end() {
    let Some(mut mcp) = McpClient::spawn() else { return };

    let init = mcp.call("initialize", json!({ "protocolVersion": "2024-11-05", "capabilities": {} }));
    assert!(init.get("result").is_some(), "initialize: {init}");
    mcp.notify("notifications/initialized", json!({}));

    let list = mcp.call("tools/list", json!({}));
    let names: Vec<String> = list
        .pointer("/result/tools")
        .and_then(Value::as_array)
        .expect("tools array")
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str).map(String::from))
        .collect();
    for expected in [
        "browser_extract",
        "browser_find_text",
        "browser_select_option",
        "browser_upload_file",
        "browser_cua_click",
        "browser_cua_keypress",
    ] {
        assert!(names.iter().any(|n| n == expected), "missing tool {expected}");
    }

    let select = mcp.tool("browser_select", json!({ "backend": "cdp" }));
    assert_eq!(select.get("ok").and_then(Value::as_bool), Some(true), "select: {select}");
    let opened = mcp.tool("browser_tab_new", json!({ "url": TEST_HTML }));
    assert_eq!(opened.get("ok").and_then(Value::as_bool), Some(true), "tab_new: {opened}");
    let tab = opened.get("id").and_then(Value::as_str).unwrap().to_string();

    // Extract sees the page text.
    let extract = mcp.tool("browser_extract", json!({ "tab": tab }));
    let text = extract.pointer("/extract/text").and_then(Value::as_str).unwrap_or("");
    assert!(text.contains("Extras smoke"), "extract missing heading: {extract}");
    assert!(text.contains("quick brown fox"), "extract missing body: {extract}");

    // Find text counts matches and aims.
    let found = mcp.tool("browser_find_text", json!({ "tab": tab, "text": "brown fox" }));
    assert_eq!(found.pointer("/result/count").and_then(Value::as_u64), Some(1), "find: {found}");
    let missing = mcp.tool("browser_find_text", json!({ "tab": tab, "text": "zzz-no-such-text" }));
    assert_eq!(missing.pointer("/result/count").and_then(Value::as_u64), Some(0), "find miss: {missing}");

    // Select option by visible text; the page's onchange fires.
    let snap = mcp.tool("browser_dom_snapshot", json!({ "tab": tab }));
    let snap_text = snap.pointer("/snapshot/text").and_then(Value::as_str).unwrap_or("");
    assert!(snap_text.contains("combobox"), "select missing from snapshot:\n{snap_text}");
    let option = mcp.tool(
        "browser_get_by_role",
        json!({ "tab": tab, "role": "combobox" }),
    );
    let path = option.pointer("/matches/0/path").and_then(Value::as_str).unwrap().to_string();
    let picked = mcp.tool("browser_select_option", json!({ "tab": tab, "path": path, "value": "Beta" }));
    assert_eq!(picked.get("ok").and_then(Value::as_bool), Some(true), "select_option: {picked}");
    let selout = mcp.tool(
        "browser_evaluate",
        json!({ "tab": tab, "expression": "document.getElementById('selout').textContent" }),
    );
    assert_eq!(selout.pointer("/result").and_then(Value::as_str), Some("b"), "change event: {selout}");
    // Unknown option reports the available values.
    let bad = mcp.tool("browser_select_option", json!({ "tab": tab, "path": path, "value": "Gamma" }));
    assert_eq!(bad.get("ok").and_then(Value::as_bool), Some(false), "bad option should fail: {bad}");

    // Upload: missing file is a clean error; a real file registers.
    let nofile = mcp.tool(
        "browser_upload_file",
        json!({ "tab": tab, "path": path, "file": "/nonexistent-dir-for-test/nope.bin" }),
    );
    assert_eq!(nofile.get("ok").and_then(Value::as_bool), Some(false), "missing file: {nofile}");
    let updir = std::env::temp_dir().join(format!("agentdeck-upload-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&updir).unwrap();
    let upfile = updir.join("hello.txt");
    std::fs::write(&upfile, b"hello upload").unwrap();
    // coord: paths can't address DOM file inputs — expect a clean error, not
    // a crash (documents the snapshot-path requirement).
    let coords = mcp.tool(
        "browser_evaluate",
        json!({ "tab": tab, "expression": "(() => { const el = document.getElementById('file'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()" }),
    );
    let cx = coords.pointer("/result/x").and_then(Value::as_i64).unwrap();
    let cy = coords.pointer("/result/y").and_then(Value::as_i64).unwrap();
    let coord_up = mcp.tool(
        "browser_upload_file",
        json!({ "tab": tab, "path": format!("coord:{cx}:{cy}"), "file": upfile.to_string_lossy().to_string() }),
    );
    assert_eq!(coord_up.get("ok").and_then(Value::as_bool), Some(false), "coord upload: {coord_up}");

    // Real upload through the snapshot path: the file registers on the input.
    let by_title = mcp.tool("browser_get_by_role", json!({ "tab": tab, "role": "textbox", "name": "upload resume" }));
    let upath = by_title.pointer("/matches/0/path").and_then(Value::as_str).unwrap().to_string();
    let uploaded = mcp.tool(
        "browser_upload_file",
        json!({ "tab": tab, "path": upath, "file": upfile.to_string_lossy().to_string() }),
    );
    assert_eq!(uploaded.get("ok").and_then(Value::as_bool), Some(true), "upload: {uploaded}");
    let files = mcp.tool(
        "browser_evaluate",
        json!({ "tab": tab, "expression": "document.getElementById('file').files.length" }),
    );
    assert_eq!(files.pointer("/result").and_then(Value::as_f64), Some(1.0), "registered files: {files}");

    // cua_click on the real button coordinates clicks the page.
    let btn = mcp.tool(
        "browser_evaluate",
        json!({ "tab": tab, "expression": "(() => { const el = document.getElementById('btn'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()" }),
    );
    let bx = btn.pointer("/result/x").and_then(Value::as_i64).unwrap() as i32;
    let by = btn.pointer("/result/y").and_then(Value::as_i64).unwrap() as i32;
    let clicked = mcp.tool("browser_cua_click", json!({ "tab": tab, "x": bx, "y": by }));
    assert_eq!(clicked.get("ok").and_then(Value::as_bool), Some(true), "cua_click: {clicked}");
    let out = mcp.tool(
        "browser_evaluate",
        json!({ "tab": tab, "expression": "document.getElementById('out').textContent" }),
    );
    assert_eq!(out.pointer("/result").and_then(Value::as_str), Some("clicked!"), "click effect: {out}");

    // cua_keypress at focus: click the key input, send Tab, check the handler saw it.
    let keypos = mcp.tool(
        "browser_evaluate",
        json!({ "tab": tab, "expression": "(() => { const el = document.getElementById('key'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()" }),
    );
    let kx = keypos.pointer("/result/x").and_then(Value::as_i64).unwrap() as i32;
    let ky = keypos.pointer("/result/y").and_then(Value::as_i64).unwrap() as i32;
    let _ = mcp.tool("browser_cua_click", json!({ "tab": tab, "x": kx, "y": ky }));
    let pressed = mcp.tool("browser_cua_keypress", json!({ "tab": tab, "keys": "Tab" }));
    assert_eq!(pressed.get("ok").and_then(Value::as_bool), Some(true), "cua_keypress: {pressed}");
    let saw = mcp.tool("browser_evaluate", json!({ "tab": tab, "expression": "window.__k || null" }));
    assert_eq!(saw.pointer("/result").and_then(Value::as_str), Some("Tab"), "keypress effect: {saw}");

    // Full-page screenshot returns data and flags itself.
    let shot = mcp.tool("browser_screenshot", json!({ "tab": tab, "full_page": true }));
    assert_eq!(shot.get("full_page").and_then(Value::as_bool), Some(true), "full_page flag: {shot}");
    assert!(shot.get("data").and_then(Value::as_str).unwrap_or("").len() > 100, "shot data: {shot}");
    assert_eq!(shot.get("width").and_then(Value::as_u64), Some(1280), "viewport width: {shot}");

    let _ = std::fs::remove_dir_all(&updir);
    mcp.shutdown();
}

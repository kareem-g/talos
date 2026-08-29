//! Smoke test for the built-in browser engine (Phase A / E dogfood).
//!
//! Launches a headless Chromium instance, opens a tab to an inline page,
//! reads a DOM snapshot, resolves a locator path, clicks, and captures a
//! screenshot — the exact primitives the `browser_*` MCP tools build on.

use agentdeck_backend::browser::{cdp::CdpClient, engine::BrowserEngine, snapshot};

const TEST_HTML: &str = r#"data:text/html,
<!doctype html><html><body>
  <h1>AgentDeck browser smoke</h1>
  <button id="btn" onclick="document.getElementById('out').textContent='clicked!'">Click me</button>
  <input id="inp" placeholder="type here" value="hello">
  <p id="out"></p>
</body></html>"#;

#[tokio::test]
async fn engine_smoke() {
    // A Chromium binary is required for this test.
    if BrowserEngine::chromium_path().is_none() {
        eprintln!("skipping browser smoke test: no chromium found");
        return;
    }
    let dir = std::env::temp_dir().join(format!("agentdeck-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let engine = BrowserEngine::launch(dir).await.expect("launch chromium");
    let tab = engine
        .new_tab("about:blank")
        .await
        .expect("open blank tab");
    let client = CdpClient::connect(&tab.ws_url).await.expect("cdp connect");
    let _ = client.call("Page.enable", json!({})).await;
    let _ = client.call("Runtime.enable", json!({})).await;
    // Navigate to the data: URL via CDP (works natively, no encoding issues).
    let _ = client
        .call("Page.navigate", json!({ "url": TEST_HTML }))
        .await
        .expect("navigate to test html");

    // Give the page a beat to load, then snapshot.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let snap = snapshot::dom_snapshot(&client).await.expect("snapshot");
    let text = snapshot::snapshot_to_text(&snap);
    assert!(
        text.contains("AgentDeck browser smoke"),
        "snapshot should contain the heading, got:\n{text}"
    );
    assert!(text.contains("Click me"), "button accessible name missing:\n{text}");

    // Locate the button by role+name and resolve its path to coordinates.
    let nodes = snapshot::nodes_array(&snap);
    let button = nodes
        .iter()
        .find(|n| {
            n.get("role").and_then(|v| v.as_str()) == Some("button")
                && n.get("name").and_then(|v| v.as_str()) == Some("Click me")
        })
        .expect("button node in snapshot");
    let path = button.get("path").and_then(|v| v.as_str()).unwrap().to_string();
    let (x, y) = snapshot::resolve_path(&client, &path)
        .await
        .expect("resolve path")
        .expect("coordinates");
    assert!(x > 0 && y > 0, "expected positive coords, got {x},{y}");

    // Click it, then assert the page reacted.
    client
        .call(
            "Input.dispatchMouseEvent",
            json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1 }),
        )
        .await
        .unwrap();
    client
        .call(
            "Input.dispatchMouseEvent",
            json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1 }),
        )
        .await
        .unwrap();
    let out = client.evaluate("document.getElementById('out').textContent").await.unwrap();
    assert_eq!(out.as_str(), Some("clicked!"), "click should have updated the page");

    // Screenshot is non-empty PNG.
    let shot = client
        .call("Page.captureScreenshot", json!({ "format": "png" }))
        .await
        .unwrap();
    let data = shot.get("data").and_then(|v| v.as_str()).unwrap();
    assert!(data.len() > 100, "screenshot base64 should be non-trivial");

    // Assert helper parity: evaluate + compare.
    let title = client.evaluate("document.title || 'no title'").await.unwrap();
    assert_eq!(title.as_str(), Some("no title"));

    let _ = client;
    let _ = engine;
}

use serde_json::json;

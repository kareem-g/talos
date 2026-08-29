//! DOM snapshot — turns a live page into a compact AI/ARIA tree that an agent
//! can read and build locators from (mirrors ZCode's `domSnapshot`).
//!
//! The walker runs inside the page via `Runtime.evaluate` and returns a nested
//! tree: each node has a stable `path` (e.g. "1.2.3"), a `role`, an accessible
//! `name`, optional `state`, and `children`. Rust renders it to an indented
//! text tree for the agent, and resolves a `path` back to a clickable center
//! point.

use crate::browser::cdp::CdpClient;
use serde_json::{json, Value};
use crate::Result;

/// The snapshot walker, injected into the page. Deterministic: given the same
/// DOM it assigns the same `path` to each node, so `resolve_path` can find it.
const SNAPSHOT_JS: &str = r#"
(() => {
  const flat = [];
  const ROLE_MAP = {
    a: 'link', button: 'button', textarea: 'textbox', select: 'combobox',
    nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
    aside: 'complementary', form: 'form', img: 'img', h1: 'heading',
    h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    li: 'listitem', ul: 'list', ol: 'list', table: 'table', tr: 'row',
    td: 'cell', th: 'columnheader', dialog: 'dialog', search: 'search',
  };
  function isVisible(el) {
    if (el.nodeType !== 1) return true;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function roleOf(el) {
    const aria = el.getAttribute && el.getAttribute('role');
    if (aria) return aria;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.type || 'text');
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      return 'textbox';
    }
    return ROLE_MAP[tag] || 'generic';
  }
  function nameOf(el, role) {
    if (el.nodeType !== 1) return '';
    const g = (v) => (v || '').trim();
    const ariaLabel = g(el.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel.slice(0, 200);
    const labelledby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledby) {
      const ref = document.getElementById(String(labelledby).split(/\s+/)[0]);
      if (ref) { const t = g(ref.textContent); if (t) return t.slice(0, 200); }
    }
    if (role === 'link' || role === 'button' || role === 'heading' || role === 'tab' ||
        role === 'menuitem' || role === 'option' || role === 'listitem') {
      const t = g(el.textContent);
      if (t && t.length <= 200) return t;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.type === 'submit' || el.type === 'button' || el.type === 'reset') {
        const t = g(el.value || el.title); if (t) return t;
      }
      return g(el.placeholder || el.title);
    }
    return g(el.getAttribute('title'));
  }
  function stateOf(el, role) {
    const s = [];
    if (el.disabled) s.push('disabled');
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') s.push('disabled');
    if (el.checked) s.push('checked');
    if (el.getAttribute && el.getAttribute('aria-checked') === 'true') s.push('checked');
    if (el.selected) s.push('selected');
    if (el.getAttribute && el.getAttribute('aria-selected') === 'true') s.push('selected');
    if (el.getAttribute && el.getAttribute('aria-expanded') === 'true') s.push('expanded');
    if (role === 'textbox' && el.value && el.value.length > 0) s.push('filled');
    return s.join(' ');
  }
  function textOf(el) {
    // Leaf text (for text nodes / paragraphs) — collapsed.
    if (el.nodeType === 3) {
      const t = (el.nodeValue || '').replace(/\s+/g, ' ').trim();
      return t.length > 0 ? t : null;
    }
    return null;
  }
  function walk(node, path, out) {
    if (node.nodeType === 3) {
      const t = textOf(node);
      if (t) out.push({ path, role: 'text', name: t });
      return;
    }
    if (node.nodeType !== 1) return;
    if (!isVisible(node)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return;
    const role = roleOf(node);
    const name = nameOf(node, role);
    const state = stateOf(node, role);
    const entry = { path, role };
    if (name) entry.name = name;
    if (state) entry.state = state;
    out.push(entry);
    let childIndex = 0;
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        childIndex += 1;
        walk(child, path + '.' + childIndex, out);
      } else if (child.nodeType === 3) {
        const t = textOf(child);
        if (t) {
          // Leaf text under a named element (button/link) is redundant — skip.
          if (!(role === 'link' || role === 'button' || role === 'heading' || role === 'tab' ||
                role === 'menuitem' || role === 'option')) {
            out.push({ path: path + '.t', role: 'text', name: t });
          }
        }
      }
    }
  }
  const out = [];
  walk(document.body, '1', out);
  return { ok: true, nodes: out, url: location.href, title: document.title };
})()
"#;

/// Render the flat node list into an indented text tree (one line per node),
/// with children nested under their parent's path prefix.
fn render_snapshot(nodes: &[Value]) -> String {
    // Depth of a path string like "1.2.3".
    let depth = |p: &str| p.split('.').count().saturating_sub(1);
    let mut lines: Vec<String> = Vec::new();
    // Group by parent prefix so children come right after their parent.
    for node in nodes {
        let path = node.get("path").and_then(Value::as_str).unwrap_or("");
        let role = node.get("role").and_then(Value::as_str).unwrap_or("generic");
        let name = node.get("name").and_then(Value::as_str).unwrap_or("");
        let state = node.get("state").and_then(Value::as_str).unwrap_or("");
        let d = depth(path);
        let indent = "  ".repeat(d);
        let mut line = format!("{indent}- {role}");
        if !name.is_empty() {
            let quoted = name.replace('"', "\\\"");
            line.push_str(&format!(" \"{quoted}\""));
        }
        if !state.is_empty() {
            line.push_str(&format!(" [{state}]"));
        }
        lines.push(line);
    }
    lines.join("\n")
}

/// Take a live DOM snapshot of the page in `tab`.
pub async fn dom_snapshot(client: &CdpClient) -> Result<Value> {
    let value = client.evaluate(SNAPSHOT_JS).await?;
    Ok(value)
}

/// Render a snapshot (from [`dom_snapshot`]) to an indented text tree.
pub fn snapshot_to_text(snapshot: &Value) -> String {
    let nodes = snapshot
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out = String::new();
    let title = snapshot
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("");
    let url = snapshot.get("url").and_then(Value::as_str).unwrap_or("");
    if !title.is_empty() {
        out.push_str(&format!("# {title}\n"));
    }
    if !url.is_empty() {
        out.push_str(&format!("url: {url}\n"));
    }
    out.push_str(&render_snapshot(&nodes));
    out
}

/// Resolve a snapshot `path` to the element's bounding-box center, so CUA
/// clicks/typing can target it. Returns `{ x, y, tag }` or null if gone.
const RESOLVE_PATH_JS: &str = r#"
((pathStr) => {
  const parts = pathStr.split('.').map(Number);
  // Re-walk exactly like the snapshot walker to find the same node.
  const ROLE_MAP = {
    a:'link',button:'button',textarea:'textbox',select:'combobox',nav:'navigation',
    main:'main',header:'banner',footer:'contentinfo',aside:'complementary',form:'form',
    img:'img',h1:'heading',h2:'heading',h3:'heading',h4:'heading',h5:'heading',
    h6:'heading',li:'listitem',ul:'list',ol:'list',table:'table',tr:'row',
    td:'cell',th:'columnheader',dialog:'dialog',search:'search',
  };
  function isVisible(el) {
    if (el.nodeType !== 1) return true;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function roleOf(el) {
    const aria = el.getAttribute && el.getAttribute('role');
    if (aria) return aria;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') { const t = el.type || 'text'; if (t==='checkbox') return 'checkbox'; if (t==='radio') return 'radio'; return 'textbox'; }
    return ROLE_MAP[tag] || 'generic';
  }
  function find(node, depth, target) {
    if (node.nodeType === 3) return null;
    if (node.nodeType !== 1) return null;
    if (!isVisible(node)) return null;
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return null;
    if (depth === target.length - 1) {
      const role = roleOf(node);
      return { x: node.getBoundingClientRect(), role };
    }
    let idx = 0;
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      idx += 1;
      if (idx === target[depth + 1]) {
        const r = find(child, depth + 1, target);
        if (r) return r;
      }
    }
    return null;
  }
  const found = find(document.body, 0, parts);
  if (!found) return { ok: false };
  const r = found.x;
  if (!r || r.width === 0 || r.height === 0) return { ok: false };
  return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), role: found.role };
})
"#;

/// Resolve a snapshot `path` to click coordinates in the page.
pub async fn resolve_path(client: &CdpClient, path: &str) -> Result<Option<(i32, i32)>> {
    let expression = format!("({RESOLVE_PATH_JS})({})", json!(path));
    let value = client.evaluate(&expression).await?;
    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        let x = value.get("x").and_then(Value::as_i64).unwrap_or(0) as i32;
        let y = value.get("y").and_then(Value::as_i64).unwrap_or(0) as i32;
        Ok(Some((x, y)))
    } else {
        Ok(None)
    }
}

/// Serialize a list of snapshot nodes into a plain JSON array (for locator
/// searches). Filtering by role/name happens in Rust against this list.
pub fn nodes_array(snapshot: &Value) -> Vec<Value> {
    snapshot
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Build the snapshot JSON the MCP `browser_dom_snapshot` tool returns: the
/// indented text plus a machine-readable node list.
pub async fn snapshot_for_tool(client: &CdpClient) -> Result<Value> {
    let snap = dom_snapshot(client).await?;
    let text = snapshot_to_text(&snap);
    Ok(json!({
        "text": text,
        "title": snap.get("title"),
        "url": snap.get("url"),
        "nodes": nodes_array(&snap),
    }))
}

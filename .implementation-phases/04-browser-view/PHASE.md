# Phase 04: Browser View Tab

> **Goal**: A built-in browser panel in the sidebar so you can see what the agent is doing on the web without leaving AgentDeck.

---

## What to Build

A browser-like panel that displays web content inside the sidebar. This is NOT full browser control (that comes later with remote view) — it's a **view-only browser** for now, with navigation controls.

### The View

A browser panel with:

- **URL bar** at the top — shows current URL, editable to navigate
- **Navigation buttons** — Back, Forward, Refresh
- **Main content area** — renders the web page in an iframe
- **Tab bar** — support multiple browser tabs (like real browsers)

### Agent Integration

- When an agent opens a URL (via a tool or MCP), it automatically appears here
- A small badge on the Browser tab icon shows count of open pages
- Agent-opened pages have a subtle "Agent" tag so you can distinguish them from pages you opened manually

### What This Is NOT

- Not full browser automation (no clicking, typing, scraping — that's the remote view feature later)
- Not a replacement for your main browser — it's a preview/companion panel

### Mobile

- This tab is **hidden on mobile** (per the original requirements — browser control comes with remote view later)
- On mobile, the icon doesn't appear in the tab strip at all
- A note in the mobile docs: "Browser view requires desktop — use remote view on mobile"

### Interaction Details

- Type a URL and press Enter to navigate
- Middle-click a link to open in a new tab
- Pages load in sandboxed iframes (sandbox attribute for security)
- If a page refuses to load in an iframe (X-Frame-Options), show a message with an "Open in new window" button
- Limit: max 5 concurrent browser tabs to prevent memory bloat

### Empty State

"No pages open — navigate to a URL above, or wait for an agent to open one."

---

## Acceptance Criteria

- [ ] Browser tab renders web pages in an iframe
- [ ] URL bar works for navigation
- [ ] Back/Forward/Refresh buttons work
- [ ] Multiple tabs supported (max 5)
- [ ] Agent-opened URLs appear automatically
- [ ] Hidden on mobile completely
- [ ] Security: iframes sandboxed, no scripts leaking out
- [ ] Graceful error for pages that block iframes

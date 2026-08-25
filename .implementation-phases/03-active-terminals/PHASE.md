# Phase 03: Active Terminals View

> **Goal**: See and interact with the PTY terminals that sessions spawn — right inside the sidebar.

---

## What to Build

When an agent runs shell commands, it does so through a PTY. This tab surfaces those terminals so you can watch what the agent is doing at the shell level, or take over manually.

### The View

A list of **terminal cards**, one per active PTY instance. Each card shows:

- Terminal name (e.g., "Terminal 1", or the command that started it)
- Session it belongs to (clickable to jump to session)
- Status: active (green dot) or exited (dim)
- A mini terminal preview — the last ~5 lines of output, monospace

Clicking a terminal card **expands** it into a full mini terminal emulator within the sidebar:

- Takes over the tab panel height
- Shows the live terminal output
- Has an input line at the bottom — type and press Enter to send input to the PTY
- A collapse button (X or ↥) to shrink it back to card view

### Multiple Terminals

- If a session has multiple terminals, show them as stacked cards
- Only one terminal can be expanded at a time
- Group terminals by session (session name as a small header)

### Backend Support Needed

- Endpoint to list active terminals for all sessions (or per session)
- WebSocket stream for terminal output (the backend already has PTY — just need to expose output)
- Endpoint to send input to a specific terminal
- Track terminal lifecycle (created → active → exited)

### Interaction Details

- The mini terminal should use a proper terminal emulator (xterm.js or similar), not just a text div
- Support basic ANSI colors so you see the same output as a real terminal
- Scrollback: keep last 1000 lines in memory
- When a new line arrives while collapsed, briefly flash the card to indicate activity
- Right-click context menu: "Clear scrollback", "Copy output", "Kill terminal"

### Empty State

"No active terminals — terminals will appear here when agents run shell commands."

---

## Acceptance Criteria

- [ ] Terminals tab lists all active PTY instances
- [ ] Each card shows session, name, status, and output preview
- [ ] Clicking expands into a working mini terminal (xterm.js)
- [ ] Can type input and send to the PTY
- [ ] Live output streams via WebSocket
- [ ] ANSI colors render correctly
- [ ] Collapse back to card view works
- [ ] Empty state shows when no terminals active

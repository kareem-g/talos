# Phase 02: Working Agents View

> **Goal**: A sidebar tab that shows all active agents across every session in real time — what's running, what it's doing, and whether it needs you.

---

## What to Build

The Agents tab is a live fleet dashboard in miniature. It answers one question at a glance: "Who's working right now?"

### The View

A vertical list of **agent groups**, one per provider (Claude Code, Codex, Grok, etc.). Each group shows:

- **Provider name + icon** (use a colored dot or the agent's first letter)
- **Active count** — "3 working", "1 waiting", or "Idle"
- **Session cards** underneath — one per active session showing:
  - Session name
  - Status pill (Working / Waiting for approval / Waiting for input / Error)
  - A 1-line preview of what it's doing (last message snippet or tool name)
  - Time since last activity (relative: "2m ago")
  - For approvals: a small amber dot that pulses

### Status Prioritization

Sort the list so the sessions that need a human float to the top:
1. Needs approval (orange)
2. Needs input (orange)
3. Working (green pulse)
4. Errored (red)
5. Everything else

### Interaction

- Click a session card → jump to that session (same as clicking in the Sessions tab)
- Hover a card → subtle highlight
- A card with an approval shows the approval prompt text inline
- At the bottom of the tab: a summary line — "5 sessions · 3 working · 2 need you"

### Backend Support Needed

- An endpoint that returns aggregated agent status across all sessions
- Or derive it from existing session list + conversation data (frontend-only is fine for now)
- The existing WebSocket already broadcasts state changes — leverage that for live updates

### Real-time Behavior

- The tab subscribes to WebSocket state change events
- When a session's status changes, the card updates in place (no full re-render)
- A subtle breathing pulse on "Working" status pills
- When you switch TO this tab, it shows current state immediately (not stale)

---

## Acceptance Criteria

- [ ] Agents tab shows all active sessions grouped by provider
- [ ] Status pills use correct colors (green=working, orange=waiting, red=error)
- [ ] Sessions needing approval/input sort to top
- [ ] Clicking a card opens that session
- [ ] Live updates via WebSocket (no manual refresh)
- [ ] Summary count at bottom is accurate
- [ ] Empty state: "No active agents — create a task to get started"

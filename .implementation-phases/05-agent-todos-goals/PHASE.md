# Phase 05: Agent Todos & Goals

> **Goal**: Surface the tasks, todo lists, and goals that agents create during their work — all visible and manageable from the sidebar.

---

## What to Build

When agents work, they often break work into steps. They create todo lists, set goals, track progress. This tab captures that output and makes it useful to you.

### The View

Two sections in the Tasks tab:

#### 1. Todos Section

A list of todo items, grouped by session. Each todo shows:

- Checkbox (clickable to toggle done/in-progress)
- Title text
- Priority indicator (color dot: gray=none, blue=low, amber=orange, red=high)
- Which session created it (small label, clickable)
- Who created it — agent or human (tiny icon badge)

Interaction:
- Click checkbox to cycle: pending → in_progress → done → pending
- Add a new todo manually with a "+ Add todo" button at the bottom
- Filter: All / Active / Done
- Sort by: priority, date, or session
- Done items fade out but remain visible (with a "Clear done" button)

#### 2. Goals Section

A list of agent-defined goals. Each goal shows:

- Goal title
- Progress bar (0-100%)
- Status: active (green), achieved (blue), abandoned (dim)
- Session it belongs to
- Description (expandable)

Interaction:
- Goals are primarily agent-driven (agent updates progress)
- You can manually mark a goal as achieved or abandoned
- Click to expand and see the full description and progress history

### Backend Support Needed

- Store todos and goals in the database (session-scoped)
- API endpoints for CRUD operations
- WebSocket events when agents create/update todos and goals
- Optionally parse agent output for todo patterns (e.g., markdown checkboxes) — but this is a stretch goal; start with manual + API-driven

### Smart Behavior

- When an agent completes all its todos, show a subtle celebration (a brief glow on the tab icon)
- The Tasks tab icon shows a badge with the count of active (non-done) todos
- If an agent is currently updating todos (streaming), show a subtle pulse on the relevant session group

### Empty State

"No tasks yet — todos and goals will appear here as agents work on your projects."

---

## Acceptance Criteria

- [ ] Todos section with checkboxes, priority, session labels
- [ ] Can toggle todo status by clicking checkbox
- [ ] Can add todos manually
- [ ] Filter and sort controls work
- [ ] Goals section with progress bars
- [ ] Backend stores todos/goals in SQLite
- [ ] API endpoints for full CRUD
- [ ] WebSocket live updates when agents modify todos
- [ ] Badge on tab icon shows active todo count
- [ ] Empty state shows when nothing exists

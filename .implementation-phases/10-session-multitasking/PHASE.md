# Phase 10: Session Multitasking

> **Goal**: Allow multiple concurrent tasks within a single session — run agents in parallel, manage subtasks, and track everything from one place.

---

## What to Build

Currently, a session is a single conversation thread. This phase adds the ability to spawn **multiple concurrent tasks** within a session, each running independently but grouped under the same workspace context.

### The Concept

Think of a session as a project room. Inside that room, you can have multiple agents working on different tasks simultaneously. Each task is its own conversation thread, but they share the same workspace and you can see them all in one view.

### The View: Task Panel

A new panel in the session view (not the sidebar — the main content area) that shows:

#### Task List

A vertical list of tasks in the current session:
- Task name (auto-generated from the prompt, or user-defined)
- Status: pending (gray), running (green pulse), completed (blue), failed (red), cancelled (dim)
- Agent/provider used
- Time running (for active) or total duration (for completed)
- Progress indicator (if the agent reports progress)
- Actions: View, Cancel, Retry

#### Active Task Highlight

The currently-selected task is highlighted and its conversation shows in the main chat area. You can switch between tasks to see each one's progress.

#### Spawning Tasks

Two ways to create tasks:

1. **From the composer**: Type a prompt, then click a "Run in background" toggle before sending. This creates a new task without interrupting the current conversation.

2. **From an agent**: An agent can spawn subtasks (e.g., "I'll run the tests while I review the code"). These appear as child tasks nested under the parent.

### Task Relationships

- **Parent task**: The main conversation thread
- **Child tasks**: Subtasks spawned from the parent
- Child tasks are visually indented under their parent
- When a child task completes, its result is reported back to the parent

### Concurrency

- Up to 5 concurrent tasks per session (configurable)
- Each task runs in its own PTY/agent instance
- Tasks share the same workspace directory
- If two tasks try to edit the same file, the second one waits or warns

### Backend Support Needed

- Task storage in SQLite (session-scoped, with parent-child relationships)
- API endpoints for CRUD operations
- WebSocket events for task lifecycle (created, started, progress, completed, failed, cancelled)
- Agent spawning logic — create a new agent instance per task
- Result propagation — when a child completes, notify the parent

### The Composer Changes

The chat composer gets a new toggle:
- **Normal mode** (default): send message to the current task
- **Background mode**: spawn a new task with this prompt

A small indicator shows how many tasks are currently running in this session.

### Empty State (Task Panel)

"No tasks yet — send a message to start, or toggle 'Run in background' to spawn a parallel task."

---

## Acceptance Criteria

- [ ] Task panel shows all tasks in the current session
- [ ] Tasks have status, agent, duration, and actions
- [ ] Can spawn tasks from the composer (background mode)
- [ ] Can spawn subtasks from agent output
- [ ] Parent-child task relationships with visual nesting
- [ ] Up to 5 concurrent tasks per session
- [ ] Switch between tasks to view their conversations
- [ ] Backend stores tasks with full lifecycle
- [ ] WebSocket events for real-time task updates
- [ ] Child task results propagate to parent

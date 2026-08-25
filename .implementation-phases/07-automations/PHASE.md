# Phase 07: Automations

> **Goal**: A full automations system inspired by ZCode — schedule recurring tasks, queue background work, and let agents run while you're away.

---

## What to Build

An Automations panel (accessible from the sidebar or as a full-screen view) where you create, manage, and monitor automated tasks.

### The Concept

An automation is: "On this schedule, send this prompt to this agent in this workspace." It's a way to make your agents work for you on autopilot.

### The View

#### Automations List

A list of all automations, each card showing:
- Name
- Schedule (human-readable: "Every day at 9:00 AM" or the raw cron)
- Agent + workspace
- Enable/disable toggle
- Last run time + status
- Next run time
- Run count
- Actions: Run now, Edit, Delete

#### Create/Edit Form

A form to create or edit an automation:
- **Name** — descriptive title
- **Schedule** — choose from presets or custom cron:
  - Presets: Hourly, Daily (pick time), Weekly (pick day+time), Every N minutes, Custom
  - Custom: a cron expression field with a helper link
- **Prompt template** — the message to send to the agent. Supports variables:
  - `{workspace}` — the workspace path
  - `{date}` — current date
  - `{last_result}` — result of the previous run
- **Agent** — which provider to use
- **Workspace** — which project to run in
- **Run during idle** — checkbox: if checked, this automation only runs when no other sessions are active (background work mode)

#### Run History

Clicking an automation expands its run history:
- List of past runs with timestamp, status, duration
- Click a run to see the full session transcript it created
- Failed runs show the error message

### The Scheduler (Backend)

A background process that:
- Checks every 60 seconds which automations are due
- Spawns a new session with the automation's prompt
- Records the run in history
- Respects the "run during idle" flag — only runs those when no sessions are active
- Handles missed runs (if the app was off, run on next startup if within a grace period)

### Idle Queue

A special concept: automations marked "run during idle" go into a queue. When the system detects all sessions are idle for 2 minutes, it starts the next queued automation. This is how you get background work done without interfering with interactive sessions.

### Smart Features

- **Conflict prevention**: don't run two automations in the same workspace simultaneously
- **Failure handling**: if an automation fails 3 times in a row, auto-disable it and notify
- **Result chaining**: the `{last_result}` variable lets automations build on previous work
- **Max runtime**: automations auto-kill after 30 minutes (configurable)

### Empty State

"No automations yet — create one to make your agents work on autopilot."

---

## Acceptance Criteria

- [ ] Create automations with name, schedule, prompt, agent, workspace
- [ ] Schedule presets (hourly, daily, weekly) and custom cron
- [ ] Enable/disable toggle per automation
- [ ] "Run now" button for manual trigger
- [ ] Run history with status and session links
- [ ] Backend scheduler runs due automations automatically
- [ ] "Run during idle" flag works — only runs when no sessions active
- [ ] Idle queue processes background automations
- [ ] Failure handling: auto-disable after 3 consecutive failures
- [ ] Prompt template variables ({workspace}, {date}, {last_result})

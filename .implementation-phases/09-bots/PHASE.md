# Phase 09: Bots

> **Goal**: Create persistent, autonomous bot agents inspired by GrokBots and openBoot — agents that run on their own, triggered by schedules, webhooks, or idle time.

---

## What to Build

A Bots management page where you create and configure persistent bot personalities that operate autonomously in the background.

### The Concept

A bot is a named agent persona with:
- A personality (system prompt that defines how it behaves)
- A set of skills it can use
- Triggers that activate it (schedule, webhook, idle detection, or manual)
- Its own workspace context

Think of bots as employees you hire: you define their job, give them tools, and they work when conditions are met.

### The View

#### Bots List

A grid of bot cards, each showing:
- Bot name + avatar (color/icon)
- Personality summary (1 line)
- Status: Active (green pulse), Idle (dim), Running (green pulse), Error (red)
- Last active time
- Run count
- Triggers summary ("Daily at 9 AM + idle")
- Quick actions: Trigger now, Edit, Pause/Resume, Delete

#### Create Bot Wizard

A step-by-step wizard to create a new bot:

**Step 1: Identity**
- Name
- Description
- Avatar color/icon picker

**Step 2: Personality**
- Large textarea for the personality/system prompt
- Template buttons: "Code Reviewer", "Documentation Writer", "Test Runner", "DevOps Monitor", "Blank"
- Preview of how the personality reads

**Step 3: Capabilities**
- Agent/provider selector
- Skills picker (multi-select from installed skills)
- Workspace selector

**Step 4: Triggers**
- Trigger type selector:
  - Schedule (cron expression + timezone)
  - Webhook (generates a URL that triggers the bot when called)
  - Idle (fires when system is idle for N minutes)
  - Manual only
- Multiple triggers per bot allowed
- For each trigger: configure cooldown (min time between runs)

**Step 5: Review**
- Summary of all settings
- "Create Bot" button

#### Bot Detail Page

Clicking a bot opens its detail page:
- Full personality text
- Trigger list with edit/run buttons
- Run history (list of past runs with timestamp, trigger, status, link to session)
- Statistics: total runs, success rate, avg runtime
- Edit/Delete buttons

### Bot Engine (Backend)

A background process that:
- Evaluates all enabled bots every 60 seconds
- Checks if any triggers are due
- Respects cooldowns (don't fire the same trigger twice within the cooldown window)
- Spawns a session for the bot with its personality injected into the system prompt
- Records each run in history
- Handles the webhook endpoint (a simple HTTP endpoint that queues a bot run)

### openBoot Integration

Support importing bot definitions from openBoot format:
- File upload (.json or .yaml bot definition)
- URL to an openBoot bot definition
- Parse and convert to AgentDeck's bot format

### Safety & Limits

- Max 5 concurrent bot runs globally
- Per-bot max runtime (default 30 min, configurable)
- Auto-disable bot after 5 consecutive failures
- Webhook triggers require an API key (per-bot, shown in the UI)

### Empty State

"No bots yet — create your first autonomous agent to handle tasks on autopilot."

---

## Acceptance Criteria

- [ ] Create bots with name, personality, agent, skills, triggers
- [ ] Wizard flow: Identity → Personality → Capabilities → Triggers → Review
- [ ] Personality templates (Code Reviewer, Docs Writer, etc.)
- [ ] Trigger types: schedule, webhook, idle, manual
- [ ] Backend bot engine evaluates triggers and spawns sessions
- [ ] Webhook endpoint generates trigger URLs with API keys
- [ ] Run history with status, duration, session links
- [ ] Import from openBoot format
- [ ] Safety limits: max concurrent runs, auto-disable on failures

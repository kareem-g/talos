# Future Remote-Control Features

This document is a reusable implementation prompt for extending AgentDeck's mobile and desktop semantic chat experience.

## Feature Ideas

### Chat Input Actions

- Send a normal agent message.
- Run a shell command through an explicit command mode.
- Choose a workspace, project, branch, or worktree as context.
- Attach one or more files.
- Attach a directory or workspace snapshot.
- Add selected code ranges as context.
- Add the current terminal selection as context.
- Add the current diff as context.
- Add recent task activity as context.
- Add a previous message as context.
- Clear all attached context before sending.
- Queue a follow-up while the agent is working.
- Reorder or remove queued follow-ups.
- Edit and resend a previous user message.
- Copy a previous message.
- Cancel a queued message.
- Retry a failed message.
- Stop the active task.
- Open the terminal/debug surface.
- Open the current task diff.
- Open the workspace file browser.

### Command Mode

- Provide an explicit `Run command` composer mode.
- Show the selected workspace and current working directory.
- Validate command text before sending.
- Show command confirmation when required.
- Support command history.
- Support command suggestions from the current project.
- Stream command output into the terminal surface.
- Emit semantic `command_started` and `command_finished` events.
- Show exit code, duration, and cancellation state.
- Keep command output separate from assistant messages.
- Respect the existing approval and authorization model.

### Context Mode

- Add files by path.
- Search and select files from the workspace.
- Add git diff context.
- Add branch and repository metadata.
- Add terminal output context.
- Add previous task messages.
- Add selected activity events.
- Add a context size/token estimate.
- Show attached context chips above the composer.
- Allow removing individual context items.
- Persist context used by a submitted message.
- Avoid silently sending stale context after a workspace changes.

### Agent And Model Selection

- Display the active agent in the composer.
- Display the active model when the agent exposes models.
- Load agents and models from backend capabilities.
- Do not hardcode provider names or model names in the UI.
- Show unavailable agents/models as disabled with an explanation.
- Show the active provider/model in task metadata.
- Record model changes as semantic events.
- Preserve the current CLI process when switching models is supported.
- Do not replace the CLI executable when switching a model inside a task.
- If the CLI cannot switch in place, explain that clearly.
- If switching requires a new task, offer a `Start new task with this model` action.
- Preserve workspace, context, and conversation when starting a replacement task where supported.

### In-Session Model Switching

This feature changes the active model or provider configuration inside the existing CLI task. It must not silently change the executable or create a different task.

Required behavior:

- Ask the backend whether the active agent supports in-session model switching.
- Send a structured `model_switch` request rather than a terminal string.
- Validate the requested model against the agent's advertised models.
- Ask the provider adapter to perform the switch.
- Emit `model_switch_started`.
- Emit `model_changed` after confirmed success.
- Emit `model_switch_failed` with a useful reason on failure.
- Keep the current task ID unchanged after a successful switch.
- Keep the current CLI process unchanged after a successful switch.
- Show the old and new model in the conversation history.
- Disable the selector while a switch is pending.
- Prevent duplicate switch requests.
- Reconcile the active model after WebSocket reconnect and HTTP snapshot refresh.

### Mobile Navigation

- Home and workspaces.
- Task conversation.
- Task activity.
- Terminal/debug view.
- Files and diff view.
- Device connection state.
- Optional mobile task settings.
- No desktop-only settings such as MCP, tunnels, or binary configuration unless explicitly needed.

### Desktop Web Dashboard

- Use the same semantic `Message` and `AgentEvent` data as mobile.
- Keep the full terminal/xterm surface available.
- Add a desktop composer with the same command/context/model actions.
- Add a resizable semantic conversation and terminal split view.
- Add a question card for interactive agent questions.
- Add approval cards for permission events.
- Add tool activity cards.
- Add file edit and diff cards.
- Add command cards with duration and exit code.
- Add model switch controls.
- Add context attachment inspection.
- Add task event timeline.
- Add desktop/mobile synchronization indicators.
- Ensure answering or changing state on one device updates the other.

### Semantic Events

Add or extend normalized events such as:

- `message_created`
- `message_queued`
- `message_sent`
- `message_failed`
- `command_started`
- `command_finished`
- `context_attached`
- `context_removed`
- `thinking_started`
- `thinking_finished`
- `tool_started`
- `tool_finished`
- `search_started`
- `search_finished`
- `file_read`
- `file_edited`
- `permission_required`
- `permission_resolved`
- `question_started`
- `question_answered`
- `question_cancelled`
- `model_switch_started`
- `model_changed`
- `model_switch_failed`
- `agent_waiting`
- `agent_completed`
- `agent_error`
- `session_cancelled`

Every event should contain:

- `event_id`
- `session_id`
- `sequence`
- `timestamp`
- `kind`
- `payload`
- Optional `duration_ms`

### Persistence

Keep these concepts separate:

- `sessions`
- `messages`
- `agent_events`
- `questions`
- `approvals`
- `terminal_output`
- `context_attachments`
- `model_changes`
- Optional command history

Do not persist raw terminal output as an assistant message.

Persist enough state for:

- Browser refresh.
- Mobile refresh.
- WebSocket reconnect.
- Multiple connected devices.
- Historical task review.
- Pending commands.
- Pending questions.
- Pending approvals.
- Model selection reconciliation.

### WebSocket Protocol

Keep terminal and semantic messages separate.

Server to client examples:

```json
{
  "type": "TerminalOutput",
  "payload": {
    "session_id": "session-id",
    "data": "raw PTY bytes"
  }
}
```

```json
{
  "type": "Message",
  "payload": {
    "message": {
      "id": "message-id",
      "session_id": "session-id",
      "role": "assistant",
      "content": "Readable assistant text",
      "timestamp": "..."
    }
  }
}
```

```json
{
  "type": "AgentEvent",
  "payload": {
    "event": {
      "event_id": "event-id",
      "session_id": "session-id",
      "sequence": 42,
      "timestamp": "...",
      "kind": "model_changed",
      "payload": {
        "old_model": "old-model",
        "new_model": "new-model"
      }
    }
  }
}
```

Client to server examples:

```json
{
  "type": "Input",
  "payload": {
    "session_id": "session-id",
    "data": "Follow-up message"
  }
}
```

```json
{
  "type": "RunCommand",
  "payload": {
    "session_id": "session-id",
    "command": "cargo check",
    "cwd": "/workspace/project"
  }
}
```

```json
{
  "type": "AttachContext",
  "payload": {
    "session_id": "session-id",
    "items": [
      {
        "kind": "file",
        "path": "src/app.tsx"
      }
    ]
  }
}
```

```json
{
  "type": "SwitchModel",
  "payload": {
    "session_id": "session-id",
    "model_id": "provider-model-id"
  }
}
```

Use event IDs and sequence numbers for deduplication and reconnect replay.

### Provider Adapter Requirements

Extend the existing adapter abstraction rather than adding provider branches throughout the application.

Conceptually:

```rust
trait AgentAdapter {
    fn detect(&self) -> bool;
    fn build_command(&self, request: &SessionStartRequest) -> Result<Vec<String>>;
    fn capabilities(&self) -> AgentCapabilities;
    fn parse_structured_event(&self, payload: &serde_json::Value) -> Option<AgentEvent>;
    fn answer_question(&self, question: &Question, answer: &QuestionAnswer) -> Result<Vec<String>>;
    fn run_command(&self, request: &CommandRequest) -> Result<Vec<String>>;
    fn switch_model(&self, model_id: &str) -> Result<ProviderAction>;
    fn install_hooks(&self, session_id: &str) -> Result<()>;
}
```

Provider-specific behavior belongs inside the provider adapter.

The common backend should only understand normalized AgentDeck concepts.

## Reusable Implementation Prompt

Use the following prompt for future feature work:

```text
You are extending the existing AgentDeck remote-agent application.

First inspect the repository and identify the existing implementation for:

- PTY spawning and input forwarding
- xterm.js terminal rendering
- semantic AgentEvent and Message streams
- WebSocket reconnect and replay
- SQLite persistence
- mobile task chat
- desktop semantic transcript
- approvals and questions
- provider adapters
- agent capabilities

Do not rewrite the application or create a parallel architecture.

The core rule is:

PTY terminal stream and semantic agent stream must remain separate.

PTY output must go only to TerminalOutput and xterm.js.

Semantic UI must consume Message and AgentEvent records.

Do not parse ANSI, cursor movement, spinners, terminal screen text, or xterm DOM output as the primary semantic source.

Implement the requested feature using:

1. A generic AgentDeck event model.
2. Provider adapter capabilities.
3. Structured provider mechanisms where available.
4. Safe generic CLI fallback where structured support is unavailable.
5. Backend validation and authorization.
6. SQLite persistence.
7. Authenticated WebSocket messages.
8. Mobile and desktop semantic renderers.
9. xterm.js for raw terminal behavior only.

For chat-input features, support as appropriate:

- normal messages
- command mode
- workspace/context attachments
- file and diff context
- queued follow-ups
- agent/model selection
- in-session model switching without replacing the CLI executable
- tool activity
- questions
- permissions
- file edits
- search events
- command events

For every new interaction, implement the complete flow:

agent/provider
  -> structured event
  -> backend validation
  -> persistence
  -> authenticated WebSocket
  -> mobile and desktop UI
  -> user action
  -> validated backend command
  -> provider adapter
  -> agent continuation
  -> synchronized completion event

The implementation must support:

- browser refresh
- mobile refresh
- WebSocket reconnect
- multiple connected devices
- duplicate action prevention
- stale action rejection
- agent/session termination
- offline and reconnect states
- arbitrary CLIs without fake provider-specific assumptions

Add or update database migrations only when needed.

Do not claim the feature works based only on a rendered mockup.

Run:

- frontend TypeScript/build checks
- backend cargo check/tests
- a real supported CLI flow
- a generic unsupported-CLI fallback flow
- persistence and refresh verification
- reconnect verification
- multi-device event verification where possible

Report:

- files changed
- event schema
- database changes
- backend flow
- WebSocket messages
- provider adapter changes
- mobile UI changes
- desktop UI changes
- terminal/xterm behavior
- generic fallback behavior
- tests performed
- limitations and unsupported capabilities
```

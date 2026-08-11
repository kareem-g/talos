# AgentDeck Mobile Remote Control

## Summary

AgentDeck now has a dedicated mobile remote-control surface instead of treating mobile as a compressed desktop dashboard.

The generic launch path also keeps CLI flags out of the shared command builder. The PTY sets the project working directory, and an initial task prompt is delivered through stdin so arbitrary executables are not forced to accept flags such as `--cwd` or `--prompt`.

Normal transcript output is also sanitized at the PTY boundary. ANSI CSI/OSC sequences, cursor controls, screen chrome, and terminal echo are removed from chat events. Raw PTY bytes are available only through the explicit debug event.

The mobile Terminal / Debug surface uses `@xterm/xterm` with `@xterm/addon-fit` to render the raw PTY stream, including terminal colors and cursor behavior, instead of a hand-written ANSI renderer.

Claude progress timings such as `✻ Churned for 3s` and `Thought for 5s` are emitted as subdued `thinking` activity metadata below the agent response.

The PTY and semantic streams are now independent:

```text
CLI PTY bytes -> TerminalOutput -> xterm.js terminal

Claude hooks / provider adapter -> AgentEvent + Message -> WebSocket + SQLite + semantic UI
```

Unsupported CLIs retain PTY functionality and emit only safe lifecycle fallback events rather than guessed tool/file events.

Approval requests and resolutions are persisted independently, so refreshing the mobile task cannot resurrect a resolved approval or produce `Approval request not found` for a previously loaded request.

Interactive questions are also first-class semantic interactions. Claude `AskUserQuestion` hook payloads become persisted `question_started` events and `questions` records. Answers are validated for option IDs, single/multiple selection, custom text, session ownership, and pending status before the Claude adapter sends provider-specific terminal input. `question_answered` is broadcast to all connected clients.

Pending question cards are rendered at the current end of the semantic conversation, not in a fixed header slot. `AskUserQuestion` is not rendered as a duplicate permission card.

Interactive CLI prompts are detected as `waiting_for_input` rather than remaining indefinitely in `running`. CLI authentication warnings are treated as prompt chrome, not as agent permission approvals.

Primary mobile routes:

- `/mobile/pair`
- `/mobile`
- `/mobile/task/:id`

## Mobile Experience

- Dark, compact mobile-first visual system with safe-area support.
- Connected desktop header with connection state and refresh control.
- Workspace cards grouped from backend session/project data.
- Expandable task rows with generic agent identity and task status.
- Dedicated task conversation view with user messages and agent responses.
- Compact activity timeline for plans, tool activity, file changes, and errors.
- Approval cards with Allow, Always in project, and Deny actions.
- Real stop control connected to the backend PTY process.
- Bottom composer with multiline input, follow-up placeholder, context action, and agent selector.
- Terminal/debug view retained behind an explicit control.
- Loading, reconnecting, offline, sync failure, revoked-device, and expired-session states.
- PWA metadata and mobile viewport/safe-area configuration.

## Pairing And Authentication

- Desktop pairing page is available at `/pairing`.
- Desktop generates a real QR code using `qrcode.react`.
- Pairing URLs use a short-lived, random, single-use offer secret.
- Local pairing URLs select a reachable LAN address when available.
- Cloudflare and Tailscale host configuration is respected when configured.
- Device credentials are stored as hashes in SQLite.
- Device records include identity, fingerprint, paired time, last seen, and revocation state.
- Mobile API requests use bearer device credentials.
- Mobile route authentication is enforced by Axum middleware.
- Mobile WebSocket authentication is required before events are sent.
- Device revocation emits a realtime event and invalidates subsequent API/WebSocket commands.

## Backend Realtime Flow

HTTP provides the initial source-of-truth snapshot:

- `GET /api/mobile/me`
- `GET /api/mobile/snapshot`
- `GET /api/mobile/agents`
- `POST /api/mobile/sessions`
- `GET /api/mobile/sessions/:id`
- `POST /api/mobile/sessions/:id/kill`

Realtime updates use:

- `GET /ws/mobile`
- Authenticated WebSocket handshake.
- Event IDs and timestamps.
- In-memory replay buffer for reconnect cursors.
- Session updates.
- Transcript chunks.
- Agent activity.
- Approval requests and resolutions.
- State changes.
- Device revocation events.

## Agent And Task Support

The mobile client consumes generic AgentDeck task/session data. It does not branch on Claude, Codex, OpenCode, or another specific CLI.

The backend supports configured agents and custom executable creation through the mobile session request. Current agent capabilities are exposed to the client, including streaming, approval, plan, file-change, terminal, and model-switch support.

Model switching is communicated honestly: the current backend reports it as unsupported during an active task instead of pretending a switch succeeded.

## Persistence And Approval Flow

- User messages are persisted once and broadcast as structured user transcript events.
- PTY output is persisted as agent transcript data.
- Heuristic parser events generate activity, plan, diff, tool, and approval messages.
- Approval responses are forwarded to the PTY process.
- Stop requests terminate the tracked process and update the task state.
- Child process completion is reflected in session state.

## Database Changes

- `backend/migrations/002_device_credentials.sql`
  - Adds device token hashes and revocation timestamps.
- `backend/migrations/003_device_token_index.sql`
  - Rebuilds the device token index as a partial unique index for migration safety.
- `backend/migrations/004_semantic_streams.sql`
  - Adds separate `messages`, `agent_events`, and `terminal_output` tables.
- `backend/migrations/005_semantic_legacy_backfill.sql`
  - Backfills legacy user/system messages and raw terminal output into the separated stores.
- `backend/migrations/006_questions.sql`
  - Persists pending, answered, cancelled, expired, and failed interactive questions.

## Files Added

- `backend/src/agent_events.rs`
- `backend/src/questions.rs`
- `backend/src/auth/devices.rs`
- `backend/migrations/004_semantic_streams.sql`
- `backend/migrations/005_semantic_legacy_backfill.sql`
- `backend/migrations/006_questions.sql`
- `dashboard/public/manifest.webmanifest`
- `dashboard/src/components/MobileApp.tsx`
- `dashboard/src/components/QuestionCard.tsx`
- `dashboard/src/components/XtermTerminal.tsx`
- `dashboard/src/components/MobilePairingPage.tsx`
- `dashboard/src/components/PairingPage.tsx`
- `dashboard/src/hooks/useMobileWebSocket.ts`
- `dashboard/src/lib/auth.ts`
- `dashboard/src/types/mobile.ts`

## Files Updated For Mobile Support

- `backend/src/api/middleware.rs`
- `backend/src/api/routes.rs`
- `backend/src/auth/mod.rs`
- `backend/src/config/mod.rs`
- `backend/src/daemon/mod.rs`
- `backend/src/daemon/server.rs`
- `backend/src/pty/manager.rs`
- `backend/src/pty/parser.rs`
- `backend/src/sessions/manager.rs`
- `backend/src/hooks/installer.rs`
- `backend/src/hooks/server.rs`
- `backend/src/agents/mod.rs`
- `backend/src/websocket/broadcast.rs`
- `backend/src/websocket/handler.rs`
- `backend/src/websocket/mod.rs`
- `dashboard/index.html`
- `dashboard/package.json`
- `dashboard/src/App.tsx`
- `dashboard/src/components/Header.tsx`
- `dashboard/src/components/PairingModal.tsx`
- `dashboard/src/hooks/useAuth.ts`
- `dashboard/src/index.css`
- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/terminalText.ts`
- `dashboard/src/components/XtermTerminal.tsx`

## Verification Performed

- `pnpm build`
- `pnpm exec tsc --noEmit`
- `cargo check --workspace`
- `cargo test --workspace`
- `git diff --check`
- Vite preview checks for `/mobile` and `/mobile/pair`.
- Live unauthenticated mobile API rejection with HTTP `401`.
- Live pairing and single-use offer replay rejection.
- Live authenticated mobile snapshot and device metadata requests.
- Live authenticated WebSocket handshake and event replay.
- Live custom executable task creation.
- Live PTY stop and exited-state update.
- Live user message persistence and realtime transcript delivery.
- Live approval request emission and denial response.
- Live device revocation event and post-revocation HTTP `401`.
- Live ANSI sanitization verification with a Claude-style terminal frame.
- Live activity extraction verification for an editing event.
- Live Claude CLI verification reaching `waiting_for_input` without leaking its authentication banner.
- Live Claude structured hook verification with separate assistant message, lifecycle events, and terminal output.
- Live approval persistence and refresh-resolution verification.
- Live Claude structured question creation, option persistence, answer validation, and answer delivery verification.

## Current Limitations

- The legacy desktop `/ws` and desktop API surface remain for compatibility with the existing desktop dashboard.
- Initial prompts are sent through interactive stdin; one-shot agents that require a provider-specific command-line prompt mode need an adapter capability for that mode.
- ANSI sanitization is defensive and heuristic; a full terminal emulator would be needed to reproduce every screen-rendered TUI exactly.
- Existing sessions that were already orphaned or manually stopped before this state fix remain stopped; newly launched sessions use the corrected state transitions.
- Claude hook coverage depends on the installed Claude Code version and its hook settings support; unsupported providers use the generic lifecycle fallback.
- Agent activity parsing is currently heuristic and should eventually be replaced by adapter-specific structured event parsers.
- Full diff inspection is not yet connected to the existing desktop `DiffViewer`.
- Active-task model switching is unsupported unless an agent backend reports that capability.
- Web deployment persists the device credential in browser storage; native secure storage would require a native wrapper or platform-specific client.
- Physical iOS and Android Safari testing was not available in this environment.
- `pnpm lint` cannot run because the repository does not currently contain an ESLint 9 flat configuration.

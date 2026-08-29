# Trajectories: record & replay

A *trajectory* is the ordered, append-only JSONL recording of every `WsMessage`
a session produced — the exact stream the dashboard would have rendered. It is
the foundation for deterministic replay, evaluation, and the memory feature.

## File layout

- Recording files: `$XDG_DATA_HOME/agentdeck/trajectories/<session-id>-<ts>.jsonl`
  (usually `~/.local/share/agentdeck/trajectories/…`).
- Format: one JSON object per line. Each line is a serialized `WsMessage`
  (tagged `{"type": "AgentEvent", "payload": {...}}`, etc.) — the same type the
  WebSocket layer sends to the dashboard, so a trajectory is trivially `jq`-able
  and cheap to scan line-by-line.

## CLI usage

```bash
# Start recording a session's events to a JSONL file
agentdeck trajectory record <session-id> [-o out.jsonl]

# Stop recording; flushes the file and reports where it landed
agentdeck trajectory stop <session-id>

# Replay a trajectory through the daemon so connected dashboards render it
agentdeck trajectory replay <file.jsonl> [--session target-id]

# Export a session's persisted events from the database as JSONL
agentdeck trajectory export <session-id> [-o out.jsonl]
```

Replaying into a **new/empty session** (`--session <fresh-id>`) gives the
cleanest "watch the run again" view: events are re-broadcast with fresh
sequence numbers, and the dashboard renders them as a normal live stream.

## HTTP API

| Method | Path | Body / Notes |
|--------|------|--------------|
| POST | `/api/trajectories/record` | `{ "session_id": "...", "path": "<optional>" }` |
| POST | `/api/trajectories/stop` | `{ "session_id": "..." }` |
| POST | `/api/trajectories/replay` | `{ "path": "...", "session_id": "<optional re-target>" }` |
| GET | `/api/sessions/{id}/trajectory` | Exports the session's persisted events as `application/x-ndjson` |

## Architecture

All agent backends (claude_stream, api, acp, pi_stream, pty) publish events
through the same [`BroadcastHub`](../backend/src/websocket/broadcast.rs). A
recorder is simply a subscriber that filters by `session_id` and appends
matching lines to a file; replay reads the file and re-broadcasts each line
through the hub, so any connected client renders the run without re-running the
agent.

See [`trajectory.rs`](../backend/src/trajectory.rs) for the recorder/player,
and [`api/trajectory.rs`](../backend/src/api/trajectory.rs) for the HTTP
handlers.

## The agent harness

Trajectories capture what agents *did*. The **harness** is the unified turn
interface that drives them: `backend/src/agents/harness.rs` defines the
`AgentTurn` trait (one turn lifecycle: broadcast user message → mark running →
stream events → complete), implemented by each structured-stream backend:

| Backend | `start_turn` | Resident process? |
|---------|--------------|-------------------|
| `ApiTurn` (custom OpenAI/Anthropic APIs) | `spawn_api_turn` | No — on-demand HTTP |
| `PiTurn` | `spawn_pi_turn` | No — on-demand per prompt |
| `AcpTurn` (opencode, copilot, …) | broadcast + `send_prompt` | Yes |
| `ClaudeTurn` | broadcast + `send_prompt` | Yes |

The websocket dispatchers (`handle_input`, `handle_command`) route through
`resolve_turn(state, session)` instead of per-backend if-chains, so adding a
backend means implementing `AgentTurn` and registering it in `resolve_turn` —
the Stage 3 path for DeepSeek or any OpenAI-compatible provider.

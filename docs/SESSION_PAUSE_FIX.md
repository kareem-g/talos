# Session Pause Verification

## Symptom

The AgentDeck session paused when a subagent was requested. Claude reported:

```text
MCP tool mcp__agentdeck__request_permission not found. Available MCP tools: none
```

## Root Cause

The daemon had been rebuilt while the previous daemon process was still running. On Linux, `current_exe()` can then report the running executable as:

```text
/path/to/agentdeck-backend (deleted)
```

AgentDeck wrote that value into the per-session MCP config. Claude could not launch the helper at that path, so it discovered no MCP tools and paused before the first turn.

## Fix

`claude_permission_args` now normalizes the Linux ` (deleted)` suffix and refuses to generate a permission config when the resulting executable is not a file. The normalization is covered by backend unit tests.

## Verification

- `cargo test -p agentdeck-backend permissions::tests`: 2 passed
- `cargo test -p agentdeck-backend`: 95 passed, 1 ignored
- The MCP helper returned `initialize` and `tools/list` responses containing `request_permission`.
- Claude 2.1.220 started with `--permission-prompt-tool mcp__agentdeck__request_permission` and returned `MCP_OK`.
- `GET http://localhost:9120/health` returned `{"platform":"linux","status":"ok"}`.

## Operational Note

Restart the daemon after rebuilding it so the running process loads the new code. The path normalization also protects sessions when a rebuild replaces the binary in place.

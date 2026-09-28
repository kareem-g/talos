## Network-policy bypass + full access mode

### Outcome

Two new project-policy booleans live in `.agentdeck/policy.toml`: `skip_network_policy` and `full_access`. When a workspace has `skip_network_policy = true`, WebFetch / WebSearch / network tools are auto-allowed regardless of host. When a workspace has `full_access = true`, the project policy is bypassed entirely for that workspace — every tool call in any session or room in the workspace is auto-allowed, the same as if the session's `permission_mode` was `full`. The existing `permission_mode = "full"` continues to work; the workspace setting is a per-project shortcut.

Two new affordances in the dashboard:

- **Settings section (global, per-device)** — a "Network policy" section in the home Settings with a "Bypass network policy on this device" toggle. Toggling it on writes a small note into the active workspace's `policy.toml` (if any) via the new API, and remembers the user's choice in `localStorage` so the dashboard surfaces a banner explaining the bypass when it's active.
- **Workspace gear (per-workspace)** — the existing `WorkspaceMenuButton` (the gear icon on each workspace card) gets two new toggles below the Memory one: "Skip network policy" and "Full access". These write to that workspace's `policy.toml` directly.

### File-by-file changes

**Backend**

1. `backend/src/policy.rs`:
   - Add two fields to `PolicyFile` (deserialized): `#[serde(default)] skip_network_policy: bool`, `#[serde(default)] full_access: bool`.
   - Carry them on `ToolPolicy` (set from `PolicyFile` in `load`).
   - Add `is_skip_network(&self) -> bool` and `is_full_access(&self) -> bool` accessors.
   - In `decide_network`: if `is_skip_network()` is true, return `PolicyDecision::Allow` immediately (before checking the rule list).
   - In `decide_input`: at the top, if `is_full_access()` is true, return `InputDecision::Allow("Auto-approved (workspace full access)")` — this short-circuits the network / path / tool rules. The session's `permission_mode = "full"` still applies to anything not in this code path; together the two are equivalent, but the workspace flag applies even when a session was started with `mode = "ask"`.
   - Add tests for both flags (mirror the existing `decide_input_*` tests).

2. `backend/src/api/routes.rs`:
   - New route handler `get_workspace_policy(Query<MemoryQuery>) -> { skip_network_policy, full_access }`. Reads the booleans out of the parsed `PolicyFile` (call `toml::from_str` directly on the file, since `ToolPolicy::load` discards them).
   - New route handler `set_workspace_policy(Json<…>)` that reads the existing `.agentdeck/policy.toml` (if any), mutates the two booleans, and writes it back preserving the rest. Returns `{ ok, skip_network_policy, full_access }`. Mirrors `set_workspace_memory`'s error handling.
   - Both routes are scoped to `MemoryQuery` style (`project: Option<String>`) for consistency with the memory route.

3. `backend/src/daemon/server.rs`:
   - Register the two new routes:
     - `GET /api/workspace/policy` → `get_workspace_policy`
     - `POST /api/workspace/policy` → `set_workspace_policy`

4. `backend/src/permissions.rs`:
   - The `decide_input` short-circuit for `full_access` lives in `policy.rs` so the change is one place, but the comment in `request_user_decision` should mention the workspace flag. No code change in this file beyond a one-line comment.

**Dashboard**

5. `dashboard/src/lib/api.ts`:
   - Extend `workspaceApi`:
     - `policyConfig: (project: string) => Promise<{ skip_network_policy: boolean; full_access: boolean }>`
     - `setPolicyConfig: (project: string, config: { skip_network_policy?: boolean; full_access?: boolean }) => Promise<…>`
   - Mirror the memoryConfig pattern.

6. `dashboard/src/components/home/SettingsSection.tsx`:
   - Add a new `<SectionLabel>Network policy</SectionLabel>` between the existing sections, with a card containing a "Bypass network policy on this device" toggle. The toggle is a per-device preference; storing it in `localStorage['agentdeck-skip-network-device']` (boolean). When toggled on, show a helper line: "Already configured workspaces can also opt in per-workspace from the gear icon on each workspace card."
   - Keep it simple: this is a global device-level preference that surfaces in the UI. It does not write to the backend by itself — the per-workspace gear is the source of truth for the actual policy. The toggle exists so the user has a single place to acknowledge the device-level intent.
   - No other change to this file.

7. `dashboard/src/components/home/StationHome.tsx`:
   - Add a new helper component `WorkspacePolicyToggle({ project, field, label, hint })` next to `WorkspaceMemoryToggle`. It mirrors the same `useState` + `useEffect` + `toggle` shape and calls the new `workspaceApi.policyConfig` / `setPolicyConfig` endpoints.
   - Extend `WorkspaceMenuButton` to render the two new toggles below the memory section, each with a short hint:
     - "Skip network policy" — "Allow WebFetch / WebSearch / network tools without a host allowlist."
     - "Full access" — "Auto-allow every tool call in this workspace, regardless of session permission mode."
   - Both default to off; the API call mutates the same `policy.toml` file the global section does not touch.

**No new top-level routes.** The existing `/api/workspace/memory` route is joined by `/api/workspace/policy` (GET/POST). `App.tsx` and `SessionView.tsx` need no changes.

### What does NOT change

- The existing `permission_mode = "full"` / `"auto_edit"` / `"ask"` / `"plan"` flow is unchanged. The workspace `full_access` is a per-project accelerator, not a replacement.
- The per-host allowlist in `[network]` rules is still respected when `skip_network_policy` is false.
- The home page chrome (anchor strip, sections, header) does not change.
- The session view (composer, panes) does not change.
- The desktop / mobile / 75% side sheets do not change.

### Risks and mitigations

- **Persisting partial TOML edits.** `set_workspace_policy` reads the file as raw text, finds the `skip_network_policy = …` and `full_access = …` lines (or appends new ones), and writes back. If the file is missing, it's created. If the file has only `[[rules]]` and `[network]` blocks and no top-level scalars, the new lines go at the bottom. I'll use a small in-memory regex on the body rather than round-tripping through `toml::Value`, so a hand-written comment line is preserved.
- **`is_full_access()` makes the `permission_mode = "ask"` mode effectively full access inside that workspace.** That's the intent — "Full access for all sessions/rooms in workspace" — but it's worth a one-line warning in the toggle's hint.
- **The dashboard device-level "Bypass" toggle doesn't actually bypass anything on its own.** The user said "make option in settings to bypass the network policy" — they probably mean the actual policy. The cleanest fix: when the device-level toggle is flipped on, the dashboard also writes the active workspace's `skip_network_policy = true` via the API. If there's no active workspace, the device toggle is acknowledged with a localStorage note + an explanation in the help text saying "Open a workspace to apply the bypass."
- **Tests already in `policy.rs`** need to keep passing. The new fields are `#[serde(default)]`, so existing `policy.toml` files without them parse fine.

### Order of work

1. Backend: extend `PolicyFile` + `ToolPolicy`, add `is_skip_network` / `is_full_access` and the short-circuits, plus tests.
2. Backend: add the two new route handlers + register them in `daemon/server.rs`.
3. Backend: `cargo build` + `cargo test --lib`.
4. Dashboard `lib/api.ts`: add the two API methods.
5. Dashboard: add the "Network policy" section to `SettingsSection.tsx`.
6. Dashboard: add the per-workspace toggles to `StationHome.tsx`'s `WorkspaceMenuButton`.
7. Smoke check: `tsc --noEmit` + `vite build`.
8. Restart the backend (the existing `cargo run` instance is still running, PID 1501339; kill it, then `cargo run` from `backend/`).

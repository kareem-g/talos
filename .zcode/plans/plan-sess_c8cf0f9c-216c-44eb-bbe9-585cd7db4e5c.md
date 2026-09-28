## One-click Headscale connect

### Goal
From the dashboard: type the Headscale URL + API key, click "Up." The agent runs `tailscale up --login-server=...` (auto-elevating if needed), logs in, mints a preauth key via the Headscale API, and renders a QR code the phone scans to join the same tailnet. No terminal commands, no manual `sudo`.

### Backend changes

**1. `backend/src/tunnel/tailscale.rs` — privilege-aware runner + error classifier**
- New `run_privileged(args: &[&str])` that:
  1. Tries `tailscale <args>` as the current user.
  2. On `checkprefs access denied` (or any stderr containing that string), runs `pkexec tailscale set --operator=$USER` (graphical sudo) — if `pkexec` is unavailable, tries `sudo -n tailscale set --operator=$USER` and falls back to plain `sudo` so the user gets a terminal prompt.
  3. Retries the original command. Persists nothing — `tailscaled` remembers the operator.
- New `classify_error(stderr: &str) -> TunnelErrorKind` returning an enum:
  `NeedsAuthorization | UnreachableControlPlane | InvalidAuthKey | TailscaleFailed(String)`.
- New `pub async fn login_with_recovery(server, key, hostname) -> Result<TunnelInfo>` that wraps the existing `login()` and translates classifier output to `TunnelStatus::Error("...")` with a structured payload (the JSON body uses a new `error_kind` field).

**2. `backend/src/headscale/mod.rs` (new)** — REST client
- `HeadscaleClient { base_url, api_key }`.
- `create_preauth_key(user, reusable, ephemeral, expiry_secs) -> Result<{key, expires_at}>` — `POST <base>/api/v1/preauthkey` with `Authorization: Bearer <api_key>`, JSON body `{user, reusable, ephemeral, expiration}`.
- Parses Headscale's `{"preauthKey": {"key": "..."}}` envelope.
- Timeouts at 10s; surfaces `UnreachableControlPlane` on connect failures, `InvalidApiKey` on 401/403.

**3. `backend/src/tunnel/headscale.rs` — wire it together**
- On `start()`: build a `HeadscaleClient` from `cfg.tunnel.headscale.{api_key,user}` if present.
- After successful login, if API key is present, call `create_preauth_key(...)` and put the resulting key into `TunnelInfo.token` (field already exists).
- Add `pub async fn ensure_operator()` that just runs the operator-set step — exposed to the dashboard via a new endpoint so the user can pre-emptively authorize before retrying.

**4. `backend/src/config/settings.rs` — persist the API key**
- New `HeadscaleConfig { api_key: Option<String>, user: String }` (default user `agentdeck`).
- Add to `TunnelConfig` alongside `tailscale` and `cloudflare`. Defaults in the existing defaults block.

**5. `backend/src/api/routes.rs` + `backend/src/daemon/server.rs` — two new routes**
- `POST /api/tunnel/headscale/authorize` → runs `ensure_operator()`, returns `{ok: bool, error?: string}`. Used by the dashboard's "Authorize" button.
- `POST /api/tunnel/headscale/preauth` → body `{reusable?, expiry?}`, returns `{key, expires_at}`. Lets the UI mint a fresh QR without re-running the whole login.
- Extend the existing start response to include `error_kind` (one of `needs_authorization | unreachable_control_plane | invalid_auth_key | tailscale_failed`).

### Frontend changes (`dashboard/src/`)

**`lib/api.ts`**
- Extend `TunnelState` with `error_kind?: string` and a separate `pair?: { qr_payload: string; key: string; expires_at?: string }` (more explicit than reusing `token`).
- Extend `tunnelApi.start` body type to include `api_key?: string`, `user?: string`.
- Add `tunnelApi.authorizeHeadscale()` and `tunnelApi.createPreauth({reusable?, expiry?})`.

**`components/remote/RemoteScreen.tsx` — `TunnelsCard`**
- Add a third input row for **Headscale API key** (password, never stored).
- Add a **user** input (default `agentdeck`, remembered in localStorage like the URL).
- After a successful `act('headscale', 'start')`, when `result.pair?.qr_payload` exists, render a sub-card with:
  - `QRCodeSVG` (already a dep via `qrcode.react`) showing the QR.
  - A copy button for the key.
  - A small note "Scan with the Tailscale app — the key auto-fills."
- Map `result.error_kind` to a targeted next-step button:
  - `needs_authorization` → "Authorize tailscale" → calls `tunnelApi.authorizeHeadscale()` then re-issues the start.
  - `unreachable_control_plane` → "Retry" + inline hint to double-check the URL.
  - `invalid_auth_key` → "Re-check the API key" hint.
  - Other → keep the current text fallback.

**`qr_payload` construction (in the backend)**
- `tailscale://<login-server-host>/<node>?key=<preauth>` with `<login-server-host>` URL-encoded. Headscale's standard.
- Plus a plain `https://<login-server>/<node>?key=<preauth>` fallback stored alongside.
- The backend returns both `pair.qr_payload` (preferred) and `pair.fallback_url` so the dashboard can pick — initial render uses `qr_payload`, and the copy button uses whichever the user prefers (UI toggle, or just default to QR).

### Tests

- `tailscale.rs`: `classify_error` unit tests covering each branch (pure function).
- `headscale/mod.rs`: unit test that asserts the request URL, headers, and JSON body for `create_preauth_key` against a captured example response (no live HTTP).
- `headscale.rs`: unit test that `start()` with a missing API key returns `TunnelInfo` with `token = None` and `status = Connected` (the happy no-API-key path still works).
- `dashboard`: skip — already covered by manual flows.

### Files touched (concrete list)

Backend:
- `backend/src/tunnel/tailscale.rs` — runner + classifier
- `backend/src/tunnel/headscale.rs` — wire in API client
- `backend/src/tunnel/mod.rs` — new `TunnelErrorKind` export (or in `tailscale.rs`)
- `backend/src/headscale/mod.rs` — **new**
- `backend/src/config/settings.rs` — `HeadscaleConfig`
- `backend/src/api/routes.rs` — two new handlers + extended start response
- `backend/src/daemon/server.rs` — route registrations

Frontend:
- `dashboard/src/lib/api.ts` — extended types and helpers
- `dashboard/src/components/remote/RemoteScreen.tsx` — inputs, error buttons, QR card

### Out of scope (explicit non-goals)
- Changing operator-identity model.
- Running the agent itself as root.
- A full grpc-web client (Headscale's gateway accepts JSON, which is what we use).
- OAuth/SSO flows for Headscale login.
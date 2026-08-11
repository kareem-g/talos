# AgentDeck Tailnet Remote Control Prompt

Use this prompt to implement reliable Tailnet-based remote control for AgentDeck.

## Objective

Add Tailscale/Tailnet support so paired mobile devices connect through the desktop machine's Tailnet address instead of relying on localhost, a temporary LAN address, or a manually entered local hostname.

The existing AgentDeck pairing, device authentication, QR generation, mobile snapshot, semantic WebSocket, and xterm terminal architecture must be reused.

Do not create a second pairing system.

Do not weaken authentication because the device is on a Tailnet.

Do not replace the current local/LAN behavior. Add Tailnet as a preferred reachable endpoint when it is configured and available.

## Current Architecture To Preserve

```text
Desktop machine
    |
    +-- AgentDeck Rust daemon
            |
            +-- HTTP API
            +-- authenticated mobile WebSocket
            +-- SQLite sessions/messages/events/questions/devices
            +-- PTY and xterm terminal stream
            +-- semantic AgentEvent stream
    |
    +-- Tailscale interface / Tailnet address
            |
            +-- paired mobile device
```

The terminal stream and semantic event stream must remain separate.

Tailnet only changes how the mobile client reaches the daemon.

## User Experiences

### CLI Setup

Support commands similar to:

```bash
agentdeck tailnet status
agentdeck tailnet enable
agentdeck tailnet disable
agentdeck tailnet address
agentdeck tailnet pairing-url
agentdeck pair
```

The exact command names may follow the existing CLI style, but the behavior must include:

- Detect whether Tailscale is installed.
- Detect whether the Tailscale daemon is running.
- Detect whether the machine is logged into a Tailnet.
- Detect the Tailnet IPv4 address.
- Detect the Tailnet IPv6 address when available.
- Detect the MagicDNS hostname when available.
- Detect Tailnet DNS reachability.
- Detect whether the AgentDeck daemon is listening on the required address/port.
- Show the current advertised pairing endpoint.
- Explain how to fix unavailable states.

Example status output:

```text
Tailnet: connected
Tailnet address: 100.64.12.34
MagicDNS name: workstation.tailnet-name.ts.net
AgentDeck endpoint: http://workstation.tailnet-name.ts.net:9120
Mobile pairing: available
```

Failure output should be actionable:

```text
Tailnet is installed but not connected.
Run: sudo tailscale up
```

## Configuration

Extend the existing configuration instead of adding unrelated config files.

Conceptual settings:

```toml
[server]
host = "0.0.0.0"
port = 9120

[tunnel.tailscale]
enabled = true
hostname = "workstation"
advertise_endpoint = true
prefer_magic_dns = true
prefer_ipv4 = true
```

Support explicit endpoint overrides when automatic discovery is unsuitable:

```toml
[remote_access]
advertised_base_url = "http://workstation.tailnet-name.ts.net:9120"
```

Rules:

- Explicit advertised URL takes precedence.
- Configured Cloudflare endpoint may take precedence when explicitly selected.
- Tailnet endpoint takes precedence over LAN hostname when Tailnet is enabled and healthy.
- LAN/IP fallback remains available when Tailnet is disabled or unavailable.
- Never advertise `localhost` in a mobile QR unless the user explicitly selected a local-only mode.
- Never hardcode `192.168.x.x` addresses.
- Never assume one fixed network interface.

## Endpoint Discovery

Create one backend endpoint resolver used by:

- Pairing QR generation.
- Pairing URL display.
- CLI pairing output.
- Desktop connection status.
- Mobile connection metadata.
- Diagnostics.

Conceptual interface:

```rust
struct ReachableEndpoint {
    base_url: String,
    source: EndpointSource,
    host: String,
    port: u16,
    secure: bool,
    reachable: bool,
    diagnostics: Vec<String>,
}

enum EndpointSource {
    Explicit,
    TailnetMagicDns,
    TailnetIpv4,
    TailnetIpv6,
    LanAddress,
    LocalHost,
}

async fn resolve_mobile_endpoint(config: &Settings) -> Result<ReachableEndpoint>;
```

Endpoint selection order:

1. Explicit `advertised_base_url`.
2. Cloudflare URL when explicitly enabled for remote access.
3. Tailnet MagicDNS hostname when enabled and resolvable.
4. Tailnet IPv4 address.
5. Tailnet IPv6 address when supported by the client and URL formatting is correct.
6. LAN address.
7. Local host as a final development-only fallback.

Validate the endpoint before advertising it when possible.

Do not block pairing forever if reachability checks are unavailable. Return diagnostics and let the user retry.

## Tailscale Detection

Use the existing tunnel/Tailscale module where possible.

Support common detection methods:

```bash
tailscale status --json
tailscale ip -4
tailscale ip -6
tailscale dns
```

Prefer the JSON status API over parsing human-readable output.

Capture:

- Backend state.
- Self node name.
- Tailnet name.
- Tailscale IP addresses.
- MagicDNS name.
- Online/offline state.
- Tailnet peers only if needed for diagnostics.

Do not expose auth keys, node keys, or secrets in the UI or pairing QR.

## Daemon Binding

Verify the AgentDeck daemon is reachable over Tailnet.

Requirements:

- Bind to `0.0.0.0` or the configured Tailnet interface when safe.
- Do not bind only to `127.0.0.1` when Tailnet remote control is enabled.
- Respect the configured port.
- Do not assume port `9120` if the configuration uses another port.
- Keep local dashboard access working.
- Keep desktop WebSocket access working.
- Keep mobile authenticated WebSocket access working.

If binding specifically to `tailscale0` is supported, ensure that local dashboard behavior is still documented and intentional.

## Security Requirements

Tailnet membership is not a replacement for AgentDeck device authentication.

Keep:

- Short-lived pairing offers.
- Single-use pairing secrets.
- Hashed device credentials.
- Device revocation.
- Authenticated mobile REST routes.
- Authenticated mobile WebSocket handshake.
- Session/workspace authorization.
- Question and approval authorization.
- Event replay validation.

The QR must contain only:

- Reachable endpoint information.
- Short-lived offer identifier.
- Short-lived pairing secret.

Never place these in the QR:

- Long-lived device token.
- Global auth token.
- Tailscale auth key.
- Node key.
- User password.

## Pairing QR

Reuse the existing desktop pairing page and QR component.

When Tailnet is enabled, the pairing page should show:

```text
Connection method: Tailnet
Endpoint: http://workstation.tailnet-name.ts.net:9120
```

The QR should encode a URL such as:

```text
http://workstation.tailnet-name.ts.net:9120/mobile/pair?offer=...&secret=...
```

If HTTPS is configured through a secure Tailnet proxy, use HTTPS.

Do not automatically use HTTPS when the daemon is only serving plain HTTP.

The pairing page should include:

- Real QR code.
- Copy pairing URL.
- Copy endpoint.
- Tailnet/LAN source indicator.
- Expiration timer.
- Reachability diagnostics.
- Refresh QR action.
- Pending device state.
- Paired device state.
- Device fingerprint.
- Revoke device action.

## CLI Pairing

`agentdeck pair` should use the same backend endpoint resolver and pairing offer API as the web dashboard.

Example:

```text
AgentDeck mobile pairing

Connection: Tailnet
Endpoint: http://workstation.tailnet-name.ts.net:9120
Pairing URL: http://workstation.tailnet-name.ts.net:9120/mobile/pair?offer=...
Expires: 01:58

Open the desktop pairing page to display the QR code.
```

If a terminal QR renderer is already available, render the same URL. Do not generate a second token or a different protocol.

## Web Pairing

The desktop web dashboard should expose a dedicated pairing surface:

```text
Connect mobile

Tailnet connected
workstation.tailnet-name.ts.net
100.64.12.34

[ Generate Tailnet QR ]
[ Generate LAN QR ]
[ Copy pairing URL ]
```

The user should be able to choose the connection source when multiple sources are available.

Default behavior:

- Prefer Tailnet for remote-control pairing.
- Show LAN as a fallback.
- Show local-only mode only when explicitly selected.

## Mobile Pairing Behavior

When a phone scans a Tailnet QR:

1. Open the pairing URL.
2. Parse endpoint and short-lived offer data.
3. Connect to the advertised Tailnet endpoint.
4. Complete the one-time pairing exchange.
5. Store the device credential using the current web architecture.
6. Fetch the authenticated mobile snapshot.
7. Open the authenticated mobile WebSocket.
8. Show the Tailnet connection source.

The phone must not require rescanning after normal refresh or reconnect.

If Tailnet becomes unavailable:

```text
Tailnet desktop unavailable

Trying to reconnect...

[ Retry ]
```

Do not clear valid device credentials solely because the network is temporarily unavailable.

## Mobile Connection Metadata

Include connection information in the mobile snapshot:

```json
{
  "connection": {
    "source": "tailnet",
    "endpoint": "http://workstation.tailnet-name.ts.net:9120",
    "host": "workstation.tailnet-name.ts.net",
    "secure": false,
    "status": "connected"
  }
}
```

Supported states:

- `discovering`
- `tailnet_unavailable`
- `desktop_unavailable`
- `connecting`
- `connected`
- `reconnecting`
- `offline`
- `session_expired`
- `device_revoked`

## Tailnet ACL Guidance

Do not automatically modify the user's Tailnet ACLs.

Show optional documentation such as:

```text
Make sure your Tailnet policy allows this phone to reach the desktop on TCP port 9120.
```

If the user configures a custom port, show that port.

Do not request or store a Tailscale auth key merely to generate a pairing URL.

## WebSocket Behavior

The mobile WebSocket endpoint must use the resolved endpoint:

```text
ws://workstation.tailnet-name.ts.net:9120/ws/mobile
```

or:

```text
wss://workstation.tailnet-name.ts.net:9120/ws/mobile
```

The WebSocket must still require:

- Device credential authentication.
- Session authorization.
- Replay cursor validation.
- Device revocation handling.

The Tailnet source must not change the semantic event protocol.

## Fallback Behavior

If Tailnet is unavailable:

- Keep the local desktop dashboard accessible.
- Keep LAN pairing available if a reachable LAN address exists.
- Show a clear connection source.
- Do not silently generate a QR containing localhost.
- Do not leave the QR page in an infinite loading state.

Example:

```text
Tailnet is unavailable.
LAN pairing is available at 192.168.1.8:9120.

[ Use LAN QR ]
[ Retry Tailnet ]
```

## Diagnostics

Add a diagnostics response useful for support:

```json
{
  "tailscale_installed": true,
  "tailscale_running": true,
  "tailnet_connected": true,
  "tailnet_ipv4": "100.64.12.34",
  "magic_dns": "workstation.tailnet-name.ts.net",
  "agentdeck_bind_host": "0.0.0.0",
  "agentdeck_port": 9120,
  "advertised_endpoint": "http://workstation.tailnet-name.ts.net:9120",
  "endpoint_source": "tailnet_magic_dns",
  "reachable": true,
  "diagnostics": []
}
```

Do not include secrets in diagnostics.

## Testing

Test the following:

1. Tailnet installed and connected.
2. Tailnet disconnected.
3. MagicDNS available.
4. MagicDNS unavailable but Tailnet IPv4 available.
5. Tailnet unavailable but LAN available.
6. Explicit advertised URL configured.
7. Custom AgentDeck port configured.
8. QR generation uses Tailnet endpoint.
9. CLI pairing uses the same offer as web pairing.
10. Phone opens the Tailnet pairing URL.
11. Pairing offer expires correctly.
12. Device credential persists after refresh.
13. Mobile WebSocket authenticates over Tailnet.
14. WebSocket reconnects after temporary Tailnet loss.
15. Device revocation works over Tailnet.
16. Session/task snapshot works over Tailnet.
17. Terminal/xterm raw stream works over Tailnet.
18. Semantic AgentEvents work over Tailnet.
19. Approval and question interactions work over Tailnet.
20. Two devices can connect independently over Tailnet.
21. Revoking one device does not revoke another.
22. No localhost URL is advertised in remote mode.
23. No Tailscale auth key appears in logs, QR data, or UI.

## Acceptance Flow

```text
Enable Tailscale
    ↓
AgentDeck detects Tailnet address/MagicDNS
    ↓
Desktop pairing page shows Tailnet endpoint
    ↓
Generate QR using the existing one-time offer API
    ↓
Phone scans QR
    ↓
Device authenticates over Tailnet
    ↓
Mobile snapshot loads
    ↓
Authenticated semantic WebSocket connects
    ↓
Workspaces and tasks appear
    ↓
Terminal view uses xterm.js
    ↓
Semantic messages/events remain separate
    ↓
Approval/question/command actions work
    ↓
Refresh and reconnect preserve device/session state
```

## Reusable Implementation Prompt

```text
Extend the existing AgentDeck application with Tailnet-first remote-control connectivity.

First inspect the existing:

- Tailscale/tunnel module
- server binding configuration
- endpoint resolver
- pairing offer API
- desktop pairing page
- QR component
- device authentication
- mobile snapshot API
- authenticated mobile WebSocket
- reconnect state machine
- CLI commands

Do not create a second pairing or authentication system.

Implement one shared reachable-endpoint resolver with this priority:

1. Explicit advertised URL.
2. Configured Cloudflare endpoint when selected.
3. Tailnet MagicDNS hostname.
4. Tailnet IPv4 address.
5. Tailnet IPv6 address where supported.
6. LAN address.
7. Localhost only for explicit local development mode.

Use the resolver for:

- desktop pairing QR generation
- pairing URL display
- CLI pairing output
- mobile connection metadata
- diagnostics

The QR must continue using the existing short-lived, single-use pairing offer API.

Never put a long-lived device token, Tailscale auth key, node key, or global secret in the QR.

Tailnet membership does not replace AgentDeck device authentication.

Keep:

- device credentials
- authenticated REST routes
- authenticated mobile WebSocket
- session authorization
- device revocation
- event replay and reconnect handling

Add CLI support for Tailnet status, address, endpoint, and pairing URL while following the existing CLI style.

Update the desktop pairing page to show:

- Tailnet connected/disconnected state
- MagicDNS hostname
- Tailnet IP
- selected endpoint source
- endpoint reachability
- QR expiration
- copy pairing URL
- LAN fallback
- retry and refresh actions

Update mobile pairing and connection state to distinguish:

- discovering
- connecting through Tailnet
- connected through Tailnet
- Tailnet unavailable
- desktop unavailable
- reconnecting
- device revoked
- session expired

Do not change the semantic event protocol because the network source is Tailnet.

Keep the PTY terminal stream and semantic AgentEvent stream separate.

Test LAN, Tailnet, MagicDNS, explicit endpoint, custom port, QR pairing, device persistence, reconnect, revocation, terminal streaming, semantic events, approvals, questions, multiple devices, and fallback behavior.

Report files changed, endpoint selection rules, security behavior, CLI commands, web pairing behavior, mobile behavior, tests, and limitations.
```

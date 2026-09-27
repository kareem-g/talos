# AgentDeck iOS Companion App

A native iOS app that pairs with your AgentDeck desktop by scanning a QR code
and becomes a remote control for the agents running on your machine: watch
live conversations, send prompts, answer approvals and questions, start/stop
tasks, and check in from anywhere over a tailnet or Cloudflare tunnel.

```
ios/
├── AgentDeck.xcodeproj        # generated — see “Project generation”
├── AgentDeck/                 # app target (SwiftUI, iOS 17+, no 3rd-party deps)
│   ├── Models/API.swift       # wire models (snake_case + camelCase capability flags)
│   ├── Networking/            # APIClient (Bearer auth) + Keychain pairing store
│   ├── Realtime/              # WebSocket client, frame codecs, session reducer
│   ├── Views/                 # Pairing (QR scanner), Home, Task, Settings
│   └── Support/               # dates, JSONValue, theme, formatting
├── AgentDeckTests/            # unit tests for frames, reducer, pairing URLs
└── tools/generate_project.py  # regenerates the Xcode project
```

## How it works

The app speaks the same mobile API the paired-browser remote uses:

1. **Pairing** — scan the QR shown on the desktop’s `/pairing` page. The QR
   contains `http://<host>:9120/mobile/pair?offer=<id>&secret=<secret>`. The
   app POSTs `/api/pair/verify` with a random 32-byte device key and receives
   a one-time bearer token, stored in the Keychain. Offers expire after two
   minutes and are single-use.
2. **Home** — `GET /api/mobile/snapshot` returns workspaces/tasks/agents.
3. **Task view** — `GET /api/mobile/sessions/{id}` hydrates messages, events,
   pending approvals/questions, and terminal output.
4. **Live stream** — a WebSocket to `ws(s)://<host>/ws/mobile`. The first
   frame must be `Authenticate {token, after_event_id}` (within 10s). The
   server replays missed broadcast events, then streams live ones. Frames the
   app sends: `Input` (prompts), `Command` (stop / interrupt /
   approval_response), `QuestionAnswer`, `TerminalInput` (^C).
5. **Revocation** — `Error{code:"device_revoked"}` or the `DeviceRevoked`
   frame stops reconnection and shows the unpaired screen.

The socket client mirrors the dashboard’s semantics: state becomes
`connected` only after `Authenticated` (not socket open), reconnect backoff
500ms→15s, a bounded outbox flushed on reconnect, a replay cursor that is
dropped when the daemon restarts (server `last_event_id` lower than ours),
and client-side filtering of the global broadcast by session id.

## Building

### On a Mac (Xcode 15+/16)

```sh
open ios/AgentDeck.xcodeproj      # scheme: AgentDeck, destination: any iPhone
```

Command line:

```sh
xcodebuild test -project ios/AgentDeck.xcodeproj -scheme AgentDeck \
  -destination 'platform=iOS Simulator,name=iPhone 16'

xcodebuild archive -project ios/AgentDeck.xcodeproj -scheme AgentDeck \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/AgentDeck.xcarchive \
  DEVELOPMENT_TEAM=<your-team-id>
```

### Producing the IPA

**IPAs cannot be built on Linux** — they require macOS + Xcode. This repo
therefore ships CI that produces them:

- **Every push/PR touching `ios/**`** → the `iOS` workflow runs unit tests on
  a macOS runner and uploads an **unsigned IPA artifact**
  (`AgentDeck-unsigned-ipa`). Unsigned IPAs install via re-signing tools
  (Sideloadly, AltStore).
- **Every tag `ios-v*`** → the `iOS Release` workflow builds a **signed IPA**
  (when the Apple secrets below are configured), publishes it as a GitHub
  Release asset, and publishes an OTA install page to `gh-pages`. Optionally
  uploads to TestFlight.

Release a new version:

```sh
git tag ios-v1.0.1 && git push origin ios-v1.0.1
```

## Signing setup (CI secrets)

| Secret | Required for | Notes |
|---|---|---|
| `APPLE_CERT_P12_BASE64` | signed IPA | `base64 < cert.p12` — export “Apple Development” cert from Keychain Access |
| `APPLE_CERT_PASSWORD` | signed IPA | password of that .p12 |
| `APPLE_PROVISION_PROFILE_BASE64` | signed IPA | `base64 < AgentDeck.mobileprovision` — a development or ad-hoc profile for `com.agentdeck.ios` listing your devices |
| `APPLE_TEAM_ID` | signed IPA + TestFlight | 10-character Team ID from developer.apple.com |
| `APPLE_EXPORT_METHOD` | optional | `development` (default), `ad-hoc`, or `app-store` |
| `APPLE_SIGNING_IDENTITY` | optional | default `Apple Development`; use `iPhone Distribution` with ad-hoc/app-store |
| `APPLE_BUNDLE_ID` | optional | default `com.agentdeck.ios` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` | TestFlight | App Store Connect API key with Developer role; the bundle id must be registered in ASC |

With no secrets configured the release still works — it just ships an
unsigned IPA.

## Over-the-air updates

For development/ad-hoc distribution (the default signing mode), every
`ios-v*` release updates three files on the `gh-pages` branch:

- `manifest.plist` — the itms-services manifest pointing at the release IPA
- `index.html` — an install/update page
- `version.json` — `{version, tag, url, release_url}` for programmatic checks

Install/update flow on the phone: open
`https://<owner>.github.io/<repo>/` in Safari and tap **Install / Update**
(iOS prompts; the app icon refreshes in place). Requirements:

- GitHub Pages must be enabled for the repo (Settings → Pages → deploy from
  `gh-pages`).
- The repo must be **public** (release asset URLs and Pages must be reachable
  anonymously by iOS). For private repos use TestFlight instead.
- The provisioning profile must include the device, and ad-hoc profiles
  expire after 12 months (re-issue the profile and re-release).

The app’s Settings → **Check for updates** compares
`CFBundleShortVersionString` against the latest `ios-v*` GitHub release and
opens the release page in Safari when an update exists.

TestFlight updates go through the normal TestFlight flow (push a new
`ios-v*` tag; the workflow uploads, you release in App Store Connect).

## Pairing over Tailscale

The desktop's pairing page shows one QR per transport. The **Tailnet** codes
(`Tailnet · <machine>`) point at `http://<machine>.<tailnet>.ts.net:9120` and
only work when the phone itself is on the tailnet:

1. Install the **Tailscale app** on the iPhone (App Store) and sign in to the
   **same tailnet** as the machine running AgentDeck. Leave it connected (the
   VPN key icon in status bar).
2. On the machine, Tailscale must be up (the daemon's tunnel manager or the
   CLI) and the AgentDeck daemon running.
3. Desktop → pairing page → generate a **fresh** code. Offers expire after
   two minutes and are single-use — if you scanned, cancelled, and rescanned
   the same QR, it's dead; generate a new one.
4. Pick the **Tailnet** chip and scan with the app.
5. If it fails, read the error under the Pair button: "can't reach / can't
   find host" means the phone isn't on the tailnet (or an ACL blocks TCP
   9120); "invalid or expired offer" means the QR went stale — regenerate.

The **LAN** chip works the same way but requires the phone and machine to be
on the same Wi-Fi. The **Cloudflare** chip is https and works from anywhere
(including cellular) when a tunnel is configured.

## Testing on the simulator

The simulator has no camera, so the scanner view falls back to a paste field:
run the desktop, open `/pairing`, use the “Copy link”/transport picker to get
a `http://<lan-ip>:9120/mobile/pair?...` URL, and paste it in the app.

## Design notes

- **No third-party dependencies** — SwiftUI + URLSession +
  AVFoundation only. Keeps CI deterministic and the app auditable.
- **Unknown data never crashes** — frames and agent-event kinds are parsed
  structurally first (`ServerFrame`), then decoded lazily per type. New
  backend event kinds are ignored gracefully by old clients.
- **Optimistic echoes are reconciled by id** — a locally-added user message
  is replaced by the server’s `Message` frame when it arrives with the same
  id.
- **Streamed vs persisted assistant text** — `assistant_text` deltas render
  a live bubble; the persisted assistant `Message` clears it. Replayed
  history (hydration) never re-populates the streaming buffer.
- **ATS** — `NSAllowsLocalNetworking` is set because LAN/tailnet pairing
  URLs are plain HTTP; Cloudflare endpoints are HTTPS and preferred when
  present.
- **Xcode project is generated** — `ios/tools/generate_project.py` mirrors
  the directory tree into a classic `project.pbxproj` (objectVersion 56,
  Xcode 14+) with deterministic object IDs and a shared scheme. Re-run it
  after adding/removing Swift files:

  ```sh
  python3 ios/tools/generate_project.py
  ```

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Pairing failed. The code may have expired” | Generate a fresh QR — offers live 2 minutes and are single-use |
| Snapshot error but WS connected | Check the bearer token wasn’t revoked (desktop → device list) |
| Cannot connect over LAN | Phone and machine must be on the same network; check the firewall allows TCP 9120 |
| OTA install fails | Repo must be public, profile must include the device, Pages must serve `gh-pages` |
| Unsigned IPA won’t install | Expected — re-sign with Sideloadly/AltStore or configure the `APPLE_*` secrets |

# Remote View & Control

AgentDeck can share a Linux or macOS screen with the phone and accept input
from it — the whole desktop, one monitor, or a single application window — as a
native feature of the app, not an embedded third‑party viewer.

The phone connects to the **same** daemon it already pairs with, over the
**same** device‑token authentication, on a **dedicated** WebSocket
(`/ws/remote`) so a 24 fps video stream never competes with chat, approvals or
transcripts.

```
                 AgentDeck Mobile
                        │  /ws/remote — device token, one socket
                        ▼
               RemoteManager ── BroadcastHub  ("● Remote Control Active")
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  RemoteSession   RemoteSession    RemoteSession
   (capture)        (input)          (metadata)
        │
  Arc<dyn RemoteBackend>
        │
   ┌────┴─────┐
   ▼          ▼
 Linux      macOS
X11 / Wayland  CoreGraphics
```

## What works, per platform

| | Linux / X11 | Linux / Wayland | macOS |
|---|---|---|---|
| Full desktop | ✅ `GetImage` on the root drawable | ✅ portal `ScreenCast` → PipeWire → GStreamer | ✅ `CGDisplayCreateImage` |
| One monitor | ✅ RandR monitors | ✅ per monitor stream | ✅ `CGGetActiveDisplayList` |
| Application window | ✅ EWMH `_NET_CLIENT_LIST` + composited region | ⚠️ via the portal's own window picker (Wayland exposes no window list) | ✅ `CGWindowListCopyWindowInfo` + including‑window capture |
| Mouse / keyboard | ✅ XTEST | ✅ portal `RemoteDesktop` (`NotifyPointer*`, `NotifyKeyboardKeysym`) | ✅ `CGEventPost` |
| Clipboard | ✅ `xclip` | ⚠️ `wl-copy`/`wl-paste` if installed | ✅ `pbcopy`/`pbpaste` |
| Position/permissions | none required | compositor consent dialog per session | Screen Recording + Accessibility gates |

Wayland capture is deliberately **not** an X11 shortcut: native Wayland clients
are reachable only through `xdg-desktop-portal`, so capture goes through the
portal's ScreenCast session and the compositor's own consent dialog. When X11
windows (XWayland) are present, the X11 backend handles those directly.

## Backend layout

```
backend/src/remote/
├── mod.rs            RemoteManager — registry, enable gate, presence, snapshots
├── protocol.rs       wire messages, capabilities, states, binary frame header
├── types.rs          DisplayInfo, WindowInfo, HostInfo, PermissionReport, Frame
├── session.rs        one capture thread + one input thread per session, adaptive loop
├── encode.rs         adaptive JPEG (and H.264 detection seam)
├── ws.rs             /ws/remote handler (authenticated, multiplexed channels)
├── api.rs            REST: host, targets, enable, sessions, terminate, snapshot
└── platform/
    ├── mod.rs        RemoteBackend trait + detection
    ├── linux/
    │   ├── mod.rs    LinuxBackend — chooses X11 vs Wayland per target
    │   ├── x11.rs    capture, XTEST input, EWMH discovery, clipboard
    │   └── wayland.rs portal ScreenCast + GStreamer capture, portal input
    └── macos/mod.rs  CoreGraphics capture + CGEvent input + permission gates
```

The platform seam is one trait (`RemoteBackend`): capture, geometry, input,
clipboard, discovery, permissions, and `begin_target`/`end_target` for
per‑session platform resources. The protocol, encoder and session manager never
see an OS API.

## Protocol

Envelope matches the rest of AgentDeck: `{"type": "Variant", "payload": {…}}`.
One socket, channels by message type:

* **Video** — `Frame` (base64 JPEG by default; `binary_frames: true` switches to
  a binary frame with a 24‑byte header + JPEG), `StreamStats`.
* **Input** — client `Input` events (`pointer_move`, `button_down`, `scroll`,
  `key_down`, `key_up`, `chord`, `text`, …), server `Cursor`.
* **Clipboard** — `ClipboardGet`/`ClipboardSet` ↔ `Clipboard`.
* **Metadata** — `RequestMetadata` ↔ `Metadata` (displays + windows).
* **Control** — `Start`, `SwitchTarget`, `SetQuality`, `Stop`, `Ready`,
  `TargetChanged`, `State`, `PermissionRequired`, `Error`, `Ping`/`Pong`.

Connection lifecycle: `Authenticate` (first frame, device token) → `Ready`
(host, capabilities, permissions, session id) → `Start` (target + quality).
Reconnect reuses the session id so the desktop keeps its capture running. The
client sends a keepalive `Ping` every 20 s. The daemon re‑validates the token on
every frame, so a revoked device loses a live stream immediately.

Capabilities are negotiated, never assumed: the client offers the target and
quality it wants, and the server replies with what the machine can actually do
(codecs, app view, multi‑monitor, clipboard, cursor, FPS, max dimension).

## Security

* No new port and no unauthenticated endpoint: `/ws/remote` requires the device
  token, exactly like `/ws/mobile`.
* A **master gate** (`[remote] enabled`, default **off**) refuses new sessions
  and terminates live ones the moment it is switched off.
* Turning the gate off, or revoking the device, kills sessions by re‑validating
  the token on every frame (`RemoteManager::terminate_device`).
* Every session start/stop broadcasts `RemoteSessionState` on the main hub, so
  the desktop shows **● Remote Control Active — Connected: iPhone**, and any
  client can terminate the session (`DELETE /remote/sessions/{id}`).
* The desktop REST surface (`/api/remote/*`) can read state and terminate; it
  cannot stream. Streaming always requires a paired device token.

## Mobile UX

The feature is called **Portal** in the app and is reachable two ways: a
prominent **Portal** card on the Home screen (no session required — it is the
default tab, so it is one tap away) and the **Portal** tab in the bottom bar.

The Portal screen lists the computer (name, OS, session type), the enable
switch, permission state, active sessions with an **End** control, the desktop /
displays, and the live application list with title, process and project. It also
marks a window whose working directory matches an active agent session and
offers **Open <app> in Remote View**.

The viewer is the screen: gestures map to a real pointer.

| Gesture | Action |
|---|---|
| One finger drag | Move the pointer |
| Tap | Left click |
| Double tap | Double click |
| Two‑finger tap | Right click |
| Two‑finger drag | Scroll |
| Pinch | Zoom (pan follows the cursor) |
| Long press | Configurable: drag‑hold (default) or right click |
| Mouse mode | One finger = precise relative movement; L/M/R + Drag bar |

The keyboard is a hidden text field plus a sticky‑modifier shortcut bar
(`CTRL ALT SHIFT CMD`, `ESC`, `TAB`, arrows, `CTRL+C/V/Z`, `⌘C/⌘V/⌘Z`).
`1:1` / `Fit`, quality presets (Data saver / Balanced / Sharp) and a rotate
control (0° → 90° → 180° → 270°, per session) are one tap away, and rotation
reflows the viewport because it is derived from the window size each render.
Rotating turns the remote picture without touching the remote machine — input
coordinates are mapped back through the rotation, so a tap still lands on the
pixel you touched.

## Persistent sharing ("view while away")

On Wayland, capture is granted by the compositor's own dialog. Asking every time
makes remote viewing useless when nobody is at the computer, so the ScreenCast
session requests a **persistent grant** (`persist_mode = 2`) and stores the
`restore_token` the portal returns:

* `<xdg-config>/agentdeck/portal-screencast-token` — screen capture
* `<xdg-config>/agentdeck/portal-remote-desktop-token` — remote input

The token is created **after the first approval** and is reused on later
sessions, so the dialog does not reappear. To revoke it, delete the file (or
revoke the share in the desktop's screen-sharing indicator); the next session
will ask once and mint a fresh token. If a stored token is ever rejected, the
daemon drops it and asks again automatically rather than failing.

X11 needs none of this: capture and input have no per-app consent.

## Performance

* Never a full‑resolution screenshot loop: the session downscales to the
  client's bound and adapts JPEG quality to a bandwidth budget, trading quality
  for smoothness.
* Unchanged frames are skipped by a strided content hash — no encode, no bytes.
* Capture stops when the last viewer leaves (`viewer_count == 0`), which closes
  portal sessions, kills GStreamer pipelines and drops threads. No polling.
* Frames ride a capacity‑1 broadcast: a viewer that falls behind skips to the
  newest frame instead of replaying a stale queue.

## Configuration

`~/.config/agentdeck/config.toml`:

```toml
[remote]
enabled = false            # master gate; off until switched on
require_confirmation = false
```

Runtime requirements by platform:

* **X11** — nothing (pure Rust via `x11rb`); `xclip` (or `xsel`) for clipboard.
* **Wayland** — `xdg-desktop-portal` with a ScreenCast backend
  (`xdg-desktop-portal-gnome` / `-kde` / `-wlr`) and GStreamer's
  `pipewiresrc` (`gstreamer1.0-pipewire`); `wl-clipboard` for clipboard. The
  capture pipeline runs `pipewiresrc ! videoconvert ! videoscale ! fdsink` with
  `always-copy=true` (compositors hand out DMA-BUF buffers, which a software
  converter renders black) and `keepalive-time=500` (so a static screen still
  produces frames). The PipeWire fd is made close-on-exec-clear for the child,
  then restored.
* **macOS** — grant **Screen Recording** and **Accessibility** in
  System Settings → Privacy & Security. The app detects a missing grant and
  shows the exact path with an **Open settings** button; it never fails
  silently.

## Known limitations

* The streaming codec is adaptive JPEG, negotiated as `jpeg`. `encode.rs` also
  detects a hardware H.264 encoder (VAAPI/NVENC/QSV/libx264) and the protocol
  carries a codec field, so an H.264/WebRTC transport can be added without
  touching the session, protocol or mobile layers — but only JPEG is streamed
  today.
* On Wayland, application windows are chosen through the compositor's picker;
  there is no OS API to enumerate them, so the app list there is XWayland's.
  A one-off preview snapshot cannot trigger the consent dialog either, so on
  Wayland previews return "start a live session first" until a session has been
  consented; the live session is where the dialog appears.
* Clipboard on Wayland needs `wl-clipboard` installed; without it the clipboard
  channel reports unsupported rather than failing quietly.
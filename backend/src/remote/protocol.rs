//! The AgentDeck remote-view wire protocol.
//!
//! One authenticated WebSocket carries the whole session, multiplexed by
//! message type rather than by socket: video frames, input, clipboard and
//! metadata all ride the same connection so a reconnect restores everything at
//! once. The logical channels the spec calls for are therefore *variants*, not
//! sockets:
//!
//! ```text
//! RemoteSession
//! ├── VideoStream      → ServerMessage::Frame / StreamStats
//! ├── InputChannel     → ClientMessage::Input / ServerMessage::Cursor
//! ├── ClipboardChannel → ClientMessage::{ClipboardGet,ClipboardSet} / ServerMessage::Clipboard
//! ├── MetadataChannel  → ClientMessage::RequestMetadata / ServerMessage::Metadata
//! └── ControlChannel   → Start/SwitchTarget/SetQuality/Stop/State/PermissionRequired/Error
//! ```
//!
//! The envelope matches the rest of AgentDeck's sockets: `{"type": "Variant",
//! "payload": {…}}` (`serde(tag = "type", content = "payload")`). Frames are
//! JPEG bytes; they ride a text frame as base64 by default so a stock React
//! Native `WebSocket` (which the app already uses, and which delivers text) can
//! render them straight into an `<Image>`, and can optionally ride binary
//! frames for clients that negotiate `binary_frames`.

use serde::{Deserialize, Serialize};

use super::types::{
    Capabilities, DisplayInfo, HostInfo, PermissionReport, RemoteTarget, WindowInfo,
};

/* ── Input events (platform-independent) ──────────────────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Middle,
    Right,
}

impl MouseButton {
    /// X11 button numbers (also what most Wayland libei paths map to).
    pub fn x11_button(self) -> u8 {
        match self {
            MouseButton::Left => 1,
            MouseButton::Middle => 2,
            MouseButton::Right => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Modifiers {
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub shift: bool,
    /// Command on macOS, Super on Linux.
    #[serde(default)]
    pub meta: bool,
}

/// Named keys. Printable characters travel as `Text`, so this list is only the
/// keys that have no text representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NamedKey {
    Escape,
    Tab,
    Enter,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Space,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    Super,
}

/// A single input action from the phone. Coordinates are **frame-local**: the
/// session adds the captured region's origin before handing them to the OS, so
/// the same event works for a full desktop, one monitor or one window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InputEvent {
    PointerMove { x: f64, y: f64 },
    PointerMoveRelative { dx: f64, dy: f64 },
    ButtonDown { button: MouseButton },
    ButtonUp { button: MouseButton },
    /// Convenience for a tap: one down/up pair, `count` for double/triple.
    Click { button: MouseButton, count: u8 },
    Scroll { dx: f64, dy: f64 },
    KeyDown { key: NamedKey, modifiers: Modifiers },
    KeyUp { key: NamedKey },
    /// A single character with modifiers — how a shortcut (Ctrl+C, ⌘V) travels
    /// without inventing a named key per letter.
    Chord { key: String, modifiers: Modifiers },
    /// Unicode text, typed as if from a keyboard.
    Text { text: String },
}

/* ── Stream options / quality ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamOptions {
    /// Upper bound on the streamed frame's width; the backend preserves aspect.
    #[serde(default = "default_max_width")]
    pub max_width: u32,
    /// 1..=100 JPEG quality hint. The session lowers it under backpressure.
    #[serde(default = "default_quality")]
    pub quality: u8,
    #[serde(default = "default_fps")]
    pub max_fps: u32,
    /// Preferred codec, from `Capabilities::codecs`. Unknown → first supported.
    #[serde(default)]
    pub codec: Option<String>,
    /// When true the server emits binary frames (header + payload) instead of
    /// base64 text frames. Off by default: the React Native client uses text.
    #[serde(default)]
    pub binary_frames: bool,
    /// Ask for the frame to be downscaled to an exact height as well, for
    /// clients that want to pin the viewport. 0 = keep aspect from `max_width`.
    #[serde(default)]
    pub max_height: u32,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            max_width: default_max_width(),
            quality: default_quality(),
            max_fps: default_fps(),
            codec: None,
            binary_frames: false,
            max_height: 0,
        }
    }
}

impl StreamOptions {
    pub fn clamped(&self) -> Self {
        Self {
            max_width: self.max_width.clamp(240, 5120),
            quality: self.quality.clamp(20, 95),
            max_fps: self.max_fps.clamp(1, 60),
            codec: self.codec.clone(),
            binary_frames: self.binary_frames,
            max_height: self.max_height.min(5120),
        }
    }
}

fn default_max_width() -> u32 {
    1600
}
fn default_quality() -> u8 {
    70
}
fn default_fps() -> u32 {
    24
}

/* ── Client → server ──────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum RemoteClientMessage {
    /// Must be the first frame. `session_id` rejoins an existing session after a
    /// dropped connection; omit it (or send a new one) to start fresh.
    Authenticate {
        token: String,
        #[serde(default)]
        session_id: Option<String>,
    },
    /// Begin (or restart) streaming a target. Also switches targets live.
    Start {
        #[serde(default)]
        target: RemoteTarget,
        #[serde(default)]
        options: StreamOptions,
    },
    SwitchTarget {
        target: RemoteTarget,
    },
    SetQuality {
        options: StreamOptions,
    },
    Input {
        event: InputEvent,
    },
    ClipboardGet,
    ClipboardSet {
        text: String,
    },
    /// Ask for a fresh display/window list (the phone's picker refresh).
    RequestMetadata,
    /// Ask for a single, freshly-captured still (app-picker thumbnails).
    Snapshot {
        target: RemoteTarget,
        #[serde(default = "default_quality")]
        quality: u8,
        #[serde(default = "default_max_width")]
        max_width: u32,
    },
    Stop,
    Ping,
}

/* ── Server → client ──────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum RemoteServerMessage {
    /// The session exists and is ready; carries everything negotiation needs.
    Ready {
        session_id: String,
        device_id: String,
        device_name: String,
        host: HostInfo,
        capabilities: Capabilities,
        permissions: PermissionReport,
        target: RemoteTarget,
        options: StreamOptions,
    },
    /// The target changed and a fresh stream is starting.
    TargetChanged {
        target: RemoteTarget,
        width: u32,
        height: u32,
    },
    /// One encoded frame. `data` is base64 JPEG; `keyframe` marks a fresh
    /// reference frame after a resolution/quality change.
    Frame {
        seq: u64,
        width: u32,
        height: u32,
        target: RemoteTarget,
        codec: String,
        keyframe: bool,
        bytes: usize,
        data: String,
    },
    /// Periodic health of the stream so the UI can show real numbers and adapt.
    StreamStats {
        fps: f32,
        kbps: f32,
        width: u32,
        height: u32,
        quality: u8,
        frames_dropped: u64,
    },
    /// Where the remote pointer is, in frame-local coordinates. Rendered as the
    /// remote cursor on the phone.
    Cursor {
        x: i32,
        y: i32,
        visible: bool,
    },
    Metadata {
        host: HostInfo,
        displays: Vec<DisplayInfo>,
        windows: Vec<WindowInfo>,
    },
    /// A one-off still, as a data URI, for pickers and previews.
    Snapshot {
        target: RemoteTarget,
        width: u32,
        height: u32,
        data: String,
    },
    Clipboard {
        text: String,
    },
    State {
        state: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    PermissionRequired {
        permissions: PermissionReport,
        message: String,
    },
    Error {
        code: String,
        message: String,
        #[serde(default)]
        fatal: bool,
    },
    Pong,
}

/* ── Active-session view (REST + broadcast) ───────────────────────────────── */

/// Snapshot of a live remote session, used by the desktop indicator ("● Remote
/// Control Active — Connected: iPhone") and the terminate control.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSessionInfo {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub target: RemoteTarget,
    pub target_label: String,
    pub viewers: usize,
    pub started_at: String,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub kbps: f32,
}

/// Host + capabilities + permissions, the payload of `GET /remote/host`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHostView {
    pub enabled: bool,
    pub host: HostInfo,
    pub capabilities: Capabilities,
    pub permissions: PermissionReport,
    pub active_sessions: Vec<RemoteSessionInfo>,
}

/// Broadcast when a remote session starts/stops/stalls, so every connected
/// client (desktop dashboard included) sees the security indicator update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePresence {
    pub active: bool,
    pub session_id: String,
    pub device_name: String,
    pub target_label: String,
    pub sessions: Vec<RemoteSessionInfo>,
}

/// Why a session ended, surfaced to the client as a `State`/`Error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Requested,
    Terminated,
    DeviceRevoked,
    CaptureFailed,
}

impl EndReason {
    pub fn as_state(self) -> &'static str {
        match self {
            EndReason::Requested => "disconnected",
            EndReason::Terminated => "terminated",
            EndReason::DeviceRevoked => "unauthorized",
            EndReason::CaptureFailed => "error",
        }
    }
}

/// Result of decoding an inbound binary frame (used only when a client
/// negotiated `binary_frames`; currently reserved for the header layout below).
#[derive(Debug, Clone, Copy)]
pub struct BinaryFrameHeader {
    pub seq: u64,
    pub width: u32,
    pub height: u32,
    pub flags: u8,
    pub payload_len: u32,
}

impl BinaryFrameHeader {
    pub const LEN: usize = 8 + 4 + 4 + 1 + 3 + 4;

    pub fn encode(seq: u64, width: u32, height: u32, keyframe: bool, payload_len: u32) -> [u8; Self::LEN] {
        let mut out = [0u8; Self::LEN];
        out[0..8].copy_from_slice(&seq.to_le_bytes());
        out[8..12].copy_from_slice(&width.to_le_bytes());
        out[12..16].copy_from_slice(&height.to_le_bytes());
        out[16] = u8::from(keyframe);
        out[20..24].copy_from_slice(&payload_len.to_le_bytes());
        out
    }
}

/// Session state strings shared by the client state machine and the broadcast.
pub mod state {
    pub const CONNECTING: &str = "connecting";
    pub const CONNECTED: &str = "connected";
    pub const RECONNECTING: &str = "reconnecting";
    pub const DISCONNECTED: &str = "disconnected";
    pub const PERMISSION_REQUIRED: &str = "permission_required";
    pub const UNAUTHORIZED: &str = "unauthorized";
    pub const UNSUPPORTED: &str = "unsupported";

    /// Labels shown next to a session kind in the session banner.
    pub fn kind_label(kind: crate::remote::types::SessionKind) -> &'static str {
        kind.label()
    }
}

/// The negotiated capabilities' default codec: first advertised entry.
pub fn default_codec(capabilities: &Capabilities) -> String {
    capabilities
        .codecs
        .first()
        .map(|codec| codec.label().to_string())
        .unwrap_or_else(|| "jpeg".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_message_round_trips_through_the_envelope() {
        let message = RemoteClientMessage::Input {
            event: InputEvent::PointerMove { x: 12.5, y: 40.0 },
        };
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(value["type"], "Input");
        assert_eq!(value["payload"]["event"]["kind"], "pointer_move");
        assert_eq!(value["payload"]["event"]["x"], 12.5);
        let back: RemoteClientMessage = serde_json::from_value(value).unwrap();
        matches!(back, RemoteClientMessage::Input { .. });
    }

    #[test]
    fn start_defaults_are_applied_when_fields_are_omitted() {
        let message: RemoteClientMessage =
            serde_json::from_str(r#"{"type":"Start","payload":{"target":{"kind":"desktop"}}}"#).unwrap();
        let RemoteClientMessage::Start { target, options } = message else {
            panic!("expected Start");
        };
        assert_eq!(target, RemoteTarget::Desktop);
        assert_eq!(options.max_fps, 24);
        assert_eq!(options.max_width, 1600);
    }

    #[test]
    fn binary_header_is_24_bytes_and_round_trips() {
        let header = BinaryFrameHeader::encode(7, 1280, 720, true, 4096);
        assert_eq!(header.len(), BinaryFrameHeader::LEN);
        assert_eq!(u64::from_le_bytes(header[0..8].try_into().unwrap()), 7);
        assert_eq!(u32::from_le_bytes(header[8..12].try_into().unwrap()), 1280);
        assert_eq!(header[16], 1);
    }

    #[test]
    fn server_frame_serializes_base64_payload() {
        let message = RemoteServerMessage::Frame {
            seq: 1,
            width: 100,
            height: 50,
            target: RemoteTarget::Display { id: 0 },
            codec: "jpeg".into(),
            keyframe: true,
            bytes: 3,
            data: "AAAA".into(),
        };
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(value["type"], "Frame");
        assert_eq!(value["payload"]["data"], "AAAA");
        assert_eq!(value["payload"]["target"]["kind"], "display");
    }
}
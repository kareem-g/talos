//! Domain types shared by every remote-view backend.
//!
//! Nothing here touches a platform API: a display, a window, a permission and a
//! raw captured frame look the same whether they came from X11, Wayland or
//! CoreGraphics. The platform modules depend on this file, never the other way
//! around, which is what lets the mobile client and the wire protocol stay
//! platform-independent.

use serde::{Deserialize, Serialize};

/// Operating system the daemon is running on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Linux,
    Macos,
}

impl PlatformKind {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            PlatformKind::Macos
        } else {
            PlatformKind::Linux
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            PlatformKind::Linux => "Linux",
            PlatformKind::Macos => "macOS",
        }
    }
}

/// Which display server / compositor the session is running under. On Linux the
/// two need completely different capture and input paths, and the mobile client
/// is told which one is live so it can explain a missing permission correctly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    X11,
    Wayland,
    Macos,
}

impl SessionKind {
    pub fn label(self) -> &'static str {
        match self {
            SessionKind::X11 => "X11",
            SessionKind::Wayland => "Wayland",
            SessionKind::Macos => "macOS",
        }
    }
}

/// What the viewer is attached to. `Desktop` is the whole virtual screen
/// (all monitors stitched together on X11 / the portal's monitor set on
/// Wayland); `Display` is one monitor; `Window` is a single application window —
/// the "App View" mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemoteTarget {
    Desktop,
    Display { id: u32 },
    Window { id: u64 },
}

impl RemoteTarget {
    /// Stable key used to identify a live capture stream for this target.
    pub fn key(&self) -> String {
        match self {
            RemoteTarget::Desktop => "desktop".to_string(),
            RemoteTarget::Display { id } => format!("display:{id}"),
            RemoteTarget::Window { id } => format!("window:{id}"),
        }
    }

    pub fn is_window(&self) -> bool {
        matches!(self, RemoteTarget::Window { .. })
    }
}

impl Default for RemoteTarget {
    fn default() -> Self {
        RemoteTarget::Desktop
    }
}

/// One monitor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

/// One on-screen top-level window — an "application" from the user's point of
/// view. `app_name` is the human label (VS Code, Terminal), `title` the window's
/// own title, `process` the owning executable where the platform exposes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u64,
    pub display_id: u32,
    pub title: String,
    pub app_name: String,
    pub app_id: Option<String>,
    pub pid: Option<u32>,
    pub process: Option<String>,
    pub project: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub minimized: bool,
    pub focused: bool,
}

/// Everything the client needs to render the picker: who this computer is and
/// what it can currently be asked to do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostInfo {
    pub name: String,
    pub platform: PlatformKind,
    pub platform_label: String,
    pub session_kind: SessionKind,
    pub session_label: String,
    pub version: String,
}

/// A single permission the platform may require. `NotRequired` is distinct from
/// `Granted` so the UI can stay silent on platforms that do not need it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    NotRequired,
    Granted,
    Denied,
    Unknown,
}

impl PermissionStatus {
    pub fn is_blocking(self) -> bool {
        matches!(self, PermissionStatus::Denied)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionReport {
    /// Screen capture / screen recording.
    pub screen_recording: PermissionStatus,
    /// Synthetic mouse + keyboard control.
    pub accessibility: PermissionStatus,
    /// Some platforms gate raw input separately (macOS Input Monitoring).
    pub input_monitoring: PermissionStatus,
    /// Human-readable setup instructions, present only when something is
    /// missing. The client renders this verbatim instead of inventing copy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Deep link / command that opens the relevant settings pane.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_hint: Option<String>,
}

impl PermissionReport {
    pub fn all_granted() -> Self {
        Self {
            screen_recording: PermissionStatus::NotRequired,
            accessibility: PermissionStatus::NotRequired,
            input_monitoring: PermissionStatus::NotRequired,
            message: None,
            settings_hint: None,
        }
    }

    /// True when every gate is satisfied (or not required).
    pub fn is_usable(&self) -> bool {
        [self.screen_recording, self.accessibility, self.input_monitoring]
            .iter()
            .all(|status| !status.is_blocking())
    }
}

/// Video codecs a backend can actually produce. The mobile client asks for one
/// of these during capability negotiation; an unknown request falls back to the
/// first entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Codec {
    Jpeg,
    H264,
}

impl Codec {
    pub fn label(self) -> &'static str {
        match self {
            Codec::Jpeg => "jpeg",
            Codec::H264 => "h264",
        }
    }
}

/// What a backend can do. Advertised to the client on connect so the UI only
/// offers modes the machine can genuinely serve (no hardcoded feature flags).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub platform: PlatformKind,
    pub session_kind: SessionKind,
    pub full_desktop: bool,
    pub app_view: bool,
    pub multi_display: bool,
    pub input: bool,
    pub clipboard: bool,
    pub cursor: bool,
    pub codecs: Vec<Codec>,
    pub hardware_encode: bool,
    pub max_fps: u32,
    /// Largest frame edge the encoder will emit, so a client can pre-size its
    /// viewport instead of discovering it from the first frame.
    pub max_dimension: u32,
}

impl Capabilities {
    pub fn fallback(codecs: Vec<Codec>) -> Self {
        Self {
            platform: PlatformKind::current(),
            session_kind: if cfg!(target_os = "macos") {
                SessionKind::Macos
            } else {
                SessionKind::X11
            },
            full_desktop: false,
            app_view: false,
            multi_display: false,
            input: false,
            clipboard: false,
            cursor: false,
            codecs,
            hardware_encode: false,
            max_fps: 30,
            max_dimension: 2560,
        }
    }
}

/// A captured frame in RGBA, before encoding. Deliberately raw: the encoder is
/// shared by every backend so X11, Wayland and macOS all produce identical
/// pixels-and-then-JPEG, and only the pixels differ.
#[derive(Debug, Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// Tightly packed RGBA8, `width * height * 4` bytes.
    pub rgba: Vec<u8>,
    /// Where the frame's top-left sits in the virtual desktop, for translating
    /// an absolute pointer position back into frame-local coordinates.
    pub origin_x: i32,
    pub origin_y: i32,
}

impl Frame {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>, origin_x: i32, origin_y: i32) -> Self {
        Self { width, height, rgba, origin_x, origin_y }
    }
}

/// A platform error with enough structure for the wire. `PermissionRequired`
/// and `Unsupported` must not be flattened into a generic string: the UI shows a
/// different, actionable screen for each.
#[derive(Debug, Clone, thiserror::Error)]
pub enum RemoteError {
    #[error("permission required: {0}")]
    PermissionRequired(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("capture failed: {0}")]
    Capture(String),
    #[error("input failed: {0}")]
    Input(String),
    #[error("clipboard failed: {0}")]
    Clipboard(String),
    #[error("{0}")]
    Other(String),
}

impl RemoteError {
    pub fn code(&self) -> &'static str {
        match self {
            RemoteError::PermissionRequired(_) => "permission_required",
            RemoteError::Unsupported(_) => "unsupported",
            RemoteError::Capture(_) => "capture_failed",
            RemoteError::Input(_) => "input_failed",
            RemoteError::Clipboard(_) => "clipboard_failed",
            RemoteError::Other(_) => "remote_error",
        }
    }
}

pub type RemoteResult<T> = std::result::Result<T, RemoteError>;
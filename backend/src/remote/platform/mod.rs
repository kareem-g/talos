//! Platform abstraction for remote capture and control.
//!
//! Every OS-specific capability sits behind [`RemoteBackend`]. The session
//! manager, the encoder and the wire protocol only ever see this trait, so
//! adding a platform means adding one module — not touching the protocol.
//!
//! The trait is deliberately **synchronous**: X11 round-trips, portal D-Bus
//! negotiation and CoreGraphics calls are all blocking, so the session runs
//! capture and input on dedicated OS threads rather than pretending they are
//! async and then blocking a tokio worker.

use std::sync::Arc;

use super::protocol::InputEvent;
use super::types::{
    Capabilities, DisplayInfo, Frame, HostInfo, PermissionReport, RemoteResult, RemoteTarget,
    WindowInfo,
};

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;

/// Where a target's pixels live on the virtual desktop, and how big they are.
/// Used to translate frame-local pointer coordinates back to absolute ones.
#[derive(Debug, Clone, Copy)]
pub struct TargetGeometry {
    pub origin_x: i32,
    pub origin_y: i32,
    pub width: u32,
    pub height: u32,
}

/// The one contract a platform must satisfy.
pub trait RemoteBackend: Send + Sync {
    fn capabilities(&self) -> Capabilities;
    fn host_info(&self) -> HostInfo;
    fn permissions(&self) -> PermissionReport;

    fn list_displays(&self) -> RemoteResult<Vec<DisplayInfo>>;
    fn list_windows(&self) -> RemoteResult<Vec<WindowInfo>>;

    /// Capture one frame of `target` in RGBA.
    fn capture(&self, target: &RemoteTarget) -> RemoteResult<Frame>;
    /// Absolute geometry of `target` on the virtual desktop.
    fn geometry(&self, target: &RemoteTarget) -> RemoteResult<TargetGeometry>;

    /// Absolute pointer position, if the platform exposes it.
    fn pointer_position(&self) -> RemoteResult<Option<(i32, i32)>>;

    /// Inject one platform-independent event. Coordinates in the event are
    /// frame-local; the backend translates them via `geometry`.
    fn input(&self, target: &RemoteTarget, event: &InputEvent) -> RemoteResult<()>;

    fn get_clipboard(&self) -> RemoteResult<Option<String>>;
    fn set_clipboard(&self, text: &str) -> RemoteResult<()>;

    /// Open the OS settings pane for a missing permission. Platforms with no
    /// such concept return `Unsupported` so the UI hides the button.
    fn open_permission_settings(&self) -> RemoteResult<()> {
        Err(super::types::RemoteError::Unsupported(
            "this platform has no permission settings to open".to_string(),
        ))
    }

    /// Called once when a capture stream for `target` starts, before the first
    /// `capture`. Wayland uses it to negotiate the portal session (which is
    /// where the compositor shows its consent dialog); X11 ignores it.
    fn begin_target(&self, _target: &RemoteTarget) -> RemoteResult<()> {
        Ok(())
    }

    /// Called when the last viewer of a target goes away. Releases any
    /// platform capture resources so encoders and portal sessions do not stay
    /// alive for nobody.
    fn end_target(&self, _target: &RemoteTarget) -> RemoteResult<()> {
        Ok(())
    }
}

/// Build the backend for the running platform. Detection is done once at
/// startup and cached in `AppState`; a session never re-detects.
pub fn detect() -> Arc<dyn RemoteBackend> {
    #[cfg(target_os = "linux")]
    {
        return linux::detect();
    }
    #[cfg(target_os = "macos")]
    {
        return Arc::new(macos::MacosBackend::new());
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Arc::new(UnsupportedBackend)
    }
}

/// Used only when the daemon is compiled for a platform with no backend (e.g. a
/// Linux-only build cross-compiled somewhere unexpected). Every call reports
/// `Unsupported` rather than panicking, so the REST surface still answers.
pub struct UnsupportedBackend;

impl RemoteBackend for UnsupportedBackend {
    fn capabilities(&self) -> Capabilities {
        Capabilities::fallback(vec![super::types::Codec::Jpeg])
    }
    fn host_info(&self) -> HostInfo {
        HostInfo {
            name: hostname::get()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string()),
            platform: super::types::PlatformKind::current(),
            platform_label: super::types::PlatformKind::current().label().to_string(),
            session_kind: super::types::SessionKind::X11,
            session_label: "unsupported".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
    fn permissions(&self) -> PermissionReport {
        PermissionReport::all_granted()
    }
    fn list_displays(&self) -> RemoteResult<Vec<DisplayInfo>> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
    fn list_windows(&self) -> RemoteResult<Vec<WindowInfo>> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
    fn capture(&self, _target: &RemoteTarget) -> RemoteResult<Frame> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
    fn geometry(&self, _target: &RemoteTarget) -> RemoteResult<TargetGeometry> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
    fn pointer_position(&self) -> RemoteResult<Option<(i32, i32)>> {
        Ok(None)
    }
    fn input(&self, _target: &RemoteTarget, _event: &InputEvent) -> RemoteResult<()> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
    fn get_clipboard(&self) -> RemoteResult<Option<String>> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
    fn set_clipboard(&self, _text: &str) -> RemoteResult<()> {
        Err(super::types::RemoteError::Unsupported(
            "no remote backend for this platform".to_string(),
        ))
    }
}
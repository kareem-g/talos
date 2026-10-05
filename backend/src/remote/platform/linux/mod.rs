//! Linux backend selection.
//!
//! A Linux session is X11 or Wayland, and on Wayland the two worlds coexist:
//! native Wayland clients are captured through the xdg-desktop-portal, while
//! anything running under XWayland is an X11 window the X11 backend can capture
//! and drive directly. [`LinuxBackend`] therefore holds both and picks per
//! target, advertising exactly what it can do instead of assuming one display
//! server.

pub mod wayland;
pub mod x11;

use std::sync::Arc;

use super::RemoteBackend;
use crate::remote::types::{
    Capabilities, Codec, SessionKind,
};

pub use x11::X11Backend;

/// Runtime selection between the two capture paths.
pub struct LinuxBackend {
    session_kind: SessionKind,
    x11: Option<X11Backend>,
    wayland: Option<wayland::WaylandBackend>,
    /// True when the compositor session should be driven through the portal.
    prefer_wayland: bool,
    /// When the portal last failed. While it is recent the portal is skipped and
    /// the X11 path is used directly, so a broken/absent ScreenCast backend
    /// costs one failed attempt rather than one per session.
    wayland_failed: std::sync::Mutex<Option<std::time::Instant>>,
}

/// How long a portal failure is remembered before trying it again.
const WAYLAND_RETRY_AFTER: std::time::Duration = std::time::Duration::from_secs(300);

impl LinuxBackend {
    pub fn detect() -> Self {
        let wayland_display = std::env::var_os("WAYLAND_DISPLAY").is_some();
        let prefer_wayland = wayland_display;
        let session_kind = if wayland_display { SessionKind::Wayland } else { SessionKind::X11 };

        let x11 = match X11Backend::connect() {
            Ok(backend) => Some(backend),
            Err(error) => {
                tracing::info!("[AgentDeck][Remote] X11 unavailable: {}", error);
                None
            }
        };
        let wayland = if wayland_display {
            match wayland::WaylandBackend::detect() {
                Ok(backend) => Some(backend),
                Err(error) => {
                    tracing::info!("[AgentDeck][Remote] Wayland portal unavailable: {}", error);
                    None
                }
            }
        } else {
            None
        };

        Self { session_kind, x11, wayland, prefer_wayland, wayland_failed: std::sync::Mutex::new(None) }
    }

    fn mark_wayland_failed(&self) {
        if let Ok(mut failed) = self.wayland_failed.lock() {
            *failed = Some(std::time::Instant::now());
        }
    }

    fn wayland_recently_failed(&self) -> bool {
        self.wayland_failed
            .lock()
            .ok()
            .and_then(|failed| *failed)
            .map(|when| when.elapsed() < WAYLAND_RETRY_AFTER)
            .unwrap_or(false)
    }

    fn wayland_for(&self, target: &crate::remote::types::RemoteTarget) -> Option<&wayland::WaylandBackend> {
        if !self.prefer_wayland {
            return None;
        }
        // A portal that just failed is skipped for a while: on a machine whose
        // ScreenCast backend cannot show its dialog, every session would
        // otherwise pay the full prompt timeout before falling back to X11.
        if self.wayland_recently_failed() {
            return None;
        }
        // Wayland owns the composited desktop and the portal's own window
        // picker. X11 windows under XWayland are better served by X11 capture
        // when XWayland is present, because the portal would re-ask consent.
        match target {
            crate::remote::types::RemoteTarget::Desktop => self.wayland.as_ref(),
            crate::remote::types::RemoteTarget::Display { .. } => self.wayland.as_ref(),
            crate::remote::types::RemoteTarget::Window { .. } => {
                if self.x11.is_some() {
                    None
                } else {
                    self.wayland.as_ref()
                }
            }
        }
    }
}

impl RemoteBackend for LinuxBackend {
    fn capabilities(&self) -> Capabilities {
        // Merge both worlds: input and clipboard if either can provide them,
        // app view if X11 windows are enumerable or the portal can cast one.
        let session_kind = self.session_kind;
        let wayland_caps = self.wayland.as_ref().map(|backend| backend.capabilities());
        let x11_caps = self.x11.as_ref().map(|backend| backend.capabilities());
        Capabilities {
            platform: crate::remote::types::PlatformKind::Linux,
            session_kind,
            full_desktop: wayland_caps.as_ref().map(|caps| caps.full_desktop).unwrap_or(false)
                || x11_caps.as_ref().map(|caps| caps.full_desktop).unwrap_or(false),
            app_view: x11_caps.as_ref().map(|caps| caps.app_view).unwrap_or(false)
                || wayland_caps.as_ref().map(|caps| caps.app_view && self.x11.is_none()).unwrap_or(false),
            multi_display: x11_caps.as_ref().map(|caps| caps.multi_display).unwrap_or(false)
                || wayland_caps.as_ref().map(|caps| caps.multi_display).unwrap_or(false),
            input: wayland_caps.as_ref().map(|caps| caps.input).unwrap_or(false)
                || x11_caps.as_ref().map(|caps| caps.input).unwrap_or(false),
            clipboard: x11_caps.as_ref().map(|caps| caps.clipboard).unwrap_or(false)
                || wayland_caps.as_ref().map(|caps| caps.clipboard).unwrap_or(false),
            cursor: x11_caps.as_ref().map(|caps| caps.cursor).unwrap_or(false)
                || wayland_caps.as_ref().map(|caps| caps.cursor).unwrap_or(false),
            codecs: vec![Codec::Jpeg],
            hardware_encode: false,
            max_fps: 30,
            max_dimension: 4096,
        }
    }

    fn host_info(&self) -> crate::remote::types::HostInfo {
        let name = hostname::get()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        crate::remote::types::HostInfo {
            name,
            platform: crate::remote::types::PlatformKind::Linux,
            platform_label: "Linux".to_string(),
            session_kind: self.session_kind,
            session_label: self.session_kind.label().to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    fn permissions(&self) -> crate::remote::types::PermissionReport {
        if self.prefer_wayland {
            if let Some(wayland) = &self.wayland {
                return wayland.permissions();
            }
            // Wayland without a working portal is the one Linux case where a
            // permission setup screen is genuinely required.
            return crate::remote::types::PermissionReport {
                screen_recording: crate::remote::types::PermissionStatus::Denied,
                accessibility: crate::remote::types::PermissionStatus::Unknown,
                input_monitoring: crate::remote::types::PermissionStatus::NotRequired,
                message: Some(
                    "Screen sharing on Wayland needs xdg-desktop-portal with a ScreenCast \
                     backend. Install xdg-desktop-portal-gnome (or -kde/-wlr) and log back in."
                        .to_string(),
                ),
                settings_hint: None,
            };
        }
        if let Some(x11) = &self.x11 {
            return x11.permissions();
        }
        crate::remote::types::PermissionReport {
            screen_recording: crate::remote::types::PermissionStatus::Denied,
            accessibility: crate::remote::types::PermissionStatus::Unknown,
            input_monitoring: crate::remote::types::PermissionStatus::NotRequired,
            message: Some("No display server detected (neither X11 nor Wayland).".to_string()),
            settings_hint: None,
        }
    }

    fn list_displays(&self) -> crate::remote::types::RemoteResult<Vec<crate::remote::types::DisplayInfo>> {
        if let Some(wayland) = self.wayland_for(&crate::remote::types::RemoteTarget::Desktop) {
            match wayland.list_displays() {
                Ok(displays) if !displays.is_empty() => return Ok(displays),
                _ => {}
            }
        }
        if let Some(x11) = &self.x11 {
            return x11.list_displays();
        }
        if let Some(wayland) = &self.wayland {
            return wayland.list_displays();
        }
        Err(crate::remote::types::RemoteError::Unsupported(
            "no display server available".to_string(),
        ))
    }

    fn list_windows(&self) -> crate::remote::types::RemoteResult<Vec<crate::remote::types::WindowInfo>> {
        // X11 (incl. XWayland) is the only source that can enumerate windows.
        if let Some(x11) = &self.x11 {
            return x11.list_windows();
        }
        if let Some(wayland) = &self.wayland {
            return wayland.list_windows();
        }
        Ok(Vec::new())
    }

    fn capture(&self, target: &crate::remote::types::RemoteTarget) -> crate::remote::types::RemoteResult<crate::remote::types::Frame> {
        if let Some(wayland) = self.wayland_for(target) {
            match wayland.capture(target) {
                Ok(frame) => return Ok(frame),
                Err(error) => {
                    self.mark_wayland_failed();
                    // On a Wayland session the X11 root belongs to XWayland and
                    // cannot be grabbed (`XGetImage` on it answers BadMatch —
                    // `xwd -root` fails identically), so a whole screen or
                    // monitor has no X11 fallback. End the stream with the real
                    // reason instead of looping on an impossible capture.
                    tracing::warn!("[AgentDeck][Remote] portal capture failed: {}", error);
                    if self.prefer_wayland {
                        return Err(crate::remote::types::RemoteError::Unsupported(
                            "Monitor and full-desktop capture are unavailable on this Wayland \
                             session: the compositor's screen-sharing dialog did not appear and \
                             XWayland does not allow capturing the root screen. Use App View \
                             (windows) — or restart this computer to reset the GNOME portal and \
                             try again."
                                .to_string(),
                        ));
                    }
                }
            }
        }
        if let Some(x11) = &self.x11 {
            return x11.capture(target);
        }
        Err(crate::remote::types::RemoteError::Unsupported(
            "no capture backend available".to_string(),
        ))
    }

    fn geometry(&self, target: &crate::remote::types::RemoteTarget) -> crate::remote::types::RemoteResult<super::TargetGeometry> {
        if let Some(wayland) = self.wayland_for(target)
            && let Ok(geometry) = wayland.geometry(target)
        {
            return Ok(geometry);
        }
        if let Some(x11) = &self.x11 {
            return x11.geometry(target);
        }
        Err(crate::remote::types::RemoteError::Unsupported(
            "no display backend available".to_string(),
        ))
    }

    fn pointer_position(&self) -> crate::remote::types::RemoteResult<Option<(i32, i32)>> {
        if let Some(x11) = &self.x11 {
            return x11.pointer_position();
        }
        Ok(None)
    }

    fn input(&self, target: &crate::remote::types::RemoteTarget, event: &crate::remote::protocol::InputEvent) -> crate::remote::types::RemoteResult<()> {
        if let Some(wayland) = self.wayland_for(target) {
            match wayland.input(target, event) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    // XTEST still drives X11/XWayland clients, so input keeps
                    // working even when the portal's RemoteDesktop session
                    // cannot be established.
                    tracing::warn!(
                        "[AgentDeck][Remote] portal input failed ({}); using X11",
                        error
                    );
                    self.mark_wayland_failed();
                }
            }
        }
        if let Some(x11) = &self.x11 {
            return x11.input(target, event);
        }
        Err(crate::remote::types::RemoteError::Unsupported(
            "input control is not available on this session".to_string(),
        ))
    }

    fn get_clipboard(&self) -> crate::remote::types::RemoteResult<Option<String>> {
        if let Some(x11) = &self.x11 {
            return x11.get_clipboard();
        }
        if let Some(wayland) = &self.wayland {
            return wayland.get_clipboard();
        }
        Ok(None)
    }

    fn set_clipboard(&self, text: &str) -> crate::remote::types::RemoteResult<()> {
        if let Some(x11) = &self.x11 {
            match x11.set_clipboard(text) {
                Ok(()) => return Ok(()),
                Err(error) if self.wayland.is_some() => {
                    tracing::debug!("[AgentDeck][Remote] X11 clipboard failed, trying Wayland: {}", error);
                }
                Err(error) => return Err(error),
            }
        }
        if let Some(wayland) = &self.wayland {
            return wayland.set_clipboard(text);
        }
        Err(crate::remote::types::RemoteError::Unsupported(
            "clipboard is not available".to_string(),
        ))
    }

    fn open_permission_settings(&self) -> crate::remote::types::RemoteResult<()> {
        Err(crate::remote::types::RemoteError::Unsupported(
            "Linux exposes no permission settings pane; install the portal backend instead".to_string(),
        ))
    }

    fn begin_target(&self, target: &crate::remote::types::RemoteTarget) -> crate::remote::types::RemoteResult<()> {
        if let Some(wayland) = self.wayland_for(target) {
            match wayland.begin_target(target) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    // Not fatal: mark the portal unhealthy and let capture fall
                    // back to X11 on this very attempt instead of ending the
                    // session with a permission error.
                    tracing::warn!(
                        "[AgentDeck][Remote] portal could not start capture ({}); using X11",
                        error
                    );
                    self.mark_wayland_failed();
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    fn end_target(&self, target: &crate::remote::types::RemoteTarget) -> crate::remote::types::RemoteResult<()> {
        if let Some(wayland) = self.wayland_for(target) {
            return wayland.end_target(target);
        }
        Ok(())
    }
}

pub fn detect() -> Arc<dyn RemoteBackend> {
    Arc::new(LinuxBackend::detect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::platform::RemoteBackend;

    #[test]
    fn detect_never_panics_and_always_reports_a_host() {
        let backend = LinuxBackend::detect();
        let host = backend.host_info();
        assert_eq!(host.platform, crate::remote::types::PlatformKind::Linux);
        assert!(!host.version.is_empty());
    }

    #[test]
    fn capabilities_advertise_at_least_one_codec() {
        let backend = LinuxBackend::detect();
        assert!(!backend.capabilities().codecs.is_empty());
    }
}
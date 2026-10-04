//! Remote view / control subsystem.
//!
//! ```text
//!                 AgentDeck Mobile
//!                        │  /ws/remote (device token, one socket)
//!                        ▼
//!               RemoteManager  ── BroadcastHub (presence indicator)
//!                        │
//!         ┌──────────────┼──────────────┐
//!         ▼              ▼              ▼
//!   RemoteSession   RemoteSession   RemoteSession
//!    (capture)       (input)         (metadata)
//!         │
//!   Arc<dyn RemoteBackend>
//!         │
//!   ┌─────┴─────┐
//!   ▼           ▼
//!  Linux      macOS
//!  (X11/Wayland) (CoreGraphics)
//! ```
//!
//! The manager owns the enable/disable gate, the live-session registry and the
//! broadcasts that drive the desktop's "● Remote Control Active" indicator and
//! the terminate control. Everything it hands out is behind the daemon's
//! existing device-token authentication — there is no separate port and no
//! unauthenticated entry point.

pub mod api;
pub mod encode;
pub mod platform;
pub mod protocol;
pub mod session;
pub mod types;
pub mod ws;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use base64::Engine as _;

use crate::websocket::broadcast::BroadcastHub;
use crate::websocket::WsMessage;

use protocol::{
    RemoteHostView, RemotePresence, RemoteSessionInfo, StreamOptions,
};
use session::RemoteSession;
use types::{RemoteError, RemoteResult, RemoteTarget};

pub use platform::RemoteBackend;

/// The registry and policy gate for remote control.
pub struct RemoteManager {
    backend: Arc<dyn RemoteBackend>,
    enabled: AtomicBool,
    sessions: RwLock<HashMap<String, Arc<RemoteSession>>>,
    broadcast: BroadcastHub,
}

impl RemoteManager {
    pub fn new(backend: Arc<dyn RemoteBackend>, broadcast: BroadcastHub, enabled: bool) -> Self {
        Self {
            backend,
            enabled: AtomicBool::new(enabled),
            sessions: RwLock::new(HashMap::new()),
            broadcast,
        }
    }

    pub fn backend(&self) -> &Arc<dyn RemoteBackend> {
        &self.backend
    }

    /// Whether remote control is allowed at all. Off is a hard gate: `attach`
    /// refuses until an authenticated client (or the desktop) turns it on.
    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            // Turning the gate off terminates live sessions immediately —
            // the switch is a kill switch, not just a refusal of new ones.
            for id in self.session_ids() {
                self.terminate(&id);
            }
        }
    }

    pub fn host_view(&self) -> RemoteHostView {
        let capabilities = self.backend.capabilities();
        RemoteHostView {
            enabled: self.enabled(),
            host: self.backend.host_info(),
            capabilities,
            permissions: self.backend.permissions(),
            active_sessions: self.infos(),
        }
    }

    /// Create or rejoin a session. `session_id` rejoins after a reconnect so the
    /// viewer keeps its stream instead of re-triggering consent.
    pub fn attach(
        &self,
        session_id: Option<String>,
        device_id: &str,
        device_name: &str,
        target: RemoteTarget,
        options: StreamOptions,
    ) -> RemoteResult<Arc<RemoteSession>> {
        if !self.enabled() {
            return Err(RemoteError::Unsupported(
                "remote control is disabled on this computer".to_string(),
            ));
        }
        let options = options.clamped();

        // Rejoin: same device, session still alive.
        if let Some(id) = session_id.as_ref()
            && let Ok(sessions) = self.sessions.read()
            && let Some(existing) = sessions.get(id)
            && existing.device_id == device_id
        {
            existing.set_target(target);
            existing.set_options(options);
            return Ok(Arc::clone(existing));
        }

        let id = session_id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let session = RemoteSession::start(
            id.clone(),
            device_id.to_string(),
            device_name.to_string(),
            Arc::clone(&self.backend),
            target,
            options,
        );
        if let Ok(mut sessions) = self.sessions.write() {
            sessions.insert(id.clone(), Arc::clone(&session));
        }
        self.announce();
        Ok(session)
    }

    pub fn get(&self, id: &str) -> Option<Arc<RemoteSession>> {
        self.sessions.read().ok().and_then(|sessions| sessions.get(id).cloned())
    }

    fn session_ids(&self) -> Vec<String> {
        self.sessions
            .read()
            .map(|sessions| sessions.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Stop a session and free its capture/encoder resources.
    pub fn terminate(&self, id: &str) {
        let removed = self
            .sessions
            .write()
            .ok()
            .and_then(|mut sessions| sessions.remove(id));
        if let Some(session) = removed {
            session.shutdown();
            self.announce();
        }
    }

    /// Terminate every session owned by a device — used when a device is revoked
    /// so a revoked phone cannot keep watching an already-open stream.
    pub fn terminate_device(&self, device_id: &str) {
        let owned: Vec<String> = self
            .sessions
            .read()
            .map(|sessions| {
                sessions
                    .iter()
                    .filter(|(_, session)| session.device_id == device_id)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for id in owned {
            self.terminate(&id);
        }
    }

    /// Drop a session once its last viewer leaves, so nothing keeps capturing
    /// for an empty room.
    pub fn reap_if_idle(&self, id: &str) {
        let idle = self
            .sessions
            .read()
            .ok()
            .and_then(|sessions| sessions.get(id).map(|session| session.viewer_count() == 0))
            .unwrap_or(false);
        if idle {
            self.terminate(id);
        }
    }

    pub fn infos(&self) -> Vec<RemoteSessionInfo> {
        // Deliberately no backend call here: `infos()` runs on the async
        // runtime (announce/GET), and window enumeration is a blocking platform
        // call. Labels fall back to the target's own name.
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .values()
                    .map(|session| RemoteSessionInfo {
                        id: session.id.clone(),
                        device_id: session.device_id.clone(),
                        device_name: session.device_name.clone(),
                        target: session.target(),
                        target_label: target_label(&session.target(), &[]),
                        viewers: session.viewer_count(),
                        started_at: session.started_at.to_rfc3339(),
                        width: session.width(),
                        height: session.height(),
                        fps: session.fps(),
                        kbps: session.kbps(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Advertise the new session set to every connected client (desktop + phone).
    fn announce(&self) {
        let sessions = self.infos();
        let active = sessions.first().map(|info| RemotePresence {
            active: true,
            session_id: info.id.clone(),
            device_name: info.device_name.clone(),
            target_label: info.target_label.clone(),
            sessions: sessions.clone(),
        });
        let presence = active.unwrap_or(RemotePresence {
            active: false,
            session_id: String::new(),
            device_name: String::new(),
            target_label: String::new(),
            sessions,
        });
        self.broadcast
            .broadcast(WsMessage::RemoteSessionState { presence });
    }

    /// A one-off JPEG of a target, as a data URI, for the picker's previews.
    pub fn snapshot_data_uri(
        &self,
        target: &RemoteTarget,
        quality: u8,
        max_width: u32,
    ) -> RemoteResult<String> {
        if !self.enabled() {
            return Err(RemoteError::Unsupported(
                "remote control is disabled on this computer".to_string(),
            ));
        }
        let (bytes, _, _) =
            session::snapshot_jpeg(&self.backend, target, quality, max_width)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(format!("data:image/jpeg;base64,{encoded}"))
    }
}

/// Human label for a target, preferring the real window title when we can
/// resolve it and a stable fallback otherwise.
pub fn target_label(target: &RemoteTarget, windows: &[types::WindowInfo]) -> String {
    match target {
        RemoteTarget::Desktop => "Desktop".to_string(),
        RemoteTarget::Display { id } => format!("Display {}", id + 1),
        RemoteTarget::Window { id } => windows
            .iter()
            .find(|window| window.id == *id)
            .map(|window| window.app_name.clone())
            .unwrap_or_else(|| format!("Window {id}")),
    }
}

impl RemoteManager {
    /// A manager backed by no platform backend, for tests and for embedding
    /// contexts that build an `AppState` without a daemon. Every call reports
    /// `Unsupported` rather than panicking.
    pub fn headless() -> Arc<Self> {
        Arc::new(Self::new(
            Arc::new(platform::UnsupportedBackend),
            BroadcastHub::new(),
            false,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::platform::UnsupportedBackend;

    fn manager(enabled: bool) -> RemoteManager {
        RemoteManager::new(
            Arc::new(UnsupportedBackend),
            BroadcastHub::new(),
            enabled,
        )
    }

    #[test]
    fn disabled_gate_refuses_attach() {
        let manager = manager(false);
        let error = match manager.attach(
            None,
            "device",
            "iPhone",
            RemoteTarget::Desktop,
            StreamOptions::default(),
        ) {
            Err(error) => error,
            Ok(_) => panic!("attach must be refused while the gate is off"),
        };
        assert_eq!(error.code(), "unsupported");
    }

    #[test]
    fn enabled_attach_registers_and_terminate_clears() {
        let manager = manager(true);
        let session = manager
            .attach(None, "device", "iPhone", RemoteTarget::Desktop, StreamOptions::default())
            .unwrap();
        assert!(manager.get(&session.id).is_some());
        manager.terminate(&session.id);
        assert!(manager.get(&session.id).is_none());
    }

    #[test]
    fn target_label_uses_window_title() {
        let windows = vec![types::WindowInfo {
            id: 7,
            display_id: 0,
            title: "main.rs — demo".into(),
            app_name: "VS Code".into(),
            app_id: Some("code".into()),
            pid: None,
            process: None,
            project: None,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            minimized: false,
            focused: true,
        }];
        assert_eq!(target_label(&RemoteTarget::Window { id: 7 }, &windows), "VS Code");
        assert_eq!(target_label(&RemoteTarget::Display { id: 1 }, &windows), "Display 2");
    }
}
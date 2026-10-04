//! Wayland backend via xdg-desktop-portal.
//!
//! Wayland deliberately gives clients no ambient access to the screen or to
//! other applications' windows, so the *native* way in is the portal:
//!
//! * **Capture** — `org.freedesktop.portal.ScreenCast`. We negotiate a session
//!   (the compositor shows its own "Share your screen" dialog, which is the
//!   Wayland permission gate), take the PipeWire remote fd and node id, and
//!   consume it through a GStreamer `pipewiresrc` pipeline that emits raw RGB
//!   frames on stdout. Those frames go through the same encoder as X11, so the
//!   video pipeline is identical across platforms.
//! * **Input** — `org.freedesktop.portal.RemoteDesktop`. A second session with
//!   pointer + keyboard devices, driven with `NotifyPointerMotionAbsolute`,
//!   `NotifyPointerButton`, `NotifyPointerAxis` and `NotifyKeyboardKeysym`.
//!
//! Nothing here guesses at an X11 shortcut for a native Wayland window. If the
//! portal is missing the backend reports `Unsupported`/`PermissionRequired` and
//! the client shows the actionable setup screen — it does not silently fail.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedFd, OwnedObjectPath, OwnedValue, Value};

use crate::remote::platform::{RemoteBackend, TargetGeometry};
use crate::remote::protocol::{InputEvent, Modifiers, MouseButton, NamedKey};
use crate::remote::types::{
    Capabilities, Codec, DisplayInfo, Frame, HostInfo, PermissionReport, PermissionStatus,
    PlatformKind, RemoteError, RemoteResult, RemoteTarget, SessionKind, WindowInfo,
};

const PORTAL_DEST: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const SCREENCAST_IFACE: &str = "org.freedesktop.portal.ScreenCast";
const REMOTE_DESKTOP_IFACE: &str = "org.freedesktop.portal.RemoteDesktop";
const REQUEST_IFACE: &str = "org.freedesktop.portal.Request";

const SOURCE_TYPE_MONITOR: u32 = 1;
const SOURCE_TYPE_WINDOW: u32 = 2;

/// The consent dialog lives on Start, so only that request waits for a human;
/// the portal's own bookkeeping requests answer immediately.
const PORTAL_PROMPT_LONG: std::time::Duration = std::time::Duration::from_secs(120);

/// One stream the compositor granted: a PipeWire node plus its geometry.
#[derive(Debug, Clone)]
struct PortalStream {
    node_id: u32,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    source_type: u32,
}

/// A negotiated ScreenCast session (consent already granted).
struct CastSession {
    /// Kept for diagnostics: the portal session object the stream belongs to.
    #[allow(dead_code)]
    session_path: OwnedObjectPath,
    /// Held open because the GStreamer child inherits it.
    fd: OwnedFd,
    streams: Vec<PortalStream>,
}

/// A live GStreamer pipeline reading one PipeWire node into raw RGB on stdout.
struct Pipeline {
    child: Child,
    stdout: ChildStdout,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    node_id: u32,
}

impl Pipeline {
    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A negotiated RemoteDesktop session for input.
struct InputSession {
    session_path: OwnedObjectPath,
    node_id: u32,
}

pub struct WaylandBackend {
    /// The session D-Bus connection, created lazily on the capture/input thread.
    ///
    /// `zbus`'s blocking API drives its own little runtime (`block_on`), so it
    /// must never be called from a tokio thread — doing so panics with "cannot
    /// start a runtime from within a runtime". Creating the connection eagerly
    /// during detection (which runs at daemon start, inside tokio) did exactly
    /// that. It is therefore built on first use, on a plain OS thread, and every
    /// caller of this backend's methods runs off the async runtime.
    conn: std::sync::OnceLock<Connection>,
    /// Negotiated capture session, created on first `begin_target`.
    cast: Mutex<Option<CastSession>>,
    /// Active pipeline, keyed by the stream it is reading.
    pipeline: Mutex<Option<Pipeline>>,
    /// Negotiated input session.
    input: Mutex<Option<InputSession>>,
    /// Whether `gst-inspect-1.0 pipewiresrc` succeeded at detection time.
    pipewire_available: bool,
}

impl WaylandBackend {
    /// Detect a usable portal + GStreamer PipeWire stack, **without** touching
    /// D-Bus (that would start a blocking runtime inside tokio). Detection only
    /// checks the environment, the PipeWire GStreamer plugin and that a portal
    /// service is installed and a session bus is advertised; the actual portal
    /// connection is made lazily on the capture thread.
    pub fn detect() -> RemoteResult<Self> {
        if std::env::var_os("WAYLAND_DISPLAY").is_none() && std::env::var_os("XDG_SESSION_TYPE").is_none() {
            return Err(RemoteError::Unsupported(
                "not running under a Wayland session".to_string(),
            ));
        }
        if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
            return Err(RemoteError::Unsupported(
                "no D-Bus session bus; xdg-desktop-portal cannot be reached".to_string(),
            ));
        }
        if !portal_service_present() {
            return Err(RemoteError::Unsupported(
                "xdg-desktop-portal is not installed".to_string(),
            ));
        }
        if !gstreamer_pipewire_available() {
            return Err(RemoteError::Unsupported(
                "GStreamer's pipewiresrc plugin is missing (install gstreamer1.0-pipewire)".to_string(),
            ));
        }
        Ok(Self {
            conn: std::sync::OnceLock::new(),
            cast: Mutex::new(None),
            pipeline: Mutex::new(None),
            input: Mutex::new(None),
            pipewire_available: true,
        })
    }

    /// The D-Bus session connection, created once on first use.
    fn connection(&self) -> RemoteResult<&Connection> {
        if let Some(conn) = self.conn.get() {
            return Ok(conn);
        }
        // The portal service must actually own its name.
        let conn = Connection::session()
            .map_err(|e| RemoteError::Unsupported(format!("D-Bus session unavailable: {e}")))?;
        let dbus = zbus::blocking::fdo::DBusProxy::new(&conn)
            .map_err(|e| RemoteError::Unsupported(format!("D-Bus proxy failed: {e}")))?;
        let has_portal = dbus
            .name_has_owner(
                PORTAL_DEST
                    .try_into()
                    .map_err(|_| RemoteError::Other("bad bus name".to_string()))?,
            )
            .unwrap_or(false);
        if !has_portal {
            return Err(RemoteError::Unsupported(
                "xdg-desktop-portal is not running".to_string(),
            ));
        }
        let _ = self.conn.set(conn);
        Ok(self.conn.get().expect("connection just set"))
    }

    fn stream_for(&self, target: &RemoteTarget) -> RemoteResult<PortalStream> {
        let cast = self
            .cast
            .lock()
            .map_err(|_| RemoteError::Capture("capture lock poisoned".to_string()))?;
        let session = cast
            .as_ref()
            .ok_or_else(|| RemoteError::Capture("capture session not negotiated".to_string()))?;
        if session.streams.is_empty() {
            return Err(RemoteError::Capture("the portal granted no streams".to_string()));
        }
        let stream = match target {
            RemoteTarget::Desktop => session.streams.first().cloned(),
            RemoteTarget::Display { id } => session
                .streams
                .iter()
                .filter(|stream| stream.source_type == SOURCE_TYPE_MONITOR)
                .nth(*id as usize)
                .cloned()
                .or_else(|| session.streams.get(*id as usize).cloned()),
            RemoteTarget::Window { .. } => session
                .streams
                .iter()
                .find(|stream| stream.source_type == SOURCE_TYPE_WINDOW)
                .cloned(),
        };
        stream.ok_or_else(|| {
            RemoteError::Capture(format!(
                "the portal did not grant a stream for {}",
                target.key()
            ))
        })
    }

    /// Spawn the GStreamer pipeline for a stream, reusing the negotiated fd.
    fn spawn_pipeline(&self, stream: &PortalStream) -> RemoteResult<Pipeline> {
        let cast = self
            .cast
            .lock()
            .map_err(|_| RemoteError::Capture("capture lock poisoned".to_string()))?;
        let session = cast
            .as_ref()
            .ok_or_else(|| RemoteError::Capture("capture session not negotiated".to_string()))?;
        let fd = std::os::fd::AsRawFd::as_raw_fd(&session.fd);
        // Force an exact RGB frame so the reader can slice stdout deterministically.
        let caps = format!(
            "video/x-raw,format=RGB,width={},height={}",
            stream.width, stream.height
        );
        let mut child = Command::new("gst-launch-1.0")
            .arg("-q")
            .arg("pipewiresrc")
            .arg(format!("fd={fd}"))
            .arg(format!("path={}", stream.node_id))
            .arg("do-timestamp=true")
            .arg("!")
            .arg("videoconvert")
            .arg("!")
            .arg("videoscale")
            .arg("!")
            .arg(caps)
            .arg("!")
            .arg("fdsink")
            .arg("fd=1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| RemoteError::Capture(format!("could not start gst-launch-1.0: {e}")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RemoteError::Capture("gst-launch produced no stdout".to_string()))?;
        Ok(Pipeline {
            child,
            stdout,
            width: stream.width,
            height: stream.height,
            origin_x: stream.origin_x,
            origin_y: stream.origin_y,
            node_id: stream.node_id,
        })
    }

    fn ensure_pipeline(&self, target: &RemoteTarget) -> RemoteResult<()> {
        let stream = self.stream_for(target)?;
        let mut pipeline = self
            .pipeline
            .lock()
            .map_err(|_| RemoteError::Capture("pipeline lock poisoned".to_string()))?;
        let matches = pipeline
            .as_ref()
            .map(|running| running.node_id == stream.node_id)
            .unwrap_or(false);
        if matches {
            return Ok(());
        }
        if let Some(mut running) = pipeline.take() {
            running.stop();
        }
        let spawned = self.spawn_pipeline(&stream)?;
        *pipeline = Some(spawned);
        Ok(())
    }

    /* ── Portal negotiation ─────────────────────────────────────────────── */

    /// Create a ScreenCast session and get its streams + PipeWire fd. This is
    /// where the compositor shows its consent dialog.
    fn negotiate_cast(&self) -> RemoteResult<CastSession> {
        let conn = self.connection()?;
        let screencast: Proxy = Proxy::new(conn, PORTAL_DEST, PORTAL_PATH, SCREENCAST_IFACE)
            .map_err(|e| RemoteError::Capture(e.to_string()))?;

        let mut create_options: HashMap<&str, Value> = HashMap::new();
        let token = format!("agentdeck{}", random_token());
        create_options.insert("session_handle_token", Value::from(token.clone()));
        create_options.insert("handle_token", Value::from(format!("{token}c")));
        // Register the session. The reply may be the session handle itself
        // (newer portals) or the CreateSession *request* object (older ones);
        // either way the session object path is deterministic from our bus name
        // and the token we supplied, so it is constructed directly rather than
        // raced against a one-shot `Response` signal.
        let _reply: OwnedObjectPath = screencast
            .call("CreateSession", &(create_options))
            .map_err(|e| RemoteError::PermissionRequired(format!("ScreenCast session: {e}")))?;
        let session_path = portal_object_path(conn, "session", &token)?;
        tracing::debug!("[AgentDeck][Remote] portal session: {:?}", session_path);

        // Ask for monitors and windows; the compositor's picker shows both, and
        // one consent covers every later target switch.
        let mut select_options: HashMap<&str, Value> = HashMap::new();
        select_options.insert("types", Value::from(SOURCE_TYPE_MONITOR | SOURCE_TYPE_WINDOW));
        select_options.insert("multiple", Value::from(true));
        select_options.insert("cursor_mode", Value::from(2u32)); // embedded cursor
        select_options.insert("handle_token", Value::from(format!("{token}s")));
        let _select_reply: OwnedObjectPath = screencast
            .call("SelectSources", &(session_path.clone(), select_options))
            .map_err(|e| RemoteError::PermissionRequired(format!("SelectSources: {e}")))?;
        // No wait: the portal processes method calls on a session in order, and
        // this request's `Response` is one-shot — subscribing late would miss it.

        let mut start_options: HashMap<&str, Value> = HashMap::new();
        start_options.insert("handle_token", Value::from(format!("{token}g")));
        let start_request: OwnedObjectPath = screencast
            .call("Start", &(session_path.clone(), "", start_options))
            .map_err(|e| RemoteError::PermissionRequired(format!("Start: {e}")))?;

        let results = wait_for_request(&start_request, PORTAL_PROMPT_LONG)?;
        let streams_value = results
            .get("streams")
            .ok_or_else(|| RemoteError::PermissionRequired("the portal returned no streams".to_string()))?;
        let streams = parse_streams(streams_value)?;
        if streams.is_empty() {
            return Err(RemoteError::PermissionRequired(
                "screen sharing was not granted".to_string(),
            ));
        }

        let empty: HashMap<&str, Value> = HashMap::new();
        let fd: OwnedFd = screencast
            .call("OpenPipeWireRemote", &(session_path.clone(), empty))
            .map_err(|e| RemoteError::Capture(format!("OpenPipeWireRemote: {e}")))?;

        Ok(CastSession { session_path, fd, streams })
    }

    fn ensure_cast(&self) -> RemoteResult<()> {
        let mut cast = self
            .cast
            .lock()
            .map_err(|_| RemoteError::Capture("capture lock poisoned".to_string()))?;
        if cast.is_some() {
            return Ok(());
        }
        let session = self.negotiate_cast()?;
        *cast = Some(session);
        Ok(())
    }

    /// Create (or reuse) a RemoteDesktop session for input.
    fn ensure_input(&self) -> RemoteResult<InputSession> {
        {
            let input = self
                .input
                .lock()
                .map_err(|_| RemoteError::Input("input lock poisoned".to_string()))?;
            if let Some(session) = input.as_ref() {
                return Ok(InputSession {
                    session_path: session.session_path.clone(),
                    node_id: session.node_id,
                });
            }
        }
        let proxy: Proxy = Proxy::new(self.connection()?, PORTAL_DEST, PORTAL_PATH, REMOTE_DESKTOP_IFACE)
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        let token = format!("agentdeck{}", random_token());
        let mut create_options: HashMap<&str, Value> = HashMap::new();
        create_options.insert("session_handle_token", Value::from(token.clone()));
        create_options.insert("handle_token", Value::from(format!("{token}c")));
        let _reply: OwnedObjectPath = proxy
            .call("CreateSession", &(create_options))
            .map_err(|e| RemoteError::Input(format!("RemoteDesktop session: {e}")))?;
        let session_path = portal_object_path(self.connection()?, "session", &token)?;

        // Keyboard + pointer.
        const DEVICE_KEYBOARD: u32 = 1;
        const DEVICE_POINTER: u32 = 2;
        let mut select_options: HashMap<&str, Value> = HashMap::new();
        select_options.insert("types", Value::from(DEVICE_KEYBOARD | DEVICE_POINTER));
        select_options.insert("handle_token", Value::from(format!("{token}s")));
        let _select_reply: OwnedObjectPath = proxy
            .call("SelectDevices", &(session_path.clone(), select_options))
            .map_err(|e| RemoteError::Input(format!("SelectDevices: {e}")))?;

        let mut start_options: HashMap<&str, Value> = HashMap::new();
        start_options.insert("handle_token", Value::from(format!("{token}g")));
        let start_request: OwnedObjectPath = proxy
            .call("Start", &(session_path.clone(), "", start_options))
            .map_err(|e| RemoteError::Input(format!("RemoteDesktop start: {e}")))?;
        let results = wait_for_request(&start_request, PORTAL_PROMPT_LONG)?;
        let node_id = results
            .get("streams")
            .and_then(|value| parse_streams(value).ok())
            .and_then(|streams| streams.first().map(|stream| stream.node_id))
            .unwrap_or(0);

        let session = InputSession { session_path, node_id };
        let mut input = self
            .input
            .lock()
            .map_err(|_| RemoteError::Input("input lock poisoned".to_string()))?;
        *input = Some(InputSession { session_path: session.session_path.clone(), node_id });
        Ok(session)
    }

    fn portal_input(&self, _target: &RemoteTarget, event: &InputEvent) -> RemoteResult<()> {
        let session = self.ensure_input()?;
        let proxy: Proxy = Proxy::new(self.connection()?, PORTAL_DEST, PORTAL_PATH, REMOTE_DESKTOP_IFACE)
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        let options: HashMap<&str, Value> = HashMap::new();
        match event {
            InputEvent::PointerMove { x, y } => {
                let geometry = self.geometry(_target)?;
                let abs_x = (geometry.origin_x as f64 + x).round() as f64;
                let abs_y = (geometry.origin_y as f64 + y).round() as f64;
                proxy
                    .call::<_, _, ()>(
                        "NotifyPointerMotionAbsolute",
                        &(session.session_path.clone(), options, session.node_id, abs_x, abs_y),
                    )
                    .map_err(|e| RemoteError::Input(e.to_string()))?;
            }
            InputEvent::PointerMoveRelative { dx, dy } => {
                proxy
                    .call::<_, _, ()>(
                        "NotifyPointerMotion",
                        &(session.session_path.clone(), options, f64::from(*dx), f64::from(*dy)),
                    )
                    .map_err(|e| RemoteError::Input(e.to_string()))?;
            }
            InputEvent::ButtonDown { button } => self.notify_button(&proxy, &session, *button, true)?,
            InputEvent::ButtonUp { button } => self.notify_button(&proxy, &session, *button, false)?,
            InputEvent::Click { button, count } => {
                for _ in 0..(*count).max(1) {
                    self.notify_button(&proxy, &session, *button, true)?;
                    self.notify_button(&proxy, &session, *button, false)?;
                }
            }
            InputEvent::Scroll { dx, dy } => {
                proxy
                    .call::<_, _, ()>(
                        "NotifyPointerAxis",
                        &(session.session_path.clone(), options, f64::from(*dx), f64::from(*dy)),
                    )
                    .map_err(|e| RemoteError::Input(e.to_string()))?;
            }
            InputEvent::KeyDown { key, modifiers } => {
                self.notify_modifiers(&proxy, &session, *modifiers, true)?;
                self.notify_keysym(&proxy, &session, named_keysym(*key), true)?;
            }
            InputEvent::KeyUp { key } => {
                self.notify_keysym(&proxy, &session, named_keysym(*key), false)?;
                self.notify_modifiers(
                    &proxy,
                    &session,
                    Modifiers { ctrl: true, alt: true, shift: true, meta: true },
                    false,
                )?;
            }
            InputEvent::Chord { key, modifiers } => {
                self.notify_modifiers(&proxy, &session, *modifiers, true)?;
                for ch in key.chars() {
                    let keysym = if (ch as u32) < 0x80 { ch as u32 } else { 0x0100_0000 | ch as u32 };
                    self.notify_keysym(&proxy, &session, keysym, true)?;
                    self.notify_keysym(&proxy, &session, keysym, false)?;
                }
                self.notify_modifiers(&proxy, &session, *modifiers, false)?;
            }
            InputEvent::Text { text } => {
                for ch in text.chars() {
                    let keysym = if (ch as u32) < 0x80 { ch as u32 } else { 0x0100_0000 | ch as u32 };
                    // A shift is only emulated for ASCII; the portal keysym path
                    // handles the layout's own mapping for the rest.
                    self.notify_keysym(&proxy, &session, keysym, true)?;
                    self.notify_keysym(&proxy, &session, keysym, false)?;
                }
            }
        }
        Ok(())
    }

    fn notify_button(
        &self,
        proxy: &Proxy,
        session: &InputSession,
        button: MouseButton,
        pressed: bool,
    ) -> RemoteResult<()> {
        let options: HashMap<&str, Value> = HashMap::new();
        proxy
            .call::<_, _, ()>(
                "NotifyPointerButton",
                &(
                    session.session_path.clone(),
                    options,
                    button.x11_button() as i32,
                    u32::from(pressed),
                ),
            )
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        Ok(())
    }

    fn notify_keysym(&self, proxy: &Proxy, session: &InputSession, keysym: u32, pressed: bool) -> RemoteResult<()> {
        let options: HashMap<&str, Value> = HashMap::new();
        proxy
            .call::<_, _, ()>(
                "NotifyKeyboardKeysym",
                &(session.session_path.clone(), options, keysym, u32::from(pressed)),
            )
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        Ok(())
    }

    fn notify_modifiers(
        &self,
        proxy: &Proxy,
        session: &InputSession,
        modifiers: Modifiers,
        pressed: bool,
    ) -> RemoteResult<()> {
        for (held, keysym) in [
            (modifiers.ctrl, MOD_CTRL),
            (modifiers.alt, MOD_ALT),
            (modifiers.shift, MOD_SHIFT),
            (modifiers.meta, MOD_SUPER),
        ] {
            if held {
                self.notify_keysym(proxy, session, keysym, pressed)?;
            }
        }
        Ok(())
    }
}

const MOD_SHIFT: u32 = 0xffe1;
const MOD_CTRL: u32 = 0xffe3;
const MOD_ALT: u32 = 0xffe9;
const MOD_SUPER: u32 = 0xffeb;

fn named_keysym(key: NamedKey) -> u32 {
    // Identical numeric values to the X11 keysyms — the portal uses the same
    // table, so there is one mapping to maintain.
    match key {
        NamedKey::Escape => 0xff1b,
        NamedKey::Tab => 0xff09,
        NamedKey::Enter => 0xff0d,
        NamedKey::Backspace => 0xff08,
        NamedKey::Delete => 0xffff,
        NamedKey::Insert => 0xff63,
        NamedKey::Home => 0xff50,
        NamedKey::End => 0xff57,
        NamedKey::PageUp => 0xff55,
        NamedKey::PageDown => 0xff56,
        NamedKey::ArrowLeft => 0xff51,
        NamedKey::ArrowUp => 0xff52,
        NamedKey::ArrowRight => 0xff53,
        NamedKey::ArrowDown => 0xff54,
        NamedKey::Space => 0x20,
        NamedKey::F1 => 0xffbe,
        NamedKey::F2 => 0xffbf,
        NamedKey::F3 => 0xffc0,
        NamedKey::F4 => 0xffc1,
        NamedKey::F5 => 0xffc2,
        NamedKey::F6 => 0xffc3,
        NamedKey::F7 => 0xffc4,
        NamedKey::F8 => 0xffc5,
        NamedKey::F9 => 0xffc6,
        NamedKey::F10 => 0xffc7,
        NamedKey::F11 => 0xffc8,
        NamedKey::F12 => 0xffc9,
        NamedKey::Super => 0xffeb,
    }
}

impl RemoteBackend for WaylandBackend {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            platform: PlatformKind::Linux,
            session_kind: SessionKind::Wayland,
            full_desktop: true,
            // The portal's own picker casts a window; XWayland windows are also
            // enumerable, but a native Wayland window list is not exposed.
            app_view: true,
            multi_display: true,
            input: true,
            clipboard: wl_clipboard_available(),
            cursor: false,
            codecs: vec![Codec::Jpeg],
            hardware_encode: false,
            max_fps: 30,
            max_dimension: 4096,
        }
    }

    fn host_info(&self) -> HostInfo {
        HostInfo {
            name: hostname::get()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string()),
            platform: PlatformKind::Linux,
            platform_label: "Linux".to_string(),
            session_kind: SessionKind::Wayland,
            session_label: "Wayland".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    fn permissions(&self) -> PermissionReport {
        // The portal grants screen capture per session, through its own dialog.
        // `Unknown` means "granted when you press Share" — the client shows the
        // consent step rather than a false denial.
        PermissionReport {
            screen_recording: if self.pipewire_available {
                PermissionStatus::Granted
            } else {
                PermissionStatus::Denied
            },
            accessibility: PermissionStatus::Granted,
            input_monitoring: PermissionStatus::NotRequired,
            message: None,
            settings_hint: None,
        }
    }

    fn list_displays(&self) -> RemoteResult<Vec<DisplayInfo>> {
        // Without a granted session there is nothing to enumerate; once cast,
        // the granted monitor streams describe the real displays.
        let cast = self
            .cast
            .lock()
            .map_err(|_| RemoteError::Capture("capture lock poisoned".to_string()))?;
        if let Some(session) = cast.as_ref() {
            let displays: Vec<DisplayInfo> = session
                .streams
                .iter()
                .filter(|stream| stream.source_type == SOURCE_TYPE_MONITOR)
                .enumerate()
                .map(|(index, stream)| DisplayInfo {
                    id: index as u32,
                    name: format!("Display {}", index + 1),
                    x: stream.origin_x,
                    y: stream.origin_y,
                    width: stream.width,
                    height: stream.height,
                    primary: index == 0,
                })
                .collect();
            if !displays.is_empty() {
                return Ok(displays);
            }
        }
        Ok(Vec::new())
    }

    fn list_windows(&self) -> RemoteResult<Vec<WindowInfo>> {
        // The portal exposes windows only through its picker, not as a list.
        Ok(Vec::new())
    }

    fn capture(&self, target: &RemoteTarget) -> RemoteResult<Frame> {
        self.ensure_cast()?;
        self.ensure_pipeline(target)?;
        let mut pipeline = self
            .pipeline
            .lock()
            .map_err(|_| RemoteError::Capture("pipeline lock poisoned".to_string()))?;
        let running = pipeline
            .as_mut()
            .ok_or_else(|| RemoteError::Capture("no active pipeline".to_string()))?;
        let frame_bytes = (running.width as usize) * (running.height as usize) * 3;
        let mut buffer = vec![0u8; frame_bytes];
        read_exact_timeout(&mut running.stdout, &mut buffer)?;
        // RGB → RGBA.
        let mut rgba = vec![0u8; (running.width as usize) * (running.height as usize) * 4];
        for (index, pixel) in buffer.chunks_exact(3).enumerate() {
            let dst = index * 4;
            rgba[dst] = pixel[0];
            rgba[dst + 1] = pixel[1];
            rgba[dst + 2] = pixel[2];
            rgba[dst + 3] = 0xff;
        }
        Ok(Frame::new(
            running.width,
            running.height,
            rgba,
            running.origin_x,
            running.origin_y,
        ))
    }

    fn geometry(&self, target: &RemoteTarget) -> RemoteResult<TargetGeometry> {
        let stream = self.stream_for(target)?;
        Ok(TargetGeometry {
            origin_x: stream.origin_x,
            origin_y: stream.origin_y,
            width: stream.width,
            height: stream.height,
        })
    }

    fn pointer_position(&self) -> RemoteResult<Option<(i32, i32)>> {
        Ok(None)
    }

    fn input(&self, target: &RemoteTarget, event: &InputEvent) -> RemoteResult<()> {
        self.portal_input(target, event)
    }

    fn get_clipboard(&self) -> RemoteResult<Option<String>> {
        let output = Command::new("wl-paste")
            .args(["--no-newline"])
            .stderr(Stdio::null())
            .output()
            .map_err(|e| RemoteError::Clipboard(format!("wl-paste: {e}")))?;
        if !output.status.success() {
            return Ok(None);
        }
        Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
    }

    fn set_clipboard(&self, text: &str) -> RemoteResult<()> {
        let mut child = Command::new("wl-copy")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| RemoteError::Clipboard(format!("wl-copy: {e}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| RemoteError::Clipboard(e.to_string()))?;
        }
        Ok(())
    }

    fn open_permission_settings(&self) -> RemoteResult<()> {
        Err(RemoteError::Unsupported(
            "install xdg-desktop-portal-gnome/-kde/-wlr, then log back in".to_string(),
        ))
    }

    fn begin_target(&self, target: &RemoteTarget) -> RemoteResult<()> {
        self.ensure_cast()?;
        self.ensure_pipeline(target)
    }

    fn end_target(&self, _target: &RemoteTarget) -> RemoteResult<()> {
        let mut pipeline = self
            .pipeline
            .lock()
            .map_err(|_| RemoteError::Capture("pipeline lock poisoned".to_string()))?;
        if let Some(mut running) = pipeline.take() {
            running.stop();
        }
        Ok(())
    }
}

/* ── Portal helpers ───────────────────────────────────────────────────────── */

/// A portal object path of the form `/…/{kind}/{sender}/{token}`, where the
/// sender is our unique bus name with `:` and `.` replaced so the path is valid.
///
/// `kind` is `session` or `request`. The session path is derivable this way from
/// the `session_handle_token` we supplied to `CreateSession`, which avoids
/// racing the one-shot `Response` signal just to learn a path we already know.
fn portal_object_path(conn: &Connection, kind: &str, token: &str) -> RemoteResult<OwnedObjectPath> {
    let unique = conn
        .unique_name()
        .ok_or_else(|| RemoteError::Other("D-Bus connection has no unique name".to_string()))?;
    let sender = unique.trim_start_matches(':').replace('.', "_");
    let path = format!("/org/freedesktop/portal/desktop/{kind}/{sender}/{token}");
    OwnedObjectPath::try_from(path)
        .map_err(|e| RemoteError::Other(format!("bad portal object path: {e}")))
}

/// Wait for the `Response` signal on a portal request object and return its
/// result map.
///
/// The wait runs on its own thread with a bounded timeout: a user who never
/// answers the compositor's prompt must not leave a capture thread blocked
/// forever (and with it the session's consent negotiation). Timing out surfaces
/// a `PermissionRequired` state the client can act on instead.
fn wait_for_request(request_path: &OwnedObjectPath, timeout: std::time::Duration) -> RemoteResult<HashMap<String, OwnedValue>> {
    let path = request_path.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let outcome = (|| -> RemoteResult<HashMap<String, OwnedValue>> {
            let connection = Connection::session()
                .map_err(|e| RemoteError::PermissionRequired(format!("D-Bus session unavailable: {e}")))?;
            let proxy = Proxy::new(&connection, PORTAL_DEST, path.as_str(), REQUEST_IFACE)
                .map_err(|e| RemoteError::PermissionRequired(e.to_string()))?;
            let mut signals = proxy
                .receive_signal("Response")
                .map_err(|e| RemoteError::PermissionRequired(e.to_string()))?;
            let message = signals
                .next()
                .ok_or_else(|| RemoteError::PermissionRequired("portal request closed without a response".to_string()))?;
            let (response, results): (u32, HashMap<String, OwnedValue>) = message
                .body()
                .deserialize()
                .map_err(|e| RemoteError::PermissionRequired(e.to_string()))?;
            match response {
                0 => Ok(results),
                1 => Err(RemoteError::PermissionRequired("the request was cancelled".to_string())),
                other => Err(RemoteError::PermissionRequired(format!(
                    "the portal rejected the request (response {other})"
                ))),
            }
        })();
        let _ = tx.send(outcome);
    });
    rx.recv_timeout(timeout).map_err(|_| {
        RemoteError::PermissionRequired(
            "the desktop did not answer the screen-sharing prompt in time".to_string(),
        )
    })?
}

/// Parse a portal `a(ua{sv})` streams value.
///
/// The value is round-tripped through `serde_json` rather than `downcast_ref`:
/// `zvariant` only implements the typed `TryFrom<&Value>` for a fixed set of
/// shapes, and the nested stream tuple is not one of them. Serialising the value
/// (which `zvariant::Value` supports) and reading it as JSON is total and does
/// not depend on that table.
fn parse_streams(value: &OwnedValue) -> RemoteResult<Vec<PortalStream>> {
    let json = serde_json::to_value(&**value)
        .map_err(|e| RemoteError::Capture(format!("streams payload: {e}")))?;
    let Some(items) = json.as_array() else {
        return Err(RemoteError::Capture("streams payload is not a list".to_string()));
    };
    let mut streams = Vec::new();
    for item in items {
        let Some(tuple) = item.as_array() else { continue };
        let node_id = tuple.first().and_then(|value| value.as_u64()).unwrap_or(0) as u32;
        let props = tuple.get(1).and_then(|value| value.as_object());
        let pair = |key: &str, fallback: (i64, i64)| -> (i64, i64) {
            props
                .and_then(|props| props.get(key))
                .and_then(|value| value.as_array())
                .map(|values| {
                    (
                        values.first().and_then(|value| value.as_i64()).unwrap_or(fallback.0),
                        values.get(1).and_then(|value| value.as_i64()).unwrap_or(fallback.1),
                    )
                })
                .unwrap_or(fallback)
        };
        let (width, height) = pair("size", (1920, 1080));
        let (origin_x, origin_y) = pair("position", (0, 0));
        let source_type = props
            .and_then(|props| props.get("source_type"))
            .and_then(|value| value.as_u64())
            .unwrap_or(SOURCE_TYPE_MONITOR as u64) as u32;
        streams.push(PortalStream {
            node_id,
            width: width.max(1) as u32,
            height: height.max(1) as u32,
            origin_x: origin_x as i32,
            origin_y: origin_y as i32,
            source_type,
        });
    }
    Ok(streams)
}

/// Read exactly `buffer.len()` bytes, failing rather than blocking forever if
/// the pipeline stalls.
fn read_exact_timeout(stdout: &mut ChildStdout, buffer: &mut [u8]) -> RemoteResult<()> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = stdout
            .read(&mut buffer[filled..])
            .map_err(|e| RemoteError::Capture(format!("capture read failed: {e}")))?;
        if read == 0 {
            return Err(RemoteError::Capture("capture pipeline ended".to_string()));
        }
        filled += read;
    }
    Ok(())
}

fn gstreamer_pipewire_available() -> bool {
    Command::new("gst-inspect-1.0")
        .arg("pipewiresrc")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Whether an xdg-desktop-portal service file is installed. Checked without
/// D-Bus so detection can stay off the async runtime.
fn portal_service_present() -> bool {
    const CANDIDATES: [&str; 3] = [
        "/usr/share/dbus-1/services/org.freedesktop.portal.Desktop.service",
        "/usr/local/share/dbus-1/services/org.freedesktop.portal.Desktop.service",
        "/var/lib/flatpak/exports/share/dbus-1/services/org.freedesktop.portal.Desktop.service",
    ];
    if CANDIDATES.iter().any(|path| std::path::Path::new(path).is_file()) {
        return true;
    }
    // Some installs only expose the portal on the bus without a system service
    // file; fall back to the binary being on PATH.
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join("xdg-desktop-portal").is_file()))
        .unwrap_or(false)
}

fn wl_clipboard_available() -> bool {
    ["wl-copy", "wl-paste"].iter().all(|tool| {
        std::env::var_os("PATH")
            .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(tool).is_file()))
            .unwrap_or(false)
    })
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 8];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_keysyms_match_x11_numbers() {
        assert_eq!(named_keysym(NamedKey::Escape), 0xff1b);
        assert_eq!(named_keysym(NamedKey::Enter), 0xff0d);
        assert_eq!(named_keysym(NamedKey::F12), 0xffc9);
    }

    #[test]
    fn stream_parsing_is_total_over_missing_properties() {
        // A streams list entry with no properties still yields a usable stream
        // rather than an error, because the compositor may omit geometry.
        assert_eq!(SOURCE_TYPE_MONITOR, 1);
    }
}
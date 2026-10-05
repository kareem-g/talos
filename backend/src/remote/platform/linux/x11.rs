//! X11 backend: native capture, input, window discovery and clipboard.
//!
//! Pure Rust through `x11rb` — no `ffmpeg`, no `scrot`, no `xdotool` shell-outs.
//! Capture is `GetImage` on the root drawable (which spans every monitor), input
//! is the XTEST extension, discovery is EWMH (`_NET_CLIENT_LIST`) plus RandR for
//! monitors, and the clipboard rides the `xclip` helper because X selections are
//! owner-async and implementing an owning event loop here would be a second,
//! unused event machine.
//!
//! This backend also covers a Wayland session's X11 windows through XWayland.

use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use x11rb::connection::Connection;
use x11rb::protocol::randr::ConnectionExt as RandrExt;
use x11rb::protocol::xfixes::ConnectionExt as XfixesExt;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ConnectionExt as XprotoExt, CreateWindowAux, EventMask, ImageFormat, MapState,
    Visualid, Window, WindowClass,
};
use x11rb::protocol::xtest::ConnectionExt as XTestExt;
use x11rb::rust_connection::RustConnection;

use crate::remote::platform::{RemoteBackend, TargetGeometry};
use crate::remote::protocol::{InputEvent, Modifiers, MouseButton, NamedKey};
use crate::remote::types::{
    Capabilities, Codec, DisplayInfo, Frame, HostInfo, PermissionReport, PlatformKind,
    RemoteError, RemoteResult, RemoteTarget, SessionKind, WindowInfo,
};

/* ── X11 keysym constants (the fixed part of the protocol) ────────────────── */

const KS_ESCAPE: u32 = 0xff1b;
const KS_TAB: u32 = 0xff09;
const KS_RETURN: u32 = 0xff0d;
const KS_BACKSPACE: u32 = 0xff08;
const KS_DELETE: u32 = 0xffff;
const KS_INSERT: u32 = 0xff63;
const KS_HOME: u32 = 0xff50;
const KS_END: u32 = 0xff57;
const KS_PAGE_UP: u32 = 0xff55;
const KS_PAGE_DOWN: u32 = 0xff56;
const KS_LEFT: u32 = 0xff51;
const KS_UP: u32 = 0xff52;
const KS_RIGHT: u32 = 0xff53;
const KS_DOWN: u32 = 0xff54;
const KS_SPACE: u32 = 0x20;
const KS_F1: u32 = 0xffbe;
const KS_SHIFT_L: u32 = 0xffe1;
const KS_CONTROL_L: u32 = 0xffe3;
const KS_ALT_L: u32 = 0xffe9;
const KS_SUPER_L: u32 = 0xffeb;
const KS_META_L: u32 = 0xffe7;

const EVENT_MOTION_NOTIFY: u8 = 6;
const EVENT_BUTTON_PRESS: u8 = 4;
const EVENT_BUTTON_RELEASE: u8 = 5;
const EVENT_KEY_PRESS: u8 = 2;
const EVENT_KEY_RELEASE: u8 = 3;

fn named_keysym(key: NamedKey) -> u32 {
    match key {
        NamedKey::Escape => KS_ESCAPE,
        NamedKey::Tab => KS_TAB,
        NamedKey::Enter => KS_RETURN,
        NamedKey::Backspace => KS_BACKSPACE,
        NamedKey::Delete => KS_DELETE,
        NamedKey::Insert => KS_INSERT,
        NamedKey::Home => KS_HOME,
        NamedKey::End => KS_END,
        NamedKey::PageUp => KS_PAGE_UP,
        NamedKey::PageDown => KS_PAGE_DOWN,
        NamedKey::ArrowLeft => KS_LEFT,
        NamedKey::ArrowUp => KS_UP,
        NamedKey::ArrowRight => KS_RIGHT,
        NamedKey::ArrowDown => KS_DOWN,
        NamedKey::Space => KS_SPACE,
        NamedKey::F1 => KS_F1,
        NamedKey::F2 => KS_F1 + 1,
        NamedKey::F3 => KS_F1 + 2,
        NamedKey::F4 => KS_F1 + 3,
        NamedKey::F5 => KS_F1 + 4,
        NamedKey::F6 => KS_F1 + 5,
        NamedKey::F7 => KS_F1 + 6,
        NamedKey::F8 => KS_F1 + 7,
        NamedKey::F9 => KS_F1 + 8,
        NamedKey::F10 => KS_F1 + 9,
        NamedKey::F11 => KS_F1 + 10,
        NamedKey::F12 => KS_F1 + 11,
        NamedKey::Super => KS_SUPER_L,
    }
}

/* ── Interned atoms ───────────────────────────────────────────────────────── */

struct Atoms {
    utf8_string: Atom,
    net_client_list: Atom,
    net_wm_name: Atom,
    net_wm_pid: Atom,
    net_wm_state: Atom,
    net_wm_state_hidden: Atom,
    net_wm_window_type: Atom,
    net_wm_window_type_desktop: Atom,
    net_wm_window_type_dock: Atom,
    wm_name: Atom,
    wm_class: Atom,
}

impl Atoms {
    fn intern(conn: &RustConnection) -> RemoteResult<Self> {
        let atom = |name: &str| -> RemoteResult<Atom> {
            Ok(conn
                .intern_atom(false, name.as_bytes())
                .map_err(|e| RemoteError::Other(e.to_string()))?
                .reply()
                .map_err(|e| RemoteError::Other(e.to_string()))?
                .atom)
        };
        Ok(Self {
            utf8_string: atom("UTF8_STRING")?,
            net_client_list: atom("_NET_CLIENT_LIST")?,
            net_wm_name: atom("_NET_WM_NAME")?,
            net_wm_pid: atom("_NET_WM_PID")?,
            net_wm_state: atom("_NET_WM_STATE")?,
            net_wm_state_hidden: atom("_NET_WM_STATE_HIDDEN")?,
            net_wm_window_type: atom("_NET_WM_WINDOW_TYPE")?,
            net_wm_window_type_desktop: atom("_NET_WM_WINDOW_TYPE_DESKTOP")?,
            net_wm_window_type_dock: atom("_NET_WM_WINDOW_TYPE_DOCK")?,
            wm_name: atom("WM_NAME")?,
            wm_class: atom("WM_CLASS")?,
        })
    }
}

/* ── Backend ──────────────────────────────────────────────────────────────── */

/// Modifier keycodes resolved from the current keyboard mapping.
#[derive(Debug, Clone, Copy, Default)]
struct ModifierCodes {
    ctrl: u8,
    alt: u8,
    shift: u8,
    meta: u8,
}

pub struct X11Backend {
    conn: RustConnection,
    screen_num: usize,
    root: Window,
    atoms: Atoms,
    /// keysym → (keycode, needs_shift)
    keysym_map: HashMap<u32, (u8, bool)>,
    /// Modifier keycodes by role.
    modifier_codes: ModifierCodes,
    /// Guard for clipboard helper spawns so concurrent read/write stay ordered.
    clipboard_lock: Mutex<()>,
}

impl X11Backend {
    pub fn connect() -> RemoteResult<Self> {
        let (conn, screen_num) =
            x11rb::connect(None).map_err(|e| RemoteError::Unsupported(format!("X11 unavailable: {e}")))?;
        let screen = conn
            .setup()
            .roots
            .get(screen_num)
            .ok_or_else(|| RemoteError::Other("X11 screen not found".to_string()))?
            .clone();
        let root = screen.root;
        let atoms = Atoms::intern(&conn)?;
        let (keysym_map, modifier_codes) = build_keymap(&conn)?;
        Ok(Self {
            conn,
            screen_num,
            root,
            atoms,
            keysym_map,
            modifier_codes,
            clipboard_lock: Mutex::new(()),
        })
    }

    fn root_geometry(&self) -> (u16, u16) {
        let screen = &self.conn.setup().roots[self.screen_num];
        (screen.width_in_pixels, screen.height_in_pixels)
    }

    fn sync(&self) -> RemoteResult<()> {
        self.conn
            .flush()
            .map_err(|e| RemoteError::Input(e.to_string()))
    }

    /// Absolute pointer position from the root pointer.
    fn pointer_abs(&self) -> RemoteResult<(i32, i32)> {
        let reply = self
            .conn
            .query_pointer(self.root)
            .map_err(|e| RemoteError::Input(e.to_string()))?
            .reply()
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        Ok((reply.root_x as i32, reply.root_y as i32))
    }

    fn move_absolute(&self, x: i32, y: i32) -> RemoteResult<()> {
        self.conn
            .xtest_fake_input(EVENT_MOTION_NOTIFY, 0, 0, self.root, x as i16, y as i16, 0)
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        self.sync()
    }

    fn button(&self, button: MouseButton, press: bool) -> RemoteResult<()> {
        let event = if press { EVENT_BUTTON_PRESS } else { EVENT_BUTTON_RELEASE };
        self.conn
            .xtest_fake_input(event, button.x11_button(), 0, 0, 0, 0, 0)
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        self.sync()
    }

    fn keycode(&self, keysym: u32) -> Option<u8> {
        self.keysym_map.get(&keysym).map(|(code, _)| *code)
    }

    fn key_event(&self, keycode: u8, press: bool) -> RemoteResult<()> {
        let event = if press { EVENT_KEY_PRESS } else { EVENT_KEY_RELEASE };
        self.conn
            .xtest_fake_input(event, keycode, 0, 0, 0, 0, 0)
            .map_err(|e| RemoteError::Input(e.to_string()))?;
        Ok(())
    }

    fn press_modifiers(&self, modifiers: Modifiers) -> RemoteResult<()> {
        for (held, code) in [
            (modifiers.ctrl, self.modifier_codes.ctrl),
            (modifiers.alt, self.modifier_codes.alt),
            (modifiers.shift, self.modifier_codes.shift),
            (modifiers.meta, self.modifier_codes.meta),
        ] {
            if held {
                self.key_event(code, true)?;
            }
        }
        Ok(())
    }

    fn release_modifiers(&self, modifiers: Modifiers) -> RemoteResult<()> {
        for (held, code) in [
            (modifiers.meta, self.modifier_codes.meta),
            (modifiers.shift, self.modifier_codes.shift),
            (modifiers.alt, self.modifier_codes.alt),
            (modifiers.ctrl, self.modifier_codes.ctrl),
        ] {
            if held {
                self.key_event(code, false)?;
            }
        }
        Ok(())
    }

    /// Type one unicode scalar as keystrokes.
    fn type_char(&self, ch: char) -> RemoteResult<()> {
        let codepoint = ch as u32;
        let keysym = if codepoint < 0x80 {
            codepoint
        } else {
            // X11's Unicode keysym convention.
            0x0100_0000 | codepoint
        };
        let Some((keycode, needs_shift)) = self.keysym_map.get(&keysym).copied() else {
            // A character with no key on the current layout is skipped rather
            // than mistyped as something else.
            return Ok(());
        };
        if needs_shift {
            self.key_event(self.modifier_codes.shift, true)?;
        }
        self.key_event(keycode, true)?;
        self.key_event(keycode, false)?;
        if needs_shift {
            self.key_event(self.modifier_codes.shift, false)?;
        }
        Ok(())
    }

    fn target_region(&self, target: &RemoteTarget) -> RemoteResult<(i32, i32, u32, u32)> {
        match target {
            RemoteTarget::Desktop => {
                let (w, h) = self.root_geometry();
                Ok((0, 0, w as u32, h as u32))
            }
            RemoteTarget::Display { id } => {
                let displays = self.list_displays()?;
                let display = displays
                    .iter()
                    .find(|display| display.id == *id)
                    .or_else(|| displays.first())
                    .ok_or_else(|| RemoteError::Capture("no displays available".to_string()))?;
                Ok((display.x, display.y, display.width, display.height))
            }
            RemoteTarget::Window { id } => {
                let geometry = self.geometry(target)?;
                Ok((geometry.origin_x, geometry.origin_y, geometry.width, geometry.height))
            }
        }
    }

    /// Raw `GetImage` of a root region, converted to RGBA.
    ///
    /// The region is clamped to the root drawable first: `GetImage` answers a
    /// `BadMatch` when any part of the requested rectangle falls outside the
    /// drawable, which is exactly what happens for a window whose frame is
    /// partly off-screen (or whose geometry the compositor reports one pixel
    /// past the edge).
    fn grab_region(&self, x: i32, y: i32, width: u32, height: u32) -> RemoteResult<Frame> {
        let (root_width, root_height) = self.root_geometry();
        let root_width = root_width as i32;
        let root_height = root_height as i32;
        let left = x.clamp(0, (root_width - 1).max(0));
        let top = y.clamp(0, (root_height - 1).max(0));
        let max_width = (root_width - left).max(1) as u32;
        let max_height = (root_height - top).max(1) as u32;
        let width = width.max(1).min(max_width).min(16384);
        let height = height.max(1).min(max_height).min(16384);
        let reply = self
            .conn
            .get_image(
                ImageFormat::Z_PIXMAP,
                self.root,
                left as i16,
                top as i16,
                width as u16,
                height as u16,
                !0u32,
            )
            .map_err(|e| RemoteError::Capture(e.to_string()))?
            .reply()
            .map_err(|e| RemoteError::Capture(e.to_string()))?;

        let rgba = bgrx_to_rgba(&reply.data, width, height, reply.depth)?;
        Ok(Frame::new(width, height, rgba, left, top))
    }

    /// Draw the server's own cursor sprite into a captured frame.
    ///
    /// `GetImage` never includes the pointer, so without this an X11 view has no
    /// cursor at all and the client has to fake one. XFixes hands over the real
    /// cursor image, its hotspot and the position it was captured at, which is
    /// blended over the frame — the same pointer the machine is showing.
    fn composite_cursor(&self, frame: &mut Frame) {
        let Ok(cookie) = self.conn.xfixes_get_cursor_image() else {
            return;
        };
        let Ok(cursor) = cookie.reply() else {
            return;
        };
        let cw = cursor.width as i32;
        let ch = cursor.height as i32;
        if cw <= 0 || ch <= 0 {
            return;
        }
        let start_x = cursor.x as i32 - cursor.xhot as i32;
        let start_y = cursor.y as i32 - cursor.yhot as i32;
        let image = &cursor.cursor_image;
        if image.len() < (cw * ch) as usize {
            return;
        }
        for row in 0..ch {
            let fy = start_y + row - frame.origin_y;
            if fy < 0 || fy >= frame.height as i32 {
                continue;
            }
            for col in 0..cw {
                let fx = start_x + col - frame.origin_x;
                if fx < 0 || fx >= frame.width as i32 {
                    continue;
                }
                // XFixes delivers premultiplied ARGB.
                let argb = image[(row * cw + col) as usize];
                let alpha = ((argb >> 24) & 0xff) as u32;
                if alpha == 0 {
                    continue;
                }
                let src_r = (argb >> 16) & 0xff;
                let src_g = (argb >> 8) & 0xff;
                let src_b = argb & 0xff;
                let index = ((fy as u32 * frame.width + fx as u32) * 4) as usize;
                let inverse = 255 - alpha;
                frame.rgba[index] = (src_r + frame.rgba[index] as u32 * inverse / 255).min(255) as u8;
                frame.rgba[index + 1] =
                    (src_g + frame.rgba[index + 1] as u32 * inverse / 255).min(255) as u8;
                frame.rgba[index + 2] =
                    (src_b + frame.rgba[index + 2] as u32 * inverse / 255).min(255) as u8;
                frame.rgba[index + 3] = 255;
            }
        }
    }

    /// Raw `GetImage` of a drawable's own pixels (used for window capture).
    fn grab_drawable(
        &self,
        drawable: Window,
        width: u32,
        height: u32,
        origin_x: i32,
        origin_y: i32,
    ) -> RemoteResult<Frame> {
        let width = width.max(1).min(16384);
        let height = height.max(1).min(16384);
        let reply = self
            .conn
            .get_image(
                ImageFormat::Z_PIXMAP,
                drawable,
                0,
                0,
                width as u16,
                height as u16,
                !0u32,
            )
            .map_err(|e| RemoteError::Capture(e.to_string()))?
            .reply()
            .map_err(|e| RemoteError::Capture(e.to_string()))?;
        let rgba = bgrx_to_rgba(&reply.data, width, height, reply.depth)?;
        Ok(Frame::new(width, height, rgba, origin_x, origin_y))
    }
}

impl RemoteBackend for X11Backend {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            platform: PlatformKind::Linux,
            session_kind: SessionKind::X11,
            full_desktop: true,
            app_view: true,
            multi_display: true,
            input: true,
            clipboard: clipboard_helper_available(),
            cursor: true,
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
            session_kind: SessionKind::X11,
            session_label: "X11".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    fn permissions(&self) -> PermissionReport {
        // X11 has no per-app capture or control gate.
        PermissionReport::all_granted()
    }

    fn list_displays(&self) -> RemoteResult<Vec<DisplayInfo>> {
        // RandR monitors give per-monitor geometry and names. If RandR is
        // unavailable, fall back to the single X screen so the picker is never
        // empty.
        if let Ok(cookie) = self.conn.randr_get_monitors(self.root, true)
            && let Ok(reply) = cookie.reply()
            && !reply.monitors.is_empty()
        {
            return Ok(reply
                .monitors
                .iter()
                .enumerate()
                .map(|(index, monitor)| DisplayInfo {
                    id: index as u32,
                    name: format!("Display {}", index + 1),
                    x: monitor.x as i32,
                    y: monitor.y as i32,
                    width: monitor.width as u32,
                    height: monitor.height as u32,
                    primary: monitor.primary,
                })
                .collect());
        }
        let (width, height) = self.root_geometry();
        Ok(vec![DisplayInfo {
            id: 0,
            name: "Display 1".to_string(),
            x: 0,
            y: 0,
            width: width as u32,
            height: height as u32,
            primary: true,
        }])
    }

    fn list_windows(&self) -> RemoteResult<Vec<WindowInfo>> {
        let displays = self.list_displays()?;
        let client_list = self
            .conn
            .get_property(false, self.root, self.atoms.net_client_list, AtomEnum::WINDOW, 0, u32::MAX)
            .map_err(|e| RemoteError::Other(e.to_string()))?
            .reply()
            .map_err(|e| RemoteError::Other(e.to_string()))?;
        let Some(windows) = client_list.value32() else {
            return Ok(Vec::new());
        };

        let mut out = Vec::new();
        for window in windows {
            if let Some(info) = self.describe_window(window, &displays) {
                out.push(info);
            }
        }
        // Focused windows first, then most-recently-listed; the picker's order.
        out.sort_by(|a, b| b.focused.cmp(&a.focused).then_with(|| b.width.cmp(&a.width)));
        Ok(out)
    }

    fn capture(&self, target: &RemoteTarget) -> RemoteResult<Frame> {
        let mut frame = match target {
            // A window is read from its own drawable, not a crop of the root:
            // that is the native window-level capture, and it avoids BadMatch
            // for a window whose frame sits partly off-screen. The root-region
            // path stays for the desktop and per-monitor targets.
            RemoteTarget::Window { id } => {
                let window = *id as Window;
                let geometry = self
                    .conn
                    .get_geometry(window)
                    .map_err(|e| RemoteError::Capture(e.to_string()))?
                    .reply()
                    .map_err(|e| RemoteError::Capture(e.to_string()))?;
                // `map_state` lives on the window attributes, not on the
                // geometry reply; an unmapped drawable answers BadMatch.
                let attributes = self
                    .conn
                    .get_window_attributes(window)
                    .map_err(|e| RemoteError::Capture(e.to_string()))?
                    .reply()
                    .map_err(|e| RemoteError::Capture(e.to_string()))?;
                if attributes.map_state != MapState::VIEWABLE {
                    return Err(RemoteError::Capture(
                        "that window is not currently viewable".to_string(),
                    ));
                }
                let translated = self
                    .conn
                    .translate_coordinates(window, self.root, 0, 0)
                    .map_err(|e| RemoteError::Capture(e.to_string()))?
                    .reply()
                    .map_err(|e| RemoteError::Capture(e.to_string()))?;
                self.grab_drawable(
                    window,
                    geometry.width as u32,
                    geometry.height as u32,
                    translated.dst_x as i32,
                    translated.dst_y as i32,
                )?
            }
            _ => {
                let (x, y, width, height) = self.target_region(target)?;
                self.grab_region(x, y, width, height)?
            }
        };
        // The pointer is part of what is on screen; X11 never includes it in a
        // capture, so it is drawn here as the real sprite.
        self.composite_cursor(&mut frame);
        Ok(frame)
    }

    fn geometry(&self, target: &RemoteTarget) -> RemoteResult<TargetGeometry> {
        match target {
            RemoteTarget::Desktop => {
                let (w, h) = self.root_geometry();
                Ok(TargetGeometry { origin_x: 0, origin_y: 0, width: w as u32, height: h as u32 })
            }
            RemoteTarget::Display { id } => {
                let displays = self.list_displays()?;
                let display = displays
                    .iter()
                    .find(|display| display.id == *id)
                    .ok_or_else(|| RemoteError::Capture(format!("display {id} not found")))?;
                Ok(TargetGeometry {
                    origin_x: display.x,
                    origin_y: display.y,
                    width: display.width,
                    height: display.height,
                })
            }
            RemoteTarget::Window { id } => {
                let window = *id as Window;
                let geometry = self
                    .conn
                    .get_geometry(window)
                    .map_err(|e| RemoteError::Other(e.to_string()))?
                    .reply()
                    .map_err(|e| RemoteError::Other(e.to_string()))?;
                let translated = self
                    .conn
                    .translate_coordinates(window, self.root, 0, 0)
                    .map_err(|e| RemoteError::Other(e.to_string()))?
                    .reply()
                    .map_err(|e| RemoteError::Other(e.to_string()))?;
                Ok(TargetGeometry {
                    origin_x: translated.dst_x as i32,
                    origin_y: translated.dst_y as i32,
                    width: geometry.width as u32,
                    height: geometry.height as u32,
                })
            }
        }
    }

    fn pointer_position(&self) -> RemoteResult<Option<(i32, i32)>> {
        Ok(Some(self.pointer_abs()?))
    }

    fn input(&self, target: &RemoteTarget, event: &InputEvent) -> RemoteResult<()> {
        let geometry = self.geometry(target)?;
        let to_abs = |x: f64, y: f64| -> (i32, i32) {
            (
                geometry.origin_x + x.round() as i32,
                geometry.origin_y + y.round() as i32,
            )
        };
        match event {
            InputEvent::PointerMove { x, y } => {
                let (abs_x, abs_y) = to_abs(*x, *y);
                // Clamp inside the target so a stray coordinate cannot fling the
                // pointer onto another monitor.
                let abs_x = abs_x.clamp(geometry.origin_x, geometry.origin_x + geometry.width as i32 - 1);
                let abs_y = abs_y.clamp(geometry.origin_y, geometry.origin_y + geometry.height as i32 - 1);
                self.move_absolute(abs_x, abs_y)
            }
            InputEvent::PointerMoveRelative { dx, dy } => {
                let (x, y) = self.pointer_abs()?;
                self.move_absolute(x + dx.round() as i32, y + dy.round() as i32)
            }
            InputEvent::ButtonDown { button } => self.button(*button, true),
            InputEvent::ButtonUp { button } => self.button(*button, false),
            InputEvent::Click { button, count } => {
                for _ in 0..(*count).max(1) {
                    self.button(*button, true)?;
                    self.button(*button, false)?;
                }
                Ok(())
            }
            InputEvent::Scroll { dx, dy } => {
                // X11 wheel is clicky: convert pixel deltas to notches.
                let vertical = (dy.abs() / 50.0).ceil() as u32;
                let horizontal = (dx.abs() / 50.0).ceil() as u32;
                let v_button = if *dy < 0.0 { 4 } else { 5 };
                let h_button = if *dx < 0.0 { 6 } else { 7 };
                for _ in 0..vertical.min(12) {
                    self.conn
                        .xtest_fake_input(EVENT_BUTTON_PRESS, v_button, 0, 0, 0, 0, 0)
                        .map_err(|e| RemoteError::Input(e.to_string()))?;
                    self.conn
                        .xtest_fake_input(EVENT_BUTTON_RELEASE, v_button, 0, 0, 0, 0, 0)
                        .map_err(|e| RemoteError::Input(e.to_string()))?;
                }
                for _ in 0..horizontal.min(12) {
                    self.conn
                        .xtest_fake_input(EVENT_BUTTON_PRESS, h_button, 0, 0, 0, 0, 0)
                        .map_err(|e| RemoteError::Input(e.to_string()))?;
                    self.conn
                        .xtest_fake_input(EVENT_BUTTON_RELEASE, h_button, 0, 0, 0, 0, 0)
                        .map_err(|e| RemoteError::Input(e.to_string()))?;
                }
                self.sync()
            }
            InputEvent::KeyDown { key, modifiers } => {
                let keysym = named_keysym(*key);
                let code = self
                    .keycode(keysym)
                    .ok_or_else(|| RemoteError::Input(format!("no keycode for keysym {keysym:#x}")))?;
                self.press_modifiers(*modifiers)?;
                self.key_event(code, true)?;
                self.sync()
            }
            InputEvent::KeyUp { key } => {
                let keysym = named_keysym(*key);
                if let Some(code) = self.keycode(keysym) {
                    self.key_event(code, false)?;
                }
                // Release every modifier: the paired KeyDown carried them and a
                // stuck modifier is worse than a released one.
                self.release_modifiers(Modifiers {
                    ctrl: true,
                    alt: true,
                    shift: true,
                    meta: true,
                })?;
                self.sync()
            }
            InputEvent::Chord { key, modifiers } => {
                self.press_modifiers(*modifiers)?;
                for ch in key.chars() {
                    self.type_char(ch)?;
                }
                self.release_modifiers(*modifiers)?;
                self.sync()
            }
            InputEvent::Text { text } => {
                for ch in text.chars() {
                    if ch == '\n' {
                        if let Some(code) = self.keycode(KS_RETURN) {
                            self.key_event(code, true)?;
                            self.key_event(code, false)?;
                        }
                    } else if ch == '\t' {
                        if let Some(code) = self.keycode(KS_TAB) {
                            self.key_event(code, true)?;
                            self.key_event(code, false)?;
                        }
                    } else if ch == '\r' {
                        continue;
                    } else {
                        self.type_char(ch)?;
                    }
                }
                self.sync()
            }
        }
    }

    fn get_clipboard(&self) -> RemoteResult<Option<String>> {
        let _guard = self.clipboard_lock.lock().map_err(|_| RemoteError::Clipboard("clipboard lock poisoned".to_string()))?;
        let output = Command::new("xclip")
            .args(["-selection", "clipboard", "-o"])
            .stderr(Stdio::null())
            .output()
            .map_err(|e| RemoteError::Clipboard(format!("xclip: {e}")))?;
        if !output.status.success() {
            // An empty selection exits non-zero; that is "nothing copied", not
            // an error worth surfacing.
            return Ok(None);
        }
        Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
    }

    fn set_clipboard(&self, text: &str) -> RemoteResult<()> {
        let _guard = self.clipboard_lock.lock().map_err(|_| RemoteError::Clipboard("clipboard lock poisoned".to_string()))?;
        let mut child = Command::new("xclip")
            .args(["-selection", "clipboard", "-i"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| RemoteError::Clipboard(format!("xclip: {e}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| RemoteError::Clipboard(e.to_string()))?;
        }
        // xclip daemonises to keep owning the selection; do not wait on it.
        Ok(())
    }
}

impl X11Backend {
    fn describe_window(&self, window: Window, displays: &[DisplayInfo]) -> Option<WindowInfo> {
        let geometry = self.conn.get_geometry(window).ok()?.reply().ok()?;
        if geometry.width < 40 || geometry.height < 40 {
            return None;
        }
        let window_type = self.property_atoms(window, self.atoms.net_wm_window_type);
        if window_type.contains(&self.atoms.net_wm_window_type_desktop)
            || window_type.contains(&self.atoms.net_wm_window_type_dock)
        {
            return None;
        }
        let translated = self
            .conn
            .translate_coordinates(window, self.root, 0, 0)
            .ok()?
            .reply()
            .ok()?;

        let title = self
            .string_property(window, self.atoms.net_wm_name, self.atoms.utf8_string)
            .filter(|title| !title.trim().is_empty())
            .or_else(|| self.string_property(window, self.atoms.wm_name, AtomEnum::STRING.into()))
            .unwrap_or_default();

        // WM_CLASS carries "instance\0class\0"; the class is the app label.
        let wm_class = self.string_property_raw(window, self.atoms.wm_class);
        let app_id = wm_class
            .as_deref()
            .and_then(|raw| raw.split('\0').filter(|part| !part.is_empty()).next_back())
            .map(|value| value.to_string());
        let app_name = app_id
            .clone()
            .or_else(|| title.clone().split_whitespace().next().map(str::to_string))
            .unwrap_or_else(|| "Window".to_string());

        let pid = self
            .property_atoms(window, self.atoms.net_wm_pid)
            .first()
            .copied();
        let (process, project) = pid.map(process_details).unwrap_or((None, None));

        let state = self.property_atoms(window, self.atoms.net_wm_state);
        let minimized = state.contains(&self.atoms.net_wm_state_hidden);

        let center_x = translated.dst_x as i32 + geometry.width as i32 / 2;
        let center_y = translated.dst_y as i32 + geometry.height as i32 / 2;
        let display_id = displays
            .iter()
            .enumerate()
            .find(|(_, display)| {
                center_x >= display.x
                    && center_x < display.x + display.width as i32
                    && center_y >= display.y
                    && center_y < display.y + display.height as i32
            })
            .map(|(index, _)| index as u32)
            .unwrap_or(0);

        Some(WindowInfo {
            id: window as u64,
            display_id,
            title: if title.is_empty() { app_name.clone() } else { title },
            app_name,
            app_id,
            pid,
            process,
            project,
            x: translated.dst_x as i32,
            y: translated.dst_y as i32,
            width: geometry.width as u32,
            height: geometry.height as u32,
            minimized,
            focused: false,
        })
    }

    fn property_atoms(&self, window: Window, property: Atom) -> Vec<Atom> {
        self.conn
            .get_property(false, window, property, AtomEnum::ATOM, 0, u32::MAX)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.value32().map(|values| values.collect()))
            .unwrap_or_default()
    }

    fn string_property(&self, window: Window, property: Atom, type_: Atom) -> Option<String> {
        self.string_property_raw_type(window, property, type_)
    }

    fn string_property_raw(&self, window: Window, property: Atom) -> Option<String> {
        self.string_property_raw_type(window, property, AtomEnum::ANY.into())
    }

    fn string_property_raw_type(&self, window: Window, property: Atom, type_: Atom) -> Option<String> {
        let reply = self
            .conn
            .get_property(false, window, property, type_, 0, 1024)
            .ok()?
            .reply()
            .ok()?;
        if reply.value.is_empty() {
            return None;
        }
        Some(String::from_utf8_lossy(&reply.value).trim_end_matches('\0').to_string())
    }
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/// Convert an X11 ZPixmap buffer to RGBA. Handles the 24/32-bit truecolour
/// layouts X11 actually serves plus 16-bit RGB565, refusing anything else
/// instead of producing a corrupted image.
fn bgrx_to_rgba(data: &[u8], width: u32, height: u32, depth: u8) -> RemoteResult<Vec<u8>> {
    let pixels = (width as usize) * (height as usize);
    if pixels == 0 || data.is_empty() {
        return Err(RemoteError::Capture("empty capture buffer".to_string()));
    }
    let bpp = data.len() / pixels;
    let mut out = vec![0u8; pixels * 4];
    match bpp {
        4 => {
            for index in 0..pixels {
                let src = index * 4;
                let dst = index * 4;
                out[dst] = data[src + 2];
                out[dst + 1] = data[src + 1];
                out[dst + 2] = data[src];
                out[dst + 3] = 0xff;
            }
        }
        3 => {
            for index in 0..pixels {
                let src = index * 3;
                let dst = index * 4;
                out[dst] = data[src + 2];
                out[dst + 1] = data[src + 1];
                out[dst + 2] = data[src];
                out[dst + 3] = 0xff;
            }
        }
        2 => {
            for index in 0..pixels {
                let src = index * 2;
                let value = u16::from_le_bytes([data[src], data[src + 1]]);
                let r = ((value >> 11) & 0x1f) as u8;
                let g = ((value >> 5) & 0x3f) as u8;
                let b = (value & 0x1f) as u8;
                let dst = index * 4;
                out[dst] = (r << 3) | (r >> 2);
                out[dst + 1] = (g << 2) | (g >> 4);
                out[dst + 2] = (b << 3) | (b >> 2);
                out[dst + 3] = 0xff;
            }
        }
        _ => {
            return Err(RemoteError::Capture(format!(
                "unsupported X11 depth {depth} ({bpp} bytes/pixel)"
            )));
        }
    }
    Ok(out)
}

/// Build a keysym→keycode map and locate the four modifier keycodes.
fn build_keymap(conn: &RustConnection) -> RemoteResult<(HashMap<u32, (u8, bool)>, ModifierCodes)> {
    let setup = conn.setup();
    let min_keycode = setup.min_keycode;
    let max_keycode = setup.max_keycode;
    let count = max_keycode - min_keycode + 1;
    let reply = conn
        .get_keyboard_mapping(min_keycode, count)
        .map_err(|e| RemoteError::Other(e.to_string()))?
        .reply()
        .map_err(|e| RemoteError::Other(e.to_string()))?;
    let per_code = reply.keysyms_per_keycode as usize;
    let mut map: HashMap<u32, (u8, bool)> = HashMap::new();
    for (index, chunk) in reply.keysyms.chunks(per_code).enumerate() {
        let keycode = min_keycode + index as u8;
        // Slot 0 is unshifted, slot 1 is shifted. Only insert a keysym once so
        // the first (most native) binding wins.
        for (slot, keysym) in chunk.iter().enumerate().take(2) {
            if *keysym == 0 {
                continue;
            }
            map.entry(*keysym).or_insert((keycode, slot == 1));
        }
    }
    let codes = {
        let find = |keysym: u32| -> u8 { map.get(&keysym).map(|(code, _)| *code).unwrap_or(0) };
        ModifierCodes {
            ctrl: find(KS_CONTROL_L),
            alt: find(KS_ALT_L),
            shift: find(KS_SHIFT_L),
            meta: if find(KS_SUPER_L) != 0 { find(KS_SUPER_L) } else { find(KS_META_L) },
        }
    };
    Ok((map, codes))
}

/// Process name and working-directory basename for a pid, read from /proc.
fn process_details(pid: u32) -> (Option<String>, Option<String>) {
    let process = std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let project = std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().to_string()))
        .filter(|name| !name.is_empty() && name != "/");
    (process, project)
}

fn clipboard_helper_available() -> bool {
    ["xclip", "xsel"].iter().any(|tool| {
        std::env::var_os("PATH")
            .map(|paths| {
                std::env::split_paths(&paths).any(|dir| dir.join(tool).is_file())
            })
            .unwrap_or(false)
    })
}

/// Convenience for tests and callers: is there a usable X display?
pub fn display_available() -> bool {
    std::env::var_os("DISPLAY").is_some()
}

/// A portal `parent_window` handle for this process, created once.
///
/// `xdg-desktop-portal-gnome` will not show its screen-share dialog for a
/// caller with no window: it logs "Failed to associate portal window with
/// parent window" and the request then hangs until it times out, which is
/// exactly the silent black screen we chased. The portal's `parent_window`
/// argument takes an `x11:<id>` handle, so a tiny hidden window is parked here
/// for the life of the process and its id handed to the portal — the same
/// technique windowless capture tools use to get a dialog to appear.
pub fn parent_window_handle() -> Option<String> {
    static PARENT: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    PARENT
        .get_or_init(|| {
            let (conn, screen_num) = x11rb::connect(None).ok()?;
            let screen = conn.setup().roots.get(screen_num)?.clone();
            let window = conn.generate_id().ok()?;
            let aux = CreateWindowAux::new()
                .override_redirect(1)
                .event_mask(EventMask::NO_EVENT);
            conn.create_window(
                screen.root_depth,
                window,
                screen.root,
                0,
                0,
                1,
                1,
                0,
                WindowClass::INPUT_OUTPUT,
                // COPY_FROM_PARENT is visual id 0.
                Visualid::from(0u32),
                &aux,
            )
            .ok()?;
            conn.map_window(window).ok()?;
            conn.flush().ok()?;
            // The window must outlive the portal request, so the connection is
            // deliberately leaked rather than dropped (which would destroy it).
            std::mem::forget(conn);
            Some(format!("x11:{window:x}"))
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_bgrx_pixels_to_rgba() {
        // One pixel: B=0x11, G=0x22, R=0x33, X=0xff.
        let data = vec![0x11, 0x22, 0x33, 0xff];
        let rgba = bgrx_to_rgba(&data, 1, 1, 24).unwrap();
        assert_eq!(rgba, vec![0x33, 0x22, 0x11, 0xff]);
    }

    #[test]
    fn converts_rgb565_pixels_to_rgba() {
        // 0xF800 = pure red in RGB565.
        let data = 0xF800u16.to_le_bytes().to_vec();
        let rgba = bgrx_to_rgba(&data, 1, 1, 16).unwrap();
        assert_eq!(rgba, vec![255, 0, 0, 255]);
    }

    #[test]
    fn rejects_unknown_pixel_layouts() {
        assert!(bgrx_to_rgba(&[1, 2, 3, 4, 5, 6, 7, 8, 9], 1, 1, 24).is_err());
    }

    #[test]
    fn named_keys_are_distinct_where_they_matter() {
        assert_ne!(named_keysym(NamedKey::Escape), named_keysym(NamedKey::Enter));
        assert_eq!(named_keysym(NamedKey::F1) + 11, named_keysym(NamedKey::F12));
    }
}
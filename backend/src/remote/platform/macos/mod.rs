//! macOS backend: CoreGraphics capture and CGEvent input.
//!
//! Native frameworks only — no browser, no screenshots-as-a-service:
//!
//! * **Capture** — `CGDisplayCreateImage` (through `CGDisplay::image`) for a
//!   whole display, and `CGDisplayCreateImageForRect`/`CGDisplay::screenshot`
//!   with `kCGWindowListOptionIncludingWindow` for a single application window
//!   ("App View"). macOS composites windows with rounded corners, so a window
//!   capture is composited at the OS level, not cropped from the desktop.
//! * **Discovery** — `CGGetActiveDisplayList` for monitors, and
//!   `CGWindowListCopyWindowInfo` for the on-screen window list (title, owner,
//!   PID, bounds).
//! * **Input** — `CGEventCreateMouseEvent` / `CGEventCreateKeyboardEvent` /
//!   `CGEventCreateScrollWheelEvent`, posted at the HID tap. Text uses
//!   `CGEventKeyboardSetUnicodeString` so any script types correctly.
//! * **Permissions** — `CGPreflightScreenCaptureAccess` and
//!   `AXIsProcessTrusted` are checked up front; a missing grant is reported as
//!   `PermissionRequired` with the exact System Settings path, never a blank
//!   failure.
//!
//! This module is compiled only on macOS; the Linux build never sees it.

use std::sync::Mutex;

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::CGDisplay;
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGEventType,
    CGMouseButton, ScrollEventUnit,
};
use core_graphics::geometry::CGPoint;

use crate::remote::protocol::{InputEvent, Modifiers, MouseButton, NamedKey};
use crate::remote::types::{
    Capabilities, Codec, DisplayInfo, Frame, HostInfo, PermissionReport, PermissionStatus,
    PlatformKind, RemoteError, RemoteResult, RemoteTarget, SessionKind, WindowInfo,
};

/* ── Permission gates (stable C APIs, declared directly) ──────────────────── */

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> CFArrayRef;
}

const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;

/// CGWindowListOption::OptionIncludingWindow.
const K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW: u32 = 1 << 3;
/// CGRectNull (infinite bounds) — capture exactly the referenced window.
const K_CG_RECT_NULL: (f64, f64, f64, f64) = (f64::INFINITY, f64::INFINITY, 0.0, 0.0);

pub struct MacosBackend {
    /// Which mouse button is currently held, so a move during a drag posts a
    /// drag event rather than a plain move.
    drag: Mutex<Option<MouseButton>>,
}

impl MacosBackend {
    pub fn new() -> Self {
        Self { drag: Mutex::new(None) }
    }

    fn main_display() -> CGDisplay {
        CGDisplay::main()
    }

    fn display_frame(display: &CGDisplay) -> RemoteResult<Frame> {
        let image = display
            .image()
            .ok_or_else(|| RemoteError::PermissionRequired(screen_recording_message()))?;
        let width = image.width() as u32;
        let height = image.height() as u32;
        let bytes_per_row = image.bytes_per_row();
        let data = image.data();
        let raw = unsafe { std::slice::from_raw_parts(data.byte_ptr(), data.len()) };
        let bounds = display.bounds();
        let rgba = bgra_to_rgba(raw, width, height, bytes_per_row)?;
        Ok(Frame::new(width, height, rgba, bounds.origin.x as i32, bounds.origin.y as i32))
    }

    fn capture_window(&self, window_id: u64, bounds: (f64, f64, f64, f64)) -> RemoteResult<Frame> {
        // A window capture composites the window itself, with its own shadow
        // and rounded corners — not a crop of the desktop behind it.
        let rect = core_graphics::geometry::CGRect::new(
            &CGPoint::new(bounds.0, bounds.1),
            &core_graphics::geometry::CGSize::new(bounds.2, bounds.3),
        );
        let image = CGDisplay::screenshot(
            rect,
            core_graphics::display::CGWindowListOption::OptionIncludingWindow,
            window_id as u32,
            core_graphics::display::CGWindowImageOption::BoundsIgnoreFraming,
        )
        .ok_or_else(|| RemoteError::PermissionRequired(screen_recording_message()))?;
        let width = image.width() as u32;
        let height = image.height() as u32;
        let bytes_per_row = image.bytes_per_row();
        let data = image.data();
        let raw = unsafe { std::slice::from_raw_parts(data.byte_ptr(), data.len()) };
        let rgba = bgra_to_rgba(raw, width, height, bytes_per_row)?;
        Ok(Frame::new(width, height, rgba, bounds.0 as i32, bounds.1 as i32))
    }

    fn window_bounds(window_id: u64) -> Option<(f64, f64, f64, f64)> {
        window_list()
            .into_iter()
            .find(|window| window.id == window_id)
            .map(|window| (window.x as f64, window.y as f64, window.width as f64, window.height as f64))
    }

    fn post_mouse(&self, kind: CGEventType, point: CGPoint, button: CGMouseButton) -> RemoteResult<()> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| RemoteError::Input("could not create event source".to_string()))?;
        let event = CGEvent::new_mouse_event(source, kind, point, button)
            .map_err(|_| RemoteError::Input("could not create mouse event".to_string()))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_key(&self, keycode: u16, down: bool, flags: CGEventFlags) -> RemoteResult<()> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| RemoteError::Input("could not create event source".to_string()))?;
        let event = CGEvent::new_keyboard_event(source, keycode, down)
            .map_err(|_| RemoteError::Input("could not create key event".to_string()))?;
        event.set_flags(flags);
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_text(&self, text: &str) -> RemoteResult<()> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| RemoteError::Input("could not create event source".to_string()))?;
        // A zero keycode with a Unicode payload types the exact string,
        // independent of the active keyboard layout.
        let event = CGEvent::new_keyboard_event(source, 0, true)
            .map_err(|_| RemoteError::Input("could not create text event".to_string()))?;
        event.set_string(text);
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_chord(&self, key: &str, modifiers: Modifiers) -> RemoteResult<()> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| RemoteError::Input("could not create event source".to_string()))?;
        let event = CGEvent::new_keyboard_event(source, 0, true)
            .map_err(|_| RemoteError::Input("could not create chord event".to_string()))?;
        event.set_flags(mac_flags(modifiers, false));
        event.set_string(key);
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_scroll(&self, dx: f64, dy: f64) -> RemoteResult<()> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| RemoteError::Input("could not create event source".to_string()))?;
        let vertical = -(dy.round() as i32);
        let horizontal = -(dx.round() as i32);
        let event = CGEvent::new_scroll_event(source, ScrollEventUnit::PIXEL, 2, vertical, horizontal, 0)
            .map_err(|_| RemoteError::Input("could not create scroll event".to_string()))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }
}

impl Default for MacosBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl super::RemoteBackend for MacosBackend {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            platform: PlatformKind::Macos,
            session_kind: SessionKind::Macos,
            full_desktop: true,
            app_view: true,
            multi_display: true,
            input: true,
            clipboard: true,
            cursor: true,
            codecs: vec![Codec::Jpeg],
            // The H.264/VideoToolbox path is advertised by an implementation that
            // actually streams it; until then macOS shares the JPEG pipeline.
            hardware_encode: false,
            max_fps: 30,
            max_dimension: 5120,
        }
    }

    fn host_info(&self) -> HostInfo {
        HostInfo {
            name: hostname::get()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string()),
            platform: PlatformKind::Macos,
            platform_label: "macOS".to_string(),
            session_kind: SessionKind::Macos,
            session_label: "macOS".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    fn permissions(&self) -> PermissionReport {
        let screen = unsafe { CGPreflightScreenCaptureAccess() };
        let accessibility = unsafe { AXIsProcessTrusted() };
        let mut report = PermissionReport {
            screen_recording: if screen {
                PermissionStatus::Granted
            } else {
                PermissionStatus::Denied
            },
            accessibility: if accessibility {
                PermissionStatus::Granted
            } else {
                PermissionStatus::Denied
            },
            input_monitoring: PermissionStatus::NotRequired,
            message: None,
            settings_hint: None,
        };
        if !report.is_usable() {
            report.message = Some(screen_recording_message());
            report.settings_hint =
                Some("System Settings → Privacy & Security → Screen Recording / Accessibility".to_string());
        }
        report
    }

    fn list_displays(&self) -> RemoteResult<Vec<DisplayInfo>> {
        let ids = CGDisplay::active_displays()
            .map_err(|_| RemoteError::Other("could not list displays".to_string()))?;
        let main = Self::main_display().id;
        Ok(ids
            .iter()
            .enumerate()
            .map(|(index, id)| {
                let display = CGDisplay::new(*id);
                let bounds = display.bounds();
                DisplayInfo {
                    id: index as u32,
                    name: format!("Display {}", index + 1),
                    x: bounds.origin.x as i32,
                    y: bounds.origin.y as i32,
                    width: bounds.size.width as u32,
                    height: bounds.size.height as u32,
                    primary: *id == main,
                }
            })
            .collect())
    }

    fn list_windows(&self) -> RemoteResult<Vec<WindowInfo>> {
        Ok(window_list())
    }

    fn capture(&self, target: &RemoteTarget) -> RemoteResult<Frame> {
        match target {
            RemoteTarget::Desktop => Self::display_frame(&Self::main_display()),
            RemoteTarget::Display { id } => {
                let displays = self.list_displays()?;
                let display = displays
                    .iter()
                    .find(|display| display.id == *id)
                    .ok_or_else(|| RemoteError::Capture(format!("display {id} not found")))?;
                let ids = CGDisplay::active_displays()
                    .map_err(|_| RemoteError::Other("could not list displays".to_string()))?;
                let raw_id = ids
                    .get(*id as usize)
                    .ok_or_else(|| RemoteError::Capture(format!("display {id} not found")))?;
                let _ = display;
                Self::display_frame(&CGDisplay::new(*raw_id))
            }
            RemoteTarget::Window { id } => {
                let bounds = Self::window_bounds(*id)
                    .ok_or_else(|| RemoteError::Capture(format!("window {id} is not on screen")))?;
                self.capture_window(*id, bounds)
            }
        }
    }

    fn geometry(&self, target: &RemoteTarget) -> RemoteResult<TargetGeometry> {
        match target {
            RemoteTarget::Desktop => {
                let bounds = Self::main_display().bounds();
                Ok(TargetGeometry {
                    origin_x: bounds.origin.x as i32,
                    origin_y: bounds.origin.y as i32,
                    width: bounds.size.width as u32,
                    height: bounds.size.height as u32,
                })
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
                let bounds = Self::window_bounds(*id)
                    .ok_or_else(|| RemoteError::Capture(format!("window {id} is not on screen")))?;
                Ok(TargetGeometry {
                    origin_x: bounds.0 as i32,
                    origin_y: bounds.1 as i32,
                    width: bounds.2 as u32,
                    height: bounds.3 as u32,
                })
            }
        }
    }

    fn pointer_position(&self) -> RemoteResult<Option<(i32, i32)>> {
        let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
            Ok(source) => source,
            Err(_) => return Ok(None),
        };
        match CGEvent::new(source) {
            Ok(event) => {
                let point = event.location();
                Ok(Some((point.x as i32, point.y as i32)))
            }
            Err(_) => Ok(None),
        }
    }

    fn input(&self, target: &RemoteTarget, event: &InputEvent) -> RemoteResult<()> {
        let geometry = self.geometry(target)?;
        let to_global = |x: f64, y: f64| -> CGPoint {
            CGPoint::new(
                geometry.origin_x as f64 + x.round(),
                geometry.origin_y as f64 + y.round(),
            )
        };
        match event {
            InputEvent::PointerMove { x, y } => {
                let point = to_global(*x, *y);
                let held = *self.drag.lock().unwrap();
                let (kind, button) = match held {
                    Some(MouseButton::Left) => (CGEventType::LeftMouseDragged, CGMouseButton::Left),
                    Some(MouseButton::Right) => (CGEventType::RightMouseDragged, CGMouseButton::Right),
                    Some(MouseButton::Middle) => (CGEventType::OtherMouseDragged, CGMouseButton::Center),
                    None => (CGEventType::MouseMoved, CGMouseButton::Left),
                };
                self.post_mouse(kind, point, button)
            }
            InputEvent::PointerMoveRelative { dx, dy } => {
                let (x, y) = self.pointer_position()?.unwrap_or((0, 0));
                let point = CGPoint::new(x as f64 + dx, y as f64 + dy);
                self.post_mouse(CGEventType::MouseMoved, point, CGMouseButton::Left)
            }
            InputEvent::ButtonDown { button } => {
                *self.drag.lock().unwrap() = Some(*button);
                let point = self.current_point()?;
                let (kind, cg_button) = mouse_pair(*button, true);
                self.post_mouse(kind, point, cg_button)
            }
            InputEvent::ButtonUp { button } => {
                *self.drag.lock().unwrap() = None;
                let point = self.current_point()?;
                let (kind, cg_button) = mouse_pair(*button, false);
                self.post_mouse(kind, point, cg_button)
            }
            InputEvent::Click { button, count } => {
                let point = self.current_point()?;
                for _ in 0..(*count).max(1) {
                    let (down, cg_button) = mouse_pair(*button, true);
                    let (up, _) = mouse_pair(*button, false);
                    self.post_mouse(down, point, cg_button)?;
                    self.post_mouse(up, point, cg_button)?;
                }
                Ok(())
            }
            InputEvent::Scroll { dx, dy } => self.post_scroll(*dx, *dy),
            InputEvent::KeyDown { key, modifiers } => {
                let (keycode, needs_shift) = mac_keycode(*key);
                let flags = mac_flags(*modifiers, needs_shift);
                self.post_key(keycode, true, flags)
            }
            InputEvent::KeyUp { key } => {
                let (keycode, _) = mac_keycode(*key);
                self.post_key(keycode, false, CGEventFlags::CGEventFlagNull)
            }
            InputEvent::Chord { key, modifiers } => {
                // Modifier flags ride the text event, so Ctrl+C / Cmd+V arrive
                // as a real shortcut rather than a bare character.
                self.post_chord(key, *modifiers)
            }
            InputEvent::Text { text } => self.post_text(text),
        }
    }

    fn get_clipboard(&self) -> RemoteResult<Option<String>> {
        let output = std::process::Command::new("pbpaste")
            .output()
            .map_err(|e| RemoteError::Clipboard(format!("pbpaste: {e}")))?;
        if !output.status.success() {
            return Ok(None);
        }
        Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
    }

    fn set_clipboard(&self, text: &str) -> RemoteResult<()> {
        use std::io::Write;
        let mut child = std::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| RemoteError::Clipboard(format!("pbcopy: {e}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| RemoteError::Clipboard(e.to_string()))?;
        }
        Ok(())
    }

    fn open_permission_settings(&self) -> RemoteResult<()> {
        // Ask the OS to show its own prompt, then open the exact pane.
        unsafe {
            let _ = CGRequestScreenCaptureAccess();
        }
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
        Ok(())
    }
}

impl MacosBackend {
    fn current_point(&self) -> RemoteResult<CGPoint> {
        let event = CGEvent::new(
            CGEventSource::new(CGEventSourceStateID::HIDSystemState)
                .map_err(|_| RemoteError::Input("no event source".to_string()))?,
        )
        .map_err(|_| RemoteError::Input("no event".to_string()))?;
        Ok(event.location())
    }
}

fn mouse_pair(button: MouseButton, down: bool) -> (CGEventType, CGMouseButton) {
    match (button, down) {
        (MouseButton::Left, true) => (CGEventType::LeftMouseDown, CGMouseButton::Left),
        (MouseButton::Left, false) => (CGEventType::LeftMouseUp, CGMouseButton::Left),
        (MouseButton::Right, true) => (CGEventType::RightMouseDown, CGMouseButton::Right),
        (MouseButton::Right, false) => (CGEventType::RightMouseUp, CGMouseButton::Right),
        (MouseButton::Middle, true) => (CGEventType::OtherMouseDown, CGMouseButton::Center),
        (MouseButton::Middle, false) => (CGEventType::OtherMouseUp, CGMouseButton::Center),
    }
}

fn mac_flags(modifiers: Modifiers, extra_shift: bool) -> CGEventFlags {
    let mut flags = CGEventFlags::CGEventFlagNull;
    if modifiers.ctrl {
        flags |= CGEventFlags::CGEventFlagControl;
    }
    if modifiers.alt {
        flags |= CGEventFlags::CGEventFlagAlternate;
    }
    if modifiers.shift || extra_shift {
        flags |= CGEventFlags::CGEventFlagShift;
    }
    if modifiers.meta {
        flags |= CGEventFlags::CGEventFlagCommand;
    }
    flags
}

/// Named key → (virtual keycode, needs shift). Values are the ANSI keycodes
/// Apple documents; Command/Option/Control map to the macOS modifiers our
/// `Modifiers::meta/alt/ctrl` already carry.
fn mac_keycode(key: NamedKey) -> (u16, bool) {
    match key {
        NamedKey::Escape => (0x35, false),
        NamedKey::Tab => (0x30, false),
        NamedKey::Enter => (0x24, false),
        NamedKey::Backspace => (0x33, false),
        NamedKey::Delete => (0x75, false),
        NamedKey::Insert => (0x72, false), // Help/Insert
        NamedKey::Home => (0x73, false),
        NamedKey::End => (0x77, false),
        NamedKey::PageUp => (0x74, false),
        NamedKey::PageDown => (0x79, false),
        NamedKey::ArrowUp => (0x7E, false),
        NamedKey::ArrowDown => (0x7D, false),
        NamedKey::ArrowLeft => (0x7B, false),
        NamedKey::ArrowRight => (0x7C, false),
        NamedKey::Space => (0x31, false),
        NamedKey::F1 => (0x7A, false),
        NamedKey::F2 => (0x78, false),
        NamedKey::F3 => (0x63, false),
        NamedKey::F4 => (0x76, false),
        NamedKey::F5 => (0x60, false),
        NamedKey::F6 => (0x61, false),
        NamedKey::F7 => (0x62, false),
        NamedKey::F8 => (0x64, false),
        NamedKey::F9 => (0x65, false),
        NamedKey::F10 => (0x6D, false),
        NamedKey::F11 => (0x67, false),
        NamedKey::F12 => (0x6F, false),
        NamedKey::Super => (0x37, false), // Command
    }
}

/// Convert a BGRA (premultiplied) CGImage buffer to RGBA.
fn bgra_to_rgba(raw: &[u8], width: u32, height: u32, bytes_per_row: usize) -> RemoteResult<Vec<u8>> {
    let mut out = vec![0u8; (width as usize) * (height as usize) * 4];
    for row in 0..height as usize {
        let src_row = &raw[row * bytes_per_row..];
        let dst_row = row * (width as usize) * 4;
        for column in 0..width as usize {
            let src = column * 4;
            if src + 3 >= src_row.len() {
                break;
            }
            let b = src_row[src];
            let g = src_row[src + 1];
            let r = src_row[src + 2];
            let a = src_row[src + 3];
            // Premultiplied → straight alpha, so the encoder sees real colour.
            let (r, g, b) = if a > 0 && a < 255 {
                (
                    ((r as u16 * 255) / a as u16).min(255) as u8,
                    ((g as u16 * 255) / a as u16).min(255) as u8,
                    ((b as u16 * 255) / a as u16).min(255) as u8,
                )
            } else {
                (r, g, b)
            };
            let dst = dst_row + column * 4;
            out[dst] = r;
            out[dst + 1] = g;
            out[dst + 2] = b;
            out[dst + 3] = 255;
        }
    }
    Ok(out)
}

/// Parse the on-screen window list into our `WindowInfo`. Returns an empty list
/// rather than failing when the list is unavailable.
fn window_list() -> Vec<WindowInfo> {
    let option = K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS;
    let raw = unsafe { CGWindowListCopyWindowInfo(option, 0) };
    if raw.is_null() {
        return Vec::new();
    }
    let array: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { TCFType::wrap_under_create_rule(raw) };
    let mut windows = Vec::new();
    for entry in array.iter() {
        let dictionary: &CFDictionary<CFString, CFType> = &entry;
        let number = dictionary
            .find(CFString::from_static_string("kCGWindowNumber"))
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|number| number.to_i64());
        let Some(number) = number else { continue };
        let owner = dictionary
            .find(CFString::from_static_string("kCGWindowOwnerName"))
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "Application".to_string());
        let title = dictionary
            .find(CFString::from_static_string("kCGWindowName"))
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
            .unwrap_or_default();
        let pid = dictionary
            .find(CFString::from_static_string("kCGWindowOwnerPID"))
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|number| number.to_i64())
            .map(|value| value as u32);
        let bounds = dictionary
            .find(CFString::from_static_string("kCGWindowBounds"))
            .and_then(|value| value.downcast::<CFDictionary<CFString, CFNumber>>())
            .and_then(|dict| {
                let get = |key: &str| -> Option<f64> {
                    dict.find(CFString::from_static_string(key))
                        .and_then(|value| value.to_f64())
                };
                Some((get("X")?, get("Y")?, get("Width")?, get("Height")?))
            })
            .unwrap_or((0.0, 0.0, 0.0, 0.0));
        if bounds.2 < 40.0 || bounds.3 < 40.0 {
            continue;
        }
        windows.push(WindowInfo {
            id: number as u64,
            display_id: 0,
            title: if title.is_empty() { owner.clone() } else { title },
            app_name: owner.clone(),
            app_id: Some(owner),
            pid,
            process: pid.map(|pid| format!("pid {pid}")),
            project: None,
            x: bounds.0 as i32,
            y: bounds.1 as i32,
            width: bounds.2 as u32,
            height: bounds.3 as u32,
            minimized: false,
            focused: false,
        });
    }
    windows
}

fn screen_recording_message() -> String {
    "Screen Recording permission is required. Open System Settings → Privacy & Security → \
     Screen Recording and enable AgentDeck, then restart the daemon."
        .to_string()
}
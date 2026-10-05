//! A live remote session: one capture thread, one input thread, two broadcasts.
//!
//! Threads rather than async tasks because every backend call is blocking. The
//! capture thread owns the adaptive loop — it decides the resolution and JPEG
//! quality frame by frame from the measured bitrate, skips identical frames, and
//! stops the moment nobody is watching so a phone that backgrounds the app does
//! not leave an encoder burning CPU. The input thread is separate so a slow
//! capture can never delay a keystroke.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;

use super::encode;
use super::platform::RemoteBackend;
use super::protocol::{InputEvent, StreamOptions};
use super::types::{RemoteError, RemoteTarget};

/// One encoded frame ready to be framed for the wire.
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    pub seq: u64,
    pub width: u32,
    pub height: u32,
    pub target: RemoteTarget,
    pub codec: String,
    pub keyframe: bool,
    pub data: Vec<u8>,
}

/// Out-of-band session events (never per-frame) forwarded alongside the video.
#[derive(Debug, Clone)]
pub enum SessionEvent {
    TargetChanged {
        target: RemoteTarget,
        width: u32,
        height: u32,
    },
    Stats {
        fps: f32,
        kbps: f32,
        width: u32,
        height: u32,
        quality: u8,
        frames_dropped: u64,
    },
    Cursor {
        x: i32,
        y: i32,
        visible: bool,
    },
    Failed {
        code: String,
        message: String,
        fatal: bool,
    },
}

struct Adaptive {
    quality: u8,
    bytes_ema: f64,
    frames: u64,
    dropped: u64,
    last_report: Instant,
    fps_counter: u64,
    last_signature: Option<u64>,
    force_keyframe: bool,
}

/// A running remote session shared by every viewer attached to it.
pub struct RemoteSession {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub started_at: DateTime<Utc>,
    backend: Arc<dyn RemoteBackend>,
    target: Mutex<RemoteTarget>,
    options: Mutex<StreamOptions>,
    frames: broadcast::Sender<EncodedFrame>,
    events: broadcast::Sender<SessionEvent>,
    input_tx: Sender<(RemoteTarget, InputEvent)>,
    stop: Arc<AtomicBool>,
    seq: Arc<AtomicU64>,
    width: AtomicUsize,
    height: AtomicUsize,
    fps: Mutex<f32>,
    kbps: Mutex<f32>,
    capture_thread: Mutex<Option<JoinHandle<()>>>,
    input_thread: Mutex<Option<JoinHandle<()>>>,
}

impl RemoteSession {
    pub fn start(
        id: String,
        device_id: String,
        device_name: String,
        backend: Arc<dyn RemoteBackend>,
        target: RemoteTarget,
        options: StreamOptions,
    ) -> Arc<Self> {
        // Capacity 1: video is live, so a viewer that falls behind should skip
        // to the newest frame rather than replay a stale queue.
        let (frames, _) = broadcast::channel(1);
        let (events, _) = broadcast::channel(64);
        let (input_tx, input_rx) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let seq = Arc::new(AtomicU64::new(0));

        let session = Arc::new(Self {
            id,
            device_id,
            device_name,
            started_at: Utc::now(),
            backend,
            target: Mutex::new(target),
            options: Mutex::new(options),
            frames,
            events,
            input_tx,
            stop: Arc::clone(&stop),
            seq,
            width: AtomicUsize::new(0),
            height: AtomicUsize::new(0),
            fps: Mutex::new(0.0),
            kbps: Mutex::new(0.0),
            capture_thread: Mutex::new(None),
            input_thread: Mutex::new(None),
        });

        let capture = Arc::clone(&session);
        let capture_stop = Arc::clone(&stop);
        let handle = std::thread::Builder::new()
            .name(format!("remote-capture-{}", capture.id))
            .spawn(move || capture.capture_loop(capture_stop))
            .expect("spawn capture thread");
        *session.capture_thread.lock().unwrap() = Some(handle);

        let input_stop = Arc::clone(&stop);
        let input_backend = Arc::clone(&session.backend);
        let input_handle = std::thread::Builder::new()
            .name("remote-input".to_string())
            .spawn(move || input_loop(input_backend, input_rx, input_stop))
            .expect("spawn input thread");
        *session.input_thread.lock().unwrap() = Some(input_handle);

        session
    }

    pub fn subscribe_frames(&self) -> broadcast::Receiver<EncodedFrame> {
        self.frames.subscribe()
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<SessionEvent> {
        self.events.subscribe()
    }

    pub fn viewer_count(&self) -> usize {
        self.frames.receiver_count()
    }

    pub fn target(&self) -> RemoteTarget {
        self.target.lock().map(|target| target.clone()).unwrap_or_default()
    }

    pub fn options(&self) -> StreamOptions {
        self.options.lock().map(|options| options.clone()).unwrap_or_default()
    }

    pub fn set_target(&self, target: RemoteTarget) {
        if let Ok(mut current) = self.target.lock() {
            *current = target;
        }
        // The capture loop reads the target once per tick (≤ ~40ms), so the
        // switch is picked up on the next frame without a wake-up nudge.
    }

    pub fn set_options(&self, options: StreamOptions) {
        if let Ok(mut current) = self.options.lock() {
            *current = options;
        }
    }

    pub fn input(&self, event: InputEvent) {
        let target = self.target();
        let _ = self.input_tx.send((target, event));
    }

    pub fn width(&self) -> u32 {
        self.width.load(Ordering::Relaxed) as u32
    }

    pub fn height(&self) -> u32 {
        self.height.load(Ordering::Relaxed) as u32
    }

    pub fn fps(&self) -> f32 {
        *self.fps.lock().unwrap()
    }

    pub fn kbps(&self) -> f32 {
        *self.kbps.lock().unwrap()
    }

    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
        // Detach rather than join: the capture thread may be inside a blocking
        // backend call (an X11 round-trip, or a Wayland frame read), and joining
        // here would block a tokio worker. The flag is checked every frame, so
        // the threads exit on their own and release capture resources.
        if let Ok(mut handle) = self.capture_thread.lock() {
            let _ = handle.take();
        }
        if let Ok(mut handle) = self.input_thread.lock() {
            let _ = handle.take();
        }
    }

    /* ── Capture loop ───────────────────────────────────────────────────── */

    fn capture_loop(self: Arc<Self>, stop: Arc<AtomicBool>) {
        let mut adaptive = Adaptive {
            quality: self.options().quality,
            bytes_ema: 0.0,
            frames: 0,
            dropped: 0,
            last_report: Instant::now(),
            fps_counter: 0,
            last_signature: None,
            force_keyframe: true,
        };
        let mut active_target: Option<RemoteTarget> = None;
        let mut last_cursor: Option<(i32, i32)> = None;
        let mut last_error: Option<String> = None;

        while !stop.load(Ordering::SeqCst) {
            let target = self.target();
            let options = self.options().clamped();

            // Target change: release the old capture resources and re-arm.
            if active_target.as_ref() != Some(&target) {
                last_error = None;
                if let Some(previous) = active_target.as_ref() {
                    let _ = self.backend.end_target(previous);
                }
                if let Err(error) = self.backend.begin_target(&target) {
                    let fatal = matches!(
                        error,
                        RemoteError::PermissionRequired(_) | RemoteError::Unsupported(_)
                    );
                    tracing::warn!(
                        session_id = %self.id,
                        target = %target.key(),
                        fatal,
                        "[AgentDeck][Remote] could not start capture: {}",
                        error
                    );
                    let _ = self.events.send(SessionEvent::Failed {
                        code: error.code().to_string(),
                        message: error.to_string(),
                        fatal,
                    });
                    if fatal {
                        break;
                    }
                }
                adaptive.last_signature = None;
                adaptive.force_keyframe = true;
                active_target = Some(target.clone());
            }

            let frame = match self.backend.capture(&target) {
                Ok(frame) => frame,
                Err(error) => {
                    let fatal = matches!(
                        error,
                        RemoteError::PermissionRequired(_) | RemoteError::Unsupported(_)
                    );
                    // Log on change only: capture retries every 200ms and would
                    // otherwise flood the log with the same line.
                    let message = error.to_string();
                    if last_error.as_deref() != Some(message.as_str()) {
                        tracing::warn!(
                            session_id = %self.id,
                            target = %target.key(),
                            fatal,
                            "[AgentDeck][Remote] capture failed: {}",
                            message
                        );
                        last_error = Some(message.clone());
                    }
                    let _ = self.events.send(SessionEvent::Failed {
                        code: error.code().to_string(),
                        message: error.to_string(),
                        fatal,
                    });
                    if fatal {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                }
            };

            // Publish geometry once we know it (drives the client viewport).
            self.width.store(frame.width as usize, Ordering::Relaxed);
            self.height.store(frame.height as usize, Ordering::Relaxed);

            // Cursor: cheap to poll and the phone renders it as the remote
            // pointer, so it is tracked every tick when the backend exposes it.
            if let Ok(Some((x, y))) = self.backend.pointer_position()
                && last_cursor != Some((x, y))
            {
                last_cursor = Some((x, y));
                let _ = self.events.send(SessionEvent::Cursor { x, y, visible: true });
            }

            // Skip identical frames: no change, no encode, no bytes.
            let signature = encode::frame_signature(&frame.rgba);
            let unchanged = adaptive.last_signature == Some(signature);
            adaptive.last_signature = Some(signature);
            if unchanged && !adaptive.force_keyframe {
                self.maybe_report(&mut adaptive, 0);
                std::thread::sleep(Duration::from_millis((1000 / options.max_fps.max(1)) as u64));
                continue;
            }

            let (data, out_width, out_height) = match encode::encode_jpeg(
                &frame.rgba,
                frame.width,
                frame.height,
                adaptive.quality,
                options.max_width,
                options.max_height,
            ) {
                Ok(encoded) => encoded,
                Err(error) => {
                    let _ = self.events.send(SessionEvent::Failed {
                        code: error.code().to_string(),
                        message: error.to_string(),
                        fatal: false,
                    });
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                }
            };

            let encoded = EncodedFrame {
                seq: self.seq.fetch_add(1, Ordering::Relaxed) + 1,
                width: out_width,
                height: out_height,
                target: target.clone(),
                codec: "jpeg".to_string(),
                keyframe: adaptive.force_keyframe,
                data,
            };
            adaptive.force_keyframe = false;

            let encoded_len = encoded.data.len();
            // `send` fails only when there are no receivers — i.e. nobody is
            // watching. That is the signal to stop capturing entirely.
            if self.frames.send(encoded).is_err() {
                let _ = self.events.send(SessionEvent::Failed {
                    code: "no_viewers".to_string(),
                    message: "no viewers attached".to_string(),
                    fatal: true,
                });
                break;
            }

            adaptive.frames += 1;
            adaptive.fps_counter += 1;
            self.adapt(&mut adaptive, options.max_fps);
            self.maybe_report(&mut adaptive, encoded_len);

            let frame_ms = (1000 / options.max_fps.max(1)) as u64;
            std::thread::sleep(Duration::from_millis(frame_ms));
        }

        if let Some(target) = active_target {
            let _ = self.backend.end_target(&target);
        }
        // Tell any still-attached viewer why the stream ended.
        let _ = self.events.send(SessionEvent::Failed {
            code: "session_ended".to_string(),
            message: "capture stopped".to_string(),
            fatal: true,
        });
    }

    /// Adaptive bitrate: aim for a bandwidth budget, trading quality for
    /// smoothness. Adjusts at most once per second so it cannot oscillate.
    fn adapt(&self, adaptive: &mut Adaptive, requested_fps: u32) {
        // Hold a simple budget in kilobits per second.
        const BUDGET_KBPS: f64 = 3500.0;
        let estimated = adaptive.bytes_ema / 1024.0 * requested_fps as f64;
        if adaptive.frames % (requested_fps.max(1) as u64) != 0 {
            return;
        }
        if estimated > BUDGET_KBPS * 1.15 && adaptive.quality > 35 {
            adaptive.quality = adaptive.quality.saturating_sub(8).max(35);
            adaptive.force_keyframe = true;
        } else if estimated < BUDGET_KBPS * 0.6 && adaptive.quality < 82 {
            adaptive.quality = (adaptive.quality + 5).min(82);
        }
    }

    fn maybe_report(&self, adaptive: &mut Adaptive, encoded_bytes: usize) {
        // Exponential moving average of the encoded frame size.
        let sample = encoded_bytes as f64;
        adaptive.bytes_ema = if adaptive.bytes_ema == 0.0 {
            sample
        } else {
            adaptive.bytes_ema * 0.8 + sample * 0.2
        };
        if adaptive.last_report.elapsed() < Duration::from_millis(1000) {
            return;
        }
        let seconds = adaptive.last_report.elapsed().as_secs_f64().max(0.001);
        let fps = adaptive.fps_counter as f32 / seconds as f32;
        let kbps = (adaptive.bytes_ema * fps as f64 * 8.0 / 1000.0) as f32;
        adaptive.last_report = Instant::now();
        adaptive.fps_counter = 0;
        if let Ok(mut value) = self.fps.lock() {
            *value = fps;
        }
        if let Ok(mut value) = self.kbps.lock() {
            *value = kbps;
        }
        let _ = self.events.send(SessionEvent::Stats {
            fps,
            kbps,
            width: self.width(),
            height: self.height(),
            quality: adaptive.quality,
            frames_dropped: adaptive.dropped,
        });
    }
}

fn input_loop(
    backend: Arc<dyn RemoteBackend>,
    receiver: Receiver<(RemoteTarget, InputEvent)>,
    stop: Arc<AtomicBool>,
) {
    while !stop.load(Ordering::SeqCst) {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok((target, event)) => {
                if let Err(error) = backend.input(&target, &event) {
                    tracing::debug!("[AgentDeck][Remote] input failed: {}", error);
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Merge two stream options, taking the newer value for every field the client
/// actually set. Used when a viewer changes quality mid-session.
pub fn merge_options(current: &StreamOptions, patch: &StreamOptions) -> StreamOptions {
    StreamOptions {
        max_width: patch.max_width.max(1),
        quality: patch.quality.clamp(20, 95),
        max_fps: patch.max_fps.clamp(1, 60),
        codec: patch.codec.clone().or_else(|| current.codec.clone()),
        binary_frames: patch.binary_frames,
        max_height: patch.max_height,
    }
    .clamped()
}

/// Snapshot helper shared by the REST preview route and the WS `Snapshot`.
///
/// Deliberately does **not** call `begin_target`: on Wayland that would open the
/// compositor's consent dialog for a mere preview. X11 capture needs no arming,
/// so a preview there just works; on Wayland a preview returns "start a live
/// session to grant screen sharing first" until a session has been consented.
pub fn snapshot_jpeg(
    backend: &Arc<dyn RemoteBackend>,
    target: &RemoteTarget,
    quality: u8,
    max_width: u32,
) -> Result<(Vec<u8>, u32, u32), RemoteError> {
    let frame = backend.capture(target)?;
    encode::encode_jpeg(&frame.rgba, frame.width, frame.height, quality, max_width, 0)
}
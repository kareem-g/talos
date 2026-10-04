//! `/ws/remote` — the authenticated remote-view socket.
//!
//! Authentication is the daemon's existing device token, sent as the first
//! frame exactly like `/ws/mobile`. Every subsequent frame re-validates it, so
//! revoking a device kills a live stream instead of leaving it running. There is
//! one socket per session carrying every logical channel; the message type is
//! the channel.

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::time::{timeout, Duration};

use crate::config::AppState;
use crate::remote::protocol::state as remote_state;
use crate::remote::protocol::{
    BinaryFrameHeader, RemoteClientMessage, RemoteServerMessage, StreamOptions,
};
use crate::remote::session::{EncodedFrame, SessionEvent};
use crate::remote::types::RemoteTarget;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn handle_remote_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    // ── Handshake ───────────────────────────────────────────────────────────
    let first = timeout(AUTH_TIMEOUT, receiver.next()).await;
    let auth = match first {
        Ok(Some(Ok(Message::Text(text)))) => {
            serde_json::from_str::<RemoteClientMessage>(text.as_ref()).ok()
        }
        _ => None,
    };
    let RemoteClientMessage::Authenticate { token, session_id } = auth.unwrap_or(
        RemoteClientMessage::Authenticate { token: String::new(), session_id: None },
    ) else {
        let _ = send(
            &mut sender,
            &RemoteServerMessage::Error {
                code: "authentication_required".to_string(),
                message: "Authenticate before opening a remote session".to_string(),
                fatal: true,
            },
        )
        .await;
        return;
    };

    let device = match state.devices.authenticate(&token).await {
        Ok(Some(device)) => device,
        Ok(None) => {
            let _ = send(
                &mut sender,
                &RemoteServerMessage::Error {
                    code: "unauthorized".to_string(),
                    message: "Device access revoked. Pair this device again.".to_string(),
                    fatal: true,
                },
            )
            .await;
            return;
        }
        Err(error) => {
            tracing::error!("[AgentDeck][Remote] auth failed: {}", error);
            let _ = send(
                &mut sender,
                &RemoteServerMessage::Error {
                    code: "auth_unavailable".to_string(),
                    message: "Authentication service unavailable".to_string(),
                    fatal: true,
                },
            )
            .await;
            return;
        }
    };

    let session_id = session_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let capabilities = state.remote.backend().capabilities();
    let host = state.remote.backend().host_info();
    let permissions = state.remote.backend().permissions();
    if !state.remote.enabled() {
        let _ = send(
            &mut sender,
            &RemoteServerMessage::Error {
                code: "remote_disabled".to_string(),
                message: "Remote control is turned off on this computer. Enable it in AgentDeck \
                          on the desktop, then try again."
                    .to_string(),
                fatal: true,
            },
        )
        .await;
        return;
    }
    let _ = send(
        &mut sender,
        &RemoteServerMessage::Ready {
            session_id: session_id.clone(),
            device_id: device.id.clone(),
            device_name: device.name.clone(),
            host,
            capabilities,
            permissions,
            target: RemoteTarget::Desktop,
            options: StreamOptions::default(),
        },
    )
    .await;

    // ── Wait for Start ──────────────────────────────────────────────────────
    let mut options = StreamOptions::default();
    let mut started: Option<Arc<crate::remote::session::RemoteSession>> = None;
    loop {
        match receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                if !reauthenticated(&state, &token).await {
                    break;
                }
                match serde_json::from_str::<RemoteClientMessage>(text.as_ref()) {
                    Ok(RemoteClientMessage::Start { target, options: requested }) => {
                        options = requested.clamped();
                        match state.remote.attach(
                            Some(session_id.clone()),
                            &device.id,
                            &device.name,
                            target.clone(),
                            options.clone(),
                        ) {
                            Ok(session) => {
                                started = Some(session);
                                break;
                            }
                            Err(error) => {
                                let _ = send(
                                    &mut sender,
                                    &RemoteServerMessage::Error {
                                        code: error.code().to_string(),
                                        message: error.to_string(),
                                        fatal: true,
                                    },
                                )
                                .await;
                                return;
                            }
                        }
                    }
                    Ok(RemoteClientMessage::Ping) => {
                        let _ = send(&mut sender, &RemoteServerMessage::Pong).await;
                    }
                    Ok(RemoteClientMessage::Stop) => return,
                    _ => {}
                }
            }
            Some(Ok(Message::Close(_))) | None => return,
            _ => {}
        }
    }
    let Some(session) = started else { return };

    // ── Stream ──────────────────────────────────────────────────────────────
    let mut frames = session.subscribe_frames();
    let mut events = session.subscribe_events();
    let mut binary = options.binary_frames;

    loop {
        tokio::select! {
            frame = frames.recv() => {
                match frame {
                    Ok(frame) => {
                        if send_frame(&mut sender, &frame, binary).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if send_event(&mut sender, &event).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            message = receiver.next() => {
                let Some(Ok(Message::Text(text))) = message else {
                    match message {
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => continue,
                    }
                };
                if !reauthenticated(&state, &token).await {
                    break;
                }
                let parsed = serde_json::from_str::<RemoteClientMessage>(text.as_ref());
                match parsed {
                    Ok(RemoteClientMessage::Input { event }) => session.input(event),
                    Ok(RemoteClientMessage::SwitchTarget { target }) => session.set_target(target),
                    Ok(RemoteClientMessage::SetQuality { options: requested }) => {
                        options = crate::remote::session::merge_options(&options, &requested);
                        binary = options.binary_frames;
                        session.set_options(options.clone());
                    }
                    Ok(RemoteClientMessage::ClipboardGet) => {
                        let backend = Arc::clone(state.remote.backend());
                        if let Ok(Ok(Some(text))) =
                            tokio::task::spawn_blocking(move || backend.get_clipboard()).await
                        {
                            if send(&mut sender, &RemoteServerMessage::Clipboard { text }).await.is_err() {
                                break;
                            }
                        }
                    }
                    Ok(RemoteClientMessage::ClipboardSet { text }) => {
                        let backend = Arc::clone(state.remote.backend());
                        let _ = tokio::task::spawn_blocking(move || backend.set_clipboard(&text)).await;
                    }
                    Ok(RemoteClientMessage::Snapshot { target, quality, max_width }) => {
                        // Capture is blocking; the manager's snapshot path is
                        // safe to run only off the async runtime.
                        let manager = Arc::clone(&state.remote);
                        let capture_target = target.clone();
                        let prepared = tokio::task::spawn_blocking(move || {
                            manager.snapshot_data_uri(&capture_target, quality, max_width)
                        })
                        .await
                        .unwrap_or_else(|_| {
                            Err(crate::remote::types::RemoteError::Other(
                                "snapshot task failed".to_string(),
                            ))
                        });
                        match prepared {
                            Ok(data) => {
                                if send(
                                    &mut sender,
                                    &RemoteServerMessage::Snapshot {
                                        target,
                                        width: session.width(),
                                        height: session.height(),
                                        data,
                                    },
                                )
                                .await
                                .is_err()
                                {
                                    break;
                                }
                            }
                            Err(error) => {
                                if send(
                                    &mut sender,
                                    &RemoteServerMessage::Error {
                                        code: error.code().to_string(),
                                        message: error.to_string(),
                                        fatal: false,
                                    },
                                )
                                .await
                                .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                    Ok(RemoteClientMessage::RequestMetadata) => {
                        // Enumeration is blocking; run it on the blocking pool.
                        let backend = Arc::clone(state.remote.backend());
                        let payload = tokio::task::spawn_blocking(move || {
                            Some((
                                backend.host_info(),
                                backend.list_displays().unwrap_or_default(),
                                backend.list_windows().unwrap_or_default(),
                            ))
                        })
                        .await
                        .unwrap_or(None);
                        let Some((host, displays, windows)) = payload else {
                            continue;
                        };
                        if send(
                            &mut sender,
                            &RemoteServerMessage::Metadata { host, displays, windows },
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Ok(RemoteClientMessage::Ping) => {
                        if send(&mut sender, &RemoteServerMessage::Pong).await.is_err() {
                            break;
                        }
                    }
                    Ok(RemoteClientMessage::Stop) => break,
                    Ok(RemoteClientMessage::Start { target, options: requested }) => {
                        options = requested.clamped();
                        binary = options.binary_frames;
                        session.set_target(target);
                        session.set_options(options.clone());
                    }
                    Ok(RemoteClientMessage::Authenticate { .. }) | Err(_) => {}
                }
            }
        }
    }

    // Detach before reclaiming: dropping our receivers makes `viewer_count`
    // zero, so `reap_if_idle` stops capture instead of leaving it running for
    // an empty room.
    drop(frames);
    drop(events);
    state.remote.reap_if_idle(&session.id);
}

async fn reauthenticated(state: &Arc<AppState>, token: &str) -> bool {
    matches!(state.devices.authenticate(token).await, Ok(Some(_)))
}

async fn send_frame(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    frame: &EncodedFrame,
    binary: bool,
) -> Result<(), ()> {
    if binary {
        let header = BinaryFrameHeader::encode(
            frame.seq,
            frame.width,
            frame.height,
            frame.keyframe,
            frame.data.len() as u32,
        );
        let mut payload = Vec::with_capacity(header.len() + frame.data.len());
        payload.extend_from_slice(&header);
        payload.extend_from_slice(&frame.data);
        sender.send(Message::Binary(payload.into())).await.map_err(|_| ())
    } else {
        use base64::Engine as _;
        let data = base64::engine::general_purpose::STANDARD.encode(&frame.data);
        send(
            sender,
            &RemoteServerMessage::Frame {
                seq: frame.seq,
                width: frame.width,
                height: frame.height,
                target: frame.target.clone(),
                codec: frame.codec.clone(),
                keyframe: frame.keyframe,
                bytes: frame.data.len(),
                data,
            },
        )
        .await
    }
}

async fn send_event(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &SessionEvent,
) -> Result<(), ()> {
    let message = match event {
        SessionEvent::TargetChanged { target, width, height } => RemoteServerMessage::TargetChanged {
            target: target.clone(),
            width: *width,
            height: *height,
        },
        SessionEvent::Stats { fps, kbps, width, height, quality, frames_dropped } => {
            RemoteServerMessage::StreamStats {
                fps: *fps,
                kbps: *kbps,
                width: *width,
                height: *height,
                quality: *quality,
                frames_dropped: *frames_dropped,
            }
        }
        SessionEvent::Cursor { x, y, visible } => RemoteServerMessage::Cursor {
            x: *x,
            y: *y,
            visible: *visible,
        },
        SessionEvent::Failed { code, message, fatal } => {
            if code == "no_viewers" {
                RemoteServerMessage::State {
                    state: remote_state::DISCONNECTED.to_string(),
                    detail: Some("no viewers".to_string()),
                }
            } else if code == "permission_required" {
                RemoteServerMessage::PermissionRequired {
                    permissions: crate::remote::types::PermissionReport {
                        screen_recording: crate::remote::types::PermissionStatus::Denied,
                        accessibility: crate::remote::types::PermissionStatus::Unknown,
                        input_monitoring: crate::remote::types::PermissionStatus::NotRequired,
                        message: Some(message.clone()),
                        settings_hint: None,
                    },
                    message: message.clone(),
                }
            } else {
                RemoteServerMessage::Error {
                    code: code.clone(),
                    message: message.clone(),
                    fatal: *fatal,
                }
            }
        }
    };
    send(sender, &message).await
}

async fn send(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: &RemoteServerMessage,
) -> Result<(), ()> {
    let value = serde_json::to_string(message).map_err(|_| ())?;
    sender.send(Message::Text(value.into())).await.map_err(|_| ())
}
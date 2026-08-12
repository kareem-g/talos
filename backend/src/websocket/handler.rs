use crate::config::AppState;
use crate::websocket::broadcast::BroadcastEvent;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{stream::SplitSink, SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{timeout, Duration};

type SocketSender = SplitSink<WebSocket, Message>;

pub async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    tracing::info!("New desktop WebSocket connection established");

    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.broadcast.subscribe();

    let cfg = state.config.read().await;
    let welcome = crate::websocket::WsMessage::TunnelUpdate {
        status: if cfg.settings().tunnel.tailscale.enabled || cfg.settings().tunnel.cloudflare.enabled {
            "enabled".to_string()
        } else {
            "disabled".to_string()
        },
        details: serde_json::json!({ "version": env!("CARGO_PKG_VERSION") }),
    };
    drop(cfg);
    let _ = send_protocol(&mut sender, &welcome).await;

    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if send_event(&mut sender, &event).await.is_err() {
                break;
            }
        }
    });

    let recv_state = state.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(ws_msg) = serde_json::from_str::<crate::websocket::WsMessage>(text.as_ref()) {
                        handle_message(ws_msg, &recv_state).await;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
    tracing::info!("Desktop WebSocket connection closed");
}

pub async fn handle_mobile_socket(socket: WebSocket, state: Arc<AppState>) {
    tracing::info!("New mobile WebSocket connection awaiting authentication");
    let (mut sender, mut receiver) = socket.split();

    let first_message = timeout(Duration::from_secs(10), receiver.next()).await;
    let auth = match first_message {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<crate::websocket::WsMessage>(text.as_ref()).ok(),
        _ => None,
    };

    let crate::websocket::WsMessage::Authenticate { token, after_event_id } = auth.unwrap_or(
        crate::websocket::WsMessage::Error {
            code: "authentication_required".to_string(),
            message: "Authenticate before using the mobile connection".to_string(),
        },
    ) else {
        let _ = send_protocol(
            &mut sender,
            &crate::websocket::WsMessage::Error {
                code: "authentication_required".to_string(),
                message: "Authenticate before using the mobile connection".to_string(),
            },
        )
        .await;
        return;
    };

    let device = match state.devices.authenticate(&token).await {
        Ok(Some(device)) => device,
        Ok(None) => {
            let _ = send_protocol(
                &mut sender,
                &crate::websocket::WsMessage::Error {
                    code: "device_revoked".to_string(),
                    message: "Device access revoked. Pair this device again.".to_string(),
                },
            )
            .await;
            return;
        }
        Err(error) => {
            tracing::error!("[AgentDeck][Auth] Mobile WebSocket authentication failed: {}", error);
            let _ = send_protocol(
                &mut sender,
                &crate::websocket::WsMessage::Error {
                    code: "auth_unavailable".to_string(),
                    message: "Authentication service unavailable".to_string(),
                },
            )
            .await;
            return;
        }
    };

    let device_id = device.id.clone();
    let _ = send_protocol(
        &mut sender,
        &crate::websocket::WsMessage::Authenticated {
            device_id: device.id,
            last_event_id: state.broadcast.latest_id(),
        },
    )
    .await;

    for event in state.broadcast.replay_after(after_event_id.unwrap_or(0)) {
        if send_event(&mut sender, &event).await.is_err() {
            return;
        }
    }

    let mut rx = state.broadcast.subscribe();
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if send_event(&mut sender, &event).await.is_err() {
                break;
            }
        }
    });

    let recv_state = state.clone();
    let device_token = token.clone();
    let connected_device_id = device_id;
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(ws_msg) = serde_json::from_str::<crate::websocket::WsMessage>(text.as_ref()) {
                        if let Ok(Some(_)) = recv_state.devices.authenticate(&device_token).await {
                            handle_message(ws_msg, &recv_state).await;
                        } else {
                            recv_state.broadcast.broadcast(crate::websocket::WsMessage::DeviceRevoked {
                                device_id: connected_device_id.clone(),
                            });
                            break;
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
    tracing::info!("Mobile WebSocket connection closed");
}

async fn send_protocol(sender: &mut SocketSender, message: &crate::websocket::WsMessage) -> Result<(), ()> {
    let value = serde_json::to_string(message).map_err(|_| ())?;
    sender.send(Message::Text(value.into())).await.map_err(|_| ())
}

async fn send_event(sender: &mut SocketSender, event: &BroadcastEvent) -> Result<(), ()> {
    let mut value = serde_json::to_value(&event.message).map_err(|_| ())?;
    if let Value::Object(ref mut object) = value {
        object.insert("event_id".to_string(), Value::from(event.id));
        object.insert("timestamp".to_string(), Value::from(event.timestamp.to_rfc3339()));
    }
    let text = serde_json::to_string(&value).map_err(|_| ())?;
    sender.send(Message::Text(text.into())).await.map_err(|_| ())
}

async fn handle_message(msg: crate::websocket::WsMessage, state: &Arc<AppState>) {
    match msg {
        crate::websocket::WsMessage::Input { session_id, data } => {
            handle_input(state, &session_id, &data).await;
        }
        crate::websocket::WsMessage::TerminalInput { session_id, data } => {
            if let Err(error) = state.pty_manager.send_input(&session_id, &data).await {
                state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
                    session_id,
                    code: "pty_error".to_string(),
                    message: format!("Failed to write to terminal: {}", error),
                });
            }
        }
        crate::websocket::WsMessage::Command { action, params } => {
            handle_command(state, &action, params).await;
        }
        crate::websocket::WsMessage::QuestionAnswer { answer } => {
            handle_question_answer(state, answer).await;
        }
        crate::websocket::WsMessage::Ping => {}
        crate::websocket::WsMessage::Subscribe { .. }
        | crate::websocket::WsMessage::Unsubscribe { .. }
        | crate::websocket::WsMessage::Authenticate { .. } => {}
        _ => tracing::debug!("[AgentDeck][WS] Ignoring server-only message from client"),
    }
}

async fn handle_input(state: &Arc<AppState>, session_id: &str, data: &str) {
    let clean_data = data.trim_end_matches(['\r', '\n']).to_string();
    if clean_data.trim().is_empty() {
        return;
    }

    match state.session_manager.get_session(session_id).await {
        Ok(Some(_)) => {}
        _ => {
            state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
                session_id: session_id.to_string(),
                code: "task_unavailable".to_string(),
                message: "Task is no longer available".to_string(),
            });
            return;
        }
    }

    state.broadcast.broadcast(crate::websocket::WsMessage::Message {
        message: crate::agent_events::AgentMessage {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            role: "user".to_string(),
            content: clean_data,
            timestamp: chrono::Utc::now(),
        },
    });

    // The chat runtime must enter its generation state as soon as the user
    // submits, not only after a provider hook happens to fire (simple Claude
    // replies often have no tool hook at all). It also arms Claude PTY text
    // normalization for this specific turn.
    state.pty_manager.begin_assistant_turn(session_id);
    state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
        session_id: session_id.to_string(),
        state: "running".to_string(),
    });

    // Type the text first, then press Enter as a separate keystroke so the
    // TUI treats it as a submit rather than part of the pasted draft.
    let pty_data = data.trim_end_matches(['\r', '\n']).to_string();
    if let Err(error) = state.pty_manager.send_input(session_id, &pty_data).await {
        tracing::error!("[AgentDeck][PTY] Failed to write input: {}", error);
        state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
            session_id: session_id.to_string(),
            code: "pty_error".to_string(),
            message: format!("Failed to send input to agent: {}", error),
        });
        return;
    }
    let state = state.clone();
    let session_id = session_id.to_string();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        if let Err(error) = state.pty_manager.send_input(&session_id, "\r").await {
            tracing::error!("[AgentDeck][PTY] Failed to submit input: {}", error);
        }
    });
}

async fn handle_command(state: &Arc<AppState>, action: &str, params: Value) {
    match action {
        "stop" | "kill" => {
            if let Some(session_id) = params.get("session_id").and_then(Value::as_str) {
                let _ = state.pty_manager.kill_session(session_id).await;
                let _ = state.session_manager.update_status(
                    session_id,
                    crate::sessions::SessionStatus::Exited,
                ).await;
            }
        }
        "approval_response" => {
            let request_id = params.get("request_id").and_then(Value::as_str).unwrap_or("");
            let decision = params.get("decision").and_then(Value::as_str).unwrap_or("deny");
            let session_id = params.get("session_id").and_then(Value::as_str).unwrap_or("");
            let mut response = state.pty_manager.respond_to_approval(request_id, decision).await;
            if response.is_err() {
                if let Ok(Some(stored)) = state.session_manager.get_approval(request_id).await {
                    state.pty_manager.register_approval(crate::pty::manager::PendingApproval {
                        id: stored.id,
                        session_id: stored.session_id,
                        prompt: stored.prompt,
                    });
                    response = state.pty_manager.respond_to_approval(request_id, decision).await;
                }
            }
            if response.is_err() && !session_id.is_empty() {
                // Parser-detected approval (codex/opencode): it was never
                // registered on the backend, so resolve it by typing the
                // decision into the running CLI directly.
                let typed = match decision {
                    "allow" | "yes" | "Accept" | "accept" => "y",
                    "always" => "always",
                    "deny" | "no" => "n",
                    _ => "",
                };
                if !typed.is_empty() {
                    let answer = format!("{typed}\r");
                    if state.pty_manager.send_input(session_id, &answer).await.is_ok() {
                        response = Ok(session_id.to_string());
                    }
                }
            }
            match response {
                Ok(session_id) => {
                    let _ = state.session_manager.resolve_approval(request_id, decision).await;
                    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
                        &session_id,
                        "permission_resolved",
                        serde_json::json!({ "request_id": request_id, "decision": decision }),
                    ));
                }
                Err(error) => {
                    let session_id = params.get("session_id").and_then(Value::as_str).unwrap_or("");
                    if session_id.is_empty() {
                        state.broadcast.broadcast(crate::websocket::WsMessage::Error {
                            code: "approval_error".to_string(),
                            message: error.to_string(),
                        });
                    } else {
                        state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
                            session_id: session_id.to_string(),
                            code: "approval_error".to_string(),
                            message: error.to_string(),
                        });
                    }
                }
            }
        }
        "follow_up" => {
            if let (Some(session_id), Some(data)) = (
                params.get("session_id").and_then(Value::as_str),
                params.get("data").and_then(Value::as_str),
            ) {
                handle_input(state, session_id, data).await;
            }
        }
        "model_switch" => {
            state.broadcast.broadcast(crate::websocket::WsMessage::Error {
                code: "model_switch_unsupported".to_string(),
                message: "This agent does not support switching during a task".to_string(),
            });
        }
        _ => tracing::debug!("[AgentDeck][WS] Unknown command: {}", action),
    }
}

async fn handle_question_answer(
    state: &Arc<AppState>,
    answer: crate::questions::QuestionAnswer,
) {
    let question = match state.session_manager.get_pending_question(&answer.question_id).await {
        Ok(Some(question)) => question,
        Ok(None) => {
            if let Some(session_id) = answer.session_id.clone() {
                state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
                    session_id,
                    code: "question_unavailable".to_string(),
                    message: "Question is no longer waiting for an answer".to_string(),
                });
            } else {
                state.broadcast.broadcast(crate::websocket::WsMessage::Error {
                    code: "question_unavailable".to_string(),
                    message: "Question is no longer waiting for an answer".to_string(),
                });
            }
            return;
        }
        Err(error) => {
            state.broadcast.broadcast(crate::websocket::WsMessage::Error {
                code: "question_error".to_string(),
                message: error.to_string(),
            });
            return;
        }
    };

    if answer.session_id.as_deref().is_some_and(|session_id| session_id != question.session_id) {
        state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
            session_id: question.session_id,
            code: "invalid_question_answer".to_string(),
            message: "Question does not belong to this session".to_string(),
        });
        return;
    }

    if let Err(message) = validate_question_answer(&question, &answer) {
        state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
            session_id: question.session_id,
            code: "invalid_question_answer".to_string(),
            message,
        });
        return;
    }

    if let Err(error) = state.session_manager.answer_question(&answer).await {
        state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
            session_id: question.session_id,
            code: "question_error".to_string(),
            message: error.to_string(),
        });
        return;
    }

    if let Err(error) = state.pty_manager.answer_question(&question, &answer).await {
        let _ = state.session_manager.reopen_question(&answer.question_id).await;
        state.broadcast.broadcast(crate::websocket::WsMessage::SessionError {
            session_id: question.session_id.clone(),
            code: "question_delivery_failed".to_string(),
            message: error.to_string(),
        });
        return;
    }

    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
        &question.session_id,
        "question_answered",
        serde_json::json!({
            "question_id": answer.question_id,
            "session_id": answer.session_id,
            "selected_options": answer.selected_options,
            "custom_text": answer.custom_text,
        }),
    ));
    state.broadcast.broadcast(crate::websocket::WsMessage::StateChange {
        session_id: question.session_id,
        state: "running".to_string(),
    });
}

fn validate_question_answer(
    question: &crate::questions::Question,
    answer: &crate::questions::QuestionAnswer,
) -> Result<(), String> {
    if answer.selected_options.is_empty() {
        return Err("Select at least one option".to_string());
    }
    if question.selection_mode == "single" && answer.selected_options.len() != 1 {
        return Err("This question accepts one option".to_string());
    }
    if answer
        .selected_options
        .iter()
        .any(|selected| !question.options.iter().any(|option| &option.id == selected))
    {
        return Err("One or more selected options are invalid".to_string());
    }
    let custom_selected = answer.selected_options.iter().any(|selected| {
        question.options.iter().any(|option| &option.id == selected && option.allows_custom_text)
    });
    if custom_selected && answer.custom_text.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Enter a custom answer".to_string());
    }
    if !custom_selected && answer.custom_text.as_deref().is_some_and(|text| !text.trim().is_empty()) {
        return Err("Custom text requires the custom option".to_string());
    }
    Ok(())
}

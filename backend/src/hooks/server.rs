use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::{
    agent_events::{AgentEvent, AgentMessage},
    config::AppState,
    pty::manager::PendingApproval,
    questions::{Question, QuestionOption},
};

#[derive(Debug, Deserialize)]
pub struct HookQuery {
    pub session_id: String,
    pub token: String,
}

/// Permission decision callback from the per-session MCP permission server.
///
/// The MCP half (see `permissions::run_mcp_server`) posts here while Claude is
/// blocked on its tool call; this handler broadcasts the approval card and
/// holds the connection open until the user answers over the WebSocket.
pub async fn handle_permission_request(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HookQuery>,
    Json(body): Json<Value>,
) -> Response {
    let authorized = state
        .hook_tokens
        .read()
        .await
        .get(&query.session_id)
        .map(|token| token == &query.token)
        .unwrap_or(false);
    tracing::info!(session_id=%query.session_id, authorized, "[AgentDeck][Permissions] callback");
    if !authorized {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid hook token" })))
            .into_response();
    }

    let tool_name = body
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("unknown_tool")
        .to_string();
    let input = body.get("input").cloned().unwrap_or(json!({}));

    // AskUserQuestion is gated through the same broker as permissions: Claude's
    // `--permission-prompt-tool` calls this callback and blocks until we answer.
    // The agent's real question options live in `input.questions`, which we
    // extract below so the card shows them; the user's pick is returned as the
    // question's answer (see `request_user_decision`). Do NOT short-circuit with
    // `allow` here — that bypasses the card entirely and Claude reports "the
    // user did not answer", which is exactly the broken behavior we are fixing.

    // When the agent asks a structured question (AskUserQuestion), the real
    // answer choices live inside `input.questions[0].options` — extract them so
    // the card shows the actual choices instead of a generic allow/deny.
    let is_plan = is_plan_approval(&tool_name, &input);
    let (options, selection_mode, allows_custom_text) =
        if tool_name.eq_ignore_ascii_case("AskUserQuestion") {
            extract_question_options(&input)
        } else if is_plan {
            // Plan-mode exit (ExitPlanMode / plan proposal) waits for the user's
            // go-ahead. Surface the proposed steps as a `plan` event so the HUD's
            // Progress section shows them while blocked on approval, and offer the
            // plan-specific choices: approve / decline / suggest changes.
            emit_plan_proposal(&state, &query.session_id, &tool_name, &input).await;
            let mut plan_options = vec![
                QuestionOption {
                    id: "approve".to_string(),
                    label: "Approve".to_string(),
                    description: Some("Accept the plan and let the agent execute it".to_string()),
                    allows_custom_text: false,
                },
                QuestionOption {
                    id: "decline".to_string(),
                    label: "Decline".to_string(),
                    description: Some("Reject the plan and stop the agent".to_string()),
                    allows_custom_text: false,
                },
                QuestionOption {
                    id: "suggest changes".to_string(),
                    label: "Suggest changes".to_string(),
                    description: Some("Send feedback for the agent to revise".to_string()),
                    allows_custom_text: true,
                },
            ];
            // If the agent supplied its own options (e.g. a rich AskUserQuestion
            // inside ExitPlanMode), prefer them.
            if let (opts, mode, custom) = extract_question_options(&input) {
                if !opts.is_empty() {
                    plan_options = opts;
                    (plan_options, mode, custom)
                } else {
                    (plan_options, "single".to_string(), true)
                }
            } else {
                (plan_options, "single".to_string(), true)
            }
        } else {
            (Vec::new(), "single".to_string(), false)
        };

    let is_plan = is_plan_approval(&tool_name, &input);
    let outcome = crate::permissions::request_user_decision(
        &state,
        crate::permissions::PermissionQuery {
            session_id: query.session_id.clone(),
            tool_name,
            input,
            options,
            allows_custom_text,
            selection_mode,
            is_plan,
        },
    )
    .await;

    tracing::debug!(
        session_id = %query.session_id,
        allowed = %outcome.allowed,
        waited_ms = %outcome.waited_ms,
        "[AgentDeck][Permissions] decision delivered"
    );

    Json(if outcome.allowed {
        json!({ "behavior": "allow", "updatedInput": outcome.input })
    } else {
        json!({ "behavior": "deny", "message": outcome.reason })
    })
    .into_response()
}

pub async fn handle_claude_hook(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HookQuery>,
    Json(body): Json<Value>,
) -> Response {
    let authorized = state
        .hook_tokens
        .read()
        .await
        .get(&query.session_id)
        .map(|token| token == &query.token)
        .unwrap_or(false);
    if !authorized {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid hook token" })))
            .into_response();
    }

    let event_name = body
        .get("hook_event_name")
        .or_else(|| body.get("event"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown");
    let session_id = body
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| query.session_id.clone());

    match event_name {
        "SessionStart" => {
            state.pty_manager.mark_waiting_for_input(&session_id);
            emit(&state, &session_id, "agent_ready", json!({ "provider": "claude" }));
            state.broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.clone(),
                state: "waiting_for_input".to_string(),
            });
            // Begin tailing the Claude transcript so assistant text streams
            // into the UI turn-by-turn instead of arriving only at Stop.
            let state_clone = Arc::clone(&state);
            let session_id_clone = session_id.clone();
            tokio::spawn(async move {
                crate::transcript::spawn_transcript_tail(
                    state_clone,
                    session_id_clone,
                    tokio_util::sync::CancellationToken::new(),
                );
            });
        }
        "PreToolUse" => {
            state.broadcast.broadcast(WsMessage::StateChange {
                session_id: session_id.clone(),
                state: "running".to_string(),
            });
            if string_field(&body, "tool_name")
                .map(|tool| tool.eq_ignore_ascii_case("AskUserQuestion"))
                .unwrap_or(false)
            {
                handle_questions(&state, &session_id, &body).await;
            } else {
                handle_tool_started(&state, &session_id, &body).await;
            }
        }
        "PostToolUse" => handle_tool_finished(&state, &session_id, &body, true).await,
        "PostToolUseFailure" => handle_tool_finished(&state, &session_id, &body, false).await,
        "PermissionRequest" => handle_permission(&state, &session_id, &body).await,
        "Stop" => handle_stop(&state, &session_id, &body).await,
        "Notification" => {
            emit(
                &state,
                &session_id,
                "agent_waiting",
                json!({
                    "message": body.get("message").cloned().unwrap_or(Value::Null),
                    "notification_type": body.get("notification_type").cloned().unwrap_or(Value::Null),
                }),
            );
            state.pty_manager.mark_waiting_for_input(&session_id);
        }
        _ => emit(&state, &session_id, "hook_received", body),
    }

    Json(json!({})).into_response()
}

async fn handle_tool_started(state: &AppState, session_id: &str, body: &Value) {
    let tool_id = string_field(body, "tool_use_id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let tool_name = string_field(body, "tool_name").unwrap_or_else(|| "Tool".to_string());
    state
        .hook_starts
        .write()
        .await
        .insert(tool_id.clone(), Utc::now());

    emit(
        state,
        session_id,
        "tool_started",
        json!({
            "tool_id": tool_id.clone(),
            "tool_name": tool_name,
            "input": body.get("tool_input").cloned().unwrap_or(Value::Null),
        }),
    );

    let lower = tool_name.to_lowercase();
    if lower == "bash" || lower == "shell" {
        emit(
            state,
            session_id,
            "command_started",
            json!({ "command": body.get("tool_input").and_then(|input| input.get("command")).cloned().unwrap_or(Value::Null), "tool_id": tool_id.clone() }),
        );
    } else if lower == "grep" || lower == "glob" || lower.contains("search") {
        emit(
            state,
            session_id,
            "search_started",
            json!({ "query": body.get("tool_input").and_then(|input| input.get("pattern").or_else(|| input.get("query"))).cloned().unwrap_or(Value::Null), "tool_id": tool_id.clone() }),
        );
    } else if lower == "read" {
        emit(
            state,
            session_id,
            "file_read",
            json!({ "path": body.get("tool_input").and_then(|input| input.get("file_path").or_else(|| input.get("path"))).cloned().unwrap_or(Value::Null), "tool_id": tool_id.clone() }),
        );
    }
}

async fn handle_questions(state: &AppState, session_id: &str, body: &Value) {
    let _ = state.session_manager.cancel_pending_approvals(session_id).await;
    let Some(raw_questions) = body
        .get("tool_input")
        .and_then(|input| input.get("questions"))
        .and_then(Value::as_array)
    else {
        emit(state, session_id, "agent_error", json!({ "message": "Question tool returned no questions" }));
        return;
    };

    let tool_id = string_field(body, "tool_use_id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    for (index, raw) in raw_questions.iter().enumerate() {
        let title = raw
            .get("header")
            .and_then(Value::as_str)
            .unwrap_or("Question")
            .to_string();
        let question_text = raw
            .get("question")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let options = raw
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .enumerate()
                    .filter_map(|(option_index, option)| {
                        let label = option.get("label").and_then(Value::as_str)?.to_string();
                        let id = option
                            .get("id")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            .unwrap_or_else(|| option_id(&label, option_index));
                        Some(QuestionOption {
                            id,
                            allows_custom_text: label.to_lowercase().contains("type something")
                                || label.to_lowercase().contains("custom"),
                            label,
                            description: option
                                .get("description")
                                .and_then(Value::as_str)
                                .map(str::to_string),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let question = Question {
            question_id: format!("{}-{}", tool_id, index),
            session_id: session_id.to_string(),
            title,
            question: question_text,
            options,
            selection_mode: if raw.get("multiSelect").and_then(Value::as_bool).unwrap_or(false) {
                "multiple".to_string()
            } else {
                "single".to_string()
            },
            status: "pending".to_string(),
            created_at: Utc::now(),
            answered_at: None,
            selected_options: vec![],
            custom_text: None,
        };
        if let Err(error) = state.session_manager.create_question(&question).await {
            tracing::error!("[AgentDeck][Question] Failed to persist question: {}", error);
        }
        emit(
            state,
            session_id,
            "question_started",
            serde_json::to_value(&question).unwrap_or_default(),
        );
    }
    state.broadcast.broadcast(WsMessage::StateChange {
        session_id: session_id.to_string(),
        state: "waiting_for_input".to_string(),
    });
}

fn option_id(label: &str, index: usize) -> String {
    let slug = label
        .to_lowercase()
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if slug.is_empty() {
        format!("option-{}", index + 1)
    } else {
        slug
    }
}

async fn handle_tool_finished(state: &AppState, session_id: &str, body: &Value, success: bool) {
    let tool_id = string_field(body, "tool_use_id").unwrap_or_default();
    let tool_name = string_field(body, "tool_name").unwrap_or_else(|| "Tool".to_string());
    let duration_ms = state
        .hook_starts
        .write()
        .await
        .remove(&tool_id)
        .map(|started| Utc::now().signed_duration_since(started).num_milliseconds().max(0) as u64);

    emit_with_duration(
        state,
        session_id,
        "tool_finished",
        json!({
            "tool_id": tool_id.clone(),
            "tool_name": tool_name,
            "success": success,
            "output": body.get("tool_response").cloned().unwrap_or(Value::Null),
        }),
        duration_ms,
    );

    let lower = tool_name.to_lowercase();
    if lower == "bash" || lower == "shell" {
        emit_with_duration(
            state,
            session_id,
            "command_finished",
            json!({ "command": body.get("tool_input").and_then(|input| input.get("command")).cloned().unwrap_or(Value::Null), "exit_code": if success { 0 } else { 1 }, "tool_id": tool_id.clone() }),
            duration_ms,
        );
    } else if lower == "grep" || lower == "glob" || lower.contains("search") {
        emit_with_duration(
            state,
            session_id,
            "search_finished",
            json!({ "query": body.get("tool_input").and_then(|input| input.get("pattern").or_else(|| input.get("query"))).cloned().unwrap_or(Value::Null), "result_count": body.get("tool_response").and_then(|response| response.get("result_count")).cloned().unwrap_or(Value::Null), "tool_id": tool_id.clone() }),
            duration_ms,
        );
    }

    if is_file_tool(&tool_name) {
        if let Some(path) = body
            .get("tool_input")
            .and_then(|input| input.get("file_path").or_else(|| input.get("path")))
            .and_then(Value::as_str)
        {
            emit(
                state,
                session_id,
                "file_edited",
                json!({ "path": path, "success": success }),
            );
        }
    }
}

async fn handle_permission(state: &AppState, session_id: &str, body: &Value) {
    if string_field(body, "tool_name")
        .map(|tool| tool.eq_ignore_ascii_case("AskUserQuestion"))
        .unwrap_or(false)
    {
        return;
    }
    let id = string_field(body, "tool_use_id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let prompt = string_field(body, "message")
        .or_else(|| string_field(body, "reason"))
        .unwrap_or_else(|| "Claude requested permission".to_string());
    state.pty_manager.register_approval(PendingApproval {
        id: id.clone(),
        session_id: session_id.to_string(),
        prompt: prompt.clone(),
    });
    let options = vec!["allow".to_string(), "always".to_string(), "deny".to_string()];
    if let Err(error) = state
        .session_manager
        .create_approval(&id, session_id, &prompt, &options, "medium")
        .await
    {
        tracing::error!("[AgentDeck][Approval] Failed to persist request: {}", error);
    }
    state.broadcast.broadcast(WsMessage::StateChange {
        session_id: session_id.to_string(),
        state: "waiting_for_approval".to_string(),
    });
    emit(
        state,
        session_id,
        "permission_required",
        json!({
            "id": id,
            "prompt": prompt,
            "command": body.get("tool_input").cloned().unwrap_or(Value::Null),
            "cwd": body.get("cwd").cloned().unwrap_or(Value::Null),
            "options": options,
        }),
    );
}

async fn handle_stop(state: &AppState, session_id: &str, body: &Value) {
    state.pty_manager.end_assistant_turn(session_id);
    // The transcript tailer streams assistant text turn-by-turn. Flush the
    // final turn (polling briefly for the write to land) and, if the
    // transcript delivered anything, skip the duplicate assembled
    // `last_assistant_message` broadcast so the UI does not render the same
    // text twice.
    let transcript_text = crate::transcript::tail_final(state, session_id).await;
    if transcript_text.is_some() {
        tracing::debug!("[AgentDeck][Hook] Transcript streamed assistant text for {session_id}; suppressing Stop message");
        // Fall through to completion handling below without broadcasting.
    } else if let Some(text) = body.get("last_assistant_message").and_then(Value::as_str) {
        // No transcript text (non-Claude agent, or transcript unavailable):
        // fall back to the assembled final message.
        state.broadcast.broadcast(WsMessage::Message {
            message: AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: session_id.to_string(),
                role: "assistant".to_string(),
                content: text.to_string(),
                timestamp: Utc::now(),
            },
        });
    }

    let duration_ms = state
        .session_manager
        .get_session(session_id)
        .await
        .ok()
        .flatten()
        .map(|session| Utc::now().signed_duration_since(session.created_at).num_milliseconds().max(0) as u64);
    emit_with_duration(
        state,
        session_id,
        "agent_completed",
        json!({ "source": "claude_stop" }),
        duration_ms,
    );
    if let Ok(question_ids) = state.session_manager.cancel_questions(session_id).await {
        for question_id in question_ids {
            emit(
                state,
                session_id,
                "question_cancelled",
                json!({ "question_id": question_id, "reason": "agent_stopped" }),
            );
        }
    }
    state.broadcast.broadcast(WsMessage::StateChange {
        session_id: session_id.to_string(),
        state: "waiting_for_input".to_string(),
    });
    state.pty_manager.mark_waiting_for_input(session_id);
}

fn emit(state: &AppState, session_id: &str, kind: &str, payload: Value) {
    emit_with_duration(state, session_id, kind, payload, None);
}

fn emit_with_duration(
    state: &AppState,
    session_id: &str,
    kind: &str,
    payload: Value,
    duration_ms: Option<u64>,
) {
    let mut event = AgentEvent::new(session_id, kind, payload);
    event.duration_ms = duration_ms;
    state.broadcast.broadcast_agent_event(event);
}

fn string_field(body: &Value, field: &str) -> Option<String> {
    body.get(field).and_then(Value::as_str).map(str::to_string)
}

fn is_file_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.to_lowercase().as_str(),
        "edit" | "write" | "multiedit" | "notebookedit"
    )
}

use crate::websocket::WsMessage;

/// Whether a permission request is a plan-mode approval (Claude Code
/// `ExitPlanMode` / plan proposals that ask the user to approve before
/// executing). The plan text usually rides in `input.plan`.
fn is_plan_approval(tool_name: &str, input: &Value) -> bool {
    if tool_name.eq_ignore_ascii_case("ExitPlanMode") || tool_name.eq_ignore_ascii_case("exit_plan_mode") {
        return true;
    }
    // Some agents surface the plan proposal as a generic permission whose input
    // carries a `plan` text field.
    let has_plan_text = input
        .get("plan")
        .and_then(Value::as_str)
        .map(|plan| !plan.trim().is_empty())
        .unwrap_or(false);
    has_plan_text && (tool_name.to_lowercase().contains("plan") || input.get("suggest_changes").is_some())
}

/// Parse a plan proposal out of a permission input and broadcast it as a
/// `plan` AgentEvent so the HUD's Progress section shows the proposed steps
/// while the session waits for approval.
async fn emit_plan_proposal(state: &AppState, session_id: &str, tool_name: &str, input: &Value) {
    let plan_text = input
        .get("plan")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if plan_text.is_empty() {
        return;
    }
    let title = if tool_name.eq_ignore_ascii_case("ExitPlanMode") {
        "Proposed plan"
    } else {
        "Plan"
    };
    if let Some(payload) = crate::agents::plan::plan_from_markdown(&plan_text, title) {
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            session_id,
            "plan",
            payload,
        ));
    }
}

/// Extract structured answer options from an AskUserQuestion tool input.
///
/// The envelope is `input.questions[0].{question,header,multiSelect,options[]}`.
/// Returns the parsed `QuestionOption`s, the selection mode ("single"|"multi"),
/// and whether any option invites free-text input.
fn extract_question_options(input: &Value) -> (Vec<QuestionOption>, String, bool) {
    let question = input
        .get("questions")
        .and_then(Value::as_array)
        .and_then(|q| q.first())
        .and_then(|q| q.as_object());
    let Some(question) = question else {
        return (Vec::new(), "single".to_string(), false)
    };
    let multi_select = question.get("multiSelect").and_then(Value::as_bool).unwrap_or(false);
    let raw_options = question.get("options").and_then(Value::as_array);
    let Some(raw_options) = raw_options else {
        return (Vec::new(), if multi_select { "multi".to_string() } else { "single".to_string() }, false)
    };
    let mut allows_custom = false;
    let options: Vec<QuestionOption> = raw_options
        .iter()
        .filter_map(|raw| {
            let obj = raw.as_object()?;
            let label = obj.get("label").and_then(Value::as_str)?.to_string();
            let id = obj
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| label.clone());
            let description = obj.get("description").and_then(Value::as_str).map(str::to_string);
            let custom = obj.get("allows_custom_text").and_then(Value::as_bool).unwrap_or(false);
            if custom {
                allows_custom = true;
            }
            Some(QuestionOption {
                id,
                label,
                description,
                allows_custom_text: custom,
            })
        })
        .collect();
    (
        options,
        if multi_select { "multi".to_string() } else { "single".to_string() },
        allows_custom,
    )
}

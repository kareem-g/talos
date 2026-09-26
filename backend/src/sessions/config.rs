//! Session configuration: reading and changing a live session's model, mode,
//! effort, or any other dimension its provider exposes.
//!
//! This is the layer the frontend's model picker talks to, and it exists to make
//! one promise keepable: **the UI never shows a change that did not happen.**
//! Every operation resolves to a [`ConfigApplied`] — `Immediate`, `NextRun`, or
//! `Unsupported` with a reason — so a picker can render the truth instead of
//! optimistically relabeling itself.
//!
//! What each transport can actually do differs, and that difference is reported
//! rather than smoothed over:
//!
//! | Transport | Mechanism | Live switch |
//! |---|---|---|
//! | ACP | `session/set_config_option` | yes, verified against a running agent |
//! | stream-json / jsonl | `--model` at spawn | no — recorded for the next run |
//! | PTY | none | no — reported unsupported |
//!
//! Notably absent: typing `/model x` into a running CLI. That was the old
//! mechanism, and it is not a mechanism — it is a guess that the agent has such
//! a command, that it is not busy, and that the text will not land in a prompt.

use crate::config::AppState;
use crate::providers::{ConfigApplied, ConfigMutability, ConfigOption, Transport};
use serde_json::json;

/// A session's config dimensions plus where they came from.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub session_id: String,
    pub agent: String,
    pub transport: Transport,
    pub options: Vec<ConfigOption>,
    /// True when these came from a live agent rather than from a provider
    /// descriptor. Lets the UI distinguish "this is what the agent is doing" from
    /// "this is what it could do".
    pub live: bool,
    /// Whether this session has a pseudo-terminal accepting keystrokes.
    ///
    /// A *session* property, not a provider one: the same CLI can run under a PTY
    /// or over ACP depending on how it was spawned, and only the session knows
    /// which. Clients use this to decide whether the terminal accepts input —
    /// they should still offer a terminal view either way, since output is
    /// recorded for every session.
    pub interactive_terminal: bool,
}

/// Read a session's current configuration.
///
/// A running ACP session is asked directly, because only it knows what is
/// actually selected. Everything else falls back to what its provider advertises,
/// marked `live: false`.
pub async fn read_config(state: &AppState, session_id: &str) -> Result<SessionConfig, String> {
    let session = state
        .session_manager
        .get_session(session_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    // Only a live PTY accepts keystrokes. Checked per session, not per provider.
    let interactive_terminal = state.pty_manager.has_active_session(session_id).await;

    if let Some(mut options) = state.acp_manager.config_options(session_id).await {
        crate::providers::thought::collapse_reasoning(&mut options);
        // ACP agents never report a context window — backfill it so the
        // meter has a denominator (user override, else builtin default).
        let context_windows = {
            let config = state.config.read().await;
            config.settings().agents.context_windows.clone()
        };
        crate::providers::context_windows::ensure_session_option(
            &mut options,
            &session.agent,
            None,
            &context_windows,
        );
        return Ok(SessionConfig {
            session_id: session_id.to_string(),
            agent: session.agent,
            transport: Transport::Acp,
            options,
            live: true,
            interactive_terminal,
        });
    }

    // Claude stream-json: live means the process is still in memory.
    // We treat waiting/running as live even if the map is briefly stale,
    // but Idle only counts as live when the process is actually there.
    let has_claude_process = state.claude_stream.has_active_session(session_id).await;
    let is_claude_live = if session.agent == "claude" {
        has_claude_process
            || matches!(
                session.status,
                crate::sessions::SessionStatus::Running
                    | crate::sessions::SessionStatus::WaitingForApproval
                    | crate::sessions::SessionStatus::WaitingForInput
                    | crate::sessions::SessionStatus::Starting
            )
    } else {
        false
    };
    if is_claude_live {
        let (custom, api_providers, context_windows) = {
            let config = state.config.read().await;
            (
                config.settings().agents.providers.clone(),
                config.settings().agents.api_providers.clone(),
                config.settings().agents.context_windows.clone(),
            )
        };
        let cwd = session.project.clone().unwrap_or_else(|| ".".to_string());
        if let Some(mut provider) =
            state
                .providers
                .get(&session.agent, &custom, &cwd, &api_providers, &context_windows)
                .await
        {
            // Overlay any pending model choice so the chip shows what will run next,
            // and mark it live so the UI doesn't show "applies next turn".
            if let Ok(pending) = state.session_manager.pending_config(session_id).await {
                for (key, val) in pending {
                    if let Some(opt) = provider.config_options.iter_mut().find(|o| o.id == key) {
                        opt.current_value = Some(val);
                    }
                }
            }
            // If still no currentValue (flag-driven provider), keep the honest
            // "Not set" — the frontend will render the first choice as a subtle default,
            // but we must not lie about liveness.
            let transport = provider.transport;
            let mut options = provider.config_options;
            crate::providers::thought::collapse_reasoning(&mut options);
            crate::providers::context_windows::ensure_session_option(
                &mut options,
                &session.agent,
                None,
                &context_windows,
            );
            return Ok(SessionConfig {
                session_id: session_id.to_string(),
                agent: session.agent.clone(),
                transport,
                options,
                live: true,
                interactive_terminal,
            });
        }
    }

    // Not a live ACP or Claude session: describe what the provider offers so a picker can
    // still be rendered, honestly labelled as not-live.
    // Overlay any pending choices so a model set while stopped survives a refresh.
    let (custom, api_providers, context_windows) = {
        let config = state.config.read().await;
        (
            config.settings().agents.providers.clone(),
            config.settings().agents.api_providers.clone(),
            config.settings().agents.context_windows.clone(),
        )
    };
    let cwd = session.project.clone().unwrap_or_else(|| ".".to_string());
    let provider_opt = state
        .providers
        .get(&session.agent, &custom, &cwd, &api_providers, &context_windows)
        .await;
    let transport = provider_opt.as_ref().map(|p| p.transport).unwrap_or(Transport::Pty);
    let mut options = provider_opt.map(|p| p.config_options).unwrap_or_default();
    if let Ok(pending) = state.session_manager.pending_config(session_id).await {
        for (key, val) in pending {
            // Internal harness flags are not user-facing configuration.
            if key == "subagent" {
                continue;
            }
            if let Some(opt) = options.iter_mut().find(|o| o.id == key) {
                opt.current_value = Some(val);
            } else {
                // A stored choice the provider descriptor does not know (e.g.
                // permission_mode, or a dimension added after the session
                // started) must still reach the UI — dropping it made the
                // chips fall back to "Not set" on every session switch.
                options.push(crate::providers::types::ConfigOption {
                    id: key.clone(),
                    name: pending_option_name(&key),
                    category: None,
                    option_type: crate::providers::types::ConfigOptionType::Select,
                    current_value: Some(val.clone()),
                    choices: vec![crate::providers::types::ConfigChoice {
                        value: val.clone(),
                        name: val.clone(),
                        description: None,
                    }],
                    allows_custom_value: false,
                    mutability: crate::providers::types::ConfigMutability::StartOnly,
                });
            }
        }
    }
    crate::providers::thought::collapse_reasoning(&mut options);
    crate::providers::context_windows::ensure_session_option(
        &mut options,
        &session.agent,
        None,
        &context_windows,
    );
    Ok(SessionConfig {
        session_id: session_id.to_string(),
        agent: session.agent,
        transport,
        options,
        live: false,
        interactive_terminal,
    })
}

/// Human label for a stored config key the provider descriptor does not
/// declare ("permission_mode" → "Permission mode").
fn pending_option_name(key: &str) -> String {
    let mut parts = key.split('_').map(str::to_string).collect::<Vec<_>>();
    for part in parts.iter_mut() {
        if let Some(first) = part.get_mut(0..1) {
            first.make_ascii_uppercase();
        }
    }
    parts.join(" ")
}

/// Apply a config change to a session.
///
/// `value` is forwarded to the provider unmodified — model ids are opaque, and
/// one containing a colon or several slashes must arrive intact.
pub async fn apply_config(
    state: &AppState,
    session_id: &str,
    config_id: &str,
    value: &str,
) -> Result<(ConfigApplied, SessionConfig), String> {
    let session = state
        .session_manager
        .get_session(session_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    // Thought level is our harness dimension, not a passthrough config id: it
    // translates per engine. Intercept before generic routing.
    if config_id == crate::providers::thought::THOUGHT_ID {
        return apply_thought(state, session_id, &session, value).await;
    }

    // Permission mode is backend-only: it doesn't get sent to the agent,
    // but controls how the permission broker handles tool requests.
    // Handle it before routing to ACP so it applies to any session type.
    if config_id == "permission_mode" {        let _ = state
            .session_manager
            .set_pending_config(session_id, "permission_mode", value)
            .await;
        let mut config = crate::sessions::config::read_config(state, session_id).await?;
        if let Some(option) = config.options.iter_mut().find(|o| o.id == "permission_mode") {
            option.current_value = Some(value.to_string());
        }
        let applied = ConfigApplied::Immediate;
        broadcast_config(state, session_id, &applied, &config, Some(("permission_mode", value)));
        return Ok((applied, config));
    }

    // Live ACP session: the agent can change this now.
    if state.acp_manager.has_active_session(session_id).await {
        return apply_acp_config(state, session_id, &session.agent, config_id, value).await;
    }

    // Claude model changes are handled end-to-end here so the answer is
    // always truthful:
    //   live process  → restart it on its native resume id (Immediate)
    //   stopped       → record the choice for the next start (NextRun)
    // The generic branches below cannot express this split.
    if session.agent == "claude" && config_id == "model" {
        if state.claude_stream.has_active_session(session_id).await {
            return crate::api::routes::respawn_claude_with_model(state, session_id, value).await;
        }
        let _ = state.session_manager.set_pending_config(session_id, "model", value).await;
        let mut config = crate::sessions::config::read_config(state, session_id).await?;
        if let Some(option) = config.options.iter_mut().find(|option| option.id == "model") {
            option.current_value = Some(value.to_string());
        }
        let applied = crate::providers::types::ConfigApplied::NextRun {
            reason: "Model applies the next time this session starts (press Resume).".to_string(),
        };
        broadcast_config(state, session_id, &applied, &config, Some(("model", value)));
        return Ok((applied, config));
    }

    let current = read_config(state, session_id).await?;
    let known = current.options.iter().find(|option| option.id == config_id);

    let applied = match (known, current.transport) {
        // The provider has no such dimension. Say which one, rather than
        // silently accepting a value that will never be used.
        (None, _) => ConfigApplied::Unsupported {
            reason: format!(
                "{} does not expose a '{}' setting.",
                session.agent, config_id
            ),
        },
        // A scraped TUI has no channel for this at all.
        (Some(_), Transport::Pty) => ConfigApplied::Unsupported {
            reason: format!(
                "{} runs as a terminal session, which offers no way to change '{}' programmatically.",
                session.agent, config_id
            ),
        },
        // Custom HTTP providers read the model from the request body, so a
        // change applies to the next turn just like a spawn-time flag.
        (Some(option), Transport::Api) => match option.mutability {
            ConfigMutability::Live => ConfigApplied::Immediate,
            ConfigMutability::NextRun | ConfigMutability::StartOnly => ConfigApplied::NextRun {
                reason: format!(
                    "{} applies '{}' on the next request.",
                    session.agent, config_id
                ),
            },
        },
        // Flag-driven CLIs fix their model at spawn. Recording it for the next
        // run is the honest outcome — the alternative would be claiming a live
        // change that the process cannot make.
        (Some(option), Transport::StreamJson | Transport::Jsonl) => {
            match option.mutability {
                ConfigMutability::Live => ConfigApplied::Immediate,
                ConfigMutability::NextRun | ConfigMutability::StartOnly => ConfigApplied::NextRun {
                    reason: format!(
                        "{} sets '{}' when the agent starts. This applies the next time the session runs.",
                        session.agent, config_id
                    ),
                },
            }
        }
        // An ACP provider whose session is no longer running.
        (Some(_), Transport::Acp) => ConfigApplied::NextRun {
            reason: format!(
                "The {} agent is not running. This applies when the session is resumed.",
                session.agent
            ),
        },
    };

    // Persist the intent so a later spawn honors it, but only where it can be.
    // A `Live` mutability on a session with no running agent cannot apply
    // immediately — nothing is there to apply to — so the choice must be
    // stored instead of discarded, or it silently vanished between sessions.
    // For API transports, the pending config is read on every turn, so
    // persisting is always correct regardless of liveness.
    let session_live = current.live;
    let transport_is_api = matches!(current.transport, Transport::Api);
    if matches!(applied, ConfigApplied::NextRun { .. })
        || (matches!(applied, ConfigApplied::Immediate) && (!session_live || transport_is_api))
    {
        state
            .session_manager
            .set_pending_config(session_id, config_id, value)
            .await
            .map_err(|error| error.to_string())?;
    }

    let mut config = current;
    if !matches!(applied, ConfigApplied::Unsupported { .. }) {
        // Reflect the pending value so the UI shows the user's choice, while
        // `live: false` keeps it clear this is not yet the agent's state.
        if let Some(option) = config.options.iter_mut().find(|option| option.id == config_id) {
            option.current_value = Some(value.to_string());
        }
    }

    broadcast_config(state, session_id, &applied, &config, Some((config_id, value)));
    Ok((applied, config))
}

async fn apply_thought(
    state: &AppState,
    session_id: &str,
    session: &crate::sessions::Session,
    value: &str,
) -> Result<(ConfigApplied, SessionConfig), String> {
    let thought_id = crate::providers::thought::THOUGHT_ID;

    // PTY scrapes a TUI — no channel for any config, let alone thought level.
    if state.pty_manager.has_active_session(session_id).await {
        let current = read_config(state, session_id).await?;
        let applied = ConfigApplied::Unsupported {
            reason: format!(
                "{} runs as a terminal session, which offers no way to change the thought level programmatically.",
                session.agent
            ),
        };
        broadcast_config(state, session_id, &applied, &current, None);
        return Ok((applied, current));
    }

    // Live ACP agent: translate our level to the agent's own reasoning knob.
    if state.acp_manager.has_active_session(session_id).await {
        return apply_acp_thought(state, session_id, value).await;
    }

    // Live claude (stream-json): effort was fixed at spawn, but the process can
    // be restarted on its native resume id with the new --effort — so the
    // change applies NOW instead of "next time the session runs".
    if session.agent == "claude" && state.claude_stream.has_active_session(session_id).await {
        state
            .session_manager
            .set_pending_config(session_id, crate::providers::thought::THOUGHT_ID, value)
            .await
            .map_err(|error| error.to_string())?;
        return crate::api::routes::respawn_claude_with_effort(state, session_id).await;
    }

    let current = read_config(state, session_id).await?;
    if !current.options.iter().any(|option| option.id == thought_id) {
        let applied = ConfigApplied::Unsupported {
            reason: format!("{} does not support a Thought level.", current.agent),
        };
        broadcast_config(state, session_id, &applied, &current, None);
        return Ok((applied, current));
    }

    // Persist so the next API request or spawn honors it.
    state
        .session_manager
        .set_pending_config(session_id, thought_id, value)
        .await
        .map_err(|error| error.to_string())?;
    let applied = if matches!(current.transport, Transport::Api) {
        ConfigApplied::Immediate
    } else {
        ConfigApplied::NextRun {
            reason: "Thought level applies the next time this session runs.".to_string(),
        }
    };
    let mut config = current;
    if let Some(option) = config.options.iter_mut().find(|option| option.id == thought_id) {
        option.current_value = Some(value.to_string());
    }
    broadcast_config(state, session_id, &applied, &config, Some((thought_id, value)));
    Ok((applied, config))
}

/// Translate a harness Thought level to a live ACP agent's native reasoning
/// option (boolean toggle or effort enum) and send it via
/// `session/set_config_option`.
async fn apply_acp_thought(
    state: &AppState,
    session_id: &str,
    value: &str,
) -> Result<(ConfigApplied, SessionConfig), String> {
    let agent = state
        .session_manager
        .get_session(session_id)
        .await
        .ok()
        .flatten()
        .map(|session| session.agent)
        .unwrap_or_else(|| "agent".to_string());
    let unsupported = |reason: String| {
        let applied = ConfigApplied::Unsupported { reason };
        Ok((
            applied,
            SessionConfig {
                session_id: session_id.to_string(),
                agent: agent.clone(),
                transport: Transport::Acp,
                options: Vec::new(),
                live: true,
                interactive_terminal: false,
            },
        ))
    };
    let Some(raw) = state.acp_manager.config_options(session_id).await else {
        return unsupported("ACP session has no config surface.".to_string());
    };
    let Some(native) = raw.iter().find(|option| crate::providers::thought::is_reasoning_option(option)).cloned() else {
        return unsupported("This agent has no reasoning setting to map the thought level onto.".to_string());
    };

    let boolean = native.option_type == crate::providers::types::ConfigOptionType::Boolean
        || (!native.choices.is_empty()
            && native
                .choices
                .iter()
                .all(|choice| matches!(choice.value.to_lowercase().as_str(), "true" | "false" | "on" | "off" | "yes" | "no" | "enabled" | "disabled")));
    let native_value = if boolean {
        if crate::providers::thought::canonical_level(value) == "off" {
            "false".to_string()
        } else {
            "true".to_string()
        }
    } else {
        let tokens: Vec<String> = native.choices.iter().map(|choice| choice.value.clone()).collect();
        match crate::providers::thought::map_level_to_tokens(value, &tokens) {
            Some(token) => token,
            None => {
                let has_off = tokens.iter().any(|token| token.eq_ignore_ascii_case("off"));
                if crate::providers::thought::canonical_level(value) == "off" && has_off {
                    "off".to_string()
                } else {
                    return unsupported("This agent's reasoning levels don't include the chosen thought level.".to_string());
                }
            }
        }
    };

    match state
        .acp_manager
        .set_config_option(session_id, &native.id, &native_value)
        .await
    {
        Ok(_) => {
            let config = read_config(state, session_id).await?;
            let applied = ConfigApplied::Immediate;
            broadcast_config(state, session_id, &applied, &config, Some((&native.id, &native_value)));
            Ok((applied, config))
        }
        Err(error) => {
            let reason = match &error {
                crate::AgentDeckError::Session(message)
                | crate::AgentDeckError::Pty(message)
                | crate::AgentDeckError::Unknown(message) => message.clone(),
                other => other.to_string(),
            };
            let applied = ConfigApplied::Unsupported { reason };
            let config = read_config(state, session_id).await?;
            broadcast_config(state, session_id, &applied, &config, None);
            Ok((applied, config))
        }
    }
}

async fn apply_acp_config(
    state: &AppState,
    session_id: &str,
    agent: &str,
    config_id: &str,
    value: &str,
) -> Result<(ConfigApplied, SessionConfig), String> {
    match state
        .acp_manager
        .set_config_option(session_id, config_id, value)
        .await
    {
        Ok(options) => {
            // Trust the agent's report over our request. If it accepted the call
            // but selected something else, the UI must show what is real.
            let actual = options
                .iter()
                .find(|option| option.id == config_id)
                .and_then(|option| option.current_value.clone());
            let applied = match actual.as_deref() {
                Some(current) if current == value => ConfigApplied::Immediate,
                Some(current) => ConfigApplied::Unsupported {
                    reason: format!(
                        "{} accepted the request but reports '{}' as active instead of '{}'.",
                        agent, current, value
                    ),
                },
                None => ConfigApplied::Immediate,
            };
            let config = SessionConfig {
                session_id: session_id.to_string(),
                agent: agent.to_string(),
                transport: Transport::Acp,
                options,
                live: true,
                // An ACP session runs on piped stdio, so there is no PTY to type
                // into. Output is still recorded and viewable.
                interactive_terminal: false,
            };
            // The marker shows what the agent reports as active — the real
            // value, which may differ from what we requested.
            let actual_value = actual.as_deref().unwrap_or(value);
            broadcast_config(state, session_id, &applied, &config, Some((config_id, actual_value)));
            Ok((applied, config))
        }
        Err(error) => {
            // The agent's own refusal, passed through. Not an HTTP failure: the
            // request was well-formed, the provider declined.
            let applied = ConfigApplied::Unsupported { reason: agent_message(&error) };
            let config = read_config(state, session_id).await?;
            broadcast_config(state, session_id, &applied, &config, None);
            Ok((applied, config))
        }
    }
}

/// Unwrap our error type down to the agent's sentence.
///
/// `AgentDeckError`'s `Display` prefixes a category ("Session error: …"), which
/// is useful in logs and noise in a UI. The agent already wrote a complete,
/// actionable sentence — "unknown config option: warp-drive" — and that is what
/// the user should read.
fn agent_message(error: &crate::AgentDeckError) -> String {
    match error {
        crate::AgentDeckError::Session(message)
        | crate::AgentDeckError::Pty(message)
        | crate::AgentDeckError::Unknown(message) => message.clone(),
        other => other.to_string(),
    }
}

/// Turn a config id like `permission_mode` into a readable dimension name.
fn pretty_config_id(id: &str) -> String {
    id.split(['_', '-'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// One line for the timeline when a config dimension changes, e.g.
/// "Mode changed to Plan" — mirrors the engine-switch system marker so the
/// two read as the same kind of event. `value` is shown as the option's own
/// choice label when one exists, falling back to the raw value (booleans
/// read as on/off).
fn config_notice_text(config: &SessionConfig, id: &str, value: &str) -> String {
    let option = config.options.iter().find(|option| option.id == id);
    let dimension = option
        .filter(|option| !option.name.trim().is_empty())
        .map(|option| option.name.trim().to_string())
        .unwrap_or_else(|| pretty_config_id(id));
    let shown = option
        .and_then(|option| option.choices.iter().find(|choice| choice.value == value))
        .filter(|choice| !choice.name.trim().is_empty())
        .map(|choice| choice.name.trim().to_string())
        .unwrap_or_else(|| match value {
            "true" => "on".to_string(),
            "false" => "off".to_string(),
            other => other.to_string(),
        });
    format!("{dimension} changed to {shown}")
}

/// Tell every connected client about the change.
///
/// This is what makes a model switch on a phone appear on a desktop already
/// viewing the same session — the backend stays the single source of truth and
/// clients react rather than poll.
///
/// When `change` is given and the change actually applied (`applied` is not
/// `Unsupported`), a second broadcast follows as a role="system" transcript
/// message so the timeline records the change as a centered divider row — the
/// same shape the engine-switch marker uses. The daemon persists that message,
/// so reopened sessions replay it in place.
pub(crate) fn broadcast_config(
    state: &AppState,
    session_id: &str,
    applied: &ConfigApplied,
    config: &SessionConfig,
    change: Option<(&str, &str)>,
) {
    state.broadcast.broadcast_agent_event(crate::agent_events::AgentEvent::new(
        session_id,
        "session_config_changed",
        json!({
            "applied": applied,
            "options": config.options,
            "live": config.live,
            "source": "agentdeck",
        }),
    ));
    if matches!(applied, ConfigApplied::Unsupported { .. }) {
        return;
    }
    if let Some((id, value)) = change {
        let text = config_notice_text(config, id, value);
        if !text.trim().is_empty() {
            state.broadcast.broadcast(crate::websocket::WsMessage::Message {
                message: crate::agent_events::AgentMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    session_id: session_id.to_string(),
                    role: "system".to_string(),
                    content: text,
                    timestamp: chrono::Utc::now(),
                },
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::providers::{ConfigApplied, ConfigMutability, ConfigOption, ConfigOptionType};

    fn option(id: &str, mutability: ConfigMutability) -> ConfigOption {
        ConfigOption {
            id: id.to_string(),
            name: id.to_string(),
            category: Some(id.to_string()),
            option_type: ConfigOptionType::Select,
            current_value: None,
            choices: vec![],
            allows_custom_value: true,
            mutability,
        }
    }

    /// Every outcome must carry a reason the UI can show. An `Unsupported` with
    /// an empty reason is what "silently failing" looks like in this design.
    #[test]
    fn every_non_immediate_outcome_explains_itself() {
        let outcomes = [
            ConfigApplied::NextRun { reason: "starts with the agent".to_string() },
            ConfigApplied::Unsupported { reason: "no such setting".to_string() },
        ];
        for outcome in outcomes {
            let json = serde_json::to_value(&outcome).expect("serialize");
            let reason = json["reason"].as_str().unwrap_or_default();
            assert!(!reason.is_empty(), "{:?} gives the user nothing to act on", outcome);
        }
    }

    #[test]
    fn start_only_dimensions_resolve_to_next_run_not_immediate() {
        // claude/codex `--model` is fixed at spawn. Reporting Immediate here
        // would be the exact lie this type exists to prevent.
        let model = option("model", ConfigMutability::StartOnly);
        assert_eq!(model.mutability, ConfigMutability::StartOnly);

        let live = option("model", ConfigMutability::Live);
        assert_eq!(live.mutability, ConfigMutability::Live);
    }

    #[test]
    fn session_config_serializes_liveness() {
        let config = super::SessionConfig {
            session_id: "s1".to_string(),
            agent: "opencode".to_string(),
            transport: super::Transport::Acp,
            options: vec![option("model", ConfigMutability::Live)],
            live: true,
            interactive_terminal: false,
        };
        let json = serde_json::to_value(&config).expect("serialize");
        assert_eq!(json["live"], true);
        assert_eq!(json["transport"], "acp");
        assert_eq!(json["sessionId"], "s1");
        assert_eq!(
            json["interactiveTerminal"], false,
            "clients need to know whether the terminal accepts keystrokes"
        );
    }

    /// A user reading a rejection reason should see the agent's sentence, not our
    /// error taxonomy wrapped around it. The input here is opencode's real
    /// response to an unknown option id.
    #[test]
    fn rejection_reasons_drop_our_error_category() {
        let raw = "Invalid params: unknown config option: warp-drive";
        let reason = super::agent_message(&crate::AgentDeckError::Session(raw.to_string()));
        assert_eq!(reason, raw);
        assert!(
            !reason.starts_with("Session error:"),
            "the error category is for logs, not the UI: {}",
            reason
        );
    }
}

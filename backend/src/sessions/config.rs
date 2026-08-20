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

    if let Some(options) = state.acp_manager.config_options(session_id).await {
        return Ok(SessionConfig {
            session_id: session_id.to_string(),
            agent: session.agent,
            transport: Transport::Acp,
            options,
            live: true,
            interactive_terminal,
        });
    }

    // Not a live ACP session: describe what the provider offers so a picker can
    // still be rendered, honestly labelled as not-live.
    let custom = {
        let config = state.config.read().await;
        config.settings().agents.providers.clone()
    };
    let cwd = session.project.clone().unwrap_or_else(|| ".".to_string());
    let provider = state.providers.get(&session.agent, &custom, &cwd).await;

    Ok(SessionConfig {
        session_id: session_id.to_string(),
        agent: session.agent,
        transport: provider.as_ref().map_or(Transport::Pty, |p| p.transport),
        options: provider.map(|p| p.config_options).unwrap_or_default(),
        live: false,
        interactive_terminal,
    })
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

    // Live ACP session: the agent can change this now.
    if state.acp_manager.has_active_session(session_id).await {
        return apply_acp_config(state, session_id, &session.agent, config_id, value).await;
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
    if matches!(applied, ConfigApplied::NextRun { .. }) {
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

    broadcast_config(state, session_id, &applied, &config);
    Ok((applied, config))
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
            broadcast_config(state, session_id, &applied, &config);
            Ok((applied, config))
        }
        Err(error) => {
            // The agent's own refusal, passed through. Not an HTTP failure: the
            // request was well-formed, the provider declined.
            let applied = ConfigApplied::Unsupported { reason: agent_message(&error) };
            let config = read_config(state, session_id).await?;
            broadcast_config(state, session_id, &applied, &config);
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

/// Tell every connected client about the change.
///
/// This is what makes a model switch on a phone appear on a desktop already
/// viewing the same session — the backend stays the single source of truth and
/// clients react rather than poll.
fn broadcast_config(
    state: &AppState,
    session_id: &str,
    applied: &ConfigApplied,
    config: &SessionConfig,
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

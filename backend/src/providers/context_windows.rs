//! Context-window fallbacks — the meter's denominator when a provider won't say.
//!
//! The composer's context meter measures live usage against the model's total
//! context window. Model endpoints that report one (most OpenAI-compatible
//! `GET /models`) already feed it; CLI agents and ACP harnesses almost never
//! do, and their sessions used to show no meter at all. Resolution order,
//! most specific first:
//!
//!   per-model window reported by the provider
//!   > user override keyed `provider/model`
//!   > user override keyed `provider`
//!   > a builtin default for well-known CLIs
//!
//! Nothing here is ever sent in a request — the window is meter-only — so a
//! slightly-off estimate costs nothing beyond an approximate ring.

use super::types::{context_window_config_option, ConfigOption, ProviderDescriptor};
use std::collections::HashMap;

/// Public context windows for CLIs whose models don't vary the number.
/// Deliberately short: only entries whose vendor publishes a stable figure.
/// Everything else (opencode, custom agents, API gateways) stays unset until
/// the operator fills the `[agents.context_windows]` map.
fn builtin_default(provider_id: &str) -> Option<u64> {
    match provider_id {
        // Sonnet/Opus/Haiku all share the same 200k standard window.
        "claude" => Some(200_000),
        // Codex CLI — and the ChatGPT build of the same binary — fronts
        // GPT-5-family models with a 400k window.
        "codex" | "chatgpt" => Some(400_000),
        "gemini" => Some(1_000_000),
        // Qwen3-Coder, the qwen-code default, is 256k.
        "qwen" => Some(262_144),
        _ => None,
    }
}

/// Effective window for one provider/model, honoring the override map.
pub fn resolve(
    provider_id: &str,
    model_id: Option<&str>,
    overrides: &HashMap<String, u64>,
) -> Option<u64> {
    if let Some(model) = model_id.map(str::trim).filter(|m| !m.is_empty()) {
        if let Some(window) = overrides.get(&format!("{provider_id}/{model}")) {
            return Some(*window);
        }
    }
    if let Some(window) = overrides.get(provider_id) {
        return Some(*window);
    }
    builtin_default(provider_id)
}

/// Fill a provider descriptor's context-window option when it carries none.
/// Called at registry-sweep time so every consumer of `list`/`get` — the
/// providers endpoint, session config, the picker — sees the same value.
pub fn apply_to_descriptor(descriptor: &mut ProviderDescriptor, overrides: &HashMap<String, u64>) {
    if has_window(&descriptor.config_options) {
        return;
    }
    let model_id = descriptor
        .config_options
        .iter()
        .find(|option| option.id == "model")
        .and_then(|option| option.current_value.clone())
        .or_else(|| descriptor.models.first().map(|model| model.id.clone()));
    let Some(window) = resolve(&descriptor.id, model_id.as_deref(), overrides) else {
        return;
    };
    set_window(&mut descriptor.config_options, window);
}

/// Same for a live session's option list. ACP agents hand back their own
/// options, which never include a window; this backfills it for the meter
/// using the session's selected model when known.
pub fn ensure_session_option(
    options: &mut Vec<ConfigOption>,
    provider_id: &str,
    model_id: Option<&str>,
    overrides: &HashMap<String, u64>,
) {
    if has_window(options) {
        return;
    }
    let model_id = model_id
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .or_else(|| {
            options
                .iter()
                .find(|option| option.id == "model")
                .and_then(|option| option.current_value.clone())
        });
    let Some(window) = resolve(provider_id, model_id.as_deref(), overrides) else {
        return;
    };
    set_window(options, window);
}

/// True when the option list already carries a usable window — a reported or
/// previously-set value that must not be second-guessed.
fn has_window(options: &[ConfigOption]) -> bool {
    options.iter().any(|option| {
        option.id == "context_window"
            && option
                .current_value
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty())
    })
}

fn set_window(options: &mut Vec<ConfigOption>, window: u64) {
    if let Some(option) = options.iter_mut().find(|option| option.id == "context_window") {
        option.current_value = Some(window.to_string());
    } else {
        options.push(context_window_config_option(Some(window)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overrides(pairs: &[(&str, u64)]) -> HashMap<String, u64> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn model_specific_override_beats_provider_level() {
        let map = overrides(&[("agentrouter", 128_000), ("agentrouter/minimax-m3", 1_000_000)]);
        assert_eq!(
            resolve("agentrouter", Some("minimax-m3"), &map),
            Some(1_000_000)
        );
        assert_eq!(resolve("agentrouter", Some("deepseek-v4-flash"), &map), Some(128_000));
        // No model selected: provider-level applies.
        assert_eq!(resolve("agentrouter", None, &map), Some(128_000));
    }

    #[test]
    fn builtin_defaults_cover_well_known_clis_only() {
        let empty = HashMap::new();
        assert_eq!(resolve("claude", None, &empty), Some(200_000));
        assert_eq!(resolve("codex", Some("gpt-5.1-codex"), &empty), Some(400_000));
        assert_eq!(resolve("opencode", None, &empty), None);
        assert_eq!(resolve("agentrouter", None, &empty), None);
    }

    #[test]
    fn ensure_session_option_backfills_missing_window() {
        let mut options = vec![ConfigOption {
            id: "model".to_string(),
            current_value: Some("deepseek-v4-flash".to_string()),
            ..context_window_config_option(None)
        }];
        ensure_session_option(&mut options, "agentrouter", None, &overrides(&[("agentrouter/deepseek-v4-flash", 131_072)]));
        let window = options.iter().find(|o| o.id == "context_window").expect("window injected");
        assert_eq!(window.current_value.as_deref(), Some("131072"));
    }

    #[test]
    fn ensure_session_option_never_overwrites_a_reported_window() {
        let mut options = vec![context_window_config_option(Some(1_048_576))];
        ensure_session_option(&mut options, "omniroute", None, &overrides(&[("omniroute", 8_000)]));
        assert_eq!(
            options[0].current_value.as_deref(),
            Some("1048576"),
            "a provider-reported window is authoritative"
        );
    }
}

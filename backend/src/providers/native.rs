//! Native model discovery — read each CLI's own configuration, paseo-style.
//!
//! Every agent keeps its own config format, and users configure models there
//! (`~/.claude/settings.json`, `~/.codex/config.toml`,
//! `~/.config/opencode/opencode.json`). The picker must show those real
//! choices — including fully custom routed models like
//! `openrouter/stealth/ox-alpha` — instead of inventing a parallel model
//! universe. Parsing is deliberately shallow and failure-tolerant: a missing
//! or malformed file simply contributes nothing.

use std::path::PathBuf;

fn home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// One model as configured by the user in a CLI's own settings.
pub struct NativeModel {
    /// The exact id the CLI accepts (`--model <id>` etc.). Never rewritten.
    pub id: String,
    /// Where it came from, for the picker's hint text.
    pub note: String,
}

/// Models declared in Claude Code's own settings.
///
/// Recognized shapes in `~/.claude/settings.json`:
///   { "model": "opus", … }
///   { "env": { "ANTHROPIC_MODEL": "…",
///              "ANTHROPIC_DEFAULT_SONNET_MODEL": "openrouter/org/name",
///              "ANTHROPIC_DEFAULT_OPUS_MODEL": "…", … } }
///
/// The DEFAULT_* keys are how custom gateways remap aliases: they must appear
/// in the picker under their real routed name, because that is what actually
/// runs when the user picks that alias.
pub fn claude_models() -> Vec<NativeModel> {
    let Some(path) = home().map(|h| h.join(".claude").join("settings.json")) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };

    let mut models = Vec::new();
    if let Some(model) = value.get("model").and_then(|m| m.as_str()) {
        if !model.trim().is_empty() {
            models.push(NativeModel {
                id: model.to_string(),
                note: "Claude default".to_string(),
            });
        }
    }
    if let Some(env) = value.get("env").and_then(|e| e.as_object()) {
        for (key, val) in env {
            let Some(id) = val.as_str().filter(|v| !v.trim().is_empty()) else { continue };
            if key == "ANTHROPIC_MODEL" {
                models.push(NativeModel {
                    id: id.to_string(),
                    note: "Claude env".to_string(),
                });
            } else if let Some(alias) = key
                .strip_prefix("ANTHROPIC_DEFAULT_")
                .and_then(|rest| rest.strip_suffix("_MODEL"))
            {
                // ANTHROPIC_DEFAULT_SONNET_MODEL → offered under the alias the
                // CLI exposes AND records which backend it routes to.
                models.push(NativeModel {
                    id: id.to_string(),
                    note: format!("claude {} route", alias.to_lowercase()),
                });
            }
        }
    }
    models
}

/// Codex writes TOML (`~/.codex/config.toml`) with a bare `model = "…"`.
/// A full TOML parser is overkill for one scalar; a line scan is honest here,
/// ignoring comments and nested-looking keys.
pub fn codex_models() -> Vec<NativeModel> {
    let Some(path) = home().map(|h| h.join(".codex").join("config.toml")) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('[') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("model") {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let value = rest.trim().trim_matches('"').trim_matches('\'').trim();
                if !value.is_empty() && !value.contains(' ') {
                    return vec![NativeModel {
                        id: value.to_string(),
                        note: "Codex default".to_string(),
                    }];
                }
            }
        }
    }
    Vec::new()
}

/// OpenCode keeps a JSON config with provider/model trees:
///   { "provider": { "<provider>": { "models": { "<model>": {} } } } }
/// Ids are flattened to `provider/model`, exactly how OpenCode names them.
pub fn opencode_models() -> Vec<NativeModel> {
    let Some(path) = home().map(|h| {
        h.join(".config")
            .join("opencode")
            .join("opencode.json")
    }) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let mut models = Vec::new();
    if let Some(providers) = value.get("provider").and_then(|p| p.as_object()) {
        for (provider_name, provider) in providers {
            let Some(models_map) = provider.get("models").and_then(|m| m.as_object()) else {
                continue;
            };
            for model_id in models_map.keys() {
                models.push(NativeModel {
                    id: format!("{provider_name}/{model_id}"),
                    note: "OpenCode config".to_string(),
                });
            }
        }
    }
    models
}

/// Dispatch by agent id; unknown agents contribute nothing.
pub fn models_for(agent: &str) -> Vec<NativeModel> {
    match agent {
        "claude" => claude_models(),
        "codex" => codex_models(),
        "opencode" => opencode_models(),
        _ => Vec::new(),
    }
}

//! Harness-level "Thought level" dimension.
//!
//! Providers each spell reasoning differently (OpenAI `reasoning_effort`
//! tokens, claude `--effort`, ACP `thinking`/`reasoning` toggles or level
//! enums). Plumb does not want per-provider effort pickers — it exposes ONE
//! control, **Thought level: Off / On / High / Max**, and maps it to whatever
//! the engine accepts. Where an engine has no reasoning dimension (or we can't
//! map it honestly) the option simply isn't surfaced.
//!
//! The canonical value ids are `off | on | high | max`; engine-side mapping:
//! - `on`   → the engine's default reasoning level (medium, else low)
//! - `high` → high / xhigh
//! - `max`  → max (only offered when the engine accepts it)
//! - `off`  → reasoning disabled (boolean engines) or parameter omitted

use crate::providers::types::{
    ConfigChoice, ConfigMutability, ConfigOption, ConfigOptionType,
};

pub const THOUGHT_ID: &str = "thought";

const REASONING_IDS: &[&str] = &[
    "effort",
    "thinking",
    "thought",
    "reasoning",
    "reasoning_effort",
    "thinking_budget",
];

/// Whether an option is one of the reasoning/effort family (ours or native).
pub fn is_reasoning_option(option: &ConfigOption) -> bool {
    let id = option.id.to_lowercase();
    let cat = option.category.as_deref().unwrap_or("").to_lowercase();
    REASONING_IDS
        .iter()
        .any(|wanted| id == *wanted || id.contains(*wanted) || cat.contains(*wanted))
}

/// Canonical level for a raw engine value ("medium"/"low" → on, "true"/"on" →
/// on, "max" → max…). Unknown values count as `on` so an engine that accepts
/// the change still reflects it.
pub fn canonical_level(raw: &str) -> &'static str {
    match raw.to_lowercase().as_str() {
        "off" | "none" | "false" | "disabled" => "off",
        "high" | "xhigh" | "deep" => "high",
        "max" | "maximum" | "full" => "max",
        // low and medium both collapse to our default "on".
        _ => "on",
    }
}

/// The native token (from `tokens`) that best matches a canonical level.
/// `off` returns None — the caller omits the reasoning parameter.
pub fn map_level_to_tokens(level: &str, tokens: &[String]) -> Option<String> {
    let has = |wanted: &str| tokens.iter().any(|token| token.eq_ignore_ascii_case(wanted));
    match canonical_level(level) {
        "off" => None,
        "on" => {
            if has("medium") {
                Some("medium".to_string())
            } else if has("low") {
                Some("low".to_string())
            } else {
                tokens.first().cloned()
            }
        }
        "high" => {
            if has("high") {
                Some("high".to_string())
            } else if has("xhigh") {
                Some("xhigh".to_string())
            } else {
                None
            }
        }
        "max" => {
            if has("max") {
                Some("max".to_string())
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Whether a native option reads as an on/off switch rather than a level enum.
fn is_boolean_option(option: &ConfigOption) -> bool {
    if option.option_type == ConfigOptionType::Boolean {
        return true;
    }
    let values: Vec<String> = option.choices.iter().map(|choice| choice.value.to_lowercase()).collect();
    !values.is_empty()
        && values
            .iter()
            .all(|value| matches!(value.as_str(), "true" | "false" | "on" | "off" | "yes" | "no" | "enabled" | "disabled"))
}

/// Build the unified Thought level option from a native reasoning option.
///
/// Keeps only the canonical levels the engine can express: boolean toggles →
/// Off/On; level enums → the subset of On/High/Max whose tokens are present
/// (plus Off when the enum carries an explicit off).
fn thought_option_from(raw: &ConfigOption) -> ConfigOption {
    let boolean = is_boolean_option(raw);
    let tokens: Vec<String> = raw.choices.iter().map(|choice| choice.value.clone()).collect();
    let has = |wanted: &str| tokens.iter().any(|token| token.eq_ignore_ascii_case(wanted));

    let mut choices: Vec<ConfigChoice> = Vec::new();
    let canonical: [(&str, &str); 4] = [("off", "Off"), ("on", "On"), ("high", "High"), ("max", "Max")];
    for (value, name) in canonical {
        let available = if boolean {
            matches!(value, "off" | "on")
        } else if value == "off" {
            has("off") || has("none")
        } else if value == "on" {
            has("low") || has("medium") || tokens.is_empty()
        } else if value == "high" {
            has("high") || has("xhigh")
        } else {
            has("max")
        };
        if available {
            choices.push(ConfigChoice {
                value: value.to_string(),
                name: name.to_string(),
                description: Some(match value {
                    "off" => "No reasoning / thinking".to_string(),
                    "on" => "Default reasoning".to_string(),
                    "high" => "Deep reasoning".to_string(),
                    _ => "Maximum reasoning budget".to_string(),
                }),
            });
        }
    }
    if choices.is_empty() {
        choices.push(ConfigChoice {
            value: "on".to_string(),
            name: "On".to_string(),
            description: Some("Default reasoning".to_string()),
        });
    }

    let current = raw.current_value.as_deref().map(canonical_level).map(str::to_string);
    ConfigOption {
        id: THOUGHT_ID.to_string(),
        name: "Thought level".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Select,
        current_value: current,
        choices,
        allows_custom_value: false,
        mutability: ConfigMutability::Live,
    }
}

/// Collapse any native reasoning/effort option into the unified Thought level.
///
/// Removes every reasoning-family option and inserts one `thought` option (in
/// the removed option's place) derived from the first native one. Engines
/// without a reasoning option keep their options untouched — no dead knob.
pub fn collapse_reasoning(options: &mut Vec<ConfigOption>) {
    let Some(native_index) = options.iter().position(is_reasoning_option) else {
        return;
    };
    let native = options.remove(native_index);
    options.retain(|option| !is_reasoning_option(option));
    options.insert(native_index, thought_option_from(&native));
}

/// Map a canonical level to the native value for a boolean reasoning option.
pub fn boolean_value(level: &str) -> bool {
    canonical_level(level) != "off"
}

/// The `--effort`-style flag for flag-driven CLIs (claude). "on" is the
/// engine's default, so it maps to no flag at all; only explicit high/max are
/// spelled out. None = leave the engine's default in place.
pub fn explicit_effort_flag(level: &str) -> Option<&'static str> {
    match canonical_level(level) {
        "high" => Some("high"),
        "max" => Some("max"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::types::ConfigOptionType;

    fn enumerated(values: &[&str], current: Option<&str>) -> ConfigOption {
        ConfigOption {
            id: "effort".to_string(),
            name: "Effort".to_string(),
            category: Some("model".to_string()),
            option_type: ConfigOptionType::Select,
            current_value: current.map(str::to_string),
            choices: values
                .iter()
                .map(|value| ConfigChoice {
                    value: value.to_string(),
                    name: value.to_string(),
                    description: None,
                })
                .collect(),
            allows_custom_value: true,
            mutability: ConfigMutability::Live,
        }
    }

    #[test]
    fn collapse_enum_to_thought() {
        let mut options = vec![enumerated(&["low", "medium", "high", "max"], Some("high"))];
        collapse_reasoning(&mut options);
        assert_eq!(options.len(), 1);
        let thought = &options[0];
        assert_eq!(thought.id, "thought");
        assert_eq!(thought.current_value.as_deref(), Some("high"));
        let values: Vec<&str> = thought.choices.iter().map(|c| c.value.as_str()).collect();
        assert_eq!(values, vec!["on", "high", "max"]);
    }

    #[test]
    fn boolean_option_offers_off_and_on() {
        let mut options = vec![ConfigOption {
            id: "reasoning".to_string(),
            name: "Reasoning".to_string(),
            category: None,
            option_type: ConfigOptionType::Boolean,
            current_value: Some("true".to_string()),
            choices: vec![
                ConfigChoice { value: "true".to_string(), name: "On".to_string(), description: None },
                ConfigChoice { value: "false".to_string(), name: "Off".to_string(), description: None },
            ],
            allows_custom_value: false,
            mutability: ConfigMutability::Live,
        }];
        collapse_reasoning(&mut options);
        assert_eq!(options[0].id, "thought");
        assert_eq!(options[0].current_value.as_deref(), Some("on"));
        let values: Vec<&str> = options[0].choices.iter().map(|c| c.value.as_str()).collect();
        assert_eq!(values, vec!["off", "on"]);
    }

    #[test]
    fn mapping_hits_exact_tokens() {
        let tokens: Vec<String> = ["low", "medium", "high", "xhigh", "max"].iter().map(|s| s.to_string()).collect();
        assert_eq!(map_level_to_tokens("on", &tokens).as_deref(), Some("medium"));
        assert_eq!(map_level_to_tokens("high", &tokens).as_deref(), Some("high"));
        assert_eq!(map_level_to_tokens("max", &tokens).as_deref(), Some("max"));
        assert_eq!(map_level_to_tokens("off", &tokens), None);
    }

    #[test]
    fn no_reasoning_option_unchanged() {
        let mut options = vec![enumerated(&[], Some("x"))];
        options[0].id = "model".to_string();
        options[0].choices.clear();
        let before = options.clone();
        collapse_reasoning(&mut options);
        assert_eq!(options, before);
    }
}

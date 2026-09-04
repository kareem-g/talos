//! Provider domain types — the contract between the backend and every client.
//!
//! Three rules govern this module, and they are the whole reason it exists:
//!
//! 1. **Model ids are opaque.** A model id is whatever the CLI calls it, byte
//!    for byte. Real ids observed on a developer machine include
//!    `localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-…-6bit` and
//!    `omni/kr/claude-sonnet-4.5-thinking-agentic` — three path segments, a
//!    colon, slashes inside the model name. Nothing here parses, splits, or
//!    normalizes an id. It round-trips.
//!
//! 2. **Unknown is not false.** Capabilities are `Option`. `None` means the
//!    provider did not tell us, which is different from telling us "no". A UI
//!    that renders unknown as unsupported hides working features.
//!
//! 3. **Config dimensions are data, not fields.** There is no `model` field
//!    plus a `mode` field plus an `effort` field. There is a list of
//!    `ConfigOption`. ACP hands us exactly this shape from `session/new`; other
//!    transports synthesize it from their flags. A provider that invents a new
//!    dimension tomorrow flows through to the UI with no code change.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// How a provider's agent process is driven.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Transport {
    /// JSON-RPC 2.0 over stdio, Agent Client Protocol. Structured events,
    /// real deltas, generic config options. The preferred transport.
    Acp,
    /// `claude -p --output-format stream-json --include-partial-messages`.
    StreamJson,
    /// `codex exec --json` — newline-delimited JSON events.
    Jsonl,
    /// Interactive TUI under a pseudo-terminal, output scraped. Lossy and
    /// provider-specific; the fallback for CLIs with no structured mode.
    Pty,
    /// A custom HTTP API provider (OpenAI- or Anthropic-compatible). No
    /// subprocess, no native tools — the harness drives it over REST.
    Api,
}

impl Transport {
    /// Whether this transport yields token-level deltas rather than whole
    /// messages or reconstructed screen redraws.
    pub fn streams_deltas(self) -> bool {
        matches!(self, Transport::Acp | Transport::StreamJson)
    }
}

/// Whether a provider can actually be used right now, and if not, what the
/// user has to do about it. Every non-ready state carries a remedy so the UI
/// never shows a dead end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ProviderState {
    /// Binary found, handshake answered, ready to start sessions.
    Ready,
    /// Binary not on PATH.
    NotInstalled { remedy: String },
    /// Binary present but the agent reports it needs a login.
    AuthRequired { remedy: String },
    /// Binary present but missing configuration (no provider/model set up).
    ConfigRequired { remedy: String },
    /// Probe failed for a reason we can report but not classify.
    Error { message: String, remedy: Option<String> },
}

impl ProviderState {
    pub fn is_ready(&self) -> bool {
        matches!(self, ProviderState::Ready)
    }
}

/// Where a piece of discovered information came from. Surfaced to clients so
/// the UI can be honest about how authoritative a list is: a `Catalog` model
/// list is a fallback guess, an `AgentHandshake` list is ground truth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverySource {
    /// The agent told us during its own handshake (ACP `configOptions`).
    AgentHandshake,
    /// A dedicated CLI command (`opencode models`).
    CliCommand,
    /// The provider's HTTP API (`opencode serve` → `/config/providers`).
    ProviderApi,
    /// Scraped from `--help` prose. Fragile; treat as a hint.
    CliHelp,
    /// The user's own config file.
    UserConfig,
    /// Our built-in catalog. A last-resort default, never authoritative.
    Catalog,
}

/// What a model can do, as reported by the provider. Every field is `Option`
/// because "the provider didn't say" is a distinct and common answer — see
/// rule 2 in the module docs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub reasoning: Option<bool>,
    pub tool_calling: Option<bool>,
    pub attachments: Option<bool>,
    pub vision: Option<bool>,
    /// Total context window in tokens.
    pub context_window: Option<u64>,
    /// Maximum tokens the model will emit in one response.
    pub max_output_tokens: Option<u64>,
    /// Accepted input kinds, e.g. `["text", "image", "pdf"]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_types: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_types: Option<Vec<String>>,
}

impl ModelCapabilities {
    /// True when the provider told us nothing at all. Lets clients distinguish
    /// "no capability data" from "capability data that happens to be all false".
    pub fn is_unknown(&self) -> bool {
        *self == ModelCapabilities::default()
    }
}

/// One selectable model.
///
/// `id` is opaque and must round-trip unchanged — it is what gets handed back
/// to the CLI. `model_provider` is deliberately separate from the agent CLI
/// that exposes it: opencode (the CLI) can serve a model from ollama (the model
/// provider). Collapsing those two into one field is what makes custom and
/// self-hosted models unrepresentable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    /// Opaque provider-native identifier. Never parsed, never rewritten.
    pub id: String,
    /// Human-readable label. Falls back to `id` when the provider offers none.
    pub display_name: String,
    /// The *model* provider (ollama, openrouter, a self-hosted endpoint), which
    /// is not the same thing as the agent CLI. `None` when not expressed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    /// Optional short badge, e.g. "Balanced", "Free", "Local".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    pub source: DiscoverySource,
    /// `None` when the provider reported no capability information.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ModelCapabilities>,
    /// Passthrough for provider-specific metadata (cost, status, release date).
    /// Clients may display what they recognize and must ignore the rest.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl Model {
    /// A model known only by its id — the honest minimum.
    pub fn opaque(id: impl Into<String>, source: DiscoverySource) -> Self {
        let id = id.into();
        Self {
            display_name: id.clone(),
            id,
            model_provider: None,
            tag: None,
            source,
            capabilities: None,
            metadata: BTreeMap::new(),
        }
    }

    pub fn with_display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = name.into();
        self
    }

    pub fn with_model_provider(mut self, provider: impl Into<String>) -> Self {
        self.model_provider = Some(provider.into());
        self
    }
}

/// The type of control a config option needs in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigOptionType {
    /// Pick one of `choices`.
    Select,
    /// Free-form string.
    Text,
    Boolean,
    Number,
}

/// One choice within a `Select` option.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChoice {
    /// Sent back to the provider verbatim.
    pub value: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A single dimension of session configuration — model, mode, effort, sandbox,
/// or anything a provider invents later.
///
/// This mirrors ACP's `configOptions` from `session/new`, which is already an
/// open list. Clients render one control per option driven by `option_type` and
/// never hardcode which options exist.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    /// Provider-native option id, passed back on update (ACP: `configId`).
    pub id: String,
    pub name: String,
    /// Coarse grouping hint: "model", "mode", "effort", … Clients may use it
    /// for ordering or placement but must tolerate unfamiliar values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub option_type: ConfigOptionType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_value: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choices: Vec<ConfigChoice>,
    /// Whether a value outside `choices` is accepted. True for CLIs whose
    /// `--model` flag takes any string (claude, codex), which is what makes a
    /// model the backend never discovered still selectable.
    #[serde(default)]
    pub allows_custom_value: bool,
    /// When this option can be changed.
    pub mutability: ConfigMutability,
}

/// When a config dimension can be changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigMutability {
    /// Changeable mid-session, takes effect immediately.
    Live,
    /// Changeable, but only applies to the next run/turn.
    NextRun,
    /// Fixed once the session starts; selectable only at creation.
    StartOnly,
}

/// Result of applying a config change. Distinguishes the three honest outcomes
/// so the UI never has to guess whether a change took effect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "applied", rename_all = "snake_case")]
pub enum ConfigApplied {
    /// Live provider state changed.
    Immediate,
    /// Recorded; will apply on the next run.
    NextRun { reason: String },
    /// Not supported by this provider — stated plainly rather than failing
    /// silently or pretending it worked.
    Unsupported { reason: String },
}

/// Session-level capabilities of a provider, as opposed to a model's.
/// `Option` for the same reason as `ModelCapabilities`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    /// Token-level streaming rather than whole-message delivery.
    pub streaming: Option<bool>,
    /// Emits reasoning/thinking separately from the answer.
    pub reasoning: Option<bool>,
    /// Asks for permission before acting, with structured options.
    pub permissions: Option<bool>,
    /// Reports file edits as structured events.
    pub file_changes: Option<bool>,
    /// Reports a task plan.
    pub plans: Option<bool>,
    /// Accepts file/image attachments on a prompt.
    pub attachments: Option<bool>,
    /// Exposes an interactive terminal for the agent process itself.
    pub terminal: Option<bool>,
    /// Can resume a prior session.
    pub resume: Option<bool>,
    /// Can cancel a turn without killing the process.
    pub interrupt: Option<bool>,
}

/// A discovered provider: identity, state, and everything a client needs to
/// render its controls without knowing anything specific about it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    /// Stable id used in API calls (`opencode`, `claude`, a custom id).
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub state: ProviderState,
    pub transport: Transport,
    /// Resolved absolute path, when the binary was found.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub capabilities: ProviderCapabilities,
    /// Models discovered ahead of session creation. May be empty for providers
    /// that only reveal them at `session/new` — clients must handle that and
    /// fall back to the session's own `configOptions`.
    ///
    /// Always serialized, even when empty: a client that has to distinguish
    /// "absent" from "empty" for a collection will eventually get it wrong, and
    /// the saving of a few bytes is not worth it.
    pub models: Vec<Model>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models_source: Option<DiscoverySource>,
    /// Config dimensions known before a session exists. The authoritative set
    /// comes from the live session. Always serialized, as above.
    pub config_options: Vec<ConfigOption>,
    /// True when the user registered this provider rather than it coming from
    /// the built-in catalog.
    #[serde(default)]
    pub user_defined: bool,
    /// When this descriptor was produced, so clients can show staleness.
    pub probed_at: chrono::DateTime<chrono::Utc>,
}

impl ProviderDescriptor {
    /// A provider whose binary was not found. `remedy` names the binary we
    /// looked for so the UI can tell the user what to install.
    pub fn not_installed(
        id: impl Into<String>,
        name: impl Into<String>,
        transport: Transport,
        binary: &str,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            state: ProviderState::NotInstalled {
                remedy: format!("`{}` was not found on PATH. Install it, or set its path in config.", binary),
            },
            transport,
            executable: None,
            version: None,
            capabilities: ProviderCapabilities::default(),
            models: Vec::new(),
            models_source: None,
            config_options: Vec::new(),
            user_defined: false,
            probed_at: chrono::Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ids in this test are real, taken from a developer machine's opencode
    /// config. They are the reason ids are opaque: a colon inside a path
    /// segment, and more slashes than a `provider/model` split would survive.
    #[test]
    fn model_ids_round_trip_unchanged() {
        let hostile = [
            "localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-6bit",
            "omni/kr/claude-sonnet-4.5-thinking-agentic",
            "x1openai/cx/gpt-5.6-luna-xhigh",
            "my-fast",
            "mycompany/internal-coder",
        ];
        for id in hostile {
            let model = Model::opaque(id, DiscoverySource::CliCommand);
            let json = serde_json::to_string(&model).expect("serialize");
            let back: Model = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(back.id, id, "id must survive a serde round trip verbatim");
            assert_eq!(back.display_name, id, "display name falls back to the id");
        }
    }

    #[test]
    fn unknown_capabilities_are_distinguishable_from_false() {
        let unknown = ModelCapabilities::default();
        assert!(unknown.is_unknown());

        let explicitly_no = ModelCapabilities { reasoning: Some(false), ..Default::default() };
        assert!(!explicitly_no.is_unknown(), "an explicit false is not the same as no data");

        // A model with no capability block at all must serialize without the
        // key, so clients can tell "unknown" from "all false".
        let model = Model::opaque("m", DiscoverySource::Catalog);
        let json = serde_json::to_value(&model).expect("serialize");
        assert!(json.get("capabilities").is_none());
    }

    #[test]
    fn provider_state_flattens_with_its_remedy() {
        let descriptor = ProviderDescriptor::not_installed("pi", "Pi", Transport::Acp, "pi");
        let json = serde_json::to_value(&descriptor).expect("serialize");
        assert_eq!(json["state"], "not_installed");
        assert!(
            json["remedy"].as_str().unwrap().contains("pi"),
            "a non-ready state must always name the remedy"
        );
        assert!(!descriptor.state.is_ready());
    }

    /// Collections are always present, even when empty. A client indexing
    /// `provider.models.length` should not have to guard against the key being
    /// absent — that asymmetry is a crash waiting to happen.
    #[test]
    fn empty_collections_still_serialize() {
        let descriptor = ProviderDescriptor::not_installed("pi", "Pi", Transport::Acp, "pi");
        let json = serde_json::to_value(&descriptor).expect("serialize");
        assert!(json["models"].is_array(), "models must always be an array");
        assert!(
            json["configOptions"].is_array(),
            "configOptions must always be an array"
        );
        assert_eq!(json["models"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn config_option_serializes_as_generic_data() {
        // Shape taken from opencode's real ACP session/new response.
        let option = ConfigOption {
            id: "mode".to_string(),
            name: "Session Mode".to_string(),
            category: Some("mode".to_string()),
            option_type: ConfigOptionType::Select,
            current_value: Some("build".to_string()),
            choices: vec![
                ConfigChoice {
                    value: "build".to_string(),
                    name: "build".to_string(),
                    description: Some("The default agent.".to_string()),
                },
                ConfigChoice {
                    value: "plan".to_string(),
                    name: "plan".to_string(),
                    description: Some("Plan mode. Disallows all edit tools.".to_string()),
                },
            ],
            allows_custom_value: false,
            mutability: ConfigMutability::Live,
        };
        let json = serde_json::to_value(&option).expect("serialize");
        assert_eq!(json["optionType"], "select");
        assert_eq!(json["currentValue"], "build");
        assert_eq!(json["mutability"], "live");
        assert_eq!(json["choices"][1]["value"], "plan");
    }

    #[test]
    fn config_applied_states_are_explicit() {
        let unsupported = ConfigApplied::Unsupported { reason: "no live switch".to_string() };
        let json = serde_json::to_value(&unsupported).expect("serialize");
        assert_eq!(json["applied"], "unsupported");
        assert_eq!(json["reason"], "no live switch");

        let immediate = serde_json::to_value(ConfigApplied::Immediate).expect("serialize");
        assert_eq!(immediate["applied"], "immediate");
    }
}

/// Reasoning effort for models that expose it (maps to the request's
/// `reasoning_effort` / thinking budget). Returns `None` only when the model
/// is *known* not to reason; unknown (`None`) keeps the option so users of
/// providers that never report capabilities still get the knob.
///
/// The choice list depends on what the provider accepts. The standard set
/// (low/medium/high) is valid on every OpenAI-style `reasoning_effort`
/// endpoint; the extended set (adding xhigh, max) is valid on
/// Anthropic-compatible endpoints that honor the full reasoning budget.
/// `reasoning_effort` values are pass-through strings, so whichever level the
/// model understands is simply sent verbatim. `allows_custom_value` stays on
/// so a provider-specific level that is neither set is still enterable.
pub(crate) fn effort_config_option(reasoning: Option<bool>, extended: bool) -> Option<ConfigOption> {
    if reasoning == Some(false) {
        return None;
    }
    let mut choices = vec![
        ConfigChoice { value: "low".to_string(), name: "Low".to_string(), description: Some("Fast, cheaper reasoning".to_string()) },
        ConfigChoice { value: "medium".to_string(), name: "Medium".to_string(), description: Some("Balanced reasoning".to_string()) },
        ConfigChoice { value: "high".to_string(), name: "High".to_string(), description: Some("Deep reasoning, slower".to_string()) },
    ];
    if extended {
        choices.push(ConfigChoice { value: "xhigh".to_string(), name: "X-High".to_string(), description: Some("Extended deep reasoning (Anthropic-style)".to_string()) });
        choices.push(ConfigChoice { value: "max".to_string(), name: "Max".to_string(), description: Some("Maximum reasoning budget".to_string()) });
    }
    Some(ConfigOption {
        id: "effort".to_string(),
        name: "Effort".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Select,
        current_value: None,
        choices,
        allows_custom_value: true,
        mutability: ConfigMutability::Live,
    })
}

/// Build the effort config option from a CLI-reported level list (e.g.
/// `claude --help`). Every reported level is kept verbatim — it came from
/// the real binary, so it is valid by construction. Known levels get their
/// descriptions; unknown ones get a title-cased name. Empty means the CLI
/// has no effort dimension: no option, no dead knob.
pub(crate) fn effort_config_option_from_names(levels: &[String]) -> Option<ConfigOption> {
    if levels.is_empty() {
        return None;
    }
    let choices: Vec<ConfigChoice> = levels
        .iter()
        .map(|level| {
            let (name, description) = match level.as_str() {
                "low" => ("Low".to_string(), Some("Fast, cheaper reasoning".to_string())),
                "medium" => ("Medium".to_string(), Some("Balanced reasoning".to_string())),
                "high" => ("High".to_string(), Some("Deep reasoning, slower".to_string())),
                "xhigh" => ("X-High".to_string(), Some("Extended deep reasoning".to_string())),
                "max" => ("Max".to_string(), Some("Maximum reasoning budget".to_string())),
                _ => {
                    let mut titled = level.clone();
                    if let Some(first) = titled.get_mut(0..1) {
                        first.make_ascii_uppercase();
                    }
                    (titled, None)
                }
            };
            ConfigChoice { value: level.clone(), name, description }
        })
        .collect();
    Some(ConfigOption {
        id: "effort".to_string(),
        name: "Effort".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Select,
        current_value: None,
        choices,
        allows_custom_value: true,
        mutability: ConfigMutability::Live,
    })
}

/// Build the effort config option from an API-probed list of accepted levels.
/// `Some(levels)` shows exactly those levels; `Some(empty)` returns `None` (the
/// API rejects the parameter entirely); `None` (probe couldn't tell) falls back
/// to the heuristic via `effort_config_option(reasoning, extended)`.
pub(crate) fn effort_config_option_from_levels(
    probed: Option<&[String]>,
    reasoning: Option<bool>,
    extended: bool,
) -> Option<ConfigOption> {
    match probed {
        Some(levels) if !levels.is_empty() => {
            let choices: Vec<ConfigChoice> = levels
                .iter()
                .filter_map(|level| {
                    let (name, description) = match level.as_str() {
                        "low" => ("Low", "Fast, cheaper reasoning"),
                        "medium" => ("Medium", "Balanced reasoning"),
                        "high" => ("High", "Deep reasoning, slower"),
                        "xhigh" => ("X-High", "Extended deep reasoning (Anthropic-style)"),
                        "max" => ("Max", "Maximum reasoning budget"),
                        _ => return None,
                    };
                    Some(ConfigChoice {
                        value: level.clone(),
                        name: name.to_string(),
                        description: Some(description.to_string()),
                    })
                })
                .collect();
            Some(ConfigOption {
                id: "effort".to_string(),
                name: "Effort".to_string(),
                category: Some("model".to_string()),
                option_type: ConfigOptionType::Select,
                current_value: None,
                choices,
                allows_custom_value: true,
                mutability: ConfigMutability::Live,
            })
        }
        Some(_) => None, // API rejects the parameter outright
        None => effort_config_option(reasoning, extended), // probe couldn't tell
    }
}

/// Output token cap per turn — the "context window" knob for the request.
pub(crate) fn max_output_tokens_config_option() -> ConfigOption {
    ConfigOption {
        id: "max_tokens".to_string(),
        name: "Max tokens".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Number,
        current_value: None,
        choices: Vec::new(),
        allows_custom_value: true,
        mutability: ConfigMutability::Live,
    }
}

/// The total context window size for the model (input + output tokens).
/// Unlike max_tokens (which caps output), this is the model's total
/// context capacity — the full working memory per request.
pub(crate) fn context_window_config_option(context_window: Option<u64>) -> ConfigOption {
    let current_value = context_window.map(|v| v.to_string());
    ConfigOption {
        id: "context_window".to_string(),
        name: "Context window".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Number,
        current_value,
        choices: Vec::new(),
        allows_custom_value: true,
        mutability: ConfigMutability::Live,
    }
}
/// The permission mode dimension for AgentDeck.
///
/// Controls how the permission broker handles tool requests:
///   ask     → prompt the human for every permission
///   auto_edit → auto-allow file edits, prompt on high-risk
///   plan    → read-only: auto-deny writes/bash, allow reads
///   full    → auto-allow everything
pub(crate) fn permission_mode_config_option() -> ConfigOption {
    ConfigOption {
        id: "permission_mode".to_string(),
        name: "Permission Mode".to_string(),
        category: Some("permissions".to_string()),
        option_type: ConfigOptionType::Select,
        current_value: None,
        choices: vec![
            ConfigChoice {
                value: "ask".to_string(),
                name: "Ask".to_string(),
                description: Some("Prompt for every permission".to_string()),
            },
            ConfigChoice {
                value: "auto_edit".to_string(),
                name: "Auto-edit".to_string(),
                description: Some("Auto-allow file edits, prompt on high-risk".to_string()),
            },
            ConfigChoice {
                value: "plan".to_string(),
                name: "Plan".to_string(),
                description: Some("Read-only: no writes or bash".to_string()),
            },
            ConfigChoice {
                value: "full".to_string(),
                name: "Full".to_string(),
                description: Some("Auto-allow everything".to_string()),
            },
        ],
        mutability: ConfigMutability::Live,
        allows_custom_value: false,
    }
}

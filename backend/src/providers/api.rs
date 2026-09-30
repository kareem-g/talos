//! Custom API provider discovery for OpenAI-compatible and Anthropic-compatible endpoints.
//!
//! Users can register custom API providers in config (e.g. OpenRouter,
//! Together AI, Groq, or a self-hosted OpenAI-compatible server).  The
//! backend probes each endpoint to discover available models and reports
//! them through the same provider discovery path as CLI agents, so they
//! appear in the UI alongside built-in providers.
//!
//! ## Config example
//!
//! ```toml
//! [agents.api_providers]
//!   [[agents.api_providers.items]]
//!   id = "openrouter"
//!   name = "OpenRouter"
//!   api_url = "https://openrouter.ai/api/v1"
//!   api_key = "sk-or-..."
//!   transport = "openai_compatible"
//!
//!   [[agents.api_providers.items]]
//!   id = "anthropic-proxy"
//!   name = "Anthropic Proxy"
//!   api_url = "https://my-anthropic-proxy.example.com"
//!   api_key = "sk-ant-..."
//!   transport = "anthropic_compatible"
//! ```
//!
//! ## Model discovery
//!
//! - **OpenAI-compatible**: `GET {api_url}/models` → `{ "data": [{ "id": "…" }] }`
//! - **Anthropic-compatible**: `GET {api_url}/v1/models` → `{ "data": [{ "id": "…" }] }`
//!
//! Both formats are accepted.  If the endpoint cannot be reached or does
//! not return a model list, the provider is reported with an empty model
//! list and `allows_custom_value: true` so any model id can still be used.

use crate::providers::types::{DiscoverySource, Model, ModelCapabilities, ProviderCapabilities, Transport};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

/// The transport protocol family for a custom API provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ApiTransport {
    /// OpenAI-compatible REST API (OpenRouter, Together AI, Groq, etc.).
    #[default]
    #[serde(rename = "openai_compatible", alias = "open_ai_compatible")]
    OpenAiCompatible,
    /// Anthropic-compatible REST API (self-hosted Anthropic-compatible server).
    #[serde(rename = "anthropic_compatible", alias = "anthropic_compatible")]
    AnthropicCompatible,
}

/// A user-registered custom API provider.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApiProvider {
    /// Stable identifier used in the UI and session creation.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Base URL of the API endpoint (e.g. `https://openrouter.ai/api/v1`).
    pub api_url: String,
    /// API key for the endpoint. Server-side only — never sent to clients via
    /// `/api/providers` (that serializes `ProviderDescriptor`, not `ApiProvider`).
    /// Persisted in `config.toml`.
    #[serde(default)]
    pub api_key: Option<String>,
    /// Which API family this endpoint speaks.
    #[serde(default)]
    pub transport: ApiTransport,
    /// Optional list of model ids the user knows are available.
    #[serde(default)]
    pub models: Vec<String>,
    /// Optional default model.
    #[serde(default)]
    pub default_model: Option<String>,
    /// Extra headers to send with each request (e.g. `{"X-Foo": "bar"}`).
    #[serde(default)]
    pub extra_headers: BTreeMap<String, String>,
    /// Output token cap for each turn. Defaults to 8192 when unset — generous
    /// enough for thinking + code, and overridable per provider.
    #[serde(default)]
    pub max_output_tokens: Option<usize>,
}

/// Result of probing an API provider — discovered models and capabilities.
#[derive(Debug, Clone, Default)]
pub struct ApiProbeResult {
    pub models: Vec<Model>,
    pub capabilities: ProviderCapabilities,
    pub error: Option<String>,
    /// Which `reasoning_effort` levels the endpoint actually accepts.
    /// `None` = unknown; `Some(vec)` = exactly those levels accepted;
    /// `Some(empty)` = the API rejects the parameter entirely.
    pub effort_levels: Option<Vec<String>>,
}

/// Probe an API provider by fetching its model list.
///
/// Returns an `ApiProbeResult` even on failure so the provider is still
/// reported with an empty model list and the error recorded.
pub async fn probe_api_provider(provider: &ApiProvider) -> ApiProbeResult {
    // 6s, not "generous": this probe runs inside the sweep that session-config
    // reads fan out into, and an endpoint that drops packets instead of
    // refusing the connection held the whole registry — and therefore every
    // config read — for the full timeout.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let models_url = match provider.transport {
        ApiTransport::OpenAiCompatible => format!("{}/models", provider.api_url.trim_end_matches('/')),
        ApiTransport::AnthropicCompatible => format!("{}/v1/models", provider.api_url.trim_end_matches('/')),
    };

    let mut request = client
        .get(&models_url)
        .header("Content-Type", "application/json");
    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.is_empty()) {
        match provider.transport {
            ApiTransport::AnthropicCompatible => {
                request = request.header("x-api-key", key).header("anthropic-version", "2023-06-01");
            }
            ApiTransport::OpenAiCompatible => {
                request = request.bearer_auth(key);
            }
        }
    }
    let request = provider.extra_headers.iter().fold(request, |req, (key, value)| {
        req.header(key.as_str(), value.as_str())
    });

    let response = match request.send().await {
        Ok(resp) => resp,
        Err(e) => {
            // Network failure — fall back to user-declared models so the provider
            // remains usable. Only surface an error if the user supplied no models.
            let mut fallback = user_models(provider);
            if !fallback.is_empty() {
                fallback.sort_by(|a, b| a.id.cmp(&b.id));
                return ApiProbeResult {
                    models: fallback,
                    capabilities: ProviderCapabilities {
                        streaming: Some(true),
                        reasoning: None,
                        permissions: None,
                        file_changes: None,
                        plans: None,
                        attachments: None,
                        terminal: Some(false),
                        resume: None,
                        interrupt: Some(true),
                    },
                    error: None,
                    effort_levels: None,
                };
            }
            return ApiProbeResult {
                error: Some(format!("Could not reach API endpoint: {}", e)),
                ..Default::default()
            };
        }
    };

    if !response.status().is_success() {
        let mut fallback = user_models(provider);
        if !fallback.is_empty() {
            // API returned an error but user explicitly configured models — treat as ready.
            fallback.sort_by(|a, b| a.id.cmp(&b.id));
            return ApiProbeResult {
                models: fallback,
                capabilities: ProviderCapabilities {
                    streaming: Some(true),
                    reasoning: None,
                    permissions: None,
                    file_changes: None,
                    plans: None,
                    attachments: None,
                    terminal: Some(false),
                    resume: None,
                    interrupt: Some(true),
                },
                error: None,
                    effort_levels: None,
            };
        }
        return ApiProbeResult {
            error: Some(format!("API returned status {}: {}", response.status(), response.text().await.unwrap_or_default())),
            ..Default::default()
        };
    }

    let body: serde_json::Value = match response.json().await {
        Ok(v) => v,
        Err(e) => {
            let mut fallback = user_models(provider);
            if !fallback.is_empty() {
                fallback.sort_by(|a, b| a.id.cmp(&b.id));
                return ApiProbeResult {
                    models: fallback,
                    capabilities: ProviderCapabilities {
                        streaming: Some(true),
                        reasoning: None,
                        permissions: None,
                        file_changes: None,
                        plans: None,
                        attachments: None,
                        terminal: Some(false),
                        resume: None,
                        interrupt: Some(true),
                    },
                    error: None,
                    effort_levels: None,
                };
            }
            return ApiProbeResult {
                error: Some(format!("Failed to parse API response: {}", e)),
                ..Default::default()
            };
        }
    };

    let discovered = parse_models(&body);

    // If the user explicitly chose a subset (provider.models non-empty), treat it
    // as an allow-list — only those models are exposed. Otherwise expose all
    // discovered. This is what makes "show 1 of 50" work.
    let models = if provider.models.is_empty() {
        let mut models = discovered;
        if models.is_empty() {
            if let Some(ref default) = provider.default_model {
                models.push(Model::opaque(default.clone(), DiscoverySource::UserConfig));
            }
        }
        models.sort_by(|a, b| a.id.cmp(&b.id));
        models
    } else {
        let mut filtered = Vec::new();
        for id in &provider.models {
            if let Some(existing) = discovered.iter().find(|m| m.id == *id).cloned() {
                filtered.push(existing);
            } else {
                filtered.push(Model::opaque(id.clone(), DiscoverySource::UserConfig));
            }
        }
        // Preserve the user's chosen order, not alphabetical.
        filtered
    };

    // The API is reachable: ask it which reasoning_effort levels it actually
    // accepts. This replaces the transport-type guess — AgentRouter is
    // Anthropic-compatible yet rejects the parameter outright, and only a real
    // request can tell the difference.
    let probe_model = models
        .first()
        .map(|m| m.id.clone())
        .or_else(|| provider.default_model.clone());
    let effort_levels = match probe_model.as_deref() {
        Some(model) => probe_effort_levels(provider, model).await,
        None => None,
    };

    ApiProbeResult {
        models,
        capabilities: ProviderCapabilities {
            streaming: Some(true),
            reasoning: None,
            permissions: None,
            file_changes: None,
            plans: None,
            attachments: None,
            terminal: Some(false),
            resume: None,
            interrupt: Some(true),
        },
        error: None,
        effort_levels,
    }
}

/// The candidate `reasoning_effort` levels, in display order.
const EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// Probe which `reasoning_effort` levels the endpoint actually accepts by
/// sending one minimal completion request per level. `None` when the probe
/// could not reach the API (network/auth — unknown), `Some(vec)` with exactly
/// the accepted levels, `Some(empty)` when the parameter is rejected outright.
pub async fn probe_effort_levels(
    provider: &ApiProvider,
    model: &str,
) -> Option<Vec<String>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .ok()?;

    let endpoint = match provider.transport {
        ApiTransport::OpenAiCompatible => {
            format!("{}/chat/completions", provider.api_url.trim_end_matches('/'))
        }
        ApiTransport::AnthropicCompatible => {
            format!("{}/v1/messages", provider.api_url.trim_end_matches('/'))
        }
    };
    let mut request = client.post(&endpoint);
    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.is_empty()) {
        match provider.transport {
            ApiTransport::AnthropicCompatible => {
                request = request.header("x-api-key", key).header("anthropic-version", "2023-06-01");
            }
            ApiTransport::OpenAiCompatible => {
                request = request.bearer_auth(key);
            }
        }
    }
    for (key, value) in &provider.extra_headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let mut accepted = Vec::new();
    for level in EFFORT_LEVELS {
        // Anthropic's Messages API requires max_tokens; without it every
        // probe fails 400 and the result says nothing about the parameter.
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "stream": false,
            "messages": [{"role": "user", "content": "hi"}],
            "reasoning_effort": level,
        });
        let Some(request) = request.try_clone() else { return None; };
        let resp = match request.json(&body).send().await {
            Ok(resp) => resp,
            Err(_) => return None, // network/auth failure — unknown
        };
        if resp.status().is_success() {
            accepted.push(level.to_string());
            continue;
        }
        // A rejection because the parameter is unknown — stop probing.
        let text = resp.text().await.unwrap_or_default().to_lowercase();
        if text.contains("reasoning_effort")
            || text.contains("unexpected keyword")
            || text.contains("unknown parameter")
            || text.contains("extra fields")
        {
            break;
        }
        // Any other error (rate limit, quota) — treat as unknown overall.
        return None;
    }
    Some(accepted)
}

/// Capability numbers reported alongside a model entry, in decreasing order
/// of reliability. OpenRouter is explicit (`context_length`,
/// `top_provider.max_completion_tokens`); other endpoints use assorted
/// spellings. Anything unparseable (strings, floats, zeros) is ignored —
/// an honest unknown beats a wrong number in the context meter.
fn capability_u64(item: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(value) = item.get(*key).and_then(|v| v.as_u64()).filter(|v| *v > 0) {
            return Some(value);
        }
    }
    None
}

fn model_capabilities(item: &serde_json::Value) -> Option<ModelCapabilities> {
    let context_window = capability_u64(item, &["context_length", "context_window", "max_context_window", "max_context"]);
    let max_output_tokens = capability_u64(
        item,
        &["max_completion_tokens", "max_output_tokens", "max_tokens_out", "output_limit"],
    )
    .or_else(|| {
        item.get("top_provider")
            .and_then(|p| capability_u64(p, &["max_completion_tokens", "max_output_tokens"]))
    });
    if context_window.is_none() && max_output_tokens.is_none() {
        return None;
    }
    Some(ModelCapabilities {
        reasoning: None,
        tool_calling: None,
        attachments: None,
        vision: None,
        context_window,
        max_output_tokens,
        input_types: None,
        output_types: None,
    })
}

/// Extract model ids from a JSON API response.
///
/// Accepts both OpenAI (`{ "data": [{ "id": "…" }] }`) and Anthropic
/// (`{ "data": [{ "id": "…" }] }`) response shapes.
fn parse_models(body: &serde_json::Value) -> Vec<Model> {
    let mut models = Vec::new();

    // Try "data" array (OpenAI, Anthropic, and most compatible APIs).
    if let Some(data) = body.get("data").and_then(|v| v.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    let mut model = Model::opaque(id.to_string(), DiscoverySource::ProviderApi);
                    // Extract optional name/description.
                    if let Some(name) = item.get("object").and_then(|v| v.as_str()) {
                        if name != "model" {
                            model = model.with_display_name(name.to_string());
                        }
                    }
                    if let Some(owned) = item.get("owned_by").and_then(|v| v.as_str()) {
                        model = model.with_model_provider(owned.to_string());
                    }
                    // Real capability data when the endpoint reports it
                    // (OpenRouter's `context_length`, assorted `context_window`
                    // spellings, per-model output caps). Without this every
                    // model shows "Not set" and the context meter has nothing
                    // to measure against.
                    if let Some(capabilities) = model_capabilities(item) {
                        model.capabilities = Some(capabilities);
                    }
                    models.push(model);
                }
            }
        }
        return models;
    }

    // Try top-level "models" array.
    if let Some(data) = body.get("models").and_then(|v| v.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    models.push(Model::opaque(id.to_string(), DiscoverySource::ProviderApi));
                }
            }
        }
        return models;
    }

    // Try top-level array.
    if let Some(data) = body.as_array() {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    models.push(Model::opaque(id.to_string(), DiscoverySource::ProviderApi));
                }
            }
        }
    }

    models
}

fn user_models(provider: &ApiProvider) -> Vec<Model> {
    let mut models = Vec::new();
    for id in &provider.models {
        if !id.trim().is_empty() && !models.iter().any(|m: &Model| m.id == *id) {
            models.push(Model::opaque(id.clone(), DiscoverySource::UserConfig));
        }
    }
    if models.is_empty() {
        if let Some(default) = provider.default_model.as_ref().filter(|m| !m.trim().is_empty()) {
            models.push(Model::opaque(default.clone(), DiscoverySource::UserConfig));
        }
    }
    models
}

/// Build a `ProviderDescriptor` from a probed API provider.
///
/// This mirrors the shape returned by the CLI providers so the UI can
/// render them identically.
pub fn build_api_descriptor(
    provider: &ApiProvider,
    result: &ApiProbeResult,
) -> crate::providers::types::ProviderDescriptor {
    use crate::providers::types::ProviderState;

    let state = if result.error.is_some() {
        ProviderState::Error {
            message: result.error.clone().unwrap_or_default(),
            remedy: None,
        }
    } else {
        ProviderState::Ready
    };

    let permission_option = crate::providers::types::permission_mode_config_option();

    let mut config_options = vec![model_config_option(&result.models)];

    // Effort options: the probe determined which reasoning_effort levels the
    // API actually accepts — but only on the OpenAI-compatible path, which is
    // the only one that sends the field. Anthropic-compatible endpoints never
    // receive it (their API rejects the parameter), so offering the knob
    // there would be a control wired to nothing, however the probe reads.
    if matches!(provider.transport, ApiTransport::OpenAiCompatible) {
        if let Some(effort) = crate::providers::types::effort_config_option_from_levels(
            result.effort_levels.as_deref(),
            result.capabilities.reasoning,
            false,
        ) {
            config_options.push(effort);
        }
    }
    // Context window only with provider-reported data: without a real
    // number the chip is fiction — and the meter it feeds measures against
    // nothing. max_tokens stays always: API turns genuinely send it.
    if let Some(window) = result
        .models
        .first()
        .and_then(|m| m.capabilities.as_ref())
        .and_then(|c| c.context_window)
    {
        config_options.push(crate::providers::types::context_window_config_option(Some(window)));
    }
    config_options.push(crate::providers::types::max_output_tokens_config_option());
    config_options.push(permission_option);
    // Collapse the raw effort option into the unified harness Thought level.
    super::thought::collapse_reasoning(&mut config_options);

    crate::providers::types::ProviderDescriptor {
        id: provider.id.clone(),
        name: provider.name.clone(),
        state,
        transport: Transport::Api,
        executable: Some(format!("api:{}", provider.id)),
        version: None,
        capabilities: result.capabilities.clone(),
        models: result.models.clone(),
        models_source: Some(DiscoverySource::ProviderApi),
        config_options,
        user_defined: true,
        probed_at: chrono::Utc::now(),
    }
}

fn model_config_option(models: &[Model]) -> crate::providers::types::ConfigOption {
    use crate::providers::types::{ConfigMutability, ConfigOption, ConfigOptionType, ConfigChoice};

    let choices: Vec<ConfigChoice> = models
        .iter()
        .map(|model| ConfigChoice {
            value: model.id.clone(),
            name: model.display_name.clone(),
            description: None,
        })
        .collect();

    ConfigOption {
        id: "model".to_string(),
        name: "Model".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Select,
        current_value: None,
        choices,
        allows_custom_value: true,
        mutability: ConfigMutability::StartOnly,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_openai_models_response() {
        let body = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "gpt-4o", "object": "model", "owned_by": "openai" },
                { "id": "gpt-4-turbo", "object": "model", "owned_by": "openai" },
                { "id": "text-embedding-3-small", "object": "model", "owned_by": "openai" }
            ]
        });
        let models = parse_models(&body);
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[1].id, "gpt-4-turbo");
        assert_eq!(models[0].model_provider.as_deref(), Some("openai"));
    }

    #[test]
    fn parse_anthropic_compatible_models_response() {
        let body = serde_json::json!({
            "data": [
                { "id": "claude-3-5-sonnet-20241022", "owned_by": "anthropic" },
                { "id": "claude-3-opus-20240229", "owned_by": "anthropic" }
            ]
        });
        let models = parse_models(&body);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "claude-3-5-sonnet-20241022");
    }

    #[test]
    fn parse_top_level_models_array() {
        let body = serde_json::json!([
            { "id": "model-1" },
            { "id": "model-2" }
        ]);
        let models = parse_models(&body);
        assert_eq!(models.len(), 2);
    }

    #[test]
    fn empty_response_yields_empty_models() {
        let body = serde_json::json!({});
        let models = parse_models(&body);
        assert!(models.is_empty());
    }

    #[test]
    fn parse_models_extracts_real_context_windows() {
        let body = serde_json::json!({
            "data": [
                { "id": "m1", "context_length": 128000, "top_provider": { "max_completion_tokens": 4096 } },
                { "id": "m2", "context_window": 64000 },
                { "id": "m3" },
            ]
        });
        let models = parse_models(&body);
        assert_eq!(models.len(), 3);
        let caps = models[0].capabilities.as_ref().expect("m1 capabilities");
        assert_eq!(caps.context_window, Some(128000));
        assert_eq!(caps.max_output_tokens, Some(4096));
        assert_eq!(
            models[1].capabilities.as_ref().and_then(|c| c.context_window),
            Some(64000)
        );
        assert!(models[2].capabilities.is_none());
    }

    #[test]
    fn anthropic_transport_never_offers_effort() {
        // The turn code never sends reasoning_effort on this path, so the
        // knob must not exist no matter what a probe claims to accept.
        let provider = ApiProvider {
            id: "p".to_string(),
            name: "P".to_string(),
            api_url: "https://example.com".to_string(),
            api_key: None,
            transport: ApiTransport::AnthropicCompatible,
            models: vec![],
            default_model: None,
            extra_headers: BTreeMap::new(),
            max_output_tokens: None,
        };
        let result = ApiProbeResult {
            models: vec![],
            capabilities: ProviderCapabilities::default(),
            error: None,
            effort_levels: Some(vec!["low".to_string(), "medium".to_string()]),
        };
        let descriptor = build_api_descriptor(&provider, &result);
        assert!(descriptor.config_options.iter().all(|o| o.id != "effort"));
    }

    #[test]
    fn context_window_offered_only_with_reported_data() {
        let provider = ApiProvider {
            id: "p".to_string(),
            name: "P".to_string(),
            api_url: "https://example.com".to_string(),
            api_key: None,
            transport: ApiTransport::OpenAiCompatible,
            models: vec![],
            default_model: None,
            extra_headers: BTreeMap::new(),
            max_output_tokens: None,
        };
        let with_data = ApiProbeResult {
            models: vec![{
                let mut m = Model::opaque("m", DiscoverySource::ProviderApi);
                m.capabilities = Some(ModelCapabilities {
                    context_window: Some(128000),
                    ..Default::default()
                });
                m
            }],
            capabilities: ProviderCapabilities::default(),
            error: None,
            effort_levels: Some(vec![]),
        };
        let ids = |d: &crate::providers::types::ProviderDescriptor| {
            d.config_options.iter().map(|o| o.id.clone()).collect::<Vec<_>>()
        };
        let descriptor = build_api_descriptor(&provider, &with_data);
        assert!(ids(&descriptor).contains(&"context_window".to_string()));
        assert!(ids(&descriptor).contains(&"max_tokens".to_string()));

        let bare = ApiProbeResult {
            models: vec![Model::opaque("m", DiscoverySource::ProviderApi)],
            ..Default::default()
        };
        let descriptor = build_api_descriptor(&provider, &bare);
        assert!(!ids(&descriptor).contains(&"context_window".to_string()));
        // max_tokens is consumed by every API turn, so it always stays.
        assert!(ids(&descriptor).contains(&"max_tokens".to_string()));
    }

    #[test]
    fn user_declared_models_always_appear() {
        let provider = ApiProvider {
            id: "test".to_string(),
            name: "Test".to_string(),
            api_url: "https://example.com".to_string(),
            api_key: None,
            transport: ApiTransport::OpenAiCompatible,
            models: vec!["my-custom-model".to_string()],
            default_model: None,
            extra_headers: BTreeMap::new(),
            max_output_tokens: None,
        };
        // Simulate an empty API response.
        let body = serde_json::json!({ "data": [] });
        let mut models = parse_models(&body);
        for model_id in &provider.models {
            if !models.iter().any(|m| m.id == *model_id) {
                models.push(Model::opaque(model_id.clone(), DiscoverySource::UserConfig));
            }
        }
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "my-custom-model");
    }
}
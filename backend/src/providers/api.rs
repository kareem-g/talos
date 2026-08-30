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

use crate::providers::types::{DiscoverySource, Model, ProviderCapabilities, Transport};
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
}

/// Probe an API provider by fetching its model list.
///
/// Returns an `ApiProbeResult` even on failure so the provider is still
/// reported with an empty model list and the error recorded.
pub async fn probe_api_provider(provider: &ApiProvider) -> ApiProbeResult {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
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
    }
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
    config_options.push(permission_option);

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
//! Provider endpoints.
//!
//! `GET /api/providers` is the frontend's entire source of truth about which
//! agent CLIs exist, what they can do, and which models they offer. The
//! frontend renders whatever appears here and hardcodes nothing.
//!
//! Two contract guarantees, both enforced by tests below:
//!
//! - **Unavailable providers are included**, each with a `state` and a `remedy`,
//!   so the UI can show "not installed — install X" instead of silently omitting
//!   a CLI the user believes they have.
//! - **No secrets cross this boundary.** A provider's `env` (where API keys
//!   live) is server-side configuration and is never part of a descriptor. The
//!   type system does the work: `CustomProvider.env` has no path into
//!   `ProviderDescriptor`.

use crate::config::AppState;
use crate::providers::ProviderDescriptor;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;

/// Discovery runs relative to a working directory because some agents report
/// project-scoped configuration. Absent a specific project, use the daemon's
/// cwd rather than a hardcoded path.
fn discovery_cwd() -> String {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

/// `GET /api/providers`
///
/// Every known provider, ready or not. Ready ones sort first.
pub async fn list_providers(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let custom = {
        let config = state.config.read().await;
        config.settings().agents.providers.clone()
    };
    let api_providers = {
        let config = state.config.read().await;
        config.settings().agents.api_providers.clone()
    };
    let providers = state.providers.list(&custom, &discovery_cwd(), &api_providers).await;
    Json(providers_response(providers))
}

/// `POST /api/providers/refresh`
///
/// Drops the discovery cache and re-probes. This is the supported way to pick up
/// a newly installed CLI or a credential change without restarting the daemon.
pub async fn refresh_providers(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    state.providers.invalidate().await;
    let custom = {
        let config = state.config.read().await;
        config.settings().agents.providers.clone()
    };
    let api_providers = {
        let config = state.config.read().await;
        config.settings().agents.api_providers.clone()
    };
    let providers = state.providers.list(&custom, &discovery_cwd(), &api_providers).await;
    Json(providers_response(providers))
}

/// `GET /api/providers/{id}`
pub async fn get_provider(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let custom = {
        let config = state.config.read().await;
        config.settings().agents.providers.clone()
    };
    let api_providers = {
        let config = state.config.read().await;
        config.settings().agents.api_providers.clone()
    };
    match state.providers.get(&id, &custom, &discovery_cwd(), &api_providers).await {
        Some(provider) => (StatusCode::OK, Json(json!({ "provider": provider }))),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("No provider with id '{}'", id),
                "code": "provider_unknown",
            })),
        ),
    }
}

fn providers_response(providers: Vec<ProviderDescriptor>) -> serde_json::Value {
    let ready = providers.iter().filter(|p| p.state.is_ready()).count();
    json!({
        "providers": providers,
        "ready": ready,
        "total": providers.len(),
    })
}

// ── Custom API providers (OpenAI-compatible / Anthropic-compatible) ──────────

#[derive(serde::Deserialize)]
pub struct ApiProviderRequest {
    pub id: String,
    pub name: String,
    pub api_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub transport: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub max_output_tokens: Option<usize>,
}

/// `GET /api/providers/api` — raw configured API providers, api_key masked.
pub async fn list_api_providers(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cfg = state.config.read().await;
    let items: Vec<serde_json::Value> = cfg
        .settings()
        .agents
        .api_providers
        .iter()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "api_url": p.api_url,
                "transport": p.transport,
                "models": p.models,
                "default_model": p.default_model,
                "has_key": p.api_key.as_ref().map(|k| !k.is_empty()).unwrap_or(false),
            })
        })
        .collect();
    Json(json!({ "providers": items }))
}

/// `POST /api/providers/api` — create or update a custom API provider.
pub async fn create_api_provider(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ApiProviderRequest>,
) -> impl IntoResponse {
    if body.id.trim().is_empty() || body.name.trim().is_empty() || body.api_url.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "id, name and api_url are required", "code": "invalid_request" })),
        )
            .into_response();
    }
    if !body.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "id may only contain alphanumeric, dash, underscore, dot", "code": "invalid_request" })),
        )
            .into_response();
    }
    let transport = match body.transport.as_deref().unwrap_or("openai_compatible") {
        "anthropic_compatible" | "anthropic" => crate::providers::api::ApiTransport::AnthropicCompatible,
        _ => crate::providers::api::ApiTransport::OpenAiCompatible,
    };
    let mut cfg = state.config.write().await;
    // Replace if exists, else push.
    let mut found = false;
    for existing in &mut cfg.settings_mut().agents.api_providers {
        if existing.id == body.id {
            existing.name = body.name.clone();
            existing.api_url = body.api_url.clone();
            if let Some(key) = body.api_key.clone() {
                if !key.is_empty() {
                    existing.api_key = Some(key);
                }
            }
            existing.transport = transport;
            existing.models = body.models.clone();
            existing.default_model = body.default_model.clone();
            existing.max_output_tokens = body.max_output_tokens;
            found = true;
            break;
        }
    }
    if !found {
        cfg.settings_mut().agents.api_providers.push(crate::providers::api::ApiProvider {
            id: body.id.clone(),
            name: body.name.clone(),
            api_url: body.api_url.clone(),
            api_key: body.api_key.clone(),
            transport,
            models: body.models.clone(),
            default_model: body.default_model.clone(),
            extra_headers: Default::default(),
            max_output_tokens: body.max_output_tokens,
        });
    }
    if let Err(e) = cfg.save().await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string(), "code": "save_failed" })),
        )
            .into_response();
    }
    drop(cfg);
    state.providers.invalidate().await;
    (StatusCode::OK, Json(json!({ "ok": true, "id": body.id }))).into_response()
}

/// `DELETE /api/providers/api/{id}`
pub async fn delete_api_provider(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut cfg = state.config.write().await;
    let before = cfg.settings().agents.api_providers.len();
    cfg.settings_mut().agents.api_providers.retain(|p| p.id != id);
    if cfg.settings().agents.api_providers.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("No API provider with id '{}'", id), "code": "provider_unknown" })),
        )
            .into_response();
    }
    if let Err(e) = cfg.save().await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string(), "code": "save_failed" })),
        )
            .into_response();
    }
    drop(cfg);
    state.providers.invalidate().await;
    (StatusCode::OK, Json(json!({ "ok": true, "id": id }))).into_response()
}

/// `POST /api/providers/api/test` — probe an endpoint without saving, returns models or error.
pub async fn test_api_provider(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<ApiProviderRequest>,
) -> impl IntoResponse {
    let transport = match body.transport.as_deref().unwrap_or("openai_compatible") {
        "anthropic_compatible" | "anthropic" => crate::providers::api::ApiTransport::AnthropicCompatible,
        _ => crate::providers::api::ApiTransport::OpenAiCompatible,
    };
    let provider = crate::providers::api::ApiProvider {
        id: body.id.clone(),
        name: body.name.clone(),
        api_url: body.api_url.clone(),
        api_key: body.api_key.clone(),
        transport,
        models: body.models.clone(),
        default_model: body.default_model.clone(),
        extra_headers: Default::default(),
        max_output_tokens: body.max_output_tokens,
    };
    let result = crate::providers::api::probe_api_provider(&provider).await;
    if let Some(err) = result.error {
        return Json(json!({ "ok": false, "error": err })).into_response();
    }
    Json(json!({ "ok": true, "models": result.models.iter().map(|m| &m.id).collect::<Vec<_>>() })).into_response()
}

/// `GET /api/sessions/{id}/config`
///
/// The session's config dimensions. For a running ACP agent these are read from
/// the agent itself (`live: true`); otherwise they describe what the provider
/// offers.
pub async fn get_session_config(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match crate::sessions::config::read_config(&state, &id).await {
        Ok(config) => (StatusCode::OK, Json(json!({ "config": config }))),
        Err(error) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error, "code": "session_unavailable" })),
        ),
    }
}

#[derive(serde::Deserialize)]
pub struct ConfigUpdate {
    /// Provider-native option id. Accepts `config_id` or `configId`.
    #[serde(alias = "configId")]
    config_id: String,
    /// Opaque provider-native value, forwarded unmodified.
    value: String,
}

/// `PATCH /api/sessions/{id}/config`
///
/// Change one config dimension. Always 200 on a well-formed request: the
/// response's `applied` field carries the real outcome (`immediate`, `next_run`,
/// or `unsupported` with a reason). A provider declining a change is an answer,
/// not a transport error — and the UI needs the reason, not a status code.
pub async fn patch_session_config(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(update): Json<ConfigUpdate>,
) -> impl IntoResponse {
    if update.config_id.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "config_id is required", "code": "invalid_request" })),
        );
    }
    match crate::sessions::config::apply_config(&state, &id, &update.config_id, &update.value).await
    {
        Ok((applied, config)) => (
            StatusCode::OK,
            Json(json!({ "applied": applied, "config": config })),
        ),
        Err(error) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": error, "code": "session_unavailable" })),
        ),
    }
}

#[cfg(test)]
mod tests {
    use crate::providers::{CustomProvider, ProviderRegistry, Transport};
    use std::collections::HashMap;

    /// The security property that matters most here: a provider's environment
    /// holds API keys, and nothing in the client-facing descriptor can carry
    /// them. Asserted against a real serialized payload rather than by
    /// inspection, so a future field addition trips this test.
    #[tokio::test]
    async fn descriptors_never_serialize_provider_secrets() {
        let secret = "sk-do-not-leak-6f3a91";
        let mut env = HashMap::new();
        env.insert("MY_AGENT_API_KEY".to_string(), secret.to_string());

        let custom = vec![CustomProvider {
            id: "company-agent".to_string(),
            name: "Company Agent".to_string(),
            // Deliberately absent so the probe short-circuits on PATH lookup;
            // this test is about serialization, not process spawning.
            executable: "company-agent-does-not-exist".to_string(),
            args: vec![],
            env,
            transport: Some(Transport::Acp),
        }];

        let registry = ProviderRegistry::new();
        let providers = registry.list(&custom, ".", &[]).await;
        let payload = serde_json::to_string(&super::providers_response(providers)).expect("serialize");

        assert!(
            !payload.contains(secret),
            "an API key from provider config reached the client payload"
        );
        assert!(
            !payload.contains("MY_AGENT_API_KEY"),
            "even the env var name should not cross the boundary"
        );
        // The provider itself must still be reported, secrets aside.
        assert!(payload.contains("company-agent"));
    }

    #[tokio::test]
    async fn unavailable_providers_are_reported_with_a_remedy() {
        let registry = ProviderRegistry::new();
        let providers = registry.list(&[], ".", &[]).await;
        let response = super::providers_response(providers);

        let listed = response["providers"].as_array().expect("providers array");
        assert!(!listed.is_empty(), "discovery must report the catalog even when nothing is installed");
        assert_eq!(response["total"], listed.len());

        for provider in listed {
            let state = provider["state"].as_str().expect("every provider has a state");
            if state != "ready" {
                let has_explanation = provider.get("remedy").and_then(|r| r.as_str()).is_some()
                    || provider.get("message").and_then(|m| m.as_str()).is_some();
                assert!(
                    has_explanation,
                    "provider {} is {} but offers the user no way forward",
                    provider["id"], state
                );
            }
        }
    }
}

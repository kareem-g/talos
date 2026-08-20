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
    let providers = state.providers.list(&custom, &discovery_cwd()).await;
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
    let providers = state.providers.list(&custom, &discovery_cwd()).await;
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
    match state.providers.get(&id, &custom, &discovery_cwd()).await {
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
        let providers = registry.list(&custom, ".").await;
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
        let providers = registry.list(&[], ".").await;
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

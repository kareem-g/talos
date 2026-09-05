//! Provider registry — the single place that answers "what can this machine run?"
//!
//! Discovery order, widest to narrowest:
//!
//! 1. **User config** wins. If a user declared a provider, its executable and
//!    args are used as given, and its id shadows any catalog entry.
//! 2. **Catalog** entries are probed for their binary on PATH.
//! 3. Every candidate then gets a **transport handshake** — nothing is reported
//!    ready because a file exists.
//!
//! Two properties matter more than speed here:
//!
//! - Candidates are probed **concurrently**, so one slow or hanging CLI cannot
//!   stall the others. A previous implementation ran `<binary> --version` before
//!   falling back to a PATH lookup, which hangs on any CLI whose version check
//!   blocks.
//! - Unavailable providers are **reported, not dropped**, each with a remedy, so
//!   the UI can render "not installed" instead of silently omitting a CLI the
//!   user believes they have.
//!
//! Results are cached with a TTL because a probe spawns real processes.

use super::acp_probe;
use super::api;
use super::catalog::{self, CATALOG};
use super::discovery;
use super::native;
use super::types::{
    ConfigChoice, ConfigMutability, ConfigOption, ConfigOptionType, DiscoverySource, Model,
    ProviderCapabilities, ProviderDescriptor, ProviderState, Transport,
};
use super::types::permission_mode_config_option;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// How long a discovery sweep stays fresh. Long enough that page loads are
/// cheap, short enough that installing a CLI shows up without a restart.
const CACHE_TTL: Duration = Duration::from_secs(300);

/// A provider the user declared in config. Takes precedence over the catalog.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    /// Binary name or absolute path.
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment for the agent process. Server-side only — never serialized
    /// to clients, because it is where API keys live.
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Declared transport. Omitted means "probe for ACP, fall back to PTY".
    #[serde(default)]
    pub transport: Option<Transport>,
}

/// One candidate to probe, from either the catalog or user config.
struct Candidate {
    id: String,
    name: String,
    executable: String,
    args: Vec<String>,
    transport: Transport,
    user_defined: bool,
}

pub struct ProviderRegistry {
    cache: Arc<RwLock<Option<(Instant, Vec<ProviderDescriptor>)>>>,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self { cache: Arc::new(RwLock::new(None)) }
    }

    /// All known providers, ready or not. Served from cache when fresh.
    pub async fn list(&self, custom: &[CustomProvider], cwd: &str, api_providers: &[api::ApiProvider]) -> Vec<ProviderDescriptor> {
        if let Some((probed_at, cached)) = self.cache.read().await.as_ref() {
            if probed_at.elapsed() < CACHE_TTL {
                return cached.clone();
            }
        }
        let discovered = self.sweep(custom, cwd, api_providers).await;
        *self.cache.write().await = Some((Instant::now(), discovered.clone()));
        discovered
    }

    /// Drop the cache so the next `list` re-probes. Called after config edits
    /// and by the refresh endpoint.
    pub async fn invalidate(&self) {
        *self.cache.write().await = None;
    }

    /// One provider by id, if known.
    pub async fn get(
        &self,
        id: &str,
        custom: &[CustomProvider],
        cwd: &str,
        api_providers: &[api::ApiProvider],
    ) -> Option<ProviderDescriptor> {
        self.list(custom, cwd, api_providers)
            .await
            .into_iter()
            .find(|provider| provider.id == id)
    }

    async fn sweep(&self, custom: &[CustomProvider], cwd: &str, api_providers: &[api::ApiProvider]) -> Vec<ProviderDescriptor> {
        let candidates = build_candidates(custom);
        let cwd = cwd.to_string();

        // Concurrent: one hanging CLI must not delay the rest.
        let probes = candidates.into_iter().map(|candidate| {
            let cwd = cwd.clone();
            async move { probe_candidate(candidate, &cwd).await }
        });
        let mut providers = futures::future::join_all(probes).await;

        // Probe API providers concurrently with CLI candidates.
        let api_providers = api_providers.to_vec();
        let api_descriptors = futures::future::join_all(
            api_providers.into_iter().map(|provider| {
                async move {
                    let result = api::probe_api_provider(&provider).await;
                    api::build_api_descriptor(&provider, &result)
                }
            }),
        ).await;
        providers.extend(api_descriptors);

        // Ready first, then alphabetical, so the UI's default ordering is useful
        // without the client having to sort.
        providers.sort_by(|a, b| {
            b.state
                .is_ready()
                .cmp(&a.state.is_ready())
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        providers
    }
}

/// Merge config-declared providers with the catalog. A user id shadows a catalog
/// id, letting someone point `claude` at a wrapper script without losing the
/// entry.
fn build_candidates(custom: &[CustomProvider]) -> Vec<Candidate> {
    let mut candidates: Vec<Candidate> = custom
        .iter()
        .map(|provider| Candidate {
            id: provider.id.clone(),
            name: provider.name.clone(),
            executable: provider.executable.clone(),
            args: provider.args.clone(),
            // No declared transport: assume ACP and let the handshake decide.
            // A failed handshake downgrades to PTY rather than hiding the CLI.
            transport: provider.transport.unwrap_or(Transport::Acp),
            user_defined: true,
        })
        .collect();

    for entry in CATALOG {
        if candidates.iter().any(|candidate| candidate.id == entry.id) {
            continue;
        }
        candidates.push(Candidate {
            id: entry.id.to_string(),
            name: entry.name.to_string(),
            executable: entry.binary.to_string(),
            args: entry.args.iter().map(|arg| arg.to_string()).collect(),
            transport: entry.transport,
            user_defined: false,
        });
    }
    candidates
}

async fn probe_candidate(candidate: Candidate, cwd: &str) -> ProviderDescriptor {
    let Some(executable) = resolve_on_path(&candidate.executable).await else {
        let mut descriptor = ProviderDescriptor::not_installed(
            &candidate.id,
            &candidate.name,
            candidate.transport,
            &candidate.executable,
        );
        descriptor.user_defined = candidate.user_defined;
        return descriptor;
    };

    match candidate.transport {
        Transport::Acp => probe_acp_provider(&candidate, executable, cwd).await,
        Transport::StreamJson | Transport::Jsonl | Transport::Pty => {
            probe_flag_provider(&candidate, executable).await
        }
        // API providers are probed over HTTP in `sweep`; they never become
        // CLI candidates, so this arm is unreachable.
        Transport::Api => probe_flag_provider(&candidate, executable).await,
    }
}

/// Bucket an agent's `session/new` error so the UI can pick an icon, while
/// always passing the agent's own wording through as the remedy.
///
/// The classification is a hint for presentation only. The message is never
/// rewritten or summarized: agents say things like "run `auggie login`" that no
/// generic phrasing of ours could improve on.
fn classify_session_error(message: &str, auth_methods: &[String]) -> ProviderState {
    let lowered = message.to_lowercase();
    let mentions_auth = ["auth", "login", "sign in", "credential", "unauthorized", "api key"]
        .iter()
        .any(|needle| lowered.contains(needle));

    if mentions_auth {
        let mut remedy = message.to_string();
        // Append the machine-readable methods only when the agent's own message
        // does not already tell the user how to log in.
        if !auth_methods.is_empty() && !lowered.contains("run ") {
            remedy = format!("{} (methods: {})", remedy, auth_methods.join(", "));
        }
        return ProviderState::AuthRequired { remedy };
    }

    // Not an auth problem: the agent is installed but refuses to open a session.
    // Reported as an error with its explanation, since we cannot promise a fix.
    ProviderState::Error {
        message: message.to_string(),
        remedy: None,
    }
}

async fn probe_acp_provider(
    candidate: &Candidate,
    executable: String,
    cwd: &str,
) -> ProviderDescriptor {
    let probed = acp_probe::probe(&executable, &candidate.args, cwd).await;

    let (state, version, capabilities, models, models_source, config_options, transport) =
        match probed {
            Ok(Some(probe)) => {
                let mut capabilities = catalog::baseline_capabilities(Transport::Acp);
                capabilities.resume = Some(probe.supports_load_session());
                capabilities.attachments = probe.supports_attachments();

                // An agent that shook hands but could not open a session is
                // installed and not usable. Its own explanation is always
                // better than ours — real examples: gemini's "This client is no
                // longer supported… migrate to Antigravity", auggie's "Auggie
                // does not currently support authenticating over ACP. Please run
                // `auggie login`". Both name an action; neither is something we
                // could have inferred from an error code.
                let state = match (&probe.session_error, probe.models.is_empty()) {
                    (Some(message), _) => classify_session_error(message, &probe.auth_methods),
                    (None, true) if !probe.auth_methods.is_empty() => ProviderState::AuthRequired {
                        remedy: format!(
                            "{} reported no available models. Sign in with: {}",
                            candidate.name,
                            probe.auth_methods.join(", ")
                        ),
                    },
                    (None, true) => ProviderState::ConfigRequired {
                        remedy: format!(
                            "{} started but offers no models. Check its provider configuration.",
                            candidate.name
                        ),
                    },
                    (None, false) => ProviderState::Ready,
                };
                let models_source = (!probe.models.is_empty()).then_some(DiscoverySource::AgentHandshake);
                (
                    state,
                    probe.version,
                    capabilities,
                    probe.models,
                    models_source,
                    probe.config_options,
                    Transport::Acp,
                )
            }
            // Binary present, does not speak ACP. Not an error — the CLI may
            // still be drivable under a PTY, so report it that way rather than
            // hiding it.
            Ok(None) => (
                ProviderState::ConfigRequired {
                    remedy: format!(
                        "{} did not answer an ACP handshake. It can run as a terminal session, \
                         but structured events, model and mode selection are unavailable.",
                        candidate.name
                    ),
                },
                None,
                catalog::baseline_capabilities(Transport::Pty),
                Vec::new(),
                None,
                Vec::new(),
                Transport::Pty,
            ),
            Err(message) => (
                ProviderState::Error { message, remedy: None },
                None,
                ProviderCapabilities::default(),
                Vec::new(),
                None,
                Vec::new(),
                candidate.transport,
            ),
        };

    ProviderDescriptor {
        id: candidate.id.clone(),
        name: candidate.name.clone(),
        state,
        transport,
        executable: Some(executable),
        version,
        capabilities,
        models,
        models_source,
        config_options,
        user_defined: candidate.user_defined,
        probed_at: chrono::Utc::now(),
    }
}

/// Providers driven by command-line flags rather than a protocol handshake.
/// Their model lists come from a listing command or `--help`, and are never
/// exhaustive — so the model option accepts a custom value.
async fn probe_flag_provider(candidate: &Candidate, executable: String) -> ProviderDescriptor {
    let version = read_version(&executable).await;

    let (mut models, mut models_source) = match candidate.id.as_str() {
        "opencode" => {
            let models = discovery::opencode_models(&executable).await;
            let source = (!models.is_empty()).then_some(DiscoverySource::CliCommand);
            (models, source)
        }
        _ => {
            let models = discovery::help_model_aliases(&executable).await;
            let source = (!models.is_empty()).then_some(DiscoverySource::CliHelp);
            (models, source)
        }
    };

    // paseo-style native detection: models the user configured in the CLI's
    // own settings file are real and usually what actually runs — a custom
    // gateway route must appear under its true name. Native entries win the
    // spot over a same-id discovery guess, so their tag stays attached.
    let native = native::models_for(&candidate.id);
    if !native.is_empty() {
        for model in &native {
            models.retain(|existing| existing.id != model.id);
        }
        let source = DiscoverySource::UserConfig;
        for item in native {
            let mut model = Model::opaque(item.id.clone(), source);
            model.tag = Some(item.note);
            models.push(model);
        }
        if models_source.is_none() {
            models_source = Some(source);
        }
    }

    let permission_option = permission_mode_config_option();
    let capabilities = catalog::baseline_capabilities(candidate.transport);
    let mut config_options = vec![
        model_config_option(&models, candidate.transport, &candidate.id),
        permission_option,
    ];
    // Effort is only offered where something consumes it, and the levels come
    // from the real binary — never a hardcoded list. Claude documents its
    // accepted levels in `--help` and gets a real --effort flag at spawn; a
    // claude without the flag gets no knob at all. Other StreamJson/Jsonl/Pty
    // CLIs (pi included) have no channel for it, and offering the knob there
    // produced a control that always answered "unsupported". max_tokens is
    // likewise API-turn-only and stays off CLI descriptors. The context
    // window stays everywhere: it feeds the composer's meter even though no
    // request sends it.
    if candidate.transport == crate::providers::types::Transport::StreamJson && candidate.id == "claude" {
        let levels = discovery::claude_effort_levels(&executable).await;
        if let Some(effort) = crate::providers::types::effort_config_option_from_names(&levels) {
            config_options.push(effort);
        }
    }
    // Context window only with CLI-reported data — a "Not set" chip here
    // adjusts nothing, since no CLI request sends it.
    if let Some(window) = models
        .first()
        .and_then(|m| m.capabilities.as_ref())
        .and_then(|c| c.context_window)
    {
        config_options.push(crate::providers::types::context_window_config_option(Some(window)));
    }
    // Collapse any scraped effort option into the unified Thought level.
    super::thought::collapse_reasoning(&mut config_options);

    ProviderDescriptor {
        id: candidate.id.clone(),
        name: candidate.name.clone(),
        state: ProviderState::Ready,
        transport: candidate.transport,
        executable: Some(executable),
        version,
        capabilities: catalog::baseline_capabilities(candidate.transport),
        models,
        models_source,
        config_options,
        user_defined: candidate.user_defined,
        probed_at: chrono::Utc::now(),
    }
}

/// The model dimension for a flag-driven provider.
///
/// `allows_custom_value` is the important field: `claude --model` and
/// `codex -m` accept any string, so a model we failed to discover — a new
/// release, a full model name, an org-specific alias — is still selectable.
/// `StartOnly` because the flag is fixed at spawn; changing it mid-session
/// requires a new process, and claiming otherwise would be a lie the UI passes
/// on to the user.
fn model_config_option(models: &[Model], transport: Transport, agent_id: &str) -> ConfigOption {
    // Claude's stream-json process can be restarted on its native resume id,
    // so a model switch is genuinely immediate — not "next run" marketing.
    let mutability = if agent_id == "claude" && transport == Transport::StreamJson {
        ConfigMutability::Live
    } else {
        ConfigMutability::StartOnly
    };
    ConfigOption {
        id: "model".to_string(),
        name: "Model".to_string(),
        category: Some("model".to_string()),
        option_type: ConfigOptionType::Select,
        current_value: None,
        choices: models
            .iter()
            .map(|model| super::types::ConfigChoice {
                value: model.id.clone(),
                name: model.display_name.clone(),
                description: None,
            })
            .collect(),
        allows_custom_value: true,
        mutability,
    }
}

/// Resolve a binary on PATH without executing it.
///
/// Deliberately does not run `<binary> --version` first: a CLI whose version
/// check blocks would hang discovery, and an absolute path needs no lookup at
/// all.
async fn resolve_on_path(executable: &str) -> Option<String> {
    if executable.contains('/') {
        return tokio::fs::metadata(executable)
            .await
            .ok()
            .filter(|meta| meta.is_file())
            .map(|_| executable.to_string());
    }
    let output = tokio::process::Command::new("which")
        .arg(executable)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Best-effort version string. Failure is not an error: plenty of CLIs have no
/// version flag, and a provider is not less usable for it.
async fn read_version(executable: &str) -> Option<String> {
    for flag in ["--version", "-v"] {
        let output = tokio::time::timeout(
            Duration::from_secs(8),
            tokio::process::Command::new(executable).arg(flag).output(),
        )
        .await;
        if let Ok(Ok(output)) = output {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = text.lines().find(|line| !line.trim().is_empty()) {
                    return Some(line.trim().to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(id: &str, transport: Option<Transport>) -> CustomProvider {
        CustomProvider {
            id: id.to_string(),
            name: format!("Custom {}", id),
            executable: format!("{}-bin", id),
            args: vec!["--serve".to_string()],
            env: HashMap::new(),
            transport,
        }
    }

    #[test]
    fn user_config_shadows_a_catalog_entry() {
        let candidates = build_candidates(&[custom("claude", Some(Transport::Pty))]);
        let claude: Vec<_> = candidates.iter().filter(|c| c.id == "claude").collect();
        assert_eq!(claude.len(), 1, "the catalog entry must not duplicate the user's");
        assert!(claude[0].user_defined);
        assert_eq!(claude[0].executable, "claude-bin");
        assert_eq!(claude[0].transport, Transport::Pty);
    }

    #[test]
    fn unknown_custom_providers_are_added_and_default_to_acp() {
        let candidates = build_candidates(&[custom("company-agent", None)]);
        let found = candidates
            .iter()
            .find(|c| c.id == "company-agent")
            .expect("custom provider present");
        assert!(found.user_defined);
        assert_eq!(
            found.transport,
            Transport::Acp,
            "an undeclared transport is probed as ACP, then downgraded if it fails"
        );
        // Every catalog entry still present alongside it.
        assert_eq!(candidates.len(), CATALOG.len() + 1);
    }

    #[test]
    fn flag_providers_accept_undiscovered_models() {
        let option = model_config_option(&[Model::opaque("sonnet", DiscoverySource::CliHelp)], crate::providers::types::Transport::Acp, "opencode");
        assert!(
            option.allows_custom_value,
            "claude/codex take an arbitrary --model, so the list must not be a whitelist"
        );
        assert_eq!(option.mutability, ConfigMutability::StartOnly);
        assert_eq!(option.choices.len(), 1);

        // No discovered models at all still yields a usable free-text option.
        let empty = model_config_option(&[], crate::providers::types::Transport::StreamJson, "claude");
        assert!(empty.choices.is_empty());
        assert!(empty.allows_custom_value);
    }

    #[tokio::test]
    async fn missing_binaries_are_reported_with_a_remedy_not_dropped() {
        let registry = ProviderRegistry::new();
        let providers = registry.list(&[], ".", &[]).await;

        assert_eq!(
            providers.len(),
            CATALOG.len(),
            "every catalog entry must appear, installed or not"
        );
        for provider in &providers {
            match &provider.state {
                ProviderState::Ready => {}
                ProviderState::NotInstalled { remedy }
                | ProviderState::AuthRequired { remedy }
                | ProviderState::ConfigRequired { remedy } => {
                    assert!(!remedy.is_empty(), "{} has an empty remedy", provider.id);
                }
                ProviderState::Error { message, .. } => {
                    assert!(!message.is_empty(), "{} has an empty error", provider.id);
                }
            }
        }
    }

    #[tokio::test]
    async fn ready_providers_sort_first() {
        let registry = ProviderRegistry::new();
        let providers = registry.list(&[], ".", &[]).await;
        let first_unready = providers.iter().position(|p| !p.state.is_ready());
        let last_ready = providers.iter().rposition(|p| p.state.is_ready());
        if let (Some(first_unready), Some(last_ready)) = (first_unready, last_ready) {
            assert!(last_ready < first_unready, "ready providers must precede unready ones");
        }
    }

    #[tokio::test]
    async fn absolute_paths_are_not_executed_to_be_resolved() {
        assert_eq!(resolve_on_path("/bin/sh").await.as_deref(), Some("/bin/sh"));
        assert_eq!(resolve_on_path("/nonexistent/agent-binary").await, None);
        // A directory is not a runnable provider.
        assert_eq!(resolve_on_path("/tmp").await, None);
    }

    #[tokio::test]
    async fn cache_is_reused_then_invalidated() {
        let registry = ProviderRegistry::new();
        let first = registry.list(&[], ".", &[]).await;
        assert!(registry.cache.read().await.is_some());

        // Second call must not re-probe: identical probe timestamps prove it.
        let second = registry.list(&[], ".", &[]).await;
        assert_eq!(
            first.first().map(|p| p.probed_at),
            second.first().map(|p| p.probed_at),
            "a fresh cache must be reused rather than re-probed"
        );

        registry.invalidate().await;
        assert!(registry.cache.read().await.is_none());
    }
}

//! Live provider-discovery tests. These spawn **real agent CLIs**.
//!
//! They are not mocks, and that is deliberate: the failures this rewrite exists
//! to fix were all cases where a mocked contract disagreed with what a CLI
//! actually does. A test that only proves our parser matches our fixture would
//! have passed against the broken code.
//!
//! Every test self-skips when its CLI is absent, so the suite stays green on a
//! machine without these tools installed. A skip prints why.

use agentdeck_backend::providers::{
    DiscoverySource, ProviderRegistry, ProviderState, Transport,
};

/// Is this binary on PATH? Uses the same non-executing lookup as discovery.
fn installed(binary: &str) -> bool {
    std::process::Command::new("which")
        .arg(binary)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

async fn discover(id: &str) -> Option<agentdeck_backend::providers::ProviderDescriptor> {
    ProviderRegistry::new()
        .list(&[], ".")
        .await
        .into_iter()
        .find(|provider| provider.id == id)
}

/// The headline claim of this phase: a real ACP agent's models reach us with
/// their ids intact, including models from providers the user configured
/// themselves.
#[tokio::test]
async fn opencode_reports_real_models_from_its_own_handshake() {
    if !installed("opencode") {
        eprintln!("skip: opencode not installed");
        return;
    }
    let provider = discover("opencode").await.expect("opencode is in the catalog");

    assert_eq!(provider.transport, Transport::Acp);
    assert!(
        provider.state.is_ready(),
        "opencode is installed but discovery reports {:?}",
        provider.state
    );
    assert!(provider.executable.is_some(), "a ready provider must resolve its binary");
    assert!(provider.version.is_some(), "the ACP handshake reports agentInfo.version");

    // Models come from the agent, not from us.
    assert_eq!(provider.models_source, Some(DiscoverySource::AgentHandshake));
    assert!(
        provider.models.len() > 10,
        "expected opencode's real model list, got {} models",
        provider.models.len()
    );

    // Models span several model providers — the CLI is not the model provider.
    let model_providers: std::collections::BTreeSet<_> = provider
        .models
        .iter()
        .filter_map(|model| model.model_provider.as_deref())
        .collect();
    assert!(
        model_providers.len() > 1,
        "expected models from multiple model providers, saw {:?}",
        model_providers
    );

    // Ids are opaque: nothing was normalized, lowercased, or split. Any id
    // containing a colon or more than one slash proves the round trip, and
    // these appear in real self-hosted/local configurations.
    for model in &provider.models {
        assert!(!model.id.is_empty());
        assert!(
            !model.id.contains(char::is_whitespace),
            "model id was mangled: {:?}",
            model.id
        );
        assert!(!model.display_name.is_empty(), "every model needs a label to render");
    }
}

/// Model and mode arrive as generic config options, which is what lets the UI
/// render provider controls it has never heard of.
#[tokio::test]
async fn opencode_exposes_model_and_mode_as_generic_config_options() {
    if !installed("opencode") {
        eprintln!("skip: opencode not installed");
        return;
    }
    let provider = discover("opencode").await.expect("opencode is in the catalog");
    if !provider.state.is_ready() {
        eprintln!("skip: opencode installed but not ready: {:?}", provider.state);
        return;
    }

    let model = provider
        .config_options
        .iter()
        .find(|option| option.id == "model")
        .expect("opencode reports a model config option");
    assert!(
        model.current_value.is_some(),
        "the agent reports which model is active, not just which exist"
    );
    assert_eq!(
        model.choices.len(),
        provider.models.len(),
        "the model list is derived from the model option, so they must agree"
    );

    // Mode is a second, unrelated dimension. Its presence here — with no
    // mode-specific code anywhere in the provider layer — is the evidence that
    // config dimensions are data.
    let mode = provider
        .config_options
        .iter()
        .find(|option| option.id == "mode")
        .expect("opencode reports a session mode option");
    assert!(
        mode.choices.iter().any(|choice| choice.value == "plan"),
        "expected a plan mode among {:?}",
        mode.choices.iter().map(|c| &c.value).collect::<Vec<_>>()
    );
    assert!(
        mode.choices.iter().any(|choice| choice.description.is_some()),
        "mode choices carry descriptions the UI can show"
    );

    // Everything the agent offers is live-switchable per ACP.
    for option in &provider.config_options {
        assert_eq!(
            option.mutability,
            agentdeck_backend::providers::ConfigMutability::Live,
            "ACP option {} should be live-switchable",
            option.id
        );
    }
}

/// Flag-driven CLIs must remain fully usable even though their model list can
/// never be proven complete.
#[tokio::test]
async fn flag_driven_clis_allow_models_we_did_not_discover() {
    for id in ["claude", "codex"] {
        let binary = id;
        if !installed(binary) {
            eprintln!("skip: {} not installed", id);
            continue;
        }
        let provider = discover(id).await.expect("in the catalog");
        assert!(
            provider.state.is_ready(),
            "{} is installed but reports {:?}",
            id,
            provider.state
        );

        let model = provider
            .config_options
            .iter()
            .find(|option| option.id == "model")
            .expect("a model dimension exists even when discovery found nothing");
        assert!(
            model.allows_custom_value,
            "{} accepts an arbitrary --model, so its list must not act as a whitelist",
            id
        );
    }
}

/// A CLI that is present but does not speak the transport we hoped for must be
/// reported as usable-with-caveats, not dropped and not falsely advertised.
#[tokio::test]
async fn installed_but_non_acp_clis_are_downgraded_not_hidden() {
    let providers = ProviderRegistry::new().list(&[], ".").await;

    for provider in &providers {
        match (&provider.state, provider.transport) {
            // Downgraded to PTY: the capability set must stop claiming
            // structured features it cannot deliver.
            (ProviderState::ConfigRequired { remedy }, Transport::Pty) => {
                assert!(
                    remedy.contains("terminal") || remedy.contains("ACP"),
                    "a downgraded provider should explain what it lost: {}",
                    remedy
                );
                assert_eq!(
                    provider.capabilities.permissions, None,
                    "{} was downgraded to PTY but still claims structured permissions",
                    provider.id
                );
            }
            // Not installed: no executable, no version, no invented models.
            (ProviderState::NotInstalled { .. }, _) => {
                assert!(provider.executable.is_none());
                assert!(provider.models.is_empty(), "{} invented models", provider.id);
            }
            _ => {}
        }
    }
}

/// Discovery must survive a provider that cannot be started at all, without
/// taking the sweep down with it.
#[tokio::test]
async fn a_broken_custom_provider_does_not_break_discovery() {
    let custom = vec![agentdeck_backend::providers::CustomProvider {
        id: "definitely-not-real".to_string(),
        name: "Ghost Agent".to_string(),
        executable: "definitely-not-real-agent-binary".to_string(),
        args: vec!["--acp".to_string()],
        env: Default::default(),
        transport: None,
    }];

    let providers = ProviderRegistry::new().list(&custom, ".").await;
    let ghost = providers
        .iter()
        .find(|provider| provider.id == "definitely-not-real")
        .expect("a user-declared provider is always listed, even when missing");

    assert!(ghost.user_defined);
    assert!(matches!(ghost.state, ProviderState::NotInstalled { .. }));
    // The rest of the catalog still got probed.
    assert!(providers.len() > 1);
}

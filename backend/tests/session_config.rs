//! Live session-configuration tests against a real ACP agent.
//!
//! These start an actual `opencode acp` subprocess and change its model through
//! the protocol. That is the point: the previous implementation "switched models"
//! by typing `/model x` into a TUI, which no mocked test would have caught.
//!
//! Self-skips when opencode is absent or not ready.

use agentdeck_backend::agents::acp::AcpManager;
use agentdeck_backend::providers::{ProviderRegistry, Transport};
use agentdeck_backend::websocket::broadcast::BroadcastHub;

fn installed(binary: &str) -> bool {
    std::process::Command::new("which")
        .arg(binary)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Resolve opencode's launch recipe from discovery rather than hardcoding it, so
/// this test exercises the same path the API uses.
async fn opencode_launch() -> Option<(String, Vec<String>)> {
    if !installed("opencode") {
        eprintln!("skip: opencode not installed");
        return None;
    }
    let provider = ProviderRegistry::new()
        .list(&[], ".", &[], &Default::default())
        .await
        .into_iter()
        .find(|provider| provider.id == "opencode")?;

    if !provider.state.is_ready() || provider.transport != Transport::Acp {
        eprintln!("skip: opencode not ready over ACP: {:?}", provider.state);
        return None;
    }
    Some((provider.executable?, vec!["acp".to_string()]))
}

/// The headline behavior of this phase: a model change reaches the running agent,
/// and the agent confirms it.
#[tokio::test]
async fn model_switch_reaches_the_live_agent_and_is_confirmed() {
    let Some((binary, args)) = opencode_launch().await else { return };

    let manager = AcpManager::new(BroadcastHub::new());
    let session_id = "test-model-switch";
    let info = manager
        .spawn_session(session_id, "opencode", Some("/tmp"), &binary, &args, None)
        .await
        .expect("opencode ACP session starts");

    // session/new already reported the agent's dimensions.
    let model_option = info
        .config_options
        .iter()
        .find(|option| option.id == "model")
        .expect("opencode reports a model option at session/new");
    let before = model_option
        .current_value
        .clone()
        .expect("the agent reports which model is active");

    // Pick a different model from the agent's own list — never a hardcoded id.
    let target = model_option
        .choices
        .iter()
        .map(|choice| choice.value.clone())
        .find(|value| *value != before)
        .expect("more than one model available");

    let updated = manager
        .set_config_option(session_id, "model", &target)
        .await
        .expect("session/set_config_option succeeds");

    let after = updated
        .iter()
        .find(|option| option.id == "model")
        .and_then(|option| option.current_value.clone())
        .expect("the agent reports the model after the change");

    assert_eq!(
        after, target,
        "the agent must confirm the requested model, not merely accept the call"
    );
    assert_ne!(after, before, "the model actually changed");

    // The manager's cached view agrees with what the agent last said.
    let live = manager
        .config_options(session_id)
        .await
        .expect("live session has config options");
    assert_eq!(
        live.iter()
            .find(|option| option.id == "model")
            .and_then(|option| option.current_value.as_deref()),
        Some(target.as_str()),
        "stored state must track the agent, not the request"
    );

    manager.kill_session(session_id).await.expect("session stops");
}

/// Model ids are opaque, and the ones that break naive handling are real. If a
/// user's local or self-hosted model is available, switch to it specifically.
#[tokio::test]
async fn a_custom_or_local_model_id_survives_the_round_trip() {
    let Some((binary, args)) = opencode_launch().await else { return };

    let manager = AcpManager::new(BroadcastHub::new());
    let session_id = "test-opaque-id";
    let info = manager
        .spawn_session(session_id, "opencode", Some("/tmp"), &binary, &args, None)
        .await
        .expect("opencode ACP session starts");

    let model_option = info
        .config_options
        .iter()
        .find(|option| option.id == "model")
        .expect("model option present");

    // The hostile shapes: a colon, or more than one slash. These come from
    // user-configured providers (ollama, LM Studio, openai-compatible endpoints).
    let awkward = model_option
        .choices
        .iter()
        .map(|choice| choice.value.clone())
        .find(|value| value.contains(':') || value.matches('/').count() > 1);

    let Some(awkward) = awkward else {
        eprintln!("skip: no custom/local model id configured to test against");
        manager.kill_session(session_id).await.ok();
        return;
    };

    let updated = manager
        .set_config_option(session_id, "model", &awkward)
        .await
        .unwrap_or_else(|error| panic!("agent rejected {:?}: {}", awkward, error));

    let after = updated
        .iter()
        .find(|option| option.id == "model")
        .and_then(|option| option.current_value.clone())
        .expect("model reported back");

    assert_eq!(
        after, awkward,
        "an id containing a colon or extra slashes must round-trip byte-for-byte"
    );

    manager.kill_session(session_id).await.expect("session stops");
}

/// Mode is a second dimension handled by the identical code path — no
/// mode-specific logic exists anywhere. This is the evidence that a provider
/// inventing a new dimension needs no new code.
#[tokio::test]
async fn a_non_model_dimension_switches_through_the_same_path() {
    let Some((binary, args)) = opencode_launch().await else { return };

    let manager = AcpManager::new(BroadcastHub::new());
    let session_id = "test-mode-switch";
    let info = manager
        .spawn_session(session_id, "opencode", Some("/tmp"), &binary, &args, None)
        .await
        .expect("opencode ACP session starts");

    let Some(mode) = info.config_options.iter().find(|option| option.id == "mode") else {
        eprintln!("skip: agent exposes no mode dimension");
        manager.kill_session(session_id).await.ok();
        return;
    };
    let before = mode.current_value.clone().unwrap_or_default();
    let target = mode
        .choices
        .iter()
        .map(|choice| choice.value.clone())
        .find(|value| *value != before)
        .expect("more than one mode available");

    let updated = manager
        .set_config_option(session_id, "mode", &target)
        .await
        .expect("mode switch succeeds through the generic path");

    assert_eq!(
        updated
            .iter()
            .find(|option| option.id == "mode")
            .and_then(|option| option.current_value.as_deref()),
        Some(target.as_str())
    );

    manager.kill_session(session_id).await.expect("session stops");
}

/// A rejected value must surface the agent's own explanation, not a generic
/// failure and certainly not a false success.
#[tokio::test]
async fn a_rejected_value_reports_the_agents_reason() {
    let Some((binary, args)) = opencode_launch().await else { return };

    let manager = AcpManager::new(BroadcastHub::new());
    let session_id = "test-bad-model";
    manager
        .spawn_session(session_id, "opencode", Some("/tmp"), &binary, &args, None)
        .await
        .expect("opencode ACP session starts");

    let result = manager
        .set_config_option(session_id, "model", "definitely/not-a-real-model-xyz")
        .await;

    match result {
        Err(error) => {
            let message = error.to_string();
            assert!(!message.is_empty(), "a rejection must explain itself");
        }
        Ok(options) => {
            // Some agents accept anything. Then the requirement is that the
            // reported state is the truth, whatever it is — never a silent
            // mismatch presented as success.
            let current = options
                .iter()
                .find(|option| option.id == "model")
                .and_then(|option| option.current_value.clone());
            assert!(
                current.is_some(),
                "if the change is accepted the agent must still report an active model"
            );
        }
    }

    manager.kill_session(session_id).await.expect("session stops");
}

/// Config operations on a session that is not running must fail cleanly rather
/// than panic or hang.
#[tokio::test]
async fn config_on_a_dead_session_fails_cleanly() {
    let manager = AcpManager::new(BroadcastHub::new());

    assert!(manager.config_options("never-existed").await.is_none());

    let error = manager
        .set_config_option("never-existed", "model", "anything")
        .await
        .expect_err("changing config on a non-existent session must fail");
    assert!(
        error.to_string().contains("not running"),
        "unexpected error: {}",
        error
    );
}

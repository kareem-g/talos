//! One-shot ACP handshake probe used for provider discovery.
//!
//! Discovery needs more than a yes/no on "does this speak ACP". It needs the
//! agent's version, whether it wants a login, what it can do, and — the part
//! that makes the whole design work — the `configOptions` from `session/new`,
//! which is where an ACP agent enumerates its models and modes with their
//! current values.
//!
//! Verified against opencode 1.18.18, whose `session/new` returns:
//!
//! ```text
//! id='model' category='model' type='select' current='opencode/big-pickle'  76 choices
//! id='mode'  category='mode'  type='select' current='build'                 2 choices
//! ```
//!
//! Two behaviors here are load-bearing and were established empirically:
//!
//! - stdin must stay open. Some agents (opencode) treat EOF as "exit" and die
//!   before answering, which reads as "not ACP" for a perfectly good agent.
//! - stdout carries non-JSON banner lines (`[opencode-mobile] v1.4.0`). They
//!   are skipped, not treated as protocol failures.
//!
//! The probe spawns a process and throws it away. It is cached by the registry;
//! nothing here should be called per-request.

use super::types::{
    ConfigChoice, ConfigMutability, ConfigOption, ConfigOptionType, DiscoverySource, Model,
    context_window_config_option, effort_config_option, max_output_tokens_config_option,
    permission_mode_config_option,
};
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration, Instant};

/// Total budget for initialize + session/new. Generous because a cold agent
/// start observed on real hardware takes several seconds before `session/new`
/// resolves (bun startup, provider list fetch, credential load).
const PROBE_BUDGET: Duration = Duration::from_secs(25);

/// Everything a successful handshake told us.
#[derive(Debug, Clone, Default)]
pub struct AcpProbe {
    pub version: Option<String>,
    /// Login methods the agent offers. Non-empty is a strong hint that auth may
    /// be required, but it is not proof — an agent can advertise a login method
    /// while already being logged in, so this is reported, not concluded.
    pub auth_methods: Vec<String>,
    /// Raw `agentCapabilities` from `initialize`.
    pub agent_capabilities: Value,
    /// Config dimensions from `session/new`, already normalized.
    pub config_options: Vec<ConfigOption>,
    /// Models lifted out of the `model` config option, ids untouched.
    pub models: Vec<Model>,
    /// The agent's own explanation when `session/new` failed. Preferred over
    /// anything we could infer: agents give genuinely useful reasons here, e.g.
    /// gemini's "This client is no longer supported… migrate to Antigravity"
    /// and auggie's "Auggie does not currently support authenticating over ACP.
    /// Please run `auggie login`". Discarding it and guessing would be strictly
    /// worse for the user.
    pub session_error: Option<String>,
}

impl AcpProbe {
    pub fn supports_load_session(&self) -> bool {
        self.agent_capabilities
            .get("loadSession")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    /// Whether the agent said it accepts images/embedded context on a prompt.
    pub fn supports_attachments(&self) -> Option<bool> {
        let prompt = self.agent_capabilities.get("promptCapabilities")?;
        let image = prompt.get("image").and_then(Value::as_bool).unwrap_or(false);
        let embedded = prompt.get("embeddedContext").and_then(Value::as_bool).unwrap_or(false);
        Some(image || embedded)
    }
}

/// Run the handshake. `Ok(None)` means the process ran but did not speak ACP;
/// `Err` means we could not even start it.
pub async fn probe(binary: &str, args: &[String], cwd: &str) -> Result<Option<AcpProbe>, String> {
    let mut child = Command::new(binary)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // opencode's bun runtime busy-loops when stderr is a pipe rather than a
        // terminal, which stalls the handshake. Agents log to their own files.
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("could not start {}: {}", binary, error))?;

    let Some(mut stdin) = child.stdin.take() else {
        return Err("stdin unavailable".to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        return Err("stdout unavailable".to_string());
    };

    let result = run_handshake(&mut stdin, stdout).await;

    // Always reap: a probe must never leak an agent process.
    let _ = child.start_kill();
    let _ = child.wait().await;
    Ok(result)
}

async fn run_handshake(
    stdin: &mut tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
) -> Option<AcpProbe> {
    let deadline = Instant::now() + PROBE_BUDGET;
    let mut reader = BufReader::new(stdout);

    send(stdin, json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } },
            "clientInfo": { "name": "agentdeck", "version": env!("CARGO_PKG_VERSION") },
        }
    }))
    .await?;

    let init = read_response(&mut reader, 1, deadline).await.ok()?;
    // Protocol version is the actual ACP gate. Anything else on stdout is noise.
    if init.get("protocolVersion").and_then(Value::as_i64) != Some(1) {
        return None;
    }

    let mut probe = AcpProbe {
        version: init
            .pointer("/agentInfo/version")
            .and_then(Value::as_str)
            .map(str::to_string),
        auth_methods: init
            .get("authMethods")
            .and_then(Value::as_array)
            .map(|methods| {
                methods
                    .iter()
                    .filter_map(|method| method.get("id").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        agent_capabilities: init.get("agentCapabilities").cloned().unwrap_or(Value::Null),
        ..Default::default()
    };

    // session/new is where models and modes live. A failure here is not fatal
    // for discovery — the agent exists and we know its version — but the reason
    // it gave is the single most useful thing we can show the user, so it is
    // captured rather than dropped.
    if send(stdin, json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "session/new",
        "params": { "cwd": ".", "mcpServers": [] }
    }))
    .await
    .is_some()
    {
        match read_response(&mut reader, 2, deadline).await {
            Ok(session) => {
                probe.config_options = parse_config_options(&session);
                probe.models = models_from_options(&probe.config_options);
                // Harness-level dimensions, offered only when the agent did
                // not report its own: pushing ours alongside a native twin
                // produced two same-named knobs, and set_config by id could
                // not tell them apart.
                probe.config_options.push(permission_mode_config_option());
                if !has_option_like(&probe.config_options, &["effort", "thinking", "reasoning", "reasoning_effort", "thinking_budget"]) {
                    // ACP agents assume reasoning, which is the common case.
                    probe.config_options.push(effort_config_option(None, false).unwrap());
                }
                if !has_option_like(&probe.config_options, &["context_window", "contextwindow", "max_context", "context"]) {
                    // Only with a real reported number — otherwise the chip
                    // (and its meter) measures against fiction.
                    if let Some(window) = probe
                        .models
                        .first()
                        .and_then(|m| m.capabilities.as_ref())
                        .and_then(|c| c.context_window)
                    {
                        probe.config_options.push(context_window_config_option(Some(window)));
                    }
                }
                if !has_option_like(&probe.config_options, &["max_tokens", "max_output_tokens", "maxtokens", "max_completion_tokens"]) {
                    probe.config_options.push(max_output_tokens_config_option());
                }
            }
            Err(reason) => probe.session_error = reason,
        }
    }

    Some(probe)
}

/// Whether the agent natively reported an option under any of these ids
/// (case-insensitive) — used to avoid pushing a harness twin beside it.
fn has_option_like(options: &[ConfigOption], ids: &[&str]) -> bool {
    options.iter().any(|option| {
        let id = option.id.to_lowercase();
        ids.iter().any(|wanted| id == wanted.to_lowercase())
    })
}

async fn send(stdin: &mut tokio::process::ChildStdin, message: Value) -> Option<()> {
    let mut line = serde_json::to_string(&message).ok()?;
    line.push('\n');
    stdin.write_all(line.as_bytes()).await.ok()?;
    stdin.flush().await.ok()?;
    // stdin deliberately stays open — see the module docs.
    Some(())
}

/// Read until the response with `id` arrives, skipping notifications and any
/// non-JSON banner output the agent writes to stdout.
///
/// `Err(Some(message))` is a JSON-RPC error response — the agent answered and
/// explained itself. `Err(None)` means it never answered.
async fn read_response(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    id: i64,
    deadline: Instant,
) -> Result<Value, Option<String>> {
    let mut line = String::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(None);
        }
        line.clear();
        match timeout(remaining, reader.read_line(&mut line)).await {
            // EOF or read error: the process is gone.
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return Err(None),
            Ok(Ok(_)) => {}
        }
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if let Some(outcome) = interpret_response(&message, id) {
            return outcome;
        }
    }
}

/// Classify one parsed JSON-RPC message against the request we are waiting for.
///
/// `None` means "not our answer, keep reading" — notifications and other
/// requests' responses both land here. Split out from the read loop so the
/// error-preservation behavior is testable without a subprocess.
fn interpret_response(message: &Value, id: i64) -> Option<Result<Value, Option<String>>> {
    if message.get("id").and_then(Value::as_i64) != Some(id) {
        return None;
    }
    if let Some(error) = message.get("error") {
        // Surface the agent's own words; they are more accurate than anything
        // we could infer from the error code.
        return Some(Err(error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)));
    }
    Some(message.get("result").cloned().ok_or(None))
}

/// Normalize ACP `configOptions` into our transport-neutral shape.
///
/// ACP options are already an open list, so this is a field rename, not an
/// interpretation. Unknown `type` values fall back to `Select` when choices are
/// present and `Text` otherwise, so a new option type still renders.
pub fn parse_config_options(session: &Value) -> Vec<ConfigOption> {
    let Some(options) = session.get("configOptions").and_then(Value::as_array) else {
        return Vec::new();
    };
    options
        .iter()
        .filter_map(|option| {
            let id = option.get("id").and_then(Value::as_str)?.to_string();
            let choices: Vec<ConfigChoice> = option
                .get("options")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|choice| {
                            let value = choice.get("value").and_then(Value::as_str)?.to_string();
                            let name = choice
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or(&value)
                                .to_string();
                            Some(ConfigChoice {
                                value,
                                name,
                                description: choice
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let option_type = match option.get("type").and_then(Value::as_str) {
                Some("select") => ConfigOptionType::Select,
                Some("boolean") => ConfigOptionType::Boolean,
                Some("number") => ConfigOptionType::Number,
                Some("text") | Some("string") => ConfigOptionType::Text,
                _ if !choices.is_empty() => ConfigOptionType::Select,
                _ => ConfigOptionType::Text,
            };
            let name = option
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .to_string();
            Some(ConfigOption {
                id,
                name,
                category: option.get("category").and_then(Value::as_str).map(str::to_string),
                option_type,
                current_value: option
                    .get("currentValue")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                choices,
                // ACP has no "arbitrary value" flag; assume the enumerated set
                // is exhaustive rather than sending a value the agent may reject.
                allows_custom_value: false,
                // Verified live: session/set_config_option changes the model on
                // an existing session and returns the updated options.
                mutability: ConfigMutability::Live,
            })
        })
        .collect()
}

/// Lift models out of the `model` config option.
///
/// Ids are copied verbatim. `model_provider` is taken from the first path
/// segment *only as a display grouping hint* — the id itself is never rewritten,
/// which matters for ids like
/// `localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-…` where naive splitting would
/// otherwise corrupt the value sent back to the agent.
pub fn models_from_options(options: &[ConfigOption]) -> Vec<Model> {
    let Some(model_option) = options
        .iter()
        .find(|option| option.id == "model" || option.category.as_deref() == Some("model"))
    else {
        return Vec::new();
    };
    model_option
        .choices
        .iter()
        .map(|choice| {
            let mut model = Model::opaque(&choice.value, DiscoverySource::AgentHandshake)
                .with_display_name(&choice.name);
            if let Some((prefix, _)) = choice.value.split_once('/') {
                model = model.with_model_provider(prefix);
            }
            model
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verbatim excerpt of opencode 1.18.18's real session/new result, including
    /// the custom-provider model ids from a developer machine.
    fn opencode_session_new() -> Value {
        json!({
            "sessionId": "ses_ff0a2552effetnAdZ0yS3SvPIY",
            "configOptions": [
                {
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "type": "select",
                    "currentValue": "opencode/big-pickle",
                    "options": [
                        { "value": "omni/kr/claude-sonnet-4.5-thinking-agentic", "name": "omni/kr/claude-sonnet-4.5-thinking-agentic" },
                        { "value": "opencode-go/glm-5.3", "name": "OpenCode Go/GLM-5.3" },
                        { "value": "localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-6bit", "name": "Local LLM/MLX Qwen3.5 4B" }
                    ]
                },
                {
                    "id": "mode",
                    "name": "Session Mode",
                    "category": "mode",
                    "type": "select",
                    "currentValue": "build",
                    "options": [
                        { "value": "build", "name": "build", "description": "The default agent. Executes tools based on configured permissions." },
                        { "value": "plan", "name": "plan", "description": "Plan mode. Disallows all edit tools." }
                    ]
                }
            ]
        })
    }

    #[test]
    fn parses_real_opencode_config_options() {
        let options = parse_config_options(&opencode_session_new());
        assert_eq!(options.len(), 2);

        let model = &options[0];
        assert_eq!(model.id, "model");
        assert_eq!(model.option_type, ConfigOptionType::Select);
        assert_eq!(model.current_value.as_deref(), Some("opencode/big-pickle"));
        assert_eq!(model.mutability, ConfigMutability::Live);
        assert_eq!(model.choices.len(), 3);

        let mode = &options[1];
        assert_eq!(mode.id, "mode");
        assert_eq!(mode.category.as_deref(), Some("mode"));
        assert_eq!(
            mode.choices[1].description.as_deref(),
            Some("Plan mode. Disallows all edit tools.")
        );
    }

    #[test]
    fn hostile_model_ids_survive_extraction() {
        let models = models_from_options(&parse_config_options(&opencode_session_new()));
        assert_eq!(models.len(), 3);

        let local = models
            .iter()
            .find(|model| model.id.starts_with("localllm/"))
            .expect("local model present");
        assert_eq!(
            local.id,
            "localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-6bit",
            "the id must be byte-identical to what the agent reported"
        );
        // The grouping hint is the first segment only; the id keeps the rest.
        assert_eq!(local.model_provider.as_deref(), Some("localllm"));
        assert_eq!(local.display_name, "Local LLM/MLX Qwen3.5 4B");
        assert_eq!(local.source, DiscoverySource::AgentHandshake);
    }

    #[test]
    fn missing_or_empty_config_options_yield_nothing() {
        assert!(parse_config_options(&json!({ "sessionId": "x" })).is_empty());
        assert!(models_from_options(&[]).is_empty());
        // A session with only a mode option must not invent models.
        let mode_only = json!({
            "configOptions": [{ "id": "mode", "type": "select", "options": [] }]
        });
        assert!(models_from_options(&parse_config_options(&mode_only)).is_empty());
    }

    #[test]
    fn unknown_option_type_still_renders() {
        let future = json!({
            "configOptions": [
                { "id": "sandbox", "type": "radio-group", "options": [{ "value": "ro", "name": "Read only" }] },
                { "id": "notes", "type": "something-new" }
            ]
        });
        let options = parse_config_options(&future);
        assert_eq!(options[0].option_type, ConfigOptionType::Select, "unknown type with choices → select");
        assert_eq!(options[1].option_type, ConfigOptionType::Text, "unknown type without choices → text");
    }

    #[test]
    fn agent_capabilities_are_read_not_assumed() {
        let probe = AcpProbe {
            agent_capabilities: json!({
                "loadSession": true,
                "promptCapabilities": { "embeddedContext": true, "image": true }
            }),
            ..Default::default()
        };
        assert!(probe.supports_load_session());
        assert_eq!(probe.supports_attachments(), Some(true));

        // No capability block at all → unknown, not false.
        let silent = AcpProbe::default();
        assert!(!silent.supports_load_session());
        assert_eq!(silent.supports_attachments(), None);
    }

    /// Real `session/new` error responses from two installed agents. The
    /// agent's own wording is the useful part and must be preserved verbatim.
    #[test]
    fn session_errors_are_captured_verbatim() {
        let cases = [
            "Authentication required: Auggie does not currently support authenticating over ACP. Please run `auggie login` from your terminal then try again.",
            "This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google",
        ];
        for message in cases {
            let response = json!({
                "jsonrpc": "2.0",
                "id": 2,
                "error": { "code": -32000, "message": message }
            });
            assert_eq!(
                interpret_response(&response, 2),
                Some(Err(Some(message.to_string()))),
                "the agent's explanation must survive unedited"
            );
        }
    }

    #[test]
    fn native_options_suppress_harness_twins() {
        use crate::providers::{ConfigMutability, ConfigOption, ConfigOptionType};
        let native = |id: &str| ConfigOption {
            id: id.to_string(),
            name: id.to_string(),
            category: None,
            option_type: ConfigOptionType::Select,
            current_value: None,
            choices: vec![],
            allows_custom_value: true,
            mutability: ConfigMutability::Live,
        };
        let options = vec![native("thinking"), native("max_tokens")];
        assert!(has_option_like(&options, &["effort", "thinking", "reasoning"]));
        assert!(has_option_like(&options, &["max_tokens", "max_output_tokens"]));
        assert!(!has_option_like(&options, &["context_window", "context"]));
        assert!(!has_option_like(&[], &["effort"]));
    }

    #[test]
    fn interpret_response_ignores_other_traffic() {
        // A notification (no id) is not our answer.
        let notification = json!({ "jsonrpc": "2.0", "method": "session/update", "params": {} });
        assert_eq!(interpret_response(&notification, 2), None);

        // Another request's response is not ours either.
        let other = json!({ "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": 1 } });
        assert_eq!(interpret_response(&other, 2), None);

        // Ours, successful.
        let ours = json!({ "jsonrpc": "2.0", "id": 2, "result": { "sessionId": "s" } });
        assert_eq!(
            interpret_response(&ours, 2),
            Some(Ok(json!({ "sessionId": "s" })))
        );
    }
}

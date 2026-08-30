//! Headless runner + eval harness (`agentdeck run`, `agentdeck eval`).
//!
//! Both commands drive the real daemon through the same path the dashboard
//! uses — create a session with the prompt (which spawns the agent and starts
//! the turn), then poll the canonical-log-backed transcripts endpoint until
//! `agent_completed` lands. Evals therefore measure the actual harness:
//! context assembly, trajectory recording, completion contract — not a mock.

use serde::Deserialize;
use serde_json::Value;
use std::error::Error;
use std::time::{Duration, Instant};

const DAEMON: &str = "http://localhost:9120";
const POLL_INTERVAL: Duration = Duration::from_millis(500);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, serde::Serialize)]
pub struct RunResult {
    pub agent: String,
    pub session_id: String,
    pub completed: bool,
    pub error: Option<String>,
    pub reply: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
    pub event_count: usize,
}

#[derive(Debug, Deserialize)]
pub struct EvalTask {
    pub name: String,
    pub prompt: String,
    /// Optional substring the reply must contain to pass.
    #[serde(default)]
    pub expect: Option<String>,
}

/// Run one headless turn against the daemon and wait for completion.
pub async fn run_headless(
    agent: &str,
    prompt: &str,
    project: Option<&str>,
    timeout: Duration,
    eval_mode: bool,
) -> Result<RunResult, Box<dyn Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let mut body = serde_json::json!({
        "agent": agent,
        "project": project,
        "prompt": prompt,
        "name": "eval-run",
    });
    if eval_mode {
        // Eval determinism: the harness swaps in its eval instruction set.
        body["mode"] = serde_json::json!("eval");
    }
    let created: Value = client
        .post(format!("{DAEMON}/api/sessions"))
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    let session_id = created
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| -> Box<dyn Error + Send + Sync> { format!("session create failed: {created}").into() })?
        .to_string();

    let started = Instant::now();
    loop {
        if started.elapsed() > timeout {
            return Ok(RunResult {
                agent: agent.to_string(),
                session_id,
                completed: false,
                error: Some("timeout waiting for agent_completed".to_string()),
                reply: String::new(),
                input_tokens: None,
                output_tokens: None,
                cost_usd: None,
                duration_ms: None,
                event_count: 0,
            });
        }
        let data: Value = client
            .get(format!("{DAEMON}/api/sessions/{session_id}/transcripts"))
            .send()
            .await?
            .json()
            .await?;
        let events = data.get("events").and_then(Value::as_array).cloned().unwrap_or_default();

        // The canonical log is the wire-ordered source; the last completion
        // wins. Assistant text is delta-joined in arrival order.
        let mut reply = String::new();
        let mut completed_payload: Option<&Value> = None;
        let mut error_payload: Option<&Value> = None;
        for event in &events {
            match event.get("kind").and_then(Value::as_str) {
                Some("assistant_text") => {
                    if let Some(text) = event.pointer("/payload/text").and_then(Value::as_str) {
                        reply.push_str(text);
                    }
                }
                Some("agent_completed") => completed_payload = Some(event),
                Some("agent_error") => error_payload = Some(event),
                _ => {}
            }
        }

        let mut result = RunResult {
            agent: agent.to_string(),
            session_id: session_id.clone(),
            completed: false,
            error: None,
            reply: reply.trim().to_string(),
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            duration_ms: None,
            event_count: events.len(),
        };

        if let Some(payload) = completed_payload {
            result.completed = true;
            result.input_tokens = payload
                .pointer("/payload/input_tokens")
                .and_then(Value::as_u64);
            result.output_tokens = payload
                .pointer("/payload/output_tokens")
                .and_then(Value::as_u64);
            result.cost_usd = payload.pointer("/payload/cost_usd").and_then(Value::as_f64);
            result.duration_ms = payload
                .pointer("/payload/duration_ms")
                .and_then(Value::as_u64);
            return Ok(result);
        }
        if let Some(payload) = error_payload {
            result.completed = false;
            result.error = payload
                .pointer("/payload/message")
                .and_then(Value::as_str)
                .map(str::to_string);
            return Ok(result);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Run a suite of tasks across a list of agents and print a table (or JSON).
pub async fn run_eval(
    suite_path: &std::path::Path,
    agents: &[String],
    project: Option<&str>,
    json: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let raw = tokio::fs::read_to_string(suite_path).await?;
    let tasks: Vec<EvalTask> = serde_json::from_str(&raw)?;
    if tasks.is_empty() {
        return Err(Box::<dyn Error + Send + Sync>::from("suite has no tasks"));
    }

    let mut rows: Vec<(String, String, RunResult, bool)> = Vec::new();
    for task in &tasks {
        for agent in agents {
            let result = run_headless(agent, &task.prompt, project, DEFAULT_TIMEOUT, true).await?;
            let pass = result.completed
                && task
                    .expect
                    .as_ref()
                    .map(|needle| result.reply.contains(needle))
                    .unwrap_or(true);
            rows.push((task.name.clone(), agent.clone(), result, pass));
        }
    }

    if json {
        let out: Vec<Value> = rows
            .iter()
            .map(|(name, agent, result, pass)| {
                serde_json::json!({
                    "task": name,
                    "agent": agent,
                    "pass": pass,
                    "completed": result.completed,
                    "reply": result.reply,
                    "error": result.error,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "cost_usd": result.cost_usd,
                    "duration_ms": result.duration_ms,
                    "events": result.event_count,
                    "session_id": result.session_id,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&out)?);
        return Ok(());
    }

    // Table.
    println!(
        "{:<28} {:<12} {:<6} {:<9} {:<10} {:<10} {:<8} reply",
        "task", "agent", "pass", "completed", "tokens", "ms", "events"
    );
    for (name, agent, result, pass) in &rows {
        let tokens = match (result.input_tokens, result.output_tokens) {
            (Some(i), Some(o)) => format!("{i}/{o}"),
            _ => "-".to_string(),
        };
        let ms = result.duration_ms.map(|d| d.to_string()).unwrap_or_else(|| "-".to_string());
        println!(
            "{:<28} {:<12} {:<6} {:<9} {:<10} {:<10} {:<8} {}",
            name,
            agent,
            if *pass { "PASS" } else { "FAIL" },
            result.completed,
            tokens,
            ms,
            result.event_count,
            result.reply.chars().take(40).collect::<String>(),
        );
    }
    let passed = rows.iter().filter(|(_, _, _, pass)| *pass).count();
    println!("\n{passed}/{} passed", rows.len());
    Ok(())
}

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
    /// Ordered event-kind sequence for trajectory comparison (bounded).
    pub event_kinds: Vec<String>,
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
                event_kinds: Vec::new(),
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
        // wins. Assistant text is delta-joined in arrival order, then cleaned:
        // custom providers may emit tool-call markup as text (e.g.
        // <antml:invoke>), which is never executed and must not pollute the
        // answer the benchmark compares.
        let mut reply = String::new();
        let mut completed_payload: Option<&Value> = None;
        let mut error_payload: Option<&Value> = None;
        let mut usage_input: Option<u64> = None;
        let mut usage_output: Option<u64> = None;
        let mut first_ts: Option<String> = None;
        let mut last_ts: Option<String> = None;
        for event in &events {
            let ts = event.get("timestamp").and_then(Value::as_str).map(str::to_string);
            if first_ts.is_none() { first_ts = ts.clone(); }
            if ts.is_some() { last_ts = ts; }
            match event.get("kind").and_then(Value::as_str) {
                Some("assistant_text") => {
                    if let Some(text) = event.pointer("/payload/text").and_then(Value::as_str) {
                        reply.push_str(text);
                    }
                }
                Some("usage") => {
                    // API providers report usage as separate events, not in
                    // agent_completed — capture them as the fallback.
                    usage_input = event.pointer("/payload/input_tokens").and_then(Value::as_u64).or(usage_input);
                    usage_output = event.pointer("/payload/output_tokens").and_then(Value::as_u64).or(usage_output);
                }
                Some("agent_completed") => completed_payload = Some(event),
                Some("agent_error") => error_payload = Some(event),
                _ => {}
            }
        }
        let cleaned = strip_tool_call_markup(&reply);

        let mut result = RunResult {
            agent: agent.to_string(),
            session_id: session_id.clone(),
            completed: false,
            error: None,
            reply: cleaned.trim().to_string(),
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            duration_ms: None,
            event_count: events.len(),
            event_kinds: events
                .iter()
                .filter_map(|e| e.get("kind").and_then(Value::as_str).map(str::to_string))
                .take(200)
                .collect(),
        };

        if let Some(payload) = completed_payload {
            result.completed = true;
            result.input_tokens = payload
                .pointer("/payload/input_tokens")
                .and_then(Value::as_u64)
                .or(usage_input);
            result.output_tokens = payload
                .pointer("/payload/output_tokens")
                .and_then(Value::as_u64)
                .or(usage_output);
            result.cost_usd = payload.pointer("/payload/cost_usd").and_then(Value::as_f64);
            result.duration_ms = payload
                .pointer("/payload/duration_ms")
                .and_then(Value::as_u64)
                .or_else(|| duration_ms(&first_ts, &last_ts));
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

/// Remove tool-call markup a model may emit as literal text (Anthropic's
/// `<antml:invoke>…</antml:invoke>`, OpenAI-style `<tool_calls>…</tool_calls>`),
/// which the harness does not execute on custom transports.
fn strip_tool_call_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let patterns: &[(&str, &str)] = &[
        ("<antml:invoke", "</antml:invoke>"),
        ("<antml:parameter", ">"),
        ("</antml:parameter>", "</antml:parameter>"),
        ("<tool_calls>", "</tool_calls>"),
    ];
    while !rest.is_empty() {
        // Find the earliest opening marker.
        let mut earliest: Option<(usize, &(&str, &str))> = None;
        for p in patterns {
            if let Some(idx) = rest.find(p.0) {
                if earliest.map(|(e, _)| idx < e).unwrap_or(true) {
                    earliest = Some((idx, p));
                }
            }
        }
        let Some((idx, (_, close))) = earliest else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..idx]);
        rest = &rest[idx..];
        // Skip to the matching close marker.
        if let Some(end) = rest.find(close) {
            rest = &rest[end + close.len()..];
        } else {
            // Unterminated block: drop the remainder.
            rest = "";
        }
    }
    out
}

/// Approximate wall time from the first/last event timestamps when the
/// completion payload carries no duration.
fn duration_ms(first: &Option<String>, last: &Option<String>) -> Option<u64> {
    let (Some(first), Some(last)) = (first, last) else {
        return None;
    };
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis());
    match (parse(first), parse(last)) {
        (Some(a), Some(b)) if b >= a => Some((b - a) as u64),
        _ => None,
    }
}

/// Normalized Levenshtein similarity between two bounded kind sequences.
fn sequence_similarity(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let n = a.len();
    let m = b.len();
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0usize; m + 1];
    for i in 1..=n {
        curr[0] = i;
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    let max = n.max(m) as f64;
    1.0 - (prev[m] as f64 / max)
}

/// Print a trajectory-diff block: per task, pairwise agent similarity plus the
/// kinds that differ.
fn print_trajectory_diff(rows: &[(String, String, RunResult, bool)]) {
    println!();
    println!("trajectory diff (event-kind sequences)");
    // Group by task name.
    let mut by_task: std::collections::BTreeMap<&str, Vec<(&str, &RunResult)>> = Default::default();
    for (task, agent, result, _) in rows {
        by_task.entry(task.as_str()).or_default().push((agent.as_str(), result));
    }
    for (task, runs) in &by_task {
        if runs.len() < 2 {
            continue;
        }
        for i in 0..runs.len() {
            for j in (i + 1)..runs.len() {
                let (a_name, a) = runs[i];
                let (b_name, b) = runs[j];
                let seq = sequence_similarity(&a.event_kinds, &b.event_kinds);
                let a_set: std::collections::HashSet<&str> = a.event_kinds.iter().map(|s| s.as_str()).collect();
                let b_set: std::collections::HashSet<&str> = b.event_kinds.iter().map(|s| s.as_str()).collect();
                let only_a: Vec<&str> = a_set.difference(&b_set).copied().collect();
                let only_b: Vec<&str> = b_set.difference(&a_set).copied().collect();
                println!(
                    "  {task}: {a_name} vs {b_name}  sequence={seq:.2}  events {} vs {}",
                    a.event_kinds.len(),
                    b.event_kinds.len()
                );
                if !only_a.is_empty() || !only_b.is_empty() {
                    println!("      only {a_name}: {:?} | only {b_name}: {:?}", only_a, only_b);
                }
            }
        }
    }
}

/// Run a suite of tasks across a list of agents and print a table (or JSON).
pub async fn run_eval(
    suite_path: &std::path::Path,
    agents: &[String],
    project: Option<&str>,
    json: bool,
    diff: bool,
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
    if diff {
        print_trajectory_diff(&rows);
    }
    let passed = rows.iter().filter(|(_, _, _, pass)| *pass).count();
    println!("\n{passed}/{} passed", rows.len());
    let failed = rows.len() - passed;
    if failed > 0 {
        // CI gate: any failure makes the command exit non-zero.
        return Err(format!("{failed} task(s) failed").into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_similarity_is_normalized() {
        let a = vec!["thinking".to_string(), "text".to_string(), "done".to_string()];
        let b = vec!["thinking".to_string(), "text".to_string(), "done".to_string()];
        assert!((sequence_similarity(&a, &b) - 1.0).abs() < 1e-9);

        let c = vec!["thinking".to_string(), "tool".to_string(), "tool".to_string(), "done".to_string()];
        let sim = sequence_similarity(&a, &c);
        assert!(sim > 0.0 && sim < 1.0);

        assert!((sequence_similarity(&a, &[] as &[String]) - 0.0).abs() < 1e-9);
        assert!((sequence_similarity(&[] as &[String], &[] as &[String]) - 1.0).abs() < 1e-9);
    }
}

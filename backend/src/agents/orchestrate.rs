//! Multi-agent orchestration: fan a task out to several agents, then merge.
//!
//! Subagents existed but were one-level and single-shot: one child per HTTP
//! call, no merging, no cancellation. This module is the harness-owned
//! orchestration primitive the spec calls for — "split this task across
//! agentrouter + claude + opencode and merge":
//!
//! - [`run_child`] spawns ONE bounded worker (subagent instructions, linked to
//!   its parent) and runs it to completion — or to its budget, its timeout, or
//!   its parent's death, whichever comes first.
//! - [`fan_out`] runs N of those concurrently, one per agent.
//! - [`orchestrate`] ties it together: fan out, then (unless `merge: false`)
//!   spawn one merge step whose prompt carries every child's answer, and
//!   return the synthesized reply.
//!
//! Everything is event-driven on the parent's timeline (`orchestration_started`,
//! per-child `subagent_started`/`subagent_finished`, `orchestration_finished`),
//! so the dashboard renders the fan-out with the same cards it already had.
//! The `Dispatch` tool (api_tools) exposes the same primitive to API-provider
//! agents, letting a model decompose and delegate on its own.

use crate::agent_events::AgentEvent;
use crate::config::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

/// Wall-clock budget for one child before the harness gives up on it.
pub const DEFAULT_CHILD_TIMEOUT_SECS: u64 = 300;

/// How one fan-out child ended.
#[derive(Debug, Clone)]
pub struct ChildOutcome {
    pub agent: String,
    pub session_id: String,
    pub reply: String,
    /// `completed` | `failed` | `cancelled` | `timeout`
    pub status: String,
    pub error: Option<String>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
}

impl ChildOutcome {
    pub fn to_json(&self) -> Value {
        json!({
            "agent": self.agent,
            "session_id": self.session_id,
            "reply": self.reply,
            "status": self.status,
            "error": self.error,
            "cost_usd": self.cost_usd,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "duration_ms": self.duration_ms,
        })
    }
}

/// The prompt handed to the merge step: every child's answer, labeled by
/// agent, failures included — the merge agent must know who said what and who
/// never answered.
pub fn merge_prompt(task: &str, outcomes: &[ChildOutcome]) -> String {
    let count = outcomes.len();
    let mut sections = String::new();
    for (index, outcome) in outcomes.iter().enumerate() {
        sections.push_str(&format!("\n## Answer {} — {agent}\n", index + 1, agent = outcome.agent));
        match outcome.status.as_str() {
            "completed" => {
                let reply = if outcome.reply.trim().is_empty() {
                    "(no text output)"
                } else {
                    outcome.reply.trim()
                };
                sections.push_str(reply);
                sections.push('\n');
            }
            other => {
                sections.push_str(&format!(
                    "(this agent did not finish — status: {other}, error: {})\n",
                    outcome.error.as_deref().unwrap_or("none")
                ));
            }
        }
    }
    format!(
        "You are the MERGE step of a multi-agent run. The original task was:\n\n\
         <task>\n{task}\n</task>\n\n\
         {count} agents worked on that task in parallel. Their answers follow, \
         labeled by agent.\n{sections}\n\
         Synthesize ONE final answer to the task for the user: combine the \
         strongest parts of each answer, resolve contradictions in favor of \
         whatever is backed by evidence or tool output, and briefly note any \
         agent that failed or disagreed. Do not mention session ids or this \
         merge process — just deliver the answer."
    )
}

/// Spawn one child session and run it to a terminal state. Emits
/// `subagent_started` / `subagent_finished` on the parent's timeline and
/// returns the outcome. Never panics; every failure mode is an outcome.
pub async fn run_child(
    state: &AppState,
    parent_id: &str,
    name: &str,
    agent: &str,
    prompt: &str,
    budget_usd: Option<f64>,
    timeout: Duration,
) -> ChildOutcome {
    let mut outcome = ChildOutcome {
        agent: agent.to_string(),
        session_id: String::new(),
        reply: String::new(),
        status: "failed".to_string(),
        error: None,
        cost_usd: None,
        input_tokens: None,
        output_tokens: None,
        duration_ms: None,
    };

    let Some(parent) = state.session_manager.get_session(parent_id).await.ok().flatten() else {
        outcome.error = Some("parent session not found".to_string());
        return outcome;
    };

    // Subscribe before spawning so no child event is missed.
    let mut rx = state.broadcast.subscribe();

    // Bounded workers: subagent instructions, parent link (cancellation
    // cascade), and the subagent flag that removes Dispatch from the child's
    // own tool set so fan-out cannot recurse.
    let child_body = json!({
        "instructions": crate::prompts::subagent_prompt(),
        "parent_id": parent_id,
        "subagent": true,
    });

    // Boxed: this call closes an async cycle (spawn → turn → tool →
    // orchestrate → spawn), and a recursive async fn needs indirection to
    // keep its future a finite size.
    let child = match Box::pin(crate::api::routes::spawn_session(
        state,
        name,
        agent,
        parent.project.as_deref(),
        Some(prompt),
        &child_body,
    ))
    .await
    {
        Ok(child) => child,
        Err(error) => {
            outcome.error = Some(error);
            return outcome;
        }
    };
    outcome.session_id = child.id.clone();

    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "subagent_started",
        json!({ "id": child.id, "name": agent, "status": "running" }),
    ));

    let deadline = tokio::time::Instant::now() + timeout;
    let mut reply = String::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let recv = match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(recv) => recv,
            Err(_) => {
                stop_child(state, &child).await;
                outcome.status = "timeout".to_string();
                outcome.error = Some("timed out".to_string());
                break;
            }
        };
        let Ok(frame) = recv else { break };
        let crate::websocket::WsMessage::AgentEvent { event } = frame.message else { continue };

        // Parent died while this child was running: propagate the
        // cancellation instead of orphaning a running agent.
        if event.session_id == parent_id && event.kind == "session_killed" {
            stop_child(state, &child).await;
            outcome.status = "cancelled".to_string();
            outcome.error = Some("parent session was killed".to_string());
            break;
        }

        if event.session_id != child.id {
            continue;
        }
        match event.kind.as_str() {
            "assistant_text" => {
                if let Some(text) = event.payload.get("text").and_then(|v| v.as_str()) {
                    reply.push_str(text);
                }
            }
            "agent_completed" => {
                outcome.input_tokens = event.payload.get("input_tokens").and_then(|v| v.as_u64());
                outcome.output_tokens = event.payload.get("output_tokens").and_then(|v| v.as_u64());
                outcome.cost_usd = event.payload.get("cost_usd").and_then(|v| v.as_f64());
                outcome.duration_ms = event.payload.get("duration_ms").and_then(|v| v.as_u64());
                // Budget enforcement: over the limit, the child is stopped and
                // the run marked failed rather than silently truncated.
                if let Some(limit) = budget_usd
                    && let Some(cost) = outcome.cost_usd
                    && cost > limit
                {
                    stop_child(state, &child).await;
                    outcome.status = "failed".to_string();
                    outcome.error = Some("budget exceeded".to_string());
                    break;
                }
                outcome.status = "completed".to_string();
                break;
            }
            "agent_error" => {
                outcome.status = "failed".to_string();
                outcome.error = Some(
                    event
                        .payload
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("subagent failed")
                        .to_string(),
                );
                break;
            }
            _ => {}
        }
    }

    outcome.reply = reply.trim().to_string();
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "subagent_finished",
        json!({ "id": child.id, "name": agent, "status": outcome.status }),
    ));
    outcome
}

/// Best-effort stop of a child session through whichever transport runs it.
async fn stop_child(state: &AppState, child: &crate::sessions::Session) {
    if let Some(turn) = crate::agents::harness::resolve_turn(state, child).await {
        let _ = turn.stop(state, &child.id).await;
    }
    let _ = state.pty_manager.kill_session(&child.id).await;
    let _ = state.acp_manager.kill_session(&child.id).await;
    let _ = state.claude_stream.kill_session(&child.id).await;
    let _ = state
        .session_manager
        .update_status(&child.id, crate::sessions::SessionStatus::Exited)
        .await;
}

/// Fan one prompt out to several agents concurrently. Returns one outcome per
/// requested agent, in request order.
pub async fn fan_out(
    state: &AppState,
    parent_id: &str,
    prompt: &str,
    agents: &[String],
    budget_usd: Option<f64>,
    timeout: Duration,
) -> Vec<ChildOutcome> {
    // Children are I/O-bound (streaming from their agent), so join_all drives
    // them concurrently on this task without owning state — no Arc clones,
    // and a panicking child would surface here instead of vanishing.
    let futures = agents.iter().map(|agent| {
        let name = format!("orchestrate-{agent}");
        let agent = agent.clone();
        async move { run_child(state, parent_id, &name, &agent, prompt, budget_usd, timeout).await }
    });
    futures_util::future::join_all(futures).await
}

/// The full orchestration flow behind `POST /api/sessions/{id}/orchestrate`
/// and the `Dispatch` tool.
///
/// Body: `{ prompt: string, agents: string[], merge?: bool (default true),
/// merge_agent?: string (default: the parent's agent), max_cost_usd?: number,
/// timeout_secs?: number }`.
///
/// Emits `orchestration_started` → per-child subagent cards →
/// `orchestration_finished` on the parent timeline and returns the run as
/// JSON (including the merged reply when merging).
pub async fn orchestrate(state: &AppState, parent_id: &str, body: &Value) -> Value {
    let Some(prompt) = body.get("prompt").and_then(|v| v.as_str()).filter(|p| !p.trim().is_empty())
    else {
        return json!({ "error": "prompt is required", "status": "error" });
    };
    let agents: Vec<String> = body
        .get("agents")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str())
                .map(str::to_string)
                .filter(|a| !a.trim().is_empty())
                .collect()
        })
        .unwrap_or_default();
    if agents.is_empty() {
        return json!({ "error": "agents must be a non-empty list of agent ids", "status": "error" });
    }
    let merge = body.get("merge").and_then(|v| v.as_bool()).unwrap_or(true);
    let budget_usd = body.get("max_cost_usd").and_then(|v| v.as_f64());
    let timeout = Duration::from_secs(
        body.get("timeout_secs")
            .and_then(|v| v.as_u64())
            .filter(|s| *s > 0)
            .unwrap_or(DEFAULT_CHILD_TIMEOUT_SECS),
    );

    let parent_agent = state
        .session_manager
        .get_session(parent_id)
        .await
        .ok()
        .flatten()
        .map(|s| s.agent)
        .unwrap_or_else(|| agents[0].clone());
    let merge_agent = body
        .get("merge_agent")
        .and_then(|v| v.as_str())
        .unwrap_or(&parent_agent)
        .to_string();

    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "orchestration_started",
        json!({
            "agents": agents,
            "merge": merge,
            "merge_agent": if merge { Some(merge_agent.clone()) } else { None },
        }),
    ));

    let outcomes = fan_out(state, parent_id, prompt, &agents, budget_usd, timeout).await;

    // Merge step: one more bounded child, fed every answer, whose reply is the
    // run's synthesized result. Skipped when the caller asked for raw results
    // or when nothing succeeded — there is nothing to synthesize.
    let any_completed = outcomes.iter().any(|o| o.status == "completed");
    let merge_outcome = if merge && any_completed {
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            parent_id,
            "merge_started",
            json!({ "agent": merge_agent }),
        ));
        Some(
            run_child(
                state,
                parent_id,
                &format!("merge-{merge_agent}"),
                &merge_agent,
                &merge_prompt(prompt, &outcomes),
                budget_usd,
                timeout,
            )
            .await,
        )
    } else {
        None
    };

    let merged_reply = merge_outcome
        .as_ref()
        .map(|o| o.reply.clone())
        .unwrap_or_default();
    let children_json: Vec<Value> = outcomes.iter().map(|o| o.to_json()).collect();

    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "orchestration_finished",
        json!({
            "agents": agents,
            "merged": merge_outcome.is_some(),
            "merge_status": merge_outcome.as_ref().map(|o| o.status.clone()),
            "reply": merged_reply,
            "children": children_json,
        }),
    ));

    let mut result = json!({
        "prompt": prompt,
        "children": children_json,
        "merged": merge_outcome.is_some(),
        "merged_reply": merged_reply,
    });
    if let Some(outcome) = merge_outcome {
        result["merge"] = outcome.to_json();
    }
    result
}

/// Cancel every unfinished child of `parent_id` — the cascade half of
/// parent→child cancel propagation. Called when a session is killed; the
/// `session_killed` event (broadcast by the killer) already unblocks any
/// in-flight orchestration loops, this makes sure the agents actually stop.
pub async fn cancel_children(state: &AppState, parent_id: &str) {
    let Ok(children) = state.session_manager.child_sessions(parent_id).await else {
        return;
    };
    for child in children {
        stop_child(state, &child).await;
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            parent_id,
            "subagent_finished",
            json!({ "id": child.id, "name": child.agent, "status": "cancelled", "reason": "parent killed" }),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(agent: &str, status: &str, reply: &str) -> ChildOutcome {
        ChildOutcome {
            agent: agent.to_string(),
            session_id: format!("sess-{agent}"),
            reply: reply.to_string(),
            status: status.to_string(),
            error: None,
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            duration_ms: None,
        }
    }

    #[test]
    fn merge_prompt_carries_every_answer_labeled_by_agent() {
        let outcomes = vec![
            outcome("agentrouter", "completed", "Use pytest."),
            outcome("claude", "completed", "Use cargo test."),
        ];
        let prompt = merge_prompt("how should we test this project?", &outcomes);
        assert!(prompt.contains("how should we test this project?"));
        assert!(prompt.contains("Answer 1 — agentrouter"));
        assert!(prompt.contains("Use pytest."));
        assert!(prompt.contains("Answer 2 — claude"));
        assert!(prompt.contains("Use cargo test."));
        assert!(prompt.contains("Synthesize ONE final answer"));
    }

    #[test]
    fn merge_prompt_marks_failed_children_instead_of_hiding_them() {
        let outcomes = vec![
            outcome("claude", "completed", "the answer"),
            ChildOutcome {
                agent: "opencode".to_string(),
                session_id: "sess-opencode".to_string(),
                reply: String::new(),
                status: "failed".to_string(),
                error: Some("401 unauthorized".to_string()),
                input_tokens: None,
                output_tokens: None,
                cost_usd: None,
                duration_ms: None,
            },
        ];
        let prompt = merge_prompt("task", &outcomes);
        assert!(prompt.contains("status: failed"));
        assert!(prompt.contains("401 unauthorized"));
        assert!(prompt.contains("the answer"));
    }

    #[test]
    fn empty_child_reply_is_visible_not_silent() {
        let outcomes = vec![outcome("claude", "completed", "  ")];
        let prompt = merge_prompt("task", &outcomes);
        assert!(prompt.contains("(no text output)"));
    }
}

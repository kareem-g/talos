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

/// Room identity threaded through a fan-out run. When present, every worker
/// is prompted as a member of this Room (peers + Chief of Staff) and the
/// run's outcome is distilled into the room's own memory store, separate from
/// workspace memory.
#[derive(Debug, Clone, Default)]
pub struct RoomContext {
    pub id: String,
    pub name: String,
    /// The worker designated Chief of Staff: it leads the merge step and is
    /// introduced as the team's lead in every worker's prompt.
    pub chief: Option<String>,
    /// The full worker roster for this run, in request order.
    pub workers: Vec<String>,
}

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
    model: Option<&str>,
    room: Option<&RoomContext>,
) -> ChildOutcome {
    // Bounded workers: subagent instructions (plus Room awareness when the
    // run belongs to a Room — who the worker is, its peers, its chief), the
    // parent link (cancellation cascade), and the subagent flag that removes
    // Dispatch from the child's own tool set so fan-out cannot recurse.
    // `model` pins the child to the parent's model so a run keeps one
    // configuration; `hidden` keeps it out of the workspace session lists.
    let instructions = match room {
        Some(room) => {
            let peers: Vec<String> = room
                .workers
                .iter()
                .filter(|worker| worker.as_str() != name)
                .cloned()
                .collect();
            format!(
                "{}\n\n{}",
                crate::prompts::subagent_prompt(),
                crate::prompts::room_worker_section(
                    &room.name,
                    name,
                    &peers,
                    room.chief.as_deref(),
                )
            )
        }
        None => crate::prompts::subagent_prompt(),
    };
    let mut child_body = json!({
        "instructions": instructions,
        "parent_id": parent_id,
        "subagent": true,
        "hidden": true,
    });
    if let Some(model) = model {
        child_body["model"] = Value::String(model.to_string());
    }
    spawn_and_await_child(state, parent_id, name, agent, prompt, budget_usd, timeout, child_body).await
}

/// Spawn one child with a fully pre-built create body and run it to a
/// terminal state (completion, failure, budget, timeout, or parent death).
/// The room-aware [`run_child`] and the Chief-of-Staff merge step both come
/// through here; only the body differs.
async fn spawn_and_await_child(
    state: &AppState,
    parent_id: &str,
    name: &str,
    agent: &str,
    prompt: &str,
    budget_usd: Option<f64>,
    timeout: Duration,
    child_body: Value,
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

    // Workers run under their parent's permission mode. Without this a child
    // defaults to "ask" and strands hidden room workers behind approval cards
    // nobody can see — "same configuration as the session" includes this.
    let mut child_body = child_body;
    if child_body.get("permission_mode").is_none()
        && let Ok(pending) = state.session_manager.pending_config(parent_id).await
        && let Some((_, mode)) = pending.iter().find(|(k, _)| k == "permission_mode")
    {
        child_body["permission_mode"] = Value::String(mode.clone());
    }

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
async fn stop_child(state: &AppState, child: &crate::sessions::Session) {    if let Some(turn) = crate::agents::harness::resolve_turn(state, child).await {
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
/// requested agent, in request order. `names` optionally labels each child's
/// session row (same length as `agents`); missing entries fall back to
/// `orchestrate-{agent}`, de-duplicated when one agent id repeats.
pub async fn fan_out(
    state: &AppState,
    parent_id: &str,
    prompt: &str,
    agents: &[String],
    names: &[String],
    budget_usd: Option<f64>,
    timeout: Duration,
    model: Option<&str>,
    room: Option<&RoomContext>,
) -> Vec<ChildOutcome> {
    // Children are I/O-bound (streaming from their agent), so join_all drives
    // them concurrently on this task without owning state — no Arc clones,
    // and a panicking child would surface here instead of vanishing.
    let mut used = std::collections::HashSet::new();
    let child_names: Vec<String> = agents
        .iter()
        .enumerate()
        .map(|(index, agent)| {
            names
                .get(index)
                .map(|n| n.trim())
                .filter(|n| !n.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    let mut name = format!("orchestrate-{agent}");
                    while !used.insert(name.clone()) {
                        name.push_str("-2");
                    }
                    name
                })
        })
        .collect();
    let futures = agents.iter().zip(child_names).map(|(agent, name)| {
        let agent = agent.clone();
        async move {
            run_child(
                state,
                parent_id,
                &name,
                &agent,
                prompt,
                budget_usd,
                timeout,
                model,
                room,
            )
            .await
        }
    });
    futures_util::future::join_all(futures).await
}

/// The full orchestration flow behind `POST /api/sessions/{id}/orchestrate`
/// and the `Dispatch` tool.
///
/// Body: `{ prompt: string, agents?: string[], merge?: bool (default true),
/// merge_agent?: string (default: the parent's agent), max_cost_usd?: number,
/// timeout_secs?: number, names?: string[],
/// room?: { id, name, chief? } }`.
///
/// When `agents` is omitted the run fans out to one child **per worker named
/// in the parent's own roster** — the child always inherits the parent's agent
/// id and model, so a room is a set of workers over one configuration rather
/// than a mix of CLIs. Created sessions are hidden from the workspace session
/// list (still fully visible in the room/session views).
///
/// With `room` present the run is Room-aware: each worker is prompted as a
/// member of the Room (peers + Chief of Staff), the merge step is led by the
/// chief when one is designated, prior room memories relevant to the task are
/// recalled into the workers' context, and the run's outcome is distilled
/// into the room's own memory store (gated by the workspace memory toggle).
///
/// Emits `orchestration_started` → per-child subagent cards →
/// `orchestration_finished` on the parent timeline and returns the run as
/// JSON (including the merged reply when merging).
pub async fn orchestrate(state: &AppState, parent_id: &str, body: &Value) -> Value {
    let Some(prompt) = body.get("prompt").and_then(|v| v.as_str()).filter(|p| !p.trim().is_empty())
    else {
        return json!({ "error": "prompt is required", "status": "error" });
    };
    let parent = state
        .session_manager
        .get_session(parent_id)
        .await
        .ok()
        .flatten();
    let parent_agent = parent
        .as_ref()
        .map(|s| s.agent.clone())
        .unwrap_or_default();

    // Roster-driven default: with no explicit `agents`, the run spawns ONE
    // child per this session's own configuration, named after it — "dispatch
    // this work in a worker like me". The Dispatch tool's decomposition path
    // passes `agents` and wins over this default.
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
        .filter(|list: &Vec<String>| !list.is_empty())
        .unwrap_or_else(|| vec![parent_agent.clone()]);
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

    let merge_agent = body
        .get("merge_agent")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or(parent_agent);

    // Children inherit the parent's model so the whole run keeps the current
    // session's configuration instead of mixing CLI defaults. A caller that
    // pins `model` explicitly (e.g. room dispatch from another session's
    // config) wins over the parent's own.
    let model = match body.get("model").and_then(|v| v.as_str()) {
        Some(m) => Some(m.to_string()),
        None => crate::agents::harness::session_model(state, parent_id).await,
    };

    let requested = body.get("names").and_then(|v| v.as_array());
    let child_names: Vec<String> = agents
        .iter()
        .enumerate()
        .map(|(index, agent)| {
            requested
                .and_then(|list| list.get(index))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{agent}-{}", index + 1))
        })
        .collect();

    // Room awareness: when the caller declares a room, thread its identity
    // (and the chief designation) through every worker, and recall the
    // room's own memory relevant to this task so the team "remembers" its
    // prior runs.
    let room: Option<RoomContext> = body.get("room").and_then(|v| v.as_object()).map(|obj| {
        let workers = child_names.clone();
        let chief = obj
            .get("chief")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|chief| workers.iter().any(|worker| worker == chief));
        RoomContext {
            id: obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            name: obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Room")
                .to_string(),
            chief,
            workers,
        }
    });
    let room_memory = room
        .as_ref()
        .filter(|room| !room.id.is_empty())
        .map(|room| {
            crate::memory::room_memory_block(
                parent.as_ref().and_then(|s| s.project.as_deref()),
                &room.id,
                prompt,
                3,
            )
        })
        .unwrap_or_default();
    // Room memory rides on the prompt (the workers' instruction set is fixed
    // at spawn; the task text is where per-run context belongs).
    let worker_prompt = if room_memory.is_empty() {
        prompt.to_string()
    } else {
        format!("{room_memory}\n\n{prompt}")
    };

    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "orchestration_started",
        json!({
            "agents": agents,
            "names": child_names,
            "merge": merge,
            "merge_agent": if merge { Some(merge_agent.clone()) } else { None },
            "room": room.as_ref().map(|room| json!({
                "id": room.id,
                "name": room.name,
                "chief": room.chief,
            })),
        }),
    ));

    let outcomes = fan_out(
        state,
        parent_id,
        &worker_prompt,
        &agents,
        &child_names,
        budget_usd,
        timeout,
        model.as_deref(),
        room.as_ref(),
    )
    .await;

    // Merge step: one more bounded child, fed every answer, whose reply is the
    // run's synthesized result. In a Room the chief of staff leads this step —
    // it is the designated worker that handles all other agents — and gets
    // the Chief of Staff instruction set instead of the plain subagent one.
    // Skipped when the caller asked for raw results or when nothing
    // succeeded — there is nothing to synthesize.
    let any_completed = outcomes.iter().any(|o| o.status == "completed");
    let chief_name = room.as_ref().and_then(|room| room.chief.clone());
    let merge_outcome = if merge && any_completed {
        let merge_display = chief_name.clone().unwrap_or_else(|| merge_agent.clone());
        let merge_name = format!("chief-{merge_display}");
        let merge_instructions = match (&room, &chief_name) {
            (Some(room), Some(chief)) => format!(
                "{}\n\n{}",
                crate::prompts::subagent_prompt(),
                crate::prompts::chief_of_staff_section(&room.name, chief, &room.workers)
            ),
            _ => crate::prompts::subagent_prompt(),
        };
        let mut merge_body = json!({
            "instructions": merge_instructions,
            "parent_id": parent_id,
            "subagent": true,
            "hidden": true,
        });
        if let Some(model) = &model {
            merge_body["model"] = Value::String(model.clone());
        }
        state.broadcast.broadcast_agent_event(AgentEvent::new(
            parent_id,
            "merge_started",
            json!({ "agent": merge_agent, "chief": chief_name }),
        ));
        Some(
            spawn_and_await_child(
                state,
                parent_id,
                &merge_name,
                &merge_agent,
                &merge_prompt(prompt, &outcomes),
                budget_usd,
                timeout,
                merge_body,
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

    // Distill the run into the room's own memory: task, per-worker outcome,
    // and the synthesized reply — the channel's recall for future dispatches.
    // Gated by the workspace memory toggle, same as convention injection.
    if let Some(room) = room.as_ref().filter(|room| !room.id.is_empty()) {
        let project = parent.as_ref().and_then(|s| s.project.as_deref());
        if crate::memory::workspace_memory_enabled(project) {
            let mut report = format!("Task: {}\n", prompt.trim());
            for outcome in &outcomes {
                report.push_str(&format!(
                    "- Worker {} ({}): {}\n",
                    outcome.agent,
                    outcome.status,
                    outcome.reply.trim().chars().take(300).collect::<String>()
                ));
            }
            if !merged_reply.trim().is_empty() {
                report.push_str(&format!(
                    "\nChief synthesis: {}",
                    merged_reply.trim().chars().take(1500).collect::<String>()
                ));
            }
            let entry = crate::memory::MemoryEntry {
                id: uuid::Uuid::new_v4().to_string(),
                title: format!(
                    "Room {} — {}",
                    room.name,
                    prompt.trim().chars().take(60).collect::<String>()
                ),
                created_at: chrono::Utc::now().to_rfc3339(),
                source_session: parent_id.to_string(),
                text: report,
                kind: "memory".to_string(),
            };
            let _ = crate::memory::save_room_memory(project, &room.id, entry);
        }
    }

    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "orchestration_finished",
        json!({
            "agents": agents,
            "names": child_names,
            "merged": merge_outcome.is_some(),
            "merge_status": merge_outcome.as_ref().map(|o| o.status.clone()),
            "chief": chief_name,
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

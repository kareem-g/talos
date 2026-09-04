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
use std::collections::HashMap;
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
    /// When true the run skips permission prompts: children spawn with
    /// `permission_mode=full` and the tool-policy gate is bypassed, so a
    /// room team runs without approval cards.
    pub skip_permissions: bool,
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
    skills: &[String],
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
            build_worker_instructions(&room.name, name, &peers, room.chief.as_deref(), skills)
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
    // Room runs that skip permissions: children auto-approve everything
    // (`permission_mode=full`) and bypass the tool-policy gate
    // (`skip_policy`), so the team runs without approval cards.
    // `room_child` marks the session for the Dispatch filter, so room
    // workers can dispatch to each other while pure subagents still cannot
    // recurse (their grandchildren carry no room mark).
    if let Some(room) = room {
        child_body["room_child"] = Value::String(room.id.clone());
        if room.skip_permissions {
            child_body["permission_mode"] = Value::String("full".to_string());
            child_body["skip_policy"] = Value::String("true".to_string());
        }
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

    // The display name (worker name when dispatched from a room), not the
    // provider id — the timeline, roster dots, and avatar lookups all key on
    // what the user calls this child.
    state.broadcast.broadcast_agent_event(AgentEvent::new(
        parent_id,
        "subagent_started",
        json!({ "id": child.id, "name": name, "agent": agent, "status": "running" }),
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
        json!({ "id": child.id, "name": name, "agent": agent, "status": outcome.status }),
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
    worker_skills: &std::collections::HashMap<String, Vec<String>>,
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
        let skills = worker_skills.get(&name).cloned().unwrap_or_default();
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
                &skills,
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
        .unwrap_or_else(|| parent_agent.clone());

    // Children inherit the parent's model so the whole run keeps the current
    // session's configuration instead of mixing CLI defaults. A caller that
    // pins `model` explicitly (e.g. room dispatch from another session's
    // config) wins over the parent's own.
    let model = match body.get("model").and_then(|v| v.as_str()) {
        Some(m) => Some(m.to_string()),
        None => crate::agents::harness::session_model(state, parent_id).await,
    };

    let requested_names = body.get("names").and_then(|v| v.as_array());

    // Room awareness: when the caller declares a room, thread its identity
    // (and the chief designation) through every worker, and recall the
    // room's own memory relevant to this task so the team "remembers" its
    // prior runs. When no room is declared but the parent IS a room channel
    // (a model-driven Dispatch from the channel agent, which only knows
    // worker names — not provider ids), adopt that room: otherwise every
    // worker-named target fails with "not configured" and the children never
    // learn who they are.
    let declared_room = body.get("room").and_then(|v| v.as_object());
    let stored_room: Option<crate::api::rooms::RoomInfo> =
        match declared_room.and_then(|obj| obj.get("id")).and_then(|v| v.as_str()) {
            Some(id) if !id.is_empty() => crate::api::rooms::find_room_by_id(state, id).await,
            _ => None,
        };
    let channel_room: Option<crate::api::rooms::RoomInfo> = if declared_room.is_some() {
        None
    } else if let Some(info) = crate::api::rooms::find_room_by_channel(state, parent_id).await {
        Some(info)
    } else {
        // Worker-to-worker dispatch: the parent is itself a room child, so
        // walk one level up — the grandparent channel owns the room.
        match parent.as_ref().and_then(|s| s.parent_id.as_deref()) {
            Some(grandparent) => crate::api::rooms::find_room_by_channel(state, grandparent).await,
            None => None,
        }
    };
    // Full identity for this run. A stored room (declared by id, or adopted
    // from the parent channel) contributes its id, name, roster, chief, and
    // permission-skip flag; a declared-but-unknown room keeps its declared
    // name/chief/skip with no roster.
    let (room_id, room_name, roster, declared_chief, skip_permissions): (
        String,
        String,
        Vec<(String, Vec<String>)>,
        Option<String>,
        bool,
    ) = match (stored_room, channel_room, declared_room) {
        (Some(info), _, _) | (None, Some(info), _) => {
            (info.id, info.name, info.roster, info.chief, info.skip_permissions)
        }
        (None, None, Some(obj)) => (
            obj.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            obj.get("name").and_then(|v| v.as_str()).unwrap_or("Room").to_string(),
            Vec::new(),
            obj.get("chief").and_then(|v| v.as_str()).map(str::to_string),
            obj.get("skipPermissions")
                .or_else(|| obj.get("skip_permissions"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        ),
        (None, None, None) => (String::new(), String::new(), Vec::new(), None, false),
    };

    // Resolve each requested target. A roster worker name (case-insensitive)
    // runs on the parent's agent with the worker's display name, roster
    // skills, and any per-run body skills — this is what makes model-driven
    // Dispatch ("agents": ["Scout"]) work from a channel that only knows
    // worker names. Anything else passes through as a provider id with the
    // caller's display name, exactly as before (unknown ids still fail
    // per-child at spawn).
    let body_skills = parse_worker_skills(body);
    let resolved = resolve_targets(&agents, requested_names, &parent_agent, &roster, &body_skills);
    let mut providers: Vec<String> = Vec::with_capacity(resolved.len());
    let mut displays: Vec<String> = Vec::with_capacity(resolved.len());
    let mut resolved_skills: HashMap<String, Vec<String>> = HashMap::new();
    for target in resolved {
        if !target.skills.is_empty() {
            resolved_skills.insert(target.display.clone(), target.skills.clone());
        }
        providers.push(target.provider);
        displays.push(target.display);
    }

    // The chief designation only counts when they actually run.
    let chief = declared_chief.filter(|chief| displays.iter().any(|display| display == chief));
    let room: Option<RoomContext> = if declared_room.is_some() || !room_id.is_empty() {
        Some(RoomContext {
            id: room_id.clone(),
            name: room_name.clone(),
            chief,
            workers: displays.clone(),
            skip_permissions,
        })
    } else {
        None
    };
    let worker_skills = resolved_skills;

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
            "agents": providers,
            "names": displays,
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
        &providers,
        &displays,
        budget_usd,
        timeout,
        model.as_deref(),
        room.as_ref(),
        &worker_skills,
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
        // The merge step is part of the run: same permission treatment as
        // the workers, and the same room mark.
        if let Some(room) = room.as_ref() {
            merge_body["room_child"] = Value::String(room.id.clone());
            if room.skip_permissions {
                merge_body["permission_mode"] = Value::String("full".to_string());
                merge_body["skip_policy"] = Value::String("true".to_string());
            }
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
            "agents": providers,
            "names": displays,
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

/// The full instruction set for one room worker: identity FIRST (name and
/// room open the set, ahead of the charter-heavy subagent prompt — small
/// models answer "who are you" from the first identity they read; burying it
/// is how workers lost track of themselves), then peers/chief, then
/// specialty skills, then the subagent working set.
fn build_worker_instructions(
    room_name: &str,
    name: &str,
    peers: &[String],
    chief: Option<&str>,
    skills: &[String],
) -> String {
    let mut instructions = format!(
        "{}\n\n{}\n\n{}",
        crate::prompts::worker_identity_block(room_name, name),
        crate::prompts::room_worker_section(room_name, name, peers, chief),
        crate::prompts::subagent_prompt(),
    );
    // Specialty skills assigned on the roster: resolve registry metadata and
    // append a skills section so the worker answers in its specialty. Unknown
    // ids are skipped (the roster may predate a registry change).
    if !skills.is_empty() {
        let mut lines = vec![
            "## Your specialty skills".to_string(),
            "You were given these skills for this team — apply them to the task \
             where relevant and say which you used:"
                .to_string(),
        ];
        for skill in skills {
            match crate::skills::find_registry_skill(skill) {
                Some(meta) => lines.push(format!("- {}: {}", meta.name, meta.description)),
                None => lines.push(format!("- {skill}")),
            }
        }
        instructions = format!("{instructions}\n\n{}", lines.join("\n"));
    }
    instructions
}

/// One resolved fan-out target: which provider to spawn, what to call the
/// child, and which specialty skills it carries.
struct ResolvedTarget {
    provider: String,
    display: String,
    skills: Vec<String>,
}

/// Resolve requested dispatch targets against the room roster. Worker names
/// match case-insensitively and run on the parent's agent; everything else
/// passes through as a provider id. Pure so the mapping is unit-testable.
fn resolve_targets(
    requested: &[String],
    names_override: Option<&Vec<Value>>,
    parent_agent: &str,
    roster: &[(String, Vec<String>)],
    body_skills: &HashMap<String, Vec<String>>,
) -> Vec<ResolvedTarget> {
    let mut targets = Vec::with_capacity(requested.len());
    for (index, req) in requested.iter().enumerate() {
        if let Some((worker, wskills)) = roster.iter().find(|(name, _)| name.eq_ignore_ascii_case(req)) {
            let mut skills = wskills.clone();
            for extra in body_skills.get(worker).or_else(|| body_skills.get(req)).into_iter().flatten() {
                if !skills.contains(extra) {
                    skills.push(extra.clone());
                }
            }
            targets.push(ResolvedTarget {
                provider: parent_agent.to_string(),
                display: worker.clone(),
                skills,
            });
        } else {
            let display = names_override
                .and_then(|list| list.get(index))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{req}-{}", index + 1));
            let skills = body_skills
                .get(req)
                .or_else(|| body_skills.get(&display))
                .cloned()
                .unwrap_or_default();
            targets.push(ResolvedTarget {
                provider: req.clone(),
                display,
                skills,
            });
        }
    }
    targets
}

/// Per-worker skill ids from an orchestrate body
/// (`worker_skills: { name: [skill_id] }`). Malformed entries degrade to
/// empty lists rather than failing the run; absent means no specialties.
fn parse_worker_skills(body: &Value) -> std::collections::HashMap<String, Vec<String>> {
    body.get("worker_skills")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .map(|(name, ids)| {
                    let list = ids
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|item| item.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    (name.clone(), list)
                })
                .collect()
        })
        .unwrap_or_default()
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
    fn worker_instructions_lead_with_identity() {
        const CHARTER_MARK: &str = "AgentDeck";
        let text = build_worker_instructions(
            "Code Crew",
            "Scout",
            &["Maven".to_string()],
            Some("Maven"),
            &["tdd".to_string()],
        );
        assert!(text.starts_with("# You are Scout"), "identity must open the set, got: {}", &text[..120.min(text.len())]);
        let identity_at = text.find("# You are Scout").unwrap();
        let charter_at = text.find(CHARTER_MARK).unwrap_or(usize::MAX);
        assert!(identity_at < charter_at, "identity must precede the charter");
        assert!(text.contains("\"Code Crew\""));
        assert!(text.contains("Maven"));
        assert!(text.contains("Test-Driven Development"));
    }

    #[test]
    fn worker_instructions_without_room_context_stay_plain() {
        let text = build_worker_instructions("Code Crew", "Scout", &[], None, &[]);
        assert!(text.starts_with("# You are Scout"));
        assert!(!text.contains("Your specialty skills"));
    }

    #[test]
    fn resolve_targets_maps_worker_names_to_parent_agent() {
        let roster = vec![
            ("Scout".to_string(), vec!["tdd".to_string()]),
            ("Maven".to_string(), vec![]),
        ];
        let body_skills: std::collections::HashMap<String, Vec<String>> =
            [("Maven".to_string(), vec!["code-review".to_string()])]
                .into_iter()
                .collect();
        let targets = resolve_targets(
            &["scout".to_string(), "claude".to_string()],
            None,
            "OmniRoute",
            &roster,
            &body_skills,
        );
        assert_eq!(targets.len(), 2);
        // Case-insensitive roster hit: parent provider, roster display name,
        // roster skills carried over.
        assert_eq!(targets[0].provider, "OmniRoute");
        assert_eq!(targets[0].display, "Scout");
        assert_eq!(targets[0].skills, vec!["tdd"]);
        // Provider id passes through with a default display name.
        assert_eq!(targets[1].provider, "claude");
        assert_eq!(targets[1].display, "claude-2");
        assert!(targets[1].skills.is_empty());
    }

    #[test]
    fn resolve_targets_merges_body_skills_and_honors_overrides() {
        let roster = vec![("Maven".to_string(), vec!["tdd".to_string()])];
        let body_skills: std::collections::HashMap<String, Vec<String>> =
            [("Maven".to_string(), vec!["code-review".to_string(), "tdd".to_string()])]
                .into_iter()
                .collect();
        let names = vec![serde_json::json!("Custom")];
        let targets = resolve_targets(
            &["MAVEN".to_string(), "opencode".to_string()],
            Some(&names),
            "OmniRoute",
            &roster,
            &body_skills,
        );
        // Roster hit wins over the names override; skills merge without dupes.
        assert_eq!(targets[0].display, "Maven");
        assert_eq!(targets[0].skills, vec!["tdd", "code-review"]);
        // Positional overrides apply per request index (index 1 has none).
        assert_eq!(targets[1].display, "opencode-2");
    }

    #[test]
    fn worker_skills_parse_name_to_id_lists() {
        let body = serde_json::json!({
            "worker_skills": {
                "Scout": ["tdd", "diagnosing-bugs"],
                "Maven": "not-a-list",
                "Sage": [],
            }
        });
        let parsed = parse_worker_skills(&body);
        assert_eq!(parsed["Scout"], vec!["tdd", "diagnosing-bugs"]);
        assert!(parsed["Maven"].is_empty());
        assert!(parsed["Sage"].is_empty());
        assert!(parse_worker_skills(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn empty_child_reply_is_visible_not_silent() {
        let outcomes = vec![outcome("claude", "completed", "  ")];
        let prompt = merge_prompt("task", &outcomes);
        assert!(prompt.contains("(no text output)"));
    }
}

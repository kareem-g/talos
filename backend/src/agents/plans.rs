//! Harness-owned plan lifecycle.
//!
//! Plans used to be passive display events: each backend emitted a `plan`
//! agent event the UI rendered, but nothing in the harness tracked a plan's
//! state. This module owns the lifecycle — **proposed → approved/declined →
//! completed** — so every backend's plan (ExitPlanMode proposals, TodoWrite,
//! ACP `plan_update`, checklist scans) flows through one tracker and one
//! `plan_status` event the UI can render.
//!
//! [`PlanTracker`] subscribes to the `BroadcastHub` like the persistence
//! listener and keeps per-session state:
//!
//! - a `plan` event records the session's current plan (as `proposed`);
//! - a `permission_required` carrying `is_plan` remembers the approval;
//! - the matching `permission_resolved` flips the plan to `approved`/`declined`;
//! - `agent_completed` closes an in-flight plan as `completed`.
//!
//! Nothing here blocks or rewrites agent traffic — it is observation plus a
//! status broadcast, so it can never fail a turn.

use crate::agent_events::AgentEvent;
use crate::websocket::WsMessage;
use crate::websocket::broadcast::BroadcastHub;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanStatus {
    Proposed,
    Approved,
    Declined,
    Completed,
}

impl PlanStatus {
    fn as_str(&self) -> &'static str {
        match self {
            PlanStatus::Proposed => "proposed",
            PlanStatus::Approved => "approved",
            PlanStatus::Declined => "declined",
            PlanStatus::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone)]
struct PlanState {
    title: String,
    steps: Vec<String>,
    status: PlanStatus,
}

pub struct PlanTracker {
    plans: Mutex<HashMap<String, PlanState>>,
    /// Approval request ids that were plan approvals → the session they belong to.
    plan_requests: Mutex<HashMap<String, String>>,
}

impl PlanTracker {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            plans: Mutex::new(HashMap::new()),
            plan_requests: Mutex::new(HashMap::new()),
        })
    }

    /// Subscribe to the hub and track plan lifecycles for every session.
    /// Runs forever; the daemon aborts it at shutdown.
    pub fn spawn(self: &Arc<Self>, hub: BroadcastHub) {
        let tracker = Arc::clone(self);
        tokio::spawn(async move {
            let mut rx = hub.subscribe();
            loop {
                let Ok(event) = rx.recv().await else {
                    break;
                };
                tracker.on_message(&hub, event.message);
            }
        });
    }

    fn on_message(&self, hub: &BroadcastHub, message: WsMessage) {
        let WsMessage::AgentEvent { event } = message else {
            return;
        };
        match event.kind.as_str() {
            "plan" => self.on_plan(&event),
            "permission_required" => self.on_permission_required(&event),
            "permission_resolved" => self.on_permission_resolved(hub, &event),
            "agent_completed" => self.on_turn_completed(hub, &event),
            _ => {}
        }
    }

    fn on_plan(&self, event: &AgentEvent) {
        let mut plans = self.plans.lock().unwrap();
        let plan = plans
            .entry(event.session_id.clone())
            .or_insert_with(|| PlanState {
                title: "Plan".to_string(),
                steps: Vec::new(),
                status: PlanStatus::Proposed,
            });
        if let Some(title) = event.payload.get("title").and_then(Value::as_str) {
            plan.title = title.to_string();
        }
        plan.steps = extract_steps(&event.payload);
        // A fresh plan supersedes a finished one; an in-flight plan keeps its
        // status (progress updates arrive as more `plan` events).
        if plan.status == PlanStatus::Completed {
            plan.status = PlanStatus::Proposed;
        }
    }

    fn on_permission_required(&self, event: &AgentEvent) {
        if event.payload.get("is_plan").and_then(Value::as_bool) != Some(true) {
            return;
        }
        let Some(request_id) = event.payload.get("id").and_then(Value::as_str) else {
            return;
        };
        self.plan_requests
            .lock()
            .unwrap()
            .insert(request_id.to_string(), event.session_id.clone());
    }

    fn on_permission_resolved(&self, hub: &BroadcastHub, event: &AgentEvent) {
        let Some(request_id) = event.payload.get("request_id").and_then(Value::as_str) else {
            return;
        };
        let Some(session_id) = self.plan_requests.lock().unwrap().remove(request_id) else {
            return;
        };
        let decision = event.payload.get("decision").and_then(Value::as_str).unwrap_or("deny");
        let allowed = decision.starts_with("allow")
            || decision.starts_with("approve")
            || decision == "yes"
            || decision == "always";
        let status = if allowed {
            PlanStatus::Approved
        } else {
            PlanStatus::Declined
        };
        let mut plans = self.plans.lock().unwrap();
        if let Some(plan) = plans.get_mut(&session_id) {
            plan.status = status;
            let plan = plan.clone();
            broadcast_status(hub, &session_id, &plan);
        }
    }

    fn on_turn_completed(&self, hub: &BroadcastHub, event: &AgentEvent) {
        let mut plans = self.plans.lock().unwrap();
        let Some(plan) = plans.get_mut(&event.session_id) else {
            return;
        };
        if plan.status == PlanStatus::Proposed || plan.status == PlanStatus::Approved {
            plan.status = PlanStatus::Completed;
            let plan = plan.clone();
            broadcast_status(hub, &event.session_id, &plan);
        }
    }

    /// Test hook: current plan status for a session.
    #[cfg(test)]
    fn status(&self, session_id: &str) -> Option<PlanStatus> {
        self.plans.lock().unwrap().get(session_id).map(|p| p.status)
    }
}

fn extract_steps(payload: &Value) -> Vec<String> {
    if let Some(steps) = payload.get("steps").and_then(Value::as_array) {
        let parsed: Vec<String> = steps
            .iter()
            .filter_map(|s| s.as_str().map(str::to_string))
            .collect();
        if !parsed.is_empty() {
            return parsed;
        }
    }
    if let Some(entries) = payload.get("entries").and_then(Value::as_array) {
        return entries
            .iter()
            .filter_map(|e| e.get("content").and_then(Value::as_str).map(str::to_string))
            .collect();
    }
    Vec::new()
}

fn broadcast_status(hub: &BroadcastHub, session_id: &str, plan: &PlanState) {
    hub.broadcast_agent_event(AgentEvent::new(
        session_id,
        "plan_status",
        serde_json::json!({
            "status": plan.status.as_str(),
            "title": plan.title,
            "steps_total": plan.steps.len(),
        }),
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(kind: &str, session_id: &str, payload: Value) -> AgentEvent {
        AgentEvent {
            event_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            sequence: 1,
            timestamp: chrono::Utc::now(),
            kind: kind.to_string(),
            payload,
            duration_ms: None,
        }
    }

    /// Feed an event through the tracker's handler synchronously (no spawn
    /// loop, so tests are deterministic).
    fn feed(tracker: &PlanTracker, hub: &BroadcastHub, kind: &str, session_id: &str, payload: Value) {
        tracker.on_message(hub, WsMessage::AgentEvent { event: event(kind, session_id, payload) });
    }

    #[test]
    fn plan_lifecycle_proposed_approved_completed() {
        let hub = BroadcastHub::new();
        let tracker = PlanTracker::new();

        feed(&tracker, &hub, "plan", "s1", json!({ "title": "Fix auth", "steps": ["a", "b"], "source": "checklist" }));
        assert_eq!(tracker.status("s1"), Some(PlanStatus::Proposed));

        // The plan approval surfaces and is approved.
        feed(&tracker, &hub, "permission_required", "s1", json!({ "id": "r1", "is_plan": true, "options": ["Approve", "Decline"] }));
        feed(&tracker, &hub, "permission_resolved", "s1", json!({ "request_id": "r1", "decision": "approve" }));
        assert_eq!(tracker.status("s1"), Some(PlanStatus::Approved));

        // Turn ends → the plan is done.
        feed(&tracker, &hub, "agent_completed", "s1", json!({}));
        assert_eq!(tracker.status("s1"), Some(PlanStatus::Completed));
    }

    #[test]
    fn declined_plan_stays_declined_after_turn_end() {
        let hub = BroadcastHub::new();
        let tracker = PlanTracker::new();

        feed(&tracker, &hub, "plan", "s2", json!({ "steps": ["x"] }));
        feed(&tracker, &hub, "permission_required", "s2", json!({ "id": "r2", "is_plan": true, "options": ["Approve", "Decline"] }));
        feed(&tracker, &hub, "permission_resolved", "s2", json!({ "request_id": "r2", "decision": "deny" }));
        assert_eq!(tracker.status("s2"), Some(PlanStatus::Declined));

        feed(&tracker, &hub, "agent_completed", "s2", json!({}));
        assert_eq!(tracker.status("s2"), Some(PlanStatus::Declined));
    }

    #[test]
    fn non_plan_approvals_do_not_touch_plan_state() {
        let hub = BroadcastHub::new();
        let tracker = PlanTracker::new();

        feed(&tracker, &hub, "permission_required", "s3", json!({ "id": "r3", "is_plan": false, "options": ["Allow", "Deny"] }));
        feed(&tracker, &hub, "permission_resolved", "s3", json!({ "request_id": "r3", "decision": "allow" }));
        assert_eq!(tracker.status("s3"), None);
    }
}

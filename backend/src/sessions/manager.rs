use crate::sessions::{Session, SessionStatus};
use crate::{agent_events::{AgentEvent, AgentMessage}, questions::{Question, QuestionOption}, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SessionManager {
    pool: SqlitePool,
    active_sessions: Arc<RwLock<std::collections::HashMap<String, Session>>>,
    session_pids: Arc<RwLock<std::collections::HashMap<String, u32>>>,
}

impl SessionManager {
    /// Shared SQLite pool — small persistent stores (rooms) reuse it rather
    /// than opening their own connection.
    pub fn pool(&self) -> sqlx::SqlitePool {
        self.pool.clone()
    }

    pub async fn new(pool: SqlitePool) -> Result<Self> {
        Ok(Self {
            pool,
            active_sessions: Arc::new(RwLock::new(std::collections::HashMap::new())),
            session_pids: Arc::new(RwLock::new(std::collections::HashMap::new())),
        })
    }

    pub async fn set_session_pid(&self, session_id: &str, pid: u32) {
        tracing::info!("[AgentDeck][Session] PID tracking: session={} pid={}", session_id, pid);
        self.session_pids.write().await.insert(session_id.to_string(), pid);
    }

    pub async fn get_session_pid(&self, session_id: &str) -> Option<u32> {
        self.session_pids.read().await.get(session_id).copied()
    }

    pub async fn create_session(
        &self,
        name: &str,
        agent: &str,
        project: Option<&str>,
    ) -> Result<Session> {
        let session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            agent: agent.to_string(),
            project: project.map(|s| s.to_string()),
            branch: None,
            status: SessionStatus::Starting,
            worktree_path: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            cost: None,
            tokens_used: None,
            resume_command: None,
            external_id: None,
            source: "agentdeck".to_string(),
            parent_id: None,
            hidden: false,
        };

        sqlx::query(
            r#"
            INSERT INTO sessions (id, name, agent, project, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#
        )
        .bind(&session.id)
        .bind(&session.name)
        .bind(&session.agent)
        .bind(&session.project)
        .bind("starting")
        .bind(&session.created_at)
        .bind(&session.updated_at)
        .execute(&self.pool)
        .await?;

        self.active_sessions.write().await.insert(session.id.clone(), session.clone());

        Ok(session)
    }

    /// Adopt a session that already exists in a CLI's own history.
    ///
    /// Idempotent by `(agent, external_id)`: importing twice returns the existing
    /// row rather than creating a duplicate, so a user can press Sync repeatedly
    /// without accumulating copies. The status is `NeedsResume` because the
    /// session is real but not running — the user resumes it to continue.
    pub async fn import_session(
        &self,
        agent: &str,
        external_id: &str,
        name: &str,
        project: Option<&str>,
        updated_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(Session, bool)> {
        if let Some(existing) = self.find_by_external_id(agent, external_id).await? {
            return Ok((existing, false));
        }

        let now = chrono::Utc::now();
        let session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            agent: agent.to_string(),
            project: project.map(str::to_string),
            branch: None,
            status: SessionStatus::NeedsResume,
            worktree_path: None,
            created_at: updated_at.unwrap_or(now),
            updated_at: updated_at.unwrap_or(now),
            cost: None,
            tokens_used: None,
            resume_command: None,
            external_id: Some(external_id.to_string()),
            source: agent.to_string(),
            parent_id: None,
            hidden: false,
        };

        sqlx::query(
            r#"
            INSERT INTO sessions
                (id, name, agent, project, status, created_at, updated_at, external_id, source)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(&session.id)
        .bind(&session.name)
        .bind(&session.agent)
        .bind(&session.project)
        .bind("needs_resume")
        .bind(&session.created_at)
        .bind(&session.updated_at)
        .bind(&session.external_id)
        .bind(&session.source)
        .execute(&self.pool)
        .await?;

        Ok((session, true))
    }

    /// The local row for a provider's session id, if this app has one.
    pub async fn find_by_external_id(
        &self,
        agent: &str,
        external_id: &str,
    ) -> Result<Option<Session>> {
        let row: Option<SessionRow> =
            sqlx::query_as("SELECT * FROM sessions WHERE agent = ?1 AND external_id = ?2")
                .bind(agent)
                .bind(external_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(Session::from))
    }

    /// Every `(agent, external_id)` pair already imported, for marking discovery
    /// results without a query per candidate.
    pub async fn imported_external_ids(&self) -> Result<Vec<(String, String)>> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT agent, external_id FROM sessions WHERE external_id IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Record the CLI's own session id for a session this app created.
    ///
    /// ACP agents assign their own id at `session/new` (opencode:
    /// `ses_ff0133d52ffe…`), and that id — not ours — is what resuming requires.
    /// Without persisting it, resume passed the local uuid and the CLI answered
    /// `Invalid session ID`.
    pub async fn set_external_id(&self, id: &str, external_id: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET external_id = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(external_id)
            .bind(chrono::Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        let mut active = self.active_sessions.write().await;
        if let Some(session) = active.get_mut(id) {
            session.external_id = Some(external_id.to_string());
        }
        Ok(())
    }

    /// Forget the provider-side session id (used when an engine switch rebinds
    /// a row to a different provider). NULL — not the empty string — so resume
    /// falls back to this app's own id instead of targeting "".
    pub async fn clear_external_id(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET external_id = NULL, updated_at = ?1 WHERE id = ?2")
            .bind(chrono::Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        let mut active = self.active_sessions.write().await;
        if let Some(session) = active.get_mut(id) {
            session.external_id = None;
        }
        Ok(())
    }

    /// Rebind a session to a different agent/provider while keeping its row,
    /// transcript, and project. Used by the in-session engine switch: the old
    /// engine's subprocess is stopped first, then this persists the new agent
    /// so a fresh spawn relaunches under it. Callers must clear the old
    /// engine's `external_id` / `resume_command` (they belong to the previous
    /// provider) and set the row to a starting status before spawning.
    pub async fn set_agent(&self, id: &str, agent: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET agent = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(agent)
            .bind(chrono::Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        let mut active = self.active_sessions.write().await;
        if let Some(session) = active.get_mut(id) {
            session.agent = agent.to_string();
        }
        Ok(())
    }

    /// Link a session to the session that spawned it. Called right after a
    /// subagent / orchestration child is created; the link is what makes
    /// cancellation cascade and spawned-row UI possible.
    pub async fn set_parent(&self, id: &str, parent_id: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET parent_id = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(parent_id)
            .bind(chrono::Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        let mut active = self.active_sessions.write().await;
        if let Some(session) = active.get_mut(id) {
            session.parent_id = Some(parent_id.to_string());
        }
        Ok(())
    }

    /// The not-yet-finished children spawned by `parent_id` — the set a
    /// cancellation cascade must stop. Ended children (exited / archived /
    /// errored) are excluded so killing a parent never resurrects old rows.
    pub async fn child_sessions(&self, parent_id: &str) -> Result<Vec<Session>> {
        let rows: Vec<SessionRow> = sqlx::query_as(
            r#"
            SELECT * FROM sessions
            WHERE parent_id = ?1
              AND status NOT IN ('exited', 'archived', 'error', 'needs_resume')
            "#,
        )
        .bind(parent_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Session::from).collect())
    }

    /// The model recorded for `session_id` (create-time request or a later
    /// config change), so spawned workers can pin the same configuration.
    pub async fn current_model(&self, session_id: &str) -> Option<String> {
        let value: Option<(String,)> =
            sqlx::query_as("SELECT value FROM session_config WHERE session_id = ?1 AND config_id = 'model'")
                .bind(session_id)
                .fetch_optional(&self.pool)
                .await
                .ok()
                .flatten();
        value.map(|(model,)| model)
    }

    /// Mark a session as hidden from the default session lists. Harness-created
    /// rows (orchestration children, room channels) use this; the flag is
    /// purely presentational and by-id access is unaffected. Updates the
    /// in-memory cache too — `get_session` serves it, and a stale cache would
    /// broadcast `hidden: false` in the spawn-time `SessionUpdate`.
    pub async fn set_hidden(&self, id: &str, hidden: bool) -> Result<()> {
        sqlx::query("UPDATE sessions SET hidden = ?1 WHERE id = ?2")
            .bind(hidden)
            .bind(id)
            .execute(&self.pool)
            .await?;
        if let Some(session) = self.active_sessions.write().await.get_mut(id) {
            session.hidden = hidden;
        }
        Ok(())
    }

    /// Mark sessions left in live states by a previous daemon run as
    /// resumable, returning how many were changed.
    ///
    /// Agent processes die with the daemon but their rows persist, so on startup
    /// every such row is stale. Leaving them alone showed sessions as "Working"
    /// indefinitely with no way to continue them — the status has to reflect that
    /// nothing is running.
    ///
    /// `waiting_for_approval` / `waiting_for_input` are covered too: the
    /// permission broker's waiters are in-memory, so after a restart no one can
    /// ever answer those cards (answering falls through to an error). Their
    /// cards are expired by `expire_orphaned_approvals` — call it alongside.
    pub async fn mark_orphaned_sessions_resumable(&self) -> Result<u64> {
        let result = sqlx::query(
            "UPDATE sessions SET status = 'needs_resume', updated_at = ?1 \
             WHERE status IN ('running', 'starting', 'waiting_for_approval', 'waiting_for_input')",
        )
        .bind(chrono::Utc::now())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Close approval cards orphaned by a restart: every `permission_required`
    /// agent event with no later `permission_resolved` for the same id gets an
    /// `expired` resolution, so replay renders an outcome instead of buttons
    /// that can never work (the broker waiter is gone with the old process).
    /// Returns how many cards were expired.
    pub async fn expire_orphaned_approvals(&self) -> Result<u64> {
        let required: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT session_id, payload, timestamp FROM agent_events WHERE kind = 'permission_required'",
        )
        .fetch_all(&self.pool)
        .await?;
        if required.is_empty() {
            return Ok(0);
        }
        let resolved: Vec<(String,)> =
            sqlx::query_as("SELECT payload FROM agent_events WHERE kind = 'permission_resolved'")
                .fetch_all(&self.pool)
                .await?;
        let mut resolved_ids = std::collections::HashSet::new();
        for (payload,) in resolved {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
                if let Some(id) = value.get("request_id").and_then(|v| v.as_str()) {
                    resolved_ids.insert(id.to_string());
                }
            }
        }
        let mut expired = 0u64;
        for (session_id, payload, _) in required {
            let request_id = serde_json::from_str::<serde_json::Value>(&payload)
                .ok()
                .and_then(|v| v.get("id").and_then(|id| id.as_str()).map(str::to_string));
            let Some(request_id) = request_id else { continue };
            if resolved_ids.contains(&request_id) {
                continue;
            }
            // Claim it so a second pass (or a concurrent boot) cannot expire twice.
            if !resolved_ids.insert(request_id.clone()) {
                continue;
            }
            let sequence: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_events WHERE session_id = ?1",
            )
            .bind(&session_id)
            .fetch_one(&self.pool)
            .await?;
            let event = crate::agent_events::AgentEvent {
                event_id: uuid::Uuid::new_v4().to_string(),
                session_id: session_id.clone(),
                sequence: sequence as u64,
                timestamp: chrono::Utc::now(),
                kind: "permission_resolved".to_string(),
                payload: serde_json::json!({
                    "request_id": request_id,
                    "decision": "expired",
                    "reason": "Daemon restarted before this approval was answered; the wait no longer exists.",
                }),
                duration_ms: None,
            };
            if self.insert_agent_event(&event).await.is_ok() {
                expired += 1;
            }
        }
        Ok(expired)
    }

    pub async fn list_sessions(&self) -> Result<Vec<Session>> {
        self.list_sessions_with_archived(false).await
    }

    /// The default workspace list: archived rows excluded, and harness-created
    /// rows (orchestration children, room channels) hidden — those surface in
    /// the room/agent views, not as user tasks.
    pub async fn list_sessions_with_archived(&self, include_archived: bool) -> Result<Vec<Session>> {
        let query = if include_archived {
            "SELECT * FROM sessions WHERE hidden = 0 ORDER BY updated_at DESC"
        } else {
            "SELECT * FROM sessions WHERE status != 'archived' AND hidden = 0 ORDER BY updated_at DESC"
        };
        let rows = sqlx::query_as::<_, SessionRow>(query)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.into_iter().map(|r| r.into()).collect())
    }

    /// Sessions that finished at least one turn and kept history — the
    /// candidates for similar-trajectory injection. A completed turn leaves
    /// the session `idle`; Claude sessions with history are `needs_resume`.
    pub async fn list_completed_sessions(&self) -> Result<Vec<Session>> {
        let rows = sqlx::query_as::<_, SessionRow>(
            "SELECT * FROM sessions WHERE status IN ('idle', 'needs_resume') ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.into()).collect())
    }

    pub async fn get_session(&self, id: &str) -> Result<Option<Session>> {
        let active = self.active_sessions.read().await;
        if let Some(session) = active.get(id) {
            return Ok(Some(session.clone()));
        }
        drop(active);

        let row = sqlx::query_as::<_, SessionRow>(
            "SELECT * FROM sessions WHERE id = ?1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.into()))
    }

    pub async fn update_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        let status_str = match status {
            SessionStatus::Starting => "starting",
            SessionStatus::Running => "running",
            SessionStatus::WaitingForInput => "waiting_for_input",
            SessionStatus::WaitingForApproval => "waiting_for_approval",
            SessionStatus::Idle => "idle",
            SessionStatus::NeedsResume => "needs_resume",
            SessionStatus::Error => "error",
            SessionStatus::Archived => "archived",
            SessionStatus::Exited => "exited",
        };

        sqlx::query("UPDATE sessions SET status = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(status_str)
            .bind(chrono::Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        let mut active = self.active_sessions.write().await;
        if let Some(session) = active.get_mut(id) {
            session.status = status;
            session.updated_at = chrono::Utc::now();
        }

        self.record_state(id, status_str, None, "session_manager", None).await
    }

    /// Record a requested provider config value (model, mode, effort, …) for a
    /// session.
    ///
    /// This is a *request*, not a claim about the live agent. It is stored so a
    /// choice made while the agent is stopped survives a restart and is applied
    /// when the session next spawns. `config_id` and `value` are both opaque
    /// provider strings and are never parsed — a model id may contain slashes
    /// and colons.
    pub async fn set_pending_config(&self, id: &str, config_id: &str, value: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO session_config (session_id, config_id, value, updated_at) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(session_id, config_id) DO UPDATE SET value = ?3, updated_at = ?4",
        )
        .bind(id)
        .bind(config_id)
        .bind(value)
        .bind(chrono::Utc::now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Every requested config value for a session, as `(config_id, value)`.
    pub async fn pending_config(&self, id: &str) -> Result<Vec<(String, String)>> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT config_id, value FROM session_config WHERE session_id = ?1 ORDER BY config_id",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Drop one consumed request. Applied-at-spawn values are removed so a
    /// stale choice cannot silently override a newer explicit one.
    pub async fn clear_pending_config(&self, id: &str, config_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM session_config WHERE session_id = ?1 AND config_id = ?2")
            .bind(id)
            .bind(config_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Store the command the UI should show for resuming this session. Only
    /// meaningful when the status is `needs_resume`.
    pub async fn set_resume_command(&self, id: &str, resume_command: &str) -> Result<()> {
        sqlx::query("UPDATE sessions SET resume_command = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(resume_command)
            .bind(chrono::Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        let mut active = self.active_sessions.write().await;
        if let Some(session) = active.get_mut(id) {
            session.resume_command = Some(resume_command.to_string());
        }

        Ok(())
    }

    /// Mark a session as resumable: transition it to `needs_resume` and persist
    /// the command a user could run to resume it. No-op (returns Ok) if the
    /// session is not in a state that can transition to `needs_resume`.
    pub async fn mark_needs_resume(&self, id: &str) -> Result<()> {
        {
            let active = self.active_sessions.read().await;
            let status = active.get(id).map(|s| s.status.clone());
            drop(active);
            match status {
                Some(SessionStatus::Exited) | Some(SessionStatus::Idle) => {}
                _ => return Ok(()),
            }
        }

        let resume_command = format!("claude --resume {}", id);
        self.update_status(id, SessionStatus::NeedsResume).await?;
        self.set_resume_command(id, &resume_command).await
    }

    /// Append a row to the `agent_state` history table. Consecutive duplicate
    /// states are collapsed so the log describes transitions, not the health
    /// checks and stream updates that repeat the current state every tick.
    pub async fn record_state(
        &self,
        session_id: &str,
        status: &str,
        detail: Option<String>,
        source: &str,
        context: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO agent_state (session_id, status, detail, source)
            SELECT ?1, ?2, ?3, ?4
            WHERE NOT EXISTS (
                SELECT 1
                FROM agent_state latest
                WHERE latest.session_id = ?1
                  AND latest.id = (SELECT MAX(id) FROM agent_state WHERE session_id = ?1)
                  AND latest.status = ?2
            )
            "#,
        )
        .bind(session_id)
        .bind(status)
        .bind(detail)
        .bind(source)
        .execute(&self.pool)
        .await?;
        if let Some(context) = context {
            tracing::trace!(
                "[AgentDeck][State] session={} -> {} (from {}): {}",
                session_id,
                status,
                source,
                context
            );
        }
        Ok(())
    }

    pub async fn archive_session(&self, id: &str) -> Result<()> {
        let Some(session) = self.get_session(id).await? else {
            return Err(crate::AgentDeckError::Session("Session not found".to_string()));
        };
        if matches!(session.status, SessionStatus::Running | SessionStatus::Starting | SessionStatus::WaitingForInput | SessionStatus::WaitingForApproval) {
            return Err(crate::AgentDeckError::Session("Stop the running session before archiving it".to_string()));
        }
        self.update_status(id, SessionStatus::Archived).await
    }

    pub async fn restore_session(&self, id: &str) -> Result<()> {
        let Some(session) = self.get_session(id).await? else {
            return Err(crate::AgentDeckError::Session("Session not found".to_string()));
        };
        if !matches!(session.status, SessionStatus::Archived) {
            return Err(crate::AgentDeckError::Session("Session is not archived".to_string()));
        }
        let has_history = !self.get_messages(id).await?.is_empty() || !self.get_transcripts(id).await?.is_empty();
        self.update_status(id, if has_history { SessionStatus::NeedsResume } else { SessionStatus::Idle }).await
    }

    pub async fn delete_session(&self, id: &str) -> Result<()> {
        if self.get_session(id).await?.is_none() {
            return Err(crate::AgentDeckError::Session("Session not found".to_string()));
        }
        for table in ["transcripts", "messages", "agent_events", "terminal_output", "approvals", "questions", "agent_state", "session_config"] {
            sqlx::query(&format!("DELETE FROM {table} WHERE session_id = ?1"))
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        sqlx::query("DELETE FROM sessions WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        self.active_sessions.write().await.remove(id);
        self.session_pids.write().await.remove(id);
        Ok(())
    }

    pub async fn insert_transcript(
        &self,
        session_id: &str,
        kind: &str,
        content: &str,
    ) -> Result<i64> {
        tracing::debug!("[AgentDeck][Persistence] Inserting transcript: session={} kind={} len={}", session_id, kind, content.len());
        sqlx::query(
            "INSERT INTO transcripts (session_id, kind, content) VALUES (?1, ?2, ?3)"
        )
        .bind(session_id)
        .bind(kind)
        .bind(content)
        .execute(&self.pool)
        .await?;
        let id: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
            .fetch_one(&self.pool)
            .await?;
        tracing::debug!("[AgentDeck][Persistence] Inserted transcript id={}", id);
        Ok(id)
    }

    pub async fn get_transcripts(&self, session_id: &str) -> Result<Vec<TranscriptRow>> {
        let rows = sqlx::query_as::<_, TranscriptRow>(
            "SELECT id, session_id, kind, content, timestamp FROM transcripts WHERE session_id = ?1 ORDER BY id ASC"
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn delete_transcripts(&self, session_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM transcripts WHERE session_id = ?1")
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn insert_message(&self, message: &AgentMessage) -> Result<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO messages (id, session_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&message.id)
        .bind(&message.session_id)
        .bind(&message.role)
        .bind(&message.content)
        .bind(message.timestamp)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<AgentMessage>> {
        Ok(sqlx::query_as::<_, AgentMessageRow>(
            "SELECT id, session_id, role, content, timestamp FROM messages WHERE session_id = ?1 ORDER BY timestamp ASC, id ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Into::into)
        // Legacy engine-switch markers were persisted as role "user". Classify
        // them as system rows on read so they never reach the model or the
        // user-bubble rendering of a replay — they are timeline chrome.
        .map(|mut message: AgentMessage| {
            if message.role == "user" && crate::agent_events::is_lifecycle_marker(&message.content) {
                message.role = "system".to_string();
            }
            message
        })
        .collect())
    }

    pub async fn insert_agent_event(&self, event: &AgentEvent) -> Result<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO agent_events (event_id, session_id, sequence, timestamp, kind, payload, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&event.event_id)
        .bind(&event.session_id)
        .bind(event.sequence as i64)
        .bind(event.timestamp)
        .bind(&event.kind)
        .bind(serde_json::to_string(&event.payload)?)
        .bind(event.duration_ms.map(|duration| duration as i64))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_agent_events(&self, session_id: &str) -> Result<Vec<AgentEvent>> {
        Ok(sqlx::query_as::<_, AgentEventRow>(
            "SELECT event_id, session_id, sequence, timestamp, kind, payload, duration_ms FROM agent_events WHERE session_id = ?1 ORDER BY sequence ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .filter_map(|row| row.try_into().ok())
        .collect())
    }

    pub async fn insert_terminal_output(&self, session_id: &str, sequence: u64, data: &str) -> Result<()> {
        // Standalone PTY terminals (term-<uuid>) are not real sessions; their
        // output lives only in the live broadcast. Skip persistence instead of
        // failing the FK check on every keystroke.
        if session_id.starts_with("term-") {
            return Ok(());
        }
        sqlx::query(
            "INSERT INTO terminal_output (session_id, sequence, data) VALUES (?1, ?2, ?3)",
        )
        .bind(session_id)
        .bind(sequence as i64)
        .bind(data)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_terminal_output(&self, session_id: &str) -> Result<Vec<TerminalOutputRow>> {
        Ok(sqlx::query_as::<_, TerminalOutputRow>(
            "SELECT id, session_id, sequence, CAST(data AS TEXT) AS data, timestamp FROM terminal_output WHERE session_id = ?1 ORDER BY sequence ASC, id ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?)
    }

    /// Full state-transition history for a session, oldest first. Backed by
    /// the append-only `agent_state` table the status submisser writes to.
    pub async fn get_agent_states(&self, session_id: &str) -> Result<Vec<AgentStateRecord>> {
        Ok(sqlx::query_as::<_, AgentStateRow>(
            "SELECT session_id, status, detail, source, created_at FROM agent_state WHERE session_id = ?1 ORDER BY id ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
    }

    pub async fn create_approval(
        &self,
        id: &str,
        session_id: &str,
        prompt: &str,
        options: &[String],
        risk_level: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO approvals (id, session_id, prompt, options, risk_level, response, responded_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL)",
        )
        .bind(id)
        .bind(session_id)
        .bind(prompt)
        .bind(serde_json::to_string(options)?)
        .bind(risk_level)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_pending_approvals(&self, session_id: &str) -> Result<Vec<StoredApproval>> {
        let rows = sqlx::query_as::<_, StoredApprovalRow>(
            "SELECT id, session_id, prompt, options, risk_level, created_at FROM approvals WHERE session_id = ?1 AND response IS NULL ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().filter_map(|row| row.try_into().ok()).collect())
    }

    pub async fn get_approval(&self, id: &str) -> Result<Option<StoredApproval>> {
        let row = sqlx::query_as::<_, StoredApprovalRow>(
            "SELECT id, session_id, prompt, options, risk_level, created_at FROM approvals WHERE id = ?1 AND response IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|row| row.try_into().ok()))
    }

    pub async fn resolve_approval(&self, id: &str, response: &str) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE approvals SET response = ?1, responded_at = ?2 WHERE id = ?3 AND response IS NULL",
        )
        .bind(response)
        .bind(chrono::Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn cancel_pending_approvals(&self, session_id: &str) -> Result<()> {
        sqlx::query("UPDATE approvals SET response = 'cancelled:question', responded_at = ?1 WHERE session_id = ?2 AND response IS NULL")
            .bind(chrono::Utc::now())
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_question(&self, question: &Question) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO questions (question_id, session_id, title, question, options, selection_mode, status, created_at, answered_at, selected_options, custom_text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL, NULL, NULL)",
        )
        .bind(&question.question_id)
        .bind(&question.session_id)
        .bind(&question.title)
        .bind(&question.question)
        .bind(serde_json::to_string(&question.options)?)
        .bind(&question.selection_mode)
        .bind(question.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_pending_questions(&self, session_id: &str) -> Result<Vec<Question>> {
        let rows = sqlx::query_as::<_, QuestionRow>(
            "SELECT question_id, session_id, title, question, options, selection_mode, status, created_at, answered_at, selected_options, custom_text FROM questions WHERE session_id = ?1 AND status = 'pending' ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().filter_map(|row| row.try_into().ok()).collect())
    }

    pub async fn get_pending_question(&self, question_id: &str) -> Result<Option<Question>> {
        let row = sqlx::query_as::<_, QuestionRow>(
            "SELECT question_id, session_id, title, question, options, selection_mode, status, created_at, answered_at, selected_options, custom_text FROM questions WHERE question_id = ?1 AND status = 'pending'",
        )
        .bind(question_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|row| row.try_into().ok()))
    }

    pub async fn answer_question(
        &self,
        answer: &crate::questions::QuestionAnswer,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE questions SET status = 'answered', answered_at = ?1, selected_options = ?2, custom_text = ?3 WHERE question_id = ?4 AND status = 'pending'",
        )
        .bind(chrono::Utc::now())
        .bind(serde_json::to_string(&answer.selected_options)?)
        .bind(&answer.custom_text)
        .bind(&answer.question_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn reopen_question(&self, question_id: &str) -> Result<()> {
        sqlx::query("UPDATE questions SET status = 'pending', answered_at = NULL, selected_options = NULL, custom_text = NULL WHERE question_id = ?1")
            .bind(question_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn cancel_questions(&self, session_id: &str) -> Result<Vec<String>> {
        let rows = sqlx::query_as::<_, (String,)>(
            "SELECT question_id FROM questions WHERE session_id = ?1 AND status = 'pending'",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        sqlx::query("UPDATE questions SET status = 'cancelled', answered_at = ?1 WHERE session_id = ?2 AND status = 'pending'")
            .bind(chrono::Utc::now())
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|row| row.0).collect())
    }
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct TranscriptRow {
    pub id: i64,
    pub session_id: String,
    pub kind: String,
    pub content: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct TerminalOutputRow {
    pub id: i64,
    pub session_id: String,
    pub sequence: i64,
    pub data: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StoredApproval {
    pub id: String,
    pub session_id: String,
    pub prompt: String,
    pub options: Vec<String>,
    pub risk_level: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct StoredApprovalRow {
    id: String,
    session_id: String,
    prompt: String,
    options: Option<String>,
    risk_level: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct QuestionRow {
    question_id: String,
    session_id: String,
    title: String,
    question: String,
    options: String,
    selection_mode: String,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
    answered_at: Option<chrono::DateTime<chrono::Utc>>,
    selected_options: Option<String>,
    custom_text: Option<String>,
}

impl TryFrom<QuestionRow> for Question {
    type Error = serde_json::Error;

    fn try_from(row: QuestionRow) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            question_id: row.question_id,
            session_id: row.session_id,
            title: row.title,
            question: row.question,
            options: serde_json::from_str::<Vec<QuestionOption>>(&row.options)?,
            selection_mode: row.selection_mode,
            status: row.status,
            created_at: row.created_at,
            answered_at: row.answered_at,
            selected_options: row
                .selected_options
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?
                .unwrap_or_default(),
            custom_text: row.custom_text,
        })
    }
}

impl TryFrom<StoredApprovalRow> for StoredApproval {
    type Error = serde_json::Error;

    fn try_from(row: StoredApprovalRow) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            session_id: row.session_id,
            prompt: row.prompt,
            options: row
                .options
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?
                .unwrap_or_else(|| vec!["allow".to_string(), "always".to_string(), "deny".to_string()]),
            risk_level: row.risk_level,
            created_at: row.created_at,
        })
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct AgentMessageRow {
    id: String,
    session_id: String,
    role: String,
    content: String,
    timestamp: chrono::DateTime<chrono::Utc>,
}

impl From<AgentMessageRow> for AgentMessage {
    fn from(row: AgentMessageRow) -> Self {
        Self {
            id: row.id,
            session_id: row.session_id,
            role: row.role,
            content: row.content,
            timestamp: row.timestamp,
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct AgentEventRow {
    event_id: String,
    session_id: String,
    sequence: i64,
    timestamp: chrono::DateTime<chrono::Utc>,
    kind: String,
    payload: String,
    duration_ms: Option<i64>,
}

impl TryFrom<AgentEventRow> for AgentEvent {
    type Error = serde_json::Error;

    fn try_from(row: AgentEventRow) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            event_id: row.event_id,
            session_id: row.session_id,
            sequence: row.sequence.max(0) as u64,
            timestamp: row.timestamp,
            kind: row.kind,
            payload: serde_json::from_str(&row.payload)?,
            duration_ms: row.duration_ms.and_then(|duration| u64::try_from(duration).ok()),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateRecord {
    pub session_id: String,
    pub status: String,
    pub detail: Option<String>,
    pub source: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct AgentStateRow {
    session_id: String,
    status: String,
    detail: Option<String>,
    source: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

impl From<AgentStateRow> for AgentStateRecord {
    fn from(row: AgentStateRow) -> Self {
        Self {
            session_id: row.session_id,
            status: row.status,
            detail: row.detail,
            source: row.source,
            created_at: row.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    name: String,
    agent: String,
    project: Option<String>,
    branch: Option<String>,
    status: String,
    worktree_path: Option<String>,
    cost: Option<f64>,
    tokens_used: Option<i64>,
    resume_command: Option<String>,
    external_id: Option<String>,
    source: Option<String>,
    parent_id: Option<String>,
    hidden: Option<i64>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<SessionRow> for Session {
    fn from(row: SessionRow) -> Self {
        Session {
            id: row.id,
            name: row.name,
            agent: row.agent,
            project: row.project,
            branch: row.branch,
            status: match row.status.as_str() {
                "starting" => SessionStatus::Starting,
                "running" => SessionStatus::Running,
                "waiting_for_input" => SessionStatus::WaitingForInput,
                "waiting_for_approval" => SessionStatus::WaitingForApproval,
                "idle" => SessionStatus::Idle,
                "needs_resume" => SessionStatus::NeedsResume,
                "error" => SessionStatus::Error,
                "archived" => SessionStatus::Archived,
                _ => SessionStatus::Exited,
            },
            worktree_path: row.worktree_path,
            created_at: row.created_at,
            updated_at: row.updated_at,
            cost: row.cost,
            tokens_used: row.tokens_used.and_then(|value| u64::try_from(value).ok()),
            resume_command: row.resume_command,
            external_id: row.external_id,
            source: row.source.unwrap_or_else(|| "agentdeck".to_string()),
            parent_id: row.parent_id,
            hidden: row.hidden.unwrap_or(0) != 0,
        }
    }
}

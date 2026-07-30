use crate::sessions::{Session, SessionStatus};
use crate::Result;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SessionManager {
    pool: SqlitePool,
    active_sessions: Arc<RwLock<std::collections::HashMap<String, Session>>>,
}

impl SessionManager {
    pub async fn new(pool: SqlitePool) -> Result<Self> {
        Ok(Self {
            pool,
            active_sessions: Arc::new(RwLock::new(std::collections::HashMap::new())),
        })
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

    pub async fn list_sessions(&self) -> Result<Vec<Session>> {
        let rows = sqlx::query_as::<_, SessionRow>(
            "SELECT * FROM sessions ORDER BY updated_at DESC"
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

        Ok(())
    }

    pub async fn archive_session(&self, id: &str) -> Result<()> {
        self.update_status(id, SessionStatus::Archived).await
    }

    pub async fn delete_session(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        self.active_sessions.write().await.remove(id);
        Ok(())
    }
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    name: String,
    agent: String,
    project: Option<String>,
    status: String,
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
            branch: None,
            status: match row.status.as_str() {
                "starting" => SessionStatus::Starting,
                "running" => SessionStatus::Running,
                "waiting_for_input" => SessionStatus::WaitingForInput,
                "waiting_for_approval" => SessionStatus::WaitingForApproval,
                "idle" => SessionStatus::Idle,
                "error" => SessionStatus::Error,
                "archived" => SessionStatus::Archived,
                _ => SessionStatus::Exited,
            },
            worktree_path: None,
            created_at: row.created_at,
            updated_at: row.updated_at,
            cost: None,
            tokens_used: None,
        }
    }
}

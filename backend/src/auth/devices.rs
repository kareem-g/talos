use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::Result;

#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub fingerprint: String,
    pub paired_at: DateTime<Utc>,
    pub last_seen: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedDevice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct DeviceRow {
    id: String,
    name: String,
    public_key: String,
    fingerprint: String,
    paired_at: DateTime<Utc>,
    last_seen: Option<DateTime<Utc>>,
}

pub struct DeviceStore {
    pool: SqlitePool,
}

impl DeviceStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn create_device(
        &self,
        name: &str,
        public_key: &str,
        fingerprint: &str,
    ) -> Result<(DeviceInfo, String)> {
        let id = uuid::Uuid::new_v4().to_string();
        let token = random_secret();
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO devices (id, name, public_key, fingerprint, token_hash, paired_at, last_seen)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(public_key)
        .bind(fingerprint)
        .bind(hash_secret(&token))
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok((
            DeviceInfo {
                id,
                name: name.to_string(),
                public_key: public_key.to_string(),
                fingerprint: fingerprint.to_string(),
                paired_at: now,
                last_seen: Some(now),
            },
            token,
        ))
    }

    pub async fn authenticate(&self, token: &str) -> Result<Option<AuthenticatedDevice>> {
        let row = sqlx::query_as::<_, DeviceRow>(
            r#"
            SELECT id, name, public_key, fingerprint, paired_at, last_seen
            FROM devices
            WHERE token_hash = ?1 AND revoked_at IS NULL
            "#,
        )
        .bind(hash_secret(token))
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        sqlx::query("UPDATE devices SET last_seen = ?1 WHERE id = ?2")
            .bind(Utc::now())
            .bind(&row.id)
            .execute(&self.pool)
            .await?;

        Ok(Some(AuthenticatedDevice {
            id: row.id,
            name: row.name,
        }))
    }

    pub async fn list(&self) -> Result<Vec<DeviceInfo>> {
        let rows = sqlx::query_as::<_, DeviceRow>(
            r#"
            SELECT id, name, public_key, fingerprint, paired_at, last_seen
            FROM devices
            WHERE revoked_at IS NULL
            ORDER BY paired_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(device_info).collect())
    }

    pub async fn revoke(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("UPDATE devices SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL")
            .bind(Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}

fn device_info(row: DeviceRow) -> DeviceInfo {
    DeviceInfo {
        id: row.id,
        name: row.name,
        public_key: row.public_key,
        fingerprint: row.fingerprint,
        paired_at: row.paired_at,
        last_seen: row.last_seen,
    }
}

pub fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

//! Web Push delivery — paging the user when the app is not running.
//!
//! The dashboard can already raise a system notification the moment an agent
//! finishes or asks for an approval, but only while its JavaScript is alive.
//! On a phone that is the narrowest possible window: lock the screen and the
//! tab is frozen and then discarded, which is precisely when a long agent turn
//! tends to land. Anything that depends on the page being alive cannot page
//! the user, so the daemon has to be the sender.
//!
//! This is standard Web Push (RFC 8030) with VAPID identification (RFC 8292)
//! and encrypted payloads (RFC 8291). Encryption and JWT signing come from the
//! `web-push` crate; the HTTP POST goes out over the `reqwest` client the rest
//! of the daemon already uses, so no second HTTP stack is linked in.
//!
//! What this buys, and what it does not:
//!
//! - Desktop browsers and Android Chrome: real background delivery.
//! - iOS 16.4+: works, but *only* for a dashboard installed to the home screen.
//!   Safari refuses `pushManager.subscribe` in an ordinary tab.
//! - The Capacitor shell: not supported. A WKWebView has no push service, so
//!   the shell keeps using local notifications scheduled from the page.
//!
//! No third party is involved beyond the browser vendor's push service, which
//! only ever sees ciphertext — the title and body are encrypted to keys that
//! only the subscribing browser holds.

use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use web_push::{
    ContentEncoding, SubscriptionInfo, VapidSignatureBuilder, WebPushError, WebPushMessageBuilder,
};

use crate::Result;

/// Why a single delivery failed, reduced to the only question the caller has:
/// keep this subscription or drop it?
///
/// The `web-push` error enum is richer than that but cannot be built outside
/// the crate (its payload type is private), so transport errors could not be
/// expressed in it anyway. Collapsing both sources into this pair keeps the
/// pruning rule in one readable place.
#[derive(Debug)]
enum PushFailure {
    /// The push service says this endpoint is permanently gone — the browser
    /// cleared site data, dropped the PWA, or revoked permission. Retrying can
    /// never succeed, so the row should go.
    Gone(String),
    /// Everything else: offline network, rate limit, push service outage, a
    /// payload we built wrong. The subscription is still good; try again on the
    /// next event.
    Transient(String),
}

impl std::fmt::Display for PushFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Gone(message) | Self::Transient(message) => f.write_str(message),
        }
    }
}

impl From<WebPushError> for PushFailure {
    fn from(error: WebPushError) -> Self {
        // 410 Gone and 404 Not Found are the only signals a push service gives
        // that a subscription is dead for good.
        match error {
            WebPushError::EndpointNotValid(_) | WebPushError::EndpointNotFound(_) => {
                Self::Gone(error.to_string())
            }
            other => Self::Transient(other.to_string()),
        }
    }
}

/// A browser's `PushSubscription`, in the shape `subscription.toJSON()` emits.
///
/// Deserialized straight from the client so the dashboard can forward what the
/// browser gave it without reshaping anything.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PushSubscriptionInput {
    pub endpoint: String,
    pub keys: PushKeys,
    /// Free-text device description, shown when listing subscriptions.
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PushKeys {
    pub p256dh: String,
    pub auth: String,
}

/// A stored subscription, as the sender needs it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StoredSubscription {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

/// What a push tells the service worker to draw.
///
/// `tag` collapses repeats: a second "needs approval" for the same session
/// replaces the first rather than stacking, so a chatty agent cannot bury the
/// user in notifications. `url` is where a tap lands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    pub tag: String,
    pub url: String,
    /// Mirrors the reason the daemon sent this, for client-side filtering.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// The daemon's VAPID identity: a P-256 keypair, generated once and kept.
///
/// The public key is embedded in every subscription a browser creates, so
/// rotating it silently orphans every existing subscriber. It is therefore
/// written once and only read afterwards.
#[derive(Clone)]
pub struct VapidIdentity {
    /// Raw private scalar, base64url — the form `web-push` wants.
    private_key: String,
    /// Uncompressed public point, base64url — the form the browser wants.
    public_key: String,
}

impl VapidIdentity {
    /// The `applicationServerKey` a browser passes to `pushManager.subscribe`.
    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    /// Load the stored identity, generating one on first use.
    pub async fn load_or_create(pool: &SqlitePool) -> Result<Self> {
        if let Some((private_key, public_key)) =
            sqlx::query_as::<_, (String, String)>(
                "SELECT private_key, public_key FROM push_vapid_keys WHERE id = 1",
            )
            .fetch_optional(pool)
            .await?
        {
            return Ok(Self { private_key, public_key });
        }

        let identity = Self::generate();
        // `INSERT OR IGNORE` rather than a plain insert: two daemons racing on
        // the same database should converge on one key, not error. The re-read
        // below is what makes the winner's key the one in use.
        sqlx::query(
            "INSERT OR IGNORE INTO push_vapid_keys (id, private_key, public_key) VALUES (1, ?1, ?2)",
        )
        .bind(&identity.private_key)
        .bind(&identity.public_key)
        .execute(pool)
        .await?;

        let (private_key, public_key) = sqlx::query_as::<_, (String, String)>(
            "SELECT private_key, public_key FROM push_vapid_keys WHERE id = 1",
        )
        .fetch_one(pool)
        .await?;
        Ok(Self { private_key, public_key })
    }

    /// Mint a fresh P-256 keypair.
    ///
    /// The private key is just 32 random bytes. A uniformly random 32-byte
    /// string is a valid P-256 scalar unless it is zero or lands above the
    /// curve order — about a 1-in-4-billion miss. Rather than reason about
    /// that, each candidate is handed to the very code that will later sign
    /// with it, and a rejection means draw again. That also derives the public
    /// key through the same path, so the pair cannot disagree.
    fn generate() -> Self {
        loop {
            let mut scalar = [0u8; 32];
            OsRng.fill_bytes(&mut scalar);
            let private_key = URL_SAFE_NO_PAD.encode(scalar);
            if let Ok(builder) = VapidSignatureBuilder::from_base64_no_sub(&private_key) {
                return Self {
                    public_key: URL_SAFE_NO_PAD.encode(builder.get_public_key()),
                    private_key,
                };
            }
        }
    }
}

/// Stores subscriptions and delivers pushes to them.
pub struct PushService {
    pool: SqlitePool,
    identity: VapidIdentity,
    http: reqwest::Client,
    /// The `sub` claim in the VAPID JWT. Push services want a contact for
    /// whoever is sending; a mailto is the conventional answer and nothing in
    /// AgentDeck has a real address, so this identifies the software.
    subject: String,
}

impl PushService {
    pub async fn new(pool: SqlitePool) -> Result<Arc<Self>> {
        let identity = VapidIdentity::load_or_create(&pool).await?;
        Ok(Arc::new(Self {
            pool,
            identity,
            http: reqwest::Client::builder()
                // A wedged push service must not pin a task forever.
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
            subject: "mailto:agentdeck@localhost".to_string(),
        }))
    }

    pub fn public_key(&self) -> &str {
        self.identity.public_key()
    }

    /// Record a browser's subscription, replacing any earlier one for the same
    /// endpoint so a re-subscribe cannot double-page the user.
    pub async fn subscribe(
        &self,
        input: &PushSubscriptionInput,
        device_id: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, device_id, label)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                device_id = excluded.device_id,
                label = excluded.label
            "#,
        )
        .bind(&input.endpoint)
        .bind(&input.keys.p256dh)
        .bind(&input.keys.auth)
        .bind(device_id)
        .bind(input.label.as_deref())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn unsubscribe(&self, endpoint: &str) -> Result<()> {
        sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = ?1")
            .bind(endpoint)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn subscriptions(&self) -> Result<Vec<StoredSubscription>> {
        Ok(sqlx::query_as::<_, StoredSubscription>(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn subscription_count(&self) -> Result<i64> {
        let (count,) =
            sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM push_subscriptions")
                .fetch_one(&self.pool)
                .await?;
        Ok(count)
    }

    /// Deliver to every subscription. Returns how many were accepted.
    ///
    /// One dead phone must not stop the others, so failures are logged per
    /// endpoint rather than returned. Endpoints the push service actively
    /// disowns (404/410) are deleted — that is the only signal a browser gives
    /// that a subscription is gone for good, and keeping them would mean
    /// retrying forever.
    pub async fn broadcast(&self, payload: &PushPayload) -> usize {
        let subscriptions = match self.subscriptions().await {
            Ok(subscriptions) => subscriptions,
            Err(e) => {
                tracing::warn!("[AgentDeck][Push] Could not read subscriptions: {e}");
                return 0;
            }
        };
        if subscriptions.is_empty() {
            return 0;
        }

        let body = match serde_json::to_vec(payload) {
            Ok(body) => body,
            Err(e) => {
                tracing::warn!("[AgentDeck][Push] Payload is not serializable: {e}");
                return 0;
            }
        };

        let mut delivered = 0;
        for subscription in subscriptions {
            match self.send_one(&subscription, &body, &payload.tag).await {
                Ok(()) => {
                    delivered += 1;
                    let _ = sqlx::query(
                        "UPDATE push_subscriptions SET last_success = CURRENT_TIMESTAMP WHERE endpoint = ?1",
                    )
                    .bind(&subscription.endpoint)
                    .execute(&self.pool)
                    .await;
                }
                Err(e) => {
                    if matches!(e, PushFailure::Gone(_)) {
                        tracing::info!(
                            "[AgentDeck][Push] Dropping subscription the push service disowned: {e}"
                        );
                        let _ = self.unsubscribe(&subscription.endpoint).await;
                    } else {
                        tracing::warn!("[AgentDeck][Push] Delivery failed: {e}");
                    }
                }
            }
        }
        delivered
    }

    /// Encrypt, sign, and POST a single push.
    async fn send_one(
        &self,
        subscription: &StoredSubscription,
        body: &[u8],
        tag: &str,
    ) -> std::result::Result<(), PushFailure> {
        let info = SubscriptionInfo::new(
            subscription.endpoint.clone(),
            subscription.p256dh.clone(),
            subscription.auth.clone(),
        );

        let mut signature =
            VapidSignatureBuilder::from_base64(&self.identity.private_key, &info)?;
        signature.add_claim("sub", self.subject.clone());

        let mut message = WebPushMessageBuilder::new(&info);
        message.set_payload(ContentEncoding::Aes128Gcm, body);
        message.set_vapid_signature(signature.build()?);
        // Four hours: long enough to survive a phone that is asleep or off the
        // network for a while, short enough that nobody is paged about a turn
        // that finished yesterday.
        message.set_ttl(60 * 60 * 4);
        message.set_urgency(web_push::Urgency::High);
        // `Topic` lets the push service itself collapse superseded messages
        // while they are still queued, so a phone that comes back online after
        // several events gets the latest one per topic rather than all of them.
        if let Some(topic) = push_topic(tag) {
            message.set_topic(topic);
        }

        // `web-push` builds an `http` v0.2 request, but the daemon's `reqwest`
        // speaks `http` v1 — the two `HeaderMap`/`StatusCode` types do not
        // unify. Rather than pull in a second HTTP stack, the encrypted message
        // is taken apart into plain strings/bytes and reassembled as a reqwest
        // call. The crypto is the part that has to be right, and that is all
        // done by the builder above; this is just header plumbing.
        let message = message.build()?;
        let mut request = self.http.post(message.endpoint.to_string());
        request = request.header("TTL", message.ttl.to_string());
        if let Some(urgency) = message.urgency {
            request = request.header("Urgency", urgency.to_string());
        }
        if let Some(topic) = &message.topic {
            request = request.header("Topic", topic);
        }
        let content = match message.payload {
            Some(payload) => {
                request = request.header("Content-Encoding", payload.content_encoding.to_str());
                request = request.header("Content-Type", "application/octet-stream");
                for (name, value) in &payload.crypto_headers {
                    request = request.header(*name, value);
                }
                payload.content
            }
            None => Vec::new(),
        };
        request = request.body(content);

        let response = request
            .send()
            .await
            .map_err(|e| PushFailure::Transient(format!("transport error: {e}")))?;

        let status = response.status();
        let response_body = response.bytes().await.unwrap_or_default().to_vec();
        classify_status(status, &response_body)
    }
}

/// Map an HTTP status from the push service onto keep-vs-prune.
///
/// Reimplemented over reqwest's `http` v1 status rather than `web-push`'s
/// `parse_response`, which speaks `http` v0.2 and so cannot be handed a reqwest
/// status code. The rule is the one RFC 8030 defines: 404 and 410 mean the
/// endpoint is permanently gone; everything else is transient.
fn classify_status(status: reqwest::StatusCode, body: &[u8]) -> std::result::Result<(), PushFailure> {
    use reqwest::StatusCode as S;
    if status.is_success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(body);
    let message = format!("push service returned {status}: {detail}");
    Err(match status {
        S::GONE | S::NOT_FOUND => PushFailure::Gone(message),
        _ => PushFailure::Transient(message),
    })
}

/// A `Topic` header value derived from the notification tag.
///
/// RFC 8030 restricts topics to at most 32 base64url characters, while tags are
/// readable strings containing session UUIDs. Anything that does not already
/// fit is dropped rather than truncated, because a truncated topic could
/// collide with an unrelated one and suppress the wrong notification.
fn push_topic(tag: &str) -> Option<String> {
    if tag.is_empty() || tag.len() > 32 {
        return None;
    }
    tag.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        .then(|| tag.to_string())
}

/// Build the notification a lifecycle event should page the user with, or
/// `None` when the event is not one worth interrupting for.
///
/// Three moments qualify, matching `notify_on` in the daemon config:
/// - `agent_completed` — the turn finished; the user can come back.
/// - `permission_required` — an agent is blocked on an approval or a question.
/// - `StateChange` to `error` — the agent died; without this a failed turn
///   looks like silence forever.
///
/// Turn *completion* is keyed on `agent_completed`, never on the `idle`
/// StateChange, because `idle` is also broadcast by the resume endpoint when no
/// turn ran at all — keying on it would page the user about nothing.
fn notification_for(
    event_kind: &str,
    payload: &serde_json::Value,
    session_id: &str,
    session_name: &str,
) -> Option<PushPayload> {
    // Per-session-per-kind tag: a repeat of the same kind for the same session
    // replaces its notification rather than stacking. The id (not the name)
    // keeps it unique even when two sessions share a title.
    let tag = format!("agentdeck-{event_kind}-{session_id}");
    // Deep link straight to the session, so a tap on the notification lands on
    // the thing that paged you rather than the session list.
    let url = format!("/session/{session_id}");

    match event_kind {
        "agent_completed" => Some(PushPayload {
            title: "Task finished".to_string(),
            body: format!("{session_name} finished its turn."),
            tag,
            url,
            kind: "session_completed".to_string(),
            session_id: Some(session_id.to_string()),
        }),
        "permission_required" => {
            // Prefer the concrete ask over a generic line: "Allow `git push`?"
            // is actionable from a lock screen; "needs approval" is not.
            let detail = payload
                .get("tool_name")
                .and_then(|v| v.as_str())
                .map(|tool| format!("Approval needed for `{tool}`"))
                .or_else(|| {
                    payload
                        .get("prompt")
                        .and_then(|v| v.as_str())
                        .map(|prompt| truncate(prompt, 120))
                })
                .unwrap_or_else(|| "Approval needed".to_string());
            Some(PushPayload {
                title: "Approval needed".to_string(),
                body: format!("{session_name}: {detail}"),
                tag,
                url,
                kind: "approval_required".to_string(),
                session_id: Some(session_id.to_string()),
            })
        }
        _ => None,
    }
}

/// Trim a notification body to a sane length, never splitting a character.
fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Subscribe to the broadcast hub and page subscribed devices when an agent
/// finishes, needs an approval, or errors out.
///
/// Runs alongside the other hub listeners (`verification`, `plans`) with the
/// same shape: one `tokio::spawn`, a `broadcast::Receiver`, and a match over
/// event kinds. It never blocks the hub — sends are awaited inside the task,
/// and a slow or dead push service only delays this task, not the agents.
///
/// This does not check whether the user is looking at the dashboard. That is
/// deliberately the service worker's job: it is the only place that can see
/// `clients.matchAll`, so it decides whether to surface a delivered push. The
/// daemon stays simple and correct by always sending.
pub fn spawn(state: &crate::config::AppState) {
    let service = state.push.clone();
    let session_manager = state.session_manager.clone();
    let mut rx = state.broadcast.subscribe();

    tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let (kind, session_id, payload) = match &event.message {
                crate::websocket::WsMessage::AgentEvent { event } => {
                    (event.kind.as_str(), event.session_id.clone(), event.payload.clone())
                }
                // The daemon turns a failed turn into an `error` StateChange;
                // surface it so a dead agent isn't silent.
                crate::websocket::WsMessage::StateChange { session_id, state }
                    if state == "error" =>
                {
                    ("agent_error", session_id.clone(), serde_json::Value::Null)
                }
                _ => continue,
            };

            let payload = match kind {
                "agent_completed" | "permission_required" => {
                    let name = session_label(&session_manager, &session_id).await;
                    notification_for(kind, &payload, &session_id, &name)
                }
                "agent_error" => {
                    let name = session_label(&session_manager, &session_id).await;
                    Some(PushPayload {
                        title: "Agent stopped".to_string(),
                        body: format!("{name} hit an error and stopped."),
                        tag: format!("agentdeck-error-{session_id}"),
                        url: format!("/session/{session_id}"),
                        kind: "error".to_string(),
                        session_id: Some(session_id.clone()),
                    })
                }
                _ => None,
            };

            if let Some(payload) = payload {
                let delivered = service.broadcast(&payload).await;
                if delivered > 0 {
                    tracing::debug!(
                        "[AgentDeck][Push] Sent {kind} for session {session_id} to {delivered} device(s)"
                    );
                }
            }
        }
    });
}

/// A short, human name for a session — its title if known, else the bare id.
async fn session_label(
    session_manager: &crate::sessions::manager::SessionManager,
    session_id: &str,
) -> String {
    session_manager
        .get_session(session_id)
        .await
        .ok()
        .flatten()
        .map(|session| session.name)
        .unwrap_or_else(|| session_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_identity_round_trips_through_the_signer() {
        let identity = VapidIdentity::generate();
        // The private key has to be usable by the signer, and the public key
        // has to be the one the signer derives — otherwise browsers would
        // subscribe against a key the daemon cannot sign for.
        let builder = VapidSignatureBuilder::from_base64_no_sub(&identity.private_key)
            .expect("generated private key should be a valid P-256 scalar");
        assert_eq!(
            identity.public_key(),
            URL_SAFE_NO_PAD.encode(builder.get_public_key()),
        );
    }

    #[test]
    fn public_key_is_an_uncompressed_p256_point() {
        let identity = VapidIdentity::generate();
        let decoded = URL_SAFE_NO_PAD
            .decode(identity.public_key())
            .expect("public key should be base64url");
        // Browsers reject an applicationServerKey that is not exactly 65 bytes
        // starting with the 0x04 uncompressed-point marker.
        assert_eq!(decoded.len(), 65);
        assert_eq!(decoded[0], 4);
    }

    #[test]
    fn each_identity_is_distinct() {
        assert_ne!(
            VapidIdentity::generate().public_key(),
            VapidIdentity::generate().public_key(),
        );
    }

    #[test]
    fn topics_only_survive_when_the_rfc_allows_them() {
        assert_eq!(push_topic("finished").as_deref(), Some("finished"));
        assert_eq!(push_topic("agentdeck-approval").as_deref(), Some("agentdeck-approval"));
        // Too long for the header: better no topic than a colliding one.
        assert_eq!(push_topic("approval-3c8e0309-e0ab-46a7-830d-51c4dbf5fdab"), None);
        // Not base64url.
        assert_eq!(push_topic("needs approval"), None);
        assert_eq!(push_topic(""), None);
    }

    #[test]
    fn only_a_disowned_endpoint_is_pruned() {
        use reqwest::StatusCode;

        let is_gone = |status: StatusCode| -> bool {
            matches!(classify_status(status, b""), Err(PushFailure::Gone(_)))
        };
        let is_ok = |status: StatusCode| -> bool { classify_status(status, b"").is_ok() };

        // A 2xx is delivery accepted.
        assert!(is_ok(StatusCode::CREATED), "201 should succeed");
        assert!(is_ok(StatusCode::OK), "200 should succeed");

        // The push service is telling us the browser dropped this subscription.
        assert!(is_gone(StatusCode::GONE), "410 should prune");
        assert!(is_gone(StatusCode::NOT_FOUND), "404 should prune");

        // Everything else is a bad day for the push service or our network, not
        // a dead subscription — pruning here would silently stop paging a user
        // who is still subscribed.
        assert!(!is_gone(StatusCode::SERVICE_UNAVAILABLE), "503 should retry");
        assert!(!is_gone(StatusCode::TOO_MANY_REQUESTS), "429 should retry");
        assert!(!is_gone(StatusCode::UNAUTHORIZED), "401 should retry");
        assert!(!is_gone(StatusCode::BAD_REQUEST), "400 should retry");
    }

    #[test]
    fn subscription_input_parses_the_browser_json_verbatim() {
        // Exactly what `PushSubscription.toJSON()` produces, so the dashboard
        // can forward it without reshaping.
        let raw = serde_json::json!({
            "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
            "expirationTime": null,
            "keys": {
                "p256dh": "BGa4N1PI79lboMR_YrwCiCsgp35DRvedt7opHcf0yM3iOBTSoQYqQLwWxAfRKE6tsDnReWmhsImkhDF_DBdkNSU",
                "auth": "EvcWjEgzr4rbvhfi3yds0A"
            }
        });
        let parsed: PushSubscriptionInput = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.endpoint, "https://fcm.googleapis.com/fcm/send/abc123");
        assert_eq!(parsed.keys.auth, "EvcWjEgzr4rbvhfi3yds0A");
        assert!(parsed.label.is_none());
    }

    #[test]
    fn completion_pages_with_a_deep_link_to_the_session() {
        let payload = notification_for("agent_completed", &serde_json::json!({}), "sess-42", "Fix auth")
            .expect("agent_completed should page");
        assert_eq!(payload.title, "Task finished");
        assert_eq!(payload.body, "Fix auth finished its turn.");
        // A tap must land on the session, not the list.
        assert_eq!(payload.url, "/session/sess-42");
        assert_eq!(payload.session_id.as_deref(), Some("sess-42"));
        assert_eq!(payload.kind, "session_completed");
        // Per-session-per-kind, so a second completion replaces the first.
        assert_eq!(payload.tag, "agentdeck-agent_completed-sess-42");
    }

    #[test]
    fn approval_prefers_the_concrete_ask() {
        // A tool name is the most actionable thing to show on a lock screen.
        let with_tool = notification_for(
            "permission_required",
            &serde_json::json!({ "tool_name": "git push" }),
            "s1",
            "Deploy",
        )
        .unwrap();
        assert_eq!(with_tool.title, "Approval needed");
        assert!(
            with_tool.body.contains("git push"),
            "body should name the tool, got {:?}",
            with_tool.body
        );

        // Otherwise fall back to the prompt text.
        let with_prompt = notification_for(
            "permission_required",
            &serde_json::json!({ "prompt": "Allow this edit?" }),
            "s1",
            "Deploy",
        )
        .unwrap();
        assert!(with_prompt.body.contains("Allow this edit?"));

        // And to a generic line when the payload carries neither.
        let bare = notification_for("permission_required", &serde_json::json!({}), "s1", "Deploy").unwrap();
        assert!(bare.body.contains("Approval needed"));
    }

    #[test]
    fn unrelated_events_do_not_page() {
        // Tool chatter, messages, and the like must not interrupt the user.
        assert!(notification_for("tool_started", &serde_json::json!({}), "s1", "x").is_none());
        assert!(notification_for("agent_started", &serde_json::json!({}), "s1", "x").is_none());
        assert!(notification_for("", &serde_json::json!({}), "s1", "x").is_none());
    }

    #[test]
    fn long_prompts_are_truncated_without_splitting_a_character() {
        // A 200-char prompt with a multibyte char at the boundary must not panic
        // or emit a broken codepoint.
        let long = "é".repeat(200);
        let payload =
            notification_for("permission_required", &serde_json::json!({ "prompt": long }), "s1", "x")
                .unwrap();
        // Body is "x: <truncated prompt>"; the prompt itself caps at 120 chars.
        assert!(payload.body.chars().count() <= "x: ".chars().count() + 120);
        assert!(payload.body.ends_with('…'));
    }
}

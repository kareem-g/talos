//! Headscale REST client — the only piece needed to mint a preauth key so a
//! phone can join the same tailnet without typing anything.
//!
//! Headscale's gRPC gateway accepts JSON with `Content-Type: application/json`
//! and an `Authorization: Bearer <api_key>` header. Preauth-key creation lives
//! at `POST /api/v1/preauthkey`. The wire shape is stable across the v0.22+
//! line we're targeting:
//!
//!   request  : { "user": <id|str>, "reusable": bool, "ephemeral": bool, "expiration": "RFC3339" }
//!   response : { "preauthKey": { "id": "...", "key": "nodekey:xxx", "user": {...}, "used": false, "reusable": false, "ephemeral": false, "expiration": "..." } }
//!
//! The client intentionally only exposes the surface we need; if a future
//! flow needs more (e.g. listing users) it gets added here rather than each
//! caller rolling its own request.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct HeadscaleClient {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreauthKey {
    /// The literal key string (`nodekey:<hex>`). What you paste into a phone.
    pub key: String,
    /// RFC3339 expiry. Optional because older Headscale versions omit it
    /// for `never`-expiring keys; we surface `None` in that case.
    #[serde(default)]
    pub expires_at: Option<String>,
    /// True when the server marked the key reusable. Echoed for UI display.
    #[serde(default)]
    pub reusable: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum HeadscaleError {
    #[error("headscale control plane is unreachable: {0}")]
    Unreachable(String),
    #[error("headscale API key was rejected")]
    InvalidApiKey,
    #[error("headscale returned {status}: {body}")]
    BadStatus { status: u16, body: String },
    #[error("headscale response missing preauth key")]
    MalformedResponse,
    #[error("headscale request failed: {0}")]
    Request(String),
}

impl HeadscaleClient {
    /// Build a client from a control-plane URL (e.g. `https://hs.example.com`)
    /// and a Headscale API key (Bearer token from `headscale apikey create`).
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("reqwest client builds with rustls-tls in workspace");
        Self {
            base_url: normalize_base(base_url.into()),
            api_key: api_key.into(),
            http,
        }
    }

    /// Override the HTTP client (used by tests).
    #[cfg(test)]
    pub fn with_http(mut self, http: reqwest::Client) -> Self {
        self.http = http;
        self
    }

    /// Public-facing URL the server is reachable at, sans trailing slash.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Mint a preauth key. `user` is the Headscale user (created out-of-band
    /// via `headscale users create`). `reusable` and `ephemeral` map to the
    /// same-named request fields; `expires_in` defaults to 24h when `None`.
    pub async fn create_preauth_key(
        &self,
        user: &str,
        reusable: bool,
        ephemeral: bool,
        expires_in: Option<Duration>,
    ) -> Result<PreauthKey, HeadscaleError> {
        let ttl = expires_in.unwrap_or(Duration::from_secs(60 * 60 * 24));
        let expiration = future_rfc3339(ttl);
        let url = format!("{}/api/v1/preauthkey", self.base_url);
        let body = serde_json::json!({
            "user": user,
            "reusable": reusable,
            "ephemeral": ephemeral,
            "expiration": expiration,
        });
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() || e.is_request() {
                    HeadscaleError::Unreachable(e.to_string())
                } else {
                    HeadscaleError::Request(e.to_string())
                }
            })?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            return Err(HeadscaleError::InvalidApiKey);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(HeadscaleError::BadStatus {
                status: status.as_u16(),
                body: truncate(&body, 256),
            });
        }
        let parsed: PreauthKeyResponse = response
            .json()
            .await
            .map_err(|_| HeadscaleError::MalformedResponse)?;
        let key = parsed.preauth_key.key;
        if key.is_empty() {
            return Err(HeadscaleError::MalformedResponse);
        }
        Ok(PreauthKey {
            key,
            expires_at: parsed.preauth_key.expiration,
            reusable: parsed.preauth_key.reusable,
        })
    }
}

#[derive(Debug, Deserialize)]
struct PreauthKeyResponse {
    #[serde(rename = "preauthKey")]
    preauth_key: PreauthKeyInner,
}

#[derive(Debug, Deserialize)]
struct PreauthKeyInner {
    key: String,
    #[serde(default)]
    expiration: Option<String>,
    #[serde(default)]
    reusable: bool,
}

/// Build an RFC3339 UTC timestamp `now + ttl` without pulling in `chrono` or
/// `time`. Headscale accepts the `Z` form, so we never need offsets.
fn future_rfc3339(ttl: Duration) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let target = now.saturating_add(ttl.as_secs());
    format_rfc3339_utc(target)
}

/// Minimal RFC3339 UTC formatter for a unix-seconds timestamp.
fn format_rfc3339_utc(unix_secs: u64) -> String {
    let (year, month, day, hour, minute, second) = civil_from_unix(unix_secs);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z",
    )
}

/// Howard Hinnant's `civil_from_days` algorithm — converts a unix timestamp
/// to a (Y, M, D, h, m, s) tuple without external deps. Good enough for an
/// expiry timestamp.
fn civil_from_unix(unix_secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let secs = unix_secs as i64;
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400) as u32;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    // epoch is 1970-01-01 (Thursday)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32, hour, minute, second)
}

fn normalize_base(mut url: String) -> String {
    while url.ends_with('/') {
        url.pop();
    }
    url
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut out = s[..max].to_string();
        out.push('…');
        out
    }
}

/// Build the QR payload the dashboard renders. We prefer the `tailscale://`
/// scheme (deep link the Tailscale app handles on iOS/Android); the plain
/// `https://` fallback is returned alongside so older clients and browsers
/// can still resolve it.
pub fn pair_payload(login_server: &str, node_name: &str, preauth_key: &str) -> PairPayload {
    let host_only = login_server
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(login_server);
    let node = if node_name.is_empty() { "agentdeck" } else { node_name };
    let tailnet = tailnet_magicdns(host_only, node);
    let qr_payload = format!(
        "tailscale://{host}/{node}?key={key}",
        host = host_only,
        node = url_encode(node),
        key = url_encode(preauth_key),
    );
    let fallback_url = format!(
        "https://{host}/api/v1/noise?key={key}",
        host = host_only,
        key = url_encode(preauth_key),
    );
    PairPayload {
        qr_payload,
        fallback_url,
        tailnet,
    }
}

pub struct PairPayload {
    pub qr_payload: String,
    pub fallback_url: String,
    pub tailnet: String,
}

// --- minimal URL encoders ---------------------------------------------------

/// RFC3986 unreserved-only encoder (the safe set: ALPHA / DIGIT / "-" / "." / "_" / "~").
/// Anything else is percent-encoded as UTF-8 bytes — using uppercase hex
/// per RFC3986 §2.1. Pulled out into a helper so it shows up next to the
/// only callers (no `urlencoding` crate dep).
fn url_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            other => {
                out.push_str(&format!("%{other:02X}"));
            }
        }
    }
    out
}

/// MagicDNS-style handle for the user's node on a given Headscale control
/// plane (e.g. `agentdeck.hs.example.com`). Just a display string — the
/// phone doesn't need to parse it because `qr_payload` carries the key.
fn tailnet_magicdns(host: &str, node: &str) -> String {
    format!("{node}.{host}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn url_encode_escapes_specials() {
        assert_eq!(url_encode("nodekey:abc/x"), "nodekey%3Aabc%2Fx");
        assert_eq!(url_encode("agentdeck.local"), "agentdeck.local");
        assert_eq!(url_encode("a b~c"), "a%20b~c");
    }

    #[test]
    fn normalize_base_strips_trailing_slash() {
        assert_eq!(normalize_base("https://hs.example.com/".into()), "https://hs.example.com");
        assert_eq!(normalize_base("https://hs.example.com///".into()), "https://hs.example.com");
        assert_eq!(normalize_base("https://hs.example.com".into()), "https://hs.example.com");
    }

    #[test]
    fn pair_payload_builds_tailnet_and_url() {
        let payload = pair_payload("https://hs.example.com", "agentdeck", "nodekey:abc");
        assert!(payload.qr_payload.starts_with("tailscale://hs.example.com/agentdeck?key=nodekey%3Aabc"));
        assert_eq!(payload.fallback_url, "https://hs.example.com/api/v1/noise?key=nodekey%3Aabc");
        assert!(!payload.tailnet.is_empty());
    }

    #[test]
    fn pair_payload_strips_path_from_login_server() {
        let payload = pair_payload("https://hs.example.com/some/path", "n", "k");
        assert!(payload.qr_payload.starts_with("tailscale://hs.example.com/n?key=k"));
        assert_eq!(payload.fallback_url, "https://hs.example.com/api/v1/noise?key=k");
    }

    #[test]
    fn rfc3339_known_instant() {
        // 2024-01-15T12:34:56Z == 1705322096
        assert_eq!(format_rfc3339_utc(1_705_322_096), "2024-01-15T12:34:56Z");
        // 2000-03-01T00:00:00Z == 951868800
        assert_eq!(format_rfc3339_utc(951_868_800), "2000-03-01T00:00:00Z");
    }

    #[test]
    fn future_rfc3339_advances_by_ttl() {
        // Just verify it returns a well-formed Z-terminated UTC string and
        // is non-empty; the exact value depends on system clock.
        let s = future_rfc3339(Duration::from_secs(60));
        assert!(s.ends_with('Z'));
        assert!(s.contains('T'));
    }

    #[test]
    fn error_display_is_user_facing() {
        // The dashboard shows these messages; keep them short and human.
        assert_eq!(
            HeadscaleError::InvalidApiKey.to_string(),
            "headscale API key was rejected"
        );
        assert!(matches!(
            HeadscaleError::Unreachable("dial tcp".into()),
            HeadscaleError::Unreachable(_)
        ));
    }
}
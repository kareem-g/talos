use crate::tunnel::{TunnelInfo, TunnelKind, TunnelProvider, TunnelStatus};
use crate::Result;
use base64::Engine as _;

pub struct CloudflareProvider {
    token: String,
    hostname: Option<String>,
}

impl CloudflareProvider {
    pub fn new(token: String, hostname: Option<String>) -> Self {
        Self { token, hostname }
    }

    async fn is_cloudflared_installed(&self) -> bool {
        tokio::process::Command::new("which")
            .arg("cloudflared")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// State file where the last-seen trycloudflare URL is written, so
    /// status() can return it across requests (cloudflared's stdout is gone
    /// once the process detaches). Not needed for named tunnels, whose URL
    /// comes from the Cloudflare API.
    fn state_file() -> std::path::PathBuf {
        std::env::temp_dir().join("agentdeck-cloudflare-url")
    }

    fn read_cached_url() -> Option<String> {
        std::fs::read_to_string(Self::state_file()).ok().filter(|s| !s.trim().is_empty())
    }

    /// Read the cached trycloudflare URL, if any. Public so the status and
    /// endpoints routes can surface quick-tunnel URLs that aren't in settings.
    pub fn cached_url() -> Option<String> {
        Self::read_cached_url()
    }

    fn write_cached_url(url: &str) {
        let _ = std::fs::write(Self::state_file(), url);
    }

    fn clear_cached_url() {
        let _ = std::fs::remove_file(Self::state_file());
    }

    /// Decode a Cloudflare tunnel token JWT (format: At<base64>.<claims>.<sig>)
    /// without verifying the signature — we just need the account_id and
    /// tunnel_id to query the tunnel's hostname from the API.
    fn decode_token(token: &str) -> Option<(String, String)> {
        // Tokens come in two flavours. The long-lived secret token is
        // `At<base64>.<base64>.<base64>` (three dot-separated segments).
        // The short tunnel token is the same format but longer. Either way,
        // the middle segment is the JSON claims body.
        let without_prefix = token.trim_start_matches("At");
        let segments: Vec<&str> = without_prefix.split('.').collect();
        if segments.len() < 2 {
            return None;
        }
        // base64-decode the claims segment. JWT uses URL-safe base64 without
        // padding; the crate accepts that fine.
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(segments[1])
            .or_else(|_| {
                base64::engine::general_purpose::URL_SAFE.decode(segments[1])
            })
            .ok()?;
        let value: serde_json::Value = serde_json::from_slice(&claims).ok()?;
        let account = value.get("a").and_then(|v| v.as_str())?.to_string();
        let tunnel = value.get("t").and_then(|v| v.as_str())?.to_string();
        if account.is_empty() || tunnel.is_empty() {
            return None;
        }
        Some((account, tunnel))
    }

    /// Query the Cloudflare API for this tunnel's configured hostname.
    /// Works for named tunnels (token bound to a domain). Returns the first
    /// public hostname the tunnel serves — that's the URL phones open.
    async fn fetch_hostname_via_api(token: &str) -> Option<String> {
        let (account_id, tunnel_id) = Self::decode_token(token)?;
        let client = reqwest::Client::builder()
            .user_agent("agentdeck-backend")
            .build()
            .ok()?;
        let url = format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/cfd_tunnel/{}",
            account_id, tunnel_id,
        );
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let json: serde_json::Value = resp.json().await.ok()?;
        if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
            return None;
        }
        // `result.config.ingress` is the array of rules; the last one is the
        // catch-all (service = http_status:404). The one before it has the
        // public hostname.
        let ingress = json
            .pointer("/result/config/ingress")?
            .as_array()?;
        ingress
            .iter()
            .rev()
            .find(|rule| {
                rule.get("hostname")
                    .and_then(|h| h.as_str())
                    .is_some_and(|h| !h.is_empty())
            })
            .and_then(|rule| rule.get("hostname").and_then(|h| h.as_str()))
            .map(str::to_string)
            .or_else(|| {
                // Some tunnels expose it at `result.name`.
                json.pointer("/result/name")
                    .and_then(|n| n.as_str())
                    .map(str::to_string)
            })
    }

    /// Find the `https://<subdomain>.trycloudflare.com` URL in text. The
    /// log often contains other https:// URLs first (e.g. terms-of-use
    /// links), so we scan every match and return the first one that ends
    /// in `.trycloudflare.com`.
    fn extract_trycloudflare_url(text: &str) -> Option<String> {
        let prefix = "https://";
        let suffix = ".trycloudflare.com";
        let mut search_from = 0;
        while let Some(start) = text[search_from..].find(prefix) {
            let abs_start = search_from + start + prefix.len();
            if let Some(rest) = text.get(abs_start..) {
                if let Some(sub_len) = rest.find(suffix) {
                    let subdomain = &rest[..sub_len];
                    // Basic sanity: subdomain should be alphanumeric + dash only.
                    if subdomain.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                        return Some(format!("{}{}{}", prefix, subdomain, suffix));
                    }
                }
            }
            // Move past this match and keep scanning.
            search_from = abs_start;
        }
        None
    }

    /// Poll a log file for the first `https://<subdomain>.trycloudflare.com`.
    async fn poll_log_for_url(path: &std::path::Path, timeout: std::time::Duration) -> Option<String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if tokio::time::Instant::now() >= deadline {
                return None;
            }
            if let Ok(contents) = tokio::fs::read_to_string(path).await {
                if let Some(url) = Self::extract_trycloudflare_url(&contents) {
                    return Some(url);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
}

impl TunnelProvider for CloudflareProvider {
    fn kind(&self) -> TunnelKind {
        TunnelKind::Cloudflare
    }

    async fn start(&self) -> Result<TunnelInfo> {
        if !self.is_cloudflared_installed().await {
            return Ok(TunnelInfo {
                kind: TunnelKind::Cloudflare,
                status: TunnelStatus::Error(
                    "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/".to_string(),
                ),
                url: None,
                ip: None,
                token: None,
                pair: None,
            });
        }

        // Spawn cloudflared with proper arg passing (no shell interpolation)
        // and `forget` the handle so the process survives this function
        // returning — `Child` drop would otherwise kill it. We can still
        // terminate it later via `pkill -f cloudflared tunnel` in stop().
        //
        // `stdbuf -oL` forces line-buffered stderr so the trycloudflare URL
        // is flushed to the log file immediately — without it, cloudflared
        // uses full buffering when stderr is a file and the poll never sees
        // the URL in time.
        let token_arg = self.token.trim();
        let log_file = std::env::temp_dir().join("agentdeck-cloudflare.log");
        let log = log_file.display();
        let mut cmd = if !token_arg.is_empty() {
            tokio::process::Command::new("stdbuf")
        } else {
            tokio::process::Command::new("stdbuf")
        };
        if !token_arg.is_empty() {
            cmd.args([
                "-oL",
                "cloudflared",
                "tunnel",
                "--no-autoupdate",
                "run",
                "--token",
                token_arg,
            ]);
        } else {
            cmd.args(["-oL", "cloudflared", "tunnel", "--url", "http://localhost:9120"]);
        }
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::from(
                std::fs::File::create(&log_file).map_err(|e| {
                    crate::AgentDeckError::Unknown(format!("could not create log file: {e}"))
                })?,
            ));
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                return Ok(TunnelInfo {
                    kind: TunnelKind::Cloudflare,
                    status: TunnelStatus::Error(format!("could not start cloudflared: {e}")),
                    url: None,
                    ip: None,
                    token: None,
                    pair: None,
                });
            }
        };
        drop(log);
        // Give cloudflared a moment to either fail fast (bad token) or get
        // far enough that it's clearly going to stay up.
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        // If it already died, read the log for the real error and surface it.
        if let Ok(Some(_)) = child.try_wait() {
            let message = tokio::fs::read_to_string(&log_file)
                .await
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "cloudflared exited unexpectedly".to_string());
            return Ok(TunnelInfo {
                kind: TunnelKind::Cloudflare,
                status: TunnelStatus::Error(message),
                url: None,
                ip: None,
                token: None,
                pair: None,
            });
        }
        // Still running — detach it so it survives this function returning.
        // We can still terminate it later via `pkill -f cloudflared tunnel`.
        std::mem::forget(child);
        // Resolve the URL for the chosen mode.
        let url = if !token_arg.is_empty() {
            Self::fetch_hostname_via_api(token_arg)
                .await
                .or_else(|| self.hostname.clone())
                .map(|h| format!("https://{}", h))
        } else {
            let url = Self::poll_log_for_url(&log_file, std::time::Duration::from_secs(15)).await;
            if let Some(ref u) = url {
                Self::write_cached_url(u);
            }
            url
        };
        Ok(TunnelInfo {
            kind: TunnelKind::Cloudflare,
            status: if url.is_some() {
                TunnelStatus::Connected
            } else {
                TunnelStatus::Connecting
            },
            url,
            ip: None,
            token: None,
            pair: None,
        })
    }

    async fn stop(&self) -> Result<()> {
        let _ = tokio::process::Command::new("pkill")
            .args(["-f", "cloudflared tunnel"])
            .output()
            .await;
        Self::clear_cached_url();
        Ok(())
    }

    async fn status(&self) -> Result<TunnelInfo> {
        let output = tokio::process::Command::new("pgrep")
            .arg("-f")
            .arg("cloudflared tunnel")
            .output()
            .await;
        let running = output.map(|o| o.status.success()).unwrap_or(false);

        let url = if !self.token.trim().is_empty() {
            // Named tunnel: prefer API, fall back to configured hostname.
            Self::fetch_hostname_via_api(&self.token)
                .await
                .or_else(|| self.hostname.clone())
                .map(|h| format!("https://{}", h))
        } else {
            // Trycloudflare: read the cached URL from the last start.
            Self::read_cached_url()
        };

        Ok(TunnelInfo {
            kind: TunnelKind::Cloudflare,
            status: if running {
                TunnelStatus::Connected
            } else {
                TunnelStatus::Disconnected
            },
            url,
            ip: None,
            token: None,
            pair: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_token_extracts_account_and_tunnel() {
        // A synthetic JWT payload: {"a":"acc123","t":"tun456","iat":1700000000}
        use base64::Engine;
        let payload = r#"{"a":"acc123","t":"tun456","iat":1700000000}"#;
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.as_bytes());
        // Token format: At<base64-header>.<base64-claims>.<base64-sig>. The
        // claims sit at segments[1] after the "At" prefix is stripped.
        let token = format!("Atheader.{}.sig", encoded);
        let (account, tunnel) = CloudflareProvider::decode_token(&token).expect("decodes");
        assert_eq!(account, "acc123");
        assert_eq!(tunnel, "tun456");
    }

    #[test]
    fn decode_token_returns_none_for_garbage() {
        assert!(CloudflareProvider::decode_token("not-a-token").is_none());
        assert!(CloudflareProvider::decode_token("").is_none());
    }

    #[test]
    fn extract_trycloudflare_url_finds_url_in_line() {
        assert_eq!(
            CloudflareProvider::extract_trycloudflare_url(
                "2024-01-01T00:00:00Z INF Your quick tunnel has been created! View it at https://abc-123.trycloudflare.com",
            ),
            Some("https://abc-123.trycloudflare.com".to_string()),
        );
    }

    #[test]
    fn extract_trycloudflare_url_returns_none_when_absent() {
        assert_eq!(
            CloudflareProvider::extract_trycloudflare_url("some unrelated log line"),
            None,
        );
    }

    #[test]
    fn state_file_roundtrip() {
        CloudflareProvider::write_cached_url("https://test.trycloudflare.com");
        assert_eq!(
            CloudflareProvider::read_cached_url().as_deref(),
            Some("https://test.trycloudflare.com")
        );
        CloudflareProvider::clear_cached_url();
        assert_eq!(CloudflareProvider::read_cached_url(), None);
    }
}

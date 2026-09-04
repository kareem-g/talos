//! Headscale — a self-hosted Tailscale control plane as a tunnel kind.
//!
//! Wire-wise Headscale IS Tailscale (same `tailscale0`, same MagicDNS, same
//! QR pairing flow), so everything downstream — endpoint resolution, pairing,
//! the phone client — works unchanged once the node is logged in. This
//! provider only owns the login/logout half: `tailscale up --login-server`
//! against the user's control plane, plus honest status reporting that names
//! the control plane instead of assuming Tailscale.com.
//!
//! When the operator has stored a Headscale admin API key in settings, the
//! provider also mints a preauth key via the control-plane REST gateway
//! after a successful login, so a phone can join the same tailnet by
//! scanning the QR the dashboard renders.

use crate::headscale::{pair_payload, HeadscaleClient, HeadscaleError, PairPayload, PreauthKey};
use crate::tunnel::{
    classify_error, PairInfo, TunnelErrorKind, TunnelInfo, TunnelKind, TunnelProvider,
    TunnelStatus,
};
use crate::Result;
use std::time::Duration;

const DEFAULT_USER: &str = "agentdeck";
const PREAUTH_TTL: Duration = Duration::from_secs(60 * 60 * 24); // 24h

#[derive(Debug, Clone)]
pub struct HeadscaleProvider {
    login_server: Option<String>,
    auth_key: Option<String>,
    hostname: String,
    /// Headscale admin API key (optional). When present, used to mint
    /// preauth keys after a successful login.
    api_key: Option<String>,
    /// Headscale user the preauth key is bound to.
    user: String,
}

impl HeadscaleProvider {
    pub fn new(
        login_server: Option<String>,
        auth_key: Option<String>,
        hostname: String,
        api_key: Option<String>,
        user: Option<String>,
    ) -> Self {
        Self {
            login_server,
            auth_key,
            hostname,
            api_key,
            user: user.unwrap_or_else(|| DEFAULT_USER.to_string()),
        }
    }

    async fn current(&self) -> TunnelInfo {
        let running = tokio::process::Command::new("tailscale")
            .args(["status"])
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !running {
            return TunnelInfo {
                kind: TunnelKind::Headscale,
                status: TunnelStatus::Disconnected,
                url: None,
                ip: None,
                token: None,
                pair: None,
            };
        }
        let via = crate::tunnel::tailscale::control_plane_label().await;
        let headscale = via.as_deref().is_some_and(|v| v.starts_with("headscale"));
        // Reachability is the tailnet IP; the label says which control plane.
        let ip = tailscale_ip().await;
        let status = match (&ip, headscale) {
            (Some(_), true) => TunnelStatus::Connected,
            (Some(_), false) => TunnelStatus::Error(
                "Tailnet is up on Tailscale.com, not Headscale — log in with your Headscale server below.".to_string(),
            ),
            (None, _) => TunnelStatus::Error("Tailnet up but no tailscale0 address found".to_string()),
        };
        TunnelInfo {
            kind: TunnelKind::Headscale,
            status,
            url: ip.as_ref().map(|ip| format!("http://{ip}:9120")),
            ip,
            token: None,
            pair: None,
        }
    }

    /// Mint a preauth key and build the QR payload. Returns `Ok(None)` when
    /// no API key is configured (caller just sees a Connected status with no
    /// `pair` field). On failure, returns the classified kind so the route
    /// can surface a useful error.
    async fn maybe_pair(&self, login_server: &str, ip: Option<&str>) -> Option<PairInfo> {
        let key = self.api_key.as_deref()?.trim();
        if key.is_empty() {
            return None;
        }
        let server = login_server.trim();
        if server.is_empty() {
            return None;
        }
        let client = HeadscaleClient::new(server, key);
        let preauth: PreauthKey = match client
            .create_preauth_key(&self.user, true, false, Some(PREAUTH_TTL))
            .await
        {
            Ok(k) => k,
            Err(HeadscaleError::InvalidApiKey) => {
                tracing::warn!("headscale API key rejected by control plane");
                return None;
            }
            Err(HeadscaleError::Unreachable(reason)) => {
                tracing::warn!(reason = %reason, "headscale API unreachable while minting preauth");
                return None;
            }
            Err(other) => {
                tracing::warn!(error = %other, "headscale preauth mint failed");
                return None;
            }
        };
        let node = ip.unwrap_or(&self.hostname);
        let payload: PairPayload = pair_payload(server, node, &preauth.key);
        Some(PairInfo {
            qr_payload: payload.qr_payload,
            fallback_url: payload.fallback_url,
            tailnet: payload.tailnet,
            expires_at: preauth.expires_at,
            key: preauth.key,
        })
    }
}

async fn tailscale_ip() -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args(["-4", "-o", "addr", "show", "dev", "tailscale0"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        for token in line.split_whitespace() {
            let addr = token.split('/').next().unwrap_or(token);
            if addr.parse::<std::net::Ipv4Addr>().is_ok() && !addr.starts_with("127.") {
                return Some(addr.to_string());
            }
        }
    }
    None
}

impl TunnelProvider for HeadscaleProvider {
    fn kind(&self) -> TunnelKind {
        TunnelKind::Headscale
    }

    async fn start(&self) -> Result<TunnelInfo> {
        let Some(server) = self.login_server.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
            // No server given: just report — a node already on Headscale
            // shows Connected with nothing to type.
            return Ok(self.current().await);
        };

        // tailscaled must be up before any of `tailscale up` makes sense.
        // Try a one-shot systemctl start first so the user doesn't have to
        // open a terminal just to bring the daemon online.
        if !crate::tunnel::tailscale::is_daemon_running().await
            && !crate::tunnel::tailscale::ensure_daemon().await
        {
            return Ok(TunnelInfo {
                kind: TunnelKind::Headscale,
                status: TunnelStatus::Error(format!(
                    "{}:Tailscaled isn't running and we couldn't start it. Check `systemctl status tailscaled`.",
                    TunnelErrorKind::DaemonNotRunning.as_str(),
                )),
                url: None,
                ip: None,
                token: None,
                pair: None,
            });
        }

        // Try to log in. `tailscale::login` already auto-elevates the operator
        // on `checkprefs access denied`, so this path is recoverable without
        // the dashboard prompting separately.
        let login_result = crate::tunnel::tailscale::login(
            Some(server),
            self.auth_key.as_deref(),
            Some(&self.hostname),
        )
        .await;
        if let Err(error) = login_result {
            // Map known stderr to structured kinds so the UI can show a
            // targeted button. Anything we don't recognise still surfaces
            // as a generic tailscale_failed with the first line of stderr.
            let kind = match classify_error(&error.to_string()) {
                TunnelErrorKind::TailscaleFailed(_) => TunnelErrorKind::TailscaleFailed(
                    error.to_string().lines().next().unwrap_or("tailscale up failed").to_string(),
                ),
                other => other,
            };
            return Ok(TunnelInfo {
                kind: TunnelKind::Headscale,
                status: TunnelStatus::Error(format!("{}:{}", kind.as_str(), error)),
                url: None,
                ip: None,
                token: None,
                pair: None,
            });
        }

        let mut info = self.current().await;
        if matches!(info.status, TunnelStatus::Connected) {
            // We only mint a preauth key once login is healthy. Failures
            // here are non-fatal: the user is online, just no QR.
            if let Some(pair) = self
                .maybe_pair(server, info.ip.as_deref())
                .await
            {
                info.pair = Some(pair);
            }
        }
        Ok(info)
    }

    async fn stop(&self) -> Result<()> {
        // Logging out drops the whole tailnet (Headscale and Tailscale.com
        // share the one `tailscaled`) — that IS the disconnect here.
        crate::tunnel::tailscale::logout().await
    }

    async fn status(&self) -> Result<TunnelInfo> {
        Ok(self.current().await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_api_key_means_no_pair_attempt() {
        let provider = HeadscaleProvider::new(
            Some("https://hs.example.com".into()),
            None,
            "agentdeck".into(),
            None,
            None,
        );
        // The provider stores None for `api_key`, so `maybe_pair` short-
        // circuits. We can't easily exercise the async minting path here
        // without an HTTP mock; the HeadscaleClient unit tests cover it.
        assert!(provider.api_key.is_none());
        assert_eq!(provider.user, DEFAULT_USER);
    }

    #[test]
    fn user_falls_back_to_default() {
        let provider = HeadscaleProvider::new(None, None, "agentdeck".into(), None, None);
        assert_eq!(provider.user, DEFAULT_USER);
    }

    #[test]
    fn user_override_wins() {
        let provider = HeadscaleProvider::new(
            None,
            None,
            "agentdeck".into(),
            None,
            Some("kareem".into()),
        );
        assert_eq!(provider.user, "kareem");
    }
}
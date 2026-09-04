pub mod tailscale;
pub mod headscale;
pub mod cloudflare;
pub mod resolver;

use crate::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairInfo {
    /// Payload the dashboard renders as a QR (e.g. `tailscale://...`).
    pub qr_payload: String,
    /// Plain-https URL the Tailscale app can open if it doesn't honour the
    /// deep link.
    pub fallback_url: String,
    /// Human-readable MagicDNS handle of the node on this control plane.
    pub tailnet: String,
    /// RFC3339 expiry of the underlying preauth key, when the server returns it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Underlying preauth key — surfaced for copy-to-clipboard.
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelInfo {
    pub kind: TunnelKind,
    pub status: TunnelStatus,
    pub url: Option<String>,
    pub ip: Option<String>,
    /// Connection token for token-based kinds, when active.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// Phone-pairing payload, when this kind offers one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pair: Option<PairInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TunnelKind {
    Tailscale,
    Headscale,
    Cloudflare,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TunnelStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

#[allow(async_fn_in_trait)]
pub trait TunnelProvider: Send + Sync {
    fn kind(&self) -> TunnelKind;
    async fn start(&self) -> Result<TunnelInfo>;
    async fn stop(&self) -> Result<()>;
    async fn status(&self) -> Result<TunnelInfo>;
}

/// Categorised failure reason for a tunnel action — surfaced in JSON
/// responses so the dashboard can render targeted next-step buttons instead
/// of dumping raw stderr.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TunnelErrorKind {
    /// tailscaled refused the call because the current user is not its
    /// operator. Recoverable via `tailscale set --operator=$USER`.
    NeedsAuthorization,
    /// The configured Headscale control plane URL is unreachable.
    UnreachableControlPlane,
    /// The provided API key or preauth key was rejected.
    InvalidAuthKey,
    /// `tailscaled` itself isn't running and we couldn't auto-start it.
    /// The dashboard should offer a "Start tailscaled" button.
    DaemonNotRunning,
    /// The `tailscale` CLI isn't on PATH at all. Different recovery path:
    /// user has to install it.
    TailscaleNotInstalled,
    /// Anything else — preserves the short first line of stderr for the UI.
    TailscaleFailed(String),
}

impl TunnelErrorKind {
    /// Stable wire identifier used in JSON responses and consumed by the
    /// dashboard's switch-on-error-kind handler.
    pub fn as_str(&self) -> &'static str {
        match self {
            TunnelErrorKind::NeedsAuthorization => "needs_authorization",
            TunnelErrorKind::UnreachableControlPlane => "unreachable_control_plane",
            TunnelErrorKind::InvalidAuthKey => "invalid_auth_key",
            TunnelErrorKind::DaemonNotRunning => "daemon_not_running",
            TunnelErrorKind::TailscaleNotInstalled => "tailscale_not_installed",
            TunnelErrorKind::TailscaleFailed(_) => "tailscale_failed",
        }
    }
}

pub use tailscale::classify_error;

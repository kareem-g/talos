pub mod tailscale;
pub mod cloudflare;
pub mod resolver;

use crate::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelInfo {
    pub kind: TunnelKind,
    pub status: TunnelStatus,
    pub url: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TunnelKind {
    Tailscale,
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

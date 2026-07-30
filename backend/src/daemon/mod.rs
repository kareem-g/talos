pub mod server;
pub mod mdns;

use crate::{config::Config, Result};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct Daemon {
    config: Arc<RwLock<Config>>,
}

#[derive(Debug, Clone)]
pub struct DaemonState {
    pub version: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub sessions_count: usize,
    pub tunnel_status: TunnelStatus,
}

#[derive(Debug, Clone)]
pub enum TunnelStatus {
    Disabled,
    Tailscale { hostname: String, ip: String },
    Cloudflare { url: String },
    Both { tailscale_ip: String, cloudflare_url: String },
}

impl Daemon {
    pub async fn new(config: Config) -> Result<Self> {
        Ok(Self {
            config: Arc::new(RwLock::new(config)),
        })
    }

    pub async fn run(
        &self,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Result<()> {
        let config = self.config.read().await;
        let settings = config.settings().clone();
        drop(config);

        // Start mDNS service
        let mdns_handle = mdns::start_service(&settings).await?;

        // Start HTTP/WebSocket server
        let server_handle = server::start(
            Arc::clone(&self.config),
            settings.server.clone(),
        ).await?;

        // Wait for shutdown signal
        shutdown.changed().await.ok();

        // Graceful shutdown
        mdns_handle.abort();
        server_handle.abort();

        Ok(())
    }
}

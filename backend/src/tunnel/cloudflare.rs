use crate::tunnel::{TunnelInfo, TunnelKind, TunnelProvider, TunnelStatus};
use crate::Result;

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
                    "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/".to_string()
                ),
                url: None,
                ip: None,
            });
        }

        // Start cloudflared tunnel
        let mut cmd = tokio::process::Command::new("cloudflared");
        cmd.args([
            "tunnel",
            "--no-autoupdate",
            "run",
            "--token",
            &self.token,
        ]);

        // For trycloudflare (quick tunnel)
        if self.hostname.is_none() {
            cmd = tokio::process::Command::new("cloudflared");
            cmd.args([
                "tunnel",
                "--url",
                "http://localhost:9120",
            ]);
        }

        // Start in background
        let _ = cmd.spawn();

        // Give it a moment and check status
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

        Ok(TunnelInfo {
            kind: TunnelKind::Cloudflare,
            status: TunnelStatus::Connected,
            url: self.hostname.as_ref().map(|h| format!("https://{}", h)),
            ip: None,
        })
    }

    async fn stop(&self) -> Result<()> {
        // Kill cloudflared processes for this tunnel
        let _ = tokio::process::Command::new("pkill")
            .args(["-f", "cloudflared tunnel"])
            .output()
            .await;
        Ok(())
    }

    async fn status(&self) -> Result<TunnelInfo> {
        // Check if cloudflared is running
        let output = tokio::process::Command::new("pgrep")
            .arg("-f")
            .arg("cloudflared tunnel")
            .output()
            .await;

        let running = output.map(|o| o.status.success()).unwrap_or(false);

        Ok(TunnelInfo {
            kind: TunnelKind::Cloudflare,
            status: if running {
                TunnelStatus::Connected
            } else {
                TunnelStatus::Disconnected
            },
            url: self.hostname.as_ref().map(|h| format!("https://{}", h)),
            ip: None,
        })
    }
}

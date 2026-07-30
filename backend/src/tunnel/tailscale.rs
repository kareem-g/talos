use crate::tunnel::{TunnelInfo, TunnelKind, TunnelProvider, TunnelStatus};
use crate::Result;

pub struct TailscaleProvider {
    _hostname: String,
}

impl TailscaleProvider {
    pub fn new(hostname: String) -> Self {
        Self { _hostname: hostname }
    }

    async fn get_tailscale_ip(&self) -> Option<String> {
        // Try to get tailscale0 interface IP
        let output = tokio::process::Command::new("ip")
            .args(["-4", "addr", "show", "tailscale0"])
            .output()
            .await
            .ok()?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Parse inet line: inet 100.x.x.x/32 ...
        for line in stdout.lines() {
            if line.trim().starts_with("inet ") {
                let parts: Vec<&str> = line.trim().split_whitespace().collect();
                if parts.len() >= 2 {
                    let ip_with_mask = parts[1];
                    if let Some(ip) = ip_with_mask.split('/').next() {
                        return Some(ip.to_string());
                    }
                }
            }
        }
        None
    }

    async fn is_tailscale_running(&self) -> bool {
        tokio::process::Command::new("tailscale")
            .args(["status"])
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

impl TunnelProvider for TailscaleProvider {
    fn kind(&self) -> TunnelKind {
        TunnelKind::Tailscale
    }

    async fn start(&self) -> Result<TunnelInfo> {
        if !self.is_tailscale_running().await {
            return Ok(TunnelInfo {
                kind: TunnelKind::Tailscale,
                status: TunnelStatus::Error(
                    "Tailscale is not running. Run 'sudo tailscale up' first.".to_string()
                ),
                url: None,
                ip: None,
            });
        }

        let ip = self.get_tailscale_ip().await;

        Ok(TunnelInfo {
            kind: TunnelKind::Tailscale,
            status: if ip.is_some() {
                TunnelStatus::Connected
            } else {
                TunnelStatus::Error("Could not determine Tailscale IP".to_string())
            },
            url: ip.as_ref().map(|ip| format!("http://{}:9120", ip)),
            ip,
        })
    }

    async fn stop(&self) -> Result<()> {
        // Tailscale runs as system service, we don't stop it
        Ok(())
    }

    async fn status(&self) -> Result<TunnelInfo> {
        self.start().await
    }
}

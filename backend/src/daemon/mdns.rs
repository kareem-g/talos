use crate::{config::settings::Settings, Result};

pub async fn start_service(settings: &Settings) -> Result<tokio::task::JoinHandle<()>> {
    let mdns = mdns_sd::ServiceDaemon::new()
        .map_err(|e| crate::AgentDeckError::Unknown(e.to_string()))?;

    let service_type = "_agentdeck._tcp.local.";
    let instance_name = "AgentDeck Linux";
    let host_name = settings.tunnel.tailscale.hostname.clone() + ".local.";
    let port = settings.server.port;

    let service_info = mdns_sd::ServiceInfo::new(
        service_type,
        instance_name,
        &host_name,
        "",
        port,
        &[("version", env!("CARGO_PKG_VERSION"))][..],
    ).map_err(|e| crate::AgentDeckError::Unknown(e.to_string()))?;

    mdns.register(service_info)
        .map_err(|e| crate::AgentDeckError::Unknown(e.to_string()))?;

    tracing::info!("mDNS service registered: {} on port {}", instance_name, port);

    let handle = tokio::spawn(async move {
        // Keep mDNS alive
        tokio::signal::ctrl_c().await.ok();
    });

    Ok(handle)
}

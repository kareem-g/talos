//! Reachable endpoint resolver — single source for pairing QR and diagnostics.
//!
//! Priority (spec § TAILNET_REMOTE_CONTROL_PROMPT):
//!   Explicit advertise_base_url → Cloudflare hostname → MagicDNS (`tailscale status --json` self DNSName)
//!   → Tailscale IPv4 (`ip -4 addr show tailscale0`) → Tailscale IPv6 (`ip -6 ... tailscale0`)
//!   → LAN (`hostname -I`) → localhost fallback.
//!
//! IPv6 addrs are bracketed in URLs `[fd7a::1]`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EndpointSource {
    Explicit,
    Cloudflare,
    TailnetMagicDns,
    TailnetIpv4,
    TailnetIpv6,
    Lan,
    Localhost,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReachableEndpoint {
    pub base_url: String,
    pub source: EndpointSource,
    pub host: String,
    pub port: u16,
    pub secure: bool,
    pub reachable: bool,
    /// Control-plane label for tailnet sources ("tailscale" or
    /// "headscale <host>") so clients can say where the path runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
}

/// Try `tailscale status --json` and extract `Self.DNSName` + `Self.Online` + tailnet name.
async fn magic_dns() -> Option<String> {
    let output = tokio::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let dns = v.pointer("/Self/DNSName")?.as_str()?.trim_end_matches('.');
    let online = v.pointer("/Self/Online")?.as_bool().unwrap_or(false);
    if !online || dns.is_empty() {
        return None;
    }
    // Require a tailnet-qualified name (contains dot)
    if !dns.contains('.') {
        return None;
    }
    Some(dns.to_string())
}

async fn tailscale_ip_v4() -> Option<String> {
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

async fn tailscale_ip_v6() -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args(["-6", "-o", "addr", "show", "dev", "tailscale0"])
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
            if addr.parse::<std::net::Ipv6Addr>().is_ok() && addr != "::1" {
                return Some(addr.to_string());
            }
        }
    }
    None
}

async fn lan_ip() -> Option<String> {
    let output = tokio::process::Command::new("hostname")
        .arg("-I")
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        let addr = token.split('/').next().unwrap_or(token);
        if addr.parse::<std::net::Ipv4Addr>().is_ok() && !addr.starts_with("127.") {
            return Some(addr.to_string());
        }
    }
    None
}

fn bracket_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{}]", host)
    } else {
        host.to_string()
    }
}

/// Pick the single row to surface for the tailnet. Preference:
/// `TailnetMagicDns` > `TailnetIpv4` > `TailnetIpv6` (by source), and an
/// entry the probe marked `reachable: true` wins over one it didn't. If
/// everything is unreachable, return the highest-priority candidate anyway
/// so the picker still shows the row with its `down` hint.
fn pick_best_tailnet(mut candidates: Vec<ReachableEndpoint>) -> Option<ReachableEndpoint> {
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by_key(|ep| {
        let source_rank = match ep.source {
            EndpointSource::TailnetMagicDns => 0,
            EndpointSource::TailnetIpv4 => 1,
            EndpointSource::TailnetIpv6 => 2,
            _ => 3,
        };
        // `reachable: false` is sorted *after* reachable entries of the same
        // source by adding a small penalty. We compare source rank first.
        (source_rank, !ep.reachable)
    });
    Some(candidates.remove(0))
}

/// Resolve a reachable endpoint for this daemon.
///
/// `port` is the daemon's listening port. `cloudflare_host` when Some wins over
/// raw IPs. `tailscale_hostname` is the configured `agentdeck` tailnet host — used
/// only as fallback before probing MagicDNS; MagicDNS from `tailscale status --json` wins.
pub async fn resolve_endpoint(
    port: u16,
    cloudflare_host: Option<&str>,
    tailscale_enabled: bool,
    tailscale_hostname: Option<&str>,
    advertise_base_url: Option<&str>,
) -> ReachableEndpoint {
    if let Some(url) = advertise_base_url {
        let trimmed = url.trim_end_matches('/');
        // Determine secure from scheme
        let secure = trimmed.starts_with("https://");
        // Extract host for display
        let host = trimmed
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or(trimmed)
            .to_string();
        return ReachableEndpoint {
            base_url: trimmed.to_string(),
            source: EndpointSource::Explicit,
            host,
            port,
            secure,
            reachable: true,
            via: None,
        };
    }

    if let Some(host) = cloudflare_host {
        if !host.trim().is_empty() {
            return ReachableEndpoint {
                base_url: format!("https://{}", host.trim()),
                source: EndpointSource::Cloudflare,
                host: host.trim().to_string(),
                port,
                secure: true,
                reachable: true,
                via: None,
            };
        }
    }

    if tailscale_enabled {
        // One control-plane lookup shared by every tailnet source below.
        let via = super::tailscale::control_plane_label().await;
        if let Some(dns) = magic_dns().await {
            return ReachableEndpoint {
                base_url: format!("http://{}:{}", dns, port),
                source: EndpointSource::TailnetMagicDns,
                host: dns,
                port,
                secure: false,
                reachable: true,
                via,
            };
        }
        if let Some(ip) = tailscale_ip_v4().await {
            return ReachableEndpoint {
                base_url: format!("http://{}:{}", ip, port),
                source: EndpointSource::TailnetIpv4,
                host: ip,
                port,
                secure: false,
                reachable: true,
                via,
            };
        }
        if let Some(ip) = tailscale_ip_v6().await {
            let bh = bracket_host(&ip);
            return ReachableEndpoint {
                base_url: format!("http://{}:{}", bh, port),
                source: EndpointSource::TailnetIpv6,
                host: ip,
                port,
                secure: false,
                reachable: true,
                via,
            };
        }
        // If tailscale is enabled but we couldn't determine an IP, still report
        // the configured hostname as last tailscale attempt before falling back to LAN.
        if let Some(hostname) = tailscale_hostname {
            if !hostname.trim().is_empty() && hostname.contains('.') {
                // MagicDNS-style hostname already supplied
                return ReachableEndpoint {
                    base_url: format!("http://{}:{}", hostname.trim(), port),
                    source: EndpointSource::TailnetMagicDns,
                    host: hostname.trim().to_string(),
                    port,
                    secure: false,
                    reachable: false,
                    via,
                };
            }
        }
    }

    if let Some(ip) = lan_ip().await {
        return ReachableEndpoint {
            base_url: format!("http://{}:{}", ip, port),
            source: EndpointSource::Lan,
            host: ip,
            port,
            secure: false,
            reachable: true,
            via: None,
        };
    }

    ReachableEndpoint {
        base_url: format!("http://localhost:{}", port),
        source: EndpointSource::Localhost,
        host: "localhost".to_string(),
        port,
        secure: false,
        reachable: true,
        via: None,
    }
}

/// Probe every transport method and return them all in priority order so
/// the dashboard can render a method picker — the user picks the one that
/// matches where the phone currently is (home LAN, away on cellular,
/// behind a corporate VPN, etc.).
///
/// `reachable` is set on each entry: tailnet sources are marked reachable
/// only when we actually got an IP / DNS name back. Explicit and Cloudflare
/// entries are always marked reachable when configured — the daemon
/// trusts the operator's URL.
pub async fn list_endpoints(
    port: u16,
    cloudflare_host: Option<&str>,
    tailscale_enabled: bool,
    tailscale_hostname: Option<&str>,
    advertise_base_url: Option<&str>,
) -> Vec<ReachableEndpoint> {
    let mut out = Vec::new();

    if let Some(url) = advertise_base_url {
        let trimmed = url.trim_end_matches('/');
        let secure = trimmed.starts_with("https://");
        let host = trimmed
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or(trimmed)
            .to_string();
        out.push(ReachableEndpoint {
            base_url: trimmed.to_string(),
            source: EndpointSource::Explicit,
            host,
            port,
            secure,
            reachable: true,
            via: None,
        });
    }

    if let Some(host) = cloudflare_host.map(str::trim).filter(|h| !h.is_empty()) {
        out.push(ReachableEndpoint {
            base_url: format!("https://{host}"),
            source: EndpointSource::Cloudflare,
            host: host.to_string(),
            port,
            secure: true,
            reachable: true,
            via: None,
        });
    }

    if tailscale_enabled {
        let via = super::tailscale::control_plane_label().await;
        // Collect every viable tailnet row, then keep exactly one. The QR
        // picker used to show all three (MagicDNS / IPv4 / IPv6) for the
        // same machine, which read as duplicate entries. Prefer the address
        // the phone is most likely to reach: MagicDNS first (HTTPS-proxied
        // through Tailscale, works on every phone), then IPv4, then IPv6.
        // Skip an entry the probe marked unreachable; if all are unreachable
        // we still surface one so the user sees the row with a "down" hint.
        let mut tailnet_candidates: Vec<ReachableEndpoint> = Vec::new();
        if let Some(dns) = magic_dns().await {
            tailnet_candidates.push(ReachableEndpoint {
                base_url: format!("http://{dns}:{port}"),
                source: EndpointSource::TailnetMagicDns,
                host: dns,
                port,
                secure: false,
                reachable: true,
                via: via.clone(),
            });
        }
        if let Some(ip) = tailscale_ip_v4().await {
            tailnet_candidates.push(ReachableEndpoint {
                base_url: format!("http://{ip}:{port}"),
                source: EndpointSource::TailnetIpv4,
                host: ip,
                port,
                secure: false,
                reachable: true,
                via: via.clone(),
            });
        }
        if let Some(ip) = tailscale_ip_v6().await {
            let bh = bracket_host(&ip);
            tailnet_candidates.push(ReachableEndpoint {
                base_url: format!("http://{bh}:{port}"),
                source: EndpointSource::TailnetIpv6,
                host: ip,
                port,
                secure: false,
                reachable: true,
                via: via.clone(),
            });
        }
        // Configured MagicDNS name as fallback. Trust the operator's intent:
        // if they've configured a hostname, the QR should point there even
        // before tailscaled is up, so the phone is ready when they flip the
        // switch. If the daemon isn't actually running, the QR just fails
        // to load — surfaced by the existing error path. Skip if a live
        // probe already produced the same row, to avoid dupes.
        if let Some(hostname) = tailscale_hostname.map(str::trim).filter(|h| !h.is_empty() && h.contains('.')) {
            let already_listed = tailnet_candidates.iter().any(|ep| {
                ep.source == EndpointSource::TailnetMagicDns
                    && ep.host.eq_ignore_ascii_case(hostname)
            });
            if !already_listed {
                tailnet_candidates.push(ReachableEndpoint {
                    base_url: format!("http://{hostname}:{port}"),
                    source: EndpointSource::TailnetMagicDns,
                    host: hostname.to_string(),
                    port,
                    secure: false,
                    reachable: true,
                    via: via.clone(),
                });
            }
        }
        if let Some(pick) = pick_best_tailnet(tailnet_candidates) {
            out.push(pick);
        }
    }

    if let Some(ip) = lan_ip().await {
        out.push(ReachableEndpoint {
            base_url: format!("http://{ip}:{port}"),
            source: EndpointSource::Lan,
            host: ip,
            port,
            secure: false,
            reachable: true,
            via: None,
        });
    }

    // Localhost is always an option — useful when the phone is on the same
    // machine through SSH / Termux, or for the dashboard self-test button.
    out.push(ReachableEndpoint {
        base_url: format!("http://localhost:{port}"),
        source: EndpointSource::Localhost,
        host: "localhost".to_string(),
        port,
        secure: false,
        reachable: true,
        via: None,
    });

    out
}

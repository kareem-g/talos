//! Reachable endpoint resolver — single source for pairing QR and diagnostics.
//!
//! Priority (spec § TAILNET_REMOTE_CONTROL_PROMPT):
//!   Explicit advertise_base_url → Cloudflare hostname → MagicDNS (`tailscale status --json` self DNSName)
//!   → Tailscale IPv4 (`tailscale ip -4`, fallback iface probe) → Tailscale IPv6
//!   → LAN (`hostname -I`) → localhost fallback.
//!
//! `resolve_endpoint` returns the single best pick; `list_endpoints` surfaces
//! the MagicDNS and tailnet IPv4 rows as separate picker options, because a
//! phone connected to the tailnet with MagicDNS off can only reach the IP.
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

/// Ask the tailscale CLI directly for the node address. Works regardless of
/// what the interface is actually called (tailscale0, netstack, containers),
/// unlike the `ip … dev tailscale0` probe used as fallback.
async fn tailscale_cli_ip(family: &str) -> Option<String> {
    let output = tokio::process::Command::new("tailscale")
        .args(["ip", family])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        if family == "-4" {
            if let Some(ip) = token.parse::<std::net::Ipv4Addr>().ok().filter(|ip| !ip.is_loopback()) {
                return Some(ip.to_string());
            }
        } else if let Some(ip) = token.parse::<std::net::Ipv6Addr>().ok().filter(|ip| !ip.is_loopback()) {
            return Some(ip.to_string());
        }
    }
    None
}

/// Pull the first non-loopback v4 address out of `ip -4 -o addr show` output.
fn parse_ipv4_addr(output: &str) -> Option<String> {
    for line in output.lines() {
        for token in line.split_whitespace() {
            let addr = token.split('/').next().unwrap_or(token);
            if addr.parse::<std::net::Ipv4Addr>().is_ok() && !addr.starts_with("127.") {
                return Some(addr.to_string());
            }
        }
    }
    None
}

/// Pull the first non-loopback v6 address out of `ip -6 -o addr show` output.
fn parse_ipv6_addr(output: &str) -> Option<String> {
    for line in output.lines() {
        for token in line.split_whitespace() {
            let addr = token.split('/').next().unwrap_or(token);
            if addr.parse::<std::net::Ipv6Addr>().is_ok() && addr != "::1" {
                return Some(addr.to_string());
            }
        }
    }
    None
}

/// List IPv4 addrs on tailscale-ish interfaces (`tailscale0`, or any iface
/// holding a CGNAT 100.64.0.0/10 address, which is Tailscale's range).
async fn interface_ip_fallback(family: &str) -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args([family, "-o", "addr", "show"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let is_tailscale = line.split_whitespace()
            .nth(1)
            .map(|iface| iface.starts_with("tailscale") || iface.starts_with("ts"))
            .unwrap_or(false);
        let holds_cgnat = family == "-4"
            && line
                .split_whitespace()
                .any(|t| t.split('/').next().is_some_and(|a| a.starts_with("100.")));
        let addr = match family {
            "-4" => parse_ipv4_addr(line),
            _ => parse_ipv6_addr(line),
        };
        if addr.is_some() && (is_tailscale || holds_cgnat) {
            return addr;
        }
    }
    None
}

async fn tailscale_ip_v4() -> Option<String> {
    if let Some(ip) = tailscale_cli_ip("-4").await {
        return Some(ip);
    }
    interface_ip_fallback("-4").await
}

async fn tailscale_ip_v6() -> Option<String> {
    if let Some(ip) = tailscale_cli_ip("-6").await {
        return Some(ip);
    }
    interface_ip_fallback("-6").await
}

/// mDNS/Bonjour link-local names (`.local` / `.local.`) resolve only via
/// multicast on the local link — across Tailscale they never resolve, so a
/// tailnet QR pointing at one is guaranteed to fail on the phone. Such names
/// must not be advertised as tailnet endpoints.
fn is_mdns_name(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    host == "local" || host.ends_with(".local")
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

/// Pick the single best tailnet row for `resolve_endpoint`. Preference:
/// `TailnetMagicDns` > `TailnetIpv4` > `TailnetIpv6` (by source). A phone
/// whose Tailscale has MagicDNS off cannot resolve the `.ts.net` name even
/// while "connected" — that's exactly why `list_endpoints` surfaces the
/// IPv4 row as its own picker option instead of collapsing it away here.
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

/// Every viable tailnet row, in preference order: live MagicDNS name,
/// tailnet IPv4, tailnet IPv6. When no live probe yields anything, the
/// configured hostname is offered as an optimistic fallback — except mDNS
/// (`.local`) names, which are link-local multicast and structurally
/// unresolvable across the tailnet; advertising one produces the exact
/// "LAN works but tailnet fails" asymmetry users report.
async fn tailnet_candidates(port: u16, tailscale_hostname: Option<&str>) -> Vec<ReachableEndpoint> {
    // One control-plane lookup shared by every tailnet source.
    let via = super::tailscale::control_plane_label().await;
    let mut out: Vec<ReachableEndpoint> = Vec::new();
    if let Some(dns) = magic_dns().await {
        out.push(ReachableEndpoint {
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
        out.push(ReachableEndpoint {
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
        out.push(ReachableEndpoint {
            base_url: format!("http://{bh}:{port}"),
            source: EndpointSource::TailnetIpv6,
            host: ip,
            port,
            secure: false,
            reachable: true,
            via: via.clone(),
        });
    }
    // Configured MagicDNS name as fallback, only when no live probe yielded
    // anything. Trust the operator's intent: if they've configured a
    // hostname, the QR should point there even before tailscaled is up, so
    // the phone is ready when they flip the switch. If the daemon isn't
    // actually running, the QR just fails to load — surfaced by the existing
    // error path. mDNS (`.local`) names are skipped: they only resolve via
    // link-local multicast and never across the tailnet.
    let configured = tailscale_hostname
        .map(str::trim)
        .filter(|h| !h.is_empty() && h.contains('.') && !is_mdns_name(h));
    if let (true, Some(hostname)) = (out.is_empty(), configured) {
        out.push(ReachableEndpoint {
            base_url: format!("http://{hostname}:{port}"),
            source: EndpointSource::TailnetMagicDns,
            host: hostname.to_string(),
            port,
            secure: false,
            reachable: true,
            via,
        });
    }
    out
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

    if let Some(host) = cloudflare_host.filter(|host| !host.trim().is_empty()) {
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

    let tailnet_pick = if tailscale_enabled {
        pick_best_tailnet(tailnet_candidates(port, tailscale_hostname).await)
    } else {
        None
    };
    if let Some(pick) = tailnet_pick {
        return pick;
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
        // Surface both the MagicDNS row and the tailnet IPv4 row. Earlier
        // code collapsed the tailnet to a single row (MagicDNS first), which
        // strands any phone that has Tailscale connected but MagicDNS off —
        // the `.ts.net` name never resolves there, and the 100.x address
        // that *would* work was hidden from the picker. IPv6 only appears
        // when it's the sole viable tailnet path, so the common case is
        // still just the two tailnet rows.
        let candidates = tailnet_candidates(port, tailscale_hostname).await;
        let has_preferred = candidates.iter().any(|ep| {
            matches!(
                ep.source,
                EndpointSource::TailnetMagicDns | EndpointSource::TailnetIpv4
            )
        });
        for ep in candidates {
            if ep.source == EndpointSource::TailnetIpv6 && has_preferred {
                continue;
            }
            out.push(ep);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ipv4_from_ip_output() {
        let line = "5: tailscale0: <POINTOPOINT,MULTICAST,NOARP,UP> mtu 1280 group default 100 inet 100.94.122.121/32 scope global tailscale0\\       valid_lft forever preferred_lft forever";
        assert_eq!(parse_ipv4_addr(line).as_deref(), Some("100.94.122.121"));
        assert_eq!(parse_ipv4_addr(""), None);
    }

    #[test]
    fn parses_ipv6_from_ip_output_skipping_loopback() {
        let line = "1: lo: <LOOPBACK> mtu 65536 state UNKNOWN group default qlen 1000\\    inet6 ::1/128 scope host";
        assert_eq!(parse_ipv6_addr(line), None);
        let line = "5: tailscale0: <UP> mtu 1280 group default inet6 fd7a:115c:a1e0::1234/128 scope global";
        assert_eq!(parse_ipv6_addr(line).as_deref(), Some("fd7a:115c:a1e0::1234"));
    }

    #[test]
    fn mdns_names_are_detected() {
        assert!(is_mdns_name("agentdeck.local."));
        assert!(is_mdns_name("agentdeck.local"));
        assert!(!is_mdns_name("kareem.taile90653.ts.net"));
        assert!(!is_mdns_name("agentdeck.example.com"));
    }

    #[test]
    fn pick_prefers_magicdns_over_ipv4() {
        let mk = |source: EndpointSource| ReachableEndpoint {
            base_url: "http://x:9120".into(),
            source,
            host: "x".into(),
            port: 9120,
            secure: false,
            reachable: true,
            via: None,
        };
        let best = pick_best_tailnet(vec![
            mk(EndpointSource::TailnetIpv4),
            mk(EndpointSource::TailnetIpv6),
            mk(EndpointSource::TailnetMagicDns),
        ])
        .unwrap();
        assert_eq!(best.source, EndpointSource::TailnetMagicDns);
    }

    /// Live-environment smoke check (not a CI test): run with
    /// `cargo test --lib tunnel::resolver -- --ignored --nocapture` on a
    /// machine that is actually connected to a tailnet. Prints the picker
    /// rows a phone would be offered.
    #[tokio::test]
    #[ignore]
    async fn prints_live_tailnet_picker_rows() {
        let endpoints = list_endpoints(9120, None, true, None, None).await;
        for ep in &endpoints {
            println!("{:?} {} reachable={}", ep.source, ep.base_url, ep.reachable);
        }
        let tailnet_rows: Vec<_> = endpoints
            .iter()
            .filter(|ep| matches!(
                ep.source,
                EndpointSource::TailnetMagicDns | EndpointSource::TailnetIpv4
            ))
            .collect();
        assert!(
            tailnet_rows.len() >= 2,
            "phone with MagicDNS off needs the tailnet IPv4 row even when MagicDNS resolves"
        );
    }
}

use crate::tunnel::{TunnelErrorKind, TunnelInfo, TunnelKind, TunnelProvider, TunnelStatus};
use crate::Result;
use std::time::Duration;

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
}

/// The control plane this node is logged into, if tailscale runs at all.
/// `tailscale debug prefs` reports it; anything that is not Tailscale.com is
/// a Headscale (or other custom) control plane.
pub async fn control_url() -> Option<String> {
    // Plain `debug prefs` prints compact JSON on current clients; older ones
    // want the explicit format flag. Either way we only need ControlURL.
    for args in [&["debug", "prefs"][..], &["debug", "prefs", "--format=json"][..]] {
        let Ok(output) = tokio::process::Command::new("tailscale").args(args).output().await
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        if let Some(url) = serde_json::from_slice::<serde_json::Value>(&output.stdout)
            .ok()
            .and_then(|v| v.get("ControlURL").and_then(|u| u.as_str()).map(str::to_string))
            .filter(|u| !u.is_empty())
        {
            return Some(url);
        }
    }
    None
}

/// Short human label for a control-plane URL: "tailscale" for hosted,
/// "headscale <host>" for self-hosted. Pure so the mapping is unit-tested.
pub fn label_for_control_url(url: &str) -> String {
    let host = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(url);
    let bare = host.split(':').next().unwrap_or(host);
    if bare.eq_ignore_ascii_case("controlplane.tailscale.com")
        || bare
            .strip_suffix(".controlplane.tailscale.com")
            .is_some_and(|prefix| !prefix.is_empty())
    {
        "tailscale".to_string()
    } else {
        format!("headscale {host}")
    }
}

/// Short human label for the control plane. None when tailscale is down.
pub async fn control_plane_label() -> Option<String> {
    control_url().await.map(|url| label_for_control_url(&url))
}

/// Bring the tailnet up, optionally against a Headscale control plane.
/// An auth key completes without interaction; without one `tailscale up`
/// waits for a browser login, so the call is bounded and reports that.
pub async fn login(
    login_server: Option<&str>,
    auth_key: Option<&str>,
    hostname: Option<&str>,
) -> crate::Result<()> {
    let fail = |message: String| crate::AgentDeckError::Unknown(message);
    let mut args = vec!["up".to_string()];
    if let Some(server) = login_server.map(str::trim).filter(|s| !s.is_empty()) {
        args.push(format!("--login-server={server}"));
    }
    if let Some(key) = auth_key.map(str::trim).filter(|k| !k.is_empty()) {
        args.push(format!("--auth-key={key}"));
    }
    if let Some(name) = hostname.map(str::trim).filter(|n| !n.is_empty()) {
        args.push(format!("--hostname={name}"));
    }
    let output = run_tailscale(&args, Duration::from_secs(75)).await?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(fail(if stderr.is_empty() { "tailscale up failed".to_string() } else { stderr }))
}

/// Run `tailscale <args>` as the current user. If the daemon refuses with
/// `checkprefs access denied`, promote the current user to operator first
/// (pkexec → sudo -n → sudo) and retry once. The operator flag sticks on
/// `tailscaled` after that one-time set.
pub async fn run_tailscale(args: &[String], timeout: Duration) -> crate::Result<std::process::Output> {
    let fail = |message: String| crate::AgentDeckError::Unknown(message);
    let try_once = || async {
        tokio::time::timeout(
            timeout,
            tokio::process::Command::new("tailscale").args(args).output(),
        )
        .await
        .map_err(|_| fail("tailscale command timed out".to_string()))
        .and_then(|o| o.map_err(|e| fail(format!("could not run tailscale: {e}"))))
    };
    let first = try_once().await?;
    if first.status.success() || !needs_authorization(&String::from_utf8_lossy(&first.stderr)) {
        return Ok(first);
    }
    if !ensure_operator_inner().await? {
        return Ok(first);
    }
    try_once().await
}

/// Just the operator-promotion half — used by both the recovery loop above
/// and the `/api/tunnel/headscale/authorize` endpoint, so the dashboard can
/// pre-emptively authorize before retrying.
pub async fn ensure_operator() -> crate::Result<bool> {
    ensure_operator_inner().await
}

/// True when `tailscale status` succeeds — the local proxy to `tailscaled`
/// is up. Does NOT imply the node is logged in; that's a separate check.
pub async fn is_daemon_running() -> bool {
    tokio::process::Command::new("tailscale")
        .args(["status"])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Try to bring `tailscaled` up if it isn't already. Tries the usual
/// one-shot starters in order: `pkexec systemctl start tailscaled`,
/// `pkexec service tailscaled start`, plain `sudo systemctl ...`, plain
/// `tailscaled &` as a last resort when the user can already write to the
/// socket. Returns `Ok(true)` if the daemon is up after this call.
pub async fn ensure_daemon() -> bool {
    if is_daemon_running().await {
        return true;
    }
    // systemd (most desktop Linux distros)
    for command in [
        "pkexec systemctl start tailscaled",
        "sudo systemctl start tailscaled",
        "pkexec service tailscaled start",
        "sudo service tailscaled start",
    ] {
        let argv = shell_split(command);
        let elevator = argv.first().map(String::as_str).unwrap_or("");
        let available = tokio::process::Command::new(elevator)
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !available {
            continue;
        }
        let Ok(Ok(output)) = tokio::time::timeout(
            Duration::from_secs(30),
            tokio::process::Command::new(elevator).args(&argv[1..]).output(),
        )
        .await
        else {
            continue;
        };
        if output.status.success() && is_daemon_running().await {
            return true;
        }
    }
    is_daemon_running().await
}

async fn ensure_operator_inner() -> crate::Result<bool> {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "root".to_string());
    // Pick the first elevator that exists. pkexec gives a graphical prompt
    // (no terminal needed); sudo -n is the non-interactive fallback when
    // NOPASSWD is set; plain sudo prompts in the controlling terminal.
    for elevator in ["pkexec", "sudo", "doas"] {
        let candidate = format!("{elevator} tailscale set --operator={user}");
        let argv = shell_split(&candidate);
        let available = tokio::process::Command::new(elevator)
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !available {
            continue;
        }
        let Ok(Ok(output)) = tokio::time::timeout(
            Duration::from_secs(120),
            tokio::process::Command::new(elevator).args(&argv).output(),
        )
        .await
        else {
            continue;
        };
        if output.status.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Tokenize a shell command for `Command::args`. Honours simple
/// single/double-quoted segments; that's enough for the small fixed list of
/// invocations we run through an elevator.
fn shell_split(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut in_single = false;
    let mut in_double = false;
    for ch in input.chars() {
        match ch {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            c if c.is_whitespace() && !in_single && !in_double => {
                if !buf.is_empty() {
                    out.push(std::mem::take(&mut buf));
                }
            }
            c => buf.push(c),
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

/// True when stderr indicates the daemon rejected the call for lack of
/// operator privileges. Conservative: matches only what tailscaled actually
/// emits today.
pub fn needs_authorization(stderr: &str) -> bool {
    stderr.contains("checkprefs access denied") || stderr.contains("access denied")
}

/// Classify `tailscale` stderr into a structured error kind. Pure so it can
/// be unit-tested without spawning a process. Short first line is kept as
/// the human-readable detail for `TailscaleFailed`.
pub fn classify_error(stderr: &str) -> super::TunnelErrorKind {
    let lower = stderr.to_lowercase();
    if needs_authorization(stderr) {
        return super::TunnelErrorKind::NeedsAuthorization;
    }
    if lower.contains("invalid auth key")
        || lower.contains("auth key expired")
        || lower.contains("preauth key")
            && (lower.contains("invalid") || lower.contains("not found") || lower.contains("expired"))
    {
        return super::TunnelErrorKind::InvalidAuthKey;
    }
    if lower.contains("tailscaled is not running")
        || lower.contains("failed to connect to local tailscaled")
        || lower.contains("not running")
        || lower.contains("connection refused")
            && (lower.contains("local") || lower.contains("tailscaled") || lower.contains("/var/run/"))
    {
        return super::TunnelErrorKind::DaemonNotRunning;
    }
    if lower.contains("no such host")
        || lower.contains("connection refused")
        || lower.contains("failed to fetch")
        || lower.contains("tls handshake")
        || lower.contains("i/o timeout")
        || lower.contains("network is unreachable")
        || lower.contains("could not resolve")
    {
        return super::TunnelErrorKind::UnreachableControlPlane;
    }
    let first_line = stderr.lines().next().unwrap_or("").trim();
    super::TunnelErrorKind::TailscaleFailed(if first_line.is_empty() {
        "tailscale command failed".to_string()
    } else {
        first_line.to_string()
    })
}

#[cfg(test)]
mod shell_split_tests {
    use super::shell_split;
    #[test]
    fn splits_plain() {
        assert_eq!(shell_split("pkexec tailscale set --operator=root"),
            vec!["pkexec", "tailscale", "set", "--operator=root"]);
    }
    #[test]
    fn honours_quotes() {
        assert_eq!(shell_split("sudo -u 'kareem g' echo hi"),
            vec!["sudo", "-u", "kareem g", "echo", "hi"]);
    }
}

#[cfg(test)]
mod classify_tests {
    use super::super::TunnelErrorKind;
    use super::classify_error;

    #[test]
    fn checkprefs_maps_to_needs_authorization() {
        assert_eq!(
            classify_error("Access denied: checkprefs access denied"),
            TunnelErrorKind::NeedsAuthorization
        );
    }

    #[test]
    fn connection_refused_maps_to_unreachable() {
        assert_eq!(
            classify_error("dial tcp 10.0.0.5:443: connection refused"),
            TunnelErrorKind::UnreachableControlPlane
        );
    }

    #[test]
    fn invalid_auth_key_maps_to_invalid_key() {
        assert_eq!(
            classify_error("invalid auth key"),
            TunnelErrorKind::InvalidAuthKey
        );
        assert_eq!(
            classify_error("preauth key expired"),
            TunnelErrorKind::InvalidAuthKey
        );
    }

    #[test]
    fn unknown_failure_keeps_first_line() {
        match classify_error("some totally weird failure\n  with a second line") {
            TunnelErrorKind::TailscaleFailed(msg) => {
                assert_eq!(msg, "some totally weird failure");
            }
            other => panic!("expected TailscaleFailed, got {other:?}"),
        }
    }

    #[test]
    fn empty_stderr_falls_back_to_generic_message() {
        match classify_error("") {
            TunnelErrorKind::TailscaleFailed(msg) => assert_eq!(msg, "tailscale command failed"),
            other => panic!("expected TailscaleFailed, got {other:?}"),
        }
    }

    #[test]
    fn error_kind_as_str_is_stable() {
        assert_eq!(TunnelErrorKind::NeedsAuthorization.as_str(), "needs_authorization");
        assert_eq!(TunnelErrorKind::UnreachableControlPlane.as_str(), "unreachable_control_plane");
        assert_eq!(TunnelErrorKind::InvalidAuthKey.as_str(), "invalid_auth_key");
        assert_eq!(TunnelErrorKind::DaemonNotRunning.as_str(), "daemon_not_running");
        assert_eq!(TunnelErrorKind::TailscaleFailed(String::new()).as_str(), "tailscale_failed");
    }

    #[test]
    fn not_running_maps_to_daemon_not_running() {
        assert_eq!(
            classify_error("tailscaled is not running"),
            TunnelErrorKind::DaemonNotRunning
        );
        assert_eq!(
            classify_error("Failed to connect to local tailscaled"),
            TunnelErrorKind::DaemonNotRunning
        );
        assert_eq!(
            classify_error("not running"),
            TunnelErrorKind::DaemonNotRunning
        );
    }
}

/// Log out of the tailnet entirely (drops Tailscale.com and Headscale alike).
pub async fn logout() -> crate::Result<()> {
    let fail = |message: String| crate::AgentDeckError::Unknown(message);
    let output = tokio::process::Command::new("tailscale")
        .args(["logout"])
        .output()
        .await
        .map_err(|e| fail(format!("could not run tailscale: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(fail(if stderr.is_empty() { "tailscale logout failed".to_string() } else { stderr }))
    }
}

impl TunnelProvider for TailscaleProvider {
    fn kind(&self) -> TunnelKind {
        TunnelKind::Tailscale
    }

    async fn start(&self) -> Result<TunnelInfo> {
        // Step 1: the binary itself has to exist. We can't bring up a
        // tailnet without `tailscale` on $PATH — give a structured
        // `tailscale_not_installed` so the UI can show "Install tailscale"
        // instead of pretending we tried.
        if !tailscale_binary_present().await {
            return Ok(TunnelInfo {
                kind: TunnelKind::Tailscale,
                status: TunnelStatus::Error(format!(
                    "{}:tailscale is not installed. See https://tailscale.com/download",
                    TunnelErrorKind::TailscaleFailed(String::new()).as_str(),
                )),
                url: None,
                ip: None,
                token: None,
                pair: None,
            });
        }

        // Step 2: the daemon (`tailscaled`) needs to be running. Try a
        // one-shot systemctl start; if that fails, the dashboard's
        // "Authorize & retry" button will prompt for elevation.
        if !is_daemon_running().await && !ensure_daemon().await {
            return Ok(TunnelInfo {
                kind: TunnelKind::Tailscale,
                status: TunnelStatus::Error(format!(
                    "{}:tailscaled isn't running and we couldn't start it. Check `systemctl status tailscaled`.",
                    TunnelErrorKind::DaemonNotRunning.as_str(),
                )),
                url: None,
                ip: None,
                token: None,
                pair: None,
            });
        }

        let ip = self.get_tailscale_ip().await;

        Ok(TunnelInfo {
            kind: TunnelKind::Tailscale,
            status: if ip.is_some() {
                TunnelStatus::Connected
            } else {
                TunnelStatus::Error(format!(
                    "{}:tailscaled is up but this node has no tailnet IP",
                    TunnelErrorKind::TailscaleFailed(String::new()).as_str(),
                ))
            },
            url: ip.as_ref().map(|ip| format!("http://{}:9120", ip)),
            ip,
            token: None,
            pair: None,
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

/// True when the `tailscale` CLI is on PATH. Cheap probe (runs `--version`).
async fn tailscale_binary_present() -> bool {
    tokio::process::Command::new("tailscale")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::label_for_control_url;

    #[test]
    fn hosted_control_plane_labels_tailscale() {
        assert_eq!(label_for_control_url("https://controlplane.tailscale.com"), "tailscale");
        assert_eq!(label_for_control_url("https://foo.controlplane.tailscale.com:443/x"), "tailscale");
    }

    #[test]
    fn custom_control_plane_labels_headscale() {
        assert_eq!(
            label_for_control_url("https://headscale.example.com"),
            "headscale headscale.example.com"
        );
        assert_eq!(label_for_control_url("http://10.0.0.5:8080/"), "headscale 10.0.0.5:8080");
    }
}

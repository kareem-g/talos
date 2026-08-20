//! Built-in catalog of known agent CLIs.
//!
//! This is a table of *where to look and how to launch*, not a closed list of
//! what the product supports. Three things keep it from becoming a gate:
//!
//! - A catalog entry only becomes a usable provider after the binary is found
//!   and answers its transport's handshake. Nothing here is assumed.
//! - Users register additional CLIs in config; they flow through the identical
//!   discovery path and are indistinguishable downstream except for
//!   `user_defined`.
//! - Capabilities and models here are fallbacks. Anything the agent reports at
//!   handshake time overrides them, because the agent is the authority.
//!
//! Adding a CLI that speaks a transport we already implement is one row.

use super::types::{ProviderCapabilities, Transport};

/// A launch recipe for a known CLI.
pub struct CatalogEntry {
    pub id: &'static str,
    pub name: &'static str,
    /// Binary name looked up on PATH. Config may override the resolved path.
    pub binary: &'static str,
    /// Arguments that put the CLI into its structured/headless mode.
    pub args: &'static [&'static str],
    pub transport: Transport,
}

/// Known CLIs, ordered by how well we can drive them.
///
/// ACP entries come first because that transport gives us structured events and
/// generic config options for free. `gemini` is here on the strength of its
/// documented `--acp` flag (`--experimental-acp` is the deprecated spelling).
///
/// `claude` and `codex` are listed as `Pty` because that is what the spawn path
/// actually does today. Both have structured modes we intend to use
/// (`claude -p --output-format stream-json`, `codex exec --json`), but until the
/// spawn path uses them, advertising `StreamJson`/`Jsonl` here would misreport
/// the session: a PTY session has an interactive terminal and lossy events,
/// which is the opposite of what those transports imply.
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry { id: "opencode", name: "OpenCode",       binary: "opencode",     args: &["acp"],   transport: Transport::Acp },
    CatalogEntry { id: "gemini",   name: "Gemini CLI",     binary: "gemini",       args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "copilot",  name: "GitHub Copilot", binary: "copilot",      args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "cursor",   name: "Cursor",         binary: "cursor-agent", args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "qwen",     name: "Qwen Code",      binary: "qwen-code",    args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "kimi",     name: "Kimi CLI",       binary: "kimi",         args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "hermes",   name: "Hermes",         binary: "hermes",       args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "goose",    name: "Goose",          binary: "goose",        args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "augment",  name: "Augment",        binary: "auggie",       args: &["--acp"], transport: Transport::Acp },
    CatalogEntry { id: "claude",   name: "Claude Code",    binary: "claude",       args: &[],        transport: Transport::Pty },
    CatalogEntry { id: "codex",    name: "Codex CLI",      binary: "codex",        args: &[],        transport: Transport::Pty },
];

pub fn entry_for(id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|entry| entry.id == id)
}

/// Baseline capabilities implied by a transport, before the agent speaks for
/// itself. `None` is used wherever the transport alone cannot tell us — see the
/// "unknown is not false" rule in `super::types`.
pub fn baseline_capabilities(transport: Transport) -> ProviderCapabilities {
    match transport {
        // ACP defines all of these in the protocol; the handshake refines
        // `resume` and `attachments` from real agentCapabilities.
        Transport::Acp => ProviderCapabilities {
            streaming: Some(true),
            reasoning: Some(true),
            permissions: Some(true),
            file_changes: Some(true),
            plans: Some(true),
            attachments: None,
            terminal: Some(false),
            resume: None,
            interrupt: Some(true),
        },
        Transport::StreamJson => ProviderCapabilities {
            streaming: Some(true),
            reasoning: Some(true),
            permissions: Some(true),
            file_changes: Some(true),
            plans: Some(true),
            attachments: Some(true),
            terminal: Some(false),
            resume: Some(true),
            interrupt: Some(true),
        },
        Transport::Jsonl => ProviderCapabilities {
            streaming: Some(true),
            reasoning: Some(true),
            permissions: Some(true),
            file_changes: Some(true),
            plans: None,
            attachments: Some(true),
            terminal: Some(false),
            resume: Some(true),
            interrupt: Some(true),
        },
        // A scraped TUI: text arrives, but nothing else is structurally
        // trustworthy. Claiming otherwise is what produced the bugs this
        // rewrite is fixing.
        Transport::Pty => ProviderCapabilities {
            streaming: Some(true),
            reasoning: None,
            permissions: None,
            file_changes: None,
            plans: None,
            attachments: Some(false),
            terminal: Some(true),
            resume: None,
            interrupt: Some(false),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_ids_and_binaries_are_unique() {
        let mut ids = HashSet::new();
        for entry in CATALOG {
            assert!(ids.insert(entry.id), "duplicate catalog id: {}", entry.id);
        }
        // Two entries launching the same binary+args would probe redundantly.
        let mut launches = HashSet::new();
        for entry in CATALOG {
            let launch = format!("{} {}", entry.binary, entry.args.join(" "));
            assert!(launches.insert(launch.clone()), "duplicate launch recipe: {}", launch);
        }
    }

    #[test]
    fn acp_entries_pass_their_acp_flag() {
        for entry in CATALOG.iter().filter(|e| e.transport == Transport::Acp) {
            assert!(
                entry.args.iter().any(|arg| arg.contains("acp")),
                "{} is an ACP entry but its args do not request ACP mode",
                entry.id
            );
        }
    }

    #[test]
    fn pty_baseline_does_not_overclaim() {
        let pty = baseline_capabilities(Transport::Pty);
        assert_eq!(pty.permissions, None, "scraped output cannot be trusted to report permissions");
        assert_eq!(pty.file_changes, None);
        assert_eq!(pty.interrupt, Some(false));

        let acp = baseline_capabilities(Transport::Acp);
        assert_eq!(acp.permissions, Some(true), "ACP defines structured permission requests");
    }
}

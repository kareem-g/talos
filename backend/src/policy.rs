//! Project tool policy — the harness's guardrail layer over tool execution.
//!
//! A project can declare rules in `<project>/.agentdeck/policy.toml` that
//! auto-allow or auto-deny specific tools *before* the permission card is
//! shown, across every backend. First matching rule wins; no rule falls
//! through to the session's `permission_mode` defaults (ask / auto_edit /
//! plan / full) in `permissions::request_user_decision`.
//!
//! ```toml
//! # .agentdeck/policy.toml
//! [[rules]]
//! tool = "Bash"     # substring match on the tool name
//! action = "deny"   # "allow" | "deny"
//!
//! [[rules]]
//! tool = "Read"
//! action = "allow"
//! ```
//!
//! A rule's `tool` is matched case-insensitively as a substring, so `"bash"`
//! covers `Bash`, `run_command`, etc. `"all"` matches every tool. This is
//! deliberately small: it is a guardrail, not a permissions framework — the
//! mode system and the human approval card remain the source of truth for
//! anything not explicitly ruled.

use serde::Deserialize;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny,
    Ask,
}

/// The pre-card policy verdict for a whole tool call: network rules, then
/// path rules, then tool rules — the exact order the permission pipeline
/// applies. Every backend consults this same helper (the Claude hook path and
/// the API tool executor through `permissions::request_user_decision`, ACP
/// directly), so one `policy.toml` means the same thing no matter which agent
/// is calling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputDecision {
    /// Auto-approve, with the reason shown on the resolved card.
    Allow(&'static str),
    /// Auto-deny, with the reason handed back to the agent.
    Deny(&'static str),
    /// No rule matched; fall through to the permission mode / human card.
    Ask,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolRule {
    pub tool: String,
    pub action: String,
}

/// A filesystem rule: any tool input whose path starts with `prefix` is
/// allowed/denied regardless of the tool-level rules. `"all"` is not valid
/// here — a prefix rule must name a real path.
#[derive(Debug, Clone, Deserialize)]
pub struct PathRule {
    pub prefix: String,
    pub action: String,
}

/// A network rule: `WebFetch`/`WebSearch` to `domain` is allowed/denied.
/// Deny-by-default — a URL whose host matches no rule is refused, so network
/// tools are inert until a project explicitly allows domains.
#[derive(Debug, Clone, Deserialize)]
pub struct NetworkRule {
    pub domain: String,
    pub action: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PolicyFile {
    #[serde(default)]
    pub rules: Vec<ToolRule>,
    #[serde(default)]
    pub paths: Vec<PathRule>,
    #[serde(default)]
    pub network: Vec<NetworkRule>,
}

#[derive(Debug, Clone, Default)]
pub struct ToolPolicy {
    rules: Vec<ToolRule>,
    paths: Vec<PathRule>,
    network: Vec<NetworkRule>,
}

impl ToolPolicy {
    /// Load the project policy, if present. Missing file / parse errors yield
    /// an empty policy (everything falls through to the mode defaults).
    pub fn load(project: Option<&str>) -> ToolPolicy {
        let Some(base) = project else {
            return ToolPolicy::default();
        };
        let path = Path::new(base).join(".agentdeck/policy.toml");
        let Ok(content) = std::fs::read_to_string(&path) else {
            return ToolPolicy::default();
        };
        let Ok(file) = toml::from_str::<PolicyFile>(&content) else {
            return ToolPolicy::default();
        };
        ToolPolicy {
            rules: file.rules,
            paths: file.paths,
            network: file.network,
        }
    }

    /// Decide a tool call. First matching rule wins; `"all"` matches anything.
    /// No match → [`PolicyDecision::Ask`] (fall through to mode / human).
    pub fn decide(&self, tool_name: &str) -> PolicyDecision {
        let tool = tool_name.to_lowercase();
        for rule in &self.rules {
            let pattern = rule.tool.to_lowercase();
            let matches = pattern == "all" || tool.contains(&pattern);
            if !matches {
                continue;
            }
            return match rule.action.to_lowercase().as_str() {
                "allow" => PolicyDecision::Allow,
                "deny" => PolicyDecision::Deny,
                _ => PolicyDecision::Ask,
            };
        }
        PolicyDecision::Ask
    }

    /// Decide a network access by host. **Deny-by-default**: a host matching
    /// an explicit allow rule falls through to the normal permission flow
    /// ([`PolicyDecision::Ask`]); anything else is denied.
    pub fn decide_network(&self, host: &str) -> PolicyDecision {
        let host = host.to_lowercase();
        let host = host.strip_suffix('.').unwrap_or(&host);
        for rule in &self.network {
            let domain = rule.domain.to_lowercase().trim_start_matches("www.").to_string();
            let matches = host == domain
                || host.ends_with(&format!(".{domain}"))
                || (domain.starts_with('.') && host.ends_with(&domain));
            if !matches {
                continue;
            }
            return match rule.action.to_lowercase().as_str() {
                "allow" => PolicyDecision::Ask, // allowlisted → normal permission flow
                "deny" => PolicyDecision::Deny,
                _ => PolicyDecision::Deny,
            };
        }
        PolicyDecision::Deny
    }

    /// Decide a filesystem access by path prefix. First matching rule wins;
    /// no match → [`PolicyDecision::Ask`]. Path rules are more specific than
    /// tool rules, so callers consult this before `decide`.
    pub fn decide_path(&self, path: &str) -> PolicyDecision {
        let normalized = path.replace('\\', "/");
        for rule in &self.paths {
            let prefix = rule.prefix.replace('\\', "/");
            let matches = normalized.starts_with(&prefix);
            if !matches {
                continue;
            }
            return match rule.action.to_lowercase().as_str() {
                "allow" => PolicyDecision::Allow,
                "deny" => PolicyDecision::Deny,
                _ => PolicyDecision::Ask,
            };
        }
        PolicyDecision::Ask
    }

    /// Decide a whole tool call before the permission card is shown, applying
    /// every rule family in specificity order:
    ///
    /// 1. **Network** — network-category tools whose input carries a `url` are
    ///    deny-by-default; only allowlisted hosts fall through.
    /// 2. **Path** — the path the input would touch (`file_path` / `path`, or
    ///    a bare string input).
    /// 3. **Tool** — the tool-name rules.
    ///
    /// Tool identity comes from the unified registry's classifier
    /// (`crate::tools::classify`), so native backends' tools (Claude's
    /// `WebSearch`, an ACP agent's fetch) are gated by the same network rules
    /// as ours.
    pub fn decide_input(&self, tool_name: &str, input: &Value) -> InputDecision {
        if crate::tools::classify(tool_name).0 == crate::tools::ToolCategory::Network {
            let url = input.get("url").and_then(Value::as_str).unwrap_or("");
            if let Some(host) = url_host(url)
                && self.decide_network(&host) == PolicyDecision::Deny
            {
                return InputDecision::Deny("Denied (project network policy)");
            }
        }

        let input_path = match input {
            Value::String(text) => Some(text.clone()),
            Value::Object(map) => map
                .get("file_path")
                .or_else(|| map.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string),
            _ => None,
        };
        if let Some(path) = input_path {
            match self.decide_path(&path) {
                PolicyDecision::Allow => {
                    return InputDecision::Allow("Auto-approved (project path policy)")
                }
                PolicyDecision::Deny => return InputDecision::Deny("Denied (project path policy)"),
                PolicyDecision::Ask => {}
            }
        }

        match self.decide(tool_name) {
            PolicyDecision::Allow => InputDecision::Allow("Auto-approved (project policy)"),
            PolicyDecision::Deny => InputDecision::Deny("Denied (project policy)"),
            PolicyDecision::Ask => InputDecision::Ask,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn policy(rules: &[(&str, &str)]) -> ToolPolicy {
        ToolPolicy {
            rules: rules
                .iter()
                .map(|(tool, action)| ToolRule {
                    tool: tool.to_string(),
                    action: action.to_string(),
                })
                .collect(),
            paths: Vec::new(),
            network: Vec::new(),
        }
    }

    #[test]
    fn first_matching_rule_wins_case_insensitively() {
        let p = policy(&[("bash", "deny"), ("all", "allow")]);
        assert_eq!(p.decide("Bash"), PolicyDecision::Deny);
        assert_eq!(p.decide("Read"), PolicyDecision::Allow);
    }

    #[test]
    fn substring_match_covers_family_of_tools() {
        let p = policy(&[("read", "deny")]);
        assert_eq!(p.decide("Read"), PolicyDecision::Deny);
        assert_eq!(p.decide("read_file"), PolicyDecision::Deny);
        assert_eq!(p.decide("write"), PolicyDecision::Ask);
    }

    #[test]
    fn no_rules_means_ask() {
        let p = ToolPolicy::default();
        assert_eq!(p.decide("anything"), PolicyDecision::Ask);
    }

    #[test]
    fn path_rules_deny_by_prefix() {
        let p = ToolPolicy {
            rules: Vec::new(),
            paths: vec![PathRule {
                prefix: "/home/kareem/.ssh".to_string(),
                action: "deny".to_string(),
            }],
            network: Vec::new(),
        };
        assert_eq!(p.decide_path("/home/kareem/.ssh/id_rsa"), PolicyDecision::Deny);
        assert_eq!(p.decide_path("/home/kareem/.ssh/config"), PolicyDecision::Deny);
        // Sibling directories are not matched.
        assert_eq!(p.decide_path("/home/kareem/Documents"), PolicyDecision::Ask);
    }

    #[test]
    fn network_is_deny_by_default() {
        let p = ToolPolicy { rules: Vec::new(), paths: Vec::new(), network: Vec::new() };
        assert_eq!(p.decide_network("example.com"), PolicyDecision::Deny);
    }

    #[test]
    fn network_allowlist_falls_through_to_permission() {
        let p = ToolPolicy {
            rules: Vec::new(),
            paths: Vec::new(),
            network: vec![NetworkRule { domain: "example.com".to_string(), action: "allow".to_string() }],
        };
        assert_eq!(p.decide_network("example.com"), PolicyDecision::Ask);
        assert_eq!(p.decide_network("www.example.com"), PolicyDecision::Ask);
        assert_eq!(p.decide_network("sub.example.com"), PolicyDecision::Ask);
        assert_eq!(p.decide_network("evil.com"), PolicyDecision::Deny);
    }

    #[test]
    fn network_explicit_deny_wins() {
        let p = ToolPolicy {
            rules: Vec::new(),
            paths: Vec::new(),
            network: vec![NetworkRule { domain: "internal.corp".to_string(), action: "deny".to_string() }],
        };
        assert_eq!(p.decide_network("internal.corp"), PolicyDecision::Deny);
    }

    #[test]
    fn path_rules_allow_override_deny_by_order() {
        let p = ToolPolicy {
            rules: Vec::new(),
            paths: vec![
                PathRule {
                    prefix: "/home/kareem/.ssh".to_string(),
                    action: "deny".to_string(),
                },
                PathRule {
                    prefix: "/home/kareem/.ssh/authorized_keys".to_string(),
                    action: "allow".to_string(),
                },
            ],
            network: Vec::new(),
        };
        // First match wins: the deny prefix comes first, so it wins.
        assert_eq!(p.decide_path("/home/kareem/.ssh/authorized_keys"), PolicyDecision::Deny);
    }

    #[test]
    fn decide_input_orders_network_path_then_tool() {
        let p = ToolPolicy {
            rules: vec![ToolRule { tool: "all".to_string(), action: "allow".to_string() }],
            paths: vec![PathRule {
                prefix: "/etc".to_string(),
                action: "deny".to_string(),
            }],
            network: vec![NetworkRule { domain: "example.com".to_string(), action: "allow".to_string() }],
        };
        // Path deny wins over the catch-all tool allow.
        assert_eq!(
            p.decide_input("Write", &json!({ "file_path": "/etc/passwd", "content": "x" })),
            InputDecision::Deny("Denied (project path policy)")
        );
        // Network tools to non-allowlisted hosts are denied before anything else.
        assert_eq!(
            p.decide_input("WebFetch", &json!({ "url": "https://evil.com/x" })),
            InputDecision::Deny("Denied (project network policy)")
        );
        // Allowlisted host + no path hit → falls to the tool rule (allow).
        assert_eq!(
            p.decide_input("WebFetch", &json!({ "url": "https://example.com/x" })),
            InputDecision::Allow("Auto-approved (project policy)")
        );
        // Path rule for the input's path.
        assert_eq!(
            p.decide_input("Read", &json!({ "path": "/etc/hosts" })),
            InputDecision::Deny("Denied (project path policy)")
        );
        // Bare string input counts as a path.
        assert_eq!(p.decide_input("read", &json!("/etc/hosts")), InputDecision::Deny("Denied (project path policy)"));
    }

    #[test]
    fn decide_input_gates_foreign_network_tools() {
        // Claude's WebSearch is not in our registry but classifies as network.
        let p = ToolPolicy::default();
        assert_eq!(
            p.decide_input("WebSearch", &json!({ "url": "https://example.com/q" })),
            InputDecision::Deny("Denied (project network policy)")
        );
    }

    #[test]
    fn decide_input_no_rules_means_ask() {
        let p = ToolPolicy::default();
        assert_eq!(p.decide_input("Bash", &json!({ "command": "ls" })), InputDecision::Ask);
        // A network tool with no url in the input cannot be gated by host.
        assert_eq!(p.decide_input("WebFetch", &json!({})), InputDecision::Ask);
    }
}

/// Best-effort host extraction from a URL string
/// ("https://sub.example.com/x" → "sub.example.com").
fn url_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

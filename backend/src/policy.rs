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
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny,
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

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PolicyFile {
    #[serde(default)]
    pub rules: Vec<ToolRule>,
    #[serde(default)]
    pub paths: Vec<PathRule>,
}

#[derive(Debug, Clone, Default)]
pub struct ToolPolicy {
    rules: Vec<ToolRule>,
    paths: Vec<PathRule>,
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        assert_eq!(p.decide_path("/home/kareem/.ssh/id_rsa"), PolicyDecision::Deny);
        assert_eq!(p.decide_path("/home/kareem/.ssh/config"), PolicyDecision::Deny);
        // Sibling directories are not matched.
        assert_eq!(p.decide_path("/home/kareem/Documents"), PolicyDecision::Ask);
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
        };
        // First match wins: the deny prefix comes first, so it wins.
        assert_eq!(p.decide_path("/home/kareem/.ssh/authorized_keys"), PolicyDecision::Deny);
    }
}

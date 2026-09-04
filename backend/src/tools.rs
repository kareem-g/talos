//! Unified tool registry — the harness's single source of truth for its tool
//! surface.
//!
//! Every backend used to own its tools piecemeal: the API path had a JSON blob
//! in `api_tools.rs`, risk levels were guessed by substring in
//! `permissions.rs`, and ACP re-implemented a slice of the policy check
//! inline. The registry centralizes three things so policy, telemetry, and
//! approvals apply uniformly to every tool call from every backend:
//!
//! 1. **Definitions** — [`anthropic_definitions`] /
//!    [`openai_definitions`] serialize the same specs for either wire format,
//!    so both API transports advertise identical tools.
//! 2. **Classification** — [`classify`] maps *any* tool name (including ones
//!    we don't define, like Claude's `WebSearch` or an ACP agent's
//!    `run_command`) to a category and risk level. The permission card, the
//!    tool events, and the policy gates all use this one classifier.
//! 3. **Visibility** — [`summary`] feeds `GET /api/tools` so the dashboard
//!    can show exactly what the harness offers and at what risk.
//!
//! Native backends (claude, ACP) execute their own tools; the registry still
//! classifies their calls for the card and applies the same pre-policy (see
//! `policy::ToolPolicy::decide_input`) before any of them runs.

use serde_json::{json, Value};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCategory {
    Filesystem,
    Shell,
    Search,
    Git,
    Network,
    Memory,
    Plan,
    Communication,
    Other,
}

impl ToolCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolCategory::Filesystem => "filesystem",
            ToolCategory::Shell => "shell",
            ToolCategory::Search => "search",
            ToolCategory::Git => "git",
            ToolCategory::Network => "network",
            ToolCategory::Memory => "memory",
            ToolCategory::Plan => "plan",
            ToolCategory::Communication => "communication",
            ToolCategory::Other => "other",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Risk {
    Low,
    Medium,
    High,
}

impl Risk {
    pub fn as_str(self) -> &'static str {
        match self {
            Risk::Low => "low",
            Risk::Medium => "medium",
            Risk::High => "high",
        }
    }
}

/// One registered tool: name, what it does, its JSON schema, and how risky it
/// is. Risk drives the permission card and nothing gets executed without
/// passing the policy + permission pipeline first.
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub category: ToolCategory,
    pub risk: Risk,
    pub input_schema: Value,
}

fn spec(
    name: &'static str,
    description: &'static str,
    category: ToolCategory,
    risk: Risk,
    input_schema: Value,
) -> ToolSpec {
    ToolSpec { name, description, category, risk, input_schema }
}

/// The name of the fan-out tool, exported so transports can filter it out of
/// subagent sessions (bounded workers must not dispatch their own children).
pub const DISPATCH_TOOL: &str = "Dispatch";

/// The built-in tool set the harness executes on behalf of custom providers.
/// Adding a tool here makes it appear on both API transports and in
/// `GET /api/tools`; wiring its execution happens in `api_tools.rs`.
pub fn registry() -> &'static [ToolSpec] {
    static REGISTRY: OnceLock<Vec<ToolSpec>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        vec![
            spec(
                "Bash",
                "Run a shell command in the project directory. Use for builds, tests, git, and any command-line work. Output is capped.",
                ToolCategory::Shell,
                Risk::High,
                json!({
                    "type": "object",
                    "properties": { "command": { "type": "string", "description": "The shell command to run" } },
                    "required": ["command"]
                }),
            ),
            spec(
                "Read",
                "Read a file from disk. Returns its contents, capped to a reasonable size.",
                ToolCategory::Filesystem,
                Risk::Low,
                json!({
                    "type": "object",
                    "properties": { "path": { "type": "string", "description": "Absolute or project-relative file path" } },
                    "required": ["path"]
                }),
            ),
            spec(
                "Write",
                "Write content to a file, creating parent directories as needed. Overwrites existing content.",
                ToolCategory::Filesystem,
                Risk::High,
                json!({
                    "type": "object",
                    "properties": {
                        "file_path": { "type": "string", "description": "Absolute or project-relative file path" },
                        "content": { "type": "string", "description": "The full file content" }
                    },
                    "required": ["file_path", "content"]
                }),
            ),
            spec(
                "Edit",
                "Replace the first occurrence of old_string with new_string in a file. Safer than rewriting the whole file.",
                ToolCategory::Filesystem,
                Risk::High,
                json!({
                    "type": "object",
                    "properties": {
                        "file_path": { "type": "string", "description": "Absolute or project-relative file path" },
                        "old_string": { "type": "string", "description": "Exact text to find" },
                        "new_string": { "type": "string", "description": "Replacement text" }
                    },
                    "required": ["file_path", "old_string", "new_string"]
                }),
            ),
            spec(
                "Glob",
                "Find files matching a glob pattern (e.g. \"**/*.rs\", \"src/**\"). Returns matching paths relative to the project.",
                ToolCategory::Search,
                Risk::Low,
                json!({
                    "type": "object",
                    "properties": { "pattern": { "type": "string", "description": "Glob pattern" } },
                    "required": ["pattern"]
                }),
            ),
            spec(
                "Grep",
                "Search file contents for a regex pattern in the project. Returns up to 20 matches with file:line.",
                ToolCategory::Search,
                Risk::Low,
                json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Regex to search for" },
                        "path": { "type": "string", "description": "Optional path/dir to scope the search to" }
                    },
                    "required": ["pattern"]
                }),
            ),
            spec(
                "GitStatus",
                "Show the git working tree status (short format with branch).",
                ToolCategory::Git,
                Risk::Low,
                json!({ "type": "object", "properties": {} }),
            ),
            spec(
                "GitDiff",
                "Show uncommitted changes (git diff). Output is capped.",
                ToolCategory::Git,
                Risk::Low,
                json!({ "type": "object", "properties": {} }),
            ),
            spec(
                "TodoWrite",
                "Write a plan as a todo list. The harness records it as the session plan. Use it before starting non-trivial work.",
                ToolCategory::Plan,
                Risk::Low,
                json!({
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "content": { "type": "string" },
                                    "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                                },
                                "required": ["content"]
                            }
                        }
                    },
                    "required": ["todos"]
                }),
            ),
            spec(
                "WebFetch",
                "Fetch a URL and return its text content (HTML stripped). Subject to the project's network policy — domains must be allowlisted in .agentdeck/policy.toml.",
                ToolCategory::Network,
                Risk::Medium,
                json!({
                    "type": "object",
                    "properties": { "url": { "type": "string", "description": "http(s) URL to fetch" } },
                    "required": ["url"]
                }),
            ),
            spec(
                "Remember",
                "Save a note to the project's memory so future sessions can recall it. Use for decisions, findings, or conventions the project should remember. kind 'memory' (recall when relevant) or 'convention' (always injected project rule).",
                ToolCategory::Memory,
                Risk::Low,
                json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "Short title" },
                        "content": { "type": "string", "description": "What to remember" },
                        "kind": { "type": "string", "enum": ["memory", "convention"], "description": "memory (default) or convention" }
                    },
                    "required": ["content"]
                }),
            ),
            spec(
                "Dispatch",
                "Fan a task out to other agents in parallel and get back one merged answer. Use it when a task has independent parts different agents could do, or when you want independent opinions to compare. Each agent runs the SAME self-contained task; a merge step synthesizes their answers into one. agents takes provider agent ids (e.g. claude, opencode, or a custom provider id) — and inside a room channel you can also name room workers (e.g. [\"Scout\"]): they run on the room's agent with their own name, roster identity, and skills. Children run to completion, so this can take minutes.",
                ToolCategory::Communication,
                Risk::Medium,
                json!({
                    "type": "object",
                    "properties": {
                        "task": { "type": "string", "description": "The self-contained task to give every agent" },
                        "agents": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Agent ids to fan out to, e.g. [\"claude\", \"opencode\"]"
                        }
                    },
                    "required": ["task", "agents"]
                }),
            ),
            spec(
                "preview_app",
                "Serve this workspace's app and open it in the session browser so the user can see it running. Use AUTOMATICALLY after creating or changing a web app (HTML/JS/app) — do not wait to be asked, and do not finish the turn without previewing when the project has a runnable entry point (index.html, package.json dev script). Empty command serves the folder statically. For other stacks give a start command that MUST serve exactly the assigned port: include the {port} placeholder (e.g. \"npm run dev -- --port {port} --host 127.0.0.1\") or read $PORT. NEVER hardcode a port (no 8080/3000/9000) and NEVER background the server yourself with & or lsof/ss/netstat sleuthing — this tool manages the server. Works with any stack (static, Vite, Next.js, npm scripts, python http.server) as long as it listens on {port}. Set open_browser false to only start the server and report the URL.",
                ToolCategory::Other,
                Risk::Low,
                json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Custom start command with a {port} placeholder. Empty serves files statically." },
                        "open_browser": { "type": "boolean", "description": "Open the URL in the session browser (default true)." }
                    }
                }),
            ),
            spec(
                "GetConfig",
                "Read this session's current harness configuration: model, reasoning effort, max output tokens, context window, and permission mode. Use it to answer questions about your own settings — what effort you are running at, what model you are, etc.",
                ToolCategory::Other,
                Risk::Low,
                json!({ "type": "object", "properties": {} }),
            ),
        ]
    })
}

/// Look up a registered spec by name (case-insensitive).
pub fn find(name: &str) -> Option<&'static ToolSpec> {
    registry().iter().find(|tool| tool.name.eq_ignore_ascii_case(name))
}

/// Classify any tool call — ours or a native backend's — by name. Registry
/// hits use the declared category/risk; foreign names fall through to a
/// substring heuristic so Claude's `WebSearch` or an ACP agent's
/// `run_command` still gets a sensible category and risk on the card.
pub fn classify(name: &str) -> (ToolCategory, Risk) {
    if let Some(tool) = find(name) {
        return (tool.category, tool.risk);
    }
    let lower = name.to_lowercase();
    // Shell first: "run_command"/"execute" style names must not fall into the
    // filesystem branch just because they mention files.
    if lower.contains("bash")
        || lower.contains("shell")
        || lower.contains("exec")
        || lower.contains("run_command")
        || lower.contains("terminal")
        || lower.contains("command")
    {
        return (ToolCategory::Shell, Risk::High);
    }
    if lower.contains("delete")
        || lower.contains("remove")
        || lower.contains("write")
        || lower.contains("edit")
        || lower.contains("str_replace")
        || lower.contains("create_file")
        || lower.contains("notebook")
    {
        return (ToolCategory::Filesystem, Risk::High);
    }
    if lower.contains("webfetch")
        || lower.contains("websearch")
        || lower.contains("fetch")
        || lower.contains("http")
        || lower.contains("url")
        || lower.contains("request")
    {
        return (ToolCategory::Network, Risk::Medium);
    }
    if lower.contains("git") {
        return (ToolCategory::Git, Risk::Medium);
    }
    if lower.contains("glob")
        || lower.contains("grep")
        || lower.contains("search")
        || lower.contains("find")
        || lower.contains("list")
    {
        return (ToolCategory::Search, Risk::Low);
    }
    if lower.contains("read")
        || lower.contains("view")
        || lower.contains("cat")
        || lower.contains("file")
    {
        return (ToolCategory::Filesystem, Risk::Low);
    }
    if lower.contains("todo")
        || lower.contains("plan")
        || lower.contains("task")
    {
        return (ToolCategory::Plan, Risk::Low);
    }
    if lower.contains("remember")
        || lower.contains("memory")
    {
        return (ToolCategory::Memory, Risk::Low);
    }
    if lower.contains("question")
        || lower.contains("ask")
        || lower.contains("message")
        || lower.contains("notify")
    {
        return (ToolCategory::Communication, Risk::Low);
    }
    (ToolCategory::Other, Risk::Low)
}

/// The registry in Anthropic `tools` format (for `/v1/messages`).
pub fn anthropic_definitions() -> Vec<Value> {
    registry()
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            })
        })
        .collect()
}

/// The registry in OpenAI function-calling format (for `/chat/completions`).
pub fn openai_definitions() -> Vec<Value> {
    registry()
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        })
        .collect()
}

/// The registry as user-facing summaries for `GET /api/tools`.
pub fn summary() -> Vec<Value> {
    registry()
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "category": tool.category.as_str(),
                "risk": tool.risk.as_str(),
                "source": "builtin",
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_unique_names() {
        let names: Vec<&str> = registry().iter().map(|tool| tool.name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(names.len(), sorted.len(), "duplicate tool names in registry");
    }

    #[test]
    fn every_spec_has_a_schema() {
        for tool in registry() {
            assert_eq!(
                tool.input_schema.get("type").and_then(Value::as_str),
                Some("object"),
                "{} must carry an object schema",
                tool.name
            );
        }
    }

    #[test]
    fn registry_lookup_is_case_insensitive() {
        assert!(find("bash").is_some());
        assert!(find("BASH").is_some());
        assert!(find("not-a-tool").is_none());
    }

    #[test]
    fn classify_uses_declared_values_for_registered_tools() {
        assert_eq!(classify("Bash"), (ToolCategory::Shell, Risk::High));
        assert_eq!(classify("WebFetch"), (ToolCategory::Network, Risk::Medium));
        assert_eq!(classify("Read"), (ToolCategory::Filesystem, Risk::Low));
        assert_eq!(classify("preview_app"), (ToolCategory::Other, Risk::Low));
    }

    #[test]
    fn classify_covers_foreign_tool_names() {
        // Claude's native tools.
        assert_eq!(classify("WebSearch"), (ToolCategory::Network, Risk::Medium));
        assert_eq!(classify("ExitPlanMode"), (ToolCategory::Plan, Risk::Low));
        assert_eq!(classify("AskUserQuestion"), (ToolCategory::Communication, Risk::Low));
        assert_eq!(classify("MultiEdit"), (ToolCategory::Filesystem, Risk::High));
        // ACP-style names.
        assert_eq!(classify("run_command"), (ToolCategory::Shell, Risk::High));
        assert_eq!(classify("read_file"), (ToolCategory::Filesystem, Risk::Low));
        assert_eq!(classify("write_file"), (ToolCategory::Filesystem, Risk::High));
        // Unknown tools still classify.
        assert_eq!(classify("some_mcp_tool"), (ToolCategory::Other, Risk::Low));
    }

    #[test]
    fn wire_formats_carry_every_registered_tool() {
        let anthropic = anthropic_definitions();
        let openai = openai_definitions();
        assert_eq!(anthropic.len(), registry().len());
        assert_eq!(openai.len(), registry().len());
        for tool in registry() {
            assert!(anthropic.iter().any(|t| t.get("name").and_then(Value::as_str) == Some(tool.name)));
            assert!(openai
                .iter()
                .any(|t| t.pointer("/function/name").and_then(Value::as_str) == Some(tool.name)));
        }
    }

    #[test]
    fn summary_includes_classification() {
        let entries = summary();
        assert!(entries.iter().all(|entry| {
            entry.get("category").is_some() && entry.get("risk").is_some() && entry.get("source") == Some(&json!("builtin"))
        }));
    }
}

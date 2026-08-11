use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub server: ServerConfig,
    pub security: SecurityConfig,
    pub tunnel: TunnelConfig,
    pub agents: AgentsConfig,
    pub worktree: WorktreeConfig,
    pub mcp: McpConfig,
    pub notifications: NotificationsConfig,
    pub theme: ThemeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub bind_interface: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub auto_pair: bool,
    pub auth_token: Option<String>,
    pub tls_enabled: bool,
    pub tls_cert_path: Option<String>,
    pub tls_key_path: Option<String>,
    pub project_allowlist: Vec<String>,
    pub require_approval_for: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelConfig {
    pub tailscale: TailscaleConfig,
    pub cloudflare: CloudflareConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleConfig {
    pub enabled: bool,
    pub hostname: String,
    pub auto_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareConfig {
    pub enabled: bool,
    pub token: Option<String>,
    pub hostname: Option<String>,
    pub tunnel_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentsConfig {
    pub claude: AgentBinary,
    pub codex: AgentBinary,
    pub opencode: AgentBinary,
    pub auto_detect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBinary {
    pub path: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeConfig {
    pub enabled: bool,
    pub base_dir: String,
    pub auto_merge: bool,
    pub auto_create_on_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    pub servers: Vec<McpServer>,
    pub socket_pool_enabled: bool,
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationsConfig {
    pub telegram: TelegramConfig,
    pub slack: SlackConfig,
    pub discord: DiscordConfig,
    pub email: EmailConfig,
    pub notify_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    pub enabled: bool,
    pub bot_token: Option<String>,
    pub chat_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackConfig {
    pub enabled: bool,
    pub webhook_url: Option<String>,
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    pub enabled: bool,
    pub webhook_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailConfig {
    pub enabled: bool,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub from: Option<String>,
    pub to: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    pub default: String,
    pub custom: Option<std::collections::HashMap<String, ThemePalette>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemePalette {
    pub background: String,
    pub surface: String,
    pub accent: String,
    pub text: String,
    pub success: String,
    pub warning: String,
    pub error: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "0.0.0.0".to_string(),
                port: 9120,
                bind_interface: None,
            },
            security: SecurityConfig {
                auto_pair: true,
                auth_token: None,
                tls_enabled: true,
                tls_cert_path: None,
                tls_key_path: None,
                project_allowlist: vec![],
                require_approval_for: vec!["rm".to_string(), "sudo".to_string()],
            },
            tunnel: TunnelConfig {
                tailscale: TailscaleConfig {
                    enabled: false,
                    hostname: "agentdeck".to_string(),
                    auto_connect: false,
                },
                cloudflare: CloudflareConfig {
                    enabled: false,
                    token: None,
                    hostname: None,
                    tunnel_id: None,
                },
            },
            agents: AgentsConfig {
                claude: AgentBinary {
                    path: "claude".to_string(),
                    args: vec![],
                    env: std::collections::HashMap::new(),
                },
                codex: AgentBinary {
                    path: "codex".to_string(),
                    args: vec![],
                    env: std::collections::HashMap::new(),
                },
                opencode: AgentBinary {
                    path: "opencode".to_string(),
                    args: vec![],
                    env: std::collections::HashMap::new(),
                },
                auto_detect: true,
            },
            worktree: WorktreeConfig {
                enabled: true,
                base_dir: "~/.agentdeck/worktrees".to_string(),
                auto_merge: false,
                auto_create_on_session: true,
            },
            mcp: McpConfig {
                servers: vec![],
                socket_pool_enabled: true,
                auto_start: false,
            },
            notifications: NotificationsConfig {
                telegram: TelegramConfig {
                    enabled: false,
                    bot_token: None,
                    chat_id: None,
                },
                slack: SlackConfig {
                    enabled: false,
                    webhook_url: None,
                    channel: None,
                },
                discord: DiscordConfig {
                    enabled: false,
                    webhook_url: None,
                },
                email: EmailConfig {
                    enabled: false,
                    smtp_host: None,
                    smtp_port: 587,
                    smtp_user: None,
                    smtp_pass: None,
                    from: None,
                    to: vec![],
                },
                notify_on: vec![
                    "session_completed".to_string(),
                    "approval_required".to_string(),
                    "error".to_string(),
                ],
            },
            theme: ThemeConfig {
                default: "tokyo-night".to_string(),
                custom: None,
            },
        }
    }
}

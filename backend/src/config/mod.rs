pub mod settings;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::agents::acp::AcpManager;
use crate::auth::devices::DeviceStore;
use crate::pty::manager::PtyManager;
use crate::sessions::manager::SessionManager;
use crate::transcript::TranscriptTails;
use crate::websocket::broadcast::BroadcastHub;
use crate::Result;

#[derive(Debug, Clone)]
pub struct PendingOffer {
    pub fingerprint: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub secret_hash: String,
}

pub struct Config {
    settings: settings::Settings,
    path: PathBuf,
    pub pending_offers: HashMap<String, PendingOffer>,
}

impl Config {
    pub async fn load() -> Result<Self> {
        let path = Self::config_path();
        let settings = if path.exists() {
            let content = tokio::fs::read_to_string(&path).await?;
            let mut loaded = toml::from_str(&content)
                .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?;
            // Backfill models/reasoning for agents that predate the field so
            // existing installs get the same discoverable list without a
            // manual config edit.
            settings::backfill_defaults(&mut loaded);
            let backfilled_toml = toml::to_string_pretty(&loaded)
                .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?;
            if backfilled_toml.trim() != content.trim() {
                tokio::fs::write(&path, backfilled_toml).await?;
            }
            loaded
        } else {
            let default = settings::Settings::default();
            let default_toml = toml::to_string_pretty(&default)
                .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?;
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&path, default_toml).await?;
            default
        };

        Ok(Self {
            settings,
            path,
            pending_offers: HashMap::new(),
        })
    }

    pub async fn save(&self) -> Result<()> {
        let content = toml::to_string_pretty(&self.settings)
            .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?;
        tokio::fs::write(&self.path, content).await?;
        Ok(())
    }

    pub fn settings(&self) -> &settings::Settings {
        &self.settings
    }

    pub fn settings_mut(&mut self) -> &mut settings::Settings {
        &mut self.settings
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    fn config_path() -> PathBuf {
        let xdg_dirs = xdg::BaseDirectories::with_prefix("agentdeck")
            .expect("Failed to initialize XDG directories");
        xdg_dirs.place_config_file("config.toml")
            .expect("Failed to create config directory")
    }
}

pub struct AppState {
    pub config: Arc<RwLock<Config>>,
    pub session_manager: Arc<SessionManager>,
    pub pty_manager: Arc<PtyManager>,
    /// Generic ACP (Agent Client Protocol) subprocess manager for CLIs that
    /// speak ACP (opencode, copilot, gemini, cursor, qwen, …). These agents
    /// stream native structured events instead of a PTY.
    pub acp_manager: Arc<AcpManager>,
    /// Structured Claude transport (`claude -p --output-format stream-json`).
    /// Replaces PTY scraping for Claude so the chat view shows real content
    /// instead of TUI chrome.
    pub claude_stream: Arc<crate::agents::claude_stream::ClaudeStreamManager>,
    /// Provider discovery: what agent CLIs this machine can actually run, with
    /// their real models and config dimensions. Cached with a TTL because a
    /// probe spawns processes.
    pub providers: Arc<crate::providers::ProviderRegistry>,
    pub devices: Arc<DeviceStore>,
    pub hook_tokens: Arc<RwLock<HashMap<String, String>>>,
    pub hook_starts: Arc<RwLock<HashMap<String, chrono::DateTime<chrono::Utc>>>>,
    /// In-flight Claude tool-permission decisions (`--permission-prompt-tool`).
    pub permissions: Arc<crate::permissions::PermissionBroker>,
    /// Pi CLI one-shot semantic turns (`pi -p --mode json`).
    pub pi_stream: Arc<crate::agents::pi_stream::PiStreamManager>,
    /// Custom API providers (OpenAI-compatible, Anthropic-compatible).
    pub api_manager: Arc<crate::agents::api::ApiManager>,
    /// Workspace app servers (right-pane browser "run this app").
    pub app_servers: Arc<crate::workspace_serve::WorkspaceServers>,
    pub broadcast: BroadcastHub,
    pub transcript_tails: Option<Arc<TranscriptTails>>,
    pub browser_manager: Arc<crate::browser::manager::BrowserManager>,
    pub trajectories: Arc<crate::trajectory::TrajectoryRecorder>,
    /// Web Push delivery to subscribed browsers/phones — pages the user when an
    /// agent finishes, needs approval, or errors, even with the app closed.
    pub push: Arc<crate::notifications::push::PushService>,
    /// Remote view / control: the live-session registry, the enable gate and the
    /// platform capture/input backend. One instance per daemon; sessions are
    /// shared across every viewer attached to them.
    pub remote: Arc<crate::remote::RemoteManager>,
}

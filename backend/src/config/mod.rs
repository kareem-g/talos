pub mod settings;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::pty::manager::PtyManager;
use crate::auth::devices::DeviceStore;
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
    pub devices: Arc<DeviceStore>,
    pub hook_tokens: Arc<RwLock<HashMap<String, String>>>,
    pub hook_starts: Arc<RwLock<HashMap<String, chrono::DateTime<chrono::Utc>>>>,
    pub broadcast: BroadcastHub,
    pub transcript_tails: Option<Arc<TranscriptTails>>,
}

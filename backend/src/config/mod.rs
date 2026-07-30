pub mod settings;

use std::path::PathBuf;
use crate::Result;

pub struct Config {
    settings: settings::Settings,
    path: PathBuf,
}

impl Config {
    pub async fn load() -> Result<Self> {
        let path = Self::config_path();
        let settings = if path.exists() {
            let content = tokio::fs::read_to_string(&path).await?;
            toml::from_str(&content)
                .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?
        } else {
            let default = settings::Settings::default();
            // Write default config
            let default_toml = toml::to_string_pretty(&default)
                .map_err(|e| crate::AgentDeckError::Config(e.to_string()))?;
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&path, default_toml).await?;
            default
        };

        Ok(Self { settings, path })
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

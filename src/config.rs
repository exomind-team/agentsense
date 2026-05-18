use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub quota: QuotaConfig,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct QuotaConfig {
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    pub proxy: Option<String>,
    pub db_path: Option<PathBuf>,
    pub minimax: Option<KeyConfig>,
    pub deepseek: Option<KeyConfig>,
    #[serde(rename = "zai")]
    pub zai: Option<ZaiKeyConfig>,
}

impl Default for QuotaConfig {
    fn default() -> Self {
        Self {
            poll_interval_secs: default_poll_interval(),
            proxy: None,
            db_path: None,
            minimax: None,
            deepseek: None,
            zai: None,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct KeyConfig {
    pub api_key: Option<String>,
    pub api_key_env: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ZaiKeyConfig {
    pub auth_token: Option<String>,
    pub auth_token_env: Option<String>,
}

fn default_poll_interval() -> u64 {
    60
}

impl AppConfig {
    pub fn load(path: &std::path::Path) -> Result<Self, crate::error::AgentSenseError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path)?;
        let config: Self = toml::from_str(&content)?;
        Ok(config)
    }

    pub fn default_path() -> PathBuf {
        PathBuf::from("config.toml")
    }
}

impl QuotaConfig {
    pub fn db_path(&self) -> PathBuf {
        self.db_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("quota.db"))
    }

    pub fn minimax_key(&self) -> Option<String> {
        self.minimax
            .as_ref()
            .and_then(|c| resolve_key(&c.api_key, &c.api_key_env))
    }

    pub fn deepseek_key(&self) -> Option<String> {
        self.deepseek
            .as_ref()
            .and_then(|c| resolve_key(&c.api_key, &c.api_key_env))
    }

    pub fn zai_token(&self) -> Option<String> {
        self.zai
            .as_ref()
            .and_then(|c| resolve_key(&c.auth_token, &c.auth_token_env))
    }
}

fn resolve_key(direct: &Option<String>, env_var: &Option<String>) -> Option<String> {
    direct
        .clone()
        .or_else(|| env_var.as_ref().and_then(|var| std::env::var(var).ok()))
}

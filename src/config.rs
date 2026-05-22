use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub quota: QuotaConfig,
    #[cfg(feature = "psu")]
    #[serde(default)]
    pub serial: Option<SerialConfig>,
    #[cfg(feature = "psu")]
    #[serde(default)]
    pub device: DeviceConfig,
    #[cfg(feature = "psu")]
    #[serde(default)]
    pub cost: CostConfig,
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
    #[serde(rename = "mimo")]
    pub mimo: Option<MimoConfig>,
    pub claude: Option<ClaudeConfig>,
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
            mimo: None,
            claude: None,
        }
    }
}

/// Claude reuses Claude Code's OAuth credentials file instead of an API key.
/// Default: enabled whenever the credentials file exists.
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct ClaudeConfig {
    pub enabled: Option<bool>,
    pub credentials_path: Option<PathBuf>,
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

#[derive(Debug, Deserialize, Serialize)]
pub struct MimoConfig {
    pub cookie: Option<String>,
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

    /// Resolved credentials path when Claude monitoring is active, else None.
    /// Active = not explicitly disabled AND the credentials file exists.
    pub fn claude_creds_path(&self) -> Option<PathBuf> {
        let cfg = self.claude.as_ref();
        if matches!(cfg.and_then(|c| c.enabled), Some(false)) {
            return None;
        }
        let path =
            crate::quota::claude::credentials_path(&cfg.and_then(|c| c.credentials_path.clone()));
        path.exists().then_some(path)
    }

    pub fn mimo_cookie(&self) -> Option<String> {
        self.mimo
            .as_ref()
            .and_then(|c| c.cookie.clone())
            .filter(|s| !s.is_empty())
    }
}

fn resolve_key(direct: &Option<String>, env_var: &Option<String>) -> Option<String> {
    direct
        .clone()
        .or_else(|| env_var.as_ref().and_then(|var| std::env::var(var).ok()))
}

#[cfg(feature = "psu")]
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct SerialConfig {
    pub port: String,
    #[serde(default = "default_baud")]
    pub baud: u32,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_sample_interval")]
    pub sample_interval_ms: u64,
}

#[cfg(feature = "psu")]
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct DeviceConfig {
    #[serde(default = "default_profile")]
    pub profile: String,
}

#[cfg(feature = "psu")]
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct CostConfig {
    #[serde(default = "default_price")]
    pub price_per_kwh: f64,
    #[serde(default = "default_currency")]
    pub currency: String,
}

#[cfg(feature = "psu")]
fn default_baud() -> u32 {
    115200
}
#[cfg(feature = "psu")]
fn default_mode() -> String {
    "active".to_string()
}
#[cfg(feature = "psu")]
fn default_sample_interval() -> u64 {
    300
}
#[cfg(feature = "psu")]
fn default_profile() -> String {
    "segotep_dm".to_string()
}
#[cfg(feature = "psu")]
fn default_price() -> f64 {
    0.56
}
#[cfg(feature = "psu")]
fn default_currency() -> String {
    "CNY".to_string()
}

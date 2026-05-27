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
    #[serde(default)]
    pub minimax: Vec<KeyConfig>,
    #[serde(default)]
    pub deepseek: Vec<KeyConfig>,
    #[serde(default, rename = "zai")]
    pub zai: Vec<ZaiKeyConfig>,
    #[serde(default, rename = "mimo")]
    pub mimo: Vec<MimoConfig>,
    pub claude: Option<ClaudeConfig>,
    #[serde(default)]
    pub deepseek_platform: Vec<DeepSeekPlatformConfig>,
}

impl Default for QuotaConfig {
    fn default() -> Self {
        Self {
            poll_interval_secs: default_poll_interval(),
            proxy: None,
            db_path: None,
            minimax: Vec::new(),
            deepseek: Vec::new(),
            zai: Vec::new(),
            mimo: Vec::new(),
            claude: None,
            deepseek_platform: Vec::new(),
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

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct DeepSeekPlatformConfig {
    pub bearer_token: Option<String>,
    pub bearer_token_env: Option<String>,
    pub cookies: Option<String>,
    pub cookies_env: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct KeyConfig {
    pub api_key: Option<String>,
    pub api_key_env: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ZaiKeyConfig {
    pub auth_token: Option<String>,
    pub auth_token_env: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MimoConfig {
    pub cookie: Option<String>,
    pub label: Option<String>,
}

fn default_poll_interval() -> u64 {
    60
}

impl AppConfig {
    /// Detect old single-table format and convert to array-of-tables.
    /// Old: [quota.deepseek]\n
    /// New: [[quota.deepseek]]\n
    fn migrate_config(content: &str) -> String {
        let mut result = content.to_string();
        for provider in ["minimax", "deepseek", "zai", "mimo", "deepseek_platform"] {
            let old_header = format!("[quota.{provider}]\n");
            let new_header = format!("[[quota.{provider}]]\n");
            if result.contains(&old_header) && !result.contains(&new_header) {
                result = result.replace(&old_header, &new_header);
            }
        }
        result
    }

    pub fn load(path: &std::path::Path) -> Result<Self, crate::error::AgentSenseError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path)?;
        let migrated = Self::migrate_config(&content);

        let config: Self = toml::from_str(&migrated)?;

        // Write back if migration changed anything
        if migrated != content {
            let _ = std::fs::write(path, &migrated);
        }

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

    pub fn minimax_keys(&self) -> Vec<(String, Option<String>)> {
        self.minimax
            .iter()
            .filter_map(|c| {
                resolve_key(&c.api_key, &c.api_key_env).map(|k| (k, c.label.clone()))
            })
            .collect()
    }

    pub fn deepseek_keys(&self) -> Vec<(String, Option<String>)> {
        self.deepseek
            .iter()
            .filter_map(|c| {
                resolve_key(&c.api_key, &c.api_key_env).map(|k| (k, c.label.clone()))
            })
            .collect()
    }

    pub fn zai_tokens(&self) -> Vec<(String, Option<String>)> {
        self.zai
            .iter()
            .filter_map(|c| {
                resolve_key(&c.auth_token, &c.auth_token_env).map(|k| (k, c.label.clone()))
            })
            .collect()
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

    pub fn mimo_cookies(&self) -> Vec<(String, Option<String>)> {
        self.mimo
            .iter()
            .filter_map(|c| {
                c.cookie
                    .clone()
                    .filter(|s| !s.is_empty())
                    .map(|k| (k, c.label.clone()))
            })
            .collect()
    }

    pub fn deepseek_platform_creds_list(&self) -> Vec<((String, String), Option<String>)> {
        self.deepseek_platform
            .iter()
            .filter_map(|cfg| {
                let token = resolve_key(&cfg.bearer_token, &cfg.bearer_token_env)?;
                let cookies = cfg.cookies.clone().or_else(|| {
                    cfg.cookies_env
                        .as_ref()
                        .and_then(|var| std::env::var(var).ok())
                })?;
                Some(((token, cookies), cfg.label.clone()))
            })
            .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_single_to_array_table() {
        let old = r#"
[quota]
poll_interval_secs = 60

[quota.deepseek]
api_key = "sk-test123"

[quota.minimax]
api_key = "sk-minimax456"
"#;
        let migrated = AppConfig::migrate_config(old);
        assert!(migrated.contains("[[quota.deepseek]]"), "deepseek should be array");
        assert!(migrated.contains("[[quota.minimax]]"), "minimax should be array");
        assert!(!migrated.contains("[quota.deepseek]\n"), "old format gone");

        let config: AppConfig = toml::from_str(&migrated).unwrap();
        assert_eq!(config.quota.deepseek.len(), 1);
        assert_eq!(
            config.quota.deepseek[0].api_key.as_deref(),
            Some("sk-test123")
        );
    }

    #[test]
    fn migrate_idempotent() {
        let already_new = r#"
[[quota.deepseek]]
api_key = "sk-test"
"#;
        let result = AppConfig::migrate_config(already_new);
        assert!(result.contains("[[quota.deepseek]]"));
        assert!(
            !result.contains("[[quota.deepseek]]]]"),
            "no double migration"
        );
    }
}

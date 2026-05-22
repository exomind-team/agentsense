pub mod claude;
pub mod db;
pub mod deepseek;
pub mod mimo;
pub mod minimax;
pub mod zai;

use std::path::PathBuf;

use crate::config::QuotaConfig;
use crate::error::AgentSenseError;

use db::QuotaDb;

pub struct QuotaOrchestrator {
    client: reqwest::Client,
    db: QuotaDb,
    minimax_key: Option<String>,
    deepseek_key: Option<String>,
    zai_token: Option<String>,
    claude_creds: Option<PathBuf>,
    mimo_cookie: Option<String>,
}

pub struct FetchResult {
    pub minimax: Option<Result<minimax::MinimaxSnapshot, AgentSenseError>>,
    pub deepseek: Option<Result<deepseek::DeepSeekSnapshot, AgentSenseError>>,
    pub zai: Option<Result<zai::ZaiSnapshot, AgentSenseError>>,
    pub claude: Option<Result<claude::ClaudeSnapshot, AgentSenseError>>,
    pub mimo: Option<Result<mimo::MimoSnapshot, AgentSenseError>>,
}

impl QuotaOrchestrator {
    pub fn new(config: &QuotaConfig) -> Result<Self, AgentSenseError> {
        let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));

        if let Some(ref proxy) = config.proxy {
            let proxy = reqwest::Proxy::all(proxy)
                .map_err(|e| AgentSenseError::Config(format!("invalid proxy: {e}")))?;
            builder = builder.proxy(proxy);
        }

        let client = builder.build()?;
        let db = QuotaDb::open(&config.db_path())?;

        Ok(Self {
            client,
            db,
            minimax_key: config.minimax_key(),
            deepseek_key: config.deepseek_key(),
            zai_token: config.zai_token(),
            claude_creds: config.claude_creds_path(),
            mimo_cookie: config.mimo_cookie(),
        })
    }

    pub async fn fetch_all(&self) -> FetchResult {
        let mmx = if let Some(ref key) = self.minimax_key {
            let key = key.clone();
            let client = self.client.clone();
            Some(
                tokio::spawn(async move { minimax::fetch(&client, &key).await })
                    .await
                    .unwrap_or_else(|e| {
                        Err(AgentSenseError::Http(format!("MiniMax task panicked: {e}")))
                    }),
            )
        } else {
            None
        };

        let ds = if let Some(ref key) = self.deepseek_key {
            let key = key.clone();
            let client = self.client.clone();
            Some(
                tokio::spawn(async move { deepseek::fetch(&client, &key).await })
                    .await
                    .unwrap_or_else(|e| {
                        Err(AgentSenseError::Http(format!(
                            "DeepSeek task panicked: {e}"
                        )))
                    }),
            )
        } else {
            None
        };

        let zai = if let Some(ref token) = self.zai_token {
            let token = token.clone();
            let client = self.client.clone();
            Some(
                tokio::spawn(async move { zai::fetch(&client, &token).await })
                    .await
                    .unwrap_or_else(|e| {
                        Err(AgentSenseError::Http(format!("Z.AI task panicked: {e}")))
                    }),
            )
        } else {
            None
        };

        let claude = if let Some(ref path) = self.claude_creds {
            let path = path.clone();
            let client = self.client.clone();
            Some(
                tokio::spawn(async move { claude::fetch_with_creds(&client, &path).await })
                    .await
                    .unwrap_or_else(|e| {
                        Err(AgentSenseError::Http(format!("Claude task panicked: {e}")))
                    }),
            )
        } else {
            None
        };

        let mimo = if let Some(ref cookie) = self.mimo_cookie {
            let cookie = cookie.clone();
            let client = self.client.clone();
            Some(
                tokio::spawn(async move { mimo::fetch(&client, &cookie).await })
                    .await
                    .unwrap_or_else(|e| {
                        Err(AgentSenseError::Http(format!("MiMo task panicked: {e}")))
                    }),
            )
        } else {
            None
        };

        // Persist to DB
        if let Some(Ok(ref snap)) = mmx {
            let _ = self.db.insert_minimax(snap);
        }
        if let Some(Ok(ref snap)) = ds {
            let _ = self.db.insert_deepseek(snap);
        }
        if let Some(Ok(ref snap)) = zai {
            let _ = self.db.insert_zai(snap);
        }
        if let Some(Ok(ref snap)) = claude {
            let _ = self.db.insert_claude(snap);
        }
        if let Some(Ok(ref snap)) = mimo {
            let _ = self.db.insert_mimo(snap);
        }

        FetchResult {
            minimax: mmx,
            deepseek: ds,
            zai,
            claude,
            mimo,
        }
    }

    pub fn db(&self) -> &QuotaDb {
        &self.db
    }
}

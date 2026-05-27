pub mod claude;
pub mod db;
pub mod deepseek;
pub mod deepseek_platform;
pub mod mimo;
pub mod minimax;
pub mod zai;

use std::path::PathBuf;

use crate::config::QuotaConfig;
use crate::error::AgentSenseError;

use db::QuotaDb;

pub struct AccountResult<T> {
    pub label: Option<String>,
    pub result: Result<T, AgentSenseError>,
}

pub struct FetchResult {
    pub minimax: Vec<AccountResult<minimax::MinimaxSnapshot>>,
    pub deepseek: Vec<AccountResult<deepseek::DeepSeekSnapshot>>,
    pub zai: Vec<AccountResult<zai::ZaiSnapshot>>,
    pub claude: Option<Result<claude::ClaudeSnapshot, AgentSenseError>>,
    pub mimo: Vec<AccountResult<mimo::MimoSnapshot>>,
    pub deepseek_platform:
        Vec<AccountResult<deepseek_platform::DeepSeekPlatformSnapshot>>,
}

pub struct QuotaOrchestrator {
    client: reqwest::Client,
    db: QuotaDb,
    deepseek: Vec<(String, Option<String>)>,
    minimax: Vec<(String, Option<String>, Option<String>)>,
    zai: Vec<(String, Option<String>)>,
    mimo: Vec<(String, Option<String>)>,
    deepseek_platform: Vec<((String, String), Option<String>)>,
    claude_creds: Option<PathBuf>,
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
            deepseek: config.deepseek_keys(),
            minimax: config.minimax_keys(),
            zai: config.zai_tokens(),
            mimo: config.mimo_cookies(),
            deepseek_platform: config.deepseek_platform_creds_list(),
            claude_creds: config.claude_creds_path(),
        })
    }

    pub async fn fetch_all(&self) -> FetchResult {
        // MiniMax — parallel per account
        let mmx_handles: Vec<_> = self
            .minimax
            .iter()
            .map(|(key, label, base_url)| {
                let key = key.clone();
                let label = label.clone();
                let base_url = base_url.clone();
                let client = self.client.clone();
                tokio::spawn(async move {
                    AccountResult {
                        label,
                        result: minimax::fetch(&client, &key, base_url.as_deref()).await,
                    }
                })
            })
            .collect();

        // DeepSeek — parallel per account
        let ds_handles: Vec<_> = self
            .deepseek
            .iter()
            .map(|(key, label)| {
                let key = key.clone();
                let label = label.clone();
                let client = self.client.clone();
                tokio::spawn(async move {
                    AccountResult {
                        label,
                        result: deepseek::fetch(&client, &key).await,
                    }
                })
            })
            .collect();

        // Z.AI — parallel per account
        let zai_handles: Vec<_> = self
            .zai
            .iter()
            .map(|(token, label)| {
                let token = token.clone();
                let label = label.clone();
                let client = self.client.clone();
                tokio::spawn(async move {
                    AccountResult {
                        label,
                        result: zai::fetch(&client, &token).await,
                    }
                })
            })
            .collect();

        // MiMo — parallel per account
        let mimo_handles: Vec<_> = self
            .mimo
            .iter()
            .map(|(cookie, label)| {
                let cookie = cookie.clone();
                let label = label.clone();
                let client = self.client.clone();
                tokio::spawn(async move {
                    AccountResult {
                        label,
                        result: mimo::fetch(&client, &cookie).await,
                    }
                })
            })
            .collect();

        // DeepSeek Platform — parallel per account
        let dsp_handles: Vec<_> = self
            .deepseek_platform
            .iter()
            .map(|((token, cookies), label)| {
                let token = token.clone();
                let cookies = cookies.clone();
                let label = label.clone();
                let client = self.client.clone();
                tokio::spawn(async move {
                    AccountResult {
                        label,
                        result: deepseek_platform::fetch(&client, &token, &cookies).await,
                    }
                })
            })
            .collect();

        // Claude — single fetch (only one subscription)
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

        // Await all parallel handles
        let mut mmx = Vec::with_capacity(mmx_handles.len());
        for h in mmx_handles {
            match h.await {
                Ok(r) => mmx.push(r),
                Err(e) => mmx.push(AccountResult {
                    label: None,
                    result: Err(AgentSenseError::Http(format!(
                        "MiniMax task panicked: {e}"
                    ))),
                }),
            }
        }

        let mut ds = Vec::with_capacity(ds_handles.len());
        for h in ds_handles {
            match h.await {
                Ok(r) => ds.push(r),
                Err(e) => ds.push(AccountResult {
                    label: None,
                    result: Err(AgentSenseError::Http(format!(
                        "DeepSeek task panicked: {e}"
                    ))),
                }),
            }
        }

        let mut zai_results = Vec::with_capacity(zai_handles.len());
        for h in zai_handles {
            match h.await {
                Ok(r) => zai_results.push(r),
                Err(e) => zai_results.push(AccountResult {
                    label: None,
                    result: Err(AgentSenseError::Http(format!(
                        "Z.AI task panicked: {e}"
                    ))),
                }),
            }
        }

        let mut mimo_results = Vec::with_capacity(mimo_handles.len());
        for h in mimo_handles {
            match h.await {
                Ok(r) => mimo_results.push(r),
                Err(e) => mimo_results.push(AccountResult {
                    label: None,
                    result: Err(AgentSenseError::Http(format!(
                        "MiMo task panicked: {e}"
                    ))),
                }),
            }
        }

        let mut dsp_results = Vec::with_capacity(dsp_handles.len());
        for h in dsp_handles {
            match h.await {
                Ok(r) => dsp_results.push(r),
                Err(e) => dsp_results.push(AccountResult {
                    label: None,
                    result: Err(AgentSenseError::Http(format!(
                        "DeepSeek Platform task panicked: {e}"
                    ))),
                }),
            }
        }

        // Persist to DB — each account with its label
        for r in &mmx {
            if let Ok(ref snap) = r.result {
                let label = r.label.as_deref().unwrap_or("");
                let _ = self.db.insert_minimax(snap, label);
            }
        }
        for r in &ds {
            if let Ok(ref snap) = r.result {
                let label = r.label.as_deref().unwrap_or("");
                let _ = self.db.insert_deepseek(snap, label);
            }
        }
        for r in &zai_results {
            if let Ok(ref snap) = r.result {
                let label = r.label.as_deref().unwrap_or("");
                let _ = self.db.insert_zai(snap, label);
            }
        }
        if let Some(Ok(ref snap)) = claude {
            let _ = self.db.insert_claude(snap, "");
        }
        for r in &mimo_results {
            if let Ok(ref snap) = r.result {
                let label = r.label.as_deref().unwrap_or("");
                let _ = self.db.insert_mimo(snap, label);
            }
        }
        for r in &dsp_results {
            if let Ok(ref snap) = r.result {
                let label = r.label.as_deref().unwrap_or("");
                let _ = self.db.insert_deepseek_platform(snap, label);
            }
        }

        FetchResult {
            minimax: mmx,
            deepseek: ds,
            zai: zai_results,
            claude,
            mimo: mimo_results,
            deepseek_platform: dsp_results,
        }
    }

    pub fn db(&self) -> &QuotaDb {
        &self.db
    }
}

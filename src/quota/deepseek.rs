use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

#[derive(Debug, Clone, Serialize)]
pub struct DeepSeekSnapshot {
    pub timestamp: i64,
    pub total_balance_cny: f64,
    pub total_balance_usd: f64,
    pub granted_cny: f64,
    pub topped_up_cny: f64,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    #[allow(dead_code)]
    code: Option<i64>,
    #[allow(dead_code)]
    msg: Option<String>,
    balance_infos: Option<Vec<BalanceInfo>>,
}

#[derive(Debug, Deserialize)]
struct BalanceInfo {
    currency: String,
    total_balance: String,
    granted_balance: Option<String>,
    topped_up_balance: Option<String>,
}

pub async fn fetch(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<DeepSeekSnapshot, AgentSenseError> {
    let resp = client
        .get("https://api.deepseek.com/user/balance")
        .header("Authorization", format!("Bearer {api_key}"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AgentSenseError::Http(format!(
            "DeepSeek HTTP {}",
            resp.status()
        )));
    }

    let data: ApiResponse = resp.json().await?;

    if let Some(code) = data.code {
        if code != 0 && code != 200 {
            return Err(AgentSenseError::Http(format!(
                "DeepSeek API {code}: {}",
                data.msg.unwrap_or_default()
            )));
        }
    }

    let mut cny = 0.0;
    let mut usd = 0.0;
    let mut granted = 0.0;
    let mut topped_up = 0.0;

    for b in data.balance_infos.unwrap_or_default() {
        match b.currency.as_str() {
            "CNY" => {
                cny = b.total_balance.parse().unwrap_or(0.0);
                granted = b
                    .granted_balance
                    .as_ref()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0.0);
                topped_up = b
                    .topped_up_balance
                    .as_ref()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0.0);
            }
            "USD" => {
                usd = b.total_balance.parse().unwrap_or(0.0);
            }
            _ => {}
        }
    }

    let timestamp = chrono::Utc::now().timestamp_millis();

    Ok(DeepSeekSnapshot {
        timestamp,
        total_balance_cny: cny,
        total_balance_usd: usd,
        granted_cny: granted,
        topped_up_cny: topped_up,
    })
}

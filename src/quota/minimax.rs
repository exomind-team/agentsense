use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

#[derive(Debug, Clone, Serialize)]
pub struct MinimaxSnapshot {
    pub timestamp: i64,
    pub models: Vec<ModelQuota>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelQuota {
    pub name: String,
    pub interval_usage: i64,
    pub interval_total: i64,
    pub weekly_usage: i64,
    pub weekly_total: i64,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    base_resp: BaseResp,
    model_remains: Option<Vec<ModelRemain>>,
}

#[derive(Debug, Deserialize)]
struct BaseResp {
    status_code: i64,
    #[allow(dead_code)]
    status_msg: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct ModelRemain {
    model_name: String,
    current_interval_usage_count: i64,
    current_interval_total_count: i64,
    current_weekly_usage_count: i64,
    current_weekly_total_count: i64,
}

pub async fn fetch(client: &reqwest::Client, api_key: &str) -> Result<MinimaxSnapshot, AgentSenseError> {
    let resp = client
        .get("https://api.minimax.io/v1/token_plan/remains")
        .header("Authorization", format!("Bearer {api_key}"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AgentSenseError::Http(format!("MiniMax HTTP {}", resp.status())));
    }

    let data: ApiResponse = resp.json().await?;

    if data.base_resp.status_code != 0 {
        return Err(AgentSenseError::Http(format!(
            "MiniMax API {}: {}",
            data.base_resp.status_code,
            data.base_resp.status_msg.unwrap_or_default()
        )));
    }

    let remains = data.model_remains.unwrap_or_default();
    if remains.is_empty() {
        return Err(AgentSenseError::Http("MiniMax: no models in response".into()));
    }

    let timestamp = chrono::Utc::now().timestamp_millis();

    let models = remains
        .into_iter()
        .map(|m| ModelQuota {
            name: m.model_name,
            interval_usage: m.current_interval_usage_count,
            interval_total: m.current_interval_total_count,
            weekly_usage: m.current_weekly_usage_count,
            weekly_total: m.current_weekly_total_count,
        })
        .collect();

    Ok(MinimaxSnapshot { timestamp, models })
}

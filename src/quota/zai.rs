use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

#[derive(Debug, Clone, Serialize)]
pub struct ZaiSnapshot {
    pub timestamp: i64,
    pub token_5h_pct: i64,
    pub token_week_pct: i64,
    pub mcp_month_pct: i64,
    pub mcp_used: i64,
    pub mcp_total: i64,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    code: Option<i64>,
    msg: Option<String>,
    data: Option<ApiData>,
}

#[derive(Debug, Deserialize)]
struct ApiData {
    limits: Option<Vec<LimitItem>>,
}

#[derive(Debug, Deserialize)]
struct LimitItem {
    #[serde(rename = "type")]
    item_type: String,
    unit: Option<i64>,
    percentage: Option<i64>,
    current_value: Option<i64>,
    usage: Option<i64>,
}

pub async fn fetch(client: &reqwest::Client, auth_token: &str) -> Result<ZaiSnapshot, AgentSenseError> {
    let resp = client
        .get("https://api.z.ai/api/monitor/usage/quota/limit")
        .header("Authorization", format!("Bearer {auth_token}"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AgentSenseError::Http(format!("Z.AI HTTP {}", resp.status())));
    }

    let data: ApiResponse = resp.json().await?;

    // Z.AI returns HTTP 200 with business error codes
    if let Some(code) = data.code {
        if code != 0 && code != 200 {
            return Err(AgentSenseError::Http(format!(
                "Z.AI API {code}: {}",
                data.msg.unwrap_or_default()
            )));
        }
    }

    let limits = data
        .data
        .and_then(|d| d.limits)
        .ok_or_else(|| AgentSenseError::Http("Z.AI: no limits in response".into()))?;

    let mut token_5h = 0i64;
    let mut token_week = 0i64;
    let mut mcp_pct = 0i64;
    let mut mcp_used = 0i64;
    let mut mcp_total = 0i64;

    for item in limits {
        match item.item_type.as_str() {
            "TOKENS_LIMIT" => {
                let unit = item.unit.unwrap_or(0);
                let pct = item.percentage.unwrap_or(0);
                if unit == 3 {
                    token_5h = pct;
                } else if unit == 6 {
                    token_week = pct;
                }
            }
            "TIME_LIMIT" => {
                mcp_pct = item.percentage.unwrap_or(0);
                mcp_used = item.current_value.unwrap_or(0);
                mcp_total = item.usage.unwrap_or(0);
            }
            _ => {}
        }
    }

    let timestamp = chrono::Utc::now().timestamp_millis();

    Ok(ZaiSnapshot {
        timestamp,
        token_5h_pct: token_5h,
        token_week_pct: token_week,
        mcp_month_pct: mcp_pct,
        mcp_used,
        mcp_total,
    })
}

use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

#[derive(Debug, Clone, Serialize)]
pub struct ZaiSnapshot {
    pub timestamp: i64,
    pub token_5h_pct: i64,
    pub token_5h_reset: i64,
    pub token_week_pct: i64,
    pub token_week_reset: i64,
    pub mcp_month_pct: i64,
    pub mcp_used: i64,
    pub mcp_total: i64,
    pub mcp_remaining: i64,
    pub level: String,
    pub usage_details_json: String,
}

impl Default for ZaiSnapshot {
    fn default() -> Self {
        Self {
            timestamp: 0,
            token_5h_pct: 0,
            token_5h_reset: 0,
            token_week_pct: -1,
            token_week_reset: 0,
            mcp_month_pct: 0,
            mcp_used: 0,
            mcp_total: 0,
            mcp_remaining: 0,
            level: String::new(),
            usage_details_json: "[]".into(),
        }
    }
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
    level: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimitItem {
    #[serde(rename = "type")]
    item_type: String,
    unit: Option<i64>,
    percentage: Option<i64>,
    current_value: Option<i64>,
    usage: Option<i64>,
    remaining: Option<i64>,
    next_reset_time: Option<i64>,
    usage_details: Option<Vec<UsageDetail>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDetail {
    pub model_code: String,
    pub usage: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZaiModelUsage {
    pub models: Vec<ModelSummary>,
    pub total_tokens: i64,
    pub total_calls: i64,
    pub hours: Vec<String>,
    pub tokens_per_hour: Vec<i64>,
    pub calls_per_hour: Vec<i64>,
    pub model_per_hour: Vec<ModelHourData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelSummary {
    pub name: String,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelHourData {
    pub name: String,
    pub tokens_per_hour: Vec<i64>,
}

#[derive(Debug, Deserialize)]
struct ModelApiResponse {
    code: Option<i64>,
    data: Option<ModelApiData>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelApiData {
    #[serde(rename = "x_time")]
    x_time: Option<Vec<String>>,
    tokens_usage: Option<Vec<i64>>,
    model_call_count: Option<Vec<i64>>,
    total_usage: Option<TotalUsage>,
    model_data_list: Option<Vec<ModelDataItem>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TotalUsage {
    total_model_call_count: Option<i64>,
    total_tokens_usage: Option<i64>,
    model_summary_list: Option<Vec<ModelSummaryItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSummaryItem {
    model_name: String,
    total_tokens: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelDataItem {
    model_name: String,
    tokens_usage: Option<Vec<i64>>,
}

pub async fn fetch(
    client: &reqwest::Client,
    auth_token: &str,
) -> Result<ZaiSnapshot, AgentSenseError> {
    let resp = client
        .get("https://open.bigmodel.cn/api/monitor/usage/quota/limit")
        .header("Authorization", format!("Bearer {auth_token}"))
        .header("Accept-Language", "zh-CN,zh")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AgentSenseError::Http(format!(
            "GLM HTTP {}",
            resp.status()
        )));
    }

    let data: ApiResponse = resp.json().await?;

    if let Some(code) = data.code {
        if code != 0 && code != 200 {
            return Err(AgentSenseError::Http(format!(
                "GLM API {code}: {}",
                data.msg.unwrap_or_default()
            )));
        }
    }

    let api_data = data.data.ok_or_else(|| {
        AgentSenseError::Http("GLM: no data in response".into())
    })?;
    let limits = api_data.limits.unwrap_or_default();
    let level = api_data.level.unwrap_or_default();

    let mut snap = ZaiSnapshot::default();
    snap.timestamp = chrono::Utc::now().timestamp_millis();
    snap.level = level;

    for item in limits {
        match item.item_type.as_str() {
            "TOKENS_LIMIT" => {
                let unit = item.unit.unwrap_or(0);
                let pct = item.percentage.unwrap_or(0);
                let reset = item.next_reset_time.unwrap_or(0);
                if unit == 3 {
                    snap.token_5h_pct = pct;
                    snap.token_5h_reset = reset;
                } else if unit == 6 {
                    snap.token_week_pct = pct;
                    snap.token_week_reset = reset;
                }
            }
            "TIME_LIMIT" => {
                snap.mcp_month_pct = item.percentage.unwrap_or(0);
                snap.mcp_used = item.current_value.unwrap_or(0);
                snap.mcp_total = item.usage.unwrap_or(0);
                snap.mcp_remaining = item.remaining.unwrap_or(0);
                if let Some(details) = item.usage_details {
                    snap.usage_details_json =
                        serde_json::to_string(&details).unwrap_or_else(|_| "[]".into());
                }
            }
            _ => {}
        }
    }

    Ok(snap)
}

pub async fn fetch_model_usage(
    client: &reqwest::Client,
    auth_token: &str,
) -> Result<ZaiModelUsage, AgentSenseError> {
    let now = chrono::Local::now();
    let start = now.date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis()
        - 86_400_000;
    let end = now.timestamp_millis();

    let start_fmt = chrono::DateTime::from_timestamp_millis(start)
        .unwrap()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let end_fmt = now.format("%Y-%m-%d %H:%M:%S").to_string();

    let mut url = reqwest::Url::parse("https://open.bigmodel.cn/api/monitor/usage/model-usage")
        .map_err(|e| AgentSenseError::Http(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("startTime", &start_fmt)
        .append_pair("endTime", &end_fmt)
        .append_pair("granularity", "hourly");

    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {auth_token}"))
        .header("Accept-Language", "zh-CN,zh")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AgentSenseError::Http(format!(
            "GLM model-usage HTTP {}",
            resp.status()
        )));
    }

    let data: ModelApiResponse = resp.json().await?;
    let d = data.data.unwrap_or_default();
    let total = d.total_usage.unwrap_or_default();

    let models: Vec<ModelSummary> = total
        .model_summary_list
        .unwrap_or_default()
        .into_iter()
        .map(|m| ModelSummary {
            name: m.model_name,
            total_tokens: m.total_tokens,
        })
        .collect();

    let model_per_hour: Vec<ModelHourData> = d
        .model_data_list
        .unwrap_or_default()
        .into_iter()
        .map(|m| ModelHourData {
            name: m.model_name,
            tokens_per_hour: m.tokens_usage.unwrap_or_default(),
        })
        .collect();

    Ok(ZaiModelUsage {
        total_tokens: total.total_tokens_usage.unwrap_or(0),
        total_calls: total.total_model_call_count.unwrap_or(0),
        hours: d.x_time.unwrap_or_default(),
        tokens_per_hour: d.tokens_usage.unwrap_or_default(),
        calls_per_hour: d.model_call_count.unwrap_or_default(),
        models,
        model_per_hour,
    })
}

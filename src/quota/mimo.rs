use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

#[derive(Debug, Clone, Serialize)]
pub struct MimoSnapshot {
    pub timestamp: i64,
    pub plan_code: String,
    pub plan_name: String,
    pub period_end: String,
    pub expired: bool,
    pub month_used: i64,
    pub month_limit: i64,
    pub month_percent: f64,
}

#[derive(Debug, Deserialize)]
struct UsageResponse {
    code: Option<i64>,
    data: Option<UsageData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageData {
    month_usage: Option<MonthUsage>,
}

#[derive(Debug, Deserialize)]
struct MonthUsage {
    items: Option<Vec<UsageItem>>,
}

#[derive(Debug, Deserialize)]
struct UsageItem {
    used: i64,
    limit: i64,
    percent: f64,
}

#[derive(Debug, Deserialize)]
struct DetailResponse {
    code: Option<i64>,
    data: Option<DetailData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DetailData {
    plan_code: Option<String>,
    plan_name: Option<String>,
    current_period_end: Option<String>,
    expired: Option<bool>,
}

pub async fn fetch(
    client: &reqwest::Client,
    cookie: &str,
) -> Result<MimoSnapshot, AgentSenseError> {
    let usage_resp = client
        .get("https://platform.xiaomimimo.com/api/v1/tokenPlan/usage")
        .header("Cookie", cookie)
        .header("content-type", "application/json")
        .header("x-timezone", "Asia/Shanghai")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !usage_resp.status().is_success() {
        return Err(AgentSenseError::Http(format!(
            "MiMo usage HTTP {}",
            usage_resp.status()
        )));
    }

    let usage: UsageResponse = usage_resp.json().await?;
    if usage.code.unwrap_or(-1) != 0 {
        return Err(AgentSenseError::Http(format!(
            "MiMo usage API error: code {:?}",
            usage.code
        )));
    }

    let detail_resp = client
        .get("https://platform.xiaomimimo.com/api/v1/tokenPlan/detail")
        .header("Cookie", cookie)
        .header("content-type", "application/json")
        .header("x-timezone", "Asia/Shanghai")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !detail_resp.status().is_success() {
        return Err(AgentSenseError::Http(format!(
            "MiMo detail HTTP {}",
            detail_resp.status()
        )));
    }

    let detail: DetailResponse = detail_resp.json().await?;
    if detail.code.unwrap_or(-1) != 0 {
        return Err(AgentSenseError::Http(format!(
            "MiMo detail API error: code {:?}",
            detail.code
        )));
    }

    let usage_data = usage.data.ok_or_else(|| {
        AgentSenseError::Http("MiMo usage: empty data".into())
    })?;
    let month = usage_data.month_usage.ok_or_else(|| {
        AgentSenseError::Http("MiMo usage: no month_usage".into())
    })?;
    let item = month
        .items
        .and_then(|items| items.into_iter().next())
        .ok_or_else(|| {
            AgentSenseError::Http("MiMo usage: no items".into())
        })?;

    let detail_data = detail.data.unwrap_or(DetailData {
        plan_code: Some("unknown".into()),
        plan_name: Some("Unknown".into()),
        current_period_end: Some(String::new()),
        expired: Some(false),
    });

    let timestamp = chrono::Utc::now().timestamp_millis();

    Ok(MimoSnapshot {
        timestamp,
        plan_code: detail_data.plan_code.unwrap_or_default(),
        plan_name: detail_data.plan_name.unwrap_or_default(),
        period_end: detail_data.current_period_end.unwrap_or_default(),
        expired: detail_data.expired.unwrap_or(false),
        month_used: item.used,
        month_limit: item.limit,
        month_percent: item.percent,
    })
}

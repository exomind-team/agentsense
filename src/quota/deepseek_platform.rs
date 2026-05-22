use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

/// Daily usage snapshot from platform.deepseek.com
#[derive(Debug, Clone, Serialize)]
pub struct DeepSeekPlatformSnapshot {
    pub timestamp: i64,
    pub days: Vec<DayUsage>,
}

/// Single day usage for one model
#[derive(Debug, Clone, Serialize)]
pub struct DayUsage {
    pub date: String,
    pub model: String,
    pub cost_cache_hit: f64,
    pub cost_cache_miss: f64,
    pub cost_response: f64,
    pub cost_total: f64,
    pub tokens_cache_hit: i64,
    pub tokens_cache_miss: i64,
    pub tokens_response: i64,
    pub requests: i64,
}

// ── API response types ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CostResponse {
    code: i64,
    data: Option<CostData>,
}

#[derive(Debug, Deserialize)]
struct CostData {
    biz_data: Option<Vec<CostBizEntry>>,
}

#[derive(Debug, Deserialize)]
struct CostBizEntry {
    #[allow(dead_code)]
    total: Option<Vec<ModelCost>>,
    days: Option<Vec<DayCostEntry>>,
    #[allow(dead_code)]
    currency: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelCost {
    model: String,
    usage: Vec<UsageEntry>,
}

#[derive(Debug, Deserialize)]
struct DayCostEntry {
    date: String,
    data: Vec<ModelCost>,
}

#[derive(Debug, Deserialize)]
struct UsageEntry {
    #[serde(rename = "type")]
    entry_type: String,
    amount: String,
}

#[derive(Debug, Deserialize)]
struct AmountResponse {
    #[allow(dead_code)]
    code: i64,
    data: Option<AmountData>,
}

#[derive(Debug, Deserialize)]
struct AmountData {
    biz_data: Option<AmountBizEntry>,
}

#[derive(Debug, Deserialize)]
struct AmountBizEntry {
    days: Option<Vec<DayAmountEntry>>,
}

#[derive(Debug, Deserialize)]
struct DayAmountEntry {
    date: String,
    data: Vec<ModelAmount>,
}

#[derive(Debug, Deserialize)]
struct ModelAmount {
    model: String,
    usage: Vec<UsageEntry>,
}

// ── Public API ──────────────────────────────────────────────────────

pub async fn fetch(
    client: &reqwest::Client,
    bearer_token: &str,
    cookies: &str,
) -> Result<DeepSeekPlatformSnapshot, AgentSenseError> {
    let now = chrono::Utc::now();
    let month = now.format("%m").to_string();
    let year = now.format("%Y").to_string();

    // Fetch cost data (has daily breakdown with amounts in CNY)
    let cost_url = format!(
        "https://platform.deepseek.com/api/v0/usage/cost?month={}&year={}",
        month, year
    );
    let cost_resp = client
        .get(&cost_url)
        .header("accept", "application/json")
        .header("authorization", format!("Bearer {}", bearer_token))
        .header("cookie", cookies)
        .header("referer", "https://platform.deepseek.com/usage")
        .header("x-app-version", "1.0.0")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !cost_resp.status().is_success() {
        return Err(AgentSenseError::Http(format!(
            "DeepSeek Platform HTTP {}",
            cost_resp.status()
        )));
    }

    let cost_data: CostResponse = cost_resp.json().await?;
    if cost_data.code != 0 {
        return Err(AgentSenseError::Http(format!(
            "DeepSeek Platform API error: code={}",
            cost_data.code
        )));
    }

    // Fetch amount data (has daily breakdown with token counts)
    let amount_url = format!(
        "https://platform.deepseek.com/api/v0/usage/amount?month={}&year={}",
        month, year
    );
    let amount_resp = client
        .get(&amount_url)
        .header("accept", "application/json")
        .header("authorization", format!("Bearer {}", bearer_token))
        .header("cookie", cookies)
        .header("referer", "https://platform.deepseek.com/usage")
        .header("x-app-version", "1.0.0")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    let amount_data: AmountResponse = amount_resp.json().await?;

    // Build token lookup: (date, model) -> token counts
    let mut token_map: std::collections::HashMap<(String, String), (i64, i64, i64, i64)> =
        std::collections::HashMap::new();

    if let Some(amt_data) = amount_data.data {
        if let Some(biz) = amt_data.biz_data {
            for day in biz.days.unwrap_or_default() {
                for model in day.data {
                    let key = (day.date.clone(), model.model.clone());
                    let mut cache_hit = 0i64;
                    let mut cache_miss = 0i64;
                    let mut response = 0i64;
                    let mut requests = 0i64;
                    for entry in &model.usage {
                        let val: i64 = entry.amount.parse().unwrap_or(0);
                        match entry.entry_type.as_str() {
                            "PROMPT_CACHE_HIT_TOKEN" => cache_hit = val,
                            "PROMPT_CACHE_MISS_TOKEN" => cache_miss = val,
                            "RESPONSE_TOKEN" => response = val,
                            "REQUEST" => requests = val,
                            _ => {}
                        }
                    }
                    token_map.insert(key, (cache_hit, cache_miss, response, requests));
                }
            }
        }
    }

    // Parse cost data and merge with token counts
    let mut days = Vec::new();

    if let Some(cost) = cost_data.data {
        if let Some(biz) = cost.biz_data {
            for entry in biz {
                for day in entry.days.unwrap_or_default() {
                    for model in day.data {
                        let mut cost_cache_hit = 0.0f64;
                        let mut cost_cache_miss = 0.0f64;
                        let mut cost_response = 0.0f64;

                        for usage in &model.usage {
                            let val: f64 = usage.amount.parse().unwrap_or(0.0);
                            match usage.entry_type.as_str() {
                                "PROMPT_CACHE_HIT_TOKEN" => cost_cache_hit = val,
                                "PROMPT_CACHE_MISS_TOKEN" => cost_cache_miss = val,
                                "RESPONSE_TOKEN" => cost_response = val,
                                _ => {}
                            }
                        }

                        let cost_total = cost_cache_hit + cost_cache_miss + cost_response;

                        // Skip zero-cost entries
                        if cost_total < 0.001 {
                            continue;
                        }

                        let key = (day.date.clone(), model.model.clone());
                        let (tokens_cache_hit, tokens_cache_miss, tokens_response, requests) =
                            token_map.get(&key).copied().unwrap_or((0, 0, 0, 0));

                        days.push(DayUsage {
                            date: day.date.clone(),
                            model: model.model.clone(),
                            cost_cache_hit,
                            cost_cache_miss,
                            cost_response,
                            cost_total,
                            tokens_cache_hit,
                            tokens_cache_miss,
                            tokens_response,
                            requests,
                        });
                    }
                }
            }
        }
    }

    // Sort by date descending
    days.sort_by(|a, b| b.date.cmp(&a.date));

    Ok(DeepSeekPlatformSnapshot {
        timestamp: now.timestamp_millis(),
        days,
    })
}

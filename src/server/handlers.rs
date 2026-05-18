use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::Html;
use serde::Deserialize;

use super::AppState;

static INDEX_HTML: &str = include_str!("../../web/index.html");

pub async fn serve_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

pub async fn api_all(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;

    let (mmx_ts, mmx_models) = db.latest_minimax_with_ts().unwrap_or((0, vec![]));
    let mmx_status = provider_status(
        state.minimax_key.read().await.is_some(),
        if mmx_ts > 0 { Some(mmx_ts) } else { None },
    );

    let ds_balance = db.latest_deepseek().unwrap_or_default();
    let ds_status = provider_status(
        state.deepseek_key.read().await.is_some(),
        ds_balance.as_ref().map(|s| s.timestamp),
    );

    let zai_quota = db.latest_zai().unwrap_or_default();
    let zai_status = provider_status(
        state.zai_token.read().await.is_some(),
        zai_quota.as_ref().map(|s| s.timestamp),
    );

    drop(db);

    let mut mmx_models_json = Vec::new();
    for m in &mmx_models {
        mmx_models_json.push(serde_json::json!({
            "model_name": m.name,
            "current_interval_usage_count": m.interval_usage,
            "current_interval_total_count": m.interval_total,
            "current_weekly_usage_count": m.weekly_usage,
            "current_weekly_total_count": m.weekly_total,
        }));
    }

    axum::Json(serde_json::json!({
        "minimax": { "models": mmx_models_json, "status": mmx_status },
        "deepseek": { "balance": ds_balance, "status": ds_status },
        "zai": { "quota": zai_quota, "status": zai_status },
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

pub async fn api_quota(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let (_, models) = db.latest_minimax_with_ts().unwrap_or((0, vec![]));
    drop(db);

    let mut remains = Vec::new();
    for m in &models {
        remains.push(serde_json::json!({
            "model_name": m.name,
            "current_interval_usage_count": m.interval_usage,
            "current_interval_total_count": m.interval_total,
            "current_weekly_usage_count": m.weekly_usage,
            "current_weekly_total_count": m.weekly_total,
        }));
    }

    axum::Json(serde_json::json!({
        "model_remains": remains,
        "base_resp": { "status_code": 0 },
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

#[derive(Deserialize)]
pub struct ModelQuery {
    pub model: Option<String>,
}

pub async fn api_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ModelQuery>,
) -> axum::Json<serde_json::Value> {
    let model = q.model.as_deref().unwrap_or("MiniMax-M*");
    let db = state.db.lock().await;
    let history = db.minimax_history_24h(model).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_weekly_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ModelQuery>,
) -> axum::Json<serde_json::Value> {
    let model = q.model.as_deref().unwrap_or("MiniMax-M*");
    let db = state.db.lock().await;
    let history = db.weekly_history(model);
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_consumption(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let summary = db.consumption_summary();
    drop(db);
    axum::Json(summary)
}

pub async fn api_deepseek(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let balance = db.latest_deepseek().unwrap_or_default();
    drop(db);

    let status = provider_status(
        state.deepseek_key.read().await.is_some(),
        balance.as_ref().map(|s| s.timestamp),
    );

    axum::Json(serde_json::json!({
        "balance": balance,
        "status": status,
    }))
}

#[derive(Deserialize)]
pub struct HoursQuery {
    pub hours: Option<u64>,
}

pub async fn api_deepseek_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.deepseek_history(hours).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_zai(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let quota = db.latest_zai().unwrap_or_default();
    drop(db);

    let status = provider_status(
        state.zai_token.read().await.is_some(),
        quota.as_ref().map(|s| s.timestamp),
    );

    axum::Json(serde_json::json!({
        "quota": quota,
        "status": status,
    }))
}

pub async fn api_zai_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.zai_history(hours).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_config_get(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    let mask = |key: &Option<String>| -> String {
        match key {
            Some(k) if k.len() > 4 => format!("\u{2022}\u{2022}\u{2022}\u{2022}{}", &k[k.len() - 4..]),
            Some(k) => k.clone(),
            None => String::new(),
        }
    };

    let mmx = state.minimax_key.read().await;
    let ds = state.deepseek_key.read().await;
    let zai = state.zai_token.read().await;

    axum::Json(serde_json::json!({
        "minimax_api_key": mask(&mmx),
        "deepseek_api_key": mask(&ds),
        "zai_auth_token": mask(&zai),
        "minimax_configured": mmx.is_some(),
        "deepseek_configured": ds.is_some(),
        "zai_configured": zai.is_some(),
    }))
}

#[derive(Deserialize)]
pub struct ConfigBody {
    pub minimax_api_key: Option<String>,
    pub deepseek_api_key: Option<String>,
    pub zai_auth_token: Option<String>,
}

pub async fn api_config_put(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<ConfigBody>,
) -> axum::Json<serde_json::Value> {
    let masked_prefix = "\u{2022}\u{2022}\u{2022}\u{2022}";

    if let Some(ref key) = body.minimax_api_key {
        if !key.starts_with(masked_prefix) && !key.is_empty() {
            *state.minimax_key.write().await = Some(key.clone());
        }
    }
    if let Some(ref key) = body.deepseek_api_key {
        if !key.starts_with(masked_prefix) && !key.is_empty() {
            *state.deepseek_key.write().await = Some(key.clone());
        }
    }
    if let Some(ref token) = body.zai_auth_token {
        if !token.starts_with(masked_prefix) && !token.is_empty() {
            *state.zai_token.write().await = Some(token.clone());
        }
    }

    let mmx = state.minimax_key.read().await;
    let ds = state.deepseek_key.read().await;
    let zai = state.zai_token.read().await;

    let config = crate::config::AppConfig {
        quota: crate::config::QuotaConfig {
            minimax: Some(crate::config::KeyConfig {
                api_key: mmx.clone(),
                api_key_env: None,
            }),
            deepseek: Some(crate::config::KeyConfig {
                api_key: ds.clone(),
                api_key_env: None,
            }),
            zai: Some(crate::config::ZaiKeyConfig {
                auth_token: zai.clone(),
                auth_token_env: None,
            }),
            ..Default::default()
        },
    };

    let toml_str = toml::to_string_pretty(&config).unwrap_or_default();
    let _ = std::fs::write(&state.config_path, toml_str);

    axum::Json(serde_json::json!({"ok": true}))
}

pub async fn api_refresh(
    State(state): State<Arc<AppState>>,
) -> axum::Json<serde_json::Value> {
    super::do_poll(state.clone()).await;
    axum::Json(serde_json::json!({
        "ok": true,
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

fn provider_status(
    configured: bool,
    last_ts: Option<i64>,
) -> serde_json::Value {
    if !configured {
        return serde_json::json!({"status": "no_key"});
    }
    match last_ts {
        Some(ts) => serde_json::json!({"status": "ok", "lastTs": ts}),
        None => serde_json::json!({"status": "waiting"}),
    }
}

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::{Html, Response};
use serde::Deserialize;

use super::AppState;

#[cfg(feature = "psu")]
pub mod psu;

static INDEX_HTML: &str = include_str!("../../../web/index.html");
static APP_JS: &str = include_str!("../../../web/app.js");
static STYLE_CSS: &str = include_str!("../../../web/style.css");

fn web_response(embedded: &'static str, content_type: &str) -> Response {
    // Try disk first (dev mode: edit web/*.js/css, refresh browser = instant)
    if let Ok(data) = std::fs::read_to_string("web/index.html").or_else(|_| std::fs::read_to_string("style.css")) {
        // If web/ dir exists, read from disk
        let _ = data; // just checking dir exists
    }
    let body = match content_type {
        "text/html" => std::fs::read_to_string("web/index.html").unwrap_or_else(|_| embedded.to_string()),
        "text/javascript" => std::fs::read_to_string("web/app.js").unwrap_or_else(|_| embedded.to_string()),
        "text/css" => std::fs::read_to_string("web/style.css").unwrap_or_else(|_| embedded.to_string()),
        _ => embedded.to_string(),
    };
    Response::builder()
        .header("content-type", content_type)
        .body(body.into())
        .unwrap()
}

pub async fn serve_index() -> Html<String> {
    let html = std::fs::read_to_string("web/index.html").unwrap_or_else(|_| INDEX_HTML.to_string());
    Html(html)
}

pub async fn serve_app_js() -> Response {
    web_response(APP_JS, "text/javascript")
}

pub async fn serve_style_css() -> Response {
    web_response(STYLE_CSS, "text/css")
}

pub async fn api_all(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;

    // --- MiniMax: per-account array ---
    let mmx_keys = state.minimax_keys.read().await;
    let mut minimax_accounts = Vec::new();
    let now_ms = chrono::Utc::now().timestamp_millis();
    for (_key, label, _base_url) in mmx_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let (mmx_ts, mmx_models) = db.latest_minimax_with_ts(label_str).unwrap_or((0, vec![]));
        let mmx_status = provider_status(true, if mmx_ts > 0 { Some(mmx_ts) } else { None });

        let mut mmx_models_json = Vec::new();
        for m in &mmx_models {
            let interval_remains = m
                .interval_end
                .map(|t| (t - now_ms).max(0))
                .filter(|t| *t > 0)
                .unwrap_or_else(|| db.interval_reset_info(&m.name).map(|(_, r)| r).unwrap_or(0));
            let weekly_remains = m
                .weekly_end
                .map(|t| (t - now_ms).max(0))
                .filter(|t| *t > 0)
                .unwrap_or_else(|| {
                    db.weekly_model_reset_info(&m.name)
                        .map(|(_, r)| r)
                        .unwrap_or(0)
                });
            mmx_models_json.push(serde_json::json!({
                "model_name": m.name,
                "current_interval_usage_count": m.interval_usage,
                "current_interval_total_count": m.interval_total,
                "current_weekly_usage_count": m.weekly_usage,
                "current_weekly_total_count": m.weekly_total,
                "remains_time": interval_remains,
                "weekly_remains_time": weekly_remains,
            }));
        }
        minimax_accounts.push(serde_json::json!({
            "label": label,
            "models": mmx_models_json,
            "status": mmx_status,
        }));
    }

    // --- DeepSeek: per-account array ---
    let ds_keys = state.deepseek_keys.read().await;
    let mut deepseek_accounts = Vec::new();
    for (_key, label) in ds_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let ds_balance = db.latest_deepseek(label_str).unwrap_or_default();
        let ds_status = provider_status(
            true,
            ds_balance.as_ref().map(|s| s.timestamp),
        );
        deepseek_accounts.push(serde_json::json!({
            "label": label,
            "balance": ds_balance,
            "status": ds_status,
        }));
    }

    // --- Z.AI: per-account array ---
    let zai_keys = state.zai_tokens.read().await;
    let mut zai_accounts = Vec::new();
    for (_key, label) in zai_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let zai_quota = db.latest_zai(label_str).unwrap_or_default();
        let zai_status = provider_status(
            true,
            zai_quota.as_ref().map(|s| s.timestamp),
        );
        zai_accounts.push(serde_json::json!({
            "label": label,
            "quota": zai_quota,
            "status": zai_status,
        }));
    }

    // --- MiMo: per-account array ---
    let mimo_keys = state.mimo_cookies.read().await;
    let mut mimo_accounts = Vec::new();
    for (_key, label) in mimo_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let mimo_quota = db.latest_mimo(label_str).unwrap_or_default();
        let mimo_status = provider_status(
            true,
            mimo_quota.as_ref().map(|s| s.timestamp),
        );
        mimo_accounts.push(serde_json::json!({
            "label": label,
            "quota": mimo_quota,
            "status": mimo_status,
        }));
    }

    // --- Claude: single instance (not an array) ---
    let claude_quota = db.latest_claude("").unwrap_or_default();
    let claude_status = provider_status(
        state.claude_creds.read().await.is_some(),
        claude_quota.as_ref().map(|s| s.timestamp),
    );

    // --- DeepSeek Platform: aggregate today data + configured accounts ---
    let dsp_creds = state.deepseek_platform_creds.read().await;
    let dsp_today = db.deepseek_platform_today().unwrap_or_default();
    let dsp_configured = !dsp_creds.is_empty();
    let dsp_labels: Vec<Option<String>> = dsp_creds.iter().map(|(_, label)| label.clone()).collect();

    axum::Json(serde_json::json!({
        "minimax": minimax_accounts,
        "deepseek": deepseek_accounts,
        "deepseek_platform": { "today": dsp_today, "configured": dsp_configured, "labels": dsp_labels },
        "zai": zai_accounts,
        "claude": { "quota": claude_quota, "status": claude_status },
        "mimo": mimo_accounts,
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

pub async fn api_quota(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;

    // Aggregate models across all MiniMax accounts
    let mmx_keys = state.minimax_keys.read().await;
    let mut remains = Vec::new();
    let now_ms = chrono::Utc::now().timestamp_millis();
    for (_key, label, _base_url) in mmx_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let (_, models) = db.latest_minimax_with_ts(label_str).unwrap_or((0, vec![]));
        for m in &models {
            let interval_remains = m
                .interval_end
                .map(|t| (t - now_ms).max(0))
                .filter(|t| *t > 0)
                .unwrap_or_else(|| db.interval_reset_info(&m.name).map(|(_, r)| r).unwrap_or(0));
            let weekly_remains = m
                .weekly_end
                .map(|t| (t - now_ms).max(0))
                .filter(|t| *t > 0)
                .unwrap_or_else(|| {
                    db.weekly_model_reset_info(&m.name)
                        .map(|(_, r)| r)
                        .unwrap_or(0)
                });
            remains.push(serde_json::json!({
                "model_name": m.name,
                "account_label": label,
                "current_interval_usage_count": m.interval_usage,
                "current_interval_total_count": m.interval_total,
                "current_weekly_usage_count": m.weekly_usage,
                "current_weekly_total_count": m.weekly_total,
                "remains_time": interval_remains,
                "weekly_remains_time": weekly_remains,
            }));
        }
    }
    drop(db);

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
    let history = db.minimax_history_24h(model, "").unwrap_or_default();
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

pub async fn api_consumption(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let summary = db.consumption_summary();
    drop(db);
    axum::Json(summary)
}

pub async fn api_deepseek(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let ds_keys = state.deepseek_keys.read().await;

    let mut accounts = Vec::new();
    for (_key, label) in ds_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let balance = db.latest_deepseek(label_str).unwrap_or_default();
        let status = provider_status(
            true,
            balance.as_ref().map(|s| s.timestamp),
        );
        accounts.push(serde_json::json!({
            "label": label,
            "balance": balance,
            "status": status,
        }));
    }
    drop(db);

    axum::Json(serde_json::json!({
        "accounts": accounts,
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
    let history = db.deepseek_history(hours, "").unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

#[derive(Deserialize)]
pub struct DaysQuery {
    pub days: Option<u32>,
}

pub async fn api_deepseek_platform_usage(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DaysQuery>,
) -> axum::Json<serde_json::Value> {
    let days = q.days.unwrap_or(30);
    let db = state.db.lock().await;
    let usage = db.deepseek_platform_summary(days).unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!({
        "usage": usage,
        "configured": !state.deepseek_platform_creds.read().await.is_empty(),
    }))
}

pub async fn api_zai(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let zai_keys = state.zai_tokens.read().await;

    let mut accounts = Vec::new();
    for (_key, label) in zai_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let quota = db.latest_zai(label_str).unwrap_or_default();
        let status = provider_status(
            true,
            quota.as_ref().map(|s| s.timestamp),
        );
        accounts.push(serde_json::json!({
            "label": label,
            "quota": quota,
            "status": status,
        }));
    }
    drop(db);

    axum::Json(serde_json::json!({
        "accounts": accounts,
    }))
}

pub async fn api_zai_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.zai_history(hours, "").unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_zai_models(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let tokens = state.zai_tokens.read().await;
    let Some((token, _label)) = tokens.first().cloned() else {
        return axum::Json(serde_json::json!({"error": "no_token"}));
    };

    match crate::quota::zai::fetch_model_usage(&state.client, &token).await {
        Ok(data) => axum::Json(serde_json::json!(data)),
        Err(e) => axum::Json(serde_json::json!({"error": e.to_string()})),
    }
}

pub async fn api_claude(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let quota = db.latest_claude("").unwrap_or_default();
    drop(db);

    let status = provider_status(
        state.claude_creds.read().await.is_some(),
        quota.as_ref().map(|s| s.timestamp),
    );

    axum::Json(serde_json::json!({
        "quota": quota,
        "status": status,
    }))
}

pub async fn api_claude_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.claude_history(hours, "").unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_mimo(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;
    let mimo_keys = state.mimo_cookies.read().await;

    let mut accounts = Vec::new();
    for (_key, label) in mimo_keys.iter() {
        let label_str = label.as_deref().unwrap_or("");
        let quota = db.latest_mimo(label_str).unwrap_or_default();
        let status = provider_status(
            true,
            quota.as_ref().map(|s| s.timestamp),
        );
        accounts.push(serde_json::json!({
            "label": label,
            "quota": quota,
            "status": status,
        }));
    }
    drop(db);

    axum::Json(serde_json::json!({
        "accounts": accounts,
    }))
}

pub async fn api_mimo_history(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HoursQuery>,
) -> axum::Json<serde_json::Value> {
    let hours = q.hours.unwrap_or(24);
    let db = state.db.lock().await;
    let history = db.mimo_history(hours, "").unwrap_or_default();
    drop(db);
    axum::Json(serde_json::json!(history))
}

pub async fn api_config_get(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let mask = |key: &str| -> String {
        if key.len() > 4 {
            format!("\u{2022}\u{2022}\u{2022}\u{2022}{}", &key[key.len() - 4..])
        } else {
            key.to_string()
        }
    };

    let mmx = state.minimax_keys.read().await;
    let ds = state.deepseek_keys.read().await;
    let zai = state.zai_tokens.read().await;
    let mimo = state.mimo_cookies.read().await;
    let claude = state.claude_creds.read().await;
    let dsp = state.deepseek_platform_creds.read().await;

    // Return arrays of masked keys per provider for multi-account visibility
    let mmx_masked: Vec<serde_json::Value> = mmx
        .iter()
        .map(|(k, label, _base_url)| {
            serde_json::json!({
                "masked_key": mask(k),
                "label": label,
            })
        })
        .collect();
    let ds_masked: Vec<serde_json::Value> = ds
        .iter()
        .map(|(k, label)| {
            serde_json::json!({
                "masked_key": mask(k),
                "label": label,
            })
        })
        .collect();
    let zai_masked: Vec<serde_json::Value> = zai
        .iter()
        .map(|(k, label)| {
            serde_json::json!({
                "masked_key": mask(k),
                "label": label,
            })
        })
        .collect();
    let mimo_masked: Vec<serde_json::Value> = mimo
        .iter()
        .map(|(k, label)| {
            serde_json::json!({
                "masked_key": mask(k),
                "label": label,
            })
        })
        .collect();
    let dsp_masked: Vec<serde_json::Value> = dsp
        .iter()
        .map(|((t, c), label)| {
            serde_json::json!({
                "masked_token": mask(t),
                "masked_cookies": mask(c),
                "label": label,
            })
        })
        .collect();

    axum::Json(serde_json::json!({
        "minimax_accounts": mmx_masked,
        "deepseek_accounts": ds_masked,
        "zai_accounts": zai_masked,
        "mimo_accounts": mimo_masked,
        "deepseek_platform_accounts": dsp_masked,
        "minimax_configured": !mmx.is_empty(),
        "deepseek_configured": !ds.is_empty(),
        "zai_configured": !zai.is_empty(),
        "mimo_configured": !mimo.is_empty(),
        "deepseek_platform_configured": !dsp.is_empty(),
        "claude_configured": claude.is_some(),
        "claude_creds_path": claude.as_ref().map(|p| p.display().to_string()),
    }))
}

#[derive(Deserialize)]
pub struct ConfigBody {
    pub minimax_api_key: Option<String>,
    pub deepseek_api_key: Option<String>,
    pub zai_auth_token: Option<String>,
    pub mimo_cookie: Option<String>,
    pub deepseek_platform_token: Option<String>,
    pub deepseek_platform_cookies: Option<String>,
}

pub async fn api_config_put(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<ConfigBody>,
) -> axum::Json<serde_json::Value> {
    let masked_prefix = "\u{2022}\u{2022}\u{2022}\u{2022}";

    // For backward compat: accept single key and store as single-element Vec
    if let Some(ref key) = body.minimax_api_key {
        if !key.starts_with(masked_prefix) && !key.is_empty() {
            *state.minimax_keys.write().await = vec![(key.clone(), None, None)];
        }
    }
    if let Some(ref key) = body.deepseek_api_key {
        if !key.starts_with(masked_prefix) && !key.is_empty() {
            *state.deepseek_keys.write().await = vec![(key.clone(), None)];
        }
    }
    if let Some(ref token) = body.zai_auth_token {
        if !token.starts_with(masked_prefix) && !token.is_empty() {
            *state.zai_tokens.write().await = vec![(token.clone(), None)];
        }
    }
    if let Some(ref cookie) = body.mimo_cookie {
        if !cookie.starts_with(masked_prefix) && !cookie.is_empty() {
            *state.mimo_cookies.write().await = vec![(cookie.clone(), None)];
        }
    }
    if let Some(ref token) = body.deepseek_platform_token {
        if !token.starts_with(masked_prefix) && !token.is_empty() {
            let cookies_val = body
                .deepseek_platform_cookies
                .as_deref()
                .unwrap_or("")
                .to_string();
            *state.deepseek_platform_creds.write().await =
                vec![((token.clone(), cookies_val), None)];
        }
    }

    let mmx = state.minimax_keys.read().await;
    let ds = state.deepseek_keys.read().await;
    let zai = state.zai_tokens.read().await;
    let mimo = state.mimo_cookies.read().await;
    let dsp = state.deepseek_platform_creds.read().await;

    let mut config = crate::AppConfig::load(&state.config_path).unwrap_or_default();

    config.quota.minimax = mmx
        .iter()
        .map(|(k, label, base_url)| crate::config::KeyConfig {
            api_key: Some(k.clone()),
            api_key_env: None,
            label: label.clone(),
            base_url: base_url.clone(),
        })
        .collect();
    config.quota.deepseek = ds
        .iter()
        .map(|(k, label)| crate::config::KeyConfig {
            api_key: Some(k.clone()),
            api_key_env: None,
            label: label.clone(),
            base_url: None,
        })
        .collect();
    config.quota.zai = zai
        .iter()
        .map(|(k, label)| crate::config::ZaiKeyConfig {
            auth_token: Some(k.clone()),
            auth_token_env: None,
            label: label.clone(),
        })
        .collect();
    config.quota.mimo = mimo
        .iter()
        .map(|(k, label)| crate::config::MimoConfig {
            cookie: Some(k.clone()),
            label: label.clone(),
        })
        .collect();
    config.quota.deepseek_platform = dsp
        .iter()
        .map(|((t, c), label)| crate::config::DeepSeekPlatformConfig {
            bearer_token: Some(t.clone()),
            bearer_token_env: None,
            cookies: Some(c.clone()),
            cookies_env: None,
            label: label.clone(),
        })
        .collect();

    let toml_str = toml::to_string_pretty(&config).unwrap_or_default();
    let _ = std::fs::write(&state.config_path, toml_str);

    axum::Json(serde_json::json!({"ok": true}))
}

pub async fn api_refresh(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    super::do_poll(state.clone()).await;
    axum::Json(serde_json::json!({
        "ok": true,
        "_nextPoll": state.next_poll.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

fn provider_status(configured: bool, last_ts: Option<i64>) -> serde_json::Value {
    if !configured {
        return serde_json::json!({"status": "no_key"});
    }
    match last_ts {
        Some(ts) => serde_json::json!({"status": "ok", "lastTs": ts}),
        None => serde_json::json!({"status": "waiting"}),
    }
}
pub async fn mcp_handler(
    axum::Json(req): axum::Json<serde_json::Value>,
) -> axum::Json<serde_json::Value> {
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let id = req.get("id").cloned();
    let result = match method {
        "initialize" => serde_json::json!({
            "jsonrpc":"2.0","id":id,
            "result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},
            "serverInfo":{"name":"AgentSense","version":env!("CARGO_PKG_VERSION")}}
        }),
        "notifications/initialized" => serde_json::json!({"jsonrpc":"2.0","id":id,"result":{}}),
        "tools/list" => tools_list_json(&id),
        "tools/call" => tools_call_dispatch(&id, req.get("params")).await,
        _ => {
            serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("Unknown: {method}")}})
        }
    };
    axum::Json(result)
}

// Dispatched via spawn_blocking to keep the handler future Send
async fn tools_call_dispatch(
    id: &Option<serde_json::Value>,
    params: Option<&serde_json::Value>,
) -> serde_json::Value {
    let id = id.clone();
    let params_val = params.cloned();
    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(tools_call_json(&id, params_val.as_ref()))
    })
    .await
    .unwrap_or_else(|e| err_resp(&None, &format!("Task panic: {e}")))
}

fn tools_list_json(id: &Option<serde_json::Value>) -> serde_json::Value {
    let tools: Vec<serde_json::Value> = vec![
        tool_def(
            "doc_open",
            "Open a PDF, return metadata and TOC",
            &[("path", "string", "PDF path")],
        ),
        tool_def(
            "doc_read",
            "Read PDF text. Optional pages array; omit for full text",
            &[
                ("path", "string", "PDF path"),
                ("pages", "array", "Optional page numbers"),
            ],
        ),
        tool_def(
            "doc_read_page",
            "Read single PDF page by number",
            &[
                ("path", "string", "PDF path"),
                ("page", "integer", "Page number (1-indexed)"),
            ],
        ),
        tool_def(
            "doc_toc",
            "Get PDF table of contents tree",
            &[("path", "string", "PDF path")],
        ),
        tool_def(
            "doc_section",
            "Read PDF section by TOC title",
            &[
                ("path", "string", "PDF path"),
                ("title", "string", "Section title"),
            ],
        ),
        tool_def(
            "doc_images",
            "List PDF images with dimensions",
            &[("path", "string", "PDF path")],
        ),
        tool_def(
            "doc_extract_image",
            "Extract PDF image as base64",
            &[
                ("path", "string", "PDF path"),
                ("page", "integer", "Page"),
                ("index", "integer", "Image index (0-based)"),
            ],
        ),
        tool_def(
            "epub_open",
            "Open EPUB, return metadata and TOC",
            &[("path", "string", "EPUB path")],
        ),
        tool_def(
            "epub_read_chapter",
            "Read EPUB chapter by number",
            &[
                ("path", "string", "EPUB path"),
                ("chapter", "integer", "Chapter number"),
            ],
        ),
        tool_def(
            "epub_toc",
            "Get EPUB table of contents",
            &[("path", "string", "EPUB path")],
        ),
        tool_def(
            "epub_read_section",
            "Read EPUB section by TOC title",
            &[
                ("path", "string", "EPUB path"),
                ("title", "string", "Section title"),
            ],
        ),
        tool_def(
            "quota_status",
            "Get AI quota for MiniMax/DeepSeek/Z.AI/Claude",
            &[],
        ),
    ];
    serde_json::json!({"jsonrpc":"2.0","id":id,"result":{"tools":tools}})
}

fn tool_def(name: &str, desc: &str, props: &[(&str, &str, &str)]) -> serde_json::Value {
    let mut p = serde_json::Map::new();
    let mut r = Vec::new();
    for (k, t, d) in props {
        p.insert(k.to_string(), serde_json::json!({"type":t,"description":d}));
        r.push(serde_json::Value::String(k.to_string()));
    }
    serde_json::json!({"name":name,"description":desc,"inputSchema":{"type":"object","properties":p,"required":r}})
}

async fn tools_call_json(
    id: &Option<serde_json::Value>,
    params: Option<&serde_json::Value>,
) -> serde_json::Value {
    let params = match params {
        Some(p) => p,
        None => return err_resp(id, "Missing params"),
    };
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let empty_args = serde_json::json!({});
    let args = params.get("arguments").unwrap_or(&empty_args);
    let text = match name {
        "doc_open" => tool_doc_open(args).await,
        "doc_read" => tool_doc_read(args).await,
        "doc_read_page" => tool_doc_read_page(args).await,
        "doc_toc" => tool_doc_toc(args).await,
        "doc_section" => tool_doc_section(args).await,
        "doc_images" => tool_doc_images(args).await,
        "doc_extract_image" => tool_doc_extract_image(args).await,
        "epub_open" => tool_epub_open(args).await,
        "epub_read_chapter" => tool_epub_read_chapter(args).await,
        "epub_toc" => tool_epub_toc(args).await,
        "epub_read_section" => tool_epub_read_section(args).await,
        "quota_status" => tool_quota_status().await,
        _ => return err_resp(id, &format!("Unknown tool: {name}")),
    };
    serde_json::json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":text}]}})
}

fn err_resp(id: &Option<serde_json::Value>, msg: &str) -> serde_json::Value {
    serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":msg}})
}

// -- Tool implementations --

fn get_str(args: &serde_json::Value, k: &str) -> Result<String, String> {
    args.get(k)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing: {k}"))
}
fn get_u64(args: &serde_json::Value, k: &str) -> Result<u64, String> {
    args.get(k)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("Missing: {k}"))
}
fn to_json(v: &serde_json::Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

async fn tool_doc_open(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d,
        Err(e) => return e.to_string(),
    };
    let info = doc.info();
    let outline = doc.outline().unwrap_or_default();
    to_json(&serde_json::json!({
        "path":path,"title":info.title(),"author":info.author(),
        "creator":info.creator(),"producer":info.producer(),
        "page_count":info.page_count(),"page_size_pt":[info.page_width_pt(),info.page_height_pt()],
        "toc": toc_to_json(&outline),
    }))
}

async fn tool_doc_read(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d,
        Err(e) => return e.to_string(),
    };
    if let Some(pages) = args.get("pages").and_then(|v| v.as_array()) {
        let mut out = String::new();
        for p in pages {
            if let Some(n) = p.as_u64() {
                match doc.read_page(n as usize) {
                    Ok(t) => out.push_str(&format!("\n--- Page {n} ---\n{t}")),
                    Err(e) => out.push_str(&format!("\n[P{n}: {e}]")),
                }
            }
        }
        out
    } else {
        doc.text().unwrap_or_else(|e| e.to_string())
    }
}

async fn tool_doc_read_page(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let page = match get_u64(args, "page") {
        Ok(p) => p as usize,
        Err(e) => return e,
    };
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d,
        Err(e) => return e.to_string(),
    };
    doc.read_page(page).unwrap_or_else(|e| e.to_string())
}

async fn tool_doc_toc(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => match d.outline() {
            Ok(o) => to_json(&serde_json::json!({"toc":toc_to_json(&o)})),
            Err(e) => e.to_string(),
        },
        Err(e) => e.to_string(),
    }
}

async fn tool_doc_section(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let title = match get_str(args, "title") {
        Ok(t) => t,
        Err(e) => return e,
    };
    let doc = match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d,
        Err(e) => return e.to_string(),
    };
    let outline = match doc.outline() {
        Ok(o) => o,
        Err(e) => return e.to_string(),
    };
    if let Some(entry) = find_toc(&outline, &title) {
        if let crate::TocLocation::Pdf { page } = entry.location {
            return doc.read_page(page).unwrap_or_else(|e| e.to_string());
        }
    }
    format!(
        "Section '{title}' not found. Available: {:?}",
        outline.iter().map(|e| &e.title).collect::<Vec<_>>()
    )
}

async fn tool_doc_images(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => match d.list_images() {
            Ok(imgs) => to_json(&serde_json::json!({
                "count":imgs.len(),
                "images":imgs.iter().map(|i|serde_json::json!({
                    "page":i.page,"index":i.index,"name":i.name,"width":i.width,"height":i.height
                })).collect::<Vec<_>>()
            })),
            Err(e) => e.to_string(),
        },
        Err(e) => e.to_string(),
    }
}

async fn tool_doc_extract_image(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let page = match get_u64(args, "page") {
        Ok(p) => p as usize,
        Err(e) => return e,
    };
    let index = match get_u64(args, "index") {
        Ok(i) => i as usize,
        Err(e) => return e,
    };
    match crate::PdfDocument::open(std::path::Path::new(&path)) {
        Ok(d) => match d.extract_image(page, index) {
            Ok(data) => {
                use base64::Engine;
                to_json(&serde_json::json!({
                    "page":page,"index":index,"size_bytes":data.len(),
                    "base64":base64::engine::general_purpose::STANDARD.encode(&data),
                    "format": if data.starts_with(&[0xff,0xd8]){"jpeg"}else{"unknown"},
                }))
            }
            Err(e) => e.to_string(),
        },
        Err(e) => e.to_string(),
    }
}

async fn tool_epub_open(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d) => to_json(&serde_json::json!({
            "path":path,"title":d.title(),"author":d.author(),
            "chapter_count":d.chapter_count(),"toc":toc_to_json(d.toc()),
        })),
        Err(e) => e.to_string(),
    }
}

async fn tool_epub_read_chapter(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let ch = match get_u64(args, "chapter") {
        Ok(c) => c as usize,
        Err(e) => return e,
    };
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d) => d.read_chapter(ch).unwrap_or_else(|e| e.to_string()),
        Err(e) => e.to_string(),
    }
}

async fn tool_epub_toc(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d) => to_json(&serde_json::json!({"toc":toc_to_json(d.toc())})),
        Err(e) => e.to_string(),
    }
}

async fn tool_epub_read_section(args: &serde_json::Value) -> String {
    let path = match get_str(args, "path") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let title = match get_str(args, "title") {
        Ok(t) => t,
        Err(e) => return e,
    };
    match crate::EpubDocument::open(std::path::Path::new(&path)) {
        Ok(d) => {
            if let Some(entry) = find_toc(d.toc(), &title) {
                d.read_toc_entry(entry).unwrap_or_else(|e| e.to_string())
            } else {
                format!("Section '{title}' not found")
            }
        }
        Err(e) => e.to_string(),
    }
}

async fn tool_quota_status() -> String {
    let db_path = std::path::Path::new("quota.db");
    let db = match crate::quota::db::QuotaDb::open(db_path) {
        Ok(d) => d,
        Err(e) => return format!("quota db error: {e}"),
    };

    let mut json = serde_json::json!({});

    if let Ok((_, models)) = db.latest_minimax_with_ts("") {
        json["minimax"] = serde_json::json!({
            "models": models.iter().map(|m| serde_json::json!({
                "name": m.name,
                "interval_remaining": m.interval_total - m.interval_usage,
                "interval_total": m.interval_total,
                "weekly_remaining": m.weekly_total - m.weekly_usage,
                "weekly_total": m.weekly_total,
            })).collect::<Vec<_>>()
        });
    }

    if let Ok(Some(s)) = db.latest_deepseek("") {
        json["deepseek"] = serde_json::json!({
            "balance_cny": s.total_balance_cny,
            "balance_usd": s.total_balance_usd,
        });
    }

    if let Ok(Some(s)) = db.latest_zai("") {
        json["zai"] = serde_json::json!({
            "token_5h_pct": s.token_5h_pct,
            "token_week_pct": s.token_week_pct,
            "mcp_month_pct": s.mcp_month_pct,
        });
    }

    if let Ok(Some(s)) = db.latest_claude("") {
        json["claude"] = serde_json::json!({
            "five_h_pct": s.five_h_pct,
            "seven_d_pct": s.seven_d_pct,
            "extra": s.extra.iter().map(|l| serde_json::json!({
                "label": l.label,
                "pct": l.pct,
            })).collect::<Vec<_>>(),
        });
    }

    to_json(&json)
}

fn toc_to_json(toc: &[crate::TocEntry]) -> serde_json::Value {
    toc.iter().map(|e|{
        let loc = match &e.location {
            crate::TocLocation::Pdf{page}=>serde_json::json!({"type":"pdf","page":page}),
            crate::TocLocation::Epub{path,fragment}=>serde_json::json!({"type":"epub","path":path,"fragment":fragment}),
        };
        serde_json::json!({"title":e.title,"level":e.level,"location":loc,"children":toc_to_json(&e.children)})
    }).collect()
}

fn find_toc<'a>(toc: &'a [crate::TocEntry], title: &str) -> Option<&'a crate::TocEntry> {
    for e in toc {
        if e.title.contains(title) || title.contains(&e.title) {
            return Some(e);
        }
        if let Some(f) = find_toc(&e.children, title) {
            return Some(f);
        }
    }
    None
}

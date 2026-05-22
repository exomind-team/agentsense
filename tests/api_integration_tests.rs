use std::sync::atomic::AtomicI64;
use std::sync::Arc;

use agentsense::quota::db::QuotaDb;
use agentsense::quota::deepseek::DeepSeekSnapshot;
use agentsense::quota::minimax::{MinimaxSnapshot, ModelQuota};
use agentsense::quota::zai::ZaiSnapshot;
use agentsense::server::AppState;
use axum::body::Body;
use http::Request;
use http_body_util::BodyExt;
use tower::ServiceExt;

fn seed_db(db: &QuotaDb) {
    let now = chrono::Utc::now().timestamp_millis();
    db.insert_minimax(&MinimaxSnapshot {
        timestamp: now,
        models: vec![
            ModelQuota {
                name: "MiniMax-Text-01".into(),
                interval_usage: 100,
                interval_total: 5000,
                weekly_usage: 500,
                weekly_total: 50000,
                interval_end: None,
                weekly_end: None,
            },
            ModelQuota {
                name: "MiniMax-M1".into(),
                interval_usage: 50,
                interval_total: 3000,
                weekly_usage: 200,
                weekly_total: 30000,
                interval_end: None,
                weekly_end: None,
            },
        ],
    })
    .expect("insert minimax");
    db.insert_deepseek(&DeepSeekSnapshot {
        timestamp: now,
        total_balance_cny: 42.5,
        total_balance_usd: 5.8,
        granted_cny: 10.0,
        topped_up_cny: 32.5,
    })
    .expect("insert deepseek");
    db.insert_zai(&ZaiSnapshot {
        timestamp: now,
        token_5h_pct: 35,
        token_5h_reset: 0,
        token_week_pct: 60,
        token_week_reset: 0,
        mcp_month_pct: 20,
        mcp_used: 100,
        mcp_total: 500,
        mcp_remaining: 400,
        level: "max".into(),
        usage_details_json: "[]".into(),
    })
    .expect("insert zai");
}

fn make_state_with_data() -> Arc<AppState> {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let config_path = dir.path().join("config.json");
    let db = QuotaDb::open(&db_path).expect("open db");
    seed_db(&db);
    std::mem::forget(dir);
    Arc::new(AppState {
        db: Arc::new(tokio::sync::Mutex::new(db)),
        client: reqwest::Client::new(),
        minimax_key: Arc::new(tokio::sync::RwLock::new(Some("test-minimax-key".into()))),
        deepseek_key: Arc::new(tokio::sync::RwLock::new(Some("test-deepseek-key".into()))),
        zai_token: Arc::new(tokio::sync::RwLock::new(Some("test-zai-token".into()))),
        mimo_cookie: Arc::new(tokio::sync::RwLock::new(None)),
        claude_creds: Arc::new(tokio::sync::RwLock::new(None)),
        next_poll: Arc::new(AtomicI64::new(0)),
        last_claude_poll: Arc::new(AtomicI64::new(0)),
        poll_interval_secs: 60,
        config_path,
        #[cfg(feature = "psu")]
        psu: Arc::new(std::sync::Mutex::new(None)),
        #[cfg(feature = "psu")]
        psu_start: std::time::Instant::now(),
        #[cfg(feature = "psu")]
        price_per_kwh: 0.56,
        #[cfg(feature = "psu")]
        currency: "CNY".to_string(),
    })
}

fn make_state_no_keys() -> Arc<AppState> {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let config_path = dir.path().join("config.json");
    let db = QuotaDb::open(&db_path).expect("open db");
    std::mem::forget(dir);
    Arc::new(AppState {
        db: Arc::new(tokio::sync::Mutex::new(db)),
        client: reqwest::Client::new(),
        minimax_key: Arc::new(tokio::sync::RwLock::new(None)),
        deepseek_key: Arc::new(tokio::sync::RwLock::new(None)),
        zai_token: Arc::new(tokio::sync::RwLock::new(None)),
        mimo_cookie: Arc::new(tokio::sync::RwLock::new(None)),
        claude_creds: Arc::new(tokio::sync::RwLock::new(None)),
        next_poll: Arc::new(AtomicI64::new(0)),
        last_claude_poll: Arc::new(AtomicI64::new(0)),
        poll_interval_secs: 60,
        config_path,
        #[cfg(feature = "psu")]
        psu: Arc::new(std::sync::Mutex::new(None)),
        #[cfg(feature = "psu")]
        psu_start: std::time::Instant::now(),
        #[cfg(feature = "psu")]
        price_per_kwh: 0.56,
        #[cfg(feature = "psu")]
        currency: "CNY".to_string(),
    })
}

fn make_state_empty() -> Arc<AppState> {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let config_path = dir.path().join("config.json");
    let db = QuotaDb::open(&db_path).expect("open db");
    std::mem::forget(dir);
    Arc::new(AppState {
        db: Arc::new(tokio::sync::Mutex::new(db)),
        client: reqwest::Client::new(),
        minimax_key: Arc::new(tokio::sync::RwLock::new(Some("test-key".into()))),
        deepseek_key: Arc::new(tokio::sync::RwLock::new(Some("test-key".into()))),
        zai_token: Arc::new(tokio::sync::RwLock::new(Some("test-token".into()))),
        mimo_cookie: Arc::new(tokio::sync::RwLock::new(None)),
        claude_creds: Arc::new(tokio::sync::RwLock::new(None)),
        next_poll: Arc::new(AtomicI64::new(0)),
        last_claude_poll: Arc::new(AtomicI64::new(0)),
        poll_interval_secs: 60,
        config_path,
        #[cfg(feature = "psu")]
        psu: Arc::new(std::sync::Mutex::new(None)),
        #[cfg(feature = "psu")]
        psu_start: std::time::Instant::now(),
        #[cfg(feature = "psu")]
        price_per_kwh: 0.56,
        #[cfg(feature = "psu")]
        currency: "CNY".to_string(),
    })
}

async fn get_json(state: Arc<AppState>, uri: &str) -> (http::StatusCode, serde_json::Value) {
    let app = agentsense::server::router(state);
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .expect("request");
    let status = resp.status();
    let body = resp.into_body().collect().await.expect("body").to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    (status, json)
}

async fn put_json(
    state: Arc<AppState>,
    uri: &str,
    payload: serde_json::Value,
) -> (http::StatusCode, serde_json::Value) {
    let app = agentsense::server::router(state);
    let body = serde_json::to_string(&payload).unwrap();
    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .expect("request");
    let status = resp.status();
    let resp_body = resp.into_body().collect().await.expect("body").to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&resp_body).unwrap_or(serde_json::Value::Null);
    (status, json)
}

async fn get_text(state: Arc<AppState>, uri: &str) -> (http::StatusCode, String) {
    let app = agentsense::server::router(state);
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .expect("request");
    let status = resp.status();
    let body = resp.into_body().collect().await.expect("body").to_bytes();
    (status, String::from_utf8(body.to_vec()).expect("utf8"))
}

// ── GET / ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn get_index_returns_html() {
    let state = make_state_with_data();
    let (status, body) = get_text(state, "/").await;
    assert_eq!(status, http::StatusCode::OK);
    assert!(body.contains("<html"), "should return HTML");
}

// ── GET /api/all ───────────────────────────────────────────────────────

#[tokio::test]
async fn get_all_with_data() {
    let state = make_state_with_data();
    let (status, json) = get_json(state, "/api/all").await;
    assert_eq!(status, http::StatusCode::OK);

    assert!(json["minimax"].is_object());
    assert!(json["deepseek"].is_object());
    assert!(json["zai"].is_object());
    assert!(json["_nextPoll"].is_number());

    let mmx = &json["minimax"];
    assert!(mmx["models"].is_array());
    assert_eq!(mmx["models"].as_array().unwrap().len(), 2);
    assert_eq!(mmx["status"]["status"], "ok");

    assert_eq!(json["deepseek"]["status"]["status"], "ok");
    assert_eq!(json["zai"]["status"]["status"], "ok");
}

#[tokio::test]
async fn get_all_no_keys_returns_no_key() {
    let state = make_state_no_keys();
    let (_, json) = get_json(state, "/api/all").await;
    assert_eq!(json["minimax"]["status"]["status"], "no_key");
    assert_eq!(json["deepseek"]["status"]["status"], "no_key");
    assert_eq!(json["zai"]["status"]["status"], "no_key");
}

#[tokio::test]
async fn get_all_keys_no_data_returns_waiting() {
    let state = make_state_empty();
    let (_, json) = get_json(state, "/api/all").await;
    assert_eq!(json["minimax"]["status"]["status"], "waiting");
    assert_eq!(json["deepseek"]["status"]["status"], "waiting");
    assert_eq!(json["zai"]["status"]["status"], "waiting");
}

// ── GET /api/quota ─────────────────────────────────────────────────────

#[tokio::test]
async fn get_quota_with_data() {
    let state = make_state_with_data();
    let (status, json) = get_json(state, "/api/quota").await;
    assert_eq!(status, http::StatusCode::OK);

    let remains = json["model_remains"]
        .as_array()
        .expect("model_remains array");
    assert_eq!(remains.len(), 2);
    assert_eq!(json["base_resp"]["status_code"], 0);
    assert!(json["_nextPoll"].is_number());

    let first = &remains[0];
    assert!(first["model_name"].is_string());
    assert!(first["current_interval_usage_count"].is_number());
    assert!(first["current_interval_total_count"].is_number());
}

#[tokio::test]
async fn get_quota_no_data_empty() {
    let state = make_state_empty();
    let (_, json) = get_json(state, "/api/quota").await;
    assert!(json["model_remains"].as_array().unwrap().is_empty());
}

// ── GET /api/history ───────────────────────────────────────────────────

#[tokio::test]
async fn get_history_default() {
    let state = make_state_with_data();
    let (status, json) = get_json(state, "/api/history").await;
    assert_eq!(status, http::StatusCode::OK);
    assert!(json.is_array());
}

#[tokio::test]
async fn get_history_specific_model() {
    let state = make_state_with_data();
    let (status, json) = get_json(state, "/api/history?model=MiniMax-Text-01").await;
    assert_eq!(status, http::StatusCode::OK);
    assert!(json.is_array());
}

// ── GET /api/weekly-history ────────────────────────────────────────────

#[tokio::test]
async fn get_weekly_history_returns_array() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/weekly-history").await;
    assert!(json.is_array(), "weekly-history should return array");
}

// ── GET /api/consumption ───────────────────────────────────────────────

#[tokio::test]
async fn get_consumption_structure() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/consumption").await;
    assert!(json["day"].is_object());
    assert!(json["week"].is_object());
    assert!(json["weeklyBar"].is_array());
}

// ── GET /api/deepseek ──────────────────────────────────────────────────

#[tokio::test]
async fn get_deepseek_with_data() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/deepseek").await;
    let bal = &json["balance"];
    assert_eq!(bal["total_balance_cny"].as_f64().unwrap(), 42.5);
    assert_eq!(bal["total_balance_usd"].as_f64().unwrap(), 5.8);
    assert_eq!(bal["granted_cny"].as_f64().unwrap(), 10.0);
    assert_eq!(bal["topped_up_cny"].as_f64().unwrap(), 32.5);
    assert_eq!(json["status"]["status"], "ok");
}

#[tokio::test]
async fn get_deepseek_no_key() {
    let state = make_state_no_keys();
    let (_, json) = get_json(state, "/api/deepseek").await;
    assert_eq!(json["status"]["status"], "no_key");
}

// ── GET /api/deepseek/history ──────────────────────────────────────────

#[tokio::test]
async fn get_deepseek_history_default() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/deepseek/history").await;
    let arr = json.as_array().expect("array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["total_balance_cny"].as_f64().unwrap(), 42.5);
}

#[tokio::test]
async fn get_deepseek_history_1h() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/deepseek/history?hours=1").await;
    assert!(json.is_array());
}

// ── GET /api/zai ───────────────────────────────────────────────────────

#[tokio::test]
async fn get_zai_with_data() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/zai").await;
    let q = &json["quota"];
    assert_eq!(q["token_5h_pct"].as_i64().unwrap(), 35);
    assert_eq!(q["token_week_pct"].as_i64().unwrap(), 60);
    assert_eq!(q["mcp_month_pct"].as_i64().unwrap(), 20);
    assert_eq!(q["mcp_used"].as_i64().unwrap(), 100);
    assert_eq!(q["mcp_total"].as_i64().unwrap(), 500);
    assert_eq!(json["status"]["status"], "ok");
}

// ── GET /api/zai/history ───────────────────────────────────────────────

#[tokio::test]
async fn get_zai_history() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/zai/history").await;
    let arr = json.as_array().expect("array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["token_5h_pct"].as_i64().unwrap(), 35);
}

#[tokio::test]
async fn get_zai_history_hours() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/zai/history?hours=12").await;
    assert!(json.is_array());
}

// ── GET /api/config ────────────────────────────────────────────────────

#[tokio::test]
async fn get_config_masked_keys() {
    let state = make_state_with_data();
    let (_, json) = get_json(state, "/api/config").await;

    let mmx = json["minimax_api_key"].as_str().unwrap();
    let bullet = '\u{2022}';
    assert!(mmx.starts_with(bullet), "key should be masked: {mmx}");
    assert!(mmx.ends_with("-key"), "should end with last 4 chars: {mmx}");

    assert!(json["minimax_configured"].as_bool().unwrap());
    assert!(json["deepseek_configured"].as_bool().unwrap());
    assert!(json["zai_configured"].as_bool().unwrap());
}

#[tokio::test]
async fn get_config_no_keys() {
    let state = make_state_no_keys();
    let (_, json) = get_json(state, "/api/config").await;
    assert!(!json["minimax_configured"].as_bool().unwrap());
    assert!(!json["deepseek_configured"].as_bool().unwrap());
    assert!(!json["zai_configured"].as_bool().unwrap());
}

// ── PUT /api/config ────────────────────────────────────────────────────

#[tokio::test]
async fn put_config_updates_keys() {
    let state = make_state_with_data();
    let (status, json) = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({
            "minimax_api_key": "sk-new-mmx-key-1234",
            "deepseek_api_key": "sk-new-ds-key-5678",
            "zai_auth_token": "new-zai-token-9012",
        }),
    )
    .await;
    assert_eq!(status, http::StatusCode::OK);
    assert_eq!(json["ok"], true);

    let (_, cfg) = get_json(state, "/api/config").await;
    let mmx = cfg["minimax_api_key"].as_str().unwrap();
    assert!(
        mmx.ends_with("1234"),
        "should show last 4 of new key: {mmx}"
    );
}

#[tokio::test]
async fn put_config_ignores_masked_values() {
    let state = make_state_with_data();

    // Get current masked value
    let (_, before) = get_json(state.clone(), "/api/config").await;
    let masked = before["minimax_api_key"].as_str().unwrap().to_string();

    // PUT with the masked value (should NOT update)
    let (_, resp) = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({ "minimax_api_key": masked }),
    )
    .await;
    assert_eq!(resp["ok"], true);

    let (_, after) = get_json(state, "/api/config").await;
    assert_eq!(
        after["minimax_api_key"].as_str().unwrap(),
        before["minimax_api_key"].as_str().unwrap(),
        "masked value should not change the key"
    );
}

#[tokio::test]
async fn put_config_empty_ignored() {
    let state = make_state_with_data();
    let (_, resp) = put_json(
        state.clone(),
        "/api/config",
        serde_json::json!({ "minimax_api_key": "" }),
    )
    .await;
    assert_eq!(resp["ok"], true);

    let (_, cfg) = get_json(state, "/api/config").await;
    assert!(
        cfg["minimax_configured"].as_bool().unwrap(),
        "empty string should not clear key"
    );
}

// ── GET /api/refresh ───────────────────────────────────────────────────

#[tokio::test]
async fn get_refresh_returns_ok() {
    let state = make_state_no_keys();
    let (status, json) = get_json(state, "/api/refresh").await;
    assert_eq!(status, http::StatusCode::OK);
    assert_eq!(json["ok"], true);
    assert!(json["_nextPoll"].is_number());
}

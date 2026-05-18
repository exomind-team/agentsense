pub mod handlers;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use crate::config::QuotaConfig;
use crate::error::AgentSenseError;
use crate::quota::db::QuotaDb;

pub struct AppState {
    pub db: Arc<tokio::sync::Mutex<QuotaDb>>,
    pub client: reqwest::Client,
    pub minimax_key: Arc<tokio::sync::RwLock<Option<String>>>,
    pub deepseek_key: Arc<tokio::sync::RwLock<Option<String>>>,
    pub zai_token: Arc<tokio::sync::RwLock<Option<String>>>,
    pub next_poll: Arc<AtomicI64>,
    pub poll_interval_secs: u64,
    pub config_path: PathBuf,
}

pub fn router(state: Arc<AppState>) -> axum::Router {
    use axum::routing::get;

    axum::Router::new()
        .route("/", get(handlers::serve_index))
        .route("/api/all", get(handlers::api_all))
        .route("/api/quota", get(handlers::api_quota))
        .route("/api/history", get(handlers::api_history))
        .route("/api/weekly-history", get(handlers::api_weekly_history))
        .route("/api/consumption", get(handlers::api_consumption))
        .route("/api/deepseek", get(handlers::api_deepseek))
        .route("/api/deepseek/history", get(handlers::api_deepseek_history))
        .route("/api/zai", get(handlers::api_zai))
        .route("/api/zai/history", get(handlers::api_zai_history))
        .route(
            "/api/config",
            get(handlers::api_config_get).put(handlers::api_config_put),
        )
        .route("/api/refresh", get(handlers::api_refresh))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

pub async fn serve(
    config: &QuotaConfig,
    config_path: PathBuf,
    port: u16,
) -> Result<(), AgentSenseError> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
    if let Some(ref proxy) = config.proxy {
        let p = reqwest::Proxy::all(proxy)
            .map_err(|e| AgentSenseError::Config(format!("invalid proxy: {e}")))?;
        builder = builder.proxy(p);
    }
    let client = builder.build()?;

    let db = QuotaDb::open(&config.db_path())?;
    let state = Arc::new(AppState {
        db: Arc::new(tokio::sync::Mutex::new(db)),
        client,
        minimax_key: Arc::new(tokio::sync::RwLock::new(config.minimax_key())),
        deepseek_key: Arc::new(tokio::sync::RwLock::new(config.deepseek_key())),
        zai_token: Arc::new(tokio::sync::RwLock::new(config.zai_token())),
        next_poll: Arc::new(AtomicI64::new(0)),
        poll_interval_secs: config.poll_interval_secs,
        config_path,
    });

    do_poll(state.clone()).await;

    {
        let loop_state = state.clone();
        tokio::spawn(async move { poll_loop(loop_state).await });
    }

    let app = router(state.clone());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(AgentSenseError::Io)?;

    println!("AI Quota Monitor running on http://localhost:{port}");
    println!(
        "Config: {} (MMX: {}, DS: {}, ZAI: {})",
        state.config_path.display(),
        state.minimax_key.read().await.is_some(),
        state.deepseek_key.read().await.is_some(),
        state.zai_token.read().await.is_some(),
    );

    axum::serve(listener, app)
        .await
        .map_err(|e| AgentSenseError::Http(format!("server error: {e}")))?;

    Ok(())
}

pub async fn do_poll(state: Arc<AppState>) {
    let mmx_key = state.minimax_key.read().await.clone();
    let ds_key = state.deepseek_key.read().await.clone();
    let zai_tok = state.zai_token.read().await.clone();

    let mmx = if let Some(key) = mmx_key {
        let client = state.client.clone();
        Some(
            tokio::spawn(async move { crate::quota::minimax::fetch(&client, &key).await })
                .await
                .unwrap_or_else(|e| {
                    Err(AgentSenseError::Http(format!("MiniMax task panicked: {e}")))
                }),
        )
    } else {
        None
    };

    let ds = if let Some(key) = ds_key {
        let client = state.client.clone();
        Some(
            tokio::spawn(async move { crate::quota::deepseek::fetch(&client, &key).await })
                .await
                .unwrap_or_else(|e| Err(AgentSenseError::Http(format!(
                    "DeepSeek task panicked: {e}"
                )))),
        )
    } else {
        None
    };

    let zai = if let Some(token) = zai_tok {
        let client = state.client.clone();
        Some(
            tokio::spawn(async move { crate::quota::zai::fetch(&client, &token).await })
                .await
                .unwrap_or_else(|e| {
                    Err(AgentSenseError::Http(format!("Z.AI task panicked: {e}")))
                }),
        )
    } else {
        None
    };

    let db = state.db.lock().await;
    if let Some(Ok(ref snap)) = mmx {
        if let Err(e) = db.insert_minimax(snap) {
            eprintln!("[WARN] DB insert minimax: {e}");
        }
    }
    if let Some(Ok(ref snap)) = ds {
        if let Err(e) = db.insert_deepseek(snap) {
            eprintln!("[WARN] DB insert deepseek: {e}");
        }
    }
    if let Some(Ok(ref snap)) = zai {
        if let Err(e) = db.insert_zai(snap) {
            eprintln!("[WARN] DB insert zai: {e}");
        }
    }
    drop(db);

    let next =
        chrono::Utc::now().timestamp_millis() + (state.poll_interval_secs as i64) * 1000;
    state.next_poll.store(next, Ordering::Relaxed);

    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    println!("[{ts}] Poll all done");
}

async fn poll_loop(state: Arc<AppState>) {
    let mut interval =
        tokio::time::interval(std::time::Duration::from_secs(state.poll_interval_secs));
    interval.tick().await;
    loop {
        interval.tick().await;
        do_poll(state.clone()).await;
    }
}

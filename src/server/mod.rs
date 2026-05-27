pub mod handlers;

use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

#[cfg(feature = "psu")]
use std::time::Instant;

use crate::config::AppConfig;
use crate::error::AgentSenseError;
#[cfg(feature = "psu")]
use crate::quota::db::PowerSampleRow;
use crate::quota::db::QuotaDb;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<tokio::sync::Mutex<QuotaDb>>,
    pub client: reqwest::Client,
    /// (api_key, label) pairs for each configured MiniMax account
    pub minimax_keys: Arc<tokio::sync::RwLock<Vec<(String, Option<String>)>>>,
    /// (api_key, label) pairs for each configured DeepSeek account
    pub deepseek_keys: Arc<tokio::sync::RwLock<Vec<(String, Option<String>)>>>,
    /// (auth_token, label) pairs for each configured Z.AI account
    pub zai_tokens: Arc<tokio::sync::RwLock<Vec<(String, Option<String>)>>>,
    /// (cookie, label) pairs for each configured MiMo account
    pub mimo_cookies: Arc<tokio::sync::RwLock<Vec<(String, Option<String>)>>>,
    /// ((bearer_token, cookies), label) pairs for each configured DeepSeek Platform account
    pub deepseek_platform_creds:
        Arc<tokio::sync::RwLock<Vec<((String, String), Option<String>)>>>,
    pub claude_creds: Arc<tokio::sync::RwLock<Option<PathBuf>>>,
    pub next_poll: Arc<AtomicI64>,
    pub last_claude_poll: Arc<AtomicI64>,
    pub poll_interval_secs: u64,
    pub config_path: PathBuf,
    #[cfg(feature = "psu")]
    pub psu: Arc<std::sync::Mutex<Option<wattson::PsuHandle>>>,
    #[cfg(feature = "psu")]
    pub psu_start: Instant,
    #[cfg(feature = "psu")]
    pub price_per_kwh: f64,
    #[cfg(feature = "psu")]
    pub currency: String,
}

pub fn router(state: Arc<AppState>) -> axum::Router {
    use axum::routing::get;

    let router = axum::Router::new()
        .route("/", get(handlers::serve_index))
        .route("/mcp", axum::routing::post(handlers::mcp_handler))
        .route("/api/all", get(handlers::api_all))
        .route("/api/quota", get(handlers::api_quota))
        .route("/api/history", get(handlers::api_history))
        .route("/api/weekly-history", get(handlers::api_weekly_history))
        .route("/api/consumption", get(handlers::api_consumption))
        .route("/api/deepseek", get(handlers::api_deepseek))
        .route("/api/deepseek/history", get(handlers::api_deepseek_history))
        .route(
            "/api/deepseek/platform",
            get(handlers::api_deepseek_platform_usage),
        )
        .route("/api/zai", get(handlers::api_zai))
        .route("/api/zai/history", get(handlers::api_zai_history))
        .route("/api/zai/models", get(handlers::api_zai_models))
        .route("/api/mimo", get(handlers::api_mimo))
        .route("/api/mimo/history", get(handlers::api_mimo_history))
        .route("/api/claude", get(handlers::api_claude))
        .route("/api/claude/history", get(handlers::api_claude_history))
        .route(
            "/api/config",
            get(handlers::api_config_get).put(handlers::api_config_put),
        )
        .route("/api/refresh", get(handlers::api_refresh));

    #[cfg(feature = "psu")]
    let router = router
        .route("/api/power", get(handlers::psu::api_power))
        .route("/api/thermal", get(handlers::psu::api_thermal))
        .route("/api/psu-cost", get(handlers::psu::api_psu_cost))
        .route("/api/power/history", get(handlers::psu::api_power_history))
        .route(
            "/api/fan/mode",
            axum::routing::post(handlers::psu::set_fan_mode),
        )
        .route(
            "/api/fan/speed",
            axum::routing::post(handlers::psu::set_fan_speed),
        )
        .route(
            "/api/fan/curve",
            axum::routing::post(handlers::psu::set_fan_curve),
        );

    router
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

pub async fn serve(
    config: &AppConfig,
    config_path: PathBuf,
    port: u16,
) -> Result<(), AgentSenseError> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
    if let Some(ref proxy) = config.quota.proxy {
        let p = reqwest::Proxy::all(proxy)
            .map_err(|e| AgentSenseError::Config(format!("invalid proxy: {e}")))?;
        builder = builder.proxy(p);
    }
    let client = builder.build()?;

    let db = QuotaDb::open(&config.quota.db_path())?;
    let state = Arc::new(AppState {
        db: Arc::new(tokio::sync::Mutex::new(db)),
        client,
        minimax_keys: Arc::new(tokio::sync::RwLock::new(config.quota.minimax_keys())),
        deepseek_keys: Arc::new(tokio::sync::RwLock::new(config.quota.deepseek_keys())),
        zai_tokens: Arc::new(tokio::sync::RwLock::new(config.quota.zai_tokens())),
        mimo_cookies: Arc::new(tokio::sync::RwLock::new(config.quota.mimo_cookies())),
        claude_creds: Arc::new(tokio::sync::RwLock::new(config.quota.claude_creds_path())),
        deepseek_platform_creds: Arc::new(tokio::sync::RwLock::new(
            config.quota.deepseek_platform_creds_list(),
        )),
        next_poll: Arc::new(AtomicI64::new(0)),
        last_claude_poll: Arc::new(AtomicI64::new(0)),
        poll_interval_secs: config.quota.poll_interval_secs,
        config_path,
        #[cfg(feature = "psu")]
        psu: Arc::new(std::sync::Mutex::new(None)),
        #[cfg(feature = "psu")]
        psu_start: Instant::now(),
        #[cfg(feature = "psu")]
        price_per_kwh: config.cost.price_per_kwh,
        #[cfg(feature = "psu")]
        currency: config.cost.currency.clone(),
    });

    // Initialize PSU hardware if configured
    #[cfg(feature = "psu")]
    {
        if let Some(ref serial_cfg) = config.serial {
            let profile = wattson::DeviceProfile::from_name(&config.device.profile)
                .unwrap_or(wattson::DeviceProfile::SEGOTEP_DM);
            let mode = match serial_cfg.mode.as_str() {
                "passive" => wattson::Mode::Passive,
                _ => wattson::Mode::Active,
            };
            // Wire the configured sample interval into the serial QUERY cadence.
            // Without this the monitor used wattson's hard-coded 300ms default,
            // hammering the CH340 driver (CH341S64.SYS) with ~3 write + ~10 read
            // IRPs/sec regardless of config — the trigger for the 0xD1 BSOD race.
            match wattson::PsuMonitor::new(&serial_cfg.port, mode)
                .with_profile(profile)
                .with_poll_interval(std::time::Duration::from_millis(serial_cfg.sample_interval_ms))
                .start()
            {
                Ok(handle) => {
                    println!("  PSU:       {} connected", serial_cfg.port);
                    *state.psu.lock().unwrap() = Some(handle);
                }
                Err(e) => {
                    tracing::warn!(port = %serial_cfg.port, error = %e, "PSU init failed on port");
                }
            }
        }
    }

    do_poll(state.clone()).await;

    {
        let loop_state = state.clone();
        tokio::spawn(async move { poll_loop(loop_state).await });
    }

    // Create shutdown channel shared between axum and the sampling loop.
    // Fix A: watch channel carries the shutdown signal.
    #[cfg(feature = "psu")]
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    // Spawn power sampling background task; capture the JoinHandle for a clean shutdown join.
    #[cfg(feature = "psu")]
    let sampling_task = {
        let sample_state = state.clone();
        // Fix I: clamp sample_interval_ms to [50, 60_000] so interval is never 0.
        let sample_interval = config
            .serial
            .as_ref()
            .map(|s| s.sample_interval_ms)
            .unwrap_or(300)
            .clamp(50, 60_000);
        let rx = shutdown_rx;
        tokio::spawn(async move {
            power_sampling_loop(sample_state, sample_interval, rx).await;
        })
    };

    let app = router(state.clone());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(AgentSenseError::Io)?;

    let mmx_count = state.minimax_keys.read().await.len();
    let ds_count = state.deepseek_keys.read().await.len();
    let zai_count = state.zai_tokens.read().await.len();
    let mimo_count = state.mimo_cookies.read().await.len();
    println!("AgentSense MCP Server");
    println!("  Dashboard: http://localhost:{port}");
    println!("  MCP:       http://localhost:{port}/mcp");
    println!(
        "  Config:    {} (MMX: {} accounts, DS: {} accounts, ZAI: {} accounts, MiMo: {} accounts)",
        state.config_path.display(),
        mmx_count,
        ds_count,
        zai_count,
        mimo_count,
    );
    println!(
        "  Claude:    {}",
        state
            .claude_creds
            .read()
            .await
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "disabled".into())
    );

    // Fix A: wire graceful shutdown — axum stops accepting after Ctrl-C.
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|e| AgentSenseError::Http(format!("server error: {e}")))?;

    // Fix A: signal the sampling loop to flush and exit, then join it with a bounded timeout.
    #[cfg(feature = "psu")]
    {
        let _ = shutdown_tx.send(true);
        match tokio::time::timeout(std::time::Duration::from_secs(5), sampling_task).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!(error = %e, "power sampling task join failed on shutdown"),
            Err(_) => {
                tracing::warn!("power sampling task did not finish its final flush within 5s")
            }
        }
    }

    Ok(())
}

pub async fn do_poll(state: Arc<AppState>) {
    // --- MiniMax: fetch all configured accounts in parallel ---
    {
        let mmx_keys = state.minimax_keys.read().await.clone();
        let db = state.db.clone();
        let client = state.client.clone();
        let mut handles = Vec::new();
        for (key, label) in mmx_keys {
            let client = client.clone();
            let label_str = label.clone();
            handles.push(tokio::spawn(async move {
                let result = crate::quota::minimax::fetch(&client, &key).await;
                (label_str, result)
            }));
        }
        let db_lock = db.lock().await;
        for h in handles {
            match h.await {
                Ok((label, Ok(snap))) => {
                    let l = label.as_deref().unwrap_or("");
                    if let Err(e) = db_lock.insert_minimax(&snap, l) {
                        tracing::warn!(provider = "minimax", label = l, error = %e, "insert failed");
                    }
                }
                Ok((label, Err(e))) => {
                    let l = label.as_deref().unwrap_or("");
                    tracing::warn!(provider = "minimax", label = l, error = %e, "fetch failed");
                }
                Err(e) => {
                    tracing::warn!(provider = "minimax", error = %e, "task panicked");
                }
            }
        }
    }

    // --- DeepSeek: fetch all configured accounts in parallel ---
    {
        let ds_keys = state.deepseek_keys.read().await.clone();
        let db = state.db.clone();
        let client = state.client.clone();
        let mut handles = Vec::new();
        for (key, label) in ds_keys {
            let client = client.clone();
            let label_str = label.clone();
            handles.push(tokio::spawn(async move {
                let result = crate::quota::deepseek::fetch(&client, &key).await;
                (label_str, result)
            }));
        }
        let db_lock = db.lock().await;
        for h in handles {
            match h.await {
                Ok((label, Ok(snap))) => {
                    let l = label.as_deref().unwrap_or("");
                    if let Err(e) = db_lock.insert_deepseek(&snap, l) {
                        tracing::warn!(provider = "deepseek", label = l, error = %e, "insert failed");
                    }
                }
                Ok((label, Err(e))) => {
                    let l = label.as_deref().unwrap_or("");
                    tracing::warn!(provider = "deepseek", label = l, error = %e, "fetch failed");
                }
                Err(e) => {
                    tracing::warn!(provider = "deepseek", error = %e, "task panicked");
                }
            }
        }
    }

    // --- Z.AI: fetch all configured accounts in parallel ---
    {
        let zai_keys = state.zai_tokens.read().await.clone();
        let db = state.db.clone();
        let client = state.client.clone();
        let mut handles = Vec::new();
        for (token, label) in zai_keys {
            let client = client.clone();
            let label_str = label.clone();
            handles.push(tokio::spawn(async move {
                let result = crate::quota::zai::fetch(&client, &token).await;
                (label_str, result)
            }));
        }
        let db_lock = db.lock().await;
        for h in handles {
            match h.await {
                Ok((label, Ok(snap))) => {
                    let l = label.as_deref().unwrap_or("");
                    if let Err(e) = db_lock.insert_zai(&snap, l) {
                        tracing::warn!(provider = "zai", label = l, error = %e, "insert failed");
                    }
                }
                Ok((label, Err(e))) => {
                    let l = label.as_deref().unwrap_or("");
                    tracing::warn!(provider = "zai", label = l, error = %e, "fetch failed");
                }
                Err(e) => {
                    tracing::warn!(provider = "zai", error = %e, "task panicked");
                }
            }
        }
    }

    // --- MiMo: fetch all configured accounts in parallel ---
    {
        let mimo_keys = state.mimo_cookies.read().await.clone();
        let db = state.db.clone();
        let client = state.client.clone();
        let mut handles = Vec::new();
        for (cookie, label) in mimo_keys {
            let client = client.clone();
            let label_str = label.clone();
            handles.push(tokio::spawn(async move {
                let result = crate::quota::mimo::fetch(&client, &cookie).await;
                (label_str, result)
            }));
        }
        let db_lock = db.lock().await;
        for h in handles {
            match h.await {
                Ok((label, Ok(snap))) => {
                    let l = label.as_deref().unwrap_or("");
                    if let Err(e) = db_lock.insert_mimo(&snap, l) {
                        tracing::warn!(provider = "mimo", label = l, error = %e, "insert failed");
                    }
                }
                Ok((label, Err(e))) => {
                    let l = label.as_deref().unwrap_or("");
                    tracing::warn!(provider = "mimo", label = l, error = %e, "fetch failed");
                }
                Err(e) => {
                    tracing::warn!(provider = "mimo", error = %e, "task panicked");
                }
            }
        }
    }

    // --- DeepSeek Platform: fetch all configured accounts in parallel ---
    {
        let dsp_creds = state.deepseek_platform_creds.read().await.clone();
        let db = state.db.clone();
        let client = state.client.clone();
        let mut handles = Vec::new();
        for ((token, cookies), label) in dsp_creds {
            let client = client.clone();
            let label_str = label.clone();
            handles.push(tokio::spawn(async move {
                let result =
                    crate::quota::deepseek_platform::fetch(&client, &token, &cookies).await;
                (label_str, result)
            }));
        }
        let db_lock = db.lock().await;
        for h in handles {
            match h.await {
                Ok((label, Ok(snap))) => {
                    let l = label.as_deref().unwrap_or("");
                    if let Err(e) = db_lock.insert_deepseek_platform(&snap, l) {
                        tracing::warn!(provider = "deepseek_platform", label = l, error = %e, "insert failed");
                    }
                }
                Ok((label, Err(e))) => {
                    let l = label.as_deref().unwrap_or("");
                    tracing::warn!(provider = "deepseek_platform", label = l, error = %e, "fetch failed");
                }
                Err(e) => {
                    tracing::warn!(provider = "deepseek_platform", error = %e, "task panicked");
                }
            }
        }
    }

    // --- Claude: single instance, rate-limited ---
    let claude_path = state.claude_creds.read().await.clone();
    if let Some(path) = claude_path {
        let now = chrono::Utc::now().timestamp();
        let elapsed = now - state.last_claude_poll.load(Ordering::Relaxed);
        if elapsed >= 300 {
            let db = state.db.clone();
            let client = state.client.clone();
            let result = tokio::spawn(async move {
                crate::quota::claude::fetch_with_creds(&client, &path).await
            })
            .await
            .unwrap_or_else(|e| {
                Err(AgentSenseError::Http(format!("Claude task panicked: {e}")))
            });
            match result {
                Ok(snap) => {
                    let db_lock = db.lock().await;
                    if let Err(e) = db_lock.insert_claude(&snap, "") {
                        tracing::warn!(provider = "claude", error = %e, "insert failed");
                    }
                }
                Err(e) => {
                    tracing::warn!(provider = "claude", error = %e, "fetch failed");
                }
            }
            state.last_claude_poll.store(now, Ordering::Relaxed);
        }
    }

    let next = chrono::Utc::now().timestamp_millis() + (state.poll_interval_secs as i64) * 1000;
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

/// High-water cap for the in-memory sample buffer (approx 1h at 300 ms intervals).
/// Fix B: oldest samples are dropped if the buffer exceeds this limit.
#[cfg(feature = "psu")]
const MAX_SAMPLE_BUFFER: usize = 1200;

#[cfg(feature = "psu")]
async fn power_sampling_loop(
    state: Arc<AppState>,
    sample_interval_ms: u64,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let batch_interval = std::time::Duration::from_secs(5);
    let mut buffer: Vec<PowerSampleRow> = Vec::new();
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(sample_interval_ms));
    let mut batch_timer = tokio::time::interval(batch_interval);
    loop {
        tokio::select! {
            // Fix D: use try_lock so a slow fan command never stalls the worker.
            _ = interval.tick() => {
                if let Ok(guard) = state.psu.try_lock() {
                    if let Some(handle) = guard.as_ref() {
                        let snap = handle.latest();
                        if snap.meta.connected && snap.meta.data_age_s < 5.0 {
                            let ts = chrono::Utc::now().timestamp_millis();
                            buffer.push((
                                ts,
                                snap.power.ac_input_w,
                                Some(snap.power.dc_output_est_w),
                                Some(snap.thermal.temp_main_c),
                                Some(snap.fan.rpm),
                            ));
                            // Fix B: enforce high-water cap, dropping oldest entries.
                            if buffer.len() > MAX_SAMPLE_BUFFER {
                                let overflow = buffer.len() - MAX_SAMPLE_BUFFER;
                                buffer.drain(0..overflow);
                            }
                        }
                    }
                }
                // If try_lock fails, skip this tick rather than blocking.
            }
            _ = batch_timer.tick() => {
                if !buffer.is_empty() {
                    if let Ok(db) = state.db.try_lock() {
                        if let Err(e) = db.insert_power_batch(&buffer) {
                            eprintln!("power sample insert error: {e}");
                        }
                        buffer.clear();
                    }
                }
            }
            // Fix A: shutdown branch — final flush then exit.
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    if !buffer.is_empty() {
                        let db = state.db.lock().await;
                        if let Err(e) = db.insert_power_batch(&buffer) {
                            eprintln!("power sample final flush error: {e}");
                        }
                        buffer.clear();
                    }
                    break;
                }
            }
        }
    }
}

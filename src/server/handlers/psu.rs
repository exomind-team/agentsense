use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::Datelike;
use serde::{Deserialize, Serialize};

use crate::server::AppState;

// ── Response types ──

#[derive(Serialize)]
struct DisconnectedResponse {
    connected: bool,
}

fn disconnected() -> Json<DisconnectedResponse> {
    Json(DisconnectedResponse { connected: false })
}

#[derive(Serialize)]
struct PowerResponse {
    connected: bool,
    ac_input_w: f64,
    dc_output_est_w: f64,
    dc: DcData,
    today_peak_w: f64,
    today_avg_w: f64,
}

#[derive(Serialize)]
struct DcData {
    volt_12v: f64,
    curr_12v_a: f64,
    power_12v_w: f64,
    volt_5v: f64,
    curr_5v_a: f64,
    power_5v_w: f64,
    volt_3v3: f64,
    curr_3v3_a: f64,
    power_3v3_w: f64,
}

#[derive(Serialize)]
struct ThermalResponse {
    connected: bool,
    temp_main_c: f64,
    temp_air_c: f64,
    temp_air2_c: f64,
    fan_rpm: u32,
    fan_pwm: u8,
}

#[derive(Serialize)]
struct CostPeriod {
    kwh: f64,
    cost: f64,
}

#[derive(Serialize)]
struct PsuCostResponse {
    connected: bool,
    day: CostPeriod,
    week: CostPeriod,
    month: CostPeriod,
    projected: PsuCostProjected,
    price_per_kwh: f64,
    currency: String,
    monitoring_duration_s: f64,
}

#[derive(Serialize)]
struct PsuCostProjected {
    day: CostPeriod,
    week: CostPeriod,
    month: CostPeriod,
}

#[derive(Serialize)]
struct PowerHistoryPoint {
    ts: i64,
    ac_w: f64,
    dc_w: Option<f64>,
    temp_c: Option<f64>,
    fan_rpm: Option<u32>,
}

#[derive(Serialize)]
struct PowerHistoryResponse {
    connected: bool,
    data: Vec<PowerHistoryPoint>,
}

#[derive(Deserialize)]
pub struct FanModeRequest {
    pub mode: wattson::FanMode,
}

#[derive(Deserialize)]
pub struct FanSpeedRequest {
    pub pwm: u8,
}

#[derive(Deserialize)]
pub struct FanCurveRequest {
    pub points: Vec<(u8, u8)>,
}

const MIN_PWM: u8 = 20;

// ── Handlers ──

fn read_psu(state: &AppState) -> Option<wattson::PsuSnapshot> {
    let guard = state.psu.lock().unwrap();
    let handle = guard.as_ref()?;
    let snap = handle.latest();
    if snap.meta.connected {
        Some(snap)
    } else {
        None
    }
}

pub async fn api_power(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let Some(snap) = read_psu(&state) else {
        return Json(serde_json::to_value(disconnected().0).unwrap());
    };

    let today_start = {
        let now = chrono::Local::now();
        now.date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    };
    let stats = state
        .db
        .lock()
        .await
        .query_power_stats(today_start)
        .ok()
        .flatten();
    let (peak, avg) = stats.unwrap_or((0.0, 0.0));

    let resp = PowerResponse {
        connected: true,
        ac_input_w: snap.power.ac_input_w,
        dc_output_est_w: snap.power.dc_output_est_w,
        dc: DcData {
            volt_12v: snap.dc.volt_12v,
            curr_12v_a: snap.dc.curr_12v_a,
            power_12v_w: snap.dc.power_12v_w,
            volt_5v: snap.dc.volt_5v,
            curr_5v_a: snap.dc.curr_5v_a,
            power_5v_w: snap.dc.power_5v_w,
            volt_3v3: snap.dc.volt_3v3,
            curr_3v3_a: snap.dc.curr_3v3_a,
            power_3v3_w: snap.dc.power_3v3_w,
        },
        today_peak_w: peak,
        today_avg_w: avg,
    };
    Json(serde_json::to_value(resp).unwrap())
}

pub async fn api_thermal(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let guard = state.psu.lock().unwrap();
    let Some(handle) = guard.as_ref() else {
        return Json(serde_json::to_value(disconnected().0).unwrap());
    };
    let snap = handle.latest();
    if !snap.meta.connected {
        return Json(serde_json::to_value(disconnected().0).unwrap());
    }
    let resp = ThermalResponse {
        connected: true,
        temp_main_c: snap.thermal.temp_main_c,
        temp_air_c: snap.thermal.temp_air_c,
        temp_air2_c: snap.thermal.temp_air2_c,
        fan_rpm: snap.fan.rpm,
        fan_pwm: snap.fan.pwm,
    };
    Json(serde_json::to_value(resp).unwrap())
}

pub async fn api_psu_cost(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    if read_psu(&state).is_none() {
        return Json(serde_json::to_value(disconnected().0).unwrap());
    }

    let db = state.db.lock().await;
    let price = state.price_per_kwh;

    let now = chrono::Local::now();
    let day_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let week_start = (now - chrono::Duration::days(now.weekday().num_days_from_monday() as i64))
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let month_start = now
        .date_naive()
        .with_day(1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    let day_kwh = db.compute_energy_kwh(day_start).unwrap_or(0.0);
    let week_kwh = db.compute_energy_kwh(week_start).unwrap_or(0.0);
    let month_kwh = db.compute_energy_kwh(month_start).unwrap_or(0.0);

    let duration_s = state.psu_start.elapsed().as_secs_f64();
    let month_total_days = now.num_days_in_month() as f64;

    // Projection model (方案 1): extrapolate from the observed MEAN draw, assuming the PSU
    // keeps running at that average. The mean of all recorded ac_w samples this month
    // (query_power_stats avg) ≈ average power while monitored. This is restart-safe (it
    // spans every session, not just the current uptime) and gap-safe (a sample mean, not
    // a calendar divide), avoiding the trap of dividing DB-accumulated energy by one
    // session's uptime. day/week/month then scale correctly as 24h : 168h : (days*24)h.
    // Requires >=60s of data so the first samples don't yield a noisy rate.
    let avg_w = db
        .query_power_stats(month_start)
        .ok()
        .flatten()
        .map(|(_peak, avg)| avg)
        .unwrap_or(0.0);
    let rate_kw = avg_w / 1000.0;
    let can_project = duration_s >= 60.0 && avg_w > 0.0;
    let project = |total_h: f64| -> CostPeriod {
        if !can_project {
            return CostPeriod {
                kwh: 0.0,
                cost: 0.0,
            };
        }
        let projected_kwh = rate_kw * total_h;
        CostPeriod {
            kwh: (projected_kwh * 1000.0).round() / 1000.0,
            cost: (projected_kwh * price * 100.0).round() / 100.0,
        }
    };

    let resp = PsuCostResponse {
        connected: true,
        day: CostPeriod {
            kwh: (day_kwh * 1000.0).round() / 1000.0,
            cost: (day_kwh * price * 100.0).round() / 100.0,
        },
        week: CostPeriod {
            kwh: (week_kwh * 1000.0).round() / 1000.0,
            cost: (week_kwh * price * 100.0).round() / 100.0,
        },
        month: CostPeriod {
            kwh: (month_kwh * 1000.0).round() / 1000.0,
            cost: (month_kwh * price * 100.0).round() / 100.0,
        },
        projected: PsuCostProjected {
            day: project(24.0),
            week: project(24.0 * 7.0),
            month: project(24.0 * month_total_days),
        },
        price_per_kwh: price,
        currency: state.currency.clone(),
        monitoring_duration_s: duration_s,
    };
    Json(serde_json::to_value(resp).unwrap())
}

pub async fn api_power_history(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    if read_psu(&state).is_none() {
        return Json(serde_json::to_value(disconnected().0).unwrap());
    }

    let range = params.get("range").map(|s| s.as_str()).unwrap_or("30m");
    let since_ts = match range {
        "30m" => chrono::Utc::now().timestamp_millis() - 30 * 60 * 1000,
        "1d" => chrono::Utc::now().timestamp_millis() - 24 * 60 * 60 * 1000,
        "1w" => chrono::Utc::now().timestamp_millis() - 7 * 24 * 60 * 60 * 1000,
        "1m" => chrono::Utc::now().timestamp_millis() - 30 * 24 * 60 * 60 * 1000,
        _ => chrono::Utc::now().timestamp_millis() - 30 * 60 * 1000,
    };

    let db = state.db.lock().await;
    let raw = db.query_power_history(since_ts).unwrap_or_default();

    let data: Vec<PowerHistoryPoint> = if raw.len() > 500 {
        let step = raw.len() / 500;
        raw.into_iter()
            .enumerate()
            .filter(|(i, _)| i % step == 0)
            .map(|(_, (ts, ac_w, dc_w, temp_c, fan_rpm))| PowerHistoryPoint {
                ts,
                ac_w,
                dc_w,
                temp_c,
                fan_rpm,
            })
            .collect()
    } else {
        raw.into_iter()
            .map(|(ts, ac_w, dc_w, temp_c, fan_rpm)| PowerHistoryPoint {
                ts,
                ac_w,
                dc_w,
                temp_c,
                fan_rpm,
            })
            .collect()
    };

    Json(
        serde_json::to_value(PowerHistoryResponse {
            connected: true,
            data,
        })
        .unwrap(),
    )
}

pub async fn set_fan_mode(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FanModeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Fast-path: if PSU handle is absent, skip the spawn entirely.
    {
        let guard = state.psu.lock().unwrap();
        if guard.is_none() {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"ok": false, "message": "PSU not connected"})),
            ));
        }
    }
    // Fix C: move the blocking serial call off the tokio worker thread.
    let psu_arc = Arc::clone(&state.psu);
    let mode = req.mode;
    let result = tokio::task::spawn_blocking(move || {
        let guard = psu_arc.lock().unwrap();
        match guard.as_ref() {
            None => Err("PSU not connected".to_string()),
            Some(handle) => handle.set_fan_mode(mode).map_err(|e| format!("{e}")),
        }
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "message": format!("task panic: {e}")})),
        )
    })?;

    result.map_err(|msg| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "message": msg})),
        )
    })?;
    Ok(Json(serde_json::json!({"ok": true, "action": "fan_mode"})))
}

pub async fn set_fan_speed(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FanSpeedRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if req.pwm < MIN_PWM {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false, "message": format!("PWM must be >= {} (safety minimum)", MIN_PWM)
            })),
        ));
    }
    // Fast-path: if PSU handle is absent, skip the spawn entirely.
    {
        let guard = state.psu.lock().unwrap();
        if guard.is_none() {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"ok": false, "message": "PSU not connected"})),
            ));
        }
    }
    // Fix C: move the blocking serial call off the tokio worker thread.
    let psu_arc = Arc::clone(&state.psu);
    let pwm = req.pwm;
    let result = tokio::task::spawn_blocking(move || {
        let guard = psu_arc.lock().unwrap();
        match guard.as_ref() {
            None => Err("PSU not connected".to_string()),
            Some(handle) => handle.set_fan_pwm(pwm).map_err(|e| format!("{e}")),
        }
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "message": format!("task panic: {e}")})),
        )
    })?;

    result.map_err(|msg| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "message": msg})),
        )
    })?;
    Ok(Json(
        serde_json::json!({"ok": true, "action": "fan_speed", "pwm": pwm}),
    ))
}

pub async fn set_fan_curve(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FanCurveRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if req.points.len() != 3 && req.points.len() != 5 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false, "message": "fan curve requires exactly 3 or 5 points"
            })),
        ));
    }
    // Fast-path: if PSU handle is absent, skip the spawn entirely.
    {
        let guard = state.psu.lock().unwrap();
        if guard.is_none() {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"ok": false, "message": "PSU not connected"})),
            ));
        }
    }
    // Fix C: move the blocking serial call off the tokio worker thread.
    let psu_arc = Arc::clone(&state.psu);
    let points = req.points;
    let result = tokio::task::spawn_blocking(move || {
        let guard = psu_arc.lock().unwrap();
        match guard.as_ref() {
            None => Err("PSU not connected".to_string()),
            Some(handle) => handle.set_fan_curve(points).map_err(|e| format!("{e}")),
        }
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "message": format!("task panic: {e}")})),
        )
    })?;

    result.map_err(|msg| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "message": msg})),
        )
    })?;
    Ok(Json(serde_json::json!({"ok": true, "action": "fan_curve"})))
}

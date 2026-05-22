use rusqlite::{params, Connection};
use std::path::Path;

use super::claude::{ClaudeLimit, ClaudeSnapshot};
use super::deepseek::DeepSeekSnapshot;
use super::mimo::MimoSnapshot;
use super::minimax::MinimaxSnapshot;
use super::zai::ZaiSnapshot;
use crate::error::AgentSenseError;

/// A single PSU power sample row: (ts_ms, ac_watts, dc_watts, temp_celsius, fan_rpm).
#[cfg(feature = "psu")]
pub type PowerSampleRow = (i64, f64, Option<f64>, Option<f64>, Option<u32>);

pub struct QuotaDb {
    conn: Connection,
}

impl QuotaDb {
    pub fn open(path: &Path) -> Result<Self, AgentSenseError> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), AgentSenseError> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS minimax_quota_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ts              INTEGER NOT NULL,
                model_name      TEXT NOT NULL,
                interval_usage  INTEGER NOT NULL,
                weekly_usage    INTEGER NOT NULL,
                interval_total  INTEGER NOT NULL,
                weekly_total    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_mmx_ts ON minimax_quota_log(ts);
            CREATE INDEX IF NOT EXISTS idx_mmx_model ON minimax_quota_log(model_name, ts);

            CREATE TABLE IF NOT EXISTS deepseek_balance_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ts              INTEGER NOT NULL,
                total_balance_cny  REAL NOT NULL,
                total_balance_usd  REAL NOT NULL,
                granted_cny        REAL NOT NULL DEFAULT 0,
                topped_up_cny      REAL NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_ds_ts ON deepseek_balance_log(ts);

            CREATE TABLE IF NOT EXISTS zai_quota_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ts              INTEGER NOT NULL,
                token_5h_pct    INTEGER NOT NULL,
                token_5h_reset  INTEGER NOT NULL DEFAULT 0,
                token_week_pct  INTEGER NOT NULL DEFAULT -1,
                token_week_reset INTEGER NOT NULL DEFAULT 0,
                mcp_month_pct   INTEGER NOT NULL,
                mcp_used        INTEGER NOT NULL DEFAULT 0,
                mcp_total       INTEGER NOT NULL DEFAULT 0,
                mcp_remaining   INTEGER NOT NULL DEFAULT 0,
                level           TEXT NOT NULL DEFAULT '',
                usage_details   TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_zai_ts ON zai_quota_log(ts);

            CREATE TABLE IF NOT EXISTS claude_quota_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ts              INTEGER NOT NULL,
                five_h_pct      INTEGER NOT NULL,
                five_h_reset    INTEGER NOT NULL DEFAULT 0,
                seven_d_pct     INTEGER NOT NULL,
                seven_d_reset   INTEGER NOT NULL DEFAULT 0,
                extra_json      TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_claude_ts ON claude_quota_log(ts);

            CREATE TABLE IF NOT EXISTS mimo_quota_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ts              INTEGER NOT NULL,
                plan_code       TEXT NOT NULL,
                plan_name       TEXT NOT NULL,
                period_end      TEXT NOT NULL DEFAULT '',
                expired         INTEGER NOT NULL DEFAULT 0,
                month_used      INTEGER NOT NULL,
                month_limit     INTEGER NOT NULL,
                month_percent   REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_mimo_ts ON mimo_quota_log(ts);
            ",
        )?;

        // power_samples table is only needed when PSU monitoring is compiled in.
        #[cfg(feature = "psu")]
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS power_samples (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      INTEGER NOT NULL,
                ac_w    REAL NOT NULL,
                dc_w    REAL,
                temp_c  REAL,
                fan_rpm INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_power_ts ON power_samples(ts);
            ",
        )?;

        Ok(())
    }

    pub fn insert_minimax(&self, snap: &MinimaxSnapshot) -> Result<(), AgentSenseError> {
        let tx = self.conn.unchecked_transaction()?;
        for m in &snap.models {
            tx.execute(
                "INSERT INTO minimax_quota_log (ts, model_name, interval_usage, weekly_usage, interval_total, weekly_total)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![snap.timestamp, m.name, m.interval_usage, m.weekly_usage, m.interval_total, m.weekly_total],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn insert_deepseek(&self, snap: &DeepSeekSnapshot) -> Result<(), AgentSenseError> {
        self.conn.execute(
            "INSERT INTO deepseek_balance_log (ts, total_balance_cny, total_balance_usd, granted_cny, topped_up_cny)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![snap.timestamp, snap.total_balance_cny, snap.total_balance_usd, snap.granted_cny, snap.topped_up_cny],
        )?;
        Ok(())
    }

    pub fn insert_zai(&self, snap: &ZaiSnapshot) -> Result<(), AgentSenseError> {
        self.conn.execute(
            "INSERT INTO zai_quota_log (ts, token_5h_pct, token_5h_reset, token_week_pct, token_week_reset, mcp_month_pct, mcp_used, mcp_total, mcp_remaining, level, usage_details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                snap.timestamp,
                snap.token_5h_pct,
                snap.token_5h_reset,
                snap.token_week_pct,
                snap.token_week_reset,
                snap.mcp_month_pct,
                snap.mcp_used,
                snap.mcp_total,
                snap.mcp_remaining,
                snap.level,
                snap.usage_details_json,
            ],
        )?;
        Ok(())
    }

    pub fn insert_claude(&self, snap: &ClaudeSnapshot) -> Result<(), AgentSenseError> {
        let extra_json = serde_json::to_string(&snap.extra).unwrap_or_else(|_| "[]".into());
        self.conn.execute(
            "INSERT INTO claude_quota_log (ts, five_h_pct, five_h_reset, seven_d_pct, seven_d_reset, extra_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                snap.timestamp,
                snap.five_h_pct,
                snap.five_h_reset,
                snap.seven_d_pct,
                snap.seven_d_reset,
                extra_json
            ],
        )?;
        Ok(())
    }

    pub fn insert_mimo(&self, snap: &MimoSnapshot) -> Result<(), AgentSenseError> {
        self.conn.execute(
            "INSERT INTO mimo_quota_log (ts, plan_code, plan_name, period_end, expired, month_used, month_limit, month_percent)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                snap.timestamp,
                snap.plan_code,
                snap.plan_name,
                snap.period_end,
                snap.expired as i32,
                snap.month_used,
                snap.month_limit,
                snap.month_percent,
            ],
        )?;
        Ok(())
    }

    fn row_to_claude(row: &rusqlite::Row) -> rusqlite::Result<ClaudeSnapshot> {
        let extra_json: String = row.get(5)?;
        let extra: Vec<ClaudeLimit> = serde_json::from_str(&extra_json).unwrap_or_default();
        Ok(ClaudeSnapshot {
            timestamp: row.get(0)?,
            five_h_pct: row.get(1)?,
            five_h_reset: row.get(2)?,
            seven_d_pct: row.get(3)?,
            seven_d_reset: row.get(4)?,
            extra,
        })
    }

    pub fn latest_claude(&self) -> Result<Option<ClaudeSnapshot>, AgentSenseError> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, five_h_pct, five_h_reset, seven_d_pct, seven_d_reset, extra_json
             FROM claude_quota_log ORDER BY ts DESC LIMIT 1",
        )?;
        let row = stmt.query_row([], Self::row_to_claude);
        match row {
            Ok(snap) => Ok(Some(snap)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AgentSenseError::Database(e.to_string())),
        }
    }

    pub fn claude_history(&self, hours: u64) -> Result<Vec<ClaudeSnapshot>, AgentSenseError> {
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - (hours as i64) * 60 * 60 * 1000;
        let mut stmt = self.conn.prepare(
            "SELECT ts, five_h_pct, five_h_reset, seven_d_pct, seven_d_reset, extra_json
             FROM claude_quota_log WHERE ts >= ?1 ORDER BY ts",
        )?;
        let rows = stmt
            .query_map(params![cutoff], Self::row_to_claude)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn latest_deepseek(&self) -> Result<Option<DeepSeekSnapshot>, AgentSenseError> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, total_balance_cny, total_balance_usd, granted_cny, topped_up_cny
             FROM deepseek_balance_log ORDER BY ts DESC LIMIT 1",
        )?;
        let row = stmt.query_row([], |row| {
            Ok(DeepSeekSnapshot {
                timestamp: row.get(0)?,
                total_balance_cny: row.get(1)?,
                total_balance_usd: row.get(2)?,
                granted_cny: row.get(3)?,
                topped_up_cny: row.get(4)?,
            })
        });
        match row {
            Ok(snap) => Ok(Some(snap)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AgentSenseError::Database(e.to_string())),
        }
    }

    pub fn latest_zai(&self) -> Result<Option<ZaiSnapshot>, AgentSenseError> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, token_5h_pct, token_5h_reset, token_week_pct, token_week_reset,
                    mcp_month_pct, mcp_used, mcp_total, mcp_remaining, level, usage_details
             FROM zai_quota_log ORDER BY ts DESC LIMIT 1",
        )?;
        let row = stmt.query_row([], |row| {
            Ok(ZaiSnapshot {
                timestamp: row.get(0)?,
                token_5h_pct: row.get(1)?,
                token_5h_reset: row.get(2)?,
                token_week_pct: row.get(3)?,
                token_week_reset: row.get(4)?,
                mcp_month_pct: row.get(5)?,
                mcp_used: row.get(6)?,
                mcp_total: row.get(7)?,
                mcp_remaining: row.get(8)?,
                level: row.get(9)?,
                usage_details_json: row.get(10)?,
            })
        });
        match row {
            Ok(snap) => Ok(Some(snap)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AgentSenseError::Database(e.to_string())),
        }
    }

    pub fn latest_mimo(&self) -> Result<Option<MimoSnapshot>, AgentSenseError> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, plan_code, plan_name, period_end, expired, month_used, month_limit, month_percent
             FROM mimo_quota_log ORDER BY ts DESC LIMIT 1",
        )?;
        let row = stmt.query_row([], |row| {
            Ok(MimoSnapshot {
                timestamp: row.get(0)?,
                plan_code: row.get(1)?,
                plan_name: row.get(2)?,
                period_end: row.get(3)?,
                expired: row.get::<_, i32>(4)? != 0,
                month_used: row.get(5)?,
                month_limit: row.get(6)?,
                month_percent: row.get(7)?,
            })
        });
        match row {
            Ok(snap) => Ok(Some(snap)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AgentSenseError::Database(e.to_string())),
        }
    }

    pub fn mimo_history(&self, hours: u64) -> Result<Vec<MimoSnapshot>, AgentSenseError> {
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - (hours as i64) * 60 * 60 * 1000;
        let mut stmt = self.conn.prepare(
            "SELECT ts, plan_code, plan_name, period_end, expired, month_used, month_limit, month_percent
             FROM mimo_quota_log WHERE ts >= ?1 ORDER BY ts",
        )?;
        let rows = stmt
            .query_map(params![cutoff], |row| {
                Ok(MimoSnapshot {
                    timestamp: row.get(0)?,
                    plan_code: row.get(1)?,
                    plan_name: row.get(2)?,
                    period_end: row.get(3)?,
                    expired: row.get::<_, i32>(4)? != 0,
                    month_used: row.get(5)?,
                    month_limit: row.get(6)?,
                    month_percent: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn latest_minimax(&self) -> Result<Vec<super::minimax::ModelQuota>, AgentSenseError> {
        let (_, models) = self.latest_minimax_with_ts()?;
        Ok(models)
    }

    pub fn latest_minimax_with_ts(
        &self,
    ) -> Result<(i64, Vec<super::minimax::ModelQuota>), AgentSenseError> {
        let max_ts: Option<i64> =
            self.conn
                .query_row("SELECT MAX(ts) FROM minimax_quota_log", [], |row| {
                    row.get(0)
                })?;
        match max_ts {
            None => Ok((0, vec![])),
            Some(ts) => {
                let mut stmt = self.conn.prepare(
                    "SELECT model_name, interval_usage, interval_total, weekly_usage, weekly_total
                     FROM minimax_quota_log WHERE ts = ?1",
                )?;
                let models = stmt
                    .query_map(params![ts], |row| {
                        Ok(super::minimax::ModelQuota {
                            name: row.get(0)?,
                            interval_usage: row.get(1)?,
                            interval_total: row.get(2)?,
                            weekly_usage: row.get(3)?,
                            weekly_total: row.get(4)?,
                            interval_end: None,
                            weekly_end: None,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok((ts, models))
            }
        }
    }

    pub fn minimax_history_24h(
        &self,
        model_name: &str,
    ) -> Result<Vec<serde_json::Value>, AgentSenseError> {
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - 24 * 60 * 60 * 1000;
        let mut stmt = self.conn.prepare(
            "WITH buckets AS (
                SELECT ts, interval_usage, interval_total, (ts / 300000) * 300000 AS bucket
                FROM minimax_quota_log
                WHERE ts >= ?1 AND model_name = ?2
            )
            SELECT MAX(ts) as ts, interval_usage, interval_total
            FROM buckets
            GROUP BY bucket
            ORDER BY bucket",
        )?;
        let rows = stmt
            .query_map(params![cutoff, model_name], |row| {
                let ts: i64 = row.get(0)?;
                let interval_usage: i64 = row.get(1)?;
                let interval_total: i64 = row.get(2)?;
                Ok(serde_json::json!({
                    "ts": ts,
                    "interval_usage": interval_usage,
                    "interval_total": interval_total,
                    "remaining": interval_total - interval_usage,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn deepseek_history(&self, hours: u64) -> Result<Vec<DeepSeekSnapshot>, AgentSenseError> {
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - (hours as i64) * 60 * 60 * 1000;
        let mut stmt = self.conn.prepare(
            "SELECT ts, total_balance_cny, total_balance_usd, granted_cny, topped_up_cny
             FROM deepseek_balance_log
             WHERE ts >= ?1
             ORDER BY ts",
        )?;
        let rows = stmt
            .query_map(params![cutoff], |row| {
                Ok(DeepSeekSnapshot {
                    timestamp: row.get(0)?,
                    total_balance_cny: row.get(1)?,
                    total_balance_usd: row.get(2)?,
                    granted_cny: row.get(3)?,
                    topped_up_cny: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn zai_history(&self, hours: u64) -> Result<Vec<ZaiSnapshot>, AgentSenseError> {
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - (hours as i64) * 60 * 60 * 1000;
        let mut stmt = self.conn.prepare(
            "SELECT ts, token_5h_pct, token_5h_reset, token_week_pct, token_week_reset,
                    mcp_month_pct, mcp_used, mcp_total, mcp_remaining, level, usage_details
             FROM zai_quota_log
             WHERE ts >= ?1
             ORDER BY ts",
        )?;
        let rows = stmt
            .query_map(params![cutoff], |row| {
                Ok(ZaiSnapshot {
                    timestamp: row.get(0)?,
                    token_5h_pct: row.get(1)?,
                    token_5h_reset: row.get(2)?,
                    token_week_pct: row.get(3)?,
                    token_week_reset: row.get(4)?,
                    mcp_month_pct: row.get(5)?,
                    mcp_used: row.get(6)?,
                    mcp_total: row.get(7)?,
                    mcp_remaining: row.get(8)?,
                    level: row.get(9)?,
                    usage_details_json: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn local_date_str(ts_ms: i64) -> String {
        let secs = ts_ms / 1000;
        let naive = chrono::DateTime::from_timestamp(secs, 0)
            .map(|dt| dt.naive_utc())
            .unwrap_or_default();
        let local: chrono::DateTime<chrono::Local> =
            chrono::TimeZone::from_local_datetime(&chrono::Local, &naive)
                .single()
                .unwrap_or_default();
        local.format("%Y-%m-%d").to_string()
    }

    pub fn compute_daily_consumption(&self, model_name: &str, date_str: &str) -> Option<i64> {
        let first: Option<i64> = self
            .conn
            .query_row(
                "SELECT weekly_usage FROM minimax_quota_log
             WHERE date(ts/1000, 'unixepoch', 'localtime') = ?1 AND model_name = ?2
             ORDER BY ts ASC LIMIT 1",
                params![date_str, model_name],
                |row| row.get(0),
            )
            .ok()?;

        let last: i64 = self
            .conn
            .query_row(
                "SELECT weekly_usage FROM minimax_quota_log
             WHERE date(ts/1000, 'unixepoch', 'localtime') = ?1 AND model_name = ?2
             ORDER BY ts DESC LIMIT 1",
                params![date_str, model_name],
                |row| row.get(0),
            )
            .ok()?;

        let delta = last - first.unwrap_or(0);
        Some(if delta < 0 { last } else { delta })
    }

    pub fn consumption_summary(&self) -> serde_json::Value {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let today_str = Self::local_date_str(now_ms);

        let (_, models) = self.latest_minimax_with_ts().unwrap_or((0, vec![]));

        let mut day = serde_json::Map::new();
        let mut week = serde_json::Map::new();
        for m in &models {
            let consumed = self.compute_daily_consumption(&m.name, &today_str);
            day.insert(m.name.clone(), serde_json::Value::from(consumed));
            week.insert(m.name.clone(), serde_json::Value::from(m.weekly_usage));
        }

        let mut weekly_bar = Vec::new();
        for i in 0..7i64 {
            let day_ts = now_ms - i * 86_400_000;
            let day_str = Self::local_date_str(day_ts);
            let consumption = self.compute_daily_consumption("MiniMax-M*", &day_str);
            weekly_bar.push(serde_json::json!({
                "date": day_str,
                "label": &day_str[5..],
                "consumption": consumption,
            }));
        }

        let weekly_refresh = self.weekly_refresh_info(now_ms);

        serde_json::json!({
            "day": day,
            "week": week,
            "weeklyBar": weekly_bar,
            "weeklyRefresh": weekly_refresh,
        })
    }

    fn weekly_refresh_info(&self, now_ms: i64) -> Option<serde_json::Value> {
        let since = now_ms - 8 * 86_400_000;
        let min_row: (i64, i64) = self
            .conn
            .query_row(
                "SELECT ts, weekly_usage FROM minimax_quota_log
             WHERE ts >= ?1 AND model_name = 'coding-plan-search'
             ORDER BY weekly_usage ASC LIMIT 1",
                params![since],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .ok()?;

        let (current_reset_ts, _) = min_row;
        let next_reset_ts = current_reset_ts + 7 * 86_400_000;
        let remaining_ms: i64 = (next_reset_ts - now_ms).max(0);

        Some(serde_json::json!({
            "currentResetTs": current_reset_ts,
            "nextResetTs": next_reset_ts,
            "remainingSeconds": remaining_ms / 1000,
            "remainingDays": (remaining_ms as f64 / 86400000.0 * 10.0).round() / 10.0,
        }))
    }

    pub fn interval_reset_info(&self, model_name: &str) -> Option<(i64, i64)> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let since = now_ms - 6 * 3_600_000;
        let min_row: (i64, i64) = self
            .conn
            .query_row(
                "SELECT ts, interval_usage FROM minimax_quota_log
             WHERE ts >= ?1 AND model_name = ?2
             ORDER BY interval_usage ASC, ts DESC LIMIT 1",
                params![since, model_name],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .ok()?;

        let (min_ts, _) = min_row;
        let next_reset_ts = min_ts + 5 * 3_600_000;
        let remaining_ms: i64 = (next_reset_ts - now_ms).max(0);
        Some((next_reset_ts, remaining_ms))
    }

    pub fn weekly_model_reset_info(&self, model_name: &str) -> Option<(i64, i64)> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let since = now_ms - 8 * 86_400_000;
        let min_row: (i64, i64) = self
            .conn
            .query_row(
                "SELECT ts, weekly_usage FROM minimax_quota_log
             WHERE ts >= ?1 AND model_name = ?2
             ORDER BY weekly_usage ASC LIMIT 1",
                params![since, model_name],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .ok()?;

        let (min_ts, _) = min_row;
        let next_reset_ts = min_ts + 7 * 86_400_000;
        let remaining_ms: i64 = (next_reset_ts - now_ms).max(0);
        Some((next_reset_ts, remaining_ms))
    }

    pub fn weekly_history(&self, model_name: &str) -> Vec<serde_json::Value> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut result = Vec::new();
        for i in 0..7i64 {
            let day_ts = now_ms - i * 86_400_000;
            let day_str = Self::local_date_str(day_ts);
            let consumption = self.compute_daily_consumption(model_name, &day_str);
            result.push(serde_json::json!({
                "date": day_str,
                "label": &day_str[5..],
                "consumption": consumption,
            }));
        }
        result
    }

    // ── PSU Power Samples ──

    #[cfg(feature = "psu")]
    pub fn insert_power_batch(&self, samples: &[PowerSampleRow]) -> Result<(), AgentSenseError> {
        if samples.is_empty() {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO power_samples (ts, ac_w, dc_w, temp_c, fan_rpm) VALUES (?1, ?2, ?3, ?4, ?5)"
            )?;
            for (ts, ac_w, dc_w, temp_c, fan_rpm) in samples {
                stmt.execute(params![ts, ac_w, dc_w, temp_c, fan_rpm])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    #[cfg(feature = "psu")]
    pub fn query_power_history(
        &self,
        since_ts: i64,
    ) -> Result<Vec<PowerSampleRow>, AgentSenseError> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, ac_w, dc_w, temp_c, fan_rpm FROM power_samples WHERE ts >= ?1 ORDER BY ts ASC"
        )?;
        let rows = stmt.query_map(params![since_ts], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get::<_, Option<u32>>(4)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AgentSenseError::Database(e.to_string()))
    }

    #[cfg(feature = "psu")]
    pub fn query_power_stats(&self, since_ts: i64) -> Result<Option<(f64, f64)>, AgentSenseError> {
        let mut stmt = self
            .conn
            .prepare("SELECT MAX(ac_w), AVG(ac_w) FROM power_samples WHERE ts >= ?1")?;
        // Fix G: bare aggregate always returns one row of (NULL, NULL) on an empty
        // window.  Read as Option<f64> so we get None instead of a type error.
        let result = stmt.query_row(params![since_ts], |row| {
            let peak: Option<f64> = row.get(0)?;
            let avg: Option<f64> = row.get(1)?;
            Ok(peak.zip(avg))
        });
        match result {
            Ok(opt) => Ok(opt),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AgentSenseError::Database(e.to_string())),
        }
    }

    #[cfg(feature = "psu")]
    pub fn compute_energy_kwh(&self, since_ts: i64) -> Result<f64, AgentSenseError> {
        let samples = self.query_power_history(since_ts)?;
        if samples.len() < 2 {
            return Ok(0.0);
        }
        // Fix H: skip trapezoid pairs that span disconnect gaps or are non-monotonic.
        const MAX_GAP_MS: i64 = 30_000;
        let mut wh = 0.0;
        for i in 1..samples.len() {
            let (ts_prev, ac_prev, ..) = samples[i - 1];
            let (ts_curr, ac_curr, ..) = samples[i];
            let dt_ms = ts_curr - ts_prev;
            if dt_ms <= 0 || dt_ms > MAX_GAP_MS {
                continue;
            }
            let dt_h = dt_ms as f64 / 3_600_000.0;
            wh += (ac_prev + ac_curr) / 2.0 * dt_h;
        }
        Ok(wh / 1000.0)
    }

    #[cfg(feature = "psu")]
    pub fn cleanup_old_samples(&self, older_than_ts: i64) -> Result<(), AgentSenseError> {
        self.conn.execute(
            "DELETE FROM power_samples WHERE ts < ?1",
            params![older_than_ts],
        )?;
        Ok(())
    }
}

#[cfg(all(test, feature = "psu"))]
mod power_tests {
    use super::*;

    fn test_db() -> QuotaDb {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test_quota.db");
        QuotaDb::open(&path).unwrap()
    }

    #[test]
    fn test_insert_and_query_power() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        let samples = vec![
            (now - 1000, 285.0, Some(260.0), Some(62.0), Some(1200)),
            (now, 290.0, Some(265.0), Some(63.0), Some(1250)),
        ];
        db.insert_power_batch(&samples).unwrap();
        let history = db.query_power_history(now - 2000).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].0, now - 1000);
    }

    #[test]
    fn test_compute_energy_kwh() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        // Simulate 1 hour of 300W using 10-second intervals (within MAX_GAP_MS).
        // 360 intervals × 10s × 300W = 1_080_000 Wms = 0.3 kWh
        let step_ms: i64 = 10_000; // 10 s, well within MAX_GAP_MS = 30_000
        let n = 361i64; // 360 intervals
        let start = now - (n - 1) * step_ms;
        let samples: Vec<_> = (0..n)
            .map(|i| (start + i * step_ms, 300.0, None, None, None))
            .collect();
        db.insert_power_batch(&samples).unwrap();
        let kwh = db.compute_energy_kwh(start - 1).unwrap();
        assert!((kwh - 0.3).abs() < 0.01, "expected ~0.3 kWh, got {kwh}");
    }

    #[test]
    fn test_power_stats() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        let samples = vec![
            (now - 2000, 200.0, None, None, None),
            (now - 1000, 400.0, None, None, None),
            (now, 300.0, None, None, None),
        ];
        db.insert_power_batch(&samples).unwrap();
        let (peak, avg) = db.query_power_stats(now - 3000).unwrap().unwrap();
        assert_eq!(peak, 400.0);
        assert!((avg - 300.0).abs() < 0.01);
    }

    #[test]
    fn test_cleanup_old_samples() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        let samples = vec![
            (now - 200_000, 100.0, None, None, None),
            (now - 100_000, 200.0, None, None, None),
            (now, 300.0, None, None, None),
        ];
        db.insert_power_batch(&samples).unwrap();
        db.cleanup_old_samples(now - 150_000).unwrap();
        let history = db.query_power_history(0).unwrap();
        assert_eq!(history.len(), 2);
    }

    // ── Fix J: boundary tests ──────────────────────────────────────────────

    /// Fix G regression: query_power_stats on an empty table (or future since_ts)
    /// must return Ok(None), not an error.
    #[test]
    fn test_power_stats_empty_table_returns_none() {
        let db = test_db();
        // Empty table — no samples at all.
        let result = db.query_power_stats(0);
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert_eq!(result.unwrap(), None, "empty table should yield None");
    }

    /// query_power_stats with a since_ts far in the future (no matching rows)
    /// must also return Ok(None).
    #[test]
    fn test_power_stats_future_since_returns_none() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        let samples = vec![
            (now - 1000, 100.0, None, None, None),
            (now, 200.0, None, None, None),
        ];
        db.insert_power_batch(&samples).unwrap();
        // since_ts is in the future — no matching rows.
        let result = db.query_power_stats(now + 10_000);
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert_eq!(result.unwrap(), None, "future window should yield None");
    }

    /// Fix H regression: a single sample has len() < 2, so energy must be 0.0.
    #[test]
    fn test_compute_energy_single_sample_returns_zero() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        db.insert_power_batch(&[(now, 300.0, None, None, None)])
            .unwrap();
        let kwh = db.compute_energy_kwh(now - 1000).unwrap();
        assert_eq!(kwh, 0.0, "single sample must return 0 kWh");
    }

    /// Fix H regression: two samples separated by > MAX_GAP_MS (30s) must NOT
    /// integrate across the gap — energy should be approximately 0.
    #[test]
    fn test_compute_energy_large_gap_skipped() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        // 5-minute gap (300_000 ms) — far exceeds MAX_GAP_MS = 30_000.
        let samples = vec![
            (now - 300_000, 300.0, None, None, None),
            (now, 300.0, None, None, None),
        ];
        db.insert_power_batch(&samples).unwrap();
        let kwh = db.compute_energy_kwh(now - 300_001).unwrap();
        // The gap pair is skipped, so no energy is integrated.
        assert_eq!(kwh, 0.0, "large gap must be skipped; got {kwh} kWh");
    }

    /// Fix H regression: duplicate or non-monotonic timestamps must not produce
    /// negative or non-finite energy.
    #[test]
    fn test_compute_energy_non_monotonic_timestamps() {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        // Insert samples out of order / with duplicates.  The DB query returns
        // them ORDER BY ts ASC, so we end up with dt_ms == 0 for the duplicate.
        let samples = vec![
            (now - 1000, 300.0, None, None, None),
            (now - 1000, 300.0, None, None, None), // duplicate timestamp
            (now, 300.0, None, None, None),
        ];
        db.insert_power_batch(&samples).unwrap();
        let kwh = db.compute_energy_kwh(now - 2000).unwrap();
        assert!(kwh >= 0.0, "energy must be non-negative; got {kwh}");
        assert!(kwh.is_finite(), "energy must be finite; got {kwh}");
    }
}

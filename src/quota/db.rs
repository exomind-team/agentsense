use rusqlite::{params, Connection};
use std::path::Path;

use super::deepseek::DeepSeekSnapshot;
use super::minimax::MinimaxSnapshot;
use super::zai::ZaiSnapshot;
use crate::error::AgentSenseError;

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
                token_week_pct  INTEGER NOT NULL,
                mcp_month_pct   INTEGER NOT NULL,
                mcp_used        INTEGER NOT NULL DEFAULT 0,
                mcp_total       INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_zai_ts ON zai_quota_log(ts);
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
            "INSERT INTO zai_quota_log (ts, token_5h_pct, token_week_pct, mcp_month_pct, mcp_used, mcp_total)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![snap.timestamp, snap.token_5h_pct, snap.token_week_pct, snap.mcp_month_pct, snap.mcp_used, snap.mcp_total],
        )?;
        Ok(())
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
            "SELECT ts, token_5h_pct, token_week_pct, mcp_month_pct, mcp_used, mcp_total
             FROM zai_quota_log ORDER BY ts DESC LIMIT 1",
        )?;
        let row = stmt.query_row([], |row| {
            Ok(ZaiSnapshot {
                timestamp: row.get(0)?,
                token_5h_pct: row.get(1)?,
                token_week_pct: row.get(2)?,
                mcp_month_pct: row.get(3)?,
                mcp_used: row.get(4)?,
                mcp_total: row.get(5)?,
            })
        });
        match row {
            Ok(snap) => Ok(Some(snap)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AgentSenseError::Database(e.to_string())),
        }
    }
}

//! Claude (Anthropic) subscription usage via the OAuth usage endpoint.
//!
//! Unlike MiniMax/DeepSeek/Z.AI which take an API key from config, Claude
//! reuses the OAuth token Claude Code already maintains in
//! `~/.claude/.credentials.json`. This endpoint is a *usage read* — it does
//! NOT consume tokens and will not trigger 429, so it is safe to poll. It is
//! the same endpoint the Claude Code client itself queries.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AgentSenseError;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

/// One named limit window beyond the primary 5h / 7d (e.g. `seven_day_sonnet`,
/// `seven_day_opus`, `extra_usage`). Only non-null windows are kept, so the
/// dashboard renders whatever the account actually exposes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeLimit {
    pub key: String,
    pub label: String,
    pub pct: i64,
    /// Epoch millis; 0 when the API returned `resets_at: null`.
    pub reset_ts: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeSnapshot {
    pub timestamp: i64,
    pub five_h_pct: i64,
    pub five_h_reset: i64,
    pub seven_d_pct: i64,
    pub seven_d_reset: i64,
    pub extra: Vec<ClaudeLimit>,
}

/// Default credentials path: `~/.claude/.credentials.json`, or an explicit
/// override from config.
pub fn credentials_path(override_path: &Option<PathBuf>) -> PathBuf {
    if let Some(p) = override_path {
        return p.clone();
    }
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join(".credentials.json")
}

#[derive(Deserialize)]
struct CredFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OauthBlock>,
}

#[derive(Deserialize)]
struct OauthBlock {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
}

/// Read the OAuth access token. Re-read on every poll so we pick up tokens
/// Claude Code refreshes in the background (we deliberately do NOT implement
/// refresh ourselves — on 401 the snapshot simply goes stale).
pub fn read_access_token(path: &Path) -> Result<String, AgentSenseError> {
    if !path.exists() {
        return Err(AgentSenseError::Config(format!(
            "Claude credentials not found: {}",
            path.display()
        )));
    }
    let raw = std::fs::read_to_string(path)?;
    let cred: CredFile = serde_json::from_str(&raw)
        .map_err(|e| AgentSenseError::Config(format!("invalid credentials.json: {e}")))?;
    cred.claude_ai_oauth
        .and_then(|o| o.access_token)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| {
            AgentSenseError::Config("credentials.json: missing claudeAiOauth.accessToken".into())
        })
}

fn parse_reset(v: Option<&serde_json::Value>) -> i64 {
    v.and_then(|x| x.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn pct_of(obj: &serde_json::Value) -> Option<i64> {
    obj.get("utilization")
        .and_then(|u| u.as_f64())
        .map(|f| f.round() as i64)
}

/// `seven_day_sonnet` -> `7d Sonnet`, `seven_day_opus` -> `7d Opus`, etc.
fn humanize(key: &str) -> String {
    if key == "extra_usage" {
        return "额外用量".to_string();
    }
    let rest = key.strip_prefix("seven_day_").unwrap_or(key);
    let titled = rest
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().chain(c).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if key.starts_with("seven_day_") {
        format!("7d {titled}")
    } else {
        titled
    }
}

pub async fn fetch(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<ClaudeSnapshot, AgentSenseError> {
    let resp = client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("anthropic-version", "2023-06-01")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    if !resp.status().is_success() {
        // 401 here means the cached token expired; caller keeps the last
        // good snapshot and the dashboard shows it as stale.
        return Err(AgentSenseError::Http(format!(
            "Claude usage HTTP {}",
            resp.status()
        )));
    }

    let body: serde_json::Value = resp.json().await?;

    let five_h = body.get("five_hour");
    let seven_d = body.get("seven_day");

    let five_h_pct = five_h.and_then(pct_of).unwrap_or(0);
    let five_h_reset = parse_reset(five_h.and_then(|o| o.get("resets_at")));
    let seven_d_pct = seven_d.and_then(pct_of).unwrap_or(0);
    let seven_d_reset = parse_reset(seven_d.and_then(|o| o.get("resets_at")));

    // Every other named window with a non-null utilization, in API order.
    let mut extra = Vec::new();
    if let Some(map) = body.as_object() {
        for (key, val) in map {
            if key == "five_hour" || key == "seven_day" || !val.is_object() {
                continue;
            }
            if let Some(pct) = pct_of(val) {
                extra.push(ClaudeLimit {
                    label: humanize(key),
                    key: key.clone(),
                    pct,
                    reset_ts: parse_reset(val.get("resets_at")),
                });
            }
        }
    }

    Ok(ClaudeSnapshot {
        timestamp: chrono::Utc::now().timestamp_millis(),
        five_h_pct,
        five_h_reset,
        seven_d_pct,
        seven_d_reset,
        extra,
    })
}

/// Convenience used by the orchestrator/poller: resolve the token from the
/// credentials file (fresh each call) then fetch.
pub async fn fetch_with_creds(
    client: &reqwest::Client,
    creds_path: &Path,
) -> Result<ClaudeSnapshot, AgentSenseError> {
    let token = read_access_token(creds_path)?;
    fetch(client, &token).await
}

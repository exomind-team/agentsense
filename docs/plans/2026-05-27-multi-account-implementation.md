# AgentSense 多账号 + UI 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple accounts per provider in AgentSense, each displayed as independent cards, plus remove the DeepSeek "赠送+充值" display.

**Architecture:** Change config from single-instance `Option<XxxConfig>` per provider to `Vec<XxxConfig>` (TOML array tables). Add `account_label` column to all DB tables. Orchestrator parallel-fetches per account. API returns arrays. Frontend renders one card per account.

**Tech Stack:** Rust, SQLite (rusqlite), TOML (toml crate), vanilla HTML/JS frontend, cargo test

**Spec:** `docs/specs/2026-05-26-multi-account-ui-fix-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config.rs` | Modify | Config structs: `Option<X>` → `Vec<X>`, add `label` field, migration logic |
| `src/quota/db.rs` | Modify | Add `account_label` column to all tables, update insert/latest methods |
| `src/quota/mod.rs` | Modify | `QuotaOrchestrator` holds Vecs, `fetch_all` returns per-account results |
| `src/server/handlers/mod.rs` | Modify | API returns arrays per provider |
| `web/index.html` | Modify | Remove granted/topped_up display; render N cards per provider |
| `tests/quota_db_tests.rs` | Modify | Add multi-account DB tests |

---

### Task 1: DeepSeek UI 修复 — 去掉赠送/充值显示

**Files:**
- Modify: `web/index.html:1905` (detail card)
- Modify: `web/index.html:2007` (overview card)

- [ ] **Step 1: 找到并删除两处 granted/topped_up 展示**

搜索 `granted_cny` 和 `topped_up_cny` 在 `web/index.html` 中的引用，删除包含这些字段的展示行（约第 1905 行和第 2007 行）。保留 `total_balance_cny` / `total_balance_usd` 的显示。Rust 侧的 `DeepSeekSnapshot` 结构体字段保留不动。

- [ ] **Step 2: 验证**

用浏览器打开 `http://localhost:7892`，确认 DeepSeek 卡片只显示总余额（如 `¥58.44`），不再显示"赠送 ¥0.00 + 充值 ¥58.44"。

- [ ] **Step 3: Commit**

```bash
cd D:\project\agentsense
git add web/index.html
git commit -m "fix(ui): remove granted/topped_up breakdown from DeepSeek card"
```

---

### Task 2: Config 结构体改为 Vec + 添加 label 字段

**Files:**
- Modify: `src/config.rs`

- [ ] **Step 1: 给每个 config struct 加 label 字段**

在 `KeyConfig`、`ZaiKeyConfig`、`MimoConfig`、`DeepSeekPlatformConfig` 中各加一行:

```rust
#[derive(Debug, Deserialize, Serialize)]
pub struct KeyConfig {
    pub label: Option<String>,
    pub api_key: Option<String>,
    pub api_key_env: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ZaiKeyConfig {
    pub label: Option<String>,
    pub auth_token: Option<String>,
    pub auth_token_env: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MimoConfig {
    pub label: Option<String>,
    pub cookie: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct DeepSeekPlatformConfig {
    pub label: Option<String>,
    pub bearer_token: Option<String>,
    pub bearer_token_env: Option<String>,
    pub cookies: Option<String>,
    pub cookies_env: Option<String>,
}
```

- [ ] **Step 2: QuotaConfig 字段改为 Vec**

```rust
#[derive(Debug, Deserialize, Serialize)]
pub struct QuotaConfig {
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    pub proxy: Option<String>,
    pub db_path: Option<PathBuf>,
    pub minimax: Vec<KeyConfig>,
    pub deepseek: Vec<KeyConfig>,
    pub zai: Vec<ZaiKeyConfig>,
    pub mimo: Vec<MimoConfig>,
    pub claude: Option<ClaudeConfig>,     // 保持单实例
    pub deepseek_platform: Vec<DeepSeekPlatformConfig>,
}
```

注意: TOML 中 `Vec<T>` 需要 `[[quota.deepseek]]` 数组表语法。`Default` 实现用空 Vec。

- [ ] **Step 3: 更新 QuotaConfig 的访问方法**

把 `minimax_key()` / `deepseek_key()` 等改为返回 `Vec<(String, Option<String>)>`（key, label 对）:

```rust
pub fn deepseek_keys(&self) -> Vec<(String, Option<String>)> {
    self.deepseek
        .iter()
        .filter_map(|c| {
            resolve_key(&c.api_key, &c.api_key_env)
                .map(|k| (k, c.label.clone()))
        })
        .collect()
}

pub fn minimax_keys(&self) -> Vec<(String, Option<String>)> {
    self.minimax
        .iter()
        .filter_map(|c| {
            resolve_key(&c.api_key, &c.api_key_env)
                .map(|k| (k, c.label.clone()))
        })
        .collect()
}

pub fn zai_tokens(&self) -> Vec<(String, Option<String>)> {
    self.zai
        .iter()
        .filter_map(|c| {
            resolve_key(&c.auth_token, &c.auth_token_env)
                .map(|t| (t, c.label.clone()))
        })
        .collect()
}

pub fn mimo_cookies(&self) -> Vec<(String, Option<String>)> {
    self.mimo
        .iter()
        .filter_map(|c| {
            c.cookie.clone()
                .filter(|s| !s.is_empty())
                .map(|v| (v, c.label.clone()))
        })
        .collect()
}

pub fn deepseek_platform_creds_list(&self) -> Vec<((String, String), Option<String>)> {
    self.deepseek_platform
        .iter()
        .filter_map(|cfg| {
            let token = resolve_key(&cfg.bearer_token, &cfg.bearer_token_env)?;
            let cookies = cfg.cookies.clone().or_else(|| {
                cfg.cookies_env.as_ref().and_then(|var| std::env::var(var).ok())
            })?;
            Some(((token, cookies), cfg.label.clone()))
        })
        .collect()
}
```

- [ ] **Step 4: 编译检查**

```bash
cd D:\project\agentsense
cargo check 2>&1
```

预期：会有编译错误（因为 `QuotaOrchestrator` 和 handlers 还在用旧方法签名）。先不管，Task 3-4 会修。

- [ ] **Step 5: Commit**

```bash
git add src/config.rs
git commit -m "refactor(config): change provider configs from Option to Vec for multi-account support"
```

---

### Task 3: 配置迁移 — 旧格式自动转换

**Files:**
- Modify: `src/config.rs`

- [ ] **Step 1: 在 `AppConfig::load` 中加迁移逻辑**

在解析 TOML 前检测旧格式（单个 table 而非 array of tables），自动转换:

```rust
impl AppConfig {
    pub fn load(path: &std::path::Path) -> Result<Self, crate::error::AgentSenseError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path)?;
        let migrated = Self::migrate_config(&content);

        let config: Self = toml::from_str(&migrated)?;

        // If migration changed the content, write back
        if migrated != content {
            let _ = std::fs::write(path, &migrated);
        }

        Ok(config)
    }

    /// Detect old single-table format and convert to array-of-tables.
    /// Old: [quota.deepseek]\napi_key = "..."
    /// New: [[quota.deepseek]]\napi_key = "..."
    fn migrate_config(content: &str) -> String {
        let mut result = content.to_string();
        for provider in ["minimax", "deepseek", "zai", "mimo", "deepseek_platform"] {
            let old_header = format!("[quota.{provider}]\n");
            let new_header = format!("[[quota.{provider}]]\n");
            // Only migrate if it's a single table header (not already array)
            if result.contains(&old_header) && !result.contains(&new_header) {
                result = result.replace(&old_header, &new_header);
            }
        }
        result
    }
}
```

- [ ] **Step 2: 写迁移测试**

在 `tests/` 目录新增或追加到现有测试文件:

```rust
#[test]
fn config_migration_single_to_array() {
    let old = r#"
[quota]
poll_interval_secs = 60

[quota.deepseek]
api_key = "sk-test123"

[quota.minimax]
api_key = "sk-minimax456"
"#;

    let migrated = agentsense::AppConfig::migrate_config(old);
    assert!(migrated.contains("[[quota.deepseek]]"), "deepseek should be array table");
    assert!(migrated.contains("[[quota.minimax]]"), "minimax should be array table");
    assert!(!migrated.contains("[quota.deepseek]\n"), "old format should be gone");

    let config: agentsense::AppConfig = toml::from_str(&migrated).unwrap();
    assert_eq!(config.quota.deepseek.len(), 1);
    assert_eq!(config.quota.deepseek[0].api_key.as_deref(), Some("sk-test123"));
    assert_eq!(config.quota.minimax.len(), 1);
}
```

- [ ] **Step 3: 运行测试**

```bash
cd D:\project\agentsense
cargo test config_migration -- --nocapture
```

预期: PASS

- [ ] **Step 4: Commit**

```bash
git add src/config.rs tests/
git commit -m "feat(config): auto-migrate old single-table format to array-of-tables"
```

---

### Task 4: DB schema 加 account_label 列

**Files:**
- Modify: `src/quota/db.rs`
- Modify: `tests/quota_db_tests.rs`

- [ ] **Step 1: init_schema 中所有表加 `account_label` 列**

在每个 CREATE TABLE 中加 `account_label TEXT NOT NULL DEFAULT ''`，并在对应字段列表中加入。同时加 ALTER TABLE 迁移（和现有的 zai 迁移同模式）:

```rust
// 在 init_schema 的 CREATE TABLE 语句中，每个表加:
// account_label TEXT NOT NULL DEFAULT ''

// 在迁移区加:
for stmt in [
    "ALTER TABLE minimax_quota_log ADD COLUMN account_label TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE deepseek_balance_log ADD COLUMN account_label TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE zai_quota_log ADD COLUMN account_label TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE claude_quota_log ADD COLUMN account_label TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE mimo_quota_log ADD COLUMN account_label TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE deepseek_platform_usage ADD COLUMN account_label TEXT NOT NULL DEFAULT ''",
] {
    let _ = self.conn.execute(stmt, []);
}
```

- [ ] **Step 2: 更新所有 insert 方法的签名和 SQL**

每个 `insert_*` 方法加 `label: &str` 参数，INSERT 语句包含 `account_label`:

```rust
pub fn insert_deepseek(&self, snap: &DeepSeekSnapshot, label: &str) -> Result<(), AgentSenseError> {
    self.conn.execute(
        "INSERT INTO deepseek_balance_log (ts, total_balance_cny, total_balance_usd, granted_cny, topped_up_cny, account_label)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![snap.timestamp, snap.total_balance_cny, snap.total_balance_usd, snap.granted_cny, snap.topped_up_cny, label],
    )?;
    Ok(())
}

// 同理更新: insert_minimax, insert_zai, insert_claude, insert_mimo, insert_deepseek_platform
// 所有 INSERT 语句加 account_label 列
```

- [ ] **Step 3: 更新所有 latest_* 查询方法**

`latest_deepseek(label)` 等方法加 label 过滤:

```rust
pub fn latest_deepseek(&self, label: &str) -> Result<Option<DeepSeekSnapshot>, AgentSenseError> {
    let mut stmt = self.conn.prepare(
        "SELECT ts, total_balance_cny, total_balance_usd, granted_cny, topped_up_cny
         FROM deepseek_balance_log WHERE account_label = ?1 ORDER BY ts DESC LIMIT 1",
    )?;
    // ... 同原来
}
```

同样更新 `latest_zai`, `latest_mimo`, `latest_claude`, `latest_minimax_with_ts`。

对于 `latest_all_by_label` 系列方法（供 handlers 调用），新增批量查询:

```rust
/// 返回所有不同 label 的最新 deepseek 快照
pub fn latest_all_deepseek(&self) -> Result<Vec<(String, Option<DeepSeekSnapshot>)>, AgentSenseError> {
    let labels: Vec<String> = self.conn
        .prepare("SELECT DISTINCT account_label FROM deepseek_balance_log")?
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();
    for label in labels {
        let snap = self.latest_deepseek(&label)?;
        results.push((label, snap));
    }
    Ok(results)
}
```

同理为每个 provider 写 `latest_all_*` 方法。

- [ ] **Step 4: 更新现有测试**

`tests/quota_db_tests.rs` 中所有 `insert_minimax` 调用加 `""` 默认 label 参数:

```rust
// 所有 db.insert_minimax(&snap) 改为:
db.insert_minimax(&snap, "").unwrap();
```

- [ ] **Step 5: 写多账号 DB 测试**

```rust
#[test]
fn multi_account_deepseek_latest_returns_per_label() {
    let db = make_db();

    let snap1 = DeepSeekSnapshot {
        timestamp: 1000,
        total_balance_cny: 50.0,
        total_balance_usd: 0.0,
        granted_cny: 0.0,
        topped_up_cny: 50.0,
    };
    let snap2 = DeepSeekSnapshot {
        timestamp: 1000,
        total_balance_cny: 30.0,
        total_balance_usd: 0.0,
        granted_cny: 0.0,
        topped_up_cny: 30.0,
    };

    db.insert_deepseek(&snap1, "主号").unwrap();
    db.insert_deepseek(&snap2, "副号").unwrap();

    let main = db.latest_deepseek("主号").unwrap().unwrap();
    assert_eq!(main.total_balance_cny, 50.0);

    let alt = db.latest_deepseek("副号").unwrap().unwrap();
    assert_eq!(alt.total_balance_cny, 30.0);
}
```

- [ ] **Step 6: 运行测试**

```bash
cd D:\project\agentsense
cargo test --lib quota_db_tests 2>&1
```

预期: 所有测试 PASS

- [ ] **Step 7: Commit**

```bash
git add src/quota/db.rs tests/quota_db_tests.rs
git commit -m "feat(db): add account_label column to all quota tables for multi-account"
```

---

### Task 5: QuotaOrchestrator 多账号并行轮询

**Files:**
- Modify: `src/quota/mod.rs`

- [ ] **Step 1: 改 QuotaOrchestrator 持有 Vec**

```rust
pub struct QuotaOrchestrator {
    client: reqwest::Client,
    db: QuotaDb,
    deepseek: Vec<(String, Option<String>)>,        // (key, label)
    minimax: Vec<(String, Option<String>)>,
    zai: Vec<(String, Option<String>)>,
    mimo: Vec<(String, Option<String>)>,
    deepseek_platform: Vec<((String, String), Option<String>)>, // ((token,cookies), label)
    claude_creds: Option<PathBuf>,
}
```

`new()` 从 `QuotaConfig` 的 `Vec` 方法读取。

- [ ] **Step 2: 改 FetchResult**

```rust
pub struct AccountResult<T> {
    pub label: Option<String>,
    pub result: Result<T, AgentSenseError>,
}

pub struct FetchResult {
    pub minimax: Vec<AccountResult<minimax::MinimaxSnapshot>>,
    pub deepseek: Vec<AccountResult<deepseek::DeepSeekSnapshot>>,
    pub zai: Vec<AccountResult<zai::ZaiSnapshot>>,
    pub claude: Option<Result<claude::ClaudeSnapshot, AgentSenseError>>,
    pub mimo: Vec<AccountResult<mimo::MimoSnapshot>>,
    pub deepseek_platform: Vec<AccountResult<deepseek_platform::DeepSeekPlatformSnapshot>>,
}
```

- [ ] **Step 3: 改 fetch_all 为多账号并行**

对每个 provider 的每个账号启动 tokio::spawn:

```rust
let ds_results: Vec<AccountResult<deepseek::DeepSeekSnapshot>> = self.deepseek
    .iter()
    .map(|(key, label)| {
        let key = key.clone();
        let label = label.clone();
        let client = self.client.clone();
        tokio::spawn(async move {
            let result = deepseek::fetch(&client, &key).await;
            AccountResult { label, result }
        })
    })
    .collect::<Vec<_>>();

// await all
let ds = ds_results.into_iter()
    .filter_map(|h| h.ok())
    .collect();
```

同理处理 minimax, zai, mimo, deepseek_platform。Claude 保持单实例。

- [ ] **Step 4: 更新 DB 写入带 label**

```rust
for r in &ds {
    if let Ok(ref snap) = r.result {
        let label = r.label.as_deref().unwrap_or("");
        let _ = self.db.insert_deepseek(snap, label);
    }
}
```

同理处理其他 provider。

- [ ] **Step 5: cargo check**

```bash
cd D:\project\agentsense
cargo check 2>&1
```

预期：handlers 编译错误（还在用旧 FetchResult），Task 6 会修。

- [ ] **Step 6: Commit**

```bash
git add src/quota/mod.rs
git commit -m "feat(orchestrator): parallel multi-account fetching with per-account labels"
```

---

### Task 6: Server handlers 适配多账号

**Files:**
- Modify: `src/server/handlers/mod.rs`
- Modify: `src/server/mod.rs` (AppState 字段)

- [ ] **Step 1: 更新 AppState**

`AppState` 中的 provider key 字段改为 Vec:

```rust
pub struct AppState {
    pub db: tokio::sync::Mutex<QuotaDb>,
    pub deepseek_keys: tokio::sync::RwLock<Vec<(String, Option<String>)>>,
    pub minimax_keys: tokio::sync::RwLock<Vec<(String, Option<String>)>>,
    // ... 同理其他
    // claude_creds 保持 Option
}
```

- [ ] **Step 2: 更新 api_all 返回数组格式**

```rust
pub async fn api_all(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    let db = state.db.lock().await;

    // DeepSeek: 多账号
    let ds_keys = state.deepseek_keys.read().await;
    let mut deepseek_accounts = Vec::new();
    for (i, (_, label)) in ds_keys.iter().enumerate() {
        let label_str = label.as_deref().unwrap_or_default();
        let balance = db.latest_deepseek(label_str).unwrap_or_default();
        let status = provider_status(true, balance.as_ref().map(|s| s.timestamp));
        deepseek_accounts.push(serde_json::json!({
            "label": label,
            "balance": balance,
            "status": status,
        }));
    }

    // 同理处理 minimax, zai, mimo, deepseek_platform
    // Claude 保持单个对象

    axum::Json(serde_json::json!({
        "deepseek": deepseek_accounts,
        "minimax": minimax_accounts,
        "zai": zai_accounts,
        "claude": { "quota": claude_quota, "status": claude_status },
        "mimo": mimo_accounts,
        "deepseek_platform": dsp_accounts,
        "_nextPoll": state.next_poll.load(Ordering::Relaxed),
    }))
}
```

- [ ] **Step 3: 更新 api_config_get/put 适配多账号**

设置页的 GET/PUT 需要处理数组而非单个值。

- [ ] **Step 4: cargo check**

```bash
cd D:\project\agentsense
cargo check 2>&1
```

预期: 编译通过（可能前端 JS 还需调整，但 Rust 侧应该无错误）

- [ ] **Step 5: Commit**

```bash
git add src/server/
git commit -m "feat(handlers): return per-account arrays in API responses for multi-account"
```

---

### Task 7: 前端多卡片渲染

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: 更新 JS 渲染逻辑**

将原来 "一个 provider 一张卡" 的渲染逻辑改为遍历 provider 数组:

```javascript
// 旧: data.deepseek.balance → 一张卡
// 新: data.deepseek → 数组，每项一张卡

function renderProviderCards(containerId, accounts, providerName, iconSrc, renderFn) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (const acct of accounts) {
        const card = document.createElement('div');
        card.className = 'provider-card';
        const title = acct.label || providerName;
        card.innerHTML = renderFn(acct, title, iconSrc);
        container.appendChild(card);
    }
}
```

DeepSeek 渲染函数:
```javascript
function renderDeepseekCard(acct, title, iconSrc) {
    const bal = acct.balance;
    const cny = bal ? '¥' + bal.total_balance_cny.toFixed(2) : '?';
    return `
        <div class="card-header">
            <img src="${iconSrc}" class="provider-icon">
            <span class="provider-title">${title}</span>
        </div>
        <div class="balance">${cny}</div>
    `;
}
```

同理处理 minimax, zai, mimo 等。Claude 保持单卡片（不走数组）。

- [ ] **Step 2: 验证**

启动 agentsense (`cargo build --release --bin agentsense && ./target/release/agentsense.exe serve`)，浏览器打开 `http://localhost:7892`:
1. 如果只有一个账号，显示和之前一样
2. 确认 DeepSeek 卡片无赠送/充值行
3. 如果配置了多账号，确认每个账号各一张独立卡片

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(ui): render independent cards per provider account"
```

---

### Task 8: 端到端构建测试

- [ ] **Step 1: 完整构建**

```bash
cd D:\project\agentsense
cargo build --release --bin agentsense 2>&1
```

预期: 编译成功，无 error。

- [ ] **Step 2: 运行所有测试**

```bash
cargo test 2>&1
```

预期: 所有测试 PASS。

- [ ] **Step 3: 手动迁移验证**

备份现有 `config.toml`，启动 agentsense，确认:
1. 旧格式自动迁移为新格式（`[quota.deepseek]` → `[[quota.deepseek]]`）
2. 迁移后 config.toml 写回磁盘
3. 单账号配置功能正常（卡片正确显示余额）
4. DB 中 account_label 列正确填充

- [ ] **Step 4: Commit 最终状态**

```bash
git add -A
git commit -m "feat: multi-account support with independent cards (A+B complete)"
```

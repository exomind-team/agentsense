# AgentSense 多账号 + UI 修复设计

日期: 2026-05-26

## 范围

- **A. UI 修复**: DeepSeek 卡片去掉 "赠送 ¥0.00 + 充值 ¥58.44" 明细行
- **B. 多账号配置层**: 同一 provider 支持多个账号，各自独立卡片展示

C (sub2api 集成) 和 D (消费归属追踪) 不在本范围。

## A. DeepSeek 卡片 UI 修复

`web/index.html` 中搜索 `granted_cny` 和 `topped_up_cny`，删除两处展示行:

- 约第 1905 行: 详细卡片中的赠送/充值明细
- 约第 2007 行: 概览卡片中的赠送/充值明细

卡片只保留总余额 `¥XX.XX`，不显示余额构成。

`DeepSeekSnapshot` 结构体中 `granted_cny` 和 `topped_up_cny` 字段保留（不影响 Rust 侧），仅前端不展示。

## B. 多账号配置层

### B.1 配置格式

TOML 数组表，一次性迁移。每个 provider 用 `[[quota.xxx]]` 声明一个或多个账号:

```toml
[[quota.deepseek]]
label = "主号"
api_key = "sk-11f1..."

[[quota.minimax]]
label = "国内"
api_key = "sk-cp-..."

[[quota.minimax]]
label = "国际"
api_key = "sk-cp-..."

[[quota.zai]]
auth_token = "3003e6..."

[[quota.mimo]]
cookie = '...'

[[quota.deepseek_platform]]
bearer_token = "..."
cookies = "..."

[quota.claude]    # Claude 保持单实例 (OAuth 凭证)
enabled = true
```

每个 config 结构加可选 `label` 字段，用于卡片标题区分。无 label 时回退到 provider 名。

### B.2 Rust 侧改动

#### config.rs

- `QuotaConfig` 中 `deepseek: Option<KeyConfig>` → `deepseek: Vec<KeyConfig>`
- 同理 minimax, zai, mimo, deepseek_platform
- `claude` 保持 `Option<ClaudeConfig>` 不变
- 每个 config struct (`KeyConfig`, `ZaiKeyConfig`, `MimoConfig`, `DeepSeekPlatformConfig`) 加 `label: Option<String>`
- 访问方法 (如 `deepseek_key()`) 改为 `deepseek_keys() -> Vec<(String, Option<String>)>` 返回 `(key, label)` 对

#### quota/mod.rs

- `QuotaOrchestrator` 持有 `Vec<(String, Option<String>)>` 而非单个 `Option<String>`
- `FetchResult` 中每个 provider 从 `Option<Result<...>>` 变为 `Vec<(Option<String>, Result<...>)>` (label + result)
- `fetch_all()` 对每个 provider 的所有账号并行轮询 (tokio::spawn per account)
- DB 写入时带上 label

#### quota/db.rs

- 每个 provider 的 snapshot 表加 `account_label TEXT NOT NULL DEFAULT ''`
- `insert_*` / `latest_*` 函数签名加 `label: &str` 参数
- 查询按 label 分组，最新记录取每个 label 的一条

#### server/handlers/mod.rs

- `api_all()` 返回 JSON 中每个 provider 变为数组:
  ```json
  {
    "deepseek": [
      { "label": "主号", "balance": {...}, "status": {...} }
    ],
    "minimax": [
      { "label": "国内", "models": [...], "status": {...} },
      { "label": "国际", "models": [...], "status": {...} }
    ]
  }
  ```
- 设置页 `api_config_get` / `api_config_put` 适配多账号

### B.3 前端改动

- Provider 卡片渲染从 "一个 provider 一张卡" 改为遍历 provider 数组，每个账号一张卡
- 卡片标题: 有 label 时显示 `Provider label`，无 label 时显示 `Provider`
- 图标: 同 provider 共用同一个图标

### B.4 迁移

启动时检测旧格式 (`[quota.deepseek]` 非 `[[quota.deepseek]]`)，自动转成单条目数组表，写回 config.toml。用户无需手动修改。

### B.5 测试

- 单元测试: config 解析旧格式 → 自动迁移 → 新格式序列化
- 单元测试: 多账号 fetch_all 并行 + DB 按 label 存储/查询
- 手动验证: 两个 minimax 账号各一张卡，余额独立显示
- 手动验证: 旧 config.toml 自动迁移后正常工作

# AgentSense 项目协作规则

## 当前分支重点

- `ExoSense` 是个人作战仪表盘 demo 改造分支，保留原 Rust 服务能力，同时用 `local-usage-proxy.mjs` 承接本地多源聚合页面。
- demo 页面入口是 `http://127.0.0.1:7894/`，核心接口是 `/api/command-demo`。
- Node demo 同时提供分层只读接口：`/api/sources`、`/api/signals`、`/api/datasets`、`/api/datasets/:id`、`/api/semantic-projection`。
- 当前 demo 是过渡实现；正式方向见 `docs/specs/2026-06-08-unified-agent-api-dashboard-model.md`。

## 安全边界

- 不提交真实 token、API key、cookie、Authorization header 或网页登录态。
- 本地凭据只放 `.agentsense.local.env` 或运行环境变量；该文件必须保持 ignored。
- Codex / Claude Code / CC Switch 本地源只读聚合字段，不读或展示 prompt、response、preview、title、summary 正文。
- Codex 本地源没有可靠成本字段时必须显示成本未知或 `--`，不得渲染成 `$0.00`。

## 常用验证

```powershell
cargo check --no-default-features --features pure-rust
node --check local-usage-proxy.mjs
node --check web\app.js
node --test tests\local-usage-proxy.test.mjs
node --test tests\web-command-trend.test.mjs
Invoke-WebRequest http://127.0.0.1:7894/ -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:7894/api/command-demo
Invoke-RestMethod http://127.0.0.1:7894/api/sources
Invoke-RestMethod "http://127.0.0.1:7894/api/signals?source=sub2api-main&role=available"
Invoke-RestMethod http://127.0.0.1:7894/api/datasets
Invoke-RestMethod http://127.0.0.1:7894/api/semantic-projection
# 系统信息 API
Invoke-RestMethod http://127.0.0.1:7894/api/system/info
Invoke-RestMethod http://127.0.0.1:7894/api/system/cpu
Invoke-RestMethod http://127.0.0.1:7894/api/system/memory
Invoke-RestMethod http://127.0.0.1:7894/api/system/disk
Invoke-RestMethod http://127.0.0.1:7894/api/system/network
```

## 呈现约束

- 个人仪表盘重读轻写，默认只做态势观察和配置展示。
- 模型与工作区排行默认跨来源混排，来源作为徽标、过滤器或排序模式，不作为默认分组。
- 趋势图必须先按量纲分组；成本、Token、请求数、额度、余额、百分比不要硬塞进同一 y 轴。
- 工作区、模型排行这类密集表格优先完整宽度承载；窄屏时在表格容器内滚动，不能撑出页面或裁掉右侧列。

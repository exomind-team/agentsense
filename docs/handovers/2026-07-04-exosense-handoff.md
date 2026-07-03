# ExoSense 分支交接记录 2026-07-04

本文用于让下一位 Agent 从当前 `ExoSense` 分支继续接手，不需要重读完整会话。

## 当前基线

- 仓库：`H:/A137442/Develop/AI/agentsense`
- 分支：`ExoSense`
- 远端：`origin https://github.com/exomind-team/agentsense.git`
- 本次交接前基线提交：`544b16d fix: improve semantic trend chart visualization`
- 主入口：`http://127.0.0.1:7894/`
- demo 主接口：`GET /api/command-demo`
- 分层只读接口：
  - `GET /api/sources`
  - `GET /api/signals`
  - `GET /api/datasets`
  - `GET /api/datasets/:id`
  - `GET /api/semantic-projection`

## 目标认知

当前项目不是普通 API 额度页，而是“重读轻写”的个人作战态势仪表盘。

核心方向：

- 汇总本地 Agent、API 中转、系统设备、后续工作流等多类感知通道。
- 先观察与解释，不做高风险写操作。
- 前端呈现要像结构化仪表盘，而不是死卡片堆砌。
- 数据模型要从平铺 `signals[]` 逐步升级为可观测对象图谱。
- 缺失本身也要可观测：未配置、鉴权失败、无数据、未映射、被过滤不能混成“卡片消失”。

## 当前已落地能力

### Node demo 聚合层

核心文件：`local-usage-proxy.mjs`

它目前负责：

- 读取 `.agentsense.local.env` 中的本地配置。
- 默认监听 `AGENTSENSE_PROXY_PORT`，未配置时为 `7894`。
- 代理旧 Rust AgentSense API 到 `http://127.0.0.1:7892`。
- 直接聚合本地与远端数据源，生成 `/api/command-demo`。
- 暴露 source / signal / dataset / semantic projection 分层只读接口。

### 已接入数据源

| 来源 | 当前状态 | 数据类型 | 备注 |
|---|---|---|---|
| Claude Code 本地 | 已接入 | `.claude.json` 聚合项目、模型、成本、Token | 只读聚合字段，不读 prompt/response 正文 |
| Codex 本地 | 已接入 | `.codex/state_5.sqlite` 会话、工作区、模型/provider 组合 | 成本通常未知，不能显示为 `$0.00` |
| CC Switch | 已接入 | `.cc-switch/cc-switch.db` 代理请求、模型、成本、Token、趋势 | 已有 6h/1d/7d 模型趋势 |
| NewAPI | 已接入 | 用户额度、token/usage、日志聚合、模型统计 | 凭据来自本地 env，不提交 |
| Sub2API | 已接入 | `/v1/usage` key 级余额、今日/累计用量、模型统计 | 使用模型 API Key，而非 PAT |
| 系统信息 | 部分接入 | CPU、内存、磁盘、网络、电池占位 | Rust handler 已有；Node command-demo 仍有端口耦合问题 |
| MiniMax/DeepSeek/GLM/Z.AI/MiMo/Claude 订阅配额旧 Provider | 代码仍在旧系统 | `/api/all` 与旧 tab | 新态势台尚未完整注册为统一 source |

### 前端呈现

核心文件：`web/app.js`、`web/style.css`、`web/index.html`

目前已经有：

- command dashboard 页面。
- 感知通道/能力矩阵。
- 中转专区。
- 工作区消耗 Top 表格。
- 多源模型聚合视图。
- 模型 Token / 成本趋势，支持 `6h / 1d / 7d`。
- 语义趋势视图模式：`absolute / focused / delta / normalized`。
- 按来源看与按类型看中转站指标的切换。
- 对 unknown、reported zero、derived、planned 的证据区分。

## 重要配置与安全边界

本地凭据只允许放在 `.agentsense.local.env` 或系统环境变量里。该文件已被 `.gitignore` 忽略，不要提交。

常用环境变量名：

```text
AGENTSENSE_PROXY_PORT
AGENTSENSE_NEWAPI_BASE_URL
AGENTSENSE_NEWAPI_TOKEN
AGENTSENSE_NEWAPI_USER_ID
AGENTSENSE_NEWAPI_LABEL
AGENTSENSE_SUB2API_BASE_URL
AGENTSENSE_SUB2API_API_KEY
AGENTSENSE_SUB2API_KEY
AGENTSENSE_SUB2API_LABEL
```

安全要求：

- 不提交真实 token、API key、cookie、Authorization header。
- 不提交 `.agentsense.local.env`、本地 config、quota db、日志、`target/`。
- Codex 成本未知时显示 unknown 或 `--`，不要转成 0。
- NewAPI 的 quota/额度与 Sub2API 的 USD 成本不能强行混成同一语义。
- unknown 不能按 0 参与聚合；reported zero 是接口报告的 0，二者不同。

## 当前运行方式

推荐本地验证至少启动 Node demo：

```powershell
cd H:/A137442/Develop/AI/agentsense
node local-usage-proxy.mjs
```

打开：

```text
http://127.0.0.1:7894/
```

如果要验证旧 Rust API 与旧 Provider，可另开终端启动 Rust 服务：

```powershell
cargo run --no-default-features --features pure-rust -- serve --port 7892
```

注意：`start_server.ps1` 仍指向旧路径 `D:\project\agentsense\.worktrees\fix-4issues` 和旧端口语境，不能作为当前 ExoSense 的可信启动脚本。

系统信息有一个需要后续统一的细节：

- Rust route 已有 `/api/system/info`、`/api/system/cpu`、`/api/system/memory`、`/api/system/disk`、`/api/system/network`、`/api/system/battery`。
- Node 代理会把普通 `/api/...` 转发到 `7892`。
- 但 `local-usage-proxy.mjs` 内部 `systemInfo()` 当前硬编码请求 `http://127.0.0.1:7895/api/system/info`。
- 因此只启动 7892 + 7894 时，浏览器直访 `/api/system/info` 可以经代理工作，但 `/api/command-demo` 内的系统 source 可能仍显示不可用。下一步应改成走 `upstream` 或可配置端口。

## 当前测试与验证入口

仓库 AGENTS 推荐命令：

```powershell
cargo check --no-default-features --features pure-rust
node --check local-usage-proxy.mjs
node --check web\app.js
node --test tests\local-usage-proxy.test.mjs
node --test tests\web-command-trend.test.mjs
```

接口验证：

```powershell
Invoke-WebRequest http://127.0.0.1:7894/ -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:7894/api/command-demo
Invoke-RestMethod http://127.0.0.1:7894/api/sources
Invoke-RestMethod "http://127.0.0.1:7894/api/signals?source=sub2api-main&role=available"
Invoke-RestMethod http://127.0.0.1:7894/api/datasets
Invoke-RestMethod http://127.0.0.1:7894/api/semantic-projection
```

## 已知问题与下一步重点

### 1. 语义趋势仍有重复或伪指标

用户已经观察到：

- “工作区数 · 已用 · 瞬时 · 工作区”
- “工作区数量 · 已用 · 瞬时 · 工作区”
- “会话 · 已用 · 累计 · 工作区”
- “记录 · 已用 · 累计 · 工作区”
- “模型数 · 已用 · 累计 · 工作区”

这些图可能数值相同、曲线相同，说明自动派生层仍过度暴露 count/evidence 类指标。下一步要把“证据指标”“库存指标”“消耗指标”分开，不要把 record/session/model_count 都当成同等趋势图。

### 2. 表格型数据还没有完全升级为对象图谱

现在已有 `dataset-row semantic adapter` 的试点，但整体仍偏过渡。

理想结构应是：

```text
来源
  账户 / key
    模型
      时间窗口
        token / cost / request / quota / balance
    工作区
      会话
        token / cost / request
```

下一步不应继续堆专用图，而是要让 NewAPI、Sub2API、Codex、Claude Code、CC Switch 的模型行和工作区行转成统一 `ObservableSubject` 与 `SemanticMetric`。

### 3. 系统信息源还有一块没完全进入主面板

CPU、内存、磁盘、网络、电池这类电脑系统本身的信息，是用户明确要求补齐的大块信息源。

当前 Rust handler 已有，Node command-demo 也有 system-info source 和 CPU/内存/uptime signal 的雏形，但：

- 端口关系需要统一。
- 磁盘、网络、电池还没有充分转成前端可用语义趋势。
- 网络速度目前更像瞬时计数，不是稳定吞吐趋势。

### 4. 模型维度需要跨来源合并，而不是只按来源分组

用户明确希望 GPT 5.5 等同名/同类模型能跨 NewAPI、Sub2API、Codex、CC Switch 混排与横向对比。

已有方向：

- `config/translation-rules.json` 定义了模型行翻译规则。
- `web/app.js` 里有前端镜像规则与 `buildUnifiedCommandModelRows()`。

后续需要把翻译层向后端/共享配置收束，减少前后端规则重复。

### 5. 趋势图要按量纲和语义分组

已达成共识：

- USD 成本独立。
- Token 独立。
- request/count 独立。
- quota/余额/额度要区分“已用”“可用”“容量”。
- 高位慢波动适合 `focused` 或 `delta`，不能一律从 0 画绝对值。

下一步应继续减少“看起来有图、实际上无信息”的趋势图。

## 推荐下一步切片

1. 修 `systemInfo()` 端口耦合：改成复用 `upstream` 或新增 `AGENTSENSE_SYSTEM_INFO_BASE_URL`。
2. 把 CPU、内存、磁盘、网络、电池转成统一 subject/metric，并在前端按 percent、bytes、bps 分图。
3. 清理语义趋势派生：对 evidence/count/inventory 类指标设置更严格的 widget eligibility。
4. 将前端 `TRANSLATION_RULES` 与 `config/translation-rules.json` 的重复规则收束，避免两套语义漂移。
5. 推进对象图谱：先从 model 与 workspace 两类行级事实开始。
6. 用真实 `/api/command-demo` 输出回归验证，禁止硬编码“谁是 Top 1”。

## 相关文档索引

- `AGENTS.md`：当前分支协作规则与常用验证命令。
- `docs/specs/2026-06-08-unified-agent-api-dashboard-model.md`：统一数据模型与可编排呈现主规格。
- `docs/specs/2026-06-09-data-observation-taxonomy.md`：数据观察分类法、趋势视图原则、重构约束。
- `docs/specs/2026-06-10-exosense-intent-driven-dashboard.md`：意图驱动仪表盘、对象图谱、翻译层方案。
- `docs/examples/agentsense.sources.example.toml`：可迁移 source 配置样例。
- `docs/examples/dashboard.layout.example.yaml`：dashboard layout 配置样例。

## 接手前快速检查

```powershell
git status --short --branch
git branch -vv
git log --oneline --decorate -n 8
git status --short --ignored
```

期望：

- 工作区不应有意外已跟踪敏感文件。
- `.agentsense.local.env` 应仍是 ignored。
- `ExoSense` 应能推送到 `origin/ExoSense`。

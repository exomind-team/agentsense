# AgentSense

> **ExoMind 感知基础设施** — 纯 Rust 优先的文档解析、搜索聚合、视觉理解库

[![Crates.io](https://img.shields.io/crates/v/agentsense?style=flat-square)](https://crates.io/crates/agentsense)
[![Docs.rs](https://img.shields.io/docsrs/agentsense?style=flat-square)](https://docs.rs/agentsense)
[![CI](https://img.shields.io/github/actions/workflow/status/exomind-team/agentsense/ci.yml?style=flat-square)](https://github.com/exomind-team/agentsense/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

AgentSense 是 ExoMind 生命框架的**感知系统**，为 AI Agent 提供统一的文档阅读、搜索聚合和视觉理解能力。作为一个本地优先的常驻 HTTP 服务（通过 MCP 协议），它让 Agent 只需一个入口就能访问所有感知能力。

## 设计原则

| 原则 | 说明 |
|------|------|
| **被动管道** | 只执行查询和返回原始结果，分析判断交给 Agent |
| **纯 Rust 优先** | 零外部 C 依赖，单 binary 跨平台部署 |
| **测试驱动** | 每个功能从失败测试开始，100% 测试覆盖目标 |

## 当前能力

- [x] **PDF 解析** — 打开、7字段元数据、全文/按页文本、图片列表/提取、双引擎
- [x] **错误处理** — FileNotFound、InvalidPdf、Encrypted + Display/Debug
- [x] **图片提取** — list_images() 元数据 + extract_image() 原始字节
- [x] **配额监控** — MiniMax/DeepSeek/Z.AI 实时额度查询 + SQLite 持久化
- [x] **CLI** — `agentsense quota [--watch]` 终端仪表盘
- [x] **个人作战仪表盘 demo** — 本地 Claude Code/Codex/CC Switch/NewAPI/Sub2API 聚合态势页
- [ ] EPUB 解析 — 章节读取、格式转换
- [ ] 搜索聚合 — 30+ 平台统一搜索（抖音/小红书/知乎/B站/微信）

### 测试覆盖（25 测试，全绿）

| 类别 | 测试数 |
|------|--------|
| 基础操作 | 3 (open, metadata, text) |
| 错误处理 | 2 (file not found, invalid PDF) |
| 扩展元数据 | 1 (7 字段 + 页面尺寸) |
| 引擎选择 | 2 (Lopdf + PdfsinkRs) |
| 按页读取 | 3 (content, bounds, PdfsinkRs) |
| 图片提取 | 5 (list, empty, extract, bounds, multi) |
| 跨引擎 | 2 (PdfsinkRs text, read_page) |
| 元数据回退 | 1 (PdfsinkRs via lopdf) |
| 格式/特性 | 4 (size, traits, Debug×2) |
| 一致性 | 2 (full vs page, error display) |

### 已解决遗留问题

| # | 问题 | 结果 |
|---|------|------|
| 1 | pdf-extract 字体 stderr | 😴 cosmetic |
| 2 | 蓝江 PDF 解析失败 | ❌ 文件损坏（两个引擎均失败） |
| 3 | `doc.read_page(n)` | ✅ TDD 完成 |
| 4 | `doc.extract_image()` | ✅ TDD 完成 |
| 5 | PdfsinkRs 元数据 | ✅ lopdf best-effort fallback |
| 6 | poppler-rs | ✅ feature flag 骨架就位 |

## 快速开始

```rust
use agentsense::PdfDocument;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let doc = PdfDocument::open("paper.pdf")?;

    // 文档信息
    let info = doc.info();
    println!("Title: {:?}", info.title());
    println!("Pages: {}", info.page_count());

    // 提取文本
    let text = doc.text()?;
    println!("{}", &text[..200]);

    Ok(())
}
```

## 开发

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 克隆
git clone https://github.com/exomind-team/agentsense.git
cd agentsense

# 测试（TDD：先写测试，再看失败，最小实现）
cargo test

# 编译
cargo build --release
```

## 个人仪表盘 Demo

魔改分支 `ExoSense` 保留原 Rust 服务，同时用 `local-usage-proxy.mjs` 提供本地聚合 demo：

- 页面入口：`http://127.0.0.1:7894/`
- demo API：`/api/command-demo`
- 分层只读 API：`/api/sources`、`/api/signals`、`/api/datasets`、`/api/datasets/:id`、`/api/semantic-projection`
- 本地来源：Claude Code `.claude.json` 聚合、Codex `.codex/state_5.sqlite` 白名单字段、CC Switch `.cc-switch/cc-switch.db` 聚合字段。
- 远端来源：NewAPI 与 Sub2API 通过显式环境变量或 `.agentsense.local.env` 接入。
- 展示重点：多源模型消耗混排、多源工作区 Token 排行、模型 Token/成本趋势、按量纲拆分的采样趋势、NewAPI/Sub2API 中转专区趋势。
- 观察契约：`/api/sources` 暴露来源与感知通道能力矩阵，`/api/signals` 支持按来源、单位、语义角色等筛选，`/api/datasets` 暴露结构化数据集目录，`/api/semantic-projection` 暴露“信息获取、数据表征、综合聚合、面板呈现”四层投影。
- 设计规格：`docs/specs/2026-06-10-exosense-intent-driven-dashboard.md` 说明从“意图缺口”到“Widget 候选”和“Presentation Blueprint”的受控派生流程。
- 密集排行表优先完整宽度承载；窄屏时只在表格容器内滚动，避免裁掉右侧来源/记录列。

本地凭据只放在 `.agentsense.local.env` 或环境变量里，该文件已被 `.gitignore` 排除。提交物只应记录变量名和 `secret_ref`，不能写入真实 token、API key、cookie 或 Authorization header。

可选环境变量：

| 变量 | 用途 |
|------|------|
| `AGENTSENSE_PROXY_PORT` | Node demo 代理端口，默认 `7894`。 |
| `AGENTSENSE_NEWAPI_BASE_URL` | NewAPI 实例地址。 |
| `AGENTSENSE_NEWAPI_TOKEN` | NewAPI 个人访问令牌或兼容 API key。 |
| `AGENTSENSE_NEWAPI_USER_ID` | 使用个人访问令牌读取用户级额度时的 user id。 |
| `AGENTSENSE_SUB2API_BASE_URL` | Sub2API 实例地址。 |
| `AGENTSENSE_SUB2API_API_KEY` | Sub2API 模型 API key，用于 key 级 usage 查询。 |

Codex 本地源当前只读 `.codex/state_5.sqlite` 的 token、模型、provider、cwd 和时间字段；没有可靠成本字段，所以页面必须显示成本未知或 `--`，不能把未知成本渲染为 `$0.00`。

```bash
# 原 Rust 服务仍可独立验证
cargo check --no-default-features --features pure-rust

# Node 代理读取 .agentsense.local.env 后提供 demo 页面
$env:AGENTSENSE_PROXY_PORT = "7894"
node local-usage-proxy.mjs

# Demo 聚合与趋势派生测试
node --test tests\local-usage-proxy.test.mjs
node --test tests\web-command-trend.test.mjs
```

## 架构

```
agentsense/
├── src/
│   ├── lib.rs          # 公开 API（PdfDocument）
│   ├── types.rs        # 核心类型（DocumentInfo）
│   └── error.rs        # 错误类型（AgentSenseError）
├── tests/
│   └── pdf_tests.rs    # 集成测试（TDD）
└── Cargo.toml
```

未来扩展：
- `src/engine/` — PdfEngine trait + 多后端（lopdf / poppler-rs）
- `src/search/` — SearchActor（搜索聚合）
- `src/vision/` — VLMActor（视觉理解）
- `src/server/` — MCP HTTP 服务

## 许可证

MIT © HailayLin & ExoMind Team

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

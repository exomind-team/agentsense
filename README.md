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

- [x] **PDF 解析** — 打开文档、元数据(7字段)、文本提取、双引擎(Lopdf/PdfsinkRs)
- [x] **错误处理** — 文件不存在、无效PDF、加密检测
- [x] **配额监控** — MiniMax/DeepSeek/Z.AI 实时额度查询 + SQLite 持久化
- [x] **CLI** — `agentsense quota [--watch]` 终端仪表盘
- [ ] EPUB 解析 — 章节读取、格式转换
- [ ] 图片提取 — PDF 内嵌图片 + VLM 自动描述
- [ ] 搜索聚合 — 30+ 平台统一搜索（抖音/小红书/知乎/B站/微信）

### 已知遗留问题

| # | 问题 | 状态 |
|---|------|------|
| 1 | pdf-extract 非标准字体 stderr 警告 | 待静默 |
| 2 | 蓝江 PDF `Invalid file trailer` — 需用 lopdf 0.40 重测 | 待验证 |
| 3 | 按页读取 `doc.read_page(n)` | 未实现 |
| 4 | 图片提取 `doc.extract_image(page, idx)` | 未实现 |
| 5 | PdfsinkRs 引擎元数据为 None（0.2 不暴露 info dict） | 已知限制 |
| 6 | poppler-rs feature flag（需 poppler C 库） | 未实现 |

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

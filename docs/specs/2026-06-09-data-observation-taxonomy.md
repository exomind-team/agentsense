# 个人作战仪表盘数据观察报告与分类法 v0.3

日期: 2026-06-09

状态: 已落盘观察报告 + 分类法基石 + 呈现重构约束

适用仓库: AgentSense 魔改分支 `dev-improve-2026-06-08`

关联文档:

- `docs/specs/2026-06-08-unified-agent-api-dashboard-model.md`
- `docs/specs/2026-06-08-personal-agent-usage-dashboard.md`

## 一句话结论

AgentSense 现在已经能从 Claude Code、Codex、CC Switch、NewAPI、Sub2API 等来源读到真实聚合数据。下一步不能继续按“来源卡片”堆 UI，而要把所有观测数据先归入统一分类法，再由呈现层按数据本质选择卡片、趋势图、排行表、状态矩阵或审计明细。

本报告把分类法拆成两层:

1. **内涵分类**: 解决“它本质上是什么数据”。
2. **外延扩展**: 解决“这种数据可以落到哪些具体业务对象上”。

这两个层次的关系不是并列 taxonomy，而是组合关系:

```text
具体指标 = 内涵属性组合 + 外延业务对象 + 来源证据
```

例如:

```text
Sub2API 今日 token =
  对象: API key / 中转站
  语义角色: 已用消耗
  时间行为: 窗口
  单位: token
  聚合方式: sum
  证据质量: 接口报告已知
```

这比“它属于 Sub2API 区域”更有解释力，也能指导前端把不同来源的数据放进同一种图表或表格里。

## 本轮定稿摘要

本轮讨论后的关键收束是: **先分类，再呈现；先解释数据本质，再决定它属于哪个面板**。

后续重构不应从“NewAPI 卡片”“Sub2API 卡片”“Codex 卡片”开始，而应从三步判断开始:

1. 这个观测值的内涵是什么: 健康、余量、已用、窗口、速率、趋势、排行，还是证据。
2. 这个观测值落在哪个外延对象上: API 中转站、Agent 应用、模型、工作区、账户/key、设备，还是呈现组件。
3. 这个观测值应该由哪个受控 widget 承载: 状态矩阵、余量卡片、趋势图、排行表、审计表，还是中转专区。

由此得到 V0 的重构基石:

| 基石 | 决议 | 直接影响 |
|---|---|---|
| 数据模型 | Signal/Dataset 必须携带语义元数据。 | 前端不再靠字段名和来源名猜测含义。 |
| 聚合方式 | 同语义、同单位、同对象才可以合并。 | 模型可跨来源混排，工作区只纳入有工作区证据的来源。 |
| 趋势呈现 | 趋势必须按单位和语义拆图。 | USD、token、count、percent 分开呈现，避免平线和混轴。 |
| 余量/已用 | 可用余额、总额度、已用成本、今日消耗分离。 | 中转专区不再出现“额度/余额 USD/USD”这类混合标签。 |
| 证据质量 | `unknown`、`reported_zero`、`derived`、`planned` 必须可见。 | Codex 成本未知不会被当作 0，接口报告 0 也不会被误判为缺失。 |
| 前端边界 | 做受控 widget registry，不做完整 BI。 | 允许配置窗口、排序、来源过滤、折叠明细，但暂不做任意公式和拖拽 builder。 |

这份文档后续应作为两类工作的前置输入:

- **改数据契约前**: 先检查新增字段能否落入 `metric_role + time_behavior + unit + subject_type + aggregation + knownness`。
- **改前端面板前**: 先检查新增组件是否属于受控 widget registry，是否会混淆已用/可用、不同量纲或未知/零值。

## 使用约定

从 v0.3 开始，本文不再只是调研记录，而是后续数据呈现重构的准入基线。任何会影响常驻面板的信息源、指标、数据集或 widget，都应先经过本文的分类法检查。

最小准入规则:

| 变更类型 | 进入实现前必须说明 | 不满足时的处理 |
|---|---|---|
| 新增 source adapter | 它提供哪些观测对象、哪些字段是事实、哪些字段是推导、secret 如何引用。 | 只能作为 planned source 或审计明细，不进入主面板。 |
| 新增 Signal | 必须填清 `metric_role`、`time_behavior`、`unit`、`subject_type`、`aggregation`、`knownness`。 | 不进入聚合和趋势图，避免 UI 继续猜字段含义。 |
| 新增 Dataset | 必须说明每一行的 `rows_subject_type`、主指标语义、可排序字段、可分组字段。 | 只能作为调试表，不进入跨源排行。 |
| 新增 widget | 必须说明匹配哪些语义组合、负责回答哪个态势问题、不能混入哪些单位或角色。 | 不进入默认 dashboard，只能作为实验区组件。 |
| 修改排行或趋势 | 必须说明排序口径、时间窗口、量纲分组和 unknown/reported_zero 处理。 | 不合并，先补语义契约和测试。 |

后续实现可以先用启发式规则推导语义，但前端不应再绕过这些字段直接按 source 私有字段拼 UI。本文的核心作用是把“看起来像一个数”的数据，先还原成“它到底在表达什么、描述谁、凭什么可信、适合怎样展示”。

## 本轮落盘索引

本轮讨论最终沉淀出的不是一组孤立名词，而是一套可以直接约束后续实现的观察方法:

```text
观测事实
  -> 内涵分类: 它本质上是什么数据
  -> 外延对象: 它落在哪个业务对象上
  -> 证据质量: 这个值从哪里来、可信到什么程度
  -> 呈现组件: 它应该被哪类 widget 承载
```

因此，后续重构时每个指标至少要能回答四个问题:

| 问题 | 写入位置 | 不允许的退化 |
|---|---|---|
| 它本质上是什么？ | `metric_role`、`time_behavior`、`unit`、`aggregation` | 只用来源名或 UI 标题推断含义。 |
| 它描述谁？ | `subject_type`、`subject_id`、Dataset 行对象语义 | 把没有工作区证据的中转数据塞进工作区榜。 |
| 它可靠吗？ | `knownness`、`confidence`、来源状态、更新时间 | 把未知成本渲染成 0，或把接口报告 0 当作缺失。 |
| 它怎么展示？ | `widget_hint`、widget registry、layout schema | 把 USD、token、count、percent 混进同一坐标轴。 |

最终聚类可以收束成两张工作表。

内涵分类工作表:

| 理由 | 名称 | 后续实现含义 |
|---|---|---|
| 先判断数据源、凭证和采集链路是否可用，否则后续数值都无法解释。 | 连接健康 | SourceStatus、状态矩阵、告警条。 |
| 表达“还能用多少”，关心下限、耗尽和风险阈值。 | 余量风险 | 余额、可用额度、电量、磁盘、剩余限流。 |
| 表达“已经用掉多少”，不能和余量混列。 | 已用消耗 | 成本、token、请求、会话、累计使用。 |
| 只在某个窗口内有意义，窗口变化会改变判断。 | 窗口消耗 | 今日、近 6h、1d、7d 的趋势和摘要。 |
| 表达单位时间压力，而不是总量。 | 使用速率 | rpm、tpm、usd/hour、错误率、下降速度。 |
| 关注随时间变化的形态和异常，而不是单点读数。 | 趋势变化 | 一图一行、小 multiples、delta/局部缩放。 |
| 关注谁贡献最多，核心是排序、占比和来源解释。 | 贡献分布 | 模型 Top、工作区 Top、来源 Top、条形排行。 |
| 区分已知、未知、接口报告 0、推导、占位。 | 数据可信度 | knownness、证据徽标、审计明细。 |
| 解释榜单或判断为什么可信，保留路径、记录数、更新时间等依据。 | 证据审计 | 可展开明细、审计表、tooltip。 |
| 同语义指标可以跨源汇合，来源是切面而不是根分类。 | 多源统一 | 多源混排、来源过滤、统一模型视角。 |

外延扩展工作表:

| 理由 | 名称 | 当前代表 |
|---|---|---|
| 中转站最关心额度、余额、请求、token、成本、模型分布与趋势。 | API 中转监控 | NewAPI、Sub2API。 |
| 本地 Agent 行为最关心模型、工作区、会话、token、成本或成本缺失。 | Agent 使用画像 | Claude Code、Codex、CC Switch。 |
| 模型天然可跨来源比较，用户关心谁消耗多、谁成本高、谁趋势异常。 | 模型消耗画像 | GPT、Claude、MiniMax 等模型。 |
| 工作区回答资源和注意力花在了哪个项目上。 | 工作区消耗画像 | `workspace-sample-a`、`workspace-sample-b`、`local-project-sample` 等路径。 |
| 账号、key、PAT 是额度与权限边界，也是安全边界。 | 账户与凭证状态 | NewAPI 用户、Sub2API key、本地 secret ref。 |
| 设备状态可以复用余量、速率、趋势等内涵，但不是当前主攻域。 | 设备与系统状态 | 电量、磁盘、温度、网络、GPU。 |
| 呈现组件本身也需要受控分类，否则会退化成随手堆卡片。 | 结构化呈现组件 | 卡片、趋势图、排行表、状态矩阵、审计表。 |

这两张工作表是后续重构的最小依据。新增数据源时先补外延对象，新增指标时先补内涵语义，新增 UI 时先补 widget registry。任何一项说不清，都先不要进入常驻面板。

## 阅读路线

这份文档既是讨论沉淀，也是下一轮重构的入口。阅读时建议按三条线索进入:

| 读者目标 | 优先阅读 | 产出 |
|---|---|---|
| 想理解当前数据现状 | `当前真实数据观察`、`当前可感知的问题` | 知道现在已经捕捉到哪些数据，哪些呈现问题是由数据语义不清造成的。 |
| 想设计统一数据模型 | `最终聚类总览`、`V0 必须进入数据模型的内涵维度`、`对统一数据模型的要求` | 得到 Signal、Dataset、knownness、unit family 等字段基线。 |
| 想改前端呈现 | `结构化呈现经验`、`分类法到 widget 的落地映射`、`重构落地基线` | 得到 widget registry、趋势图分组、表格承载和验收规则。 |

后续代码改造时，任何新字段、新 source、新 widget 都应该能在本文中找到自己的归属。如果找不到，优先补文档和分类，再写实现。

## 分类全集与文档用途

本报告处理的全集是:

```text
个人作战仪表盘中一切可被观察、解释、聚合、比较和呈现的数据。
```

这个全集当前以 Agent/API 使用为主，包括 Claude Code、Codex、CC Switch、NewAPI、Sub2API 等来源；但分类法不能被这些来源绑死。未来的 Windows 电量、磁盘、网络、GPU、时间块、任务流、知识库健康等数据，也应当能通过同一套语义框架进入面板。

这份文档有三个用途:

1. **作为数据观察报告**
   记录当前 demo 已经捕捉到哪些数据、这些数据各自的单位、对象、证据质量和变化特征。

2. **作为统一数据模型的输入**
   后端新增 Signal、Dataset 或 semantic projection 时，先用本文的内涵字段与外延对象给数据定性，避免继续按 source 私有字段硬编码。

3. **作为前端呈现重构的约束**
   前端选择卡片、趋势图、排行表、状态矩阵、审计表时，不再问“这是 NewAPI 还是 Sub2API”，而是先问“它的语义角色、单位、时间行为、观测对象和证据质量是什么”。

本报告不试图把 AgentSense 变成完整 BI 平台。V0 的目标是形成一套受控的结构化呈现规则，让常驻面板能稳定回答这些问题:

- 哪些来源健康，哪些来源掉线或只是计划接入？
- 哪些额度、余额、容量正在逼近风险？
- 近 6 小时、1 天、7 天的 token、成本、请求数各自怎么变化？
- 哪些模型、工作区、来源贡献了主要消耗？
- 哪些数字是已知、未知、接口报告 0、推导值或占位值？

因此，本报告后续应优先服务三类实现:

| 实现位置 | 需要从本文继承什么 |
|---|---|
| 后端 source adapter | 只负责采集事实与证据，不替 UI 决定图表。 |
| 统一 Signal/Dataset 模型 | 固化 `metric_role`、`time_behavior`、`unit`、`subject_type`、`aggregation`、`knownness`。 |
| 前端 widget registry | 按语义匹配组件，受控编排，不做任意公式和任意 join。 |

## 当前真实数据观察

本节基于 2026-06-08 晚间本机 demo 快照。快照只作为分析输入，不把本机临时路径固化为文档契约:

- 主接口: `http://127.0.0.1:7894/api/command-demo`
- 原始快照: 本机临时快照，路径不固化入文档。
- 清洗画像: 本机临时画像，路径不固化入文档。

安全说明:

- 本报告只记录聚合事实。
- 不记录 token、API key、Authorization、cookie、prompt、response、thread title、preview 或会话正文。
- Codex 成本未知继续记录为未知，不当作 0。
- Sub2API 接口报告的 0 成本属于接口返回值，不自动等价为未知。

### 来源状态

| 来源 | 状态 | 当前含义 |
|---|---|---|
| `claude-code-local` | `ok` | 可读取 Claude Code 本地项目聚合、模型 token、工作区排行。 |
| `codex-local` | `ok` | 可读取 Codex 本地状态库的白名单聚合字段，能得到模型、provider、token、工作区、会话数。 |
| `cc-switch` | `ok` | 可读取模型/provider 请求、token、成本、近 7 天聚合趋势。 |
| `newapi-main` | `ok` | 可读取用户级额度、已用额度、可用额度、模型统计。 |
| `sub2api-main` | `ok` | 可读取 key 级余额、今日/累计请求、token、成本、模型统计。 |
| `windows-power` | `planned` | 设备电量/系统状态预留，当前不是已接入真实源。 |

当前快照中，已观测到 6 个来源状态，其中 5 个真实可用，1 个为计划接入。

### 感知通道注册表

单纯展示 `sources` 还不够。用户看到“没有卡片”时，必须能区分到底是代码能力不存在、未配置、凭证失败、采集无数据、旧接口存在但未接入新态势台，还是当前视图过滤掉了数据。因此 V0 需要把每个可感知通道注册成 `SourceStatus` 的扩展行，并在 `source_registry` 中展示:

| 状态维度 | 含义 | 典型值 |
|---|---|---|
| `code_capability` | 代码里是否保留 adapter / 旧 provider 能力。 | `present`、`planned`、`unknown` |
| `configuration_state` | 本机是否配置了需要的 env、文件或 token 引用。 | `configured`、`not_configured`、`partial` |
| `collection_state` | 上一次采集是否成功。 | `ok`、`missing`、`auth_failed`、`fetch_failed`、`no_data`、`planned` |
| `command_demo_adapter` | 是否已经映射进新态势台。 | `connected`、`not_connected`、`planned` |
| `visibility_state` | 当前前端是否应该显示。 | `visible`、`not_in_command_demo`、`hidden_by_filter` |

这张表的目的不是增加噪声，而是消除歧义:

| 模块类型 | 应表达的状态 |
|---|---|
| NewAPI/Sub2API | 新态势台已接入；未配置时显示缺少哪类环境变量名，不显示真实密钥值。 |
| Claude Code/Codex/CC Switch | 本地源已接入；如果缺文件或无数据，显示采集状态而不是删除模块。 |
| MiniMax 国内版、DeepSeek、GLM/Z.AI、Claude 订阅配额、MiMo 等旧 provider | 代码能力仍存在；旧 `/api/all` 可追踪时如实记录；未接入 `/api/command-demo` 时显示 `not_connected`。 |
| windows-power 等规划源 | 以 `planned` 出现，只能参与能力矩阵和路线图，不参与真实用量合计。 |

验收标准是：页面上没有“凭空消失”的通道。每个通道至少能回答“代码能力是否存在、配置是否存在、采集是否成功、是否接入当前态势台、为什么不可见”。

### 数据集字段

当前清洗画像中有 11 类数据集字段:

| 数据集字段 | 主要用途 |
|---|---|
| `alerts` | 展示数据源异常、缺失、风险提示。 |
| `top_models` | 多源模型消耗排行。 |
| `top_projects` | 多源工作区消耗排行。 |
| `newapi_attempts` | NewAPI 鉴权与接口尝试记录，用于排查连接问题。 |
| `newapi_model_stats` | NewAPI 模型维度统计。 |
| `sub2api_model_stats` | Sub2API 模型维度统计。 |
| `codex_model_stats` | Codex 本地模型/provider token 聚合。 |
| `cc_switch_model_stats` | CC Switch 模型/provider cost/token 聚合。 |
| `model_daily_trend` | 旧日粒度模型趋势。 |
| `model_trends` | `6h`、`1d`、`7d` 模型趋势窗口。 |
| `source_registry` | 感知通道能力矩阵，解释代码能力、配置、采集、新态势台接入和可见性。 |

当前 signal 单位分布以 `usd`、`count`、`token`、`percent` 为主。这说明第一版最重要的量纲分组就是:

- 成本/余额/额度: `usd`
- token 消耗: `token`
- 请求/会话/记录数: `count`
- 使用率/健康率/电量: `percent`

### 当前可感知的问题

1. **来源不是主分类**: 模型消耗、工作区消耗、token 趋势都应跨来源统一观察，来源更适合作为徽标、过滤器和证据。
2. **量纲不能混轴**: USD、token、count、percent 不应硬塞进同一个趋势图。
3. **已用与可用必须分离**: 已用额度、累计成本、钱包余额、可用额度表达的风险方向完全不同。
4. **静态值与趋势值必须分离**: 当前值适合指标卡；变化过程适合趋势图；排行适合表格或条形图。
5. **未知不是 0**: Codex 本地 token 可知，但成本不可知；这类缺失必须显式进入数据质量模型。
6. **文字明细不能挤压态势图**: NewAPI/Sub2API 的大量额度文字适合折叠，常驻视图优先保留趋势图和关键判断。

## 最终聚类总览

本报告把当前数据先分成两类问题:

1. **内涵分类**: 这个数据本质上是什么。
2. **外延扩展**: 这种数据可以落到哪些业务对象上。

这两层共同决定一个指标应该如何进入统一模型、如何聚合、如何呈现、如何验收。后续重构时，任何新指标都应先填完这两层，再决定是否进入前端常驻区域。

### 内涵类型总表

| 类型 | 判断理由 | 默认呈现 |
|---|---|---|
| 连接健康类 | 回答 source、凭证、接口、采集链路是否可用，是所有数据解释的前提。 | 状态矩阵、告警条、最后更新时间。 |
| 余量风险类 | 回答还能用多少，关心耗尽风险和阈值。 | 余额/额度卡片、单独余量趋势、风险徽标。 |
| 已用消耗类 | 回答已经花掉多少，与余量语义相反，不能混列。 | 指标卡、成本/token 明细、累计统计。 |
| 窗口消耗类 | 回答近 6h、1d、7d、今日等窗口内用了多少。 | 窗口切换趋势图、窗口摘要。 |
| 使用速率类 | 回答单位时间压力，比如 rpm、tpm、usd/hour。 | 速率折线、峰值提示、压力条。 |
| 趋势变化类 | 回答数据随时间怎么变，重点是形态而非单点数值。 | 一图一行趋势图、小 multiples、delta 视图。 |
| 贡献分布类 | 回答谁贡献最多，核心是排序和占比。 | Top 表格、条形排行、占比分布。 |
| 数据可信度类 | 回答值是已知、未知、接口报告 0、推导还是占位。 | 证据徽标、tooltip、审计明细。 |
| 证据审计类 | 回答榜单或判断为什么可信，保留来源路径、记录数、最后更新时间等依据。 | 审计表、可展开明细。 |
| 多源统一类 | 回答同语义指标如何跨 Claude Code、Codex、CC Switch、NewAPI、Sub2API 汇合。 | 多源混排表、来源徽标、来源过滤。 |

### 外延对象总表

| 对象 | 当前代表 | 可承载的内涵类型 |
|---|---|---|
| API 中转站 | NewAPI、Sub2API | 连接健康、余量风险、已用消耗、窗口消耗、趋势变化、证据审计。 |
| Agent 应用 | Claude Code、Codex | 已用消耗、窗口消耗、趋势变化、贡献分布、证据审计。 |
| 模型 | GPT、Claude、MiniMax 等模型名 | 已用消耗、使用速率、趋势变化、贡献分布。 |
| 工作区 | `workspace-sample-a`、`workspace-sample-b`、`local-project-sample` 等路径 | 已用消耗、贡献分布、趋势变化、证据审计。 |
| 账户/API key | NewAPI 用户、Sub2API key、PAT | 连接健康、余量风险、窗口消耗、数据可信度。 |
| 设备 | Windows 电量、磁盘、温度、网络、GPU | 连接健康、余量风险、使用速率、趋势变化。 |
| 呈现组件 | 卡片、趋势图、排行表、状态矩阵、审计表 | 把语义数据映射到受控 widget，而不是开放任意 BI。 |

### 后续重构的核心推论

1. 前端主轴应从 `source` 改为 `metric_role + unit + time_behavior + subject_type`。
2. NewAPI/Sub2API/Claude Code/Codex/CC Switch 只作为来源、证据和过滤器，不作为默认 UI 一级分类。
3. 同单位不等于同语义；USD 里的余额、额度、成本、已用、可用必须分开。
4. 趋势图要按单位和语义拆分；成本、token、请求、百分比、状态各自成图或纵向堆叠。
5. 表格和图表都必须显示证据质量，尤其是 `unknown`、`reported_zero`、`derived`、`planned`。
6. V0 的配置化边界是受控 widget registry，不是完整拖拽 BI 或自定义公式系统。

### 最终收束判定表

最后聚类后，V0 不再把“NewAPI 区域”“Sub2API 区域”“Claude Code 区域”作为根分类，而是先问数据本质，再决定落点:

| 问题 | 优先分类维度 | 典型落点 |
|---|---|---|
| 它是不是数据源可用性问题？ | `metric_role=health`、`subject_type=source/account/api_key` | 连接健康、证据审计。 |
| 它是在表达还能用多少吗？ | `metric_role=available/capacity`、`direction=risk_when_low` | 余量风险。 |
| 它是在表达已经用掉多少吗？ | `metric_role=used`、`aggregation=sum/latest` | 已用消耗、窗口消耗、累计画像。 |
| 它是否只在时间窗口内有意义？ | `time_behavior=window/trend/rate` | 趋势变化、窗口切换。 |
| 它能不能和别的数据共轴？ | `unit`、`unit_family` | 图表分组、纵向堆叠。 |
| 它描述的是谁？ | `subject_type=source/model/workspace/account/api_key/device/task` | 来源过滤、模型排行、工作区排行、设备状态。 |
| 它是否可靠？ | `knownness=known/unknown/reported_zero/derived/planned` | 证据徽标、审计明细、风险提示。 |

这个判定表是后续重构的最小入口。实现上可以先做启发式推导，但 UI 不应再绕过这些问题直接读取 source 私有字段。

## 内涵分类

内涵分类回答“这个数据本质上是什么”。它应该独立于 NewAPI、Sub2API、Claude Code、Codex 等来源存在。

### 最终内涵聚类

因为有些数据只回答“这个源现在通不通、可信不可信”，比如 NewAPI/Sub2API 是否在线、token 是否有效、接口是否返回正常；它们不是消耗本身，而是所有后续观测的前提。
→ 连接健康类

因为有些数据表达“还能用多少”，比如 NewAPI 可用额度、Sub2API 钱包余额、未来的电量/磁盘/剩余上下文；它们天然关心下限、告警线和耗尽风险。
→ 余量风险类

因为有些数据表达“已经用了多少”，比如已用额度、累计 cost、累计 token、历史请求数；它们和“可用”不是同一种东西，不能混在一个指标里。
→ 已用消耗类

因为有些数据只在一个时间窗口内有意义，比如今日请求数、今日 token、近 6 小时趋势、近 7 天消耗；窗口不同，判断也不同。
→ 窗口消耗类

因为有些数据表达“单位时间变化速度”，比如 rpm、tpm、每小时成本、token 增量、余额下降速度；它们不看总量，而看当前压力。
→ 使用速率类

因为有些数据表达“随时间怎么变”，比如模型 token 趋势、成本趋势、中转站趋势；它们适合折线图或柱状图，而不是只放静态数字。
→ 趋势变化类

因为有些数据表达“谁贡献最多”，比如模型消耗 Top、工作区消耗 Top、来源分布、模型成本分布；它们的核心是排序和占比。
→ 贡献分布类

因为有些数据存在已知、未知、接口报告 0、推导、占位的差异；比如 Codex 成本未知不能当 0，Sub2API 返回 0 成本也不能随便改写。
→ 数据可信度类

因为有些数据是原始记录、会话数、最后更新时间、来源路径、项目聚合依据；它们不是展示结论，而是解释“为什么这个榜单可信”。
→ 证据审计类

因为有些指标来自多个源但语义相同，比如 Claude Code、Codex、NewAPI、Sub2API 的 token 都可以进入统一 token 视图；来源只是切面，不应先于指标语义。
→ 多源统一类

### V0 必须进入数据模型的内涵维度

| 维度 | 建议字段 | V0 值域 | 用途 |
|---|---|---|---|
| 语义角色 | `metric_role` | `health`、`capacity`、`available`、`used`、`rate`、`rank`、`evidence` | 决定指标代表什么。 |
| 时间行为 | `time_behavior` | `instant`、`window`、`cumulative`、`rate`、`trend`、`resetting` | 决定是否能画趋势、用什么窗口。 |
| 量纲单位 | `unit` | `usd`、`token`、`count`、`percent`、`ms`、`status` | 决定能否共轴、能否聚合。 |
| 方向性 | `direction` | `higher_better`、`lower_better`、`neutral`、`risk_when_low`、`risk_when_high` | 决定颜色、风险提示和阈值语义。 |
| 观测对象 | `subject_type` | `source`、`model`、`workspace`、`account`、`api_key`、`device`、`task` | 决定分组、筛选和下钻。 |
| 聚合方式 | `aggregation` | `latest`、`sum`、`avg`、`max`、`delta`、`rank` | 决定后端如何汇总。 |
| 证据质量 | `knownness` | `known`、`unknown`、`reported_zero`、`derived`、`planned` | 防止把未知、接口报告 0、推导值混淆。 |

示例:

| 指标 | `metric_role` | `time_behavior` | `unit` | `subject_type` | `aggregation` | `knownness` |
|---|---|---|---|---|---|---|
| NewAPI 可用额度 | `available` | `instant` | `usd` | `account` | `latest` | `known` |
| NewAPI 已用额度 | `used` | `cumulative` | `usd` | `account` | `latest` | `known` |
| Sub2API 今日 token | `used` | `window` | `token` | `api_key` | `sum` | `known` |
| Sub2API 今日成本为 0 | `used` | `window` | `usd` | `api_key` | `sum` | `reported_zero` |
| Codex 工作区 token | `used` | `cumulative` | `token` | `workspace` | `sum` | `known` |
| Codex 工作区成本 | `used` | `cumulative` | `usd` | `workspace` | `sum` | `unknown` |
| windows-power 电量 | `available` | `instant` | `percent` | `device` | `latest` | `planned` |

## 外延扩展

外延扩展回答“这些内涵类型可以落到哪些业务对象上”。外延不是另一个主分类，而是把内涵类投射到具体对象。

### 最终外延聚类

因为 NewAPI/Sub2API 这类中转站最关心额度、余额、请求、token、成本、模型分布与趋势，是当前最确定的 API 监控对象。
→ API 中转监控

因为 Claude Code、Codex、本地日志、CC Switch 都是在记录 Agent 使用行为，重点是模型、工作区、会话、token、成本或成本缺失。
→ Agent 使用画像

因为模型可以跨来源混排，用户关心的是 GPT、Claude、MiniMax 等模型到底谁消耗多、谁成本高、谁趋势异常，而不是先看它来自哪个源。
→ 模型消耗画像

因为工作区代表真实项目活动，比如 `workspace-sample-a`、`workspace-sample-b`、`local-project-sample`；它回答“我的精力和 API 资源花在了哪里”。
→ 工作区消耗画像

因为账号、API Key、PAT、钱包余额、订阅额度这些对象都属于“凭证/账户级资源”，它们决定可用性和安全边界。
→ 凭证额度画像

因为未来可能接入 Windows 电量、温度、磁盘、网络、GPU 等，它们不是 Agent API，但同样属于个人作战态势。
→ 设备状态画像

因为一部分数据适合做当前值卡片，一部分适合趋势图，一部分适合排行表，一部分适合审计明细；呈现类型本身也应该被建模。
→ 呈现组件画像

因为有些指标天然是 USD，有些是 token，有些是 count，有些是 percent/status；不同量纲不能硬塞进一个图里。
→ 量纲分组画像

因为“已用”和“可用”在业务语义上相反，一个表达消耗，一个表达余量；即使单位都是 USD/token，也应该分开建模与呈现。
→ 用量余量分离画像

因为有些对象当前已经真实接入，有些只是计划接入；比如 windows-power 是 planned，不能和真实可用源混为一谈。
→ 接入成熟度画像

### 外延组合示例

| 外延对象 | 可承载的内涵类型 | 当前例子 |
|---|---|---|
| API 中转站 | 连接健康、余量风险、已用消耗、窗口消耗、趋势变化、证据审计 | NewAPI、Sub2API |
| Agent 应用 | 连接健康、已用消耗、窗口消耗、趋势变化、贡献分布 | Claude Code、Codex |
| 模型 | 已用消耗、使用速率、趋势变化、贡献分布 | `gpt-5.5`、Claude、MiniMax 等模型 |
| 工作区 | 已用消耗、趋势变化、贡献分布、证据审计 | `workspace-sample-a`、`workspace-sample-b` 等本地路径 |
| 账户/API key | 连接健康、余量风险、窗口消耗、数据可信度 | NewAPI 用户、Sub2API key |
| 设备 | 连接健康、余量风险、使用速率、趋势变化 | Windows 电量、磁盘、温度，当前为预留 |

## 结构化呈现经验

### 作为重构基石的分层边界

后续重构不能把“怎么拿数据”和“怎么展示数据”继续揉在同一个 source 卡片里。推荐把系统拆成四层:

| 层 | 责任 | 不该承担的事 |
|---|---|---|
| 信息获取层 | 读取本地文件、SQLite、远端 API、系统 API，并返回 source 状态与原始聚合字段。 | 不决定 UI 该画什么图，不把未知值改成 0。 |
| 数据表征层 | 把原始字段转成带 `metric_role`、`time_behavior`、`unit`、`subject_type`、`knownness` 的 Signal/Dataset。 | 不绑定具体页面布局，不为了某个卡片篡改语义。 |
| 综合聚合层 | 做跨来源合并、排序、窗口化、趋势采样、Top N、量纲分组。 | 不把不同单位混轴，不把已用和可用混算。 |
| 面板呈现层 | 根据语义元数据选择卡片、趋势图、排行表、状态矩阵、审计明细。 | 不直接猜测某个 source 私有字段的业务含义。 |

这四层的主线是:

```text
source raw facts
  -> semantic signals / datasets
  -> grouped projections
  -> widgets
```

因此，NewAPI、Sub2API、Claude Code、Codex 只是信息来源；它们不应该成为 UI 的第一分类。真正决定呈现方式的是指标本身的语义、单位、时间行为和证据质量。

### 主面板骨架

V0 建议收束成 6 个一级面板:

| 面板 | 主要回答 | 默认呈现 |
|---|---|---|
| 连接健康 | 哪些源可用、哪些掉线、哪些凭证失败。 | 状态矩阵、告警条、最后读取时间。 |
| 余量风险 | 还剩多少、是否接近耗尽、是否需要补充。 | 指标卡、环形图、分离的余额/额度趋势。 |
| 窗口消耗 | 当前自然日、近 6 小时、近 1 天、近 7 天用了多少。 | 分量纲趋势图、窗口切换。 |
| 趋势变化 | 变化过程、峰值、平缓区、异常跳变。 | 一图一行趋势图、小 multiples。 |
| 贡献分布 | 谁消耗最多、哪个工作区/模型/来源贡献最大。 | Top 表格、条形图、占比分布。 |
| 证据审计 | 为什么可信、哪些字段未知、数据来自哪里。 | 明细表、tooltip、状态徽标。 |

### Widget 选择规则

| 数据类型 | 适合 widget | 不适合做法 |
|---|---|---|
| 连接状态 | 状态矩阵、告警条 | 跟 token/cost 混成趋势线。 |
| 可用余额/额度 | 指标卡、环形图、单独趋势图 | 和已用成本共轴。 |
| 已用成本 | 指标卡、成本趋势图、成本排行 | 和可用余额混成一个“USD 曲线”。 |
| token 消耗 | token 趋势图、模型/工作区排行 | 和 USD 放同一 y 轴。 |
| 请求/会话数 | count 趋势图、表格 | 与 token 直接相加。 |
| 百分比 | 环形图、百分比趋势 | 与 USD/token 原始量混轴。 |
| 排行贡献 | Top 表格、条形图 | 挤在小卡片里导致路径/来源被裁掉。 |
| 证据质量 | 徽标、tooltip、审计明细 | 隐藏未知，或把未知渲染成 0。 |

### 关键呈现原则

1. **先按内涵分组，再按来源过滤**
   默认视图应回答“哪个模型、哪个工作区、哪类消耗最高”，来源只是解释维度。

2. **已用和可用分离**
   NewAPI 已用额度、NewAPI 可用额度、Sub2API 钱包余额、Sub2API 今日成本必须分开建模。它们单位可能都是 USD，但语义和风险方向不同。

3. **成本、token、请求、百分比独立量纲**
   图表必须先按单位分区。需要同屏比较时，用纵向堆叠、上下分区或小 multiples，不用单轴硬塞。

4. **趋势图要给足面积**
   “模型 Token / 成本趋势”“中转专区趋势”这类核心态势图应一图一行，不横向挤压。

5. **文字明细默认可折叠**
   NewAPI/Sub2API 的请求数、额度文字、模型统计是排查材料，不应长期挤占趋势图空间。

6. **密集表格完整宽度承载**
   工作区 Top、模型 Top、来源状态表这类表格应独占一行或使用完整宽度。窄屏时只允许表格容器内部横向滚动。

7. **证据质量进入 UI**
   `known`、`unknown`、`reported_zero`、`derived`、`planned` 应进入 tooltip、徽标或表格列，而不是丢失。

8. **静态数字不是趋势替代品**
   当前值卡片回答“现在如何”，趋势图回答“正在怎么变化”。两者都需要，但不能互相代替。

### 趋势可视化改进策略

当前面板已经能捕捉多类趋势，但不同数据的数量级、变化幅度和风险方向差异很大。如果只用一条普通折线，很容易出现“大额余额曲线几乎不动、小额成本曲线被压扁、token 与 USD 互相干扰”的问题。后续趋势层应先判断数据的变化类型，再选择视图。

| 变化类型 | 典型数据 | 主要问题 | 推荐视图 |
|---|---|---|---|
| 大基数小变化 | Sub2API 钱包余额、总额度、磁盘容量 | 绝对值曲线接近水平，看不出消耗速度。 | 余额绝对值 + 余额 delta + 预计耗尽速度。 |
| 小基数突增 | 今日成本、请求数、错误数 | 峰值被平均或被大数压扁。 | 窗口柱状图、峰值标注、局部缩放。 |
| 长期累计 | 累计 token、累计成本、累计 session | 只会上升，趋势形态不等于近期压力。 | 累计值卡片 + 窗口增量趋势。 |
| 周期重置 | 今日请求、今日 token、日成本 | 跨天断点会被误读为异常下降。 | 按周期分段、显示 reset 边界、支持 6h/1d/7d。 |
| 多源同类消耗 | Claude Code/Codex/NewAPI/Sub2API 模型 token | 数量级不同，来源差异会掩盖模型差异。 | 同单位小 multiples、Top N 叠加、来源过滤。 |
| 余量与已用并存 | 可用额度、钱包余额、已用成本、今日成本 | 同是 USD 但语义相反，混图会误导。 | 余量趋势与已用趋势分图，风险方向分别标注。 |
| 百分比/状态 | 电量、使用率、接口在线状态 | 与 USD/token/count 不可共轴。 | percent 单独趋势，status 用状态条或时间带。 |

因此，趋势图默认不应该只问“单位是什么”，还要问“它是存量、流量、增量、速率，还是周期窗口”。推荐在 `time_behavior` 之外增加轻量的呈现 hint:

```ts
type TrendPresentationHint = {
  scale_mode: "absolute" | "delta" | "normalized" | "local_zoom" | "log"
  series_role: "stock" | "flow" | "rate" | "resetting_window" | "status"
  compare_mode: "same_axis" | "small_multiples" | "stacked_rows" | "separate"
}
```

V0 不需要让用户手写这些配置。后端可以先按语义启发式生成，前端只暴露受控切换:

1. **绝对值 / 增量切换**
   余额、容量、累计值默认看绝对值；当变化太平缓时允许切到 delta。

2. **已用 / 可用分离**
   已用成本、今日 token、请求数进入消耗趋势；余额、可用额度、容量进入余量趋势。

3. **同单位纵向堆叠**
   多条趋势都属于 token 或 USD 时，也优先一图一行或小 multiples，避免横向拥挤和共轴误读。

4. **周期重置显式标注**
   今日类、近 7 天类数据要显示窗口边界，避免把自然归零理解成掉线。

5. **证据质量参与趋势**
   `unknown` 不画成 0；`reported_zero` 可以画 0 但必须有证据标记；`derived` 应在 tooltip 或图例中注明。

这组规则的目标不是让图表更复杂，而是让趋势图真正回答“发生了什么变化”。绝对值适合判断当前状态，增量适合判断近期压力，归一化适合比较不同来源的形态，局部缩放适合观察小幅波动；这些视图应受控切换，而不是把所有数据塞进同一个坐标轴。

### 分类法到 widget 的落地映射

第一版可以先做固定映射，暂不做复杂 dashboard builder:

| 输入语义 | 默认 widget | 交互方式 | 当前落点 |
|---|---|---|---|
| `health + status + source` | 连接状态矩阵 | 按来源过滤、查看错误原因 | Source Adapter 状态、态势提示 |
| `source_registry + source + status` | 能力矩阵 | 区分代码存在、未配置、无数据、未接入、被过滤 | Source Adapter 能力矩阵 |
| `available + instant + usd/token/percent` | 余量卡片 / 单独余额趋势 | 隐藏文字明细、保留关键阈值 | NewAPI 可用额度、Sub2API 钱包余额、未来电量 |
| `used + window + usd/token/count` | 窗口消耗趋势 | `6h`、`1d`、`7d` 切换 | 模型 Token / 成本趋势、中转专区趋势 |
| `used + cumulative + workspace` | 工作区排行表 | 成本、token、记录数排序 | 工作区消耗 Top |
| `rank + model + usd/token/count` | 模型排行表 / 条形图 | 成本、token、请求、来源分组切换 | 模型消耗 Top、模型成本分布 |
| `evidence + unknown/reported_zero/derived` | 证据徽标 / 审计表 | 展开明细、tooltip | 统一 Signal 样例、记录来源、成本未知 |

这个映射的意义是让新指标先回答“我是什么”，再进入某个 widget。比如同样是 USD:

- `available + instant + usd` 应进入余量风险。
- `used + window + usd` 应进入成本趋势。
- `used + cumulative + usd + model` 应进入模型成本排行。
- `unknown + usd` 应进入证据审计，不应进入数值合计。

如果一个新指标无法填出这些语义字段，就先不要做成前端常驻卡片。

## V0 决策记录

本节用于约束后续代码重构。它不是额外愿景，而是当前阶段的取舍边界。

### 必须固化到数据契约

| 字段 | 原因 | 失败后果 |
|---|---|---|
| `metric_role` | 区分健康、余量、已用、速率、排行、证据。 | UI 只能继续按来源硬编码卡片。 |
| `time_behavior` | 区分瞬时、窗口、累计、速率、趋势。 | 6h/1d/7d、今日/累计会混成一类。 |
| `unit` | 保留原始单位，如 `usd`、`token`、`count`、`percent`。 | 图表无法判断能否共轴。 |
| `unit_family` | 将 `quota`、`credit`、`usd`、`token` 等归入呈现量纲。 | 中转站额度、余额、成本容易混图。 |
| `subject_type` | 区分 source、model、workspace、account、api_key、device。 | NewAPI/Sub2API 可能被硬塞进工作区榜。 |
| `aggregation` | 标明 latest、sum、delta、rank 等聚合口径。 | 排行、累计、窗口值之间会互相污染。 |
| `knownness` | 显式区分 known、unknown、reported_zero、derived、planned。 | Codex 成本未知会再次被误渲染成 0。 |

### 必须固化到前端交互

| 交互 | 服务的问题 |
|---|---|
| 按来源过滤 | 看某个 adapter 是否贡献了数据，但不改变默认多源统一视角。 |
| 按类型/语义切换 | 在余量、已用、趋势、排行之间切换观察角度。 |
| 按单位分组 | 防止 USD、token、count、percent 共轴。 |
| 按时间窗口切换 | 支持 6h、1d、7d 等不同颗粒度。 |
| 按成本/token/请求排序 | 支持模型和工作区的不同贡献解释。 |
| 折叠文字明细 | 常驻视图优先看图，排查时再展开证据。 |
| 显示证据质量 | 让 unknown、reported_zero、derived、planned 不被吞掉。 |

### 暂缓进入 V0

| 能力 | 暂缓原因 |
|---|---|
| 通用 BI 查询器 | 会把目标从个人态势台扩大成数据分析平台。 |
| 任意自定义公式系统 | 需要表达式、安全边界、单位推导和错误处理，V0 风险过大。 |
| 完整拖拽 dashboard builder | 当前需要的是受控编排，不是低代码编辑器。 |
| 跨源自动 join | NewAPI/Sub2API 与本地 workspace 没有稳定归属证据。 |
| 自动异常检测模型 | 先把语义、量纲、趋势窗口做清楚，再做异常判断。 |
| 复杂设备指标树 | 电量/磁盘/温度可预留，但暂不主攻。 |

### 第一轮实现顺序

1. 后端先给所有 Signal 补 `semantics`，并返回 `semantic_projection`。
2. 前端新增“语义投影 / 呈现编排”区域，用它验证分类法是否能解释当前数据。
3. 现有排行、趋势、中转专区逐步改为读取语义字段，而不是 source 私有字段。
4. 测试优先保护三件事: 未知不等于 0、已用和可用不混、工作区榜只纳入有工作区证据的数据。
5. 能力矩阵优先保护四件事: 代码能力存在不等于已配置，已配置不等于有数据，有数据不等于已接入新态势台，未显示必须给出原因。
6. 再考虑把临时 Node 代理里的契约迁入正式 Rust 后端。

### 从当前问题抽出的重构经验

1. **混排不是把所有来源相加**
   模型和工作区可以跨来源混排，但前提是 subject 一致、单位一致、knownness 可解释。没有 workspace 证据的 NewAPI/Sub2API 不应硬塞进工作区榜。

2. **同单位不等于同语义**
   NewAPI 已用额度、NewAPI 可用额度、Sub2API 钱包余额、Sub2API 今日成本都可能是 USD，但它们分别属于已用、可用、余额、窗口消耗。

3. **趋势要展示变化，而不只是展示数值**
   大数量级差异会让小波动贴成直线。后续趋势层需要按语义拆图，并考虑 delta、百分比变化、局部缩放、对数轴或小 multiples。

4. **本地 Agent 数据和中转站数据要统一，但不要混淆证据**
   Claude Code/Codex 的本地记录能证明工作区与会话；NewAPI/Sub2API 更适合证明账户/key、模型与请求。两类证据可以在模型层汇合，但不应在工作区层强行汇合。

5. **前端配置化的边界是 widget 编排，不是任意 BI**
   V0 应允许配置来源、窗口、排序、Top N、是否折叠明细、默认 widget 排列；暂不做自定义公式、拖拽低代码、跨表 join。

## 对统一数据模型的要求

后续正式模型应为 Signal 和 Dataset 增加分类元数据。推荐最小形态:

```ts
type MetricSemantics = {
  metric_role:
    | "health"
    | "capacity"
    | "available"
    | "used"
    | "rate"
    | "rank"
    | "evidence"
  time_behavior:
    | "instant"
    | "window"
    | "cumulative"
    | "rate"
    | "trend"
    | "resetting"
  unit:
    | "usd"
    | "token"
    | "count"
    | "percent"
    | "ms"
    | "status"
  direction:
    | "higher_better"
    | "lower_better"
    | "neutral"
    | "risk_when_low"
    | "risk_when_high"
  subject_type:
    | "source"
    | "model"
    | "workspace"
    | "account"
    | "api_key"
    | "device"
    | "task"
  aggregation:
    | "latest"
    | "sum"
    | "avg"
    | "max"
    | "delta"
    | "rank"
  knownness:
    | "known"
    | "unknown"
    | "reported_zero"
    | "derived"
    | "planned"
}
```

Dataset 也应声明:

```ts
type DatasetSemantics = {
  rows_subject_type: "source" | "model" | "workspace" | "account" | "api_key" | "device"
  primary_metric_role: "used" | "available" | "health" | "rank" | "evidence"
  primary_unit?: "usd" | "token" | "count" | "percent" | "ms" | "status"
  allowed_group_by?: string[]
  allowed_sort_by?: string[]
  allowed_windows?: string[]
}
```

这让前端不用靠标题猜测“这个表是成本表还是 token 表”，也不用把特殊逻辑硬编码到某个 source 卡片里。

## 重构落地基线

分类法真正落地时，不应只停留在文档术语上。下一步要把它变成 `/api/command-demo` 以及后续正式 API 的稳定契约，让前端看到的不是“某个来源的一堆字段”，而是一组已经解释过的观察对象。

### 后端语义投影

后端应在原有 `sources`、`signals`、`datasets` 之外，额外返回一个面向前端编排的语义投影。建议过渡字段名为 `semantic_projection`:

```ts
type SemanticProjection = {
  layers: Array<{
    id: string
    name: string
    purpose: string
    item_count: number
  }>
  metric_groups: Array<{
    id: string
    name: string
    metric_role: string
    unit_family: string
    subject_type: string
    count: number
    widget_hint: string
  }>
  dataset_groups: Array<{
    id: string
    name: string
    dataset_id: string
    rows_subject_type: string
    primary_metric_role: string
    primary_unit?: string
    widget_hint: string
  }>
  evidence_notes: Array<{
    id: string
    severity: "info" | "warning" | "risk"
    message: string
    related_ids: string[]
  }>
}
```

这个投影只负责解释和编排，不替代原始数据:

- `signals` 保留具体数值、来源、路径和单位。
- `datasets` 保留表格、排行、趋势等行数据。
- `semantic_projection` 告诉前端这些数据应进入哪些观察组和 widget。

### Signal 最小落地口径

每个 Signal 都应带上 `semantics`，哪怕是由路径规则暂时推导出来:

```ts
type Signal = {
  id: string
  sourceId: string
  label: string
  path: string
  kind: string
  value: number | string | boolean | null
  unit: string
  confidence: "reported" | "derived" | "planned"
  collectedAt: string
  semantics: MetricSemantics
}
```

过渡阶段可以接受启发式推导，但必须遵守三条底线:

1. `value === null` 或缺字段时，`knownness` 必须是 `unknown`，不能渲染为 0。
2. 接口明确报告的 0 成本可以是 `reported_zero`，但不能和未知混为一谈。
3. 余额、额度、已用成本、token 消耗即使同属数值，也必须有不同的 `metric_role` 和 `time_behavior`。

### Dataset 最小落地口径

Dataset 应声明自己“每一行是什么对象”和“主指标是什么语义”。第一版不要求所有行字段都完全 schema 化，但至少要能让前端判断它该放进哪个 widget:

| Dataset | `rows_subject_type` | `primary_metric_role` | `primary_unit` | 默认 widget |
|---|---|---|---|---|
| `top_models` | `model` | `rank` | `token/usd/count` | 模型排行表 / 条形排行 |
| `top_projects` | `workspace` | `rank` | `token/usd` | 工作区排行表 |
| `model_trends` | `model` | `used` | `token/usd` | 纵向堆叠趋势图 |
| `newapi_model_stats` | `model` | `used` | `token/count` | 中转模型明细 |
| `sub2api_model_stats` | `model` | `used` | `token/usd/count` | 中转模型明细 |
| `source_registry` | `source` | `health/evidence` | `status` | 感知通道能力矩阵 |
| `alerts` | `source` | `health` | `status` | 告警条 / 状态矩阵 |

如果一个 Dataset 不能说明自己的行对象，就暂时不要进入跨来源排行，只能作为审计明细展示。

### 前端组件注册表基线

前端第一版不做完整拖拽 builder，而是做受控的组件注册表。组件注册表按语义匹配，不按来源硬编码:

| 组件类型 | 匹配条件 | 主要职责 |
|---|---|---|
| `status-matrix` | `metric_role=health` 或 source 状态 | 展示连接健康、凭证失败、计划接入。 |
| `capability-matrix` | `dataset=source_registry` | 展示代码能力、配置状态、采集状态、新态势台接入和可见性。 |
| `reserve-card` | `metric_role=available/capacity` | 展示余额、可用额度、剩余百分比。 |
| `window-trend` | `time_behavior=window/trend` 且单位一致 | 展示近 6h/1d/7d 的变化。 |
| `rank-table` | `metric_role=rank` 或 Dataset 行对象可排序 | 展示模型、工作区、来源贡献。 |
| `evidence-table` | `metric_role=evidence` 或 `knownness != known` | 展示未知、推导、报告 0、计划接入。 |
| `relay-zone` | `subject_type=account/api_key` 且来源为中转 | 展示 NewAPI/Sub2API 的额度、余额、成本、token。 |

组件注册表的边界是“结构化呈现”，不是任意公式系统。用户可以切换来源、类型、单位、窗口、排序和折叠状态，但第一版不开放任意 join、表达式求值或拖拽低代码。

### 验收基线

后续重构每做一轮，都至少要守住这些验收条件:

1. 模型消耗 Top 默认跨来源混排，来源只作为徽标、过滤器或排序模式。
2. 模型成本分布只纳入可比较的成本数据，不能把额度、余额、未知成本混进去。
3. 工作区 Top 只纳入有 workspace/cwd/project 证据的来源。
4. NewAPI 已用、NewAPI 可用、Sub2API 钱包余额、Sub2API 今日成本分开显示。
5. 成本、token、请求数、百分比、状态分别进入不同量纲组。
6. 趋势图默认给足纵向空间，核心图不横向挤压。
7. 文字明细可以折叠，折叠后图表仍能表达主要态势。
8. `unknown`、`reported_zero`、`derived`、`planned` 都必须能在 UI 或审计明细中看见。

## V0 范围筛选

### 必须进入 V0

1. `metric_role`
2. `time_behavior`
3. `unit`
4. `subject_type`
5. `aggregation`
6. `knownness`
7. 按来源、类型、单位、时间窗口、成本/token/请求排序切换
8. 文字详情折叠，只看图的态势视图

### 可以进入 V0，但保持轻量

1. `direction` 用于颜色和风险提示。
2. `derived` 用于明确二级聚合指标。
3. `planned` 用于展示未来 source 空位，但不能和真实数据混算。
4. `evidence` 用于工作区 Top、模型 Top 的来源解释。

### 暂不进入 V0

1. 通用自定义公式系统。
2. 完整拖拽式 dashboard builder。
3. 复杂业务域 taxonomy。
4. 自动异常检测模型。
5. 过细设备指标树。
6. 自动控制或写操作。

## 对下一步重构的约束

1. **后端先补语义元数据**
   `/api/command-demo` 或正式 `/api/signals`、`/api/datasets/:id` 应返回分类元数据，前端按元数据选择呈现方式。

2. **前端改成数据驱动的 widget registry**
   widget 绑定 `metric_role + unit + subject_type + dataset`，不直接绑定 `newapi-main` 或 `sub2api-main` 的私有字段。

3. **模型排行默认多源混排**
   `top_models` 默认按成本、token 或请求排序；来源只做徽标、过滤器、排序模式。

4. **工作区排行只纳入有 workspace 证据的来源**
   Claude Code 和 Codex 可以进入工作区榜；CC Switch、NewAPI、Sub2API 暂无稳定 workspace 映射时不硬塞。

5. **中转专区要拆清楚**
   NewAPI 额度、NewAPI 已用、NewAPI 可用、Sub2API 钱包余额、Sub2API 今日成本、Sub2API token 不得混成一个“额度/余额 USD”。

6. **趋势图按单位和语义分组**
   成本趋势、token 趋势、请求趋势、余额趋势、使用率趋势各自成图或纵向堆叠。

7. **证据质量可见**
   未知成本、接口报告 0、派生值、计划接入都必须可见，防止用户误判。

8. **文档和测试要保护语义**
   测试不应只验证 DOM 有值，还应验证 unknown 不被当 0、余额和已用不混列、模型排行不是按来源硬分组。

## 采样趋势试点落地

首屏「采样趋势 · 量纲分组」不再固定写死为“成本图 + Token 图”，而是作为语义呈现试点，由浏览器本地采样的 `semanticSamples` 自动派生。

### 分图规则

内涵属性决定是否分成不同图:

1. `metric_role`: 已用、可用、容量、速率分开。
2. `time_behavior`: 瞬时、窗口、累计、速率分开。
3. `unit_family + unit`: USD、quota、token、count、percent 不共轴。
4. `subject_type`: 来源、模型、工作区、账户/API Key 等对象分开。

来源不再作为首层分图键。NewAPI、Sub2API、本地 Agent、后续设备源等外延来源，应作为同一语义图里的曲线、徽标或说明出现。这样可以避免“先按来源排序，再看指标”的旧视角，也便于横向比较相同语义的数据。

### 呈现规则

外延属性决定图中项目:

1. 同一语义组内，`source + signal path` 形成一条曲线。
2. 曲线名称必须包含来源，避免多个来源都叫“模型 Token”时失真。
3. 图卡副标题同时显示对象、角色、时间行为、来源、证据质量。
4. 每张图只承载一个语义组，一行一图，避免横向挤压。
5. `unknown` 不进入数值曲线；`reported_zero` 可以画 0，但必须保留证据标签。

### 与中转专区的关系

「中转专区趋势」继续保留，作为来源视角对照:

1. 来源视角适合回答“NewAPI 现在怎么样”“Sub2API 现在怎么样”。
2. 语义视角适合回答“所有来源的已用 token / 可用额度 / 今日成本各自怎么变”。
3. 两者不能互相替代。来源专区服务定位，语义趋势服务比较和态势判断。

### 本轮实现记录（2026-06-09）

本轮前端试点把「采样趋势 · 量纲分组」改成「采样趋势 · 语义派生试点」，验证分类法是否能直接驱动 UI 编排，而不是只停留在文档术语中。

已落地的行为:

| 能力 | 当前实现 | 验证意图 |
|---|---|---|
| 时间窗口 | 增加 `6h`、`1d`、`7d` 切换，并把本地采样保留窗口扩展到 7 天。 | 同一趋势必须先说明观察窗口，避免“今日”“近 6 小时”“近 7 天”混读。 |
| 语义筛选 | 增加全部、余量/容量、消耗、中转、本地 Agent、比例/速率。 | 前端可以按内涵语义和外延对象切换，而不是只能按来源分区。 |
| 派生摘要 | 展示分图规则、曲线生成规则、当前可见组数、量纲画像。 | 用户能看懂“为什么这些曲线被放在一起或分开”。 |
| 量纲分离 | 继续按 `metric_role + time_behavior + unit + subject_type` 分图。 | USD、token、count、percent 不共轴；已用和可用不混图。 |
| 中转对照 | 下方中转专区趋势复用同一窗口口径，但保留来源视角。 | 同时支持“按类型看中转站”和“按中转站看类型”。 |
| 证据边界 | 趋势说明继续保留 `unknown` 跳过、`reported_zero` 画 0 的规则。 | 防止未知成本被误读为 0，也防止接口报告 0 被误判为缺失。 |
| 图表空间 | 语义趋势区改为独立宽面板，一图一行纵向堆叠。 | 核心趋势图不再被文字明细或横向布局挤压。 |
| 宽表边界 | Source Adapter、工作区榜等宽表在窄屏使用容器内横向滚动。 | 不撑破整页，也不把右侧列裁掉。 |
| 资源清洁 | 页面增加内联 favicon。 | 消除无意义的 `/favicon.ico` 404，使浏览器控制台只暴露真实问题。 |

这次实现仍属于过渡层: 语义分组主要在浏览器端从 `semanticSamples` 派生，后端还没有正式输出稳定的 `semantic_projection`。因此后续重构的方向不应是继续堆更多前端启发式，而应把本轮验证过的规则下沉到正式数据契约中:

1. source adapter 只负责事实、证据和 secret 引用。
2. 聚合层输出带语义元数据的 Signal、Dataset、TrendGroup。
3. 前端 widget registry 只消费语义字段，减少对 source 私有字段的猜测。
4. 测试重点从“DOM 有值”升级到“已用/可用不混、量纲不混、unknown 不当 0、来源不硬分组”。

## 后续检查清单

每次新增 source 或 widget 时，先回答这些问题:

- 它的 `metric_role` 是什么？
- 它是瞬时、窗口、累计、速率，还是趋势？
- 它的单位是什么？能和谁共轴？
- 它的观测对象是什么？source、model、workspace、account/key、device 还是 task？
- 它是已知、未知、接口报告 0、推导，还是计划接入？
- 它默认应该是卡片、趋势图、排行表、状态矩阵，还是审计明细？
- 它是否会把“已用”和“可用”混在一起？
- 它是否需要折叠文字明细，把空间让给态势图？

如果这些问题答不清楚，说明还不该写成专属卡片。

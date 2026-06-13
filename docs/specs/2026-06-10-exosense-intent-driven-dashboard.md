# ExoSense 意图驱动个人态势仪表盘 v0.1

日期: 2026-06-10

状态: 阶段性架构契约 + 后续重构基石

适用仓库: AgentSense 魔改分支 `ExoSense`

关联文档:

- `docs/specs/2026-06-08-unified-agent-api-dashboard-model.md`: 统一 Signal/Dataset 模型、Source Adapter、Widget Registry 与可编排呈现。
- `docs/specs/2026-06-09-data-observation-taxonomy.md`: 当前真实数据观察、内涵/外延分类法、趋势分图规则与缺失可观测性约束。
- `docs/specs/2026-06-08-personal-agent-usage-dashboard.md`: 个人 Agent/API 使用态势 demo 的阶段性需求与接入记录。

## 一句话结论

ExoSense 后续不应从“我有什么数据”直接跳到“画什么图”，而应从“我现在想回答什么问题”出发:

```text
意图缺口 -> 问题类型 -> 需要的观测对象和指标 -> 数据映射 -> 语义综合 -> Widget 候选 -> 呈现与反馈
```

也就是说，可视化不是把数据变成图，而是帮助用户回答当前态势问题。图表只是最后一层表达，不能反过来主导数据模型。

## 当前问题

当前 demo 已经能采集 Claude Code、Codex、CC Switch、NewAPI、Sub2API 等多源数据，也已经开始把 `Signal`、`Dataset`、`metric_role`、`time_behavior`、`metric_identity`、`knownness` 等语义字段落到实现中。

但系统仍有一个结构性风险: **信号建模容易再次平铺化**。

平铺模型长这样:

```text
source A 有 signal 1
source A 有 signal 2
source B 有 signal 3
```

真实世界里的可观察对象更像树:

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

如果只看平铺信号，系统会误以为“有一个 USD 值就可以放进一张 USD 图”。但同为 USD 的成本、余额、额度含义相反，不能共轴；同为 count 的请求、会话、记录、模型数也不能混成一类。

## 核心原则

1. **意图层与数据层解耦**
   用户想回答的问题不应被某个 provider 的返回结构绑定。Sub2API、NewAPI、Codex 都只是证据来源，不是面板的信息架构。

2. **先定义问题，再选择图表**
   “总量、排序、构成、时序、关系、差距、异常定位”这些问题类型决定 widget 形态。不能因为有 ECharts 就把所有东西都画折线。

3. **先描述对象，再描述指标**
   每个指标必须挂到 `ObservableSubject` 上。没有工作区证据的数据不能进入工作区榜，没有模型证据的数据不能进入模型分布。

4. **缺失也必须可观察**
   用户看到“没有卡片”时，必须能区分是代码能力不存在、未配置、凭证失效、请求失败、无数据、未映射，还是被筛选隐藏。

5. **呈现受控，不做通用 BI**
   V0 只做结构化呈现和受控编排，不做任意拖拽 builder、不做用户自定义公式系统、不做完整数据仓库。

## 分层架构

```text
Source Capability Registry
  -> Raw Fact Layer
  -> Observable Subject Graph
  -> Semantic Metric Layer
  -> Intent Manifest
  -> Derivation Planner
  -> Widget Registry
  -> Presentation Blueprint
  -> Feedback Loop
```

### 1. 感知通道层

回答: 这个通道有没有能力、有没有配置、有没有采到数据？

最小状态:

```ts
type SourceStatus = {
  source_id: string
  label: string
  capability_state: "present" | "missing" | "planned"
  config_state: "configured" | "missing" | "disabled"
  credential_state: "valid" | "invalid" | "unknown" | "not_required"
  collection_state: "ok" | "waiting" | "auth_failed" | "fetch_failed" | "no_data"
  command_demo_adapter: "connected" | "legacy_only" | "not_mapped" | "planned"
  visible_state: "visible" | "hidden_by_filter" | "not_mapped" | "no_displayable_metric"
  last_sample_at?: string
  missing_requirements?: string[]
}
```

这层的任务不是展示业务指标，而是解释“为什么有或没有数据”。

### 2. 原始事实层

回答: 我们实际拿到了什么原始事实？

例子:

```text
NewAPI model row
Sub2API usage row
Codex session row
Claude Code project row
CC Switch account row
MiniMax legacy quota row
```

原始事实应尽可能保留来源字段，但前端默认不直接消费 provider 私有结构。

### 3. 可观测对象图谱

回答: 这个事实描述的是谁？

```ts
type ObservableSubject = {
  subject_type:
    | "source"
    | "account"
    | "api_key"
    | "model"
    | "workspace"
    | "session"
    | "device"
    | "task"
  subject_id: string
  label: string
  parent_subject_id?: string
  source_id?: string
  evidence_ref?: string
}
```

典型对象树:

```text
Sub2API
  api_key: sk-[redacted]
    model: glm-5.1
      metric: tokens / cost / requests

Codex
  workspace: H:/A137442/Develop/AGI/exomind
    model: gpt-5.5
      metric: tokens / sessions / records
```

### 4. 语义指标层

回答: 这个值本质上是什么？

```ts
type SemanticMetric = {
  subject: ObservableSubject
  metric_role: "health" | "capacity" | "available" | "used" | "rate" | "rank" | "evidence"
  metric_identity:
    | "status"
    | "balance"
    | "quota"
    | "cost"
    | "tokens"
    | "requests"
    | "sessions"
    | "records"
    | "models"
    | "usage_percent"
    | "latency"
  time_behavior: "instant" | "window" | "cumulative" | "rate" | "trend" | "resetting"
  unit: "usd" | "cny" | "quota" | "credit" | "token" | "count" | "percent" | "ms" | "status" | "mixed"
  aggregation: "latest" | "sum" | "avg" | "max" | "delta" | "rank"
  knownness: "known" | "unknown" | "reported_zero" | "derived" | "planned"
}
```

`metric_identity` 是防止误混图的关键字段。`unit=usd` 只能说明量纲相同，不能说明语义相同；`cost`、`quota`、`balance` 默认分图。

## Intent Manifest

`IntentManifest` 是“问题到图表”的中间契约。它不直接指定 provider，也不直接指定 DOM，而是说明这个面板 lane 要回答什么。

```ts
type IntentManifest = {
  id: string
  name: string
  trigger_type: "always_on" | "threshold" | "manual" | "debug"
  question_type: "total" | "rank" | "composition" | "time_series" | "relationship" | "gap" | "anomaly"
  priority: "primary" | "secondary" | "audit"
  action_threshold?: {
    metric_identity: string
    operator: ">" | ">=" | "<" | "<=" | "==" | "!="
    value: number
    unit?: string
  }
  required_subjects: Array<ObservableSubject["subject_type"]>
  required_metrics: Array<Pick<SemanticMetric, "metric_role" | "metric_identity" | "unit" | "time_behavior">>
  candidate_widgets: string[]
  missing_data_policy: "show_missing_reason" | "hide_when_unconfigured" | "show_empty_state"
}
```

V0 默认意图:

| Intent | 问题 | 问题类型 | 推荐 widget |
|---|---|---|---|
| 感知通道 | 这个数据通道为什么有数据、没数据或暂时不可见？ | 异常定位 | capability-matrix |
| 连接健康 | 哪些来源、凭证和采集链路当前可信？ | 异常定位 | status-matrix |
| 余量风险 | 还能用多少，哪些余额或额度接近风险线？ | 差距 | reserve-card / bullet |
| 窗口消耗 | 近 6h/1d/7d 内成本、Token、请求如何变化？ | 时序 | window-trend |
| 累计画像 | 长期来看哪些模型、工作区、来源贡献主要消耗？ | 排序 | rank-table / bar |
| 证据审计 | 哪些数据未知、推导、报告 0、计划接入或未映射？ | 异常定位 | evidence-table |

## 问题类型到 Widget 的映射

| 问题类型 | 典型问题 | 合适感知通道 | 默认 widget | V0 边界 |
|---|---|---|---|---|
| 总量 | 当前用了多少？还有多少？ | latest / sum | metric-card | 只展示同一语义指标 |
| 排序 | 哪些模型/工作区最多？ | rank / sum | rank-table / bar | 排序口径必须可见 |
| 构成 | 消耗由哪些来源构成？ | group-by | stacked bar / matrix | 环图慎用，只用于少量稳定类别 |
| 时序 | 最近是否在变快/变慢？ | time series | trend | 成本、token、请求、余额分图 |
| 关系 | 请求数和成本是否相关？ | paired metrics | scatter / matrix | V0 暂缓为实验区 |
| 差距 | 距离用尽还有多远？ | available + capacity | reserve-card / bullet | 可用与已用分离 |
| 异常定位 | 为什么没有数据？哪里断了？ | source status / evidence | status-matrix / evidence-table | 缺失原因必须显式 |

## 缺失可观测性

“没有显示”必须拆成可解释状态:

| 状态 | 含义 | 呈现要求 |
|---|---|---|
| `unknown` | 语义上未知，不能当 0 | 显示未知，不参与合计 |
| `reported_zero` | 接口明确报告为 0 | 可画 0，但 tooltip 标注证据 |
| `auth_failed` | 凭证不可用 | 感知通道 lane 明确显示 |
| `no_data` | 请求成功但没有数据 | 显示空态，不说功能不存在 |
| `not_mapped` | 有旧接口/原始事实，但没接入新态势台 | 显示“未映射到统一模型” |
| `hidden_by_filter` | 有数据，被当前筛选隐藏 | 显示筛选提示 |
| `planned` | 规划接入，尚未实现 | 只进能力矩阵和路线，不进主指标 |

## 前端渲染鲁棒性约束

态势台首页的解释层不是“锦上添花”的附属区，而是用户理解当前面板为何如此呈现的主入口。因此，任何历史缓存、采样持久化、图表增强都不能反向打断首屏渲染链。

本轮闭环明确固化如下约束:

1. `recordCommandSnapshot` 属于**旁路持久化**，不是主渲染前置条件。
2. `localStorage` 写入失败、配额超限或存储不可用时，只能降级为:
   - 压缩历史点数与语义样本；
   - 放弃本次持久化并记录 `console.warn`；
   - 保留内存中的最新快照继续渲染。
3. 首屏解释层，包括 `首屏感知链`、`数据表征层 V1`、`面板呈现层 V1`、`Widget Registry`、`证据与可信度`、`Source Adapter 状态`，都必须在持久化失败时继续可见。
4. 趋势缓存属于**可失去的加速层**，不是事实层或语义层的真源；缓存损坏不能改变当前采样结果，只能影响历史长度。

推荐的降级阶梯:

```text
完整历史 -> 压缩历史点数与语义样本 -> 仅保留极短历史 -> 完全跳过持久化
```

验收信号:

- 页面强制刷新后，首页解释层仍完整渲染。
- 控制台允许出现持久化降级 `warn`，但不允许出现打断 `fetchCommandDemo` 或 `renderCommandDemo` 的未处理异常。
- 任意缓存失败都不应让用户误以为“没有数据”或“功能被删除”。

## 自动派生边界

真正的自动派生不是“写了一个专用 `renderModelTrend`”，而是系统看到这些语义事实后，自动提出候选视图:

```text
多个 model + tokens + cumulative/window -> 模型 Token 趋势 / 模型 Token 排行
多个 model + cost + known -> 模型成本分布
多个 source + balance + instant -> 中转余额趋势
多个 workspace + tokens + cumulative -> 工作区消耗 Top
knownness 包含 unknown/reported_zero -> 证据审计表
source_registry 中有 not_mapped/no_data -> 感知通道矩阵
```

V0 可以保留专用渲染函数，但它们必须消费语义投影和呈现蓝图，而不是绕过统一模型继续读 provider 私有字段。

## 趋势视图模式

趋势图默认由语义启发式选择视图模式:

| 模式 | 适合数据 | 规则 |
|---|---|---|
| `absolute` | 窗口消耗、比例、速率、少量同尺度数据 | 保留原始尺度 |
| `focused` | 余额、可用额度、容量等大基数小波动 | 非零起点聚焦轴，必须标注“聚焦轴” |
| `delta` | 累计 token、累计成本、累计会话 | 减去窗口首点，观察近期压力 |
| `normalized` | 多来源/多模型数量级跨度过大 | 按首个非零点折算百分比变化，tooltip 保留原始值 |

呈现底线:

1. 已用和可用默认分离。
2. 成本、余额、额度即使都是 USD 也默认分离。
3. Token、请求、会话、记录即使都是 count/token 家族也默认分离。
4. `unknown` 不画成 0。
5. `reported_zero` 可以画 0，但必须能追溯证据。

## V0 实施路径

1. 保留现有 Node demo，继续作为真实数据试验台。
2. 为 `/api/semantic-projection` 增加 `presentation_blueprint.lanes[].question`，让前端显式展示每个 lane 回答的问题。
3. 给 Source Registry、Signal、Dataset、Metric Group 补齐 `metric_identity` 与对象证据字段。
4. 让趋势分图键收束为:

```text
metric_role + time_behavior + metric_identity + unit_family + unit + subject_type
```

5. 让前端趋势图支持 `absolute / focused / delta / normalized`，并在图卡上明示当前模式。
6. 保留专用图表，但逐步让它们只消费语义层和派生层输出。
7. 在文档和测试中固化“未知不等于 0”“额度不等于余额”“来源不是默认一级分类”。

## 验收标准

本阶段做到以下几点，才算朝目标推进而不是只加了几个图:

- 能看到每个呈现 lane 正在回答的问题。
- 能解释某个数据源为什么没有出现在主面板。
- 同单位不同语义指标不会被放进同一趋势轴。
- Codex 成本未知不会被渲染成 `$0.00`。
- NewAPI 的 quota 不会被假装成 Sub2API 的 cost。
- 模型与工作区排行来自真实数据行，不允许硬编码榜单结论。
- 趋势图能按 `6h/1d/7d` 窗口观察，并根据语义使用绝对值、聚焦轴、增量或归一化视图。
- 文档说明 V0 边界，避免滑向完整 BI 或低代码 builder。

## 后续非目标

这些方向可以作为长期扩展，但不进入 V0 默认目标:

1. 任意拖拽仪表盘 builder。
2. 用户自定义公式系统。
3. 完整数据仓库和历史迁移。
4. 多用户权限系统。
5. 自动异常检测模型。
6. 对本地 Agent prompt/response 正文做采集。

ExoSense 当前最重要的是把个人态势观察的语义骨架立起来: 数据可以扩展，图表可以派生，缺失也能被解释。

---

## 翻译层与自适应生成数据面板的平衡方案

### 核心矛盾

**翻译层的需求**：
- 从意图出发做数据结构的约束（面向上层聚合呈现的图表）
- 做下层原始信号的转换（面向下层收集的各类信息）

**风险**：
- 翻译层容易导致定制化代码（为每个数据源写特定的转换逻辑）
- 定制化代码与「自适应生成数据面板」冲突（自适应意味着动态生成，定制化意味着静态配置）

### 平衡方案：声明式翻译层

**核心思想**：用声明式配置代替命令式代码

```javascript
// 声明式翻译规则（配置文件）
const translationRules = {
  'newapi': {
    'input_tokens': { target: 'system.model.tokens.input', unit: 'token' },
    'output_tokens': { target: 'system.model.tokens.output', unit: 'token' },
    'total_tokens': { target: 'system.model.tokens.total', unit: 'token' },
    'quota_used': { target: 'system.model.quota.used', unit: 'quota' },
  },
  'sub2api': {
    'input_tokens': { target: 'system.model.tokens.input', unit: 'token' },
    'output_tokens': { target: 'system.model.tokens.output', unit: 'token' },
    'total_tokens': { target: 'system.model.tokens.total', unit: 'token' },
    'cost': { target: 'system.model.cost.total', unit: 'usd' },
  },
  'codex': {
    'tokens_used': { target: 'system.model.tokens.total', unit: 'token' },
  },
};

// 通用翻译函数（命令式代码，但逻辑通用）
function translateSignal(source, rawData) {
  const rules = translationRules[source] || {};
  const translated = {};
  
  for (const [key, value] of Object.entries(rawData)) {
    if (rules[key]) {
      translated[rules[key].target] = {
        value,
        unit: rules[key].unit,
        source,
      };
    }
  }
  
  return translated;
}
```

### 与自适应生成数据面板的协同

**自适应生成数据面板的核心**：
- 根据可用数据动态生成面板
- 不预先定义固定的面板结构

**翻译层如何支持自适应**：
1. **元数据驱动**：翻译规则包含元数据（如 `metric_role`、`time_behavior`）
2. **动态发现**：面板根据翻译后的元数据动态发现可展示的数据
3. **语义推断**：翻译层自动推断语义（如 `input_tokens` → `metric_role: "used"`）

```javascript
// 翻译规则包含元数据
const translationRules = {
  'newapi': {
    'input_tokens': { 
      target: 'system.model.tokens.input', 
      unit: 'token',
      semantics: {
        metric_role: 'used',
        metric_identity: 'tokens',
        time_behavior: 'cumulative',
      }
    },
  },
};

// 自适应面板根据语义动态生成
function generatePanel(translatedSignals) {
  const panels = [];
  
  // 按 metric_role 分组
  const usedSignals = translatedSignals.filter(s => s.semantics.metric_role === 'used');
  if (usedSignals.length > 0) {
    panels.push({
      type: 'trend',
      title: '消耗趋势',
      signals: usedSignals,
    });
  }
  
  return panels;
}
```

### 平衡原则

1. **配置驱动**：翻译规则用配置文件定义，不是硬编码
2. **语义丰富**：翻译规则包含语义元数据，支持自适应生成
3. **通用逻辑**：翻译函数逻辑通用，不针对特定数据源
4. **动态发现**：面板根据翻译后的元数据动态发现可展示的数据

### 结论

**翻译层与自适应生成数据面板可以协同工作**，关键是：
- 用声明式配置代替命令式代码
- 翻译规则包含丰富的语义元数据
- 面板根据语义元数据动态生成，不预先定义固定结构

这样既能完成数据转换，又不会导致过度定制化，还能支持自适应生成数据面板。

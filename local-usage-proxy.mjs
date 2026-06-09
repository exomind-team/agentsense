import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
loadLocalEnvFile(path.join(root, '.agentsense.local.env'));
const upstream = 'http://127.0.0.1:7892';
const port = Number(process.env.AGENTSENSE_PROXY_PORT || 7894);
const shouldStartServer = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

function loadLocalEnvFile(file) {
  if (!fs.existsSync(file)) return;

  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      let value = rawValue.trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // 本地配置只作为便捷入口；读取失败时保持显式环境变量优先。
  }
}

function asNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function workspaceLabel(rawPath) {
  return normalizeWorkspacePath(rawPath)
    .split('/')
    .filter(Boolean)
    .at(-1) || String(rawPath || '');
}

function normalizeWorkspacePath(rawPath) {
  return String(rawPath || '')
    .replace(/^\\\\\?\\/, '')
    .replaceAll('\\', '/')
    .replace(/\/+$/, '');
}

function workspaceKey(rawPath, fallbackLabel) {
  const value = normalizeWorkspacePath(rawPath || fallbackLabel || 'unknown').trim();
  return value.toLowerCase() || 'unknown';
}

function workspacePath(rawPath, fallbackLabel) {
  return normalizeWorkspacePath(rawPath || fallbackLabel || 'unknown') || 'unknown';
}

function projectTokenTotal(project) {
  if (project?.tokens !== null && project?.tokens !== undefined && Number.isFinite(Number(project.tokens))) {
    return Number(project.tokens);
  }
  return asNumber(project?.input_tokens)
    + asNumber(project?.output_tokens)
    + asNumber(project?.cache_read_tokens)
    + asNumber(project?.cache_creation_tokens);
}

function fileSourceStatus(id, kind, label, file, capabilities) {
  if (!fs.existsSync(file)) {
    return {
      id,
      kind,
      label,
      enabled: true,
      state: 'missing',
      message: `${path.basename(file)} not found`,
      capabilities,
    };
  }

  const stat = fs.statSync(file);
  return {
    id,
    kind,
    label,
    enabled: true,
    state: 'ok',
    last_read_at: new Date(stat.mtimeMs).toISOString(),
    capabilities,
  };
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/Authorization\s*:\s*Bearer\s+[^\s,;，；]+/gi, 'Authorization: [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._+\-/=]{12,}/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, 'sk-[redacted]')
    .replace(/\b(api[-_ ]?key|token|cookie|secret|authorization)(\s*[:=：]\s*)([^\s,;，；]{6,})/gi, '$1$2[redacted]')
    .replace(/\b(令牌|密钥|凭证)(\s*[:=：]\s*)([^\s,;，；]{6,})/gi, '$1$2[redacted]');
}

function timestampToIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function costStatus(project) {
  if (project?.cost_known !== false && project?.cost_usd !== null && project?.cost_usd !== undefined) {
    return 'known';
  }
  return 'unknown';
}

function recordKinds(project) {
  const kinds = new Set(Array.isArray(project?.record_kinds) ? project.record_kinds : []);
  if (project?.record_kind) kinds.add(project.record_kind);
  return [...kinds].filter(Boolean);
}

function recordBreakdown(project) {
  const rows = [];
  if (Array.isArray(project?.record_breakdown)) {
    for (const item of project.record_breakdown) {
      if (!item || typeof item !== 'object') continue;
      const count = asNumber(item.count);
      if (!count) continue;
      rows.push({
        source: String(item.source || item.label || 'unknown'),
        kind: String(item.kind || item.record_kind || 'record'),
        count,
        synthetic: Boolean(item.synthetic),
      });
    }
  }

  if (!rows.length) {
    const sources = Array.isArray(project?.sources) && project.sources.length ? project.sources : ['unknown'];
    const kinds = recordKinds(project);
    const kind = kinds.length === 1 ? kinds[0] : (project?.record_kind || 'record');
    const count = asNumber(project?.record_count) || asNumber(project?.sessions) || 1;
    for (const source of sources) {
      rows.push({ source: String(source || 'unknown'), kind, count, synthetic: true });
    }
  }

  return rows;
}

function mergeRecordBreakdown(existing, nextRows) {
  const map = new Map();
  for (const row of [...(existing || []), ...(nextRows || [])]) {
    const source = String(row?.source || 'unknown');
    const kind = String(row?.kind || 'record');
    const count = asNumber(row?.count);
    if (!count) continue;
    const key = `${source}::${kind}`;
    const current = map.get(key) || { source, kind, count: 0, synthetic: true };
    current.count += count;
    current.synthetic = Boolean(current.synthetic && row?.synthetic);
    map.set(key, current);
  }
  return [...map.values()]
    .map(row => row.synthetic ? row : { source: row.source, kind: row.kind, count: row.count })
    .sort((a, b) =>
      String(a.source).localeCompare(String(b.source)) ||
      String(a.kind).localeCompare(String(b.kind))
    );
}

function sqliteReadOnly(file, callback) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrapApiData(value) {
  return isObject(value) && 'data' in value && isObject(value.data) ? value.data : value;
}

function businessOk(value) {
  if (!isObject(value)) return true;
  if (typeof value.success === 'boolean') return value.success;
  if (typeof value.code === 'boolean') return value.code;
  if (typeof value.code === 'number') return value.code === 0 || value.code === 200;
  if (typeof value.code === 'string') {
    const code = value.code.toLowerCase();
    return code === 'ok' || code === 'true' || code === '0' || code === '200';
  }
  return true;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function quotaDisplayConfig(statusData) {
  const data = unwrapApiData(statusData);
  const displayType = String(data?.quota_display_type || '').toUpperCase();
  const quotaPerUnit = firstFiniteNumber(data?.quota_per_unit);
  const usdExchangeRate = firstFiniteNumber(data?.usd_exchange_rate);

  return {
    displayType,
    quotaPerUnit,
    usdExchangeRate,
  };
}

function convertQuotaValue(value, display) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (display?.displayType === 'USD' && display.quotaPerUnit) return number / display.quotaPerUnit;
  if (display?.displayType === 'CNY' && display.quotaPerUnit) {
    const usd = number / display.quotaPerUnit;
    return display.usdExchangeRate ? usd * display.usdExchangeRate : usd;
  }
  return number;
}

function quotaDisplayUnit(display) {
  if (display?.displayType === 'USD') return 'usd';
  if (display?.displayType === 'CNY') return 'cny';
  if (display?.displayType === 'TOKENS') return 'token';
  return 'quota';
}

function semanticUnit(unit) {
  const normalized = String(unit || '').toLowerCase();
  if (['usd', 'cny', 'quota', 'credit'].includes(normalized)) return normalized;
  if (['token', 'count', 'percent', 'ms', 'status'].includes(normalized)) return normalized;
  return normalized || 'status';
}

function unitFamily(unit) {
  const normalized = semanticUnit(unit);
  if (['usd', 'cny'].includes(normalized)) return 'currency';
  if (['quota', 'credit'].includes(normalized)) return 'quota';
  if (normalized === 'token') return 'token';
  if (normalized === 'percent') return 'ratio';
  if (normalized === 'count') return 'count';
  if (normalized === 'ms') return 'latency';
  return 'status';
}

function signalKnownness(signal) {
  if (!signal || signal.value === null || signal.value === undefined) return 'unknown';
  if (signal.confidence === 'derived') return 'derived';
  const value = Number(signal.value);
  if (
    Number.isFinite(value)
    && value === 0
    && signal.confidence === 'reported'
    && String(signal.path || '').includes('.cost.')
  ) {
    return 'reported_zero';
  }
  return 'known';
}

function signalSemantics(signal) {
  const pathName = String(signal?.path || '');
  const kind = String(signal?.kind || '');
  const unit = semanticUnit(signal?.unit);
  let metricRole = 'evidence';
  let timeBehavior = 'instant';
  let subjectType = 'source';
  let aggregation = 'latest';
  let direction = 'neutral';

  if (kind === 'health' || pathName.includes('.sources.ok.')) {
    metricRole = 'health';
    subjectType = 'source';
    aggregation = 'sum';
    direction = 'higher_better';
  } else if (pathName.includes('.quota.total')) {
    metricRole = 'capacity';
    subjectType = 'account';
  } else if (pathName.includes('.available') || pathName.includes('.balance.available')) {
    metricRole = 'available';
    subjectType = pathName.includes('sub2api') ? 'api_key' : 'account';
    direction = 'risk_when_low';
  } else if (kind === 'rate' || pathName.endsWith('.rpm') || pathName.endsWith('.tpm')) {
    metricRole = 'rate';
    timeBehavior = 'rate';
    subjectType = 'api_key';
    aggregation = 'avg';
    direction = 'risk_when_high';
  } else if (kind === 'usage' || pathName.includes('.usage.') || pathName.includes('.tokens.') || pathName.includes('.cost.') || pathName.includes('.requests.')) {
    metricRole = 'used';
    subjectType = pathName.includes('sub2api') ? 'api_key' : (pathName.includes('newapi') ? 'account' : 'workspace');
    aggregation = 'sum';
    if (pathName.includes('.today')) timeBehavior = 'window';
    else if (pathName.includes('.total') || pathName.includes('.aggregate') || pathName.includes('.used')) timeBehavior = 'cumulative';
    if (unit === 'percent') {
      timeBehavior = 'instant';
      direction = 'risk_when_high';
    }
  } else if (kind === 'inventory' || pathName.includes('.count')) {
    metricRole = 'evidence';
    aggregation = 'sum';
    subjectType = pathName.includes('model') ? 'model' : (pathName.includes('project') ? 'workspace' : 'source');
  }

  return {
    metric_role: metricRole,
    time_behavior: timeBehavior,
    unit,
    unit_family: unitFamily(unit),
    direction,
    subject_type: subjectType,
    aggregation,
    knownness: signalKnownness(signal),
  };
}

function withSignalSemantics(signal) {
  return {
    ...signal,
    semantics: signalSemantics(signal),
  };
}

const SEMANTIC_ROLE_LABELS = {
  health: '连接健康',
  capacity: '容量总量',
  available: '余量风险',
  used: '已用消耗',
  rate: '使用速率',
  rank: '贡献排行',
  evidence: '证据审计',
};

const SEMANTIC_TIME_LABELS = {
  instant: '瞬时',
  window: '窗口',
  cumulative: '累计',
  rate: '速率',
  trend: '趋势',
  resetting: '周期重置',
};

const SEMANTIC_SUBJECT_LABELS = {
  source: '来源',
  model: '模型',
  workspace: '工作区',
  account: '账户',
  api_key: 'API Key',
  device: '设备',
  task: '任务',
};

const SEMANTIC_UNIT_FAMILY_LABELS = {
  currency: '货币',
  quota: '额度',
  token: 'Token',
  count: '次数',
  ratio: '比例',
  latency: '延迟',
  status: '状态',
  mixed: '混合量纲',
};

const WIDGET_REGISTRY = [
  {
    id: 'status-matrix',
    name: '连接状态矩阵',
    purpose: '展示 source、凭证、接口和计划接入状态。',
    match: 'metric_role=health 或 source state',
  },
  {
    id: 'capability-matrix',
    name: '追踪源能力矩阵',
    purpose: '展示代码能力、配置、采集、态势台接入和视图可见性，解释为什么没有数据。',
    match: 'dataset=source_registry',
  },
  {
    id: 'reserve-card',
    name: '余量风险卡',
    purpose: '展示余额、可用额度、剩余百分比等还能用多少的问题。',
    match: 'metric_role=available/capacity',
  },
  {
    id: 'relay-zone',
    name: '中转专区',
    purpose: '展示 NewAPI/Sub2API 这类账户或 key 级额度、余额、用量和趋势。',
    match: 'subject_type=account/api_key',
  },
  {
    id: 'window-trend',
    name: '窗口趋势图',
    purpose: '展示近 6h、1d、7d 等窗口内同量纲变化。',
    match: 'time_behavior=window/trend/rate',
  },
  {
    id: 'rank-table',
    name: '贡献排行表',
    purpose: '展示模型、工作区、来源等对象的 Top 贡献。',
    match: 'metric_role=rank 或可排序 Dataset',
  },
  {
    id: 'evidence-table',
    name: '证据审计表',
    purpose: '展示 unknown、reported_zero、derived、planned 和来源证据。',
    match: 'metric_role=evidence 或 knownness 非普通已知',
  },
  {
    id: 'metric-card',
    name: '指标卡',
    purpose: '展示无法归入专门组件的单点指标。',
    match: 'fallback',
  },
];

const DATASET_SEMANTICS = {
  alerts: {
    name: '态势提示',
    rows_subject_type: 'source',
    primary_metric_role: 'health',
    primary_unit: 'status',
    time_behavior: 'instant',
    aggregation: 'latest',
    widget_hint: 'status-matrix',
    allowed_group_by: ['source', 'severity'],
    allowed_sort_by: ['severity'],
  },
  source_registry: {
    name: '追踪源能力矩阵',
    rows_subject_type: 'source',
    primary_metric_role: 'health',
    primary_unit: 'status',
    time_behavior: 'instant',
    aggregation: 'latest',
    widget_hint: 'capability-matrix',
    allowed_group_by: ['category', 'configuration_state', 'collection_state', 'command_demo_adapter', 'visibility_state'],
    allowed_sort_by: ['category', 'configuration_state', 'collection_state', 'label'],
  },
  top_models: {
    name: '模型消耗 Top',
    rows_subject_type: 'model',
    primary_metric_role: 'rank',
    primary_unit: 'mixed',
    time_behavior: 'cumulative',
    aggregation: 'rank',
    widget_hint: 'rank-table',
    allowed_group_by: ['source', 'unit', 'knownness'],
    allowed_sort_by: ['cost', 'tokens', 'requests', 'source'],
  },
  top_projects: {
    name: '工作区消耗 Top',
    rows_subject_type: 'workspace',
    primary_metric_role: 'rank',
    primary_unit: 'mixed',
    time_behavior: 'cumulative',
    aggregation: 'rank',
    widget_hint: 'rank-table',
    allowed_group_by: ['source', 'knownness'],
    allowed_sort_by: ['tokens', 'cost', 'records'],
  },
  newapi_attempts: {
    name: 'NewAPI 鉴权尝试',
    rows_subject_type: 'account',
    primary_metric_role: 'evidence',
    primary_unit: 'status',
    time_behavior: 'instant',
    aggregation: 'latest',
    widget_hint: 'evidence-table',
    allowed_group_by: ['status'],
    allowed_sort_by: ['attempt'],
  },
  newapi_model_stats: {
    name: 'NewAPI 模型统计',
    rows_subject_type: 'model',
    primary_metric_role: 'used',
    primary_unit: 'quota',
    time_behavior: 'cumulative',
    aggregation: 'sum',
    widget_hint: 'relay-zone',
    allowed_group_by: ['model'],
    allowed_sort_by: ['quota', 'tokens', 'requests'],
  },
  sub2api_model_stats: {
    name: 'Sub2API 模型统计',
    rows_subject_type: 'model',
    primary_metric_role: 'used',
    primary_unit: 'mixed',
    time_behavior: 'cumulative',
    aggregation: 'sum',
    widget_hint: 'relay-zone',
    allowed_group_by: ['model', 'unit'],
    allowed_sort_by: ['cost', 'tokens', 'requests'],
  },
  codex_model_stats: {
    name: 'Codex 模型统计',
    rows_subject_type: 'model',
    primary_metric_role: 'used',
    primary_unit: 'token',
    time_behavior: 'cumulative',
    aggregation: 'sum',
    widget_hint: 'rank-table',
    allowed_group_by: ['provider', 'model'],
    allowed_sort_by: ['tokens', 'sessions'],
  },
  cc_switch_model_stats: {
    name: 'CC Switch 模型统计',
    rows_subject_type: 'model',
    primary_metric_role: 'used',
    primary_unit: 'mixed',
    time_behavior: 'cumulative',
    aggregation: 'sum',
    widget_hint: 'rank-table',
    allowed_group_by: ['provider', 'model', 'app'],
    allowed_sort_by: ['cost', 'tokens', 'requests'],
  },
  model_daily_trend: {
    name: '模型日趋势',
    rows_subject_type: 'model',
    primary_metric_role: 'used',
    primary_unit: 'mixed',
    time_behavior: 'trend',
    aggregation: 'sum',
    widget_hint: 'window-trend',
    allowed_group_by: ['model', 'unit'],
    allowed_sort_by: ['date'],
    allowed_windows: ['7d'],
  },
  model_trends: {
    name: '模型窗口趋势',
    rows_subject_type: 'model',
    primary_metric_role: 'used',
    primary_unit: 'mixed',
    time_behavior: 'trend',
    aggregation: 'sum',
    widget_hint: 'window-trend',
    allowed_group_by: ['model', 'unit'],
    allowed_sort_by: ['bucket'],
    allowed_windows: ['6h', '1d', '7d'],
  },
};

function semanticLabel(map, key) {
  return map[key] || key || '--';
}

function semanticWidgetFor(semantics = {}) {
  const role = semantics.metric_role || semantics.primary_metric_role;
  const subject = semantics.subject_type || semantics.rows_subject_type;
  const timeBehavior = semantics.time_behavior;
  const knownness = semantics.knownness;

  if (knownness && knownness !== 'known' && knownness !== 'reported_zero') return 'evidence-table';
  if (role === 'health') return 'status-matrix';
  if (role === 'rank') return 'rank-table';
  if (role === 'evidence') return 'evidence-table';
  if (['window', 'trend', 'rate'].includes(timeBehavior) || role === 'rate') return 'window-trend';
  if (subject === 'account' || subject === 'api_key') return 'relay-zone';
  if (role === 'available' || role === 'capacity') return 'reserve-card';
  return 'metric-card';
}

function datasetSemantics(datasetId) {
  return DATASET_SEMANTICS[datasetId] || {
    name: datasetId,
    rows_subject_type: 'source',
    primary_metric_role: 'evidence',
    primary_unit: 'status',
    time_behavior: 'instant',
    aggregation: 'latest',
    widget_hint: 'evidence-table',
    allowed_group_by: [],
    allowed_sort_by: [],
  };
}

function datasetItemCount(dataset) {
  if (Array.isArray(dataset)) return dataset.length;
  if (!dataset || typeof dataset !== 'object') return dataset ? 1 : 0;
  return Object.keys(dataset).length;
}

function buildSemanticMetricGroups(signals = []) {
  const groups = new Map();
  for (const signal of Array.isArray(signals) ? signals : []) {
    const semantics = signal?.semantics || signalSemantics(signal);
    const key = [
      semantics.metric_role,
      semantics.time_behavior,
      semantics.unit_family,
      semantics.subject_type,
    ].join('|');
    const current = groups.get(key) || {
      id: `metric-${groups.size + 1}`,
      metric_role: semantics.metric_role,
      metric_role_label: semanticLabel(SEMANTIC_ROLE_LABELS, semantics.metric_role),
      time_behavior: semantics.time_behavior,
      time_behavior_label: semanticLabel(SEMANTIC_TIME_LABELS, semantics.time_behavior),
      unit_family: semantics.unit_family,
      unit_family_label: semanticLabel(SEMANTIC_UNIT_FAMILY_LABELS, semantics.unit_family),
      subject_type: semantics.subject_type,
      subject_type_label: semanticLabel(SEMANTIC_SUBJECT_LABELS, semantics.subject_type),
      aggregation: semantics.aggregation,
      direction: semantics.direction,
      widget_hint: semanticWidgetFor(semantics),
      count: 0,
      units: new Set(),
      knownness: new Set(),
      signal_ids: [],
      sample_paths: [],
    };
    current.count += 1;
    current.units.add(semantics.unit);
    current.knownness.add(semantics.knownness);
    current.signal_ids.push(signal.id || signal.path);
    if (current.sample_paths.length < 4) current.sample_paths.push(signal.path || signal.id || '--');
    groups.set(key, current);
  }

  const roleOrder = ['health', 'available', 'capacity', 'used', 'rate', 'rank', 'evidence'];
  return [...groups.values()]
    .map(group => ({
      ...group,
      name: `${group.metric_role_label} · ${group.unit_family_label} · ${group.subject_type_label}`,
      units: [...group.units].sort(),
      knownness: [...group.knownness].sort(),
    }))
    .sort((a, b) =>
      roleOrder.indexOf(a.metric_role) - roleOrder.indexOf(b.metric_role)
      || a.unit_family.localeCompare(b.unit_family)
      || a.subject_type.localeCompare(b.subject_type)
    );
}

function buildSemanticDatasetGroups(datasets = {}) {
  return Object.entries(datasets || {}).map(([datasetId, dataset]) => {
    const semantics = datasetSemantics(datasetId);
    const primaryUnit = semantics.primary_unit || 'status';
    return {
      id: `dataset-${datasetId}`,
      name: semantics.name || datasetId,
      dataset_id: datasetId,
      rows_subject_type: semantics.rows_subject_type,
      rows_subject_label: semanticLabel(SEMANTIC_SUBJECT_LABELS, semantics.rows_subject_type),
      primary_metric_role: semantics.primary_metric_role,
      primary_metric_label: semanticLabel(SEMANTIC_ROLE_LABELS, semantics.primary_metric_role),
      primary_unit: primaryUnit,
      primary_unit_family: primaryUnit === 'mixed' ? 'mixed' : unitFamily(primaryUnit),
      time_behavior: semantics.time_behavior,
      aggregation: semantics.aggregation,
      widget_hint: semantics.widget_hint || semanticWidgetFor(semantics),
      allowed_group_by: semantics.allowed_group_by || [],
      allowed_sort_by: semantics.allowed_sort_by || [],
      allowed_windows: semantics.allowed_windows || [],
      row_count: datasetItemCount(dataset),
    };
  }).sort((a, b) => {
    const widgetRank = ['status-matrix', 'capability-matrix', 'relay-zone', 'window-trend', 'rank-table', 'evidence-table', 'metric-card'];
    const rankOf = widget => {
      const idx = widgetRank.indexOf(widget);
      return idx === -1 ? widgetRank.length : idx;
    };
    return rankOf(a.widget_hint) - rankOf(b.widget_hint)
      || a.name.localeCompare(b.name);
    });
}

function envPresent(name) {
  return String(process.env[name] || '').trim().length > 0;
}

function anyEnvPresent(names = []) {
  return names.some(name => envPresent(name));
}

function sourceById(sources = [], id) {
  return (Array.isArray(sources) ? sources : []).find(source => source?.id === id);
}

function sourceCollectionState(source) {
  const state = source?.state || 'unknown';
  if (state === 'ok') return 'ok';
  if (state === 'auth_failed') return 'auth_failed';
  if (state === 'missing') return 'missing';
  if (state === 'disabled') return 'disabled';
  if (state === 'planned') return 'planned';
  if (state === 'no_data') return 'no_data';
  if (state === 'waiting') return 'waiting';
  if (state === 'unavailable' || state === 'error' || state === 'stale') return 'fetch_failed';
  return 'unknown';
}

function registryCounts(registry = [], field) {
  return labeledCounts(countBy(registry, entry => entry?.[field] || 'unknown'), {
    present: '能力存在',
    absent: '能力缺失',
    planned: '计划接入',
    configured: '已配置',
    not_configured: '未配置',
    unknown: '未知',
    ok: '可采集',
    waiting: '等待数据',
    auth_failed: '鉴权失败',
    fetch_failed: '采集失败',
    no_data: '无数据',
    missing: '缺失',
    disabled: '禁用',
    connected: '已接入',
    not_connected: '未接入',
    visible: '可见',
    hidden_no_data: '无数据隐藏',
    not_in_command_demo: '未进态势台',
  });
}

function registryEntryFromSource(source, overrides = {}) {
  const adapter = overrides.command_demo_adapter || 'connected';
  const collection = overrides.collection_state || sourceCollectionState(source);
  const configuration = overrides.configuration_state
    || (source?.enabled === false ? 'not_configured' : (source?.state === 'missing' ? 'not_configured' : 'configured'));
  const visibility = overrides.visibility_state
    || (adapter === 'connected' ? 'visible' : (adapter === 'planned' ? 'planned' : 'not_in_command_demo'));
  const missingItems = [
    ...(Array.isArray(overrides.missing_items) ? overrides.missing_items : []),
  ];
  if (adapter === 'not_connected' && !missingItems.includes('统一 Source/Signal/Dataset adapter')) {
    missingItems.push('统一 Source/Signal/Dataset adapter');
  }
  if (configuration === 'not_configured' && !missingItems.includes('本地配置或凭证')) {
    missingItems.push('本地配置或凭证');
  }

  return {
    id: overrides.id || source?.id || 'unknown-source',
    label: overrides.label || source?.label || source?.id || '未知来源',
    category: overrides.category || 'local',
    code_capability: overrides.code_capability || 'present',
    legacy_api: overrides.legacy_api || [],
    command_demo_adapter: adapter,
    configuration_state: configuration,
    collection_state: collection,
    visibility_state: visibility,
    last_sample_at: overrides.last_sample_at || source?.last_read_at,
    missing_items: missingItems,
    message: overrides.message || source?.message || '',
    source_state: source?.state,
    capabilities: overrides.capabilities || source?.capabilities || [],
  };
}

function buildLegacyProviderEntry({
  id,
  label,
  category = 'legacy_provider',
  envNames = [],
  credentialFile,
  legacyApi = [],
  message,
}) {
  const configured = anyEnvPresent(envNames) || (credentialFile ? fs.existsSync(credentialFile) : false);
  return registryEntryFromSource(null, {
    id,
    label,
    category,
    code_capability: 'present',
    legacy_api: legacyApi,
    command_demo_adapter: 'not_connected',
    configuration_state: configured ? 'configured' : 'not_configured',
    collection_state: configured ? 'waiting' : 'missing',
    visibility_state: 'not_in_command_demo',
    missing_items: [
      configured ? '统一 Source/Signal/Dataset adapter' : '本地配置或凭证',
      '统一态势台映射',
    ],
    message: message || (configured
      ? '旧接口能力存在，但暂未映射到新态势台。'
      : '旧接口能力存在；缺少配置，旧 tab 也可能动态隐藏。'),
  });
}

function buildSourceRegistry({ sources = [], usage = {}, codex = {}, ccSwitch = {}, newApi = {}, sub2Api = {}, home = os.homedir() } = {}) {
  const entries = [];
  const add = entry => {
    if (!entry || entries.some(item => item.id === entry.id)) return;
    entries.push(entry);
  };

  const claudeCodeSource = sourceById(sources, 'claude-code-local');
  if (claudeCodeSource) add(registryEntryFromSource(claudeCodeSource, {
    category: 'local_agent',
    configuration_state: usage.configured ? 'configured' : 'not_configured',
    collection_state: usage.status?.state === 'ok' ? 'ok' : sourceCollectionState(claudeCodeSource),
    missing_items: usage.configured ? [] : ['.claude.json projects 聚合字段'],
  }));
  const codexSource = sourceById(sources, 'codex-local');
  if (codexSource) add(registryEntryFromSource(codexSource, {
    category: 'local_agent',
    configuration_state: codex.configured ? 'configured' : (codexSource.state === 'ok' ? 'configured' : 'not_configured'),
    collection_state: codex.status?.state === 'ok' ? 'ok' : sourceCollectionState(codexSource),
    missing_items: codex.status?.state === 'ok' ? [] : ['~/.codex/state_5.sqlite'],
  }));
  const ccSwitchSource = sourceById(sources, 'cc-switch');
  if (ccSwitchSource) add(registryEntryFromSource(ccSwitchSource, {
    category: 'local_agent',
    configuration_state: ccSwitch.configured ? 'configured' : (ccSwitchSource.state === 'ok' ? 'configured' : 'not_configured'),
    collection_state: ccSwitch.status?.state === 'ok' ? 'ok' : sourceCollectionState(ccSwitchSource),
    missing_items: ccSwitch.status?.state === 'ok' ? [] : ['~/.cc-switch/cc-switch.db'],
  }));
  const newApiSource = sourceById(sources, 'newapi-main');
  if (newApiSource) add(registryEntryFromSource(newApiSource, {
    category: 'relay',
    configuration_state: envPresent('AGENTSENSE_NEWAPI_BASE_URL') && envPresent('AGENTSENSE_NEWAPI_TOKEN') ? 'configured' : 'not_configured',
    collection_state: sourceCollectionState(newApi.source || newApiSource),
    missing_items: (envPresent('AGENTSENSE_NEWAPI_BASE_URL') && envPresent('AGENTSENSE_NEWAPI_TOKEN')) ? [] : ['AGENTSENSE_NEWAPI_BASE_URL', 'AGENTSENSE_NEWAPI_TOKEN'],
  }));
  const sub2ApiSource = sourceById(sources, 'sub2api-main');
  if (sub2ApiSource) add(registryEntryFromSource(sub2ApiSource, {
    category: 'relay',
    configuration_state: envPresent('AGENTSENSE_SUB2API_BASE_URL') && anyEnvPresent(['AGENTSENSE_SUB2API_API_KEY', 'AGENTSENSE_SUB2API_KEY']) ? 'configured' : 'not_configured',
    collection_state: sourceCollectionState(sub2Api.source || sub2ApiSource),
    missing_items: (envPresent('AGENTSENSE_SUB2API_BASE_URL') && anyEnvPresent(['AGENTSENSE_SUB2API_API_KEY', 'AGENTSENSE_SUB2API_KEY'])) ? [] : ['AGENTSENSE_SUB2API_BASE_URL', 'AGENTSENSE_SUB2API_API_KEY'],
  }));
  const windowsPowerSource = sourceById(sources, 'windows-power');
  if (windowsPowerSource) add(registryEntryFromSource(windowsPowerSource, {
    category: 'device',
    code_capability: 'planned',
    command_demo_adapter: 'planned',
    configuration_state: 'unknown',
    collection_state: 'planned',
    visibility_state: 'planned',
    missing_items: ['系统 API adapter'],
  }));

  add(buildLegacyProviderEntry({
    id: 'minimax-cn-legacy',
    label: 'MiniMax 国内版',
    envNames: ['MINIMAX_API_KEY'],
    legacyApi: ['/api/quota', '/api/history', '/api/consumption', '/api/weekly-history'],
  }));
  add(buildLegacyProviderEntry({
    id: 'deepseek-api-legacy',
    label: 'DeepSeek API balance',
    envNames: ['DEEPSEEK_API_KEY'],
    legacyApi: ['/api/deepseek', '/api/deepseek/history'],
  }));
  add(buildLegacyProviderEntry({
    id: 'deepseek-platform-legacy',
    label: 'DeepSeek platform usage',
    envNames: ['DEEPSEEK_BEARER_TOKEN', 'DEEPSEEK_COOKIE'],
    legacyApi: ['/api/deepseek/platform?days=30'],
  }));
  add(buildLegacyProviderEntry({
    id: 'zai-glm-legacy',
    label: 'GLM/Z.AI',
    envNames: ['ZAI_AUTH_TOKEN', 'GLM_CN_TOKEN'],
    legacyApi: ['/api/zai', '/api/zai/history', '/api/zai/models'],
  }));
  add(buildLegacyProviderEntry({
    id: 'claude-subscription-legacy',
    label: 'Claude 订阅配额',
    credentialFile: path.join(home, '.claude', '.credentials.json'),
    legacyApi: ['/api/claude', '/api/claude/history'],
    message: '这是 Claude 订阅配额通道，不等同于 Claude Code 本地 usage 聚合。',
  }));
  add(buildLegacyProviderEntry({
    id: 'mimo-legacy',
    label: 'MiMo',
    envNames: ['MIMO_COOKIE'],
    legacyApi: ['/api/mimo', '/api/mimo/history'],
  }));

  return entries.map(entry => ({
    ...entry,
    missing_items: [...new Set((entry.missing_items || []).filter(Boolean).map(redactSensitiveText))],
    message: redactSensitiveText(entry.message),
  }));
}

function buildEvidenceNotes({ sources = [], signals = [], datasets = {}, sourceRegistry = [] } = {}) {
  const notes = [];
  const add = (id, severity, message, relatedIds = []) => {
    notes.push({ id, severity, message, related_ids: relatedIds.filter(Boolean) });
  };

  for (const source of Array.isArray(sources) ? sources : []) {
    if (source.state === 'ok') continue;
    const severity = source.state === 'planned' || source.state === 'disabled' || source.state === 'missing'
      ? 'info'
      : source.state === 'auth_failed' || source.state === 'unavailable'
        ? 'warning'
        : 'risk';
    add(
      `source-${source.id || source.kind}`,
      severity,
      `${source.label || source.id || '未知来源'} 当前状态为 ${source.state || 'unknown'}，应作为连接健康信息呈现，不参与用量合计。`,
      [source.id]
    );
  }

  for (const entry of Array.isArray(sourceRegistry) ? sourceRegistry : []) {
    if (entry.command_demo_adapter === 'not_connected') {
      add(
        `registry-${entry.id}-not-connected`,
        entry.configuration_state === 'configured' ? 'warning' : 'info',
        `${entry.label || entry.id} 代码能力存在，但尚未接入新态势台；缺失项：${(entry.missing_items || []).join('、') || '统一 adapter'}。`,
        [entry.id]
      );
    } else if (entry.collection_state === 'no_data') {
      add(
        `registry-${entry.id}-no-data`,
        'info',
        `${entry.label || entry.id} 已接入但当前没有可展示数据，应显示为空状态而不是静默消失。`,
        [entry.id]
      );
    }
  }

  for (const signal of Array.isArray(signals) ? signals : []) {
    const semantics = signal.semantics || signalSemantics(signal);
    if (semantics.knownness === 'unknown') {
      add(
        `signal-${signal.id || signal.path}-unknown`,
        'warning',
        `${signal.path || signal.id || '未知 Signal'} 当前值未知，不能按 0 参与聚合。`,
        [signal.id]
      );
    } else if (semantics.knownness === 'reported_zero') {
      add(
        `signal-${signal.id || signal.path}-reported-zero`,
        'info',
        `${signal.path || signal.id || '未知 Signal'} 是接口明确报告的 0，应与未知值区分。`,
        [signal.id]
      );
    } else if (semantics.knownness === 'derived') {
      add(
        `signal-${signal.id || signal.path}-derived`,
        'info',
        `${signal.path || signal.id || '未知 Signal'} 是派生聚合值，前端应展示其证据质量。`,
        [signal.id]
      );
    } else if (semantics.knownness === 'planned') {
      add(
        `signal-${signal.id || signal.path}-planned`,
        'info',
        `${signal.path || signal.id || '未知 Signal'} 仍是计划接入项，不能混入真实数据。`,
        [signal.id]
      );
    }
  }

  const projects = Array.isArray(datasets.top_projects) ? datasets.top_projects : [];
  const unknownProjectCosts = projects.filter(project => project.cost_known === false).length;
  if (unknownProjectCosts) {
    add(
      'dataset-top-projects-unknown-cost',
      'warning',
      `工作区榜有 ${unknownProjectCosts} 个条目的成本未知；它们只能参与 Token/记录视角，不能伪装为 0 成本。`,
      ['top_projects']
    );
  }

  if (Array.isArray(datasets.newapi_model_stats) && datasets.newapi_model_stats.length) {
    add(
      'dataset-newapi-quota-not-cost',
      'info',
      'NewAPI 模型统计使用 quota/credit 口径，不应并入 USD 成本分布。',
      ['newapi_model_stats']
    );
  }

  const severityRank = {
    risk: 0,
    error: 0,
    warning: 1,
    info: 2,
  };
  const sortedNotes = notes.sort((a, b) =>
    (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3)
    || String(a.id).localeCompare(String(b.id))
  );
  if (sortedNotes.length <= 18) return sortedNotes;
  return [
    ...sortedNotes.slice(0, 17),
    {
      id: 'evidence-notes-truncated',
      severity: 'info',
      message: `还有 ${sortedNotes.length - 17} 条证据说明已折叠；完整排查时应查看 semantic_projection.evidence_notes 原始数据。`,
      related_ids: [],
    },
  ];
}

function countBy(items, pickKey) {
  const counts = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = pickKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

function labeledCounts(counts, labels = {}) {
  return counts.map(item => ({
    ...item,
    label: semanticLabel(labels, item.id),
  }));
}

function buildDataRepresentationBlueprint({ sources = [], signals = [], metricGroups = [], datasetGroups = [], sourceRegistry = [] } = {}) {
  const enrichedSignals = (Array.isArray(signals) ? signals : []).map(signal => ({
    ...signal,
    semantics: signal.semantics || signalSemantics(signal),
  }));

  return {
    title: '数据表征层 V1',
    principle: '把原始来源字段先转成带语义的 Signal / Dataset，再交给聚合与呈现层。',
    source_contract: {
      name: 'SourceStatus',
      count: Array.isArray(sources) ? sources.length : 0,
      states: labeledCounts(countBy(sources, source => source.state || 'unknown'), {
        ok: '可用',
        planned: '计划接入',
        disabled: '禁用',
        missing: '缺失',
        unavailable: '不可用',
        auth_failed: '鉴权失败',
        unknown: '未知',
      }),
    },
    capability_registry_contract: {
      name: 'SourceRegistryEntry',
      count: Array.isArray(sourceRegistry) ? sourceRegistry.length : 0,
      code_capabilities: registryCounts(sourceRegistry, 'code_capability'),
      configurations: registryCounts(sourceRegistry, 'configuration_state'),
      collections: registryCounts(sourceRegistry, 'collection_state'),
      adapters: registryCounts(sourceRegistry, 'command_demo_adapter'),
      visibility: registryCounts(sourceRegistry, 'visibility_state'),
    },
    signal_contract: {
      name: 'SignalSemantics',
      count: enrichedSignals.length,
      roles: labeledCounts(countBy(enrichedSignals, signal => signal.semantics.metric_role), SEMANTIC_ROLE_LABELS),
      units: labeledCounts(countBy(enrichedSignals, signal => signal.semantics.unit_family), SEMANTIC_UNIT_FAMILY_LABELS),
      subjects: labeledCounts(countBy(enrichedSignals, signal => signal.semantics.subject_type), SEMANTIC_SUBJECT_LABELS),
      knownness: labeledCounts(countBy(enrichedSignals, signal => signal.semantics.knownness), {
        known: '已知',
        unknown: '未知',
        reported_zero: '接口报告 0',
        derived: '推导',
        planned: '计划接入',
      }),
    },
      dataset_contract: {
        name: 'DatasetSemantics',
        count: datasetGroups.length,
        widgets: labeledCounts(countBy(datasetGroups, group => group.widget_hint), {
          'status-matrix': '状态矩阵',
          'capability-matrix': '能力矩阵',
          'reserve-card': '余量卡',
          'relay-zone': '中转专区',
        'window-trend': '趋势图',
        'rank-table': '排行表',
        'evidence-table': '证据表',
        'metric-card': '指标卡',
      }),
      row_subjects: labeledCounts(countBy(datasetGroups, group => group.rows_subject_type), SEMANTIC_SUBJECT_LABELS),
    },
    invariants: [
      '已用、可用、容量、余额即使同为 USD/token，也必须按 metric_role 分离。',
      'unknown 不能按 0 参与聚合；reported_zero 必须保留为接口报告的 0。',
      '工作区榜只接收有 workspace/cwd/project 证据的数据集。',
      '趋势图必须按单位族与时间窗口分组，避免把成本、token、请求数混在同轴。',
    ],
    sample_metric_groups: metricGroups.slice(0, 6).map(group => ({
      id: group.id,
      name: group.name,
      role: group.metric_role,
      unit_family: group.unit_family,
      subject_type: group.subject_type,
      signal_count: group.count,
    })),
  };
}

function matchMetricGroups(metricGroups, predicate) {
  return (Array.isArray(metricGroups) ? metricGroups : [])
    .filter(predicate)
    .map(group => group.id);
}

function matchDatasetGroups(datasetGroups, predicate) {
  return (Array.isArray(datasetGroups) ? datasetGroups : [])
    .filter(predicate)
    .map(group => group.dataset_id);
}

function buildPresentationBlueprint({ sources = [], metricGroups = [], datasetGroups = [], evidenceNotes = [], sourceRegistry = [] } = {}) {
  const lanes = [
    {
      id: 'source-capability',
      name: '感知通道',
      widget: 'capability-matrix',
      purpose: '解释某个通道为什么有或没有数据显示。',
      metric_group_ids: [],
      dataset_ids: matchDatasetGroups(datasetGroups, group => group.dataset_id === 'source_registry'),
      evidence_count: (Array.isArray(sourceRegistry) ? sourceRegistry : []).filter(entry =>
        entry.command_demo_adapter !== 'connected' || entry.collection_state !== 'ok'
      ).length,
      rules: ['代码能力、配置、采集、接入、可见性分列', '缺数据也要显示原因'],
    },
    {
      id: 'connection-health',
      name: '连接健康',
      widget: 'status-matrix',
      purpose: '先回答哪些来源、凭证和采集链路可信。',
      metric_group_ids: matchMetricGroups(metricGroups, group => group.metric_role === 'health'),
      dataset_ids: matchDatasetGroups(datasetGroups, group => group.widget_hint === 'status-matrix'),
      evidence_count: (Array.isArray(sources) ? sources : []).filter(source => source.state !== 'ok').length,
      rules: ['不参与成本或 token 合计', 'planned/disabled/missing 只作为状态展示'],
    },
    {
      id: 'reserve-risk',
      name: '余量风险',
      widget: 'reserve-card',
      purpose: '展示还能用多少，和已用消耗分离。',
      metric_group_ids: matchMetricGroups(metricGroups, group => ['available', 'capacity'].includes(group.metric_role)),
      dataset_ids: matchDatasetGroups(datasetGroups, group => group.widget_hint === 'relay-zone' && ['account', 'api_key'].includes(group.rows_subject_type)),
      evidence_count: 0,
      rules: ['余额/可用额度单独成组', '不与今日成本或累计成本共轴'],
    },
    {
      id: 'window-consumption',
      name: '窗口消耗',
      widget: 'window-trend',
      purpose: '按 6h/1d/7d 等窗口展示成本、token、请求数变化。',
      metric_group_ids: matchMetricGroups(metricGroups, group => ['window', 'trend', 'rate'].includes(group.time_behavior)),
      dataset_ids: matchDatasetGroups(datasetGroups, group => group.widget_hint === 'window-trend'),
      evidence_count: 0,
      rules: ['一个量纲一张趋势图', '核心趋势图纵向堆叠，不横向挤压'],
    },
    {
      id: 'cumulative-profile',
      name: '累计画像',
      widget: 'rank-table',
      purpose: '展示模型、工作区、来源等对象的累计贡献。',
      metric_group_ids: matchMetricGroups(metricGroups, group => group.time_behavior === 'cumulative' || group.metric_role === 'rank'),
      dataset_ids: matchDatasetGroups(datasetGroups, group => group.widget_hint === 'rank-table'),
      evidence_count: 0,
      rules: ['模型可跨来源混排', '工作区必须有本地路径或项目证据'],
    },
    {
      id: 'evidence-audit',
      name: '证据审计',
      widget: 'evidence-table',
      purpose: '解释 unknown、reported_zero、derived、planned 和排行依据。',
      metric_group_ids: matchMetricGroups(metricGroups, group => (group.knownness || []).some(item => item !== 'known')),
      dataset_ids: matchDatasetGroups(datasetGroups, group => group.widget_hint === 'evidence-table'),
      evidence_count: Array.isArray(evidenceNotes) ? evidenceNotes.length : 0,
      rules: ['成本未知显式展示', '接口报告 0 与缺失值分开'],
    },
  ];

  return {
    title: '面板呈现层 V1',
    principle: '面板只消费语义蓝图：按角色、单位、对象、窗口选择受控 widget。',
    lanes,
    layout_policy: [
      '常驻面板优先显示图和关键数值，文字明细可折叠。',
      '趋势图按量纲纵向堆叠，避免同轴混杂。',
      '来源作为过滤器和证据徽标，不作为默认一级分类。',
      '新增业务对象先映射到既有 lane；只有无法表达时才扩展 widget registry。',
    ],
  };
}

function buildSemanticProjection({ sources = [], signals = [], datasets = {}, sourceRegistry = [] } = {}) {
  const metricGroups = buildSemanticMetricGroups(signals);
  const datasetGroups = buildSemanticDatasetGroups(datasets);
  const evidenceNotes = buildEvidenceNotes({ sources, signals, datasets, sourceRegistry });
  const widgetIds = new Set([
    ...metricGroups.map(group => group.widget_hint),
    ...datasetGroups.map(group => group.widget_hint),
  ]);

  return {
    layers: [
      {
        id: 'source-acquisition',
        name: '信息获取层',
        purpose: '读取本地文件、SQLite、远端 API 与计划接入项。',
        item_count: (Array.isArray(sources) ? sources.length : 0) + (Array.isArray(sourceRegistry) ? sourceRegistry.length : 0),
      },
      {
        id: 'data-representation',
        name: '数据表征层',
        purpose: '把原始 source 字段解释为带语义的 Signal。',
        item_count: Array.isArray(signals) ? signals.length : 0,
      },
      {
        id: 'aggregation',
        name: '综合聚合层',
        purpose: '把 Signal 与 Dataset 按语义、量纲、对象和窗口分组。',
        item_count: metricGroups.length + datasetGroups.length,
      },
      {
        id: 'presentation',
        name: '面板呈现层',
        purpose: '按 widget registry 选择状态矩阵、趋势图、排行表、证据审计等组件。',
        item_count: widgetIds.size,
      },
    ],
    metric_groups: metricGroups,
    dataset_groups: datasetGroups,
    widget_registry: WIDGET_REGISTRY.filter(widget => widgetIds.has(widget.id) || widget.id === 'metric-card'),
    evidence_notes: evidenceNotes,
    data_representation: buildDataRepresentationBlueprint({ sources, signals, metricGroups, datasetGroups, sourceRegistry }),
    presentation_blueprint: buildPresentationBlueprint({ sources, metricGroups, datasetGroups, evidenceNotes, sourceRegistry }),
    summary: {
      signal_count: Array.isArray(signals) ? signals.length : 0,
      dataset_count: Object.keys(datasets || {}).length,
      widget_count: widgetIds.size,
      source_count: Array.isArray(sources) ? sources.length : 0,
      source_registry_count: Array.isArray(sourceRegistry) ? sourceRegistry.length : 0,
    },
  };
}

function filterSignals(signals = [], searchParams = new URLSearchParams()) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
  const domain = params.get('domain');
  const pathFilter = params.get('path');
  const source = params.get('source');
  const subject = params.get('subject');
  const unit = params.get('unit');
  const role = params.get('role');

  return (Array.isArray(signals) ? signals : []).filter(signal => {
    const semantics = signal?.semantics || signalSemantics(signal);
    if (domain && signal?.domain !== domain) return false;
    if (pathFilter && !(String(signal?.path || '').startsWith(pathFilter))) return false;
    if (source && signal?.sourceId !== source) return false;
    if (subject && signal?.subject !== subject) return false;
    if (unit && signal?.unit !== unit) return false;
    if (role && semantics.metric_role !== role) return false;
    return true;
  });
}

function datasetCatalog(datasets = {}) {
  return Object.entries(datasets || {}).map(([id, data]) => ({
    id,
    semantics: datasetSemantics(id),
    row_count: datasetItemCount(data),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function commandDemoLayerResponse(demo = {}, urlLike = '/api/command-demo') {
  const url = urlLike instanceof URL
    ? urlLike
    : new URL(String(urlLike || '/api/command-demo'), 'http://127.0.0.1');
  const generatedAt = demo.generated_at || new Date().toISOString();
  const datasets = demo.datasets || {};

  if (url.pathname === '/api/sources') {
    return {
      status: 200,
      body: {
        generated_at: generatedAt,
        sources: Array.isArray(demo.sources) ? demo.sources : [],
        source_counts: demo.source_counts || {},
        source_registry: Array.isArray(datasets.source_registry) ? datasets.source_registry : [],
        contract: demo.semantic_projection?.data_representation?.source_contract,
        capability_registry_contract: demo.semantic_projection?.data_representation?.capability_registry_contract,
      },
    };
  }

  if (url.pathname === '/api/signals') {
    return {
      status: 200,
      body: {
        generated_at: generatedAt,
        signals: filterSignals(demo.signals, url.searchParams),
        metric_groups: demo.semantic_projection?.metric_groups || [],
        contract: demo.semantic_projection?.data_representation?.signal_contract,
      },
    };
  }

  if (url.pathname === '/api/datasets') {
    return {
      status: 200,
      body: {
        generated_at: generatedAt,
        datasets: datasetCatalog(datasets),
        dataset_groups: demo.semantic_projection?.dataset_groups || [],
        contract: demo.semantic_projection?.data_representation?.dataset_contract,
      },
    };
  }

  if (url.pathname.startsWith('/api/datasets/')) {
    const id = decodeURIComponent(url.pathname.replace('/api/datasets/', ''));
    if (!id || !Object.prototype.hasOwnProperty.call(datasets, id)) {
      return {
        status: 404,
        body: {
          error: 'dataset_not_found',
          id,
          available: Object.keys(datasets).sort(),
        },
      };
    }
    return {
      status: 200,
      body: {
        generated_at: generatedAt,
        id,
        semantics: datasetSemantics(id),
        row_count: datasetItemCount(datasets[id]),
        data: datasets[id],
      },
    };
  }

  if (url.pathname === '/api/semantic-projection') {
    return {
      status: 200,
      body: {
        generated_at: generatedAt,
        semantic_projection: demo.semantic_projection || buildSemanticProjection({
          sources: demo.sources,
          signals: demo.signals,
          datasets,
          sourceRegistry: datasets.source_registry,
        }),
      },
    };
  }

  return null;
}

function safeErrorKind(error) {
  const name = String(error?.name || 'Error')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 48);
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'TypeError') return 'request_failed';
  return name || 'request_failed';
}

function newApiAuthVariants(token) {
  const raw = String(token || '').trim();
  const variants = new Map();
  const add = (name, value) => {
    const normalized = String(value || '').trim();
    if (normalized && ![...variants.values()].includes(normalized)) variants.set(name, normalized);
  };

  if (/^bearer\s+/i.test(raw)) {
    const unwrapped = raw.replace(/^bearer\s+/i, '').trim();
    add('provided', raw);
    add('raw', unwrapped);
    add('bearer', `Bearer ${unwrapped}`);
    if (unwrapped && !unwrapped.startsWith('sk-')) add('bearer-sk', `Bearer sk-${unwrapped}`);
  } else {
    add('raw', raw);
    add('bearer', `Bearer ${raw}`);
    if (raw && !raw.startsWith('sk-')) add('bearer-sk', `Bearer sk-${raw}`);
  }

  return [...variants.entries()].map(([name, value]) => ({ name, value }));
}

async function fetchNewApiJson(baseUrl, endpoint, authHeader, extraHeaders = {}) {
  const url = new URL(endpoint, `${baseUrl}/`);
  const started = Date.now();
  const headers = { accept: 'application/json', ...extraHeaders };
  if (authHeader) headers.Authorization = authHeader;

  const response = await fetch(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text.slice(0, 200) };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    latency_ms: Date.now() - started,
  };
}

function summarizeNewApiUser(data, display) {
  const payload = unwrapApiData(data);
  if (!isObject(payload)) return null;

  const availableRaw = firstFiniteNumber(payload.quota);
  const usedRaw = firstFiniteNumber(payload.used_quota);
  const totalRaw = availableRaw !== null && usedRaw !== null ? availableRaw + usedRaw : availableRaw;
  if (totalRaw === null && usedRaw === null && availableRaw === null) return null;

  return {
    auth_kind: 'user_access_token',
    total_quota: convertQuotaValue(totalRaw, display),
    used_quota: convertQuotaValue(usedRaw, display),
    available_quota: convertQuotaValue(availableRaw, display),
    request_count: firstFiniteNumber(payload.request_count),
    group: typeof payload.group === 'string' ? payload.group : undefined,
    unit: quotaDisplayUnit(display),
  };
}

function summarizeNewApiTokenUsage(data, display) {
  const payload = unwrapApiData(data);
  if (!isObject(payload)) return null;

  const totalRaw = firstFiniteNumber(payload.total_granted);
  const usedRaw = firstFiniteNumber(payload.total_used);
  const availableRaw = firstFiniteNumber(payload.total_available);
  if (totalRaw === null && usedRaw === null && availableRaw === null) return null;

  return {
    auth_kind: 'api_key',
    total_quota: convertQuotaValue(totalRaw, display),
    used_quota: convertQuotaValue(usedRaw, display),
    available_quota: convertQuotaValue(availableRaw, display),
    unlimited_quota: Boolean(payload.unlimited_quota),
    expires_at: firstFiniteNumber(payload.expires_at),
    unit: quotaDisplayUnit(display),
  };
}

function summarizeNewApiBilling(subscription, usage) {
  if (!isObject(subscription) && !isObject(usage)) return null;

  const total = firstFiniteNumber(
    subscription?.system_hard_limit_usd,
    subscription?.hard_limit_usd,
    subscription?.soft_limit_usd
  );
  const used = firstFiniteNumber(usage?.total_usage);
  const usedCredit = used === null ? null : used / 100;
  const available = total !== null && usedCredit !== null ? total - usedCredit : total;
  if (total === null && usedCredit === null && available === null) return null;

  return {
    auth_kind: 'api_key_billing',
    total_quota: total,
    used_quota: usedCredit,
    available_quota: available,
    expires_at: firstFiniteNumber(subscription?.access_until),
    unit: 'credit',
  };
}

function newApiSignals(summary, collectedAt) {
  if (!summary) return [];
  const sourceId = 'newapi-main';
  const signals = [];
  const freshness = { collectedAt, staleAfterSeconds: 300 };

  const add = (id, pathName, kind, value, unit, confidence = 'reported') => {
    if (value === null || value === undefined) return;
    signals.push(withSignalSemantics({
      id,
      path: pathName,
      domain: 'api',
      kind,
      subject: sourceId,
      value,
      unit,
      confidence,
      sourceId,
      freshness,
    }));
  };

  add('signal-newapi-quota-total', 'api.newapi.quota.total', 'quota', summary.total_quota, summary.unit);
  add('signal-newapi-quota-used', 'api.newapi.quota.used', 'usage', summary.used_quota, summary.unit);
  add('signal-newapi-quota-available', 'api.newapi.quota.available', 'quota', summary.available_quota, summary.unit);
  add('signal-newapi-requests', 'api.newapi.requests.total', 'usage', summary.request_count, 'count');

  if (summary.total_quota && summary.used_quota !== null && summary.used_quota !== undefined) {
    add(
      'signal-newapi-usage-percent',
      'api.newapi.usage.percent',
      'usage',
      Number(((summary.used_quota / summary.total_quota) * 100).toFixed(2)),
      'percent',
      'derived'
    );
  }

  return signals;
}

function summarizeNewApiModelStats(items, display) {
  const map = new Map();
  const quotaUnit = quotaDisplayUnit(display);

  for (const item of Array.isArray(items) ? items : []) {
    if (!isObject(item)) continue;
    const model = String(item.model_name || item.model || item.request_model || 'unknown').trim() || 'unknown';
    const current = map.get(model) || {
      source: 'NewAPI',
      model,
      requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      quota_used: 0,
      quota_unit: quotaUnit,
      latest_at: undefined,
    };
    const input = firstFiniteNumber(item.prompt_tokens, item.input_tokens) || 0;
    const output = firstFiniteNumber(item.completion_tokens, item.output_tokens) || 0;
    const quota = convertQuotaValue(firstFiniteNumber(item.quota, item.used_quota), display) || 0;
    current.requests += 1;
    current.input_tokens += input;
    current.output_tokens += output;
    current.total_tokens += input + output;
    current.quota_used += quota;
    const created = timestampToIso(item.created_at || item.createdAt || item.created_time || item.timestamp);
    if (created && (!current.latest_at || created > current.latest_at)) current.latest_at = created;
    map.set(model, current);
  }

  return [...map.values()].sort((a, b) => (b.quota_used - a.quota_used) || (b.total_tokens - a.total_tokens));
}

async function newApiModelStats(baseUrl, authHeader, extraHeaders, display) {
  try {
    const result = await fetchNewApiJson(baseUrl, '/api/log/self?p=0&size=100', authHeader, extraHeaders);
    if (!result.ok || !businessOk(result.data)) return [];
    const payload = unwrapApiData(result.data);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return summarizeNewApiModelStats(items, display);
  } catch {
    return [];
  }
}

async function newApiStatus() {
  const baseUrl = trimTrailingSlash(process.env.AGENTSENSE_NEWAPI_BASE_URL);
  const token = String(process.env.AGENTSENSE_NEWAPI_TOKEN || '').trim();
  const userId = String(process.env.AGENTSENSE_NEWAPI_USER_ID || '').trim();
  const label = process.env.AGENTSENSE_NEWAPI_LABEL || 'NewAPI';
  const host = safeHost(baseUrl);

  const source = {
    id: 'newapi-main',
    kind: 'newapi',
    label,
    enabled: Boolean(baseUrl && token),
    state: 'disabled',
    message: '设置 AGENTSENSE_NEWAPI_BASE_URL 与 AGENTSENSE_NEWAPI_TOKEN 后启用',
    capabilities: ['api_balance', 'api_quota', 'api_key_status', 'provider_health'],
  };

  if (!baseUrl || !token) {
    return {
      configured: false,
      source,
      signals: [],
      alerts: [{ level: 'info', title: `${label} 未启用`, detail: source.message }],
      datasets: { attempts: [] },
    };
  }

  let publicStatus = null;
  try {
    publicStatus = await fetchNewApiJson(baseUrl, '/api/status');
  } catch (error) {
    source.enabled = true;
    source.state = 'unavailable';
    source.message = `无法访问 ${host || 'NewAPI'}: ${safeErrorKind(error)}`;
    return {
      configured: true,
      source,
      signals: [],
      alerts: [{ level: 'warning', title: `${label} 不可达`, detail: source.message }],
      datasets: { attempts: [] },
    };
  }

  const display = quotaDisplayConfig(publicStatus.data);
  const userHeaders = userId ? { 'New-Api-User': userId } : {};
  const attempts = [];
  const collectedAt = new Date().toISOString();
  const tryEndpoint = async (name, endpoint, authHeader, summarize, extraHeaders = {}) => {
    try {
      const result = await fetchNewApiJson(baseUrl, endpoint, authHeader, extraHeaders);
      const ok = result.ok && businessOk(result.data);
      const summary = ok ? summarize(result.data) : null;
      attempts.push({
        name,
        endpoint,
        status: result.status,
        ok: Boolean(summary),
        latency_ms: result.latency_ms,
      });
      return summary ? { summary, result } : null;
    } catch (error) {
      attempts.push({ name, endpoint, status: 'error', ok: false, error: safeErrorKind(error) });
      return null;
    }
  };

  const authVariants = newApiAuthVariants(token);

  for (const auth of authVariants) {
    const userSummary = await tryEndpoint(
      `user-self-${auth.name}`,
      '/api/user/self',
      auth.value,
      data => summarizeNewApiUser(data, display),
      userHeaders
    );
    if (userSummary) {
      const modelStats = await newApiModelStats(baseUrl, auth.value, userHeaders, display);
      source.enabled = true;
      source.state = 'ok';
      source.message = `${host} 用户额度已读取`;
      source.last_read_at = collectedAt;
      source.latency_ms = userSummary.result.latency_ms;
      return {
        configured: true,
        source,
        summary: userSummary.summary,
        signals: newApiSignals(userSummary.summary, collectedAt),
        alerts: [{ level: 'ok', title: `${label} 已接入`, detail: '已通过系统访问令牌读取用户级额度。' }],
        datasets: { attempts, model_stats: modelStats },
      };
    }
  }

  for (const auth of authVariants.filter(a => a.name !== 'raw')) {
    const tokenSummary = await tryEndpoint(
      `usage-token-${auth.name}`,
      '/api/usage/token/',
      auth.value,
      data => summarizeNewApiTokenUsage(data, display)
    );
    if (tokenSummary) {
      const modelStats = await newApiModelStats(baseUrl, auth.value, {}, display);
      source.enabled = true;
      source.state = 'ok';
      source.message = `${host} API key 额度已读取`;
      source.last_read_at = collectedAt;
      source.latency_ms = tokenSummary.result.latency_ms;
      return {
        configured: true,
        source,
        summary: tokenSummary.summary,
        signals: newApiSignals(tokenSummary.summary, collectedAt),
        alerts: [{ level: 'ok', title: `${label} 已接入`, detail: '已通过 API key 读取 token 额度。' }],
        datasets: { attempts, model_stats: modelStats },
      };
    }

    const subscription = await tryEndpoint(
      `billing-subscription-${auth.name}`,
      '/dashboard/billing/subscription',
      auth.value,
      data => data
    );
    if (subscription) {
      const end = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - 30);
      const usageEndpoint = `/dashboard/billing/usage?start_date=${start.toISOString().slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}`;
      const usage = await tryEndpoint(`billing-usage-${auth.name}`, usageEndpoint, auth.value, data => data);
      const summary = summarizeNewApiBilling(subscription.summary, usage?.summary);
      if (summary) {
        source.enabled = true;
        source.state = 'ok';
        source.message = `${host} billing 额度已读取`;
        source.last_read_at = collectedAt;
        source.latency_ms = subscription.result.latency_ms;
        return {
          configured: true,
          source,
          summary,
          signals: newApiSignals(summary, collectedAt),
          alerts: [{ level: 'ok', title: `${label} 已接入`, detail: '已通过 OpenAI billing 兼容接口读取额度。' }],
          datasets: { attempts },
        };
      }
    }
  }

  source.enabled = true;
  source.state = publicStatus.ok ? 'auth_failed' : 'unavailable';
  source.message = publicStatus.ok
    ? `${host} 可达，但令牌未通过 user access token 或 API key 鉴权${userId ? '' : '；系统访问令牌还需要 AGENTSENSE_NEWAPI_USER_ID'}`
    : `${host} 状态接口返回 ${publicStatus.status}`;
  source.last_read_at = collectedAt;
  source.latency_ms = publicStatus.latency_ms;

  return {
    configured: true,
    source,
    signals: [],
    alerts: [{
      level: publicStatus.ok ? 'warning' : 'info',
      title: publicStatus.ok ? `${label} 鉴权失败` : `${label} 状态异常`,
      detail: source.message,
    }],
    datasets: { attempts },
  };
}

function normalizeApiUnit(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'usd' || raw.includes('dollar')) return 'usd';
  if (raw === 'cny' || raw.includes('yuan') || raw.includes('rmb')) return 'cny';
  if (raw.includes('token')) return 'token';
  return raw || 'quota';
}

function sub2ApiAuthHeader(apiKey) {
  const key = String(apiKey || '').trim();
  return /^bearer\s+/i.test(key) ? key : `Bearer ${key}`;
}

async function fetchSub2ApiJson(baseUrl, endpoint, apiKey) {
  const url = new URL(endpoint, `${baseUrl}/`);
  const started = Date.now();
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      Authorization: sub2ApiAuthHeader(apiKey),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text.slice(0, 200) };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    latency_ms: Date.now() - started,
  };
}

function summarizeSub2ApiModelStats(items, unit = 'usd') {
  if (!Array.isArray(items)) return [];

  return items
    .map(item => {
      if (!isObject(item)) return null;
      const cost = firstFiniteNumber(item.actual_cost, item.cost);
      return {
        model: String(item.model || item.name || item.model_name || item.id || 'unknown'),
        requests: firstFiniteNumber(item.requests, item.request_count) || 0,
        input_tokens: firstFiniteNumber(item.input_tokens) || 0,
        output_tokens: firstFiniteNumber(item.output_tokens) || 0,
        cache_creation_tokens: firstFiniteNumber(item.cache_creation_tokens) || 0,
        cache_read_tokens: firstFiniteNumber(item.cache_read_tokens) || 0,
        total_tokens: firstFiniteNumber(item.total_tokens, item.tokens) || 0,
        cost,
        cost_known: cost !== null,
        cost_unit: unit,
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      Number(b.cost_known) - Number(a.cost_known)
      || ((b.cost || 0) - (a.cost || 0))
      || (b.total_tokens - a.total_tokens)
      || (b.requests - a.requests)
    );
}

function summarizeSub2ApiUsage(data) {
  const payload = unwrapApiData(data);
  if (!isObject(payload)) return null;

  const usage = isObject(payload.usage) ? payload.usage : {};
  const today = isObject(usage.today) ? usage.today : {};
  const total = isObject(usage.total) ? usage.total : {};
  const unit = normalizeApiUnit(payload.unit);
  const available = firstFiniteNumber(payload.remaining, payload.balance, payload.wallet_balance);
  const totalCost = firstFiniteNumber(total.actual_cost, total.cost);
  const todayCost = firstFiniteNumber(today.actual_cost, today.cost);
  const totalTokens = firstFiniteNumber(total.total_tokens, total.tokens);
  const todayTokens = firstFiniteNumber(today.total_tokens, today.tokens);
  const totalRequests = firstFiniteNumber(total.requests, total.request_count);
  const todayRequests = firstFiniteNumber(today.requests, today.request_count);
  const modelStats = summarizeSub2ApiModelStats(payload.model_stats, unit);

  if (
    available === null &&
    totalCost === null &&
    todayCost === null &&
    totalTokens === null &&
    todayTokens === null &&
    totalRequests === null &&
    todayRequests === null &&
    modelStats.length === 0
  ) {
    return null;
  }

  return {
    auth_kind: 'api_key',
    valid: payload.isValid !== false && payload.valid !== false,
    mode: typeof payload.mode === 'string' ? payload.mode : undefined,
    plan_name: typeof payload.planName === 'string' ? payload.planName : undefined,
    available_balance: available,
    unit,
    today: {
      requests: todayRequests,
      tokens: todayTokens,
      cost: todayCost,
      input_tokens: firstFiniteNumber(today.input_tokens),
      output_tokens: firstFiniteNumber(today.output_tokens),
      cache_creation_tokens: firstFiniteNumber(today.cache_creation_tokens),
      cache_read_tokens: firstFiniteNumber(today.cache_read_tokens),
    },
    total: {
      requests: totalRequests,
      tokens: totalTokens,
      cost: totalCost,
      input_tokens: firstFiniteNumber(total.input_tokens),
      output_tokens: firstFiniteNumber(total.output_tokens),
      cache_creation_tokens: firstFiniteNumber(total.cache_creation_tokens),
      cache_read_tokens: firstFiniteNumber(total.cache_read_tokens),
    },
    throughput: {
      rpm: firstFiniteNumber(usage.rpm),
      tpm: firstFiniteNumber(usage.tpm),
      average_duration_ms: firstFiniteNumber(usage.average_duration_ms),
    },
    model_stats: modelStats,
  };
}

function sub2ApiSignals(summary, collectedAt) {
  if (!summary) return [];
  const sourceId = 'sub2api-main';
  const signals = [];
  const freshness = { collectedAt, staleAfterSeconds: 300 };
  const add = (id, pathName, kind, value, unit, confidence = 'reported') => {
    if (value === null || value === undefined) return;
    signals.push(withSignalSemantics({
      id,
      path: pathName,
      domain: 'api',
      kind,
      subject: sourceId,
      value,
      unit,
      confidence,
      sourceId,
      freshness,
    }));
  };

  add('signal-sub2api-balance-available', 'api.sub2api.balance.available', 'balance', summary.available_balance, summary.unit);
  add('signal-sub2api-requests-today', 'api.sub2api.requests.today', 'usage', summary.today.requests, 'count');
  add('signal-sub2api-tokens-today', 'api.sub2api.tokens.today', 'usage', summary.today.tokens, 'token');
  add('signal-sub2api-cost-today', 'api.sub2api.cost.today', 'usage', summary.today.cost, summary.unit);
  add('signal-sub2api-requests-total', 'api.sub2api.requests.total', 'usage', summary.total.requests, 'count');
  add('signal-sub2api-tokens-total', 'api.sub2api.tokens.total', 'usage', summary.total.tokens, 'token');
  add('signal-sub2api-cost-total', 'api.sub2api.cost.total', 'usage', summary.total.cost, summary.unit);
  add('signal-sub2api-models-count', 'api.sub2api.models.count', 'inventory', summary.model_stats.length, 'count', 'derived');
  add('signal-sub2api-rpm', 'api.sub2api.rpm', 'rate', summary.throughput.rpm, 'count');
  add('signal-sub2api-tpm', 'api.sub2api.tpm', 'rate', summary.throughput.tpm, 'token');

  return signals;
}

async function sub2ApiStatus() {
  const baseUrl = trimTrailingSlash(String(process.env.AGENTSENSE_SUB2API_BASE_URL || '').trim());
  const apiKey = String(process.env.AGENTSENSE_SUB2API_API_KEY || process.env.AGENTSENSE_SUB2API_KEY || '').trim();
  const label = process.env.AGENTSENSE_SUB2API_LABEL || 'Sub2API';
  const host = safeHost(baseUrl);
  const source = {
    id: 'sub2api-main',
    kind: 'sub2api',
    label,
    enabled: Boolean(baseUrl && apiKey),
    state: 'disabled',
    message: '设置 AGENTSENSE_SUB2API_BASE_URL 与 AGENTSENSE_SUB2API_API_KEY 后启用',
    capabilities: ['api_balance', 'api_usage', 'model_usage', 'api_key_status', 'provider_health'],
  };

  if (!baseUrl || !apiKey) {
    return {
      configured: false,
      source,
      signals: [],
      alerts: [{ level: 'info', title: `${label} 未启用`, detail: source.message }],
      datasets: { model_stats: [] },
    };
  }

  const collectedAt = new Date().toISOString();
  try {
    const result = await fetchSub2ApiJson(baseUrl, '/v1/usage', apiKey);
    const summary = result.ok && businessOk(result.data) ? summarizeSub2ApiUsage(result.data) : null;
    source.enabled = true;
    source.last_read_at = collectedAt;
    source.latency_ms = result.latency_ms;

    if (summary?.valid) {
      source.state = 'ok';
      source.message = `${host || 'Sub2API'} key 用量已读取`;
      return {
        configured: true,
        source,
        summary,
        signals: sub2ApiSignals(summary, collectedAt),
        alerts: [{ level: 'ok', title: `${label} 已接入`, detail: '已通过模型 API key 读取 key 级用量。' }],
        datasets: { model_stats: summary.model_stats },
      };
    }

    source.state = result.status === 401 || result.status === 403 || summary?.valid === false ? 'auth_failed' : 'unavailable';
    source.message = source.state === 'auth_failed'
      ? `${host || 'Sub2API'} key 未通过鉴权`
      : `${host || 'Sub2API'} /v1/usage 返回 ${result.status}`;
    return {
      configured: true,
      source,
      signals: [],
      alerts: [{ level: 'warning', title: `${label} 不可用`, detail: source.message }],
      datasets: { model_stats: [] },
    };
  } catch (error) {
    source.enabled = true;
    source.state = 'unavailable';
    source.message = `无法访问 ${host || 'Sub2API'}: ${safeErrorKind(error)}`;
    return {
      configured: true,
      source,
      signals: [],
      alerts: [{ level: 'warning', title: `${label} 不可达`, detail: source.message }],
      datasets: { model_stats: [] },
    };
  }
}

function codexLocalUsage() {
  const file = path.join(os.homedir(), '.codex', 'state_5.sqlite');
  if (!fs.existsSync(file)) {
    return { configured: false, status: { state: 'missing', message: 'state_5.sqlite not found' }, models: [], top_projects: [] };
  }

  try {
    const stat = fs.statSync(file);
    const rows = sqliteReadOnly(file, db => db.prepare(`
      select coalesce(model_provider, 'unknown') as provider,
             coalesce(model, 'unknown') as model,
             count(*) as sessions,
             sum(coalesce(tokens_used, 0)) as tokens,
             max(updated_at) as latest_updated_at
      from threads
      group by provider, model
      order by tokens desc, sessions desc
      limit 20
    `).all());
    const projectRows = sqliteReadOnly(file, db => db.prepare(`
      select coalesce(cwd, 'unknown') as cwd,
             count(*) as sessions,
             sum(coalesce(tokens_used, 0)) as tokens,
             count(distinct coalesce(model, 'unknown')) as model_count,
             max(updated_at) as latest_updated_at
      from threads
      where coalesce(tokens_used, 0) > 0
      group by cwd
      order by tokens desc, sessions desc
      limit 100
    `).all());
    return {
      configured: true,
      status: { state: 'ok', last_modified: stat.mtimeMs },
      models: rows.map(row => ({
        source: 'Codex',
        provider: row.provider,
        model: row.model,
        sessions: Number(row.sessions || 0),
        requests: Number(row.sessions || 0),
        total_tokens: Number(row.tokens || 0),
        cost: null,
        latest_at: timestampToIso(row.latest_updated_at),
      })),
      top_projects: projectRows.map(row => ({
        workspace: workspaceLabel(row.cwd),
        workspace_path: workspacePath(row.cwd),
        cost_usd: null,
        cost_known: false,
        tokens: Number(row.tokens || 0),
        model_count: Number(row.model_count || 0),
        sessions: Number(row.sessions || 0),
        record_count: Number(row.sessions || 0),
        record_kind: 'session',
        record_kinds: ['session'],
        record_breakdown: [{ source: 'Codex', kind: 'session', count: Number(row.sessions || 0) }],
        sources: ['Codex'],
        latest_at: timestampToIso(row.latest_updated_at),
      })),
    };
  } catch (error) {
    return {
      configured: true,
      status: { state: 'error', message: `Codex SQLite 读取失败: ${safeErrorKind(error)}` },
      models: [],
      top_projects: [],
    };
  }
}

function mergeWorkspaceProjects(...projectGroups) {
  const map = new Map();

  for (const group of projectGroups) {
    for (const project of Array.isArray(group) ? group : []) {
      const key = workspaceKey(project.workspace_path, project.workspace);
      const normalizedPath = workspacePath(project.workspace_path, project.workspace);
      const entry = map.get(key) || {
        workspace: project.workspace || workspaceLabel(project.workspace_path) || 'unknown',
        workspace_path: normalizedPath,
        cost_usd: 0,
        cost_known: false,
        tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        web_search_requests: 0,
        model_count: 0,
        sessions: 0,
        record_count: 0,
        record_kinds: [],
        record_breakdown: [],
        sources: [],
        latest_at: undefined,
        cost_status: 'unknown',
      };

      entry.workspace = entry.workspace || project.workspace || workspaceLabel(project.workspace_path);
      entry.workspace_path = entry.workspace_path || normalizedPath;
      if (project.cost_known !== false && project.cost_usd !== null && project.cost_usd !== undefined) {
        entry.cost_usd += asNumber(project.cost_usd);
        entry.cost_known = true;
      }
      if (costStatus(project) === 'known') entry.cost_status = 'known';
      entry.tokens += projectTokenTotal(project);
      entry.input_tokens += asNumber(project.input_tokens);
      entry.output_tokens += asNumber(project.output_tokens);
      entry.cache_read_tokens += asNumber(project.cache_read_tokens);
      entry.cache_creation_tokens += asNumber(project.cache_creation_tokens);
      entry.web_search_requests += asNumber(project.web_search_requests);
      entry.model_count += asNumber(project.model_count);
      entry.sessions += asNumber(project.sessions);
      const projectRecordCount = asNumber(project.record_count);
      entry.record_count += projectRecordCount || asNumber(project.sessions);
      entry.record_breakdown = mergeRecordBreakdown(entry.record_breakdown, recordBreakdown(project));
      for (const kind of [...recordKinds(project), ...entry.record_breakdown.map(row => row.kind)]) {
        if (!entry.record_kinds.includes(kind)) entry.record_kinds.push(kind);
      }
      for (const source of project.sources || []) {
        if (source && !entry.sources.includes(source)) entry.sources.push(source);
      }
      if (project.latest_at && (!entry.latest_at || Date.parse(project.latest_at) > Date.parse(entry.latest_at))) {
        entry.latest_at = project.latest_at;
      }

      map.set(key, entry);
    }
  }

  return [...map.values()]
    .map(project => {
      const breakdown = mergeRecordBreakdown([], project.record_breakdown);
      return {
        ...project,
        cost_usd: project.cost_known ? Number(project.cost_usd.toFixed(4)) : null,
        cost_status: project.cost_known ? 'known' : 'unknown',
        tokens: Number(project.tokens || 0),
        model_count: Number(project.model_count || 0),
        sessions: Number(project.sessions || 0),
        record_breakdown: breakdown,
        record_count: breakdown.reduce((sum, row) => sum + Number(row.count || 0), 0)
          || Number(project.record_count || 0),
      };
    })
    .sort((a, b) =>
      (b.tokens || 0) - (a.tokens || 0)
      || Number(b.cost_known) - Number(a.cost_known)
      || (b.cost_usd || 0) - (a.cost_usd || 0)
      || String(a.workspace).localeCompare(String(b.workspace))
    );
}

function ccSwitchUsage() {
  const file = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
  if (!fs.existsSync(file)) {
    return { configured: false, status: { state: 'missing', message: 'cc-switch.db not found' }, models: [] };
  }

  try {
    const stat = fs.statSync(file);
    const rows = sqliteReadOnly(file, db => db.prepare(`
      select coalesce(app_type, 'unknown') as app,
             coalesce(provider_id, 'unknown') as provider,
             coalesce(model, request_model, 'unknown') as model,
             count(*) as requests,
             sum(coalesce(input_tokens, 0)) as input_tokens,
             sum(coalesce(output_tokens, 0)) as output_tokens,
             sum(coalesce(cache_read_tokens, 0)) as cache_read_tokens,
             sum(coalesce(cache_creation_tokens, 0)) as cache_creation_tokens,
             sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_creation_tokens,0)) as total_tokens,
             sum(coalesce(total_cost_usd, 0)) as cost,
             max(created_at) as latest_created_at
      from proxy_request_logs
      group by app, provider, model
      order by cost desc, total_tokens desc
      limit 30
    `).all());
    return {
      configured: true,
      status: { state: 'ok', last_modified: stat.mtimeMs },
      models: rows.map(row => ({
        source: 'CC Switch',
        app: row.app,
        provider: row.provider,
        model: row.model,
        requests: Number(row.requests || 0),
        input_tokens: Number(row.input_tokens || 0),
        output_tokens: Number(row.output_tokens || 0),
        cache_read_tokens: Number(row.cache_read_tokens || 0),
        cache_creation_tokens: Number(row.cache_creation_tokens || 0),
        total_tokens: Number(row.total_tokens || 0),
        cost: Number(row.cost || 0),
        latest_at: timestampToIso(row.latest_created_at),
      })),
    };
  } catch (error) {
    return {
      configured: true,
      status: { state: 'error', message: `CC Switch SQLite 读取失败: ${safeErrorKind(error)}` },
      models: [],
    };
  }
}

function buildCcSwitchModelTrend(rows, options) {
  const keyName = options.keyName || 'date';
  const buckets = [...new Set(rows.map(row => row[keyName]).filter(Boolean))].sort();
  const modelTotals = new Map();
  for (const row of rows) {
    const model = String(row.model || 'unknown');
    const current = modelTotals.get(model) || { model, tokens: 0, cost: 0, requests: 0 };
    current.tokens += Number(row.tokens || 0);
    current.cost += Number(row.cost || 0);
    current.requests += Number(row.requests || 0);
    modelTotals.set(model, current);
  }

  const mappedRows = rows.map(row => ({
    [keyName]: row[keyName],
    model: String(row.model || 'unknown'),
    requests: Number(row.requests || 0),
    tokens: Number(row.tokens || 0),
    cost: Number(row.cost || 0),
  }));

  return {
    source: 'cc-switch',
    label: 'CC Switch 请求日志',
    window: options.window,
    window_label: options.windowLabel,
    bucket_label: options.bucketLabel,
    days: keyName === 'date' ? buckets : undefined,
    x: buckets,
    models: [...modelTotals.values()]
      .sort((a, b) => (b.cost - a.cost) || (b.tokens - a.tokens) || (b.requests - a.requests))
      .slice(0, 8),
    rows: mappedRows,
  };
}

function ccSwitchModelWindowTrend({ window, windowLabel, bucketLabel, seconds, bucketSeconds }) {
  const file = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
  if (!fs.existsSync(file)) {
    return { source: 'cc-switch', window, window_label: windowLabel, bucket_label: bucketLabel, x: [], models: [], rows: [] };
  }

  try {
    const rows = sqliteReadOnly(file, db => db.prepare(`
      with bounds as (
        select max(created_at) as max_ts
        from proxy_request_logs
        where created_at is not null
      )
      select datetime(cast(cast(created_at as integer) / ? as integer) * ?, 'unixepoch', 'localtime') as bucket,
             coalesce(model, request_model, 'unknown') as model,
             count(*) as requests,
             sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_creation_tokens,0)) as tokens,
             sum(coalesce(total_cost_usd, 0)) as cost
      from proxy_request_logs, bounds
      where created_at is not null
        and bounds.max_ts is not null
        and created_at >= bounds.max_ts - ?
      group by bucket, model
      order by bucket asc, cost desc, tokens desc
    `).all(bucketSeconds, bucketSeconds, seconds));
    return buildCcSwitchModelTrend(rows, {
      keyName: 'bucket',
      window,
      windowLabel,
      bucketLabel,
    });
  } catch {
    return { source: 'cc-switch', window, window_label: windowLabel, bucket_label: bucketLabel, x: [], models: [], rows: [] };
  }
}

function ccSwitchModelDailyTrend() {
  const file = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
  if (!fs.existsSync(file)) {
    return { source: 'cc-switch', window: '7d', window_label: '近 7 天', bucket_label: '1 天', days: [], x: [], models: [], rows: [] };
  }

  try {
    const rows = sqliteReadOnly(file, db => db.prepare(`
      with bounds as (
        select max(created_at) as max_ts
        from proxy_request_logs
        where created_at is not null
      )
      select date(created_at, 'unixepoch', 'localtime') as date,
             coalesce(model, request_model, 'unknown') as model,
             count(*) as requests,
             sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_creation_tokens,0)) as tokens,
             sum(coalesce(total_cost_usd, 0)) as cost
      from proxy_request_logs, bounds
      where created_at is not null
        and bounds.max_ts is not null
        and created_at >= bounds.max_ts - 6 * 86400
      group by date, model
      order by date asc, cost desc, tokens desc
    `).all());
    return buildCcSwitchModelTrend(rows, {
      keyName: 'date',
      window: '7d',
      windowLabel: '近 7 天',
      bucketLabel: '1 天',
    });
  } catch {
    return { source: 'cc-switch', window: '7d', window_label: '近 7 天', bucket_label: '1 天', days: [], x: [], models: [], rows: [] };
  }
}

function ccSwitchModelTrends() {
  const dailyTrend = ccSwitchModelDailyTrend();
  return {
    '6h': ccSwitchModelWindowTrend({
      window: '6h',
      windowLabel: '近 6 小时',
      bucketLabel: '30 分钟',
      seconds: 6 * 60 * 60,
      bucketSeconds: 30 * 60,
    }),
    '1d': ccSwitchModelWindowTrend({
      window: '1d',
      windowLabel: '近 1 天',
      bucketLabel: '2 小时',
      seconds: 24 * 60 * 60,
      bucketSeconds: 2 * 60 * 60,
    }),
    '7d': dailyTrend,
  };
}

function summarizeClaudeProjects(projects) {
  const summary = {
    project_count: 0,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
  };
  const modelMap = new Map();
  const topProjects = [];

  for (const [projectPath, project] of Object.entries(projects)) {
    const cost = asNumber(project.lastCost);
    const input = asNumber(project.lastTotalInputTokens);
    const output = asNumber(project.lastTotalOutputTokens);
    const cacheRead = asNumber(project.lastTotalCacheReadInputTokens);
    const cacheCreate = asNumber(project.lastTotalCacheCreationInputTokens);
    const webSearch = asNumber(project.lastTotalWebSearchRequests);
    if (!cost && !input && !output && !cacheRead && !cacheCreate) continue;

    summary.project_count += 1;
    summary.cost_usd += cost;
    summary.input_tokens += input;
    summary.output_tokens += output;
    summary.cache_read_tokens += cacheRead;
    summary.cache_creation_tokens += cacheCreate;
    summary.web_search_requests += webSearch;

    const modelUsage = project.lastModelUsage || {};
    for (const [model, usage] of Object.entries(modelUsage)) {
      const current = modelMap.get(model) || {
        model,
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        web_search_requests: 0,
      };
      current.cost_usd += asNumber(usage.costUSD);
      current.input_tokens += asNumber(usage.inputTokens);
      current.output_tokens += asNumber(usage.outputTokens);
      current.cache_read_tokens += asNumber(usage.cacheReadInputTokens);
      current.cache_creation_tokens += asNumber(usage.cacheCreationInputTokens);
      current.web_search_requests += asNumber(usage.webSearchRequests);
      modelMap.set(model, current);
    }

    topProjects.push({
      workspace: workspaceLabel(projectPath),
      workspace_path: workspacePath(projectPath),
      cost_usd: cost,
      cost_known: true,
      tokens: input + output + cacheRead + cacheCreate,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreate,
      web_search_requests: webSearch,
      model_count: Object.keys(modelUsage).length,
      record_count: 1,
      record_kind: 'project_aggregate',
      record_kinds: ['project_aggregate'],
      record_breakdown: [{ source: 'Claude Code', kind: 'project_aggregate', count: 1 }],
      sources: ['Claude Code'],
    });
  }

  topProjects.sort((a, b) =>
    projectTokenTotal(b) - projectTokenTotal(a)
    || (b.cost_usd || 0) - (a.cost_usd || 0)
    || String(a.workspace).localeCompare(String(b.workspace))
  );

  return {
    summary,
    models: [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 10),
    top_projects: topProjects,
  };
}

function localUsage() {
  const file = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(file)) {
    return { configured: false, status: { state: 'missing', message: '.claude.json not found' } };
  }

  const stat = fs.statSync(file);
  const rootJson = JSON.parse(fs.readFileSync(file, 'utf8'));
  const usage = summarizeClaudeProjects(rootJson.projects || {});

  return {
    configured: true,
    source: '.claude.json projects aggregate',
    status: { state: 'ok', last_modified: stat.mtimeMs },
    ...usage,
  };
}

async function commandDemo() {
  const home = os.homedir();
  const usage = localUsage();
  const codex = codexLocalUsage();
  const ccSwitch = ccSwitchUsage();
  const modelTrends = ccSwitchModelTrends();
  const modelDailyTrend = modelTrends['7d'];
  const newApi = await newApiStatus();
  const sub2Api = await sub2ApiStatus();
  const topProjects = mergeWorkspaceProjects(usage.top_projects || [], codex.top_projects || []);
  const summary = usage.configured && usage.status?.state === 'ok' ? usage.summary : null;
  const totalTokens = summary
    ? summary.input_tokens + summary.output_tokens + summary.cache_read_tokens + summary.cache_creation_tokens
    : 0;
  const workspaceTokens = topProjects.reduce((sum, project) => sum + projectTokenTotal(project), 0) || totalTokens;
  const healthyLocal = usage.configured && usage.status?.state === 'ok';

  const sources = [
    {
      id: 'claude-code-local',
      kind: 'claude_code_local',
      label: 'Claude Code 本地聚合',
      enabled: true,
      state: healthyLocal ? 'ok' : (usage.status?.state || 'missing'),
      message: healthyLocal ? '只读 .claude.json projects 聚合字段' : (usage.status?.message || '未读取'),
      last_read_at: usage.status?.last_modified ? new Date(usage.status.last_modified).toISOString() : undefined,
      capabilities: ['agent_usage', 'model_usage', 'project_usage'],
    },
    fileSourceStatus(
      'codex-local',
      'codex_local',
      'Codex 本地状态',
      path.join(home, '.codex', 'state_5.sqlite'),
      ['session_health', 'model_usage', 'project_usage']
    ),
    fileSourceStatus(
      'cc-switch',
      'cc_switch',
      'CC Switch',
      path.join(home, '.cc-switch', 'cc-switch.db'),
      ['agent_usage', 'provider_health', 'model_pricing']
    ),
    newApi.source,
    sub2Api.source,
    {
      id: 'windows-power',
      kind: 'system_api',
      label: 'Windows 电源',
      enabled: true,
      state: 'planned',
      message: '已在统一模型预留；demo 暂不读取系统 API',
      capabilities: ['device_power'],
    },
  ];
  const codexSource = sources.find(source => source.id === 'codex-local');
  if (codexSource && codex.status?.state) {
    codexSource.state = codex.status.state;
    codexSource.message = codex.status.state === 'ok'
      ? `已聚合 ${codex.models.length} 个 Codex 模型/provider 组合`
      : codex.status.message;
    codexSource.last_read_at = codex.status.last_modified ? new Date(codex.status.last_modified).toISOString() : codexSource.last_read_at;
  }
  const ccSwitchSource = sources.find(source => source.id === 'cc-switch');
  if (ccSwitchSource && ccSwitch.status?.state) {
    ccSwitchSource.state = ccSwitch.status.state;
    ccSwitchSource.message = ccSwitch.status.state === 'ok'
      ? `已聚合 ${ccSwitch.models.length} 个代理请求模型/provider 组合`
      : ccSwitch.status.message;
    ccSwitchSource.last_read_at = ccSwitch.status.last_modified ? new Date(ccSwitch.status.last_modified).toISOString() : ccSwitchSource.last_read_at;
  }

  const sourceCounts = sources.reduce((acc, source) => {
    acc[source.state] = (acc[source.state] || 0) + 1;
    return acc;
  }, {});

  const signals = [
    withSignalSemantics({
      id: 'signal-agent-cost',
      path: 'agent.usage.cost.aggregate',
      domain: 'agent',
      kind: 'usage',
      subject: 'claude-code-local',
      value: summary ? Number(summary.cost_usd.toFixed(4)) : null,
      unit: 'usd',
      confidence: 'observed',
      sourceId: 'claude-code-local',
    }),
    withSignalSemantics({
      id: 'signal-agent-tokens',
      path: 'agent.usage.tokens.total.aggregate',
      domain: 'agent',
      kind: 'usage',
      subject: 'agent-workspaces',
      value: workspaceTokens,
      unit: 'token',
      confidence: 'observed',
      sourceId: 'command-demo',
    }),
    withSignalSemantics({
      id: 'signal-project-count',
      path: 'agent.usage.projects.count',
      domain: 'agent',
      kind: 'inventory',
      subject: 'agent-workspaces',
      value: topProjects.length,
      unit: 'count',
      confidence: 'observed',
      sourceId: 'command-demo',
    }),
    withSignalSemantics({
      id: 'signal-source-ok',
      path: 'system.sources.ok.count',
      domain: 'system',
      kind: 'health',
      subject: 'sources',
      value: sourceCounts.ok || 0,
      unit: 'count',
      confidence: 'derived',
      sourceId: 'command-demo',
    }),
    ...newApi.signals,
    ...sub2Api.signals,
  ];
  const sourceRegistry = buildSourceRegistry({ sources, usage, codex, ccSwitch, newApi, sub2Api, home });

  const alerts = [...(newApi.alerts || []), ...(sub2Api.alerts || [])];
  if (!healthyLocal) {
    alerts.push({ level: 'warning', title: '本地 usage 未读取', detail: usage.status?.message || 'Claude Code 聚合源不可用' });
  }
  for (const source of sources) {
    if (source.id === 'newapi-main' || source.id === 'sub2api-main') continue;
    if (source.state === 'missing') {
      alerts.push({ level: 'info', title: `${source.label} 缺失`, detail: source.message });
    }
    if (source.state === 'disabled') {
      alerts.push({ level: 'info', title: `${source.label} 未启用`, detail: source.message });
    }
    if (source.state === 'auth_failed') {
      alerts.push({ level: 'warning', title: `${source.label} 鉴权失败`, detail: source.message });
    }
    if (source.state === 'unavailable') {
      alerts.push({ level: 'warning', title: `${source.label} 不可达`, detail: source.message });
    }
  }
  if (healthyLocal && alerts.length === 0) {
    alerts.push({ level: 'ok', title: '态势正常', detail: '首批本地聚合来源已可读。' });
  }

  const datasets = {
    alerts,
    top_models: usage.models || [],
    top_projects: topProjects.slice(0, 20),
    newapi_attempts: newApi.datasets?.attempts || [],
    newapi_model_stats: newApi.datasets?.model_stats || [],
    sub2api_model_stats: sub2Api.datasets?.model_stats || [],
    codex_model_stats: codex.models || [],
    cc_switch_model_stats: ccSwitch.models || [],
    source_registry: sourceRegistry,
    model_daily_trend: modelDailyTrend,
    model_trends: modelTrends,
  };

  return {
    generated_at: new Date().toISOString(),
    intent: {
      title: '个人作战仪表盘 Demo',
      mode: 'read_heavy_light_write',
      scope: 'Agent/API first, extensible to device/system/workflow',
      privacy: 'aggregate_only',
    },
    verdict: {
      state: healthyLocal ? 'watchable' : 'partial',
      label: healthyLocal ? '状态可观察' : '部分可观察',
      summary: healthyLocal
        ? `已读取 ${topProjects.length || summary.project_count} 个多源工作区聚合，当前 demo 可展示实际本地 usage。`
        : '本地 usage 缺失，demo 仍展示 source/signal 结构。',
    },
    sources,
    source_counts: sourceCounts,
    signals,
    datasets,
    semantic_projection: buildSemanticProjection({ sources, signals, datasets, sourceRegistry }),
  };
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(pathname).replace(/^[/\\]+/, '').replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, 'web', safePath);
  if (!file.startsWith(path.join(root, 'web')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(file);
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'text/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function proxy(req, res) {
  const target = new URL(req.url, upstream);
  const upstreamReq = http.request(target, { method: req.method, headers: req.headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstreamReq.on('error', error => sendJson(res, { error: error.message }, 502));
  req.pipe(upstreamReq);
}

async function requestHandler(req, res) {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/api/command-demo') {
    try {
      sendJson(res, await commandDemo());
    } catch (error) {
      sendJson(res, { status: { state: 'error', message: error.message } }, 500);
    }
    return;
  }
  if (
    requestUrl.pathname === '/api/sources'
    || requestUrl.pathname === '/api/signals'
    || requestUrl.pathname === '/api/datasets'
    || requestUrl.pathname.startsWith('/api/datasets/')
    || requestUrl.pathname === '/api/semantic-projection'
  ) {
    try {
      const response = commandDemoLayerResponse(await commandDemo(), requestUrl);
      if (response) sendJson(res, response.body, response.status);
      else sendJson(res, { error: 'not_found' }, 404);
    } catch (error) {
      sendJson(res, { status: { state: 'error', message: error.message } }, 500);
    }
    return;
  }
  if (req.url?.startsWith('/api/local-usage')) {
    try {
      sendJson(res, localUsage());
    } catch (error) {
      sendJson(res, { configured: true, status: { state: 'error', message: error.message } }, 500);
    }
    return;
  }
  if (req.url?.startsWith('/api/') || req.url === '/mcp') {
    proxy(req, res);
    return;
  }
  serveStatic(req, res);
}

if (shouldStartServer) {
  http.createServer(requestHandler).listen(port, '127.0.0.1', () => {
    console.log(`AgentSense local usage proxy: http://127.0.0.1:${port}`);
  });
}

export {
  buildSourceRegistry,
  buildSemanticProjection,
  commandDemoLayerResponse,
  datasetSemantics,
  mergeWorkspaceProjects,
  projectTokenTotal,
  requestHandler,
  signalSemantics,
  summarizeNewApiModelStats,
  summarizeSub2ApiModelStats,
  sub2ApiSignals,
  sub2ApiStatus,
  summarizeClaudeProjects,
  summarizeSub2ApiUsage,
  workspaceKey,
  workspaceLabel,
  workspacePath,
  withSignalSemantics,
};

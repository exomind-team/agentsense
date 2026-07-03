import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createDocumentStub() {
  return {
    createElement() {
      return {
        _text: '',
        set textContent(value) {
          this._text = value;
        },
        get innerHTML() {
          return htmlEscape(this._text);
        },
      };
    },
  };
}

function loadAppFunctions() {
  const appPath = fileURLToPath(new URL('../web/app.js', import.meta.url));
  const source = readFileSync(appPath, 'utf8');
  const bootIndex = source.indexOf('// ── Boot');
  assert.ok(bootIndex > 0, 'web/app.js should keep a boot marker for test isolation');
  const isolatedSource = `${source.slice(0, bootIndex)}
globalThis.__appTestExports = {
  sanitizeCommandSemanticSamples,
  buildCommandSemanticSamples,
  buildUnifiedCommandModelRows,
  buildSemanticTrendGroups,
  compactCommandHistoryForStorage,
  persistCommandHistoryStorage,
  recordCommandSnapshot,
  buildRelayTrendGroups,
  collectRelayMetrics,
  translateModelDatasetRow,
  TRANSLATION_RULES,
  formatModelSpendCell,
  mappingStatusLabel,
  renderPresentationBlueprint,
  renderSituationPath,
  renderIntentManifest,
  renderIntentDataMappings,
  renderMissingExplanations,
  renderFeedbackLoop,
  semanticTrendViewMode,
  transformSemanticTrendSeriesData,
  smoothTrendData,
  decimateTrendData,
  commandSemanticTrendViewOverrides,
  SEMANTIC_TREND_VIEW_MODES,
  __setCommandHistoryStorage(value) { commandHistoryStorage = value; },
  __getCommandHistoryStorage() { return commandHistoryStorage; },
  __setLocalStorage(value) { globalThis.localStorage = value; },
};
`;

  const context = {
    console,
    document: createDocumentStub(),
  };
  vm.createContext(context);
  vm.runInContext(isolatedSource, context, { filename: appPath });
  return context.__appTestExports;
}

const app = loadAppFunctions();

function findSample(samples, predicate) {
  const sample = samples.find(predicate);
  assert.ok(sample, 'expected semantic sample to exist');
  return sample;
}

function createSemanticSample(index) {
  return {
    value: index + 1,
    unit: 'token',
    metricRole: 'used',
    timeBehavior: 'cumulative',
    subjectType: 'model',
    source: 'Codex',
    path: `dataset.codex_model_stats.model.tokens.model-${index}`,
    seriesKey: `dataset:codex_model_stats|model:model-${index}|metric:tokens`,
    label: `model-${index} · Token`,
    metricIdentity: 'tokens',
    metricLabel: 'Token',
    knownness: 'derived',
    groupLabel: 'Token · 已用 · 累计 · 模型',
    extensionDomain: 'local_agent_usage',
    extensionLabel: '本地 Agent 使用 · 模型用量',
    presentationHint: '累计画像趋势',
  };
}

function createCommandHistoryPoint(ts, sampleCount = 48) {
  return {
    ts,
    cost: 1.23,
    tokens: 12_345,
    projects: 3,
    sourcesOk: 2,
    sourcesTotal: 2,
    apiQuotaAvailable: 88.8,
    apiQuotaUsed: 11.2,
    apiQuotaTotal: 100,
    apiUsagePercent: 11.2,
    sub2ApiBalance: 1000,
    sub2ApiTodayTokens: 5000,
    sub2ApiTodayCost: 0.42,
    sub2ApiTotalCost: 12.5,
    semanticSamples: Array.from({ length: sampleCount }, (_, index) => createSemanticSample(index)),
  };
}

function createQuotaBoundStorage(limit, { alwaysThrow = false } = {}) {
  return {
    writes: [],
    setItem(key, value) {
      if (alwaysThrow || String(value).length > limit) {
        const error = new Error(`Quota exceeded at ${String(value).length} bytes`);
        error.name = 'QuotaExceededError';
        throw error;
      }
      this.writes.push({ key, value });
    },
  };
}

describe('command semantic sample sanitation', () => {
  it('filters unknown/planned samples while preserving reported zero', () => {
    const samples = app.sanitizeCommandSemanticSamples([
      {
        value: 0,
        unit: 'usd',
        metricRole: 'used',
        timeBehavior: 'window',
        subjectType: 'api_key',
        source: 'Sub2API',
        path: 'api.sub2api.cost.today',
        knownness: 'reported_zero',
      },
      {
        value: 1,
        unit: 'usd',
        source: 'NewAPI',
        path: 'api.newapi.cost.unknown',
        knownness: ' Unknown ',
      },
      {
        value: 2,
        unit: 'count',
        source: 'Windows 电源',
        path: 'system.power.planned',
        knownness: 'PLANNED',
      },
    ]);

    assert.equal(samples.length, 1);
    assert.equal(samples[0].value, 0);
    assert.equal(samples[0].knownness, 'reported_zero');
    assert.equal(samples[0].metricIdentity, 'cost');
  });

  it('redacts bearer, API key, and dashboard-token shaped text before charting', () => {
    const apiKey = `sk-${'a'.repeat(32)}`;
    const dashboardToken = `qy${'B'.repeat(32)}`;
    const samples = app.sanitizeCommandSemanticSamples([
      {
        value: 7,
        unit: 'count',
        source: `Authorization: Bearer ${apiKey}`,
        path: `relay.path.Bearer ${apiKey}`,
        seriesKey: `series.${dashboardToken}`,
        label: `模型 ${apiKey} ${dashboardToken}`,
      },
    ]);

    assert.equal(samples.length, 1);
    const serialized = JSON.stringify(samples);
    assert.doesNotMatch(serialized, new RegExp(apiKey));
    assert.doesNotMatch(serialized, new RegExp(dashboardToken));
    assert.doesNotMatch(serialized, /Bearer\s+sk-/i);
    assert.match(serialized, /\[redacted/);
  });
});

describe('dataset row semantic adapter', () => {
  it('derives model and workspace metrics from dataset rows without hardcoded subjects', () => {
    const samples = app.buildCommandSemanticSamples({
      datasets: {
        top_models: [
          {
            model: 'claude-sonnet-test',
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 10,
            cache_creation_tokens: 5,
            cost_usd: 0.22,
          },
        ],
        codex_model_stats: [
          {
            source: 'Codex',
            provider: 'openai',
            model: 'gpt-5.5-test',
            total_tokens: 1000,
            requests: 3,
            sessions: 2,
            cost: null,
          },
        ],
        cc_switch_model_stats: [
          {
            source: 'CC Switch',
            app: 'codex',
            provider: 'openai',
            model: 'gpt-5.3-codex-test',
            input_tokens: 1,
            output_tokens: 2,
            cost: 0.01,
            requests: 1,
          },
        ],
        newapi_model_stats: [
          {
            source: 'NewAPI',
            model: 'gpt-5.5-relay',
            input_tokens: 10,
            output_tokens: 20,
            quota_used: 0.004,
            quota_unit: 'usd',
            requests: 5,
          },
        ],
        sub2api_model_stats: [
          {
            source: 'Sub2API',
            model: 'glm-5.1-relay',
            total_tokens: 500,
            cost: 0.12,
            cost_known: true,
            cost_unit: 'usd',
            requests: 7,
          },
          {
            source: 'Sub2API',
            model: 'token-only-model',
            total_tokens: 100,
            cost: null,
            cost_known: false,
            cost_unit: 'usd',
          },
          {
            source: 'Sub2API',
            model: 'unknown-zero-cost-model',
            total_tokens: 50,
            cost: 0,
            cost_known: false,
            cost_unit: 'usd',
          },
        ],
        top_projects: [
          {
            workspace: 'codex-only-workspace',
            workspace_path: 'H:/repo/codex-only-workspace',
            tokens: 2000,
            cost_usd: null,
            cost_known: false,
            record_count: 10,
            sessions: 4,
            model_count: 3,
            sources: ['Codex'],
          },
          {
            workspace: 'mixed-workspace',
            workspace_path: 'H:/repo/mixed-workspace',
            tokens: 3000,
            cost_usd: 1.5,
            cost_known: true,
            record_count: 2,
            sessions: 1,
            model_count: 1,
            sources: ['Claude Code', 'Codex'],
          },
        ],
      },
    });

    const codexTokens = findSample(samples, sample =>
      sample.path.includes('dataset.codex_model_stats.model.tokens.')
      && sample.label.includes('gpt-5.5-test')
    );
    assert.equal(codexTokens.source, 'Codex');
    assert.equal(codexTokens.value, 1000);
    assert.equal(codexTokens.unit, 'token');

    findSample(samples, sample =>
      sample.path.includes('dataset.codex_model_stats.model.requests.')
      && sample.label.includes('gpt-5.5-test')
      && sample.value === 3
    );
    findSample(samples, sample =>
      sample.path.includes('dataset.codex_model_stats.model.sessions.')
      && sample.label.includes('gpt-5.5-test')
      && sample.value === 2
    );
    assert.equal(
      samples.some(sample =>
        sample.path.includes('dataset.codex_model_stats.model.cost.')
        || (sample.source === 'Codex' && sample.label.includes('成本'))
      ),
      false,
      'Codex rows with unknown cost must not synthesize a cost sample',
    );

    const ccCost = findSample(samples, sample =>
      sample.path.includes('dataset.cc_switch_model_stats.model.cost.')
      && sample.label.includes('gpt-5.3-codex-test')
    );
    assert.equal(ccCost.value, 0.01);
    assert.equal(ccCost.unit, 'usd');

    const newApiQuota = findSample(samples, sample =>
      sample.path.includes('dataset.newapi_model_stats.model.quota.')
      && sample.label.includes('gpt-5.5-relay')
    );
    assert.equal(newApiQuota.value, 0.004);
    assert.equal(newApiQuota.unit, 'usd');
    assert.equal(
      samples.some(sample =>
        sample.path.includes('dataset.newapi_model_stats.model.cost.')
        && sample.label.includes('gpt-5.5-relay')
      ),
      false,
      'NewAPI quota must not be relabeled as comparable model cost',
    );

    findSample(samples, sample =>
      sample.path.includes('dataset.sub2api_model_stats.model.tokens.')
      && sample.label.includes('token-only-model')
      && sample.value === 100
    );
    assert.equal(
      samples.some(sample =>
        sample.path.includes('dataset.sub2api_model_stats.model.cost.')
        && sample.label.includes('token-only-model')
      ),
      false,
      'Sub2API rows with cost_known=false must keep cost unknown',
    );
    assert.equal(
      samples.some(sample =>
        sample.path.includes('dataset.sub2api_model_stats.model.cost.')
        && sample.label.includes('unknown-zero-cost-model')
      ),
      false,
      'Sub2API rows with cost=0 and cost_known=false must not become reported zero',
    );

    findSample(samples, sample =>
      sample.path.includes('dataset.top_projects.workspace.tokens.')
      && sample.label.includes('codex-only-workspace')
      && sample.value === 2000
    );
    assert.equal(
      samples.some(sample =>
        sample.path.includes('dataset.top_projects.workspace.cost.')
        && sample.label.includes('codex-only-workspace')
      ),
      false,
      'Codex-only workspace cost must not be converted to zero',
    );
    findSample(samples, sample =>
      sample.path.includes('dataset.top_projects.workspace.cost.')
      && sample.label.includes('mixed-workspace')
      && sample.value === 1.5
    );
  });

  it('does not aggregate unknown relay model cost into zero', () => {
    const onlyUnknown = app.collectRelayMetrics({
      sources: [{ id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'ok' }],
      signals: [],
      datasets: {
        sub2api_model_stats: [
          {
            model: 'unknown-cost',
            total_tokens: 100,
            cost: 0,
            cost_known: false,
            cost_unit: 'usd',
          },
        ],
      },
    });
    assert.equal(
      onlyUnknown.metrics.some(metric => metric.metric === 'model_cost'),
      false,
      'unknown cost rows must not synthesize a relay model cost metric',
    );

    const reportedZero = app.collectRelayMetrics({
      sources: [{ id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'ok' }],
      signals: [],
      datasets: {
        sub2api_model_stats: [
          {
            model: 'reported-zero-cost',
            total_tokens: 100,
            cost: 0,
            cost_known: true,
            cost_unit: 'usd',
          },
        ],
      },
    });
    const costMetric = findSample(reportedZero.metrics, metric => metric.metric === 'model_cost');
    assert.equal(costMetric.value, 0);
  });

  it('keeps partial unknown model cost visible when sources are mixed', () => {
    const rows = app.buildUnifiedCommandModelRows({
      datasets: {
        codex_model_stats: [
          {
            source: 'Codex',
            provider: 'openai',
            model: 'gpt-mixed',
            total_tokens: 1000,
            sessions: 2,
          },
        ],
        sub2api_model_stats: [
          {
            source: 'Sub2API',
            model: 'gpt-mixed',
            total_tokens: 2000,
            cost: 0.42,
            cost_known: true,
            cost_unit: 'usd',
            requests: 4,
          },
          {
            source: 'Sub2API',
            model: 'gpt-unknown-sub2',
            total_tokens: 500,
            cost: 0,
            cost_known: false,
            cost_unit: 'usd',
            requests: 1,
          },
        ],
      },
    });

    const mixed = findSample(rows, row => row.model === 'gpt-mixed');
    assert.equal(mixed.costKnown, true);
    assert.equal(mixed.cost, 0.42);
    assert.deepEqual(Array.from(mixed.unknownCostSources), ['Codex']);
    assert.match(app.formatModelSpendCell(mixed), /USD 成本 \$0\.42/);
    assert.match(app.formatModelSpendCell(mixed), /部分来源成本未知：Codex/);

    const unknownSub2 = findSample(rows, row => row.model === 'gpt-unknown-sub2');
    assert.equal(unknownSub2.costKnown, false);
    assert.equal(unknownSub2.cost, null);
    assert.deepEqual(Array.from(unknownSub2.unknownCostSources), ['Sub2API']);
    assert.match(app.formatModelSpendCell(unknownSub2), /成本未知：Sub2API/);
    assert.doesNotMatch(app.formatModelSpendCell(unknownSub2), /\$0\.00/);
  });
});

describe('semantic trend grouping', () => {
  it('separates same-unit metrics by metric identity while keeping same metric across sources together', () => {
    const groups = app.buildSemanticTrendGroups([
      {
        ts: 1_717_200_000_000,
        semanticSamples: [
          {
            value: 12,
            unit: 'count',
            metricRole: 'used',
            timeBehavior: 'cumulative',
            subjectType: 'workspace',
            source: 'Codex',
            path: 'dataset.top_projects.workspace.requests.repo',
            seriesKey: 'codex.requests.repo',
            label: 'repo · 请求',
            metricIdentity: 'requests',
            knownness: 'derived',
          },
          {
            value: 3,
            unit: 'count',
            metricRole: 'used',
            timeBehavior: 'cumulative',
            subjectType: 'workspace',
            source: 'Codex',
            path: 'dataset.top_projects.workspace.sessions.repo',
            seriesKey: 'codex.sessions.repo',
            label: 'repo · 会话',
            metricIdentity: 'sessions',
            knownness: 'derived',
          },
          {
            value: 9,
            unit: 'count',
            metricRole: 'used',
            timeBehavior: 'cumulative',
            subjectType: 'workspace',
            source: 'Claude Code',
            path: 'dataset.top_projects.workspace.requests.repo',
            seriesKey: 'claude.requests.repo',
            label: 'repo · 请求',
            metricIdentity: 'requests',
            knownness: 'derived',
          },
          {
            value: 0.4,
            unit: 'usd',
            metricRole: 'used',
            timeBehavior: 'cumulative',
            subjectType: 'model',
            source: 'Sub2API',
            path: 'dataset.sub2api_model_stats.model.cost.gpt-test',
            seriesKey: 'sub2api.cost.gpt-test',
            label: 'gpt-test · 成本',
            metricIdentity: 'cost',
            knownness: 'derived',
          },
          {
            value: 0.4,
            unit: 'usd',
            metricRole: 'used',
            timeBehavior: 'cumulative',
            subjectType: 'model',
            source: 'NewAPI',
            path: 'dataset.newapi_model_stats.model.quota.gpt-test',
            seriesKey: 'newapi.quota.gpt-test',
            label: 'gpt-test · 额度',
            metricIdentity: 'quota',
            knownness: 'derived',
          },
        ],
      },
    ]);

    const countGroups = groups.filter(group => group.unit === 'count' && group.subjectType === 'workspace');
    assert.equal(countGroups.length, 2, 'requests and sessions are both count, but must not share one axis');
    const requestsGroup = findSample(countGroups, group => group.metricIdentity === 'requests');
    assert.equal(requestsGroup.series.size, 2, 'same metric identity should compare multiple sources in one group');
    assert.deepEqual([...requestsGroup.sources], ['Claude Code', 'Codex']);

    const usdModelGroups = groups.filter(group => group.unit === 'usd' && group.subjectType === 'model');
    assert.equal(usdModelGroups.length, 2, 'quota and cost can both be USD, but they are not the same metric');
    assert.ok(usdModelGroups.some(group => group.metricIdentity === 'cost'));
    assert.ok(usdModelGroups.some(group => group.metricIdentity === 'quota'));
  });

  it('keeps point-level evidence and filters unknown samples from trend groups', () => {
    const groups = app.buildSemanticTrendGroups([
      {
        ts: 1_717_200_000_000,
        semanticSamples: [
          {
            value: 0,
            unit: 'usd',
            metricRole: 'used',
            timeBehavior: 'window',
            subjectType: 'api_key',
            source: 'Sub2API',
            path: 'api.sub2api.cost.today',
            seriesKey: 'api.sub2api.cost.today',
            label: 'Sub2API 今日成本',
            knownness: 'reported_zero',
          },
          {
            value: 9,
            unit: 'usd',
            metricRole: 'used',
            timeBehavior: 'window',
            subjectType: 'api_key',
            source: 'NewAPI',
            path: 'api.newapi.cost.unknown',
            seriesKey: 'api.newapi.cost.unknown',
            label: 'NewAPI 未知成本',
            knownness: 'unknown',
          },
        ],
      },
    ]);

    assert.equal(groups.length, 1);
    const [series] = groups[0].series.values();
    assert.equal(series.data.length, 1);
    assert.deepEqual(Array.from(series.data[0].value), [1_717_200_000_000, 0]);
    assert.equal(series.data[0].knownness, 'reported_zero');
    assert.equal(series.data[0].path, 'api.sub2api.cost.today');
  });

  it('selects semantic view modes from role, time behavior, and magnitude span', () => {
    const baseGroup = overrides => ({
      metricRole: 'used',
      timeBehavior: 'window',
      unit: 'count',
      unitFamily: 'count',
      subjectType: 'api_key',
      series: new Map([
        ['a', { data: [{ value: [1, 10] }, { value: [2, 12] }] }],
      ]),
      ...overrides,
    });

    assert.equal(app.semanticTrendViewMode(baseGroup({
      metricRole: 'available',
      timeBehavior: 'instant',
      unit: 'usd',
      unitFamily: 'currency',
    })), 'focused');

    assert.equal(app.semanticTrendViewMode(baseGroup({
      metricRole: 'used',
      timeBehavior: 'cumulative',
      unit: 'token',
      unitFamily: 'token',
    })), 'delta');

    assert.equal(app.semanticTrendViewMode(baseGroup({
      metricRole: 'used',
      timeBehavior: 'window',
      unit: 'count',
      unitFamily: 'count',
    })), 'absolute');

    assert.equal(app.semanticTrendViewMode(baseGroup({
      metricRole: 'used',
      timeBehavior: 'cumulative',
      unit: 'token',
      unitFamily: 'token',
      series: new Map([
        ['large', { data: [{ value: [1, 1_000_000] }] }],
        ['small', { data: [{ value: [1, 1_000] }] }],
      ]),
    })), 'normalized');
  });

  it('transforms trend data while preserving raw values and point evidence', () => {
    const delta = app.transformSemanticTrendSeriesData([
      {
        value: [1_717_200_000_000, 100],
        knownness: 'derived',
        path: 'dataset.top_projects.workspace.tokens.repo',
        label: 'repo · Token',
      },
      {
        value: [1_717_200_060_000, 125],
        knownness: 'derived',
        path: 'dataset.top_projects.workspace.tokens.repo',
        label: 'repo · Token',
      },
    ], 'delta');

    assert.equal(delta[0].rawValue, 100);
    assert.equal(delta[0].knownness, 'derived');
    assert.equal(delta[0].path, 'dataset.top_projects.workspace.tokens.repo');
    assert.deepEqual(Array.from(delta[0].value), [1_717_200_000_000, 0]);
    assert.deepEqual(Array.from(delta[1].value), [1_717_200_060_000, 25]);

    const normalized = app.transformSemanticTrendSeriesData([
      { value: [1, 0], knownness: 'reported_zero', path: 'api.sub2api.cost.model' },
      { value: [2, 50], knownness: 'derived', path: 'api.sub2api.cost.model' },
      { value: [3, 75], knownness: 'derived', path: 'api.sub2api.cost.model' },
    ], 'normalized');

    assert.equal(normalized[0].rawValue, 0);
    assert.equal(normalized[0].knownness, 'reported_zero');
    assert.deepEqual(Array.from(normalized[1].value), [2, 0]);
    assert.deepEqual(Array.from(normalized[2].value), [3, 50]);

    const allZero = app.transformSemanticTrendSeriesData([
      { value: [1, 0], knownness: 'reported_zero', path: 'api.sub2api.cost.zero' },
    ], 'normalized');
    assert.equal(allZero[0].rawValue, 0);
    assert.equal(allZero[0].knownness, 'reported_zero');
    assert.deepEqual(Array.from(allZero[0].value), [1, 0]);
  });
});

describe('command history persistence', () => {
  it('degrades stored history size when localStorage quota is tight', () => {
    const storage = createQuotaBoundStorage(12_000);
    const now = Date.now();
    const history = Array.from({ length: 60 }, (_, index) =>
      createCommandHistoryPoint(now - (59 - index) * 60_000, 64)
    );

    const result = app.persistCommandHistoryStorage(history, storage);

    assert.equal(result.persisted, true);
    assert.equal(result.degraded, true);
    assert.notEqual(result.reason, 'full');
    assert.equal(storage.writes.length, 1);
    assert.ok(result.history.length < history.length || result.history.some(point => point.semanticSamples.length < 64));
    assert.ok(storage.writes[0].value.length <= 12_000);
  });

  it('does not throw when command snapshot persistence fails completely', () => {
    app.__setCommandHistoryStorage([]);
    app.__setLocalStorage(createQuotaBoundStorage(1, { alwaysThrow: true }));

    const data = {
      generated_at: new Date(Date.now()).toISOString(),
      sources: [{ id: 'codex-main', label: 'Codex', state: 'ok' }],
      source_counts: { ok: 1 },
      signals: [
        { path: 'agent.usage.cost.aggregate', value: 12.5, unit: 'usd' },
        { path: 'agent.usage.tokens.total.aggregate', value: 123456, unit: 'token' },
        { path: 'agent.usage.projects.count', value: 4, unit: 'count' },
      ],
      datasets: {
        codex_model_stats: [
          {
            source: 'Codex',
            provider: 'openai',
            model: 'gpt-5.5-test',
            total_tokens: 1000,
            requests: 3,
            sessions: 2,
          },
        ],
      },
    };

    assert.doesNotThrow(() => app.recordCommandSnapshot(data));
    const history = app.__getCommandHistoryStorage();
    assert.equal(history.length, 1);
    assert.equal(history[0].cost, 12.5);
    assert.equal(history[0].tokens, 123456);
  });
});

describe('relay trend grouping', () => {
  it('separates balance, cost, and quota even when they are all USD in source view', () => {
    const groups = app.buildRelayTrendGroups([
      {
        ts: 1_717_200_000_000,
        semanticSamples: [
          {
            value: 1049.93,
            unit: 'usd',
            unitFamily: 'currency',
            metricRole: 'available',
            timeBehavior: 'instant',
            subjectType: 'api_key',
            source: 'Sub2API',
            path: 'api.sub2api.balance.available',
            seriesKey: 'api.sub2api.balance.available',
            label: 'Sub2API 可用余额',
            metricIdentity: 'balance',
            knownness: 'known',
          },
          {
            value: 12.34,
            unit: 'usd',
            unitFamily: 'currency',
            metricRole: 'used',
            timeBehavior: 'window',
            subjectType: 'api_key',
            source: 'Sub2API',
            path: 'api.sub2api.cost.today',
            seriesKey: 'api.sub2api.cost.today',
            label: 'Sub2API 今日成本',
            metricIdentity: 'cost',
            knownness: 'known',
          },
          {
            value: 88.8,
            unit: 'usd',
            unitFamily: 'currency',
            metricRole: 'available',
            timeBehavior: 'instant',
            subjectType: 'account',
            source: 'NewAPI',
            path: 'api.newapi.quota.available',
            seriesKey: 'api.newapi.quota.available',
            label: 'NewAPI 可用额度',
            metricIdentity: 'quota',
            knownness: 'known',
          },
        ],
      },
    ], 'source');

    const usdGroups = groups.filter(group => group.unit === 'usd');
    assert.equal(usdGroups.length, 3);
    assert.deepEqual(
      Array.from(usdGroups.map(group => group.metricIdentity).sort()),
      ['balance', 'cost', 'quota'],
    );
    assert.ok(usdGroups.find(group => group.metricIdentity === 'balance').label.includes('可用余额'));
    assert.ok(usdGroups.find(group => group.metricIdentity === 'cost').label.includes('今日成本'));
    assert.ok(usdGroups.find(group => group.metricIdentity === 'quota').label.includes('可用额度'));
  });

  it('keeps the same relay metric comparable across relay sources in metric view', () => {
    const groups = app.buildRelayTrendGroups([
      {
        ts: 1_717_200_000_000,
        semanticSamples: [
          {
            value: 10,
            unit: 'token',
            unitFamily: 'token',
            metricRole: 'used',
            timeBehavior: 'window',
            subjectType: 'api_key',
            source: 'Sub2API',
            path: 'api.sub2api.tokens.today',
            seriesKey: 'api.sub2api.tokens.today',
            label: 'Sub2API 今日 Token',
            metricIdentity: 'tokens',
            knownness: 'known',
          },
          {
            value: 7,
            unit: 'token',
            unitFamily: 'token',
            metricRole: 'used',
            timeBehavior: 'window',
            subjectType: 'account',
            source: 'NewAPI',
            path: 'api.newapi.tokens.today',
            seriesKey: 'api.newapi.tokens.today',
            label: 'NewAPI 今日 Token',
            metricIdentity: 'tokens',
            knownness: 'known',
          },
        ],
      },
    ], 'metric');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].metricIdentity, 'tokens');
    assert.deepEqual(
      Array.from([...groups[0].series.values()].map(series => series.name).sort()),
      ['NewAPI', 'Sub2API'],
    );
  });
});

describe('presentation blueprint rendering', () => {
  it('renders lane questions as explicit intent prompts', () => {
    const container = { innerHTML: '' };
    app.renderPresentationBlueprint({
      principle: '先回答问题，再选择图表',
      lanes: [
        {
          id: 'reserve-risk',
          name: '余量风险',
          widget: 'risk-card',
          question: '哪些 API 余额或额度需要注意？',
          purpose: '回答可用量和已用量是否接近风险线',
          metric_group_ids: ['quota', 'balance'],
          dataset_ids: ['relay_usage'],
          evidence_count: 3,
          why_visible: '因为这一组直接回答余量风险。',
          why_missing: '当前仍缺少一部分额度信号。',
          evidence_refs: [{ id: 'note-1', kind: 'evidence', label: 'Sub2API 今日余额' }],
          next_action: '继续补齐 NewAPI 余额采集。',
          rules: ['余额、额度、成本分图'],
        },
      ],
    }, container);

    assert.match(container.innerHTML, /先回答问题，再选择图表/);
    assert.match(container.innerHTML, /回答：哪些 API 余额或额度需要注意？/);
    assert.match(container.innerHTML, /指标组 <strong>2<\/strong>/);
    assert.match(container.innerHTML, /数据集 <strong>1<\/strong>/);
    assert.match(container.innerHTML, /证据 <strong>3<\/strong>/);
    assert.match(container.innerHTML, /为什么显示/);
    assert.match(container.innerHTML, /因为这一组直接回答余量风险/);
    assert.match(container.innerHTML, /为什么缺失/);
    assert.match(container.innerHTML, /当前仍缺少一部分额度信号/);
    assert.match(container.innerHTML, /证据引用/);
    assert.match(container.innerHTML, /Sub2API 今日余额/);
    assert.match(container.innerHTML, /下一步/);
    assert.match(container.innerHTML, /继续补齐 NewAPI 余额采集/);
  });

  it('escapes lane questions and rules before inserting HTML', () => {
    const container = { innerHTML: '' };
    app.renderPresentationBlueprint({
      principle: '<strong>原则</strong>',
      lanes: [
        {
          id: 'audit',
          name: '审计',
          widget: 'audit-table',
          question: '这里会不会执行 <script>alert(1)</script>？',
          purpose: '验证 <img src=x onerror=alert(1)> 不被执行',
          metric_group_ids: [],
          dataset_ids: [],
          evidence_count: 0,
          rules: ['不要信任 <b>provider 字段</b>'],
        },
      ],
    }, container);

    assert.doesNotMatch(container.innerHTML, /<script>/);
    assert.doesNotMatch(container.innerHTML, /<img src=x/);
    assert.doesNotMatch(container.innerHTML, /<b>provider/);
    assert.match(container.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(container.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(container.innerHTML, /&lt;b&gt;provider 字段&lt;\/b&gt;/);
  });

  it('renders situation path cards with escaped explanations and references', () => {
    const container = { innerHTML: '' };
    app.renderSituationPath({
      title: '首屏感知链',
      principle: '先解释当前首屏在看什么。',
      cards: [
        {
          id: 'reserve-risk',
          name: '余量风险',
          current_focus: '哪些 API 快接近风险线？',
          top_risk: 'auth_failed 1 项',
          risk_reason: 'Sub2API 鉴权失败，当前结论不完整。',
          missing_reason: 'NewAPI 余额暂时缺失。',
          evidence_entry: 'signal-sub2api-balance-available',
          next_action: '修复 <script>alert(1)</script> 后重采。',
          linked_intent_ids: ['judge-reserve-risk'],
          linked_lane_ids: ['reserve-risk'],
          linked_evidence_ids: ['note-1', '<note-2>'],
        },
      ],
    }, container);

    assert.match(container.innerHTML, /首屏感知链/);
    assert.match(container.innerHTML, /余量风险/);
    assert.match(container.innerHTML, /哪些 API 快接近风险线/);
    assert.match(container.innerHTML, /Sub2API 鉴权失败/);
    assert.match(container.innerHTML, /judge-reserve-risk/);
    assert.doesNotMatch(container.innerHTML, /<script>/);
    assert.match(container.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(container.innerHTML, /&lt;note-2&gt;/);
  });
});

describe('intent-driven semantic projection rendering', () => {
  it('renders intent manifest, mappings, missing explanations, and feedback loop', () => {
    const manifestBox = { innerHTML: '' };
    app.renderIntentManifest([
      {
        id: 'judge-reserve-risk',
        name: '判断余量风险',
        priority: 2,
        question_type: 'reserve-risk',
        core_question: '还能用多少？',
        answer_contract: '余额、额度、成本分离。',
        missing_policy: '缺失也显示原因。',
        desired_widgets: ['reserve-card', 'window-trend'],
      },
    ], manifestBox);

    assert.match(manifestBox.innerHTML, /判断余量风险/);
    assert.match(manifestBox.innerHTML, /还能用多少？/);
    assert.match(manifestBox.innerHTML, /reserve-card/);

    const mappingBox = { innerHTML: '' };
    app.renderIntentDataMappings([
      {
        intent_id: 'judge-reserve-risk',
        intent_name: '判断余量风险',
        priority: 2,
        status: 'ready',
        core_question: '还能用多少？',
        basis: '由 metric_groups \/ dataset_groups 的语义字段匹配得出。',
        metric_group_ids: ['available-balance', 'available-quota'],
        dataset_ids: ['source_registry'],
        evidence_note_ids: ['note-1'],
        available_widgets: ['reserve-card'],
      },
    ], mappingBox);

    assert.match(mappingBox.innerHTML, /就绪/);
    assert.match(mappingBox.innerHTML, /指标组 <strong>2<\/strong>/);
    assert.match(mappingBox.innerHTML, /数据集 <strong>1<\/strong>/);
    assert.match(mappingBox.innerHTML, /证据 <strong>1<\/strong>/);

    const missingBox = { innerHTML: '' };
    app.renderMissingExplanations([
      {
        subject_label: 'MiniMax 国内版',
        subject_type: 'source',
        layer: 'source-acquisition',
        reason_code: 'not_connected',
        reason_label: '未接入新态势台',
        severity: 'info',
        message: '代码能力存在，但没有接入新态势台语义 adapter。',
        missing_items: ['Source/Signal/Dataset adapter'],
        suggested_action: '补齐 adapter 后进入统一映射。',
      },
    ], missingBox);

    assert.match(missingBox.innerHTML, /MiniMax 国内版/);
    assert.match(missingBox.innerHTML, /未接入新态势台/);
    assert.match(missingBox.innerHTML, /Source\/Signal\/Dataset adapter/);

    const feedbackBox = { innerHTML: '' };
    app.renderFeedbackLoop({
      title: '反馈闭环 V1',
      principle: '每个图表都要能追溯到意图、数据证据和缺失解释。',
      loop: [
        { id: 'observe', name: '观察', output: '用户提出态势问题。' },
        { id: 'map-data', name: '数据映射', output: '匹配 metric_groups / dataset_groups。' },
      ],
      intent_status: [
        { intent_id: 'judge-reserve-risk', name: '判断余量风险', status: 'partial', metric_group_count: 2, dataset_count: 1, evidence_count: 0 },
      ],
      review_checks: ['新增图表前先检查是否能由语义自动派生。'],
    }, feedbackBox);

    assert.match(feedbackBox.innerHTML, /反馈闭环 V1/);
    assert.match(feedbackBox.innerHTML, /部分就绪/);
    assert.match(feedbackBox.innerHTML, /2 指标 · 1 数据集 · 0 证据/);
    assert.match(feedbackBox.innerHTML, /新增图表前先检查/);
  });

  it('escapes intent rendering inputs and labels mapping statuses', () => {
    assert.equal(app.mappingStatusLabel('ready'), '就绪');
    assert.equal(app.mappingStatusLabel('partial'), '部分就绪');
    assert.equal(app.mappingStatusLabel('explainable_gap'), '可解释缺口');
    assert.equal(app.mappingStatusLabel('missing'), '缺失');

    const manifestBox = { innerHTML: '' };
    app.renderIntentManifest([
      {
        id: 'audit',
        name: '<img src=x onerror=alert(1)>',
        question_type: 'evidence-quality',
        core_question: '会执行 <script>alert(1)</script> 吗？',
        answer_contract: '不要相信 <b>字段</b>。',
        missing_policy: '显示 & 解释。',
        desired_widgets: ['<widget>'],
      },
    ], manifestBox);

    assert.doesNotMatch(manifestBox.innerHTML, /<script>/);
    assert.doesNotMatch(manifestBox.innerHTML, /<img src=x/);
    assert.doesNotMatch(manifestBox.innerHTML, /<b>字段/);
    assert.match(manifestBox.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(manifestBox.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(manifestBox.innerHTML, /&lt;widget&gt;/);

    const missingBox = { innerHTML: '' };
    app.renderMissingExplanations([
      {
        subject_label: '<source>',
        layer: '<layer>',
        subject_type: '<type>',
        reason_label: '<reason>',
        reason_code: 'unknown',
        message: '不要渲染 <svg onload=alert(1)>',
        missing_items: ['<token>'],
        suggested_action: '检查 <adapter>',
      },
    ], missingBox);

    assert.doesNotMatch(missingBox.innerHTML, /<svg onload/);
    assert.doesNotMatch(missingBox.innerHTML, /<adapter>/);
    assert.match(missingBox.innerHTML, /&lt;source&gt;/);
    assert.match(missingBox.innerHTML, /&lt;token&gt;/);
    assert.match(missingBox.innerHTML, /&lt;adapter&gt;/);
  });
});


describe('trend data preprocessing', () => {
  it('smoothTrendData returns short arrays unchanged', () => {
    const short = [{ value: [1, 10] }, { value: [2, 20] }];
    assert.deepEqual(app.smoothTrendData(short), short);
    assert.deepEqual(app.smoothTrendData([]), []);
  });

  it('smoothTrendData applies EMA smoothing to longer arrays', () => {
    const data = [
      { value: [1, 10] },
      { value: [2, 12] },
      { value: [3, 11] },
      { value: [4, 13] },
    ];
    const smoothed = app.smoothTrendData(data, 0.5);
    assert.equal(smoothed.length, 4);
    // First point should be unchanged
    assert.equal(smoothed[0].rawValue, undefined);
    assert.deepEqual(Array.from(smoothed[0].value), [1, 10]);
    // Second point should be smoothed: 0.5 * 12 + 0.5 * 10 = 11
    assert.ok(Math.abs(smoothed[1].value[1] - 11) < 0.001);
  });

  it('smoothTrendData handles null values without crashing', () => {
    const data = [
      { value: [1, 10] },
      { value: [2, null] },
      { value: [3, 15] },
    ];
    const smoothed = app.smoothTrendData(data, 0.5);
    assert.equal(smoothed.length, 3);
    assert.equal(smoothed[1].value[1], null);
  });

  it('decimateTrendData returns input when target is not needed', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ value: [i, i * 10] }));
    assert.equal(app.decimateTrendData(data, 20).length, 10);
    assert.equal(app.decimateTrendData(data, 0).length, 10);
    assert.equal(app.decimateTrendData(data, 2).length, 10);
  });

  it('decimateTrendData reduces points while preserving endpoints', () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ value: [i, Math.sin(i / 10) * 100] }));
    const decimated = app.decimateTrendData(data, 50);
    assert.equal(decimated.length, 50);
    // First and last points should be preserved
    assert.deepEqual(Array.from(decimated[0].value), [0, Math.sin(0) * 100]);
    assert.deepEqual(Array.from(decimated[decimated.length - 1].value), [199, Math.sin(199 / 10) * 100]);
  });
});

describe('semantic view mode overrides', () => {
  it('view mode respects user override', () => {
    const group = {
      key: 'test-override',
      metricRole: 'used',
      timeBehavior: 'cumulative',
      unit: 'token',
      unitFamily: 'token',
      series: new Map([
        ['a', { data: [{ value: [1, 100] }, { value: [2, 200] }] }],
      ]),
    };
    // Default should be delta for cumulative used
    assert.equal(app.semanticTrendViewMode(group), 'delta');
    // Set override
    app.commandSemanticTrendViewOverrides.set('test-override', 'absolute');
    assert.equal(app.semanticTrendViewMode(group), 'absolute');
    // Clean up
    app.commandSemanticTrendViewOverrides.delete('test-override');
  });

  it('SEMANTIC_TREND_VIEW_MODES contains expected modes', () => {
    assert.equal(JSON.stringify(app.SEMANTIC_TREND_VIEW_MODES), JSON.stringify(['absolute', 'focused', 'delta', 'normalized']));
  });
});

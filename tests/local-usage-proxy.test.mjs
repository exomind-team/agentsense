import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSemanticProjection,
  buildSourceRegistry,
  commandDemoLayerResponse,
  datasetSemantics,
  mergeWorkspaceProjects,
  signalSemantics,
  summarizeClaudeProjects,
  summarizeNewApiModelStats,
  summarizeSub2ApiModelStats,
  summarizeSub2ApiUsage,
  sub2ApiSignals,
} from '../local-usage-proxy.mjs';

const SAMPLE_SUB2API_BALANCE = 123.45;
const SAMPLE_SUB2API_TOTAL_COST = 67.89;

const RELAY_ENV_NAMES = [
  'AGENTSENSE_NEWAPI_BASE_URL',
  'AGENTSENSE_NEWAPI_TOKEN',
  'AGENTSENSE_SUB2API_BASE_URL',
  'AGENTSENSE_SUB2API_API_KEY',
  'AGENTSENSE_SUB2API_KEY',
];

function withRelayEnvUnset(fn) {
  const saved = Object.fromEntries(RELAY_ENV_NAMES.map(name => [name, process.env[name]]));
  for (const name of RELAY_ENV_NAMES) delete process.env[name];
  try {
    return fn();
  } finally {
    for (const name of RELAY_ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function sampleLayeredDemo() {
  const sourceRegistry = withRelayEnvUnset(() => buildSourceRegistry({
    sources: [
      { id: 'newapi-main', kind: 'newapi', label: 'NewAPI', state: 'missing', enabled: false },
      { id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'ok', enabled: true },
    ],
    home: 'Z:/agent-sense-test-home',
  }));
  const sources = [
    { id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'ok' },
    { id: 'windows-power', kind: 'system_api', label: 'Windows 电源', state: 'planned' },
  ];
  const signals = [
    {
      id: 'signal-sub2api-balance-available',
      path: 'api.sub2api.balance.available',
      domain: 'api',
      kind: 'balance',
      subject: 'sub2api-main',
      sourceId: 'sub2api-main',
      value: SAMPLE_SUB2API_BALANCE,
      unit: 'usd',
      confidence: 'reported',
    },
    {
      id: 'signal-sub2api-cost-today',
      path: 'api.sub2api.cost.today',
      domain: 'api',
      kind: 'usage',
      subject: 'sub2api-main',
      sourceId: 'sub2api-main',
      value: 0,
      unit: 'usd',
      confidence: 'reported',
    },
    {
      id: 'signal-agent-tokens',
      path: 'agent.usage.tokens.total.aggregate',
      domain: 'agent',
      kind: 'usage',
      subject: 'agent-workspaces',
      sourceId: 'command-demo',
      value: 9000,
      unit: 'token',
      confidence: 'derived',
    },
  ];
  const datasets = {
    source_registry: sourceRegistry,
    sub2api_model_stats: [{ source: 'Sub2API', model: 'gpt-test', total_tokens: 1200, cost: 0.42 }],
  };

  return {
    generated_at: '2026-06-09T00:00:00.000Z',
    sources,
    source_counts: { ok: 1, planned: 1 },
    signals,
    datasets,
    semantic_projection: buildSemanticProjection({ sources, signals, datasets, sourceRegistry }),
  };
}

describe('workspace usage aggregation', () => {
  it('orders workspaces from input usage instead of workspace names', () => {
    const rows = mergeWorkspaceProjects(
      [{
        workspace: 'workspace-alpha',
        workspace_path: 'H:/A137442/Develop/AI/workspace-alpha',
        cost_usd: 120,
        cost_known: true,
        tokens: 1_000,
        record_count: 1,
        record_kind: 'project_aggregate',
        sources: ['Claude Code'],
      }],
      [{
        workspace: 'workspace-beta',
        workspace_path: 'H:/A137442/Develop/AI/workspace-beta',
        cost_usd: null,
        cost_known: false,
        tokens: 9_000,
        sessions: 4,
        record_count: 4,
        record_kind: 'session',
        sources: ['Codex'],
      }],
    );

    assert.equal(rows[0].workspace, 'workspace-beta');
    assert.equal(rows[0].tokens, 9_000);
    assert.equal(rows[1].workspace, 'workspace-alpha');
  });

  it('merges Claude Code project aggregates and Codex sessions by normalized path', () => {
    const rows = mergeWorkspaceProjects(
      [{
        workspace: 'workspace-alpha',
        workspace_path: 'H:\\A137442\\Develop\\AI\\workspace-alpha',
        cost_usd: 2.5,
        cost_known: true,
        input_tokens: 100,
        output_tokens: 200,
        cache_read_tokens: 300,
        cache_creation_tokens: 400,
        record_count: 1,
        record_kind: 'project_aggregate',
        sources: ['Claude Code'],
      }],
      [{
        workspace: 'workspace-alpha',
        workspace_path: 'h:/A137442/Develop/AI/workspace-alpha',
        cost_usd: null,
        cost_known: false,
        tokens: 5_000,
        sessions: 3,
        record_count: 3,
        record_kind: 'session',
        sources: ['Codex'],
        latest_at: '2026-06-08T12:00:00.000Z',
      }],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].tokens, 6_000);
    assert.equal(rows[0].cost_known, true);
    assert.equal(rows[0].cost_usd, 2.5);
    assert.equal(rows[0].sessions, 3);
    assert.equal(rows[0].record_count, 4);
    assert.deepEqual(rows[0].record_kinds.sort(), ['project_aggregate', 'session']);
    assert.deepEqual(rows[0].sources.sort(), ['Claude Code', 'Codex']);
    assert.deepEqual(rows[0].record_breakdown.sort((a, b) => a.source.localeCompare(b.source)), [
      { source: 'Claude Code', kind: 'project_aggregate', count: 1, synthetic: true },
      { source: 'Codex', kind: 'session', count: 3, synthetic: true },
    ]);
    assert.equal(rows[0].latest_at, '2026-06-08T12:00:00.000Z');
  });

  it('keeps Codex-only workspace cost unknown instead of converting it to zero', () => {
    const [row] = mergeWorkspaceProjects([{
      workspace: 'codex-only',
      workspace_path: 'H:/A137442/Develop/AI/codex-only',
      cost_usd: null,
      cost_known: false,
      tokens: 4_200,
      sessions: 2,
      record_count: 2,
      record_kind: 'session',
      sources: ['Codex'],
    }]);

    assert.equal(row.cost_known, false);
    assert.equal(row.cost_status, 'unknown');
    assert.equal(row.cost_usd, null);
  });

  it('marks inferred workspace record breakdown as synthetic evidence', () => {
    const [row] = mergeWorkspaceProjects([{
      workspace: 'workspace-inferred',
      workspace_path: 'H:/A137442/Develop/AI/workspace-inferred',
      cost_usd: null,
      cost_known: false,
      tokens: 1_000,
      sessions: 2,
      record_count: 2,
      record_kind: 'session',
      sources: ['Codex'],
    }]);

    assert.deepEqual(row.record_breakdown, [
      { source: 'Codex', kind: 'session', count: 2, synthetic: true },
    ]);
  });

  it('does not pre-truncate Claude Code workspaces by cost before token ranking', () => {
    const projects = Object.fromEntries([
      ['H:/repo/high-token-low-cost', {
        lastCost: 0.01,
        lastTotalInputTokens: 20_000,
        lastTotalOutputTokens: 10_000,
      }],
      ...Array.from({ length: 12 }, (_, index) => [
        `H:/repo/high-cost-${index}`,
        {
          lastCost: 100 - index,
          lastTotalInputTokens: 10 + index,
          lastTotalOutputTokens: 5,
        },
      ]),
    ]);

    const usage = summarizeClaudeProjects(projects);

    assert.equal(usage.top_projects[0].workspace, 'high-token-low-cost');
    assert.equal(usage.top_projects.length, 13);
    assert.equal(usage.top_projects[0].record_count, 1);
    assert.deepEqual(usage.top_projects[0].record_kinds, ['project_aggregate']);
    assert.deepEqual(usage.top_projects[0].record_breakdown, [
      { source: 'Claude Code', kind: 'project_aggregate', count: 1 },
    ]);
  });
});

describe('relay source metric semantics', () => {
  it('treats NewAPI model usage as quota rather than comparable model cost', () => {
    const rows = summarizeNewApiModelStats([
      {
        model_name: 'model-alpha',
        prompt_tokens: 100,
        completion_tokens: 50,
        quota: 30,
        created_at: 1_717_200_000,
      },
      {
        model_name: 'model-alpha',
        prompt_tokens: 10,
        completion_tokens: 5,
        quota: 2,
        created_at: 1_717_210_000,
      },
    ], { displayType: 'USD', quotaPerUnit: 500_000 });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'NewAPI');
    assert.equal(rows[0].quota_unit, 'usd');
    assert.equal(rows[0].quota_used, 0.000064);
    assert.equal(rows[0].total_tokens, 165);
    assert.equal(Object.hasOwn(rows[0], 'cost'), false);
    assert.equal(Object.hasOwn(rows[0], 'cost_usd'), false);
  });

  it('keeps Sub2API wallet balance and usage cost as separate signal kinds', () => {
    const summary = summarizeSub2ApiUsage({
      data: {
        unit: 'usd',
        wallet_balance: SAMPLE_SUB2API_BALANCE,
        usage: {
          today: { requests: 358, total_tokens: 4_242_000, cost: 12.34 },
          total: { requests: 59_519, total_tokens: 11_904_000_000, cost: SAMPLE_SUB2API_TOTAL_COST },
        },
        model_stats: [
          { model: 'model-beta', requests: 8, total_tokens: 1234, cost: 0.98 },
        ],
      },
    });

    assert.equal(summary.available_balance, SAMPLE_SUB2API_BALANCE);
    assert.equal(summary.today.cost, 12.34);
    assert.equal(summary.total.cost, SAMPLE_SUB2API_TOTAL_COST);
    assert.equal(summary.model_stats[0].cost_unit, 'usd');

    const signals = sub2ApiSignals(summary, '2026-06-08T12:00:00.000Z');
    const balance = signals.find(signal => signal.id === 'signal-sub2api-balance-available');
    const todayCost = signals.find(signal => signal.id === 'signal-sub2api-cost-today');

    assert.equal(balance.kind, 'balance');
    assert.equal(balance.value, SAMPLE_SUB2API_BALANCE);
    assert.equal(todayCost.kind, 'usage');
    assert.equal(todayCost.value, 12.34);
  });

  it('sorts Sub2API model stats by actual cost with explicit unit', () => {
    const rows = summarizeSub2ApiModelStats([
      { model: 'model-low-cost', requests: 10, total_tokens: 10_000, cost: 0.5 },
      { model: 'model-high-cost', requests: 1, total_tokens: 100, actual_cost: 2.5 },
    ], 'usd');

    assert.equal(rows[0].model, 'model-high-cost');
    assert.equal(rows[0].cost, 2.5);
    assert.equal(rows[0].cost_unit, 'usd');
  });

  it('keeps Sub2API model cost unknown when the API omits cost fields', () => {
    const rows = summarizeSub2ApiModelStats([
      { model: 'model-known-cost', requests: 1, total_tokens: 100, cost: 0.1 },
      { model: 'model-token-only', requests: 10, total_tokens: 10_000 },
    ], 'cny');

    assert.equal(rows[0].model, 'model-known-cost');
    assert.equal(rows[0].cost, 0.1);
    assert.equal(rows[0].cost_known, true);
    assert.equal(rows[0].cost_unit, 'cny');
    assert.equal(rows[1].model, 'model-token-only');
    assert.equal(rows[1].cost, null);
    assert.equal(rows[1].cost_known, false);
    assert.equal(rows[1].cost_unit, 'cny');
  });
});

describe('semantic projection contract', () => {
  it('classifies Sub2API balance as available key-level reserve', () => {
    const semantics = signalSemantics({
      path: 'api.sub2api.balance.available',
      kind: 'balance',
      value: SAMPLE_SUB2API_BALANCE,
      unit: 'usd',
      confidence: 'reported',
    });

    assert.equal(semantics.metric_role, 'available');
    assert.equal(semantics.subject_type, 'api_key');
    assert.equal(semantics.unit_family, 'currency');
    assert.equal(semantics.knownness, 'known');
  });

  it('classifies Sub2API today cost as windowed used spending', () => {
    const semantics = signalSemantics({
      path: 'api.sub2api.cost.today',
      kind: 'usage',
      value: 12.34,
      unit: 'usd',
      confidence: 'reported',
    });

    assert.equal(semantics.metric_role, 'used');
    assert.equal(semantics.time_behavior, 'window');
    assert.equal(semantics.subject_type, 'api_key');
  });

  it('keeps reported zero cost distinct from unknown values', () => {
    const semantics = signalSemantics({
      path: 'api.sub2api.cost.today',
      kind: 'usage',
      value: 0,
      unit: 'usd',
      confidence: 'reported',
    });

    assert.equal(semantics.knownness, 'reported_zero');
  });

  it('classifies NewAPI available quota as account reserve', () => {
    const semantics = signalSemantics({
      path: 'api.newapi.quota.available',
      kind: 'quota',
      value: 42,
      unit: 'credit',
      confidence: 'reported',
    });

    assert.equal(semantics.metric_role, 'available');
    assert.equal(semantics.subject_type, 'account');
    assert.equal(semantics.unit_family, 'quota');
  });

  it('keeps dataset widget hints aligned with row subjects', () => {
    assert.equal(datasetSemantics('top_projects').rows_subject_type, 'workspace');
    assert.equal(datasetSemantics('top_projects').widget_hint, 'rank-table');
    assert.equal(datasetSemantics('top_models').rows_subject_type, 'model');
    assert.equal(datasetSemantics('top_models').widget_hint, 'rank-table');
  });

  it('builds layers, grouped contracts, widgets, and evidence notes', () => {
    const projection = buildSemanticProjection({
      sources: [
        { id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'ok' },
        { id: 'windows-power', kind: 'system_api', label: 'Windows 电源', state: 'planned' },
      ],
      signals: [
        {
          id: 'signal-sub2api-balance-available',
          path: 'api.sub2api.balance.available',
          kind: 'balance',
          value: SAMPLE_SUB2API_BALANCE,
          unit: 'usd',
          confidence: 'reported',
        },
        {
          id: 'signal-sub2api-cost-today',
          path: 'api.sub2api.cost.today',
          kind: 'usage',
          value: 0,
          unit: 'usd',
          confidence: 'reported',
        },
        {
          id: 'signal-codex-cost',
          path: 'agent.codex.cost.aggregate',
          kind: 'usage',
          value: null,
          unit: 'usd',
          confidence: 'observed',
        },
      ],
      datasets: {
        top_projects: [
          {
            workspace: 'workspace-sample',
            cost_usd: null,
            cost_known: false,
            tokens: 123,
            sources: ['Codex'],
          },
        ],
        newapi_model_stats: [{ model: 'gpt-test', quota_used: 1 }],
      },
    });

    assert.deepEqual(projection.layers.map(layer => layer.name), [
      '信息获取层',
      '数据表征层',
      '综合聚合层',
      '面板呈现层',
    ]);
    assert.ok(projection.metric_groups.length >= 2);
    assert.ok(projection.dataset_groups.some(group => group.dataset_id === 'top_projects'));
    assert.ok(projection.widget_registry.some(widget => widget.id === 'evidence-table'));
    assert.ok(projection.evidence_notes.some(note => note.id === 'dataset-top-projects-unknown-cost'));
    assert.ok(projection.evidence_notes.some(note => note.id === 'dataset-newapi-quota-not-cost'));
    assert.ok(projection.evidence_notes.some(note => note.id.includes('reported-zero')));
    assert.equal(projection.data_representation.source_contract.count, 2);
    assert.ok(projection.data_representation.signal_contract.roles.some(role => role.id === 'available'));
    assert.ok(projection.data_representation.signal_contract.knownness.some(item => item.id === 'reported_zero'));
    assert.ok(projection.presentation_blueprint.lanes.some(lane => lane.id === 'reserve-risk' && lane.widget === 'reserve-card'));
    assert.ok(projection.presentation_blueprint.lanes.some(lane => lane.id === 'window-consumption' && lane.widget === 'window-trend'));
    assert.ok(projection.presentation_blueprint.layout_policy.some(policy => policy.includes('来源作为过滤器')));
  });

  it('keeps legacy provider capabilities visible even when they are not mapped into the command dashboard', () => {
    const registry = withRelayEnvUnset(() => buildSourceRegistry({
      sources: [
        { id: 'newapi-main', kind: 'newapi', label: 'NewAPI', state: 'missing', enabled: false },
        { id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'missing', enabled: false },
      ],
      home: 'Z:/agent-sense-test-home',
    }));

    const minimax = registry.find(entry => entry.id === 'minimax-cn-legacy');
    assert.ok(minimax);
    assert.equal(minimax.code_capability, 'present');
    assert.equal(minimax.command_demo_adapter, 'not_connected');
    assert.equal(minimax.visibility_state, 'not_in_command_demo');

    const newapi = registry.find(entry => entry.id === 'newapi-main');
    const sub2api = registry.find(entry => entry.id === 'sub2api-main');
    assert.equal(newapi.configuration_state, 'not_configured');
    assert.equal(sub2api.configuration_state, 'not_configured');
    assert.ok(newapi.missing_items.includes('AGENTSENSE_NEWAPI_TOKEN'));
    assert.ok(sub2api.missing_items.includes('AGENTSENSE_SUB2API_API_KEY'));

    const missingText = registry.flatMap(entry => entry.missing_items || []).join(' ');
    assert.doesNotMatch(missingText, /sk-[a-z0-9]/i);
    assert.doesNotMatch(missingText, /Bearer\s+/i);
  });

  it('redacts sensitive source registry messages before exposing source status', () => {
    const bearer = 'sk-' + 'redactiontesttoken123456';
    const dashboardToken = 'dashboard' + 'token123456';
    const registry = withRelayEnvUnset(() => buildSourceRegistry({
      sources: [
        {
          id: 'newapi-main',
          kind: 'newapi',
          label: 'NewAPI',
          state: 'auth_failed',
          enabled: true,
          message: '请求失败: Authorization:' + ' Bearer ' + bearer + '; token: ' + dashboardToken,
        },
      ],
      home: 'Z:/agent-sense-test-home',
    }));

    const newapi = registry.find(entry => entry.id === 'newapi-main');
    assert.ok(newapi);
    assert.match(newapi.message, /\[redacted\]/);

    const serialized = JSON.stringify(registry);
    assert.doesNotMatch(serialized, new RegExp(bearer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(serialized, new RegExp(dashboardToken));
    assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._+\-/=]{12,}/i);
  });

  it('projects source registry as a capability matrix with adapter evidence', () => {
    const sourceRegistry = withRelayEnvUnset(() => buildSourceRegistry({
      sources: [
        { id: 'newapi-main', kind: 'newapi', label: 'NewAPI', state: 'missing', enabled: false },
        { id: 'sub2api-main', kind: 'sub2api', label: 'Sub2API', state: 'missing', enabled: false },
      ],
      home: 'Z:/agent-sense-test-home',
    }));
    const projection = buildSemanticProjection({
      datasets: {
        source_registry: sourceRegistry,
      },
      sourceRegistry,
    });

    assert.ok(projection.dataset_groups.some(group => group.dataset_id === 'source_registry'));
    assert.ok(projection.widget_registry.some(widget => widget.id === 'capability-matrix'));
    assert.ok(projection.summary.source_registry_count > 0);
    assert.ok(projection.evidence_notes.some(note => note.id.startsWith('registry-') && note.id.endsWith('-not-connected')));
  });

  it('exposes source registry through the layered sources endpoint', () => {
    const response = commandDemoLayerResponse(sampleLayeredDemo(), '/api/sources');

    assert.equal(response.status, 200);
    assert.equal(response.body.generated_at, '2026-06-09T00:00:00.000Z');
    assert.equal(response.body.source_counts.ok, 1);
    assert.ok(response.body.contract);
    assert.ok(response.body.capability_registry_contract);

    const minimax = response.body.source_registry.find(entry => entry.id === 'minimax-cn-legacy');
    assert.ok(minimax);
    assert.equal(minimax.code_capability, 'present');
    assert.equal(minimax.command_demo_adapter, 'not_connected');

    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /sk-[a-z0-9]/i);
    assert.doesNotMatch(serialized, /Bearer\s+/i);
  });

  it('filters layered signals by source and semantic role', () => {
    const response = commandDemoLayerResponse(
      sampleLayeredDemo(),
      '/api/signals?source=sub2api-main&role=available',
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.signals.length, 1);
    assert.equal(response.body.signals[0].id, 'signal-sub2api-balance-available');
    assert.equal(signalSemantics(response.body.signals[0]).metric_role, 'available');
    assert.ok(response.body.contract.roles.some(role => role.id === 'available'));
  });

  it('exposes dataset catalog with semantic hints and row counts', () => {
    const response = commandDemoLayerResponse(sampleLayeredDemo(), '/api/datasets');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.datasets.map(dataset => dataset.id), [
      'source_registry',
      'sub2api_model_stats',
    ]);
    assert.equal(
      response.body.datasets.find(dataset => dataset.id === 'source_registry').semantics.widget_hint,
      'capability-matrix',
    );
    assert.equal(
      response.body.datasets.find(dataset => dataset.id === 'sub2api_model_stats').row_count,
      1,
    );
  });

  it('returns individual datasets with their presentation semantics', () => {
    const response = commandDemoLayerResponse(sampleLayeredDemo(), '/api/datasets/source_registry');

    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'source_registry');
    assert.equal(response.body.semantics.widget_hint, 'capability-matrix');
    assert.ok(response.body.row_count > 0);
    assert.ok(response.body.data.some(entry => entry.id === 'minimax-cn-legacy'));
  });

  it('returns an explainable 404 for unknown layered datasets', () => {
    const response = commandDemoLayerResponse(sampleLayeredDemo(), '/api/datasets/missing');

    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'dataset_not_found');
    assert.deepEqual(response.body.available, [
      'source_registry',
      'sub2api_model_stats',
    ]);
  });

  it('exposes semantic projection as a standalone layered endpoint', () => {
    const response = commandDemoLayerResponse(sampleLayeredDemo(), '/api/semantic-projection');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.semantic_projection.layers.map(layer => layer.name), [
      '信息获取层',
      '数据表征层',
      '综合聚合层',
      '面板呈现层',
    ]);
    assert.ok(response.body.semantic_projection.data_representation.source_contract);
    assert.ok(response.body.semantic_projection.data_representation.signal_contract);
    assert.ok(response.body.semantic_projection.data_representation.dataset_contract);
  });
});

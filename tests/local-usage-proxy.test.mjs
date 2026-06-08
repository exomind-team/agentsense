import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeWorkspaceProjects,
  summarizeClaudeProjects,
  summarizeNewApiModelStats,
  summarizeSub2ApiModelStats,
  summarizeSub2ApiUsage,
  sub2ApiSignals,
} from '../local-usage-proxy.mjs';

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
        wallet_balance: 1049.93,
        usage: {
          today: { requests: 358, total_tokens: 4_242_000, cost: 12.34 },
          total: { requests: 59_519, total_tokens: 11_904_000_000, cost: 4770.82 },
        },
        model_stats: [
          { model: 'model-beta', requests: 8, total_tokens: 1234, cost: 0.98 },
        ],
      },
    });

    assert.equal(summary.available_balance, 1049.93);
    assert.equal(summary.today.cost, 12.34);
    assert.equal(summary.total.cost, 4770.82);
    assert.equal(summary.model_stats[0].cost_unit, 'usd');

    const signals = sub2ApiSignals(summary, '2026-06-08T12:00:00.000Z');
    const balance = signals.find(signal => signal.id === 'signal-sub2api-balance-available');
    const todayCost = signals.find(signal => signal.id === 'signal-sub2api-cost-today');

    assert.equal(balance.kind, 'balance');
    assert.equal(balance.value, 1049.93);
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

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const upstream = 'http://127.0.0.1:7892';
const port = Number(process.env.AGENTSENSE_PROXY_PORT || 7893);

function asNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function workspaceLabel(rawPath) {
  return String(rawPath || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .at(-1) || String(rawPath || '');
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

function localUsage() {
  const file = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(file)) {
    return { configured: false, status: { state: 'missing', message: '.claude.json not found' } };
  }

  const stat = fs.statSync(file);
  const rootJson = JSON.parse(fs.readFileSync(file, 'utf8'));
  const projects = rootJson.projects || {};
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
      cost_usd: cost,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreate,
      web_search_requests: webSearch,
      model_count: Object.keys(modelUsage).length,
    });
  }

  return {
    configured: true,
    source: '.claude.json projects aggregate',
    status: { state: 'ok', last_modified: stat.mtimeMs },
    summary,
    models: [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 10),
    top_projects: topProjects.sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 8),
  };
}

function commandDemo() {
  const home = os.homedir();
  const usage = localUsage();
  const summary = usage.configured && usage.status?.state === 'ok' ? usage.summary : null;
  const totalTokens = summary
    ? summary.input_tokens + summary.output_tokens + summary.cache_read_tokens + summary.cache_creation_tokens
    : 0;
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
      ['session_health', 'model_usage']
    ),
    fileSourceStatus(
      'cc-switch',
      'cc_switch',
      'CC Switch',
      path.join(home, '.cc-switch', 'cc-switch.db'),
      ['agent_usage', 'provider_health', 'model_pricing']
    ),
    {
      id: 'newapi-main',
      kind: 'newapi',
      label: 'NewAPI',
      enabled: false,
      state: 'disabled',
      message: '等待个人访问令牌与端点配置',
      capabilities: ['api_balance', 'api_quota', 'api_key_status'],
    },
    {
      id: 'sub2api-main',
      kind: 'sub2api',
      label: 'Sub2API',
      enabled: false,
      state: 'disabled',
      message: '等待 token 与端点配置',
      capabilities: ['api_balance', 'provider_health'],
    },
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

  const sourceCounts = sources.reduce((acc, source) => {
    acc[source.state] = (acc[source.state] || 0) + 1;
    return acc;
  }, {});

  const signals = [
    {
      id: 'signal-agent-cost',
      path: 'agent.usage.cost.aggregate',
      domain: 'agent',
      kind: 'usage',
      subject: 'claude-code-local',
      value: summary ? Number(summary.cost_usd.toFixed(4)) : null,
      unit: 'usd',
      confidence: 'observed',
      sourceId: 'claude-code-local',
    },
    {
      id: 'signal-agent-tokens',
      path: 'agent.usage.tokens.total.aggregate',
      domain: 'agent',
      kind: 'usage',
      subject: 'claude-code-local',
      value: totalTokens,
      unit: 'token',
      confidence: 'observed',
      sourceId: 'claude-code-local',
    },
    {
      id: 'signal-project-count',
      path: 'agent.usage.projects.count',
      domain: 'agent',
      kind: 'inventory',
      subject: 'claude-code-local',
      value: summary ? summary.project_count : 0,
      unit: 'count',
      confidence: 'observed',
      sourceId: 'claude-code-local',
    },
    {
      id: 'signal-source-ok',
      path: 'system.sources.ok.count',
      domain: 'system',
      kind: 'health',
      subject: 'sources',
      value: sourceCounts.ok || 0,
      unit: 'count',
      confidence: 'derived',
      sourceId: 'command-demo',
    },
  ];

  const alerts = [];
  if (!healthyLocal) {
    alerts.push({ level: 'warning', title: '本地 usage 未读取', detail: usage.status?.message || 'Claude Code 聚合源不可用' });
  }
  for (const source of sources) {
    if (source.state === 'missing') {
      alerts.push({ level: 'info', title: `${source.label} 缺失`, detail: source.message });
    }
    if (source.state === 'disabled') {
      alerts.push({ level: 'info', title: `${source.label} 未启用`, detail: source.message });
    }
  }
  if (healthyLocal && alerts.length === 0) {
    alerts.push({ level: 'ok', title: '态势正常', detail: '首批本地聚合来源已可读。' });
  }

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
        ? `已读取 ${summary.project_count} 个工作区聚合，当前 demo 可展示实际本地 usage。`
        : '本地 usage 缺失，demo 仍展示 source/signal 结构。',
    },
    sources,
    source_counts: sourceCounts,
    signals,
    datasets: {
      alerts,
      top_models: usage.models || [],
      top_projects: usage.top_projects || [],
    },
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

http.createServer((req, res) => {
  if (req.url?.startsWith('/api/command-demo')) {
    try {
      sendJson(res, commandDemo());
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
}).listen(port, '127.0.0.1', () => {
  console.log(`AgentSense local usage proxy: http://127.0.0.1:${port}`);
});

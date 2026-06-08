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
    signals.push({
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
    });
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
        datasets: { attempts },
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
        datasets: { attempts },
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

async function commandDemo() {
  const home = os.homedir();
  const usage = localUsage();
  const newApi = await newApiStatus();
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
    newApi.source,
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
    ...newApi.signals,
  ];

  const alerts = [...(newApi.alerts || [])];
  if (!healthyLocal) {
    alerts.push({ level: 'warning', title: '本地 usage 未读取', detail: usage.status?.message || 'Claude Code 聚合源不可用' });
  }
  for (const source of sources) {
    if (source.id === 'newapi-main') continue;
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
      newapi_attempts: newApi.datasets?.attempts || [],
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

http.createServer(async (req, res) => {
  if (req.url?.startsWith('/api/command-demo')) {
    try {
      sendJson(res, await commandDemo());
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

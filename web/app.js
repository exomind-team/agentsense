// ── Config ──────────────────────────────────────────────────────────────────

const DISPLAY_NAMES = {
  'MiniMax-M*':                     'MiniMax-M*',
  'coding-plan-vlm':                'Coding Plan VLM',
  'coding-plan-search':             'Coding Plan Search',
  'speech-hd':                      'Speech-HD',
  'MiniMax-Hailuo-2.3-Fast-6s-768p':'Hailuo 2.3 Fast',
  'MiniMax-Hailuo-2.3-6s-768p':     'Hailuo 2.3',
  'music-2.5':                      'Music 2.5',
  'music-2.6':                      'Music 2.6',
  'music-cover':                    'Music Cover',
  'lyrics_generation':              'Lyrics',
  'image-01':                       'Image-01',
};

const FILTER_CATEGORIES = [
  { label: '全部', models: null },
  { label: 'M*',   models: ['MiniMax-M*', 'coding-plan-vlm', 'coding-plan-search'] },
  { label: 'Video',models: ['MiniMax-Hailuo-2.3-Fast-6s-768p', 'MiniMax-Hailuo-2.3-6s-768p'] },
  { label: 'Speech',models: ['speech-hd'] },
  { label: 'Music',models: ['music-2.5', 'music-2.6', 'music-cover', 'lyrics_generation'] },
  { label: 'Image',models: ['image-01'] },
];

const LS_HISTORY_KEY = 'quota_local_history';
const MAX_LOCAL_PTS = 60;
const API_BASE = '';
const COMMAND_HISTORY_KEY = 'command_usage_snapshots_v1';
const COMMAND_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COMMAND_HISTORY_PTS = 720;
const COMMAND_MODEL_SORT_KEY = 'command_model_sort_v1';
const COMMAND_RELAY_VIEW_KEY = 'command_relay_view_v1';
const COMMAND_RELAY_DETAILS_COLLAPSED_KEY = 'command_relay_details_collapsed_v1';
const COMMAND_MODEL_TREND_WINDOW_KEY = 'command_model_trend_window_v1';
const COMMAND_DIMENSION_TREND_WINDOW_KEY = 'command_dimension_trend_window_v1';
const COMMAND_DIMENSION_TREND_FILTER_KEY = 'command_dimension_trend_filter_v1';
const COMMAND_MODEL_SORT_LABELS = {
  cost: '成本优先',
  tokens: 'Token优先',
  requests: '请求优先',
  source: '来源分组',
};
const COMMAND_TREND_WINDOW_OPTIONS = {
  '6h': { label: '近 6 小时', ms: 6 * 60 * 60 * 1000 },
  '1d': { label: '近 1 天', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: '近 7 天', ms: 7 * 24 * 60 * 60 * 1000 },
};
const COMMAND_DIMENSION_TREND_FILTERS = {
  all: { label: '全部', note: '展示所有可趋势化语义组。' },
  reserve: { label: '余量/容量', note: '只看可用额度、余额、总量、容量这类还能用多少。' },
  usage: { label: '消耗', note: '只看成本、Token、请求等已用消耗。' },
  relay: { label: '中转', note: '只看 NewAPI/Sub2API 等 Agent/API 中转来源。' },
  local: { label: '本地 Agent', note: '只看 Claude Code、Codex、CC Switch 等本地使用。' },
  ratio: { label: '比例/速率', note: '只看百分比、速率、风险变化。' },
};
const COMMAND_MODEL_TREND_LABELS = {
  '6h': '近 6 小时',
  '1d': '近 1 天',
  '7d': '近 7 天',
};
const COMMAND_MODEL_SOURCE_ORDER = ['Claude', 'Codex', 'CC codex', 'CC claude', 'CC unknown', 'NewAPI', 'Sub2API'];
const COMMAND_MODEL_COLORS = ['#14b8a6', '#388bfd', '#818cf8', '#3fb950', '#f59e0b', '#d97757', '#db61a2', '#a371f7'];

// ── State ───────────────────────────────────────────────────────────────────

let rawData = [];
let activeFilter = null;
let activeService = 'command';
let activeAccountLabel = ''; // filtered by account label for multi-account
let activeAccountIdx = 0;    // account index within provider (0=first)
let dsAccountsData = null;   // cached DeepSeek accounts response
let zaiAccountsData = null;  // cached ZAI accounts response
let mimoAccountsData = null; // cached MiMo accounts response
let zaiModelsData = null;    // cached ZAI models data
let commandDemoData = null;  // cached personal command dashboard demo data
let localUsageData = null;   // cached local Claude Code aggregate usage
let commandModelChart = null;
let commandModelTrendChart = null;
let commandDimensionTrendCharts = new Map();
let commandSemanticTrendCharts = new Map();
let commandRelayTrendCharts = new Map();
let commandHistoryStorage = [];
let commandModelSort = 'cost';
let commandRelayView = 'source';
let commandRelayDetailsCollapsed = true;
let commandModelTrendWindow = '7d';
let commandDimensionTrendWindow = '6h';
let commandDimensionTrendFilter = 'all';
let chart = null;
let weeklyBarChart = null;
let dsUsageChart = null;
let zaiHourlyChart = null;
let zaiModelBar = null;
let claudeHistoryChart = null;
let mimoHistoryChart = null;
let countdownSec = 60;
let powerTrendChart = null;
let powerPollInterval = null;
let powerLocalStorage = []; // 30m buffer: {ts, ac_w}
let powerOverviewData = null; // latest power snapshot for dynamic overview
let psuEnergyToday = 0;
let psuCostToday = 0;
const POWER_LS_KEY = 'power_local_30m';
const MAX_POWER_PTS = 1800;

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
  commandModelChart = echarts.init(document.getElementById('command-model-chart'), null, { renderer: 'canvas' });
  commandModelTrendChart = echarts.init(document.getElementById('command-model-trend-chart'), null, { renderer: 'canvas' });
  chart = echarts.init(document.getElementById('trend-chart'), null, { renderer: 'canvas' });
  weeklyBarChart = echarts.init(document.getElementById('weekly-bar-chart'), null, { renderer: 'canvas' });
  zaiHourlyChart = echarts.init(document.getElementById('zai-hourly-chart'), null, { renderer: 'canvas' });
  zaiModelBar = echarts.init(document.getElementById('zai-model-bar'), null, { renderer: 'canvas' });
  claudeHistoryChart = echarts.init(document.getElementById('claude-history-chart'), null, { renderer: 'canvas' });
  mimoHistoryChart = echarts.init(document.getElementById('mimo-history-chart'), null, { renderer: 'canvas' });
  powerTrendChart = echarts.init(document.getElementById('power-trend-chart'), null, { renderer: 'canvas' });
  try { commandHistoryStorage = JSON.parse(localStorage.getItem(COMMAND_HISTORY_KEY) || '[]'); } catch(e) { commandHistoryStorage = []; }
  commandModelSort = localStorage.getItem(COMMAND_MODEL_SORT_KEY) || 'cost';
  if (!COMMAND_MODEL_SORT_LABELS[commandModelSort]) commandModelSort = 'cost';
  const commandModelSortSelect = document.getElementById('command-model-sort');
  if (commandModelSortSelect) {
    commandModelSortSelect.value = commandModelSort;
    commandModelSortSelect.addEventListener('change', () => {
      commandModelSort = commandModelSortSelect.value;
      localStorage.setItem(COMMAND_MODEL_SORT_KEY, commandModelSort);
      renderCommandDemo(commandDemoData);
    });
  }
  commandRelayView = localStorage.getItem(COMMAND_RELAY_VIEW_KEY) || 'source';
  if (!['source', 'metric'].includes(commandRelayView)) commandRelayView = 'source';
  commandRelayDetailsCollapsed = localStorage.getItem(COMMAND_RELAY_DETAILS_COLLAPSED_KEY) !== 'false';
  const commandRelayDetailsToggle = document.getElementById('command-relay-details-toggle');
  if (commandRelayDetailsToggle) {
    commandRelayDetailsToggle.addEventListener('click', () => {
      commandRelayDetailsCollapsed = !commandRelayDetailsCollapsed;
      localStorage.setItem(COMMAND_RELAY_DETAILS_COLLAPSED_KEY, commandRelayDetailsCollapsed ? 'true' : 'false');
      renderCommandRelayDetailsState();
      requestAnimationFrame(() => {
        for (const chart of commandRelayTrendCharts.values()) chart?.resize();
      });
    });
  }
  document.querySelectorAll('.command-relay-view-btn[data-relay-view]').forEach(btn => {
    const active = btn.dataset.relayView === commandRelayView;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', () => {
      commandRelayView = btn.dataset.relayView || 'source';
      localStorage.setItem(COMMAND_RELAY_VIEW_KEY, commandRelayView);
      document.querySelectorAll('.command-relay-view-btn[data-relay-view]').forEach(item => {
        const isActive = item.dataset.relayView === commandRelayView;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderCommandRelaySummary(commandDemoData);
      renderCommandTrend();
    });
  });
  renderCommandRelayDetailsState();
  commandDimensionTrendWindow = localStorage.getItem(COMMAND_DIMENSION_TREND_WINDOW_KEY) || '6h';
  if (!COMMAND_TREND_WINDOW_OPTIONS[commandDimensionTrendWindow]) commandDimensionTrendWindow = '6h';
  commandDimensionTrendFilter = localStorage.getItem(COMMAND_DIMENSION_TREND_FILTER_KEY) || 'all';
  if (!COMMAND_DIMENSION_TREND_FILTERS[commandDimensionTrendFilter]) commandDimensionTrendFilter = 'all';
  document.querySelectorAll('.command-dimension-window-btn').forEach(btn => {
    const active = btn.dataset.dimensionTrendWindow === commandDimensionTrendWindow;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', () => {
      commandDimensionTrendWindow = btn.dataset.dimensionTrendWindow || '6h';
      if (!COMMAND_TREND_WINDOW_OPTIONS[commandDimensionTrendWindow]) commandDimensionTrendWindow = '6h';
      localStorage.setItem(COMMAND_DIMENSION_TREND_WINDOW_KEY, commandDimensionTrendWindow);
      document.querySelectorAll('.command-dimension-window-btn').forEach(item => {
        const isActive = item.dataset.dimensionTrendWindow === commandDimensionTrendWindow;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderCommandTrend();
    });
  });
  document.querySelectorAll('.command-dimension-filter-btn').forEach(btn => {
    const active = btn.dataset.dimensionTrendFilter === commandDimensionTrendFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', () => {
      commandDimensionTrendFilter = btn.dataset.dimensionTrendFilter || 'all';
      if (!COMMAND_DIMENSION_TREND_FILTERS[commandDimensionTrendFilter]) commandDimensionTrendFilter = 'all';
      localStorage.setItem(COMMAND_DIMENSION_TREND_FILTER_KEY, commandDimensionTrendFilter);
      document.querySelectorAll('.command-dimension-filter-btn').forEach(item => {
        const isActive = item.dataset.dimensionTrendFilter === commandDimensionTrendFilter;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderCommandTrend();
    });
  });
  commandModelTrendWindow = localStorage.getItem(COMMAND_MODEL_TREND_WINDOW_KEY) || '7d';
  if (!COMMAND_MODEL_TREND_LABELS[commandModelTrendWindow]) commandModelTrendWindow = '7d';
  document.querySelectorAll('.command-model-trend-window-btn').forEach(btn => {
    const active = btn.dataset.modelTrendWindow === commandModelTrendWindow;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', () => {
      commandModelTrendWindow = btn.dataset.modelTrendWindow || '7d';
      if (!COMMAND_MODEL_TREND_LABELS[commandModelTrendWindow]) commandModelTrendWindow = '7d';
      localStorage.setItem(COMMAND_MODEL_TREND_WINDOW_KEY, commandModelTrendWindow);
      document.querySelectorAll('.command-model-trend-window-btn').forEach(item => {
        const isActive = item.dataset.modelTrendWindow === commandModelTrendWindow;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderCommandModelTrend(commandDemoData?.datasets);
    });
  });
  try { powerLocalStorage = JSON.parse(localStorage.getItem(POWER_LS_KEY) || '[]'); } catch(e) { powerLocalStorage = []; }

  initTheme();
  buildFilterTabs();
  bindSettings();

  document.getElementById('refreshBtn').addEventListener('click', manualRefresh);
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  window.addEventListener('resize', () => {
    commandModelChart?.resize();
    commandModelTrendChart?.resize();
    for (const chart of commandDimensionTrendCharts.values()) chart?.resize();
    for (const chart of commandSemanticTrendCharts.values()) chart?.resize();
    for (const chart of commandRelayTrendCharts.values()) chart?.resize();
    chart?.resize();
    weeklyBarChart?.resize();
    dsUsageChart?.resize();
    zaiHourlyChart?.resize();
    zaiModelBar?.resize();
    claudeHistoryChart?.resize();
    mimoHistoryChart?.resize();
    powerTrendChart?.resize();
  });

  fetchAll();
  startCountdown();
  setInterval(fetchAll, 60_000);
  initPowerRangeButtons();
  initFanControls();
}

// ── Theme ───────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('quota_theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('quota_theme', theme);
  updateThemeIcon(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
  fetchAll();
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  btn.textContent = theme === 'dark' ? '☀' : '☽';
  btn.title = theme === 'dark' ? '切换亮色模式' : '切换暗色模式';
}

// ── Service Tabs (dynamic, per-account) ────────────────────────────────────────

let tabsGenerated = false;

function generateServiceTabs() {
  // Build tab list from API data
  const tabs = []; // {provider, label, display, accountIdx}

  tabs.push({ provider: 'command', label: '', display: '态势台', accountIdx: 0 });
  tabs.push({ provider: 'local', label: '', display: 'Local Usage', accountIdx: 0 });

  const mmxAccounts = Array.isArray(lastOverviewData?.minimax) ? lastOverviewData.minimax : [];
  mmxAccounts.forEach((a, i) => tabs.push({
    provider: 'minimax', label: a.label || '', display: 'MiniMax ' + (a.label || ''),
    accountIdx: i
  }));

  const dsAccounts = Array.isArray(lastOverviewData?.deepseek) ? lastOverviewData.deepseek : [];
  dsAccounts.forEach((a, i) => tabs.push({
    provider: 'deepseek', label: a.label || '', display: 'DeepSeek' + (a.label ? ' ' + a.label : ''),
    accountIdx: i
  }));

  const zaiAccounts = Array.isArray(lastOverviewData?.zai) ? lastOverviewData.zai : [];
  zaiAccounts.forEach((a, i) => tabs.push({
    provider: 'zai', label: a.label || '', display: 'GLM ' + (a.label || ''),
    accountIdx: i
  }));

  // Claude (single)
  if (lastOverviewData?.claude) {
    tabs.push({ provider: 'claude', label: '', display: 'Claude', accountIdx: 0 });
  }

  const mimoAccounts = Array.isArray(lastOverviewData?.mimo) ? lastOverviewData.mimo : [];
  mimoAccounts.forEach((a, i) => tabs.push({
    provider: 'mimo', label: a.label || '', display: 'MiMo' + (a.label ? ' ' + a.label : ''),
    accountIdx: i
  }));

  // Power
  tabs.push({ provider: 'power', label: '', display: '⚡ Power', accountIdx: 0 });

  // Preserve active tab selection across regenerations
  let activeTabIdx = 0;
  if (tabsGenerated) {
    // Find the currently active tab
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].provider === activeService && tabs[i].label === activeAccountLabel) {
        activeTabIdx = i;
        break;
      }
    }
  }
  tabsGenerated = true;

  // Render tabs HTML
  const container = document.getElementById('service-tabs');
  container.innerHTML = tabs.map((t, i) => {
    const activeCls = (i === activeTabIdx) ? ' active' : '';
    return `<button class="service-tab${activeCls}" data-tab="${i}" data-provider="${t.provider}" data-label="${t.label}" data-idx="${t.accountIdx}">${t.display}</button>`;
  }).join('');

  // Restore active state
  if (tabs.length > activeTabIdx) {
    activeService = tabs[activeTabIdx].provider;
    activeAccountLabel = tabs[activeTabIdx].label;
    activeAccountIdx = tabs[activeTabIdx].accountIdx;
    switchSection(activeService);
  }

  bindTabClicks();
}

function bindTabClicks() {
  document.querySelectorAll('.service-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.service-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      activeService = tab.dataset.provider;
      activeAccountLabel = tab.dataset.label || '';
      activeAccountIdx = parseInt(tab.dataset.idx || '0');

      switchSection(activeService);

      // Re-render content for the selected account
      refreshActiveSection();
    });
  });
}

function switchSection(provider) {
  document.querySelectorAll('.service-section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById('sec-' + provider);
  if (sec) sec.classList.add('active');

  // Resize charts after layout
  setTimeout(() => {
    chart?.resize();
    weeklyBarChart?.resize();
    dsUsageChart?.resize();
    zaiHourlyChart?.resize();
    zaiModelBar?.resize();
    claudeHistoryChart?.resize();
    mimoHistoryChart?.resize();
    powerTrendChart?.resize();
  }, 100);

  if (provider === 'power') {
    startPowerPolling();
  } else {
    stopPowerPolling();
  }
}

function refreshActiveSection() {
  switch (activeService) {
    case 'command':
      renderCommandDemo(commandDemoData);
      break;
    case 'minimax':
      renderCards(activeFilter);
      renderTable();
      break;
    case 'local':
      renderLocalUsage(localUsageData);
      break;
    case 'deepseek':
      if (dsAccountsData) renderDeepSeek(dsAccountsData, activeAccountIdx);
      break;
    case 'zai':
      if (zaiAccountsData) renderZai(zaiAccountsData, zaiModelsData, activeAccountIdx);
      break;
    case 'mimo':
      if (mimoAccountsData) renderMimo(mimoAccountsData, activeAccountIdx);
      break;
    // claude and power don't need per-account refresh
  }
}

// ── Settings Modal ───────────────────────────────────────────────────────────

function bindSettings() {
  const modal = document.getElementById('settings-modal');
  document.getElementById('settings-btn').addEventListener('click', () => {
    modal.classList.add('active');
    loadConfigToForm();
  });
  document.getElementById('modal-cancel').addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
  document.getElementById('config-save').addEventListener('click', saveConfigFromForm);
}

async function loadConfigToForm() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const cfg = await res.json();
    document.getElementById('cfg-mmx-key').value = cfg.minimax_api_key || '';
    document.getElementById('cfg-ds-key').value = cfg.deepseek_api_key || '';
    document.getElementById('cfg-zai-token').value = cfg.zai_auth_token || '';
    document.getElementById('cfg-mimo-cookie').value = cfg.mimo_cookie || '';
    document.getElementById('cfg-dsp-token').value = cfg.deepseek_platform_token || '';
    document.getElementById('cfg-dsp-cookies').value = cfg.deepseek_platform_cookies || '';
  } catch {}
}

async function saveConfigFromForm() {
  const mmxKey = document.getElementById('cfg-mmx-key').value.trim();
  const dsKey = document.getElementById('cfg-ds-key').value.trim();
  const zaiToken = document.getElementById('cfg-zai-token').value.trim();
  const mimoCookie = document.getElementById('cfg-mimo-cookie').value.trim();
  const dspToken = document.getElementById('cfg-dsp-token').value.trim();
  const dspCookies = document.getElementById('cfg-dsp-cookies').value.trim();

  try {
    await fetch(`${API_BASE}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minimax_api_key: mmxKey,
        deepseek_api_key: dsKey,
        zai_auth_token: zaiToken,
        mimo_cookie: mimoCookie,
        deepseek_platform_token: dspToken,
        deepseek_platform_cookies: dspCookies,
      }),
    });
    document.getElementById('settings-modal').classList.remove('active');
    await manualRefresh();
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

// ── PSU Power ──────────────────────────────────────────────────────────────────

// FIX 3: safe numeric formatter — guards null/undefined/NaN before .toFixed()
function fmtNum(x, digits) {
  if (digits === undefined) digits = 0;
  return (x === null || x === undefined || isNaN(x)) ? '--' : Number(x).toFixed(digits);
}

// FIX 8b: throttled localStorage write for power buffer (persist every ~5s)
let _powerLsWriteCounter = 0;
function maybePersistPowerBuffer() {
  _powerLsWriteCounter++;
  if (_powerLsWriteCounter >= 5) {
    _powerLsWriteCounter = 0;
    try { localStorage.setItem(POWER_LS_KEY, JSON.stringify(powerLocalStorage)); } catch(e) {}
  }
}

function startPowerPolling() {
  if (powerPollInterval) return;
  fetchPowerHistory('30m');
  let powerPollTick = 0;
  powerPollInterval = setInterval(async () => {
    await fetchPowerOverview();
    // Fan RPM / PWM / temperatures change continuously and are a cheap cached read
    // on the backend (no DB), so refresh them live every second too. Without this
    // the thermal card was fetched only once at page load and never updated.
    fetchThermal();
    // Cost is a DB aggregation that changes slowly — refresh every ~5s, not every tick.
    if (powerPollTick % 5 === 0) fetchPsuCost();
    powerPollTick++;
    // FIX 2: re-render live trend from in-memory buffer every second
    const activeRange = document.querySelector('#power-range-btns .filter-tab.active');
    if (activeRange && activeRange.dataset.range === '30m' && powerLocalStorage.length > 0) {
      renderPowerTrend(powerLocalStorage.map(p => ({ ts: p.ts, ac_w: p.ac_w })));
    }
  }, 1000);
}

function stopPowerPolling() {
  if (powerPollInterval) { clearInterval(powerPollInterval); powerPollInterval = null; }
}

async function fetchPowerOverview() {
  try {
    const res = await fetch(`${API_BASE}/api/power`);
    const d = await res.json();
    powerOverviewData = d.connected ? d : null;
    const el = (id) => document.getElementById(id);
    if (!d.connected) {
      // FIX 4: show no-key / hide content when disconnected
      const pnk = document.getElementById('power-no-key');
      const pc = document.getElementById('power-content');
      if (pnk) pnk.style.display = 'block';
      if (pc) pc.style.display = 'none';
      return;
    }
    // FIX 4: show content / hide no-key when connected
    const pnk = document.getElementById('power-no-key');
    const pc = document.getElementById('power-content');
    if (pnk) pnk.style.display = 'none';
    if (pc) pc.style.display = 'block';

    if (el('psu-current-w')) el('psu-current-w').textContent = fmtNum(d.ac_input_w, 0) + 'W';
    if (el('psu-peak-w')) el('psu-peak-w').textContent = fmtNum(d.today_peak_w, 0) + 'W';
    if (el('psu-avg-w')) el('psu-avg-w').textContent = fmtNum(d.today_avg_w, 0) + 'W';
    if (el('psu-dc-w')) el('psu-dc-w').textContent = '~' + fmtNum(d.dc_output_est_w, 0) + 'W';
    // Store in in-memory buffer; persist to localStorage throttled (FIX 8b)
    if (d.ac_input_w !== null && d.ac_input_w !== undefined) {
      powerLocalStorage.push({ ts: Date.now(), ac_w: d.ac_input_w });
      // FIX 7a: prune by age (keep only last 30 minutes)
      const cutoff = Date.now() - 30 * 60 * 1000;
      powerLocalStorage = powerLocalStorage.filter(p => p.ts >= cutoff);
      // Also cap by count as safety net
      if (powerLocalStorage.length > MAX_POWER_PTS) powerLocalStorage = powerLocalStorage.slice(-MAX_POWER_PTS);
      maybePersistPowerBuffer();
    }
  } catch(e) { console.error('fetchPowerOverview:', e); }
}

async function fetchPsuCost() {
  try {
    const res = await fetch(`${API_BASE}/api/psu-cost`);
    if (!res.ok) return;
    const d = await res.json();
    const el = (id) => document.getElementById(id);
    if (!d.connected) {
      psuEnergyToday = 0;
      psuCostToday = 0;
      return;
    }
    psuEnergyToday = d.day?.kwh ?? 0;
    psuCostToday = d.day?.cost ?? 0;
    if (el('psu-day-cost')) el('psu-day-cost').textContent = '¥' + fmtNum(d.day?.cost, 2);
    if (el('psu-day-kwh')) el('psu-day-kwh').textContent = fmtNum(d.day?.kwh, 2) + ' kWh';
    if (el('psu-week-cost')) el('psu-week-cost').textContent = '¥' + fmtNum(d.week?.cost, 2);
    if (el('psu-week-kwh')) el('psu-week-kwh').textContent = fmtNum(d.week?.kwh, 1) + ' kWh';
    if (el('psu-month-cost')) el('psu-month-cost').textContent = '¥' + fmtNum(d.month?.cost, 2);
    if (el('psu-month-kwh')) el('psu-month-kwh').textContent = fmtNum(d.month?.kwh, 1) + ' kWh';
    if (el('psu-day-proj')) el('psu-day-proj').textContent = '¥' + fmtNum(d.projected?.day?.cost, 2) + ' · ' + fmtNum(d.projected?.day?.kwh, 1) + ' kWh';
    if (el('psu-week-proj')) el('psu-week-proj').textContent = '¥' + fmtNum(d.projected?.week?.cost, 2) + ' · ' + fmtNum(d.projected?.week?.kwh, 1) + ' kWh';
    if (el('psu-month-proj')) el('psu-month-proj').textContent = '¥' + fmtNum(d.projected?.month?.cost, 2) + ' · ' + fmtNum(d.projected?.month?.kwh, 0) + ' kWh';
    if (el('psu-price')) el('psu-price').textContent = '¥' + (d.price_per_kwh ?? '--') + '/kWh';
    const durS = d.monitoring_duration_s ?? 0;
    const h = Math.floor(durS / 3600);
    const m = Math.floor((durS % 3600) / 60);
    if (el('psu-duration')) el('psu-duration').textContent = h + 'h ' + m + 'm';
  } catch(e) { console.error('fetchPsuCost:', e); }
}

async function fetchThermal() {
  try {
    const res = await fetch(`${API_BASE}/api/thermal`);
    if (!res.ok) return;
    const d = await res.json();
    const el = (id) => document.getElementById(id);
    if (!d.connected) return;
    // FIX 3: guard all numeric fields with fmtNum
    el('psu-temp-main').textContent = fmtNum(d.temp_main_c, 0) + '°C';
    el('psu-temp-air').textContent = fmtNum(d.temp_air_c, 0) + '°C';
    el('psu-temp-air2').textContent = fmtNum(d.temp_air2_c, 0) + '°C';
    // Fan RPM is a real protocol field; the PSU reports no actual PWM duty cycle
    // (the old "PWM" was the raw 0x04 mode_byte, which is meaningless), so we show RPM only.
    el('psu-fan-rpm').textContent = (d.fan_rpm !== null && d.fan_rpm !== undefined ? d.fan_rpm : '--') + ' RPM';
  } catch(e) { console.error('fetchThermal:', e); }
}

async function fetchPowerHistory(range) {
  try {
    const res = await fetch(`${API_BASE}/api/power/history?range=${range}`);
    if (!res.ok) return;
    const d = await res.json();
    if (!d.connected) return;
    let data = d.data || [];
    if (range === '30m') {
      // FIX 7a: prune local buffer by age before merge
      const cutoff = Date.now() - 30 * 60 * 1000;
      powerLocalStorage = powerLocalStorage.filter(p => p.ts >= cutoff);

      // FIX 7b: if server returned empty, fall back to local buffer directly
      if (data.length === 0 && powerLocalStorage.length > 0) {
        renderPowerTrend(powerLocalStorage.map(p => ({ ts: p.ts, ac_w: p.ac_w })));
        return;
      }

      if (powerLocalStorage.length > 0) {
        const serverStart = data.length > 0 ? data[0].ts : Date.now();
        const localPts = powerLocalStorage.filter(p => p.ts >= serverStart);
        data = data.concat(localPts.map(p => ({ ts: p.ts, ac_w: p.ac_w })));
        // Deduplicate by ts (keep last)
        const seen = new Map();
        for (const p of data) seen.set(p.ts, p);
        data = Array.from(seen.values()).sort((a, b) => a.ts - b.ts);
      }
    }
    renderPowerTrend(data);
  } catch(e) { console.error('fetchPowerHistory:', e); }
}

function renderPowerTrend(data) {
  if (!powerTrendChart || data.length === 0) return;
  // FIX 1: resolve theme-aware hex colors — ECharts canvas cannot parse CSS vars
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#30363d' : '#d0d7de';
  const times = data.map(d => {
    const dt = new Date(d.ts);
    return dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0') + ':' + dt.getSeconds().toString().padStart(2,'0');
  });
  const values = data.map(d => d.ac_w);
  // FIX 8a: add notMerge:true so range switches don't leave stale series data
  powerTrendChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      valueFormatter: v => (v !== null && v !== undefined ? v.toFixed(0) : '--') + 'W',
    },
    grid: { left: 50, right: 16, top: 16, bottom: 30 },
    xAxis: {
      type: 'category', data: times,
      axisLabel: { color: textColor, fontSize: 10 },
      axisLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: textColor, fontSize: 10, formatter: v => v + 'W' },
      splitLine: { lineStyle: { color: splitColor } },
    },
    series: [{
      type: 'line', data: values, smooth: true, symbol: 'none',
      lineStyle: { color: '#f59e0b', width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(245,158,11,0.25)' },
        { offset: 1, color: 'rgba(245,158,11,0.02)' },
      ])},
    }],
  }, { notMerge: true });
}

function initPowerRangeButtons() {
  document.querySelectorAll('#power-range-btns .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#power-range-btns .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fetchPowerHistory(btn.dataset.range);
    });
  });
}

function initFanControls() {
  // Fan mode buttons — FIX 5: await first, only set .active on success
  document.querySelectorAll('#fan-mode-btns .fan-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Record the previously-active button so we can revert on failure
      const prevActive = document.querySelector('#fan-mode-btns .fan-mode-btn.active');
      document.querySelectorAll('#fan-mode-btns .fan-mode-btn').forEach(b => b.classList.remove('active'));
      try {
        const res = await fetch(`${API_BASE}/api/fan/mode`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ mode: btn.dataset.mode }),
        });
        if (!res.ok) {
          // Revert to previous active state
          if (prevActive) prevActive.classList.add('active');
          let msg = 'setFanMode HTTP ' + res.status;
          try { const errD = await res.json(); msg = errD.message || msg; } catch(_) {}
          alert(msg);
          return;
        }
        const d = await res.json();
        if (!d.ok) {
          if (prevActive) prevActive.classList.add('active');
          alert(d.message || 'setFanMode failed');
          return;
        }
        btn.classList.add('active');
      } catch(e) {
        if (prevActive) prevActive.classList.add('active');
        console.error('setFanMode:', e);
      }
    });
  });
  // PWM slider
  const slider = document.getElementById('fan-pwm-slider');
  const display = document.getElementById('fan-pwm-value');
  slider.addEventListener('input', () => { display.textContent = slider.value + '%'; });
  document.getElementById('fan-pwm-apply').addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_BASE}/api/fan/speed`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pwm: parseInt(slider.value) }),
      });
      // FIX 5: guard res.ok before parsing JSON to avoid throwing on non-JSON error body
      if (!res.ok) {
        let msg = 'setFanSpeed HTTP ' + res.status;
        try { const errD = await res.json(); msg = errD.message || msg; } catch(_) {}
        alert(msg);
        return;
      }
      const d = await res.json();
      if (!d.ok) alert(d.message);
    } catch(e) { console.error('setFanSpeed:', e); }
  });
  // Fan curve (simple SVG editor with 4 draggable points)
  initFanCurveEditor();
}

function initFanCurveEditor() {
  const svg = document.getElementById('fan-curve-svg');
  let points = [[30,25],[45,40],[60,70],[80,90]];
  let dragging = -1;

  function render() {
    const w = 400, h = 180, pad = 30;
    let html = '';
    // Grid
    for (let i = 0; i <= 3; i++) {
      const y = pad + (h - 2*pad) * i / 3;
      html += `<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
    }
    for (let i = 0; i <= 4; i++) {
      const x = pad + (w - 2*pad) * i / 4;
      html += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${h-pad}" stroke="var(--border)" stroke-width="1"/>`;
    }
    // Lines between points
    for (let i = 1; i < points.length; i++) {
      const [t1, p1] = points[i-1];
      const [t2, p2] = points[i];
      const x1 = pad + (t1/100) * (w-2*pad);
      const y1 = (h-pad) - (p1/100) * (h-2*pad);
      const x2 = pad + (t2/100) * (w-2*pad);
      const y2 = (h-pad) - (p2/100) * (h-2*pad);
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f59e0b" stroke-width="2"/>`;
    }
    // Control points
    points.forEach(([t, p], i) => {
      const x = pad + (t/100) * (w-2*pad);
      const y = (h-pad) - (p/100) * (h-2*pad);
      html += `<circle cx="${x}" cy="${y}" r="6" fill="#f59e0b" stroke="var(--bg)" stroke-width="2" style="cursor:grab" data-idx="${i}"/>`;
      html += `<text x="${x+8}" y="${y-8}" fill="#f59e0b" font-size="9" font-weight="600">${t}°C→${p}%</text>`;
    });
    svg.innerHTML = html;
  }

  svg.addEventListener('mousedown', e => {
    const c = e.target.closest('circle');
    if (c) { dragging = parseInt(c.dataset.idx); e.preventDefault(); }
  });
  svg.addEventListener('mousemove', e => {
    if (dragging < 0) return;
    const rect = svg.getBoundingClientRect();
    const w = 400, h = 180, pad = 30;
    const mx = (e.clientX - rect.left) / rect.width * w;
    const my = (e.clientY - rect.top) / rect.height * h;
    const temp = Math.round(Math.max(20, Math.min(100, ((mx - pad) / (w - 2*pad)) * 100)));
    const pwm = Math.round(Math.max(20, Math.min(100, (1 - (my - pad) / (h - 2*pad)) * 100)));
    points[dragging] = [temp, pwm];
    render();
  });
  window.addEventListener('mouseup', () => { dragging = -1; });

  document.getElementById('fan-curve-apply').addEventListener('click', async () => {
    try {
      // FIX 6: sort 4 points by temperature ascending, enforce PWM>=20
      const sorted = points.slice().sort((a, b) => a[0] - b[0]).map(([t, p]) => [t, Math.max(20, p)]);
      // Reduce 4->3: keep first, last, and the TRUE middle (average of the two inner points)
      // This avoids silently dropping a user-edited point.
      // sorted = [p0, p1, p2, p3]; inner mid = avg of p1 and p2 temps/pwms
      const midTemp = Math.round((sorted[1][0] + sorted[2][0]) / 2);
      const midPwm  = Math.max(20, Math.round((sorted[1][1] + sorted[2][1]) / 2));
      const pts3 = [sorted[0], [midTemp, midPwm], sorted[3]];
      // Enforce strict temperature monotonicity across the 3 emitted points
      // (should already hold after sort+avg, but clamp defensively)
      pts3[1][0] = Math.max(pts3[0][0] + 1, Math.min(pts3[2][0] - 1, pts3[1][0]));
      // Reject a degenerate (non-monotonic) curve: when all points are stacked at
      // the same temperature the clamp above cannot produce a strictly increasing
      // triple, which the backend would reject or mishandle. Ask the user to spread them.
      if (!(pts3[0][0] < pts3[1][0] && pts3[1][0] < pts3[2][0])) {
        alert('风扇曲线的温度点必须严格递增，请拉开各点的温度间距');
        return;
      }

      const res = await fetch(`${API_BASE}/api/fan/curve`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ points: pts3.map(([t,p]) => [t,p]) }),
      });
      // FIX 5: guard res.ok before parsing JSON
      if (!res.ok) {
        let msg = 'setFanCurve HTTP ' + res.status;
        try { const errD = await res.json(); msg = errD.message || msg; } catch(_) {}
        alert(msg);
        return;
      }
      const d = await res.json();
      if (!d.ok) alert(d.message);
    } catch(e) { console.error('setFanCurve:', e); }
  });
  document.getElementById('fan-curve-reset').addEventListener('click', () => {
    points = [[30,25],[45,40],[60,70],[80,90]];
    render();
  });

  render();
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchAll() {
  await Promise.all([
    fetchCommandDemo(),
    fetchOverview(),
    fetchLocalUsage(),
    fetchMiniMaxDetail(),
    fetchDeepSeekDetail(),
    fetchDeepSeekPlatformDetail(),
    fetchZaiDetail(),
    fetchClaudeDetail(),
    fetchMimoDetail(),
    fetchPowerOverview(),
    fetchPsuCost(),
    fetchThermal(),
  ]);
  // Render overview after all data is available (power/psu cost fetched in parallel)
  if (lastOverviewData) {
    renderOverview(lastOverviewData);
    generateServiceTabs();
  }
}

let lastOverviewData = null;

async function fetchCommandDemo() {
  try {
    const res = await fetch(`${API_BASE}/api/command-demo`);
    commandDemoData = await res.json();
    renderCommandDemo(commandDemoData);
  } catch (err) {
    console.error('fetchCommandDemo error:', err);
  }
}

async function fetchOverview() {
  try {
    const res = await fetch(`${API_BASE}/api/all`);
    const data = await res.json();
    lastOverviewData = data;

    if (data._nextPoll) {
      const ms = data._nextPoll - Date.now();
      if (ms > 0) countdownSec = Math.ceil(ms / 1000);
    }
  } catch (err) {
    console.error('fetchOverview error:', err);
  }
}

async function fetchLocalUsage() {
  try {
    const res = await fetch(`${API_BASE}/api/local-usage`);
    localUsageData = await res.json();
    renderLocalUsage(localUsageData);
  } catch (err) {
    console.error('fetchLocalUsage error:', err);
  }
}

async function fetchMiniMaxDetail() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  try {
    const [quotaRes, historyRes] = await Promise.all([
      fetch(`${API_BASE}/api/quota`),
      fetch(`${API_BASE}/api/history`),
    ]);
    const quotaJson = await quotaRes.json();
    const historyJson = await historyRes.json();
    rawData = quotaJson.model_remains ?? [];
    updateChart(historyJson);
    renderCards(activeFilter);
    renderTable();

    if (quotaJson._nextPoll) {
      const msUntilPoll = quotaJson._nextPoll - Date.now();
      if (msUntilPoll > 0) countdownSec = Math.ceil(msUntilPoll / 1000);
    }

    if (rawData.length > 0) {
      try {
        const existing = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || '[]');
        existing.push({ ts: Date.now(), data: rawData });
        if (existing.length > MAX_LOCAL_PTS) existing.shift();
        localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(existing));
      } catch {}
    }
  } catch (err) {
    console.error('fetchMiniMaxDetail error:', err);
  } finally {
    btn.disabled = false;
  }

  // Consumption
  try {
    const res = await fetch(`${API_BASE}/api/consumption`);
    renderConsumption(await res.json());
  } catch {}

  // Weekly history
  try {
    const res = await fetch(`${API_BASE}/api/weekly-history`);
    renderWeeklyBar(await res.json());
  } catch {}
}

async function fetchDeepSeekDetail() {
  try {
    const balanceRes = await fetch(`${API_BASE}/api/deepseek`);
    const balanceData = await balanceRes.json();
    dsAccountsData = balanceData;
    renderDeepSeek(balanceData, activeAccountIdx);
  } catch (err) {
    console.error('fetchDeepSeekDetail error:', err);
  }
}

async function fetchDeepSeekPlatformDetail() {
  try {
    const res = await fetch(`${API_BASE}/api/deepseek/platform?days=30`);
    const data = await res.json();
    renderDeepSeekPlatform(data);
  } catch (err) {
    console.error('fetchDeepSeekPlatformDetail error:', err);
  }
}

async function fetchZaiDetail() {
  try {
    const [quotaRes, modelsRes] = await Promise.all([
      fetch(`${API_BASE}/api/zai`),
      fetch(`${API_BASE}/api/zai/models`),
    ]);
    const quotaData = await quotaRes.json();
    const modelsData = await modelsRes.json();
    zaiAccountsData = quotaData;
    zaiModelsData = modelsData;
    renderZai(quotaData, modelsData, activeAccountIdx);
  } catch (err) {
    console.error('fetchZaiDetail error:', err);
  }
}

async function fetchClaudeDetail() {
  try {
    const [quotaRes, historyRes] = await Promise.all([
      fetch(`${API_BASE}/api/claude`),
      fetch(`${API_BASE}/api/claude/history`),
    ]);
    renderClaude(await quotaRes.json(), await historyRes.json());
  } catch (err) {
    console.error('fetchClaudeDetail error:', err);
  }
}

async function fetchMimoDetail() {
  try {
    const [quotaRes, historyRes] = await Promise.all([
      fetch(`${API_BASE}/api/mimo`),
      fetch(`${API_BASE}/api/mimo/history`),
    ]);
    const quotaData = await quotaRes.json();
    const history = await historyRes.json();
    mimoAccountsData = quotaData;
    renderMimo(quotaData, history, activeAccountIdx);
  } catch (err) {
    console.error('fetchMimoDetail error:', err);
  }
}

async function manualRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  document.getElementById('badge').style.display = 'inline-block';
  try {
    await fetch(`${API_BASE}/api/refresh`);
    await fetchAll();
  } finally {
    btn.disabled = false;
    document.getElementById('badge').style.display = 'none';
  }
}

// ── Overview Layout (JS-driven balanced columns) ─────────────────────────────

function layoutOverview() {
  // Skip on narrow viewports — CSS media query already forces 1 column via !important
  if (window.innerWidth < 700) return;

  const grid = document.getElementById('overview');
  const cards = grid.querySelectorAll('.overview-card');
  let visible = 0;
  for (const card of cards) {
    if (card.style.display !== 'none') visible++;
  }

  const n = visible;
  const rows = Math.ceil(n / 4);
  const cols = rows > 0 ? Math.max(1, Math.ceil(n / rows)) : 1;
  grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
}

// ── Render Overview ──────────────────────────────────────────────────────────

function statusText(s) {
  if (!s) return { text: '--', cls: '' };
  if (s.status === 'ok') return { text: '正常', cls: 'ok' };
  if (s.status === 'error') return { text: '错误', cls: 'error' };
  if (s.status === 'no_key') return { text: '未配置', cls: 'no_key' };
  if (s.status === 'waiting') return { text: '等待中', cls: '' };
  return { text: s.status, cls: '' };
}

function ovCard(avatarCls, providerName, accountLabel, st, value, sub, barPct, barBg, extraHtml, isPsu) {
  const avatarHtml = isPsu ? `<span style="font-size:14px;">⚡</span>` : `<span class="ov-avatar ${avatarCls}"></span>`;
  const title = accountLabel ? `${providerName} ${accountLabel}` : providerName;
  const barHtml = barPct != null ? `<div class="ov-bar-wrap"><div class="ov-bar" style="width:${barPct};background:${barBg}"></div></div>` : '';
  const extra = extraHtml || '';
  const hidden = (st.cls === 'no_key' || (value === '--' && sub === '未配置')) ? ' style="display:none"' : '';
  const psuCls = isPsu ? ' psu-card' : '';
  const valueStyle = isPsu ? ' style="color:var(--psu-color)"' : '';
  return `<div class="overview-card${psuCls}"${hidden}>
    <div class="ov-header">${avatarHtml}<span class="ov-label">${escapeHtml(title)}</span><span class="ov-status ${st.cls}">${st.text}</span></div>
    <div class="ov-value"${valueStyle}>${value}</div>
    <div class="ov-sub">${sub}</div>
    ${barHtml}${extra}
  </div>`;
}

function renderOverview(data) {
  const cards = [];

  // --- Local observed usage: Claude Code project aggregates from .claude.json ---
  {
    const summary = localUsageData?.summary;
    const ok = localUsageData?.configured && localUsageData?.status?.state === 'ok' && summary;
    const st = ok ? { text: '本机', cls: 'ok' } : { text: '未读取', cls: 'no_key' };
    const value = ok ? '$' + Number(summary.cost_usd || 0).toFixed(2) : '--';
    const sub = ok
      ? `${summary.project_count || 0} 个工作区 · ${fmtTokens(summary.input_tokens || 0)} in / ${fmtTokens(summary.output_tokens || 0)} out`
      : '本地聚合未读取';
    const cache = ok ? fmtTokens((summary.cache_read_tokens || 0) + (summary.cache_creation_tokens || 0)) : '--';
    const extra = ok
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;"><div><div style="font-size:14px;font-weight:700;color:var(--text)">${cache}</div><div style="font-size:11px;color:var(--muted)">缓存 token</div></div><div style="text-align:right;"><div style="font-size:14px;font-weight:700;color:var(--text)">${summary.web_search_requests || 0}</div><div style="font-size:11px;color:var(--muted)">Web 搜索</div></div></div>`
      : '';
    cards.push(ovCard('local', '本地实际使用', null, st, value, sub, null, null, extra));
  }

  // --- MiniMax: one card per account ---
  const mmxAccounts = Array.isArray(data.minimax) ? data.minimax : [];
  for (const acct of mmxAccounts) {
    const st = statusText(acct.status);
    const models = acct.models || [];
    const mmxM = models.find(m => m.model_name === 'MiniMax-M*');
    let value = '--', sub = '等待中', barW = '0%', barBg = 'var(--mmx-color)';
    if (mmxM && st.cls === 'ok') {
      const pct = mmxM.current_interval_total_count > 0 ? ((1 - mmxM.current_interval_usage_count / mmxM.current_interval_total_count) * 100) : 100;
      value = pct.toFixed(1) + '%';
      sub = `剩余 ${(mmxM.current_interval_total_count - mmxM.current_interval_usage_count).toLocaleString()} / ${mmxM.current_interval_total_count.toLocaleString()}`;
      barW = Math.min(100, pct).toFixed(1) + '%';
      barBg = pct < 20 ? 'var(--red)' : pct < 40 ? 'var(--yellow)' : 'var(--mmx-color)';
    }
    const label = acct.label || 'MiniMax';
    cards.push(ovCard('mmx', 'MiniMax 🌐', label, st, value, sub, barW, barBg));
  }
  if (mmxAccounts.length === 0) {
    cards.push(ovCard('mmx', 'MiniMax 🌐', null, statusText(null), '--', '未配置', '0%', 'var(--mmx-color)'));
  }

  // --- DeepSeek: one card per account ---
  const dsAccounts = Array.isArray(data.deepseek) ? data.deepseek : [];
  for (const acct of dsAccounts) {
    const st = statusText(acct.status);
    let value = '--', sub = '等待中';
    if (acct.balance && st.cls === 'ok') {
      value = '¥' + acct.balance.total_balance_cny.toFixed(2);
      sub = '$' + acct.balance.total_balance_usd.toFixed(2);
    }
    const label = acct.label || 'DeepSeek';
    // DeepSeek Platform daily sub-display on first account
    const dspToday = data.deepseek_platform?.today || [];
    const dspConfigured = data.deepseek_platform?.configured;
    let dailyHtml = '';
    if (acct === dsAccounts[0]) {
      const todayCost = dspToday.reduce((sum, u) => sum + u.cost_total, 0);
      const costStr = dspToday.length > 0 ? '¥' + todayCost.toFixed(2) : (dspConfigured ? '¥0.00' : '--');
      dailyHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><div class="ov-value" style="font-size:14px">${costStr}</div><div class="ov-sub">今日消耗</div></div>`;
    }
    cards.push(ovCard('ds', 'DeepSeek', label, st, value, sub, null, null, dailyHtml));
  }
  if (dsAccounts.length === 0) {
    cards.push(ovCard('ds', 'DeepSeek', null, statusText(null), '--', '未配置', null, null));
  }

  // --- Z.AI: one card per account ---
  const zaiAccounts = Array.isArray(data.zai) ? data.zai : [];
  for (const acct of zaiAccounts) {
    const st = statusText(acct.status);
    let value = '--', sub = '等待中', barW = '0%', barBg = 'var(--zai-color)';
    if (acct.quota && st.cls === 'ok') {
      const remain = 100 - acct.quota.token_5h_pct;
      const weekStr = acct.quota.token_week_pct >= 0 ? ` · 周 ${acct.quota.token_week_pct}%` : '';
      value = remain + '%';
      sub = `Lv.${acct.quota.level || '?'} · 5h 已用 ${acct.quota.token_5h_pct}%${weekStr}`;
      barW = Math.min(100, remain) + '%';
      barBg = remain < 20 ? 'var(--red)' : remain < 40 ? 'var(--yellow)' : 'var(--zai-color)';
    }
    const label = acct.label || 'GLM';
    cards.push(ovCard('zai', 'GLM', label, st, value, sub, barW, barBg));
  }
  if (zaiAccounts.length === 0) {
    cards.push(ovCard('zai', 'GLM', null, statusText(null), '--', '未配置', '0%', 'var(--zai-color)'));
  }

  // --- Claude: single instance ---
  {
    const st = statusText(data.claude?.status);
    let value = '--', sub = '未配置', barW = '0%', barBg = 'var(--claude-color)';
    const cQ = data.claude?.quota;
    if (cQ && st.cls === 'ok') {
      const remain = 100 - cQ.five_h_pct;
      value = remain + '%';
      sub = `5h 已用 ${cQ.five_h_pct}% · 7d ${cQ.seven_d_pct}%`;
      barW = Math.min(100, remain) + '%';
      barBg = remain < 20 ? 'var(--red)' : remain < 40 ? 'var(--yellow)' : 'var(--claude-color)';
    }
    cards.push(ovCard('claude', 'Claude', null, st, value, sub, barW, barBg));
  }

  // --- Power ---
  {
    const st = { text: powerOverviewData ? '正常' : '未连接', cls: powerOverviewData ? 'ok' : '' };
    let value = '--', sub = 'AC 输入功率', extraHtml = '';
    if (powerOverviewData) {
      value = powerOverviewData.ac_input_w.toFixed(1) + 'W';
      const kWh = psuEnergyToday ?? 0;
      const cost = psuCostToday ?? 0;
      extraHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;"><div><div style="font-size:14px;font-weight:700;color:var(--text)">${kWh.toFixed(3)}</div><div style="font-size:11px;color:var(--muted)">今日用电</div></div><div style="text-align:right;"><div style="font-size:14px;font-weight:700;color:var(--text)">¥${cost.toFixed(2)}</div><div style="font-size:11px;color:var(--muted)">今日电费</div></div></div>`;
    }
    cards.push(ovCard('psu', '⚡ Power', null, st, value, sub, null, null, extraHtml, true));
  }

  // --- MiMo: one card per account ---
  const mimoAccounts = Array.isArray(data.mimo) ? data.mimo : [];
  for (const acct of mimoAccounts) {
    const st = statusText(acct.status);
    let value = '--', sub = '等待中', barW = '0%', barBg = 'var(--mimo-color)';
    if (acct.quota && st.cls === 'ok') {
      const remainPct = 100 - acct.quota.month_percent * 100;
      const fmtM = (v) => { const m = v / 1e6; return (m < 10 ? m.toFixed(2) : m.toFixed(1)) + 'M'; };
      value = remainPct.toFixed(1) + '%';
      sub = `${fmtM(acct.quota.month_limit - acct.quota.month_used)} 剩余 · ${acct.quota.plan_name}`;
      barW = Math.min(100, remainPct) + '%';
      barBg = remainPct < 20 ? 'var(--red)' : remainPct < 40 ? 'var(--yellow)' : 'var(--mimo-color)';
    }
    const label = acct.label || 'MiMo';
    cards.push(ovCard('mimo', 'MiMo', label, st, value, sub, barW, barBg));
  }
  if (mimoAccounts.length === 0) {
    cards.push(ovCard('mimo', 'MiMo', null, statusText(null), '--', '未配置', '0%', 'var(--mimo-color)'));
  }

  // Render all cards into overview grid
  const grid = document.getElementById('overview');
  grid.innerHTML = cards.join('');

  // Re-compute visible cards and balanced grid columns after all statuses are set
  layoutOverview();

  updateFooter(data);
}

// ── Render Local Usage ──────────────────────────────────────────────────────

function fmtUsd(v) {
  if (v === null || v === undefined || v === '') return '--';
  return '$' + Number(v || 0).toFixed(2);
}

function fmtCny(v) {
  return '¥' + Number(v || 0).toFixed(2);
}

function fmtQuota(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatUnitAmount(value, unit = 'usd') {
  if (value === null || value === undefined || value === '') return '--';
  if (unit === 'usd') return fmtUsd(value);
  if (unit === 'cny') return fmtCny(value);
  if (unit === 'token') return fmtTokens(value);
  if (unit === 'quota' || unit === 'credit') return fmtQuota(value);
  if (unit === 'count') return Number(value || 0).toLocaleString();
  return `${fmtQuota(value)} ${String(unit || '').toUpperCase()}`.trim();
}

function isUsdCost(unit) {
  return String(unit || 'usd').toLowerCase() === 'usd';
}

function sourceStateLabel(state) {
  if (state === 'ok') return '<span class="source-state ok">ok</span>';
  if (state === 'missing') return '<span class="source-state missing">missing</span>';
  if (state === 'disabled') return '<span class="source-state disabled">disabled</span>';
  if (state === 'planned') return '<span class="source-state planned">planned</span>';
  if (state === 'stale') return '<span class="source-state stale">stale</span>';
  if (state === 'auth_failed') return '<span class="source-state auth-failed">auth_failed</span>';
  if (state === 'unavailable') return '<span class="source-state unavailable">unavailable</span>';
  if (state === 'error') return '<span class="source-state error">error</span>';
  return `<span class="source-state">${escapeHtml(state || '--')}</span>`;
}

function registryStateLabel(value) {
  const labels = {
    present: ['能力存在', 'ok'],
    absent: ['能力缺失', 'missing'],
    planned: ['计划接入', 'planned'],
    configured: ['已配置', 'ok'],
    not_configured: ['未配置', 'missing'],
    ok: ['ok', 'ok'],
    auth_failed: ['凭证失败', 'auth-failed'],
    fetch_failed: ['请求失败', 'error'],
    no_data: ['无数据', 'stale'],
    waiting: ['等待', 'stale'],
    disabled: ['已禁用', 'disabled'],
    missing: ['缺失', 'missing'],
    connected: ['已接入', 'ok'],
    not_connected: ['未接入', 'planned'],
    hidden_by_filter: ['被过滤', 'stale'],
    visible: ['可见', 'ok'],
    not_in_command_demo: ['未进态势台', 'planned'],
    unknown: ['未知', 'stale'],
  };
  const [label, klass] = labels[value] || [value || '--', ''];
  return `<span class="source-state ${escapeHtml(klass)}">${escapeHtml(label)}</span>`;
}

function renderCommandSourceRegistry(sourceRegistry = [], sources = []) {
  if (Array.isArray(sourceRegistry) && sourceRegistry.length) {
    return sourceRegistry.map(entry => {
      const missing = (entry.missing_items || []).filter(Boolean).join('、');
      const message = [missing && `缺少：${missing}`, entry.message].filter(Boolean).join(' · ') || '--';
      return `
        <tr>
          <td>
            <div class="workspace-name">${escapeHtml(entry.label || entry.id || '--')}</div>
            <div class="workspace-path">${escapeHtml(entry.category || entry.kind || entry.id || '--')}</div>
          </td>
          <td>${registryStateLabel(entry.code_capability)}</td>
          <td>${registryStateLabel(entry.configuration_state)}</td>
          <td>${registryStateLabel(entry.collection_state)}</td>
          <td>${registryStateLabel(entry.command_demo_adapter)}</td>
          <td>${registryStateLabel(entry.visibility_state)}</td>
          <td>${escapeHtml(message)}</td>
        </tr>
      `;
    }).join('');
  }

  if (Array.isArray(sources) && sources.length) {
    return sources.map(source => `
      <tr>
        <td>${escapeHtml(source.label || source.id || '--')}</td>
        <td>${registryStateLabel('unknown')}</td>
        <td>${registryStateLabel('unknown')}</td>
        <td>${sourceStateLabel(source.state)}</td>
        <td>${registryStateLabel('unknown')}</td>
        <td>${registryStateLabel('visible')}</td>
        <td>${escapeHtml(source.message || (source.capabilities || []).join(', ') || '--')}</td>
      </tr>
    `).join('');
  }

  return '<tr><td colspan="7" style="color:var(--muted)">暂无 source registry；等待后端注册感知通道。</td></tr>';
}

function signalValue(signal) {
  if (!signal || signal.value === null || signal.value === undefined) return '--';
  if (signal.unit === 'usd') return fmtUsd(signal.value);
  if (signal.unit === 'cny') return fmtCny(signal.value);
  if (signal.unit === 'token') return fmtTokens(signal.value);
  if (signal.unit === 'quota' || signal.unit === 'credit') return fmtQuota(signal.value);
  if (signal.unit === 'percent') return Number(signal.value || 0).toFixed(2) + '%';
  if (signal.unit === 'count') return Number(signal.value || 0).toLocaleString();
  return String(signal.value);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function commandModelSourceRank(source) {
  const idx = COMMAND_MODEL_SOURCE_ORDER.indexOf(source);
  return idx === -1 ? COMMAND_MODEL_SOURCE_ORDER.length : idx;
}

function normalizeCommandModelName(source, model, provider) {
  const raw = String(model || '').trim();
  if (raw && raw !== 'unknown') return raw;
  if (source === 'Codex' && provider) return `${provider} / unknown`;
  return raw || 'unknown';
}

function collectCommandModelInputRows(data) {
  const models = data?.datasets?.top_models || [];
  const sub2Models = data?.datasets?.sub2api_model_stats || [];
  const newApiModels = data?.datasets?.newapi_model_stats || [];
  const codexModels = data?.datasets?.codex_model_stats || [];
  const ccSwitchModels = data?.datasets?.cc_switch_model_stats || [];

  return [
    ...models.map(m => {
      const total = (m.input_tokens || 0) + (m.output_tokens || 0) + (m.cache_read_tokens || 0) + (m.cache_creation_tokens || 0);
      return { source: 'Claude', model: m.model, cost: m.cost_usd, costUnit: 'usd', tokens: total, requests: null };
    }),
    ...codexModels.map(m => ({
      source: 'Codex',
      model: normalizeCommandModelName('Codex', m.model, m.provider),
      cost: null,
      tokens: m.total_tokens,
      requests: m.sessions,
    })),
    ...ccSwitchModels.map(m => ({
      source: `CC ${m.app || ''}`.trim(),
      model: normalizeCommandModelName('CC Switch', m.model, m.provider),
      cost: m.cost,
      costUnit: 'usd',
      tokens: m.total_tokens,
      requests: m.requests,
    })),
    ...newApiModels.map(m => ({
      source: 'NewAPI',
      model: normalizeCommandModelName('NewAPI', m.model),
      quota: m.quota_used ?? m.cost,
      quotaUnit: m.quota_unit || 'quota',
      tokens: m.total_tokens,
      requests: m.requests,
    })),
    ...sub2Models.map(m => ({
      source: 'Sub2API',
      model: normalizeCommandModelName('Sub2API', m.model),
      cost: m.cost,
      costUnit: m.cost_unit || 'usd',
      tokens: m.total_tokens,
      requests: m.requests,
    })),
  ];
}

function buildUnifiedCommandModelRows(data) {
  const map = new Map();
  for (const row of collectCommandModelInputRows(data)) {
    const model = normalizeCommandModelName(row.source, row.model);
    const key = model.toLowerCase();
    const current = map.get(key) || {
      model,
      sources: [],
      sourceSet: new Set(),
      cost: 0,
      costKnown: false,
      costUnit: 'usd',
      costComparable: false,
      quota: 0,
      quotaKnown: false,
      quotaUnit: 'quota',
      tokens: 0,
      requests: 0,
      requestKnown: false,
    };
    if (!current.sourceSet.has(row.source)) {
      current.sourceSet.add(row.source);
      current.sources.push(row.source);
      current.sources.sort((a, b) => commandModelSourceRank(a) - commandModelSourceRank(b) || a.localeCompare(b));
    }

    const cost = finiteOrNull(row.cost);
    if (cost !== null) {
      const rowCostUnit = row.costUnit || 'usd';
      const nextUnit = current.costKnown && current.costUnit !== rowCostUnit ? 'mixed' : rowCostUnit;
      current.cost += cost;
      current.costKnown = true;
      current.costUnit = nextUnit;
      current.costComparable = current.costComparable || isUsdCost(rowCostUnit);
      if (current.costUnit === 'mixed') current.costComparable = false;
    }
    const quota = finiteOrNull(row.quota);
    if (quota !== null) {
      current.quota += quota;
      current.quotaKnown = true;
      current.quotaUnit = row.quotaUnit || current.quotaUnit || 'quota';
    }
    current.tokens += finiteOrNull(row.tokens) || 0;
    const requests = finiteOrNull(row.requests);
    if (requests !== null) {
      current.requests += requests;
      current.requestKnown = true;
    }
    map.set(key, current);
  }

  return [...map.values()].map(row => ({
    ...row,
    cost: row.costKnown ? row.cost : null,
    quota: row.quotaKnown ? row.quota : null,
    requests: row.requestKnown ? row.requests : null,
    primarySource: row.sources[0] || '',
  }));
}

const COMMAND_RELAY_METRIC_LABELS = {
  quota_total: '总额度',
  quota_used: '已用额度',
  quota_available: '可用额度',
  usage_percent: '使用率',
  balance_available: '钱包余额',
  requests_today: '今日请求',
  requests_total: '累计请求',
  tokens_today: '今日 Token',
  tokens_total: '累计 Token',
  cost_today: '今日成本',
  cost_total: '累计成本',
  model_tokens: '模型 Token',
  model_cost: '模型成本',
  model_quota: '模型额度',
  model_requests: '模型请求',
};

const COMMAND_RELAY_METRIC_ORDER = [
  'quota_available',
  'quota_used',
  'quota_total',
  'usage_percent',
  'balance_available',
  'tokens_today',
  'tokens_total',
  'cost_today',
  'cost_total',
  'requests_today',
  'requests_total',
  'model_tokens',
  'model_cost',
  'model_quota',
  'model_requests',
];

function relayMetricRank(metric) {
  const idx = COMMAND_RELAY_METRIC_ORDER.indexOf(metric);
  return idx === -1 ? COMMAND_RELAY_METRIC_ORDER.length : idx;
}

function relayMetricLabel(metric) {
  return COMMAND_RELAY_METRIC_LABELS[metric] || metric;
}

function relayMetricFromPath(pathName) {
  if (pathName === 'api.newapi.quota.total') return 'quota_total';
  if (pathName === 'api.newapi.quota.used') return 'quota_used';
  if (pathName === 'api.newapi.quota.available') return 'quota_available';
  if (pathName === 'api.newapi.usage.percent') return 'usage_percent';
  if (pathName === 'api.newapi.requests.total') return 'requests_total';
  if (pathName === 'api.sub2api.balance.available') return 'balance_available';
  if (pathName === 'api.sub2api.requests.today') return 'requests_today';
  if (pathName === 'api.sub2api.requests.total') return 'requests_total';
  if (pathName === 'api.sub2api.tokens.today') return 'tokens_today';
  if (pathName === 'api.sub2api.tokens.total') return 'tokens_total';
  if (pathName === 'api.sub2api.cost.today') return 'cost_today';
  if (pathName === 'api.sub2api.cost.total') return 'cost_total';
  return null;
}

function relayMetricGroup(metric, unit) {
  if (unit === 'token' || metric.includes('tokens')) return 'token';
  if (unit === 'percent' || metric === 'usage_percent') return 'percent';
  if (metric.includes('quota')) return 'quota';
  if (metric.includes('balance')) return 'balance';
  if (unit === 'usd' || unit === 'cny' || metric.includes('cost')) return 'money';
  if (unit === 'count' || metric.includes('requests')) return 'count';
  return unit || 'value';
}

function relayGroupLabel(group, unit) {
  if (group === 'quota') return unit === 'token' ? '额度单位 Token' : unit === 'cny' ? '额度单位 CNY' : unit === 'usd' ? '额度单位 USD' : '额度单位';
  if (group === 'balance') return unit === 'cny' ? '钱包余额 CNY' : '钱包余额 USD';
  if (group === 'money') return unit === 'cny' ? '成本 CNY' : '成本 USD';
  if (group === 'token') return 'Token';
  if (group === 'count') return '次数';
  if (group === 'percent') return '百分比';
  return String(unit || group || '数值').toUpperCase();
}

function formatRelayMetricValue(metric) {
  if (!metric || metric.value === null || metric.value === undefined) return '--';
  return signalValue(metric);
}

function formatCostCell(costKnown, cost) {
  return costKnown ? fmtUsd(cost) : '<span class="cost-unknown">成本未知</span>';
}

function formatModelSpendCell(row) {
  const parts = [];
  if (row?.costKnown) {
    const label = row.costComparable ? 'USD 成本' : '成本';
    parts.push(`<span>${escapeHtml(`${label} ${formatUnitAmount(row.cost, row.costUnit || 'usd')}`)}</span>`);
  }
  if (row?.quotaKnown) {
    parts.push(`<small>${escapeHtml(`NewAPI 额度 ${formatUnitAmount(row.quota, row.quotaUnit || 'quota')}`)}</small>`);
  }
  if (!parts.length) {
    return '<span class="cost-unknown">成本未知</span>';
  }
  return `<div class="model-spend-cell">${parts.join('')}</div>`;
}

function recordKindLabel(kind) {
  if (kind === 'session') return '会话';
  if (kind === 'project_aggregate') return '项目聚合';
  return String(kind || '证据');
}

function formatWorkspaceRecord(project) {
  if (Array.isArray(project?.record_breakdown) && project.record_breakdown.length) {
    const rows = project.record_breakdown
      .filter(item => Number(item?.count || 0) > 0)
      .map(item => {
        const source = item.source || item.label || 'unknown';
        const kind = recordKindLabel(item.kind || item.record_kind);
        const prefix = item.synthetic ? '推断 ' : '';
        return `${prefix}${source} ${Number(item.count || 0).toLocaleString()} ${kind}`;
      });
    if (rows.length) {
      const latestAt = project?.latest_at ? Date.parse(project.latest_at) : NaN;
      const latest = Number.isFinite(latestAt)
        ? new Date(latestAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      return `
        <div class="workspace-record">
          <strong>${escapeHtml(rows.join(' · '))}</strong>
          <small>${escapeHtml(latest ? `最近 ${latest}` : '由使用记录聚合')}</small>
        </div>
      `;
    }
  }
  const sessions = Number(project?.sessions || 0);
  const recordCount = Number(project?.record_count || 0);
  const kinds = Array.isArray(project?.record_kinds) && project.record_kinds.length
    ? project.record_kinds
    : (project?.record_kind ? [project.record_kind] : []);
  const kindLabels = kinds.map(recordKindLabel);
  const latestAt = project?.latest_at ? Date.parse(project.latest_at) : NaN;
  const latest = Number.isFinite(latestAt)
    ? new Date(latestAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  let primary = recordCount > 0 ? `${recordCount.toLocaleString()} 条证据` : '聚合记录';
  if (kinds.length === 1 && kinds[0] === 'session') primary = `${(sessions || recordCount).toLocaleString()} 会话`;
  if (kinds.length === 1 && kinds[0] === 'project_aggregate') primary = `${recordCount || 1} 项目聚合`;
  const details = [
    kindLabels.length ? kindLabels.join(' + ') : '聚合字段',
    latest ? `最近 ${latest}` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="workspace-record">
      <strong>${escapeHtml(primary)}</strong>
      <small>${escapeHtml(details || '仅聚合字段')}</small>
    </div>
  `;
}

function collectRelayMetrics(data) {
  const sources = (data?.sources || [])
    .filter(s => s.kind === 'newapi' || s.kind === 'sub2api')
    .map(s => ({
      id: s.id,
      kind: s.kind,
      label: s.label || (s.kind === 'newapi' ? 'NewAPI' : 'Sub2API'),
      state: s.state || '--',
      message: s.message || '',
    }));
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  const sourceIdByKind = new Map(sources.map(s => [s.kind, s.id]));
  const metrics = [];

  for (const signal of data?.signals || []) {
    const metric = relayMetricFromPath(signal.path);
    const source = sourceMap.get(signal.sourceId);
    if (!metric || !source) continue;
    metrics.push({
      ...signal,
      metric,
      label: relayMetricLabel(metric),
      source,
      group: relayMetricGroup(metric, signal.unit),
    });
  }

  const addModelMetric = (sourceId, metric, value, unit) => {
    const source = sourceMap.get(sourceId);
    if (!source || value === null || value === undefined) return;
    metrics.push({
      id: `${sourceId}-${metric}`,
      path: `api.${source.kind}.models.${metric}`,
      domain: 'api',
      kind: 'usage',
      subject: sourceId,
      sourceId,
      source,
      metric,
      label: relayMetricLabel(metric),
      value,
      unit,
      confidence: 'derived',
      group: relayMetricGroup(metric, unit),
    });
  };
  const sumDataset = items => {
    const rows = Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
    if (!rows.length) return { hasRows: false, requests: null, tokens: null, cost: null, quota: null, costUnit: 'usd', quotaUnit: 'quota' };
    return rows.reduce((acc, item) => {
      const requests = finiteOrNull(item.requests);
      const tokens = finiteOrNull(item.total_tokens);
      const cost = finiteOrNull(item.cost);
      const quota = finiteOrNull(item.quota_used);
      if (requests !== null) acc.requests = (acc.requests || 0) + requests;
      if (tokens !== null) acc.tokens = (acc.tokens || 0) + tokens;
      if (cost !== null) {
        acc.cost = (acc.cost || 0) + cost;
        acc.costUnit = item.cost_unit || acc.costUnit || 'usd';
      }
      if (quota !== null) {
        acc.quota = (acc.quota || 0) + quota;
        acc.quotaUnit = item.quota_unit || acc.quotaUnit || 'quota';
      }
      return acc;
    }, { hasRows: true, requests: null, tokens: null, cost: null, quota: null, costUnit: 'usd', quotaUnit: 'quota' });
  };
  const newApiModels = sumDataset(data?.datasets?.newapi_model_stats);
  const sub2ApiModels = sumDataset(data?.datasets?.sub2api_model_stats);
  const newApiSourceId = sourceIdByKind.get('newapi');
  const sub2ApiSourceId = sourceIdByKind.get('sub2api');
  addModelMetric(newApiSourceId, 'model_tokens', newApiModels.tokens, 'token');
  addModelMetric(newApiSourceId, 'model_quota', newApiModels.quota, newApiModels.quotaUnit);
  addModelMetric(newApiSourceId, 'model_requests', newApiModels.requests, 'count');
  addModelMetric(sub2ApiSourceId, 'model_tokens', sub2ApiModels.tokens, 'token');
  addModelMetric(sub2ApiSourceId, 'model_cost', sub2ApiModels.cost, sub2ApiModels.costUnit);
  addModelMetric(sub2ApiSourceId, 'model_requests', sub2ApiModels.requests, 'count');

  return { sources, metrics };
}

function renderRelayStatus(source) {
  if (!source) return '<span class="source-state missing">missing</span>';
  return sourceStateLabel(source.state);
}

function renderCommandRelayBySource(sources, metrics) {
  return sources.map(source => {
    const sourceMetrics = metrics
      .filter(m => m.sourceId === source.id)
      .sort((a, b) => relayMetricRank(a.metric) - relayMetricRank(b.metric) || String(a.label).localeCompare(String(b.label)));
    const rows = sourceMetrics.length ? sourceMetrics.map(metric => `
      <div class="command-relay-metric">
        <div>
          <span>${escapeHtml(metric.label)}</span>
          <small>${escapeHtml(relayGroupLabel(metric.group, metric.unit))}</small>
        </div>
        <strong>${escapeHtml(formatRelayMetricValue(metric))}</strong>
      </div>
    `).join('') : '<div class="command-relay-empty">暂无可聚合指标</div>';
    return `
      <section class="command-relay-summary-card">
        <div class="command-relay-card-head">
          <div>
            <strong>${escapeHtml(source.label)}</strong>
            <small>${escapeHtml(source.message || '等待数据源响应')}</small>
          </div>
          ${renderRelayStatus(source)}
        </div>
        <div class="command-relay-metric-list">${rows}</div>
      </section>
    `;
  }).join('');
}

function renderCommandRelayByMetric(sources, metrics) {
  const metricMap = new Map();
  for (const metric of metrics) {
    const key = `${metric.metric}::${metric.unit || ''}`;
    const entry = metricMap.get(key) || {
      metric: metric.metric,
      label: metric.label,
      unit: metric.unit,
      group: metric.group,
      bySource: new Map(),
    };
    entry.bySource.set(metric.sourceId, metric);
    metricMap.set(key, entry);
  }
  const groups = [...metricMap.values()]
    .sort((a, b) => relayMetricRank(a.metric) - relayMetricRank(b.metric) || String(a.label).localeCompare(String(b.label)));
  if (!groups.length) return '<div class="command-relay-empty">暂无可横向对比的中转指标</div>';

  return groups.map(group => `
    <section class="command-relay-matrix-row">
      <div class="command-relay-matrix-title">
        <strong>${escapeHtml(group.label)}</strong>
        <span>${escapeHtml(relayGroupLabel(group.group, group.unit))}</span>
      </div>
      <div class="command-relay-source-values">
        ${sources.map(source => {
          const metric = group.bySource.get(source.id);
          return `
            <div class="command-relay-source-value ${metric ? '' : 'empty'}">
              <span>${escapeHtml(source.label)}</span>
              <strong>${metric ? escapeHtml(formatRelayMetricValue(metric)) : '--'}</strong>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');
}

function renderCommandRelayDetailsState() {
  const container = document.getElementById('command-relay-summary');
  const toggle = document.getElementById('command-relay-details-toggle');
  if (container) {
    container.classList.toggle('collapsed', commandRelayDetailsCollapsed);
  }
  if (toggle) {
    toggle.textContent = commandRelayDetailsCollapsed ? '展开明细' : '折叠明细';
    toggle.setAttribute('aria-expanded', commandRelayDetailsCollapsed ? 'false' : 'true');
  }
}

function renderCommandRelaySummary(data) {
  const container = document.getElementById('command-relay-summary');
  if (!container) return;
  document.querySelectorAll('.command-relay-view-btn[data-relay-view]').forEach(btn => {
    const isActive = btn.dataset.relayView === commandRelayView;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const { sources, metrics } = collectRelayMetrics(data);
  if (!sources.length) {
    container.innerHTML = '<div class="command-relay-empty">暂无 NewAPI / Sub2API 来源；配置后会展示中转指标聚合。</div>';
    renderCommandRelayDetailsState();
    return;
  }

  container.innerHTML = commandRelayView === 'metric'
    ? renderCommandRelayByMetric(sources, metrics)
    : renderCommandRelayBySource(sources, metrics);
  container.classList.toggle('metric-view', commandRelayView === 'metric');
  renderCommandRelayDetailsState();
}

function sortCommandModelRows(rows, sortMode = commandModelSort) {
  const comparableCost = row => row?.costComparable ? Number(row.cost || 0) : 0;
  const byCost = (a, b) =>
    Number(b.costComparable) - Number(a.costComparable) ||
    comparableCost(b) - comparableCost(a) ||
    Number(b.costKnown) - Number(a.costKnown) ||
    (b.tokens || 0) - (a.tokens || 0) ||
    String(a.model).localeCompare(String(b.model));
  const byTokens = (a, b) =>
    (b.tokens || 0) - (a.tokens || 0) ||
    byCost(a, b);
  const byRequests = (a, b) =>
    Number(b.requestKnown) - Number(a.requestKnown) ||
    (b.requests || 0) - (a.requests || 0) ||
    byTokens(a, b);
  const bySource = (a, b) =>
    commandModelSourceRank(a.primarySource) - commandModelSourceRank(b.primarySource) ||
    byCost(a, b);

  const sorter = sortMode === 'tokens'
    ? byTokens
    : sortMode === 'requests'
      ? byRequests
      : sortMode === 'source'
        ? bySource
        : byCost;
  return [...rows].sort(sorter);
}

function renderCommandDemo(data) {
  const verdict = document.getElementById('command-verdict');
  const sub = document.getElementById('command-verdict-sub');
  const generated = document.getElementById('command-generated');
  if (!verdict || !sub || !generated) return;

  if (!data || data.status?.state === 'error') {
    verdict.textContent = '未就绪';
    sub.textContent = data?.status?.message || 'demo 数据接口暂不可用。';
    generated.textContent = '--';
    return;
  }

  const signals = data.signals || [];
  const cost = signals.find(s => s.path === 'agent.usage.cost.aggregate');
  const tokens = signals.find(s => s.path === 'agent.usage.tokens.total.aggregate');
  const sources = data.sources || [];
  const counts = data.source_counts || {};
  const newApiSource = sources.find(s => s.id === 'newapi-main' || s.kind === 'newapi');
  const sub2ApiSource = sources.find(s => s.id === 'sub2api-main' || s.kind === 'sub2api');

  verdict.textContent = data.verdict?.label || '--';
  sub.textContent = data.verdict?.summary || data.intent?.title || '个人态势观察 demo';
  generated.textContent = data.generated_at ? new Date(data.generated_at).toLocaleString('zh-CN') : '--';
  document.getElementById('command-cost').textContent = signalValue(cost);
  document.getElementById('command-tokens').textContent = signalValue(tokens);
  document.getElementById('command-sources').textContent =
    `${counts.ok || 0} / ${sources.length || 0}`;
  const newApiValue = document.getElementById('command-newapi');
  const newApiSub = document.getElementById('command-newapi-sub');
  if (newApiValue && newApiSub) {
    newApiValue.textContent = newApiSource?.state || '--';
    newApiSub.textContent = newApiSource?.message || '未配置 NewAPI source';
  }
  const sub2ApiValue = document.getElementById('command-sub2api');
  const sub2ApiSub = document.getElementById('command-sub2api-sub');
  if (sub2ApiValue && sub2ApiSub) {
    const balance = signals.find(s => s.path === 'api.sub2api.balance.available');
    sub2ApiValue.textContent = balance ? signalValue(balance) : (sub2ApiSource?.state || '--');
    sub2ApiSub.textContent = sub2ApiSource?.message || '未配置 Sub2API source';
  }

  const alertBox = document.getElementById('command-alerts');
  const alerts = data.datasets?.alerts || [];
  alertBox.innerHTML = alerts.length ? alerts.map(a => `
    <div class="command-alert ${escapeHtml(a.level || 'info')}">
      <strong>${escapeHtml(a.title || '--')}</strong>
      <span>${escapeHtml(a.detail || '')}</span>
    </div>
  `).join('') : '<div class="command-alert ok"><strong>无告警</strong><span>当前 demo 未发现需要展示的异常。</span></div>';

  document.getElementById('command-signal-body').innerHTML = signals.length ? signals.map(s => `
    <tr>
      <td>${escapeHtml(s.path || '--')}</td>
      <td>${escapeHtml(signalValue(s))}</td>
      <td>${escapeHtml(s.confidence || '--')}</td>
    </tr>
  `).join('') : '<tr><td colspan="3" style="color:var(--muted)">暂无 signal</td></tr>';

  document.getElementById('command-source-body').innerHTML = renderCommandSourceRegistry(
    data.datasets?.source_registry,
    sources
  );

  const modelRows = buildUnifiedCommandModelRows(data);
  const displayRows = sortCommandModelRows(modelRows).slice(0, 22);
  document.getElementById('command-model-body').innerHTML = displayRows.length ? displayRows.map(m => {
    const source = (m.sources || []).map(s => `<span class="acct-badge">${escapeHtml(s)}</span>`).join('');
    const requests = Number.isFinite(Number(m.requests)) ? ` · ${Number(m.requests).toLocaleString()} 次` : '';
    return `
      <tr>
        <td>${source}${escapeHtml(m.model || '--')}${requests}</td>
        <td>${formatModelSpendCell(m)}</td>
        <td>${fmtTokens(m.tokens)}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="3" style="color:var(--muted)">暂无模型数据</td></tr>';

  const projects = data.datasets?.top_projects || [];
  document.getElementById('command-project-body').innerHTML = projects.length ? projects.slice(0, 8).map(p => {
    const sources = (p.sources || []).map(s => `<span class="acct-badge">${escapeHtml(s)}</span>`).join('');
    const costKnown = p.cost_known !== false && p.cost_usd !== null && p.cost_usd !== undefined;
    const tokens = p.tokens ?? ((p.input_tokens || 0) + (p.output_tokens || 0) + (p.cache_read_tokens || 0) + (p.cache_creation_tokens || 0));
    const pathText = p.workspace_path && p.workspace_path !== p.workspace
      ? `<div class="workspace-path" title="${escapeHtml(p.workspace_path)}">${escapeHtml(p.workspace_path)}</div>`
      : '';
    return `
      <tr>
        <td><div class="workspace-name">${escapeHtml(p.workspace || '--')}</div>${pathText}</td>
        <td>${formatCostCell(costKnown, p.cost_usd)}</td>
        <td>${fmtTokens(tokens || 0)}</td>
        <td>${formatWorkspaceRecord(p)}</td>
        <td>${sources || '--'}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="5" style="color:var(--muted)">暂无工作区数据</td></tr>';

  recordCommandSnapshot(data);
  renderCommandRelaySummary(data);
  renderCommandTrend();
  renderCommandModelChart(modelRows);
  renderCommandModelTrend(data.datasets);
  renderCommandSemanticProjection(data);
}

function semanticKnownnessLabel(knownness) {
  const labels = {
    known: '已知',
    unknown: '未知',
    reported_zero: '接口报告 0',
    derived: '推导',
    planned: '计划接入',
  };
  return labels[knownness] || knownness || '--';
}

function semanticWidgetLabel(widgetId) {
  const labels = {
    'status-matrix': '状态矩阵',
    'capability-matrix': '能力矩阵',
    'reserve-card': '余量卡',
    'relay-zone': '中转专区',
    'window-trend': '趋势图',
    'rank-table': '排行表',
    'evidence-table': '证据表',
    'metric-card': '指标卡',
  };
  return labels[widgetId] || widgetId || '--';
}

function semanticPill(text, extraClass = '') {
  return `<span class="command-semantic-pill ${escapeHtml(extraClass)}">${escapeHtml(text || '--')}</span>`;
}

function renderSemanticTableEmpty(colspan, text = '暂无语义投影数据') {
  return `<tr><td colspan="${colspan}" style="color:var(--muted)">${escapeHtml(text)}</td></tr>`;
}

function renderSemanticCounts(items) {
  return (Array.isArray(items) ? items : []).map(item => `
    <span class="command-semantic-chip">
      ${escapeHtml(item.label || item.id || '--')}
      <strong>${Number(item.count || 0).toLocaleString()}</strong>
    </span>
  `).join('');
}

function renderDataRepresentationBlueprint(blueprint, container) {
  if (!container) return;
  if (!blueprint) {
    container.innerHTML = '<div class="command-semantic-empty">等待数据表征蓝图。</div>';
    return;
  }

  const source = blueprint.source_contract || {};
  const signal = blueprint.signal_contract || {};
  const dataset = blueprint.dataset_contract || {};
  const blocks = [
    {
      name: source.name || 'SourceStatus',
      count: source.count,
      rows: [['状态', renderSemanticCounts(source.states)]],
    },
    {
      name: signal.name || 'SignalSemantics',
      count: signal.count,
      rows: [
        ['角色', renderSemanticCounts(signal.roles)],
        ['量纲', renderSemanticCounts(signal.units)],
        ['对象', renderSemanticCounts(signal.subjects)],
        ['证据', renderSemanticCounts(signal.knownness)],
      ],
    },
    {
      name: dataset.name || 'DatasetSemantics',
      count: dataset.count,
      rows: [
        ['组件', renderSemanticCounts(dataset.widgets)],
        ['行对象', renderSemanticCounts(dataset.row_subjects)],
      ],
    },
  ];

  const invariants = (blueprint.invariants || []).map(item => `
    <li>${escapeHtml(item)}</li>
  `).join('');

  container.innerHTML = `
    <div class="command-blueprint-principle">${escapeHtml(blueprint.principle || '--')}</div>
    ${blocks.map(block => `
      <article class="command-blueprint-card">
        <div class="command-blueprint-card-title">
          <strong>${escapeHtml(block.name)}</strong>
          <span>${Number(block.count || 0).toLocaleString()}</span>
        </div>
        ${block.rows.map(([label, chips]) => `
          <div class="command-blueprint-row">
            <span>${escapeHtml(label)}</span>
            <div>${chips || '<span class="command-semantic-sub">暂无</span>'}</div>
          </div>
        `).join('')}
      </article>
    `).join('')}
    <ul class="command-blueprint-rules">${invariants}</ul>
  `;
}

function renderPresentationBlueprint(blueprint, container) {
  if (!container) return;
  if (!blueprint) {
    container.innerHTML = '<div class="command-semantic-empty">等待面板呈现蓝图。</div>';
    return;
  }

  const lanes = blueprint.lanes || [];
  container.innerHTML = `
    <div class="command-blueprint-principle">${escapeHtml(blueprint.principle || '--')}</div>
    ${lanes.map(lane => {
      const metricCount = (lane.metric_group_ids || []).length;
      const datasetCount = (lane.dataset_ids || []).length;
      const rules = (lane.rules || []).slice(0, 3).map(rule => `<li>${escapeHtml(rule)}</li>`).join('');
      return `
        <article class="command-lane-card">
          <div class="command-lane-head">
            <div>
              <strong>${escapeHtml(lane.name || lane.id || '--')}</strong>
              <span>${escapeHtml(lane.purpose || '--')}</span>
            </div>
            ${semanticPill(semanticWidgetLabel(lane.widget), 'widget')}
          </div>
          <div class="command-lane-metrics">
            <span>指标组 <strong>${metricCount}</strong></span>
            <span>数据集 <strong>${datasetCount}</strong></span>
            <span>证据 <strong>${Number(lane.evidence_count || 0).toLocaleString()}</strong></span>
          </div>
          <ul>${rules}</ul>
        </article>
      `;
    }).join('')}
  `;
}

function renderCommandSemanticProjection(data) {
  const projection = data?.semantic_projection;
  const summaryBox = document.getElementById('command-semantic-summary');
  const representationBox = document.getElementById('command-data-representation');
  const presentationBox = document.getElementById('command-presentation-blueprint');
  const layerBody = document.getElementById('command-semantic-layer-body');
  const metricBody = document.getElementById('command-semantic-group-body');
  const datasetBody = document.getElementById('command-dataset-group-body');
  const widgetBox = document.getElementById('command-widget-registry');
  const evidenceBox = document.getElementById('command-evidence-notes');
  if (!summaryBox || !layerBody || !metricBody || !datasetBody || !widgetBox || !evidenceBox) return;

  if (!projection) {
    summaryBox.innerHTML = '<div class="command-semantic-empty">等待后端 semantic_projection。</div>';
    layerBody.innerHTML = renderSemanticTableEmpty(3);
    metricBody.innerHTML = renderSemanticTableEmpty(6);
    datasetBody.innerHTML = renderSemanticTableEmpty(5);
    widgetBox.innerHTML = '<div class="command-semantic-empty">暂无 widget registry。</div>';
    evidenceBox.innerHTML = '<div class="command-semantic-empty">暂无证据说明。</div>';
    renderDataRepresentationBlueprint(null, representationBox);
    renderPresentationBlueprint(null, presentationBox);
    return;
  }

  const metricGroups = projection.metric_groups || [];
  const datasetGroups = projection.dataset_groups || [];
  const widgets = projection.widget_registry || [];
  const notes = projection.evidence_notes || [];
  const summary = projection.summary || {};
  const layerCount = (projection.layers || []).length;

  summaryBox.innerHTML = [
    ['层', layerCount],
    ['Signal', summary.signal_count ?? 0],
    ['数据集', summary.dataset_count ?? datasetGroups.length],
    ['指标组', metricGroups.length],
    ['数据集组', datasetGroups.length],
    ['Widget', summary.widget_count ?? widgets.length],
    ['证据', notes.length],
  ].map(([label, value]) => `
    <div class="command-semantic-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `).join('');

  renderDataRepresentationBlueprint(projection.data_representation, representationBox);
  renderPresentationBlueprint(projection.presentation_blueprint, presentationBox);

  layerBody.innerHTML = (projection.layers || []).length ? projection.layers.map(layer => `
    <tr>
      <td>${escapeHtml(layer.name || layer.id || '--')}</td>
      <td>${escapeHtml(layer.purpose || '--')}</td>
      <td>${Number(layer.item_count || 0).toLocaleString()}</td>
    </tr>
  `).join('') : renderSemanticTableEmpty(3);

  metricBody.innerHTML = metricGroups.length ? metricGroups.map(group => {
    const knownness = (group.knownness || []).map(item => semanticPill(semanticKnownnessLabel(item), `knownness-${item}`)).join('');
    const units = (group.units || []).map(item => semanticPill(item, 'unit')).join('');
    return `
      <tr>
        <td>
          <div class="command-semantic-name">${escapeHtml(group.name || group.id || '--')}</div>
          <div class="command-semantic-sub">${Number(group.count || 0).toLocaleString()} 个 Signal · ${knownness || '--'}</div>
        </td>
        <td>${escapeHtml(group.metric_role_label || group.metric_role || '--')}</td>
        <td>${escapeHtml(group.time_behavior_label || group.time_behavior || '--')}</td>
        <td>${escapeHtml(group.unit_family_label || group.unit_family || '--')}<div class="command-semantic-sub">${units || '--'}</div></td>
        <td>${escapeHtml(group.subject_type_label || group.subject_type || '--')}</td>
        <td>${semanticPill(semanticWidgetLabel(group.widget_hint), 'widget')}</td>
      </tr>
    `;
  }).join('') : renderSemanticTableEmpty(6);

  datasetBody.innerHTML = datasetGroups.length ? datasetGroups.map(group => {
    const windows = (group.allowed_windows || []).join(' / ');
    const sorts = (group.allowed_sort_by || []).slice(0, 4).join(' / ');
    const controls = [windows && `窗口 ${windows}`, sorts && `排序 ${sorts}`].filter(Boolean).join(' · ') || '--';
    return `
      <tr>
        <td>
          <div class="command-semantic-name">${escapeHtml(group.name || group.dataset_id || '--')}</div>
          <div class="command-semantic-sub">${escapeHtml(group.dataset_id || '--')} · ${Number(group.row_count || 0).toLocaleString()} 行</div>
        </td>
        <td>${escapeHtml(group.rows_subject_label || group.rows_subject_type || '--')}</td>
        <td>${escapeHtml(group.primary_metric_label || group.primary_metric_role || '--')}</td>
        <td>${semanticPill(group.primary_unit || '--', 'unit')}</td>
        <td>
          <div>${semanticPill(semanticWidgetLabel(group.widget_hint), 'widget')}</div>
          <div class="command-semantic-sub">${escapeHtml(controls)}</div>
        </td>
      </tr>
    `;
  }).join('') : renderSemanticTableEmpty(5);

  widgetBox.innerHTML = widgets.length ? widgets.map(widget => `
    <article class="command-widget-card">
      <div>
        <strong>${escapeHtml(widget.name || widget.id || '--')}</strong>
        <span>${escapeHtml(widget.id || '--')}</span>
      </div>
      <p>${escapeHtml(widget.purpose || '--')}</p>
      <small>${escapeHtml(widget.match || '--')}</small>
    </article>
  `).join('') : '<div class="command-semantic-empty">暂无 widget registry。</div>';

  evidenceBox.innerHTML = notes.length ? notes.map(note => `
    <div class="command-evidence-note ${escapeHtml(note.severity || 'info')}">
      <strong>${escapeHtml(note.severity || 'info')}</strong>
      <span>${escapeHtml(note.message || '--')}</span>
    </div>
  `).join('') : '<div class="command-semantic-empty">暂无证据风险；当前可见值均按语义分类。</div>';
}

function signalNumber(signals, path) {
  const signal = (signals || []).find(s => s.path === path);
  const value = Number(signal?.value);
  return Number.isFinite(value) ? value : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sumCommandModelStats(items) {
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const requests = nullableNumber(item.requests);
    const tokens = nullableNumber(item.total_tokens ?? item.tokens);
    const cost = nullableNumber(item.cost ?? item.cost_usd);
    const quota = nullableNumber(item.quota_used ?? item.quota);
    if (requests !== null) {
      acc.requests += requests;
      acc.requestsKnown = true;
    }
    if (tokens !== null) {
      acc.tokens += tokens;
      acc.tokensKnown = true;
    }
    if (cost !== null) {
      acc.cost += cost;
      acc.costKnown = true;
    }
    if (quota !== null) {
      acc.quota += quota;
      acc.quotaKnown = true;
    }
    return acc;
  }, { requests: 0, requestsKnown: false, tokens: 0, tokensKnown: false, cost: 0, costKnown: false, quota: 0, quotaKnown: false });
}

function semanticUnitFamily(unit) {
  const normalized = String(unit || '').toLowerCase();
  if (['usd', 'cny', 'eur', 'jpy'].includes(normalized)) return 'currency';
  if (['quota', 'credit'].includes(normalized)) return 'quota';
  if (['token', 'tokens'].includes(normalized)) return 'token';
  if (['count', 'request', 'requests'].includes(normalized)) return 'count';
  if (['percent', '%', 'ratio'].includes(normalized)) return 'ratio';
  if (['ms', 'latency'].includes(normalized)) return 'latency';
  if (['status', 'state'].includes(normalized)) return 'status';
  return normalized || 'mixed';
}

function normalizeSignalSemantics(signal = {}) {
  if (signal.semantics && typeof signal.semantics === 'object') return signal.semantics;
  const path = String(signal.path || signal.id || '').toLowerCase();
  const kind = String(signal.kind || '').toLowerCase();
  const value = nullableNumber(signal.value);
  const unit = String(signal.unit || 'count').toLowerCase();
  const metricRole = path.includes('available') || kind === 'balance'
    ? 'available'
    : path.includes('total') || path.includes('capacity')
      ? 'capacity'
      : kind === 'rate' || path.includes('rpm') || path.includes('tpm')
        ? 'rate'
        : kind === 'status' || path.includes('status') || path.includes('state')
          ? 'health'
          : 'used';
  const timeBehavior = kind === 'rate' || metricRole === 'rate'
    ? 'rate'
    : path.includes('today') || path.includes('window')
      ? 'window'
      : path.includes('total') || path.includes('aggregate')
        ? 'cumulative'
        : 'instant';
  const subjectType = path.includes('sub2api')
    ? 'api_key'
    : path.includes('newapi')
      ? 'account'
      : path.includes('project') || path.includes('workspace')
        ? 'workspace'
        : 'source';
  return {
    metric_role: metricRole,
    time_behavior: timeBehavior,
    unit,
    unit_family: semanticUnitFamily(unit),
    subject_type: subjectType,
    aggregation: metricRole === 'rate' ? 'avg' : 'latest',
    knownness: value === null ? 'unknown' : (value === 0 && signal.confidence === 'reported' && path.includes('.cost.') ? 'reported_zero' : 'known'),
  };
}

function semanticTrendRoleLabel(role) {
  return {
    health: '健康',
    capacity: '容量',
    available: '可用',
    used: '已用',
    rate: '速率',
    rank: '排行',
    evidence: '证据',
  }[role] || role || '--';
}

function semanticTrendTimeLabel(timeBehavior) {
  return {
    instant: '瞬时',
    window: '窗口',
    cumulative: '累计',
    rate: '速率',
    trend: '趋势',
    resetting: '周期',
  }[timeBehavior] || timeBehavior || '--';
}

function semanticTrendSubjectLabel(subjectType) {
  return {
    source: '来源',
    model: '模型',
    workspace: '工作区',
    account: '账户',
    api_key: 'API Key',
    device: '设备',
    task: '任务',
  }[subjectType] || subjectType || '--';
}

function semanticTrendMetricLabel(path, fallback = '') {
  const labels = {
    'agent.usage.cost.aggregate': '本地 Agent 成本',
    'agent.usage.tokens.total.aggregate': '工作区 Token',
    'agent.usage.projects.count': '工作区数量',
    'api.newapi.quota.total': '总额度',
    'api.newapi.quota.used': '已用额度',
    'api.newapi.quota.available': '可用额度',
    'api.newapi.requests.total': '累计请求',
    'api.newapi.usage.percent': '使用率',
    'api.sub2api.balance.available': '钱包余额',
    'api.sub2api.requests.today': '今日请求',
    'api.sub2api.tokens.today': '今日 Token',
    'api.sub2api.cost.today': '今日成本',
    'api.sub2api.requests.total': '累计请求',
    'api.sub2api.tokens.total': '累计 Token',
    'api.sub2api.cost.total': '累计成本',
    'derived.newapi.model.tokens': '模型 Token',
    'derived.newapi.model.quota': '模型额度',
    'derived.newapi.model.requests': '模型请求',
    'derived.sub2api.model.tokens': '模型 Token',
    'derived.sub2api.model.cost': '模型成本',
    'derived.sub2api.model.requests': '模型请求',
  };
  return labels[path] || fallback || path || '--';
}

function semanticTrendGroupRank(group) {
  const roleRank = { available: 0, used: 1, capacity: 2, rate: 3, health: 4, rank: 5, evidence: 6 };
  const unitRank = { currency: 0, quota: 1, token: 2, count: 3, ratio: 4, latency: 5, status: 6, mixed: 7 };
  return (roleRank[group.metricRole] ?? 9) * 100
    + (unitRank[group.unitFamily] ?? 9) * 10
    + String(group.source || '').localeCompare('') * 0;
}

function semanticTrendValueFormatter(sampleOrGroup) {
  const unit = String(sampleOrGroup?.unit || '').toLowerCase();
  const family = sampleOrGroup?.unitFamily || semanticUnitFamily(unit);
  if (family === 'currency' || unit === 'quota' || unit === 'credit') return value => formatUnitAmount(value, unit || 'quota');
  if (family === 'token') return fmtTokens;
  if (family === 'count') return value => Number(value || 0).toLocaleString();
  if (family === 'ratio') return value => `${Number(value || 0).toFixed(2)}%`;
  return value => formatUnitAmount(value, unit || 'count');
}

function deriveCommandSemanticExtension(sample = {}) {
  const path = String(sample.path || sample.seriesKey || '').toLowerCase();
  const source = String(sample.source || '').toLowerCase();
  const subjectType = String(sample.subjectType || 'source');
  const metricRole = String(sample.metricRole || 'used');
  const timeBehavior = String(sample.timeBehavior || 'instant');
  const unitFamily = String(sample.unitFamily || semanticUnitFamily(sample.unit));
  let extensionDomain = 'general_observation';
  let extensionLabel = '通用态势观察';

  if (path.includes('newapi') || path.includes('sub2api') || source.includes('newapi') || source.includes('sub2api')) {
    extensionDomain = 'agent_api_relay';
    extensionLabel = 'Agent/API 中转';
  } else if (path.includes('agent.usage') || source.includes('codex') || source.includes('claude') || source.includes('cc ')) {
    extensionDomain = 'local_agent_usage';
    extensionLabel = '本地 Agent 使用';
  } else if (subjectType === 'device') {
    extensionDomain = 'device_observation';
    extensionLabel = '设备态势';
  }

  if (subjectType === 'model') {
    extensionLabel = `${extensionLabel} · 模型用量`;
  } else if (subjectType === 'workspace') {
    extensionLabel = `${extensionLabel} · 工作区画像`;
  } else if (subjectType === 'api_key' || subjectType === 'account') {
    extensionLabel = `${extensionLabel} · 账户/Key`;
  }

  let presentationHint = '状态数值';
  if (metricRole === 'available' || metricRole === 'capacity') {
    presentationHint = '余量 / 容量趋势';
  } else if (metricRole === 'used' && timeBehavior === 'window') {
    presentationHint = '窗口消耗趋势';
  } else if (metricRole === 'used' && timeBehavior === 'cumulative') {
    presentationHint = '累计画像趋势';
  } else if (metricRole === 'rate' || timeBehavior === 'rate') {
    presentationHint = '速率趋势';
  } else if (unitFamily === 'ratio') {
    presentationHint = '比例趋势';
  }

  return { extensionDomain, extensionLabel, presentationHint };
}

function semanticTrendExtensionsLabel(group) {
  const labels = Array.isArray(group?.extensionLabels) ? group.extensionLabels : [group?.extensionLabel].filter(Boolean);
  return labels.length ? labels.join(' / ') : '';
}

function semanticTrendPresentationLabel(group) {
  const labels = Array.isArray(group?.presentationHints) ? group.presentationHints : [group?.presentationHint].filter(Boolean);
  return labels.length ? labels.join(' / ') : '';
}

function semanticTrendGroupSubtitle(group) {
  return [
    semanticTrendExtensionsLabel(group),
    semanticTrendPresentationLabel(group),
    semanticTrendSubjectLabel(group.subjectType),
    semanticTrendRoleLabel(group.metricRole),
    semanticTrendTimeLabel(group.timeBehavior),
    semanticTrendSourcesLabel(group),
    semanticTrendKnownnessLabel(group.knownness),
  ].filter(Boolean).join(' · ');
}

function sanitizeCommandSemanticSamples(samples) {
  return (Array.isArray(samples) ? samples : [])
    .map(sample => {
      const value = nullableNumber(sample?.value);
      if (value === null) return null;
      const unit = String(sample.unit || 'count').toLowerCase();
      const unitFamily = sample.unitFamily || semanticUnitFamily(unit);
      const metricRole = sample.metricRole || 'used';
      const timeBehavior = sample.timeBehavior || 'instant';
      const subjectType = sample.subjectType || 'source';
      const source = sample.source || 'unknown';
      const path = sample.path || sample.seriesKey || sample.label || '--';
      const groupKey = [
        metricRole,
        timeBehavior,
        unitFamily,
        unit,
        subjectType,
      ].join('|');
      const extension = deriveCommandSemanticExtension({
        ...sample,
        unit,
        unitFamily,
        metricRole,
        timeBehavior,
        subjectType,
        source,
        path,
      });
      return {
        groupKey,
        seriesKey: sample.seriesKey || path,
        label: sample.label || semanticTrendMetricLabel(path),
        groupLabel: sample.groupLabel || `${semanticTrendRoleLabel(metricRole)} · ${semanticTrendTimeLabel(timeBehavior)} · ${semanticTrendSubjectLabel(subjectType)}`,
        value,
        unit,
        unitFamily,
        metricRole,
        timeBehavior,
        subjectType,
        source,
        path,
        knownness: sample.knownness || 'known',
        extensionDomain: sample.extensionDomain || extension.extensionDomain,
        extensionLabel: sample.extensionLabel || extension.extensionLabel,
        presentationHint: sample.presentationHint || extension.presentationHint,
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

function buildCommandSemanticSamples(data) {
  const samples = [];
  const addSample = sample => {
    const [clean] = sanitizeCommandSemanticSamples([sample]);
    if (clean) samples.push(clean);
  };

  for (const signal of Array.isArray(data?.signals) ? data.signals : []) {
    const semantics = normalizeSignalSemantics(signal);
    if (semantics.knownness === 'unknown' || semantics.knownness === 'planned') continue;
    const value = nullableNumber(signal.value);
    if (value === null) continue;
    const unit = String(semantics.unit || signal.unit || 'count').toLowerCase();
    const source = signal.sourceId || signal.source_id || signal.subject || (
      String(signal.path || '').includes('newapi') ? 'NewAPI'
        : String(signal.path || '').includes('sub2api') ? 'Sub2API'
          : '本地 Agent'
    );
    addSample({
      value,
      unit,
      unitFamily: semantics.unit_family || semanticUnitFamily(unit),
      metricRole: semantics.metric_role,
      timeBehavior: semantics.time_behavior,
      subjectType: semantics.subject_type,
      source,
      path: signal.path || signal.id,
      seriesKey: signal.path || signal.id,
      label: semanticTrendMetricLabel(signal.path || signal.id),
      knownness: semantics.knownness,
    });
  }

  const newApiModels = sumCommandModelStats(data?.datasets?.newapi_model_stats);
  if (newApiModels.tokensKnown) {
    addSample({
      value: newApiModels.tokens,
      unit: 'token',
      unitFamily: 'token',
      metricRole: 'used',
      timeBehavior: 'cumulative',
      subjectType: 'model',
      source: 'NewAPI',
      path: 'derived.newapi.model.tokens',
      label: semanticTrendMetricLabel('derived.newapi.model.tokens'),
      knownness: 'derived',
    });
  }
  if (newApiModels.quotaKnown) {
    addSample({
      value: newApiModels.quota,
      unit: data?.datasets?.newapi_model_stats?.find?.(row => row?.quota_unit)?.quota_unit || 'quota',
      metricRole: 'used',
      timeBehavior: 'cumulative',
      subjectType: 'model',
      source: 'NewAPI',
      path: 'derived.newapi.model.quota',
      label: semanticTrendMetricLabel('derived.newapi.model.quota'),
      knownness: 'derived',
    });
  }
  if (newApiModels.requestsKnown) {
    addSample({
      value: newApiModels.requests,
      unit: 'count',
      metricRole: 'used',
      timeBehavior: 'cumulative',
      subjectType: 'model',
      source: 'NewAPI',
      path: 'derived.newapi.model.requests',
      label: semanticTrendMetricLabel('derived.newapi.model.requests'),
      knownness: 'derived',
    });
  }

  const sub2ApiModels = sumCommandModelStats(data?.datasets?.sub2api_model_stats);
  const sub2CostUnit = data?.datasets?.sub2api_model_stats?.find?.(row => row?.cost_unit)?.cost_unit || 'usd';
  if (sub2ApiModels.tokensKnown) {
    addSample({
      value: sub2ApiModels.tokens,
      unit: 'token',
      metricRole: 'used',
      timeBehavior: 'cumulative',
      subjectType: 'model',
      source: 'Sub2API',
      path: 'derived.sub2api.model.tokens',
      label: semanticTrendMetricLabel('derived.sub2api.model.tokens'),
      knownness: 'derived',
    });
  }
  if (sub2ApiModels.costKnown) {
    addSample({
      value: sub2ApiModels.cost,
      unit: sub2CostUnit,
      metricRole: 'used',
      timeBehavior: 'cumulative',
      subjectType: 'model',
      source: 'Sub2API',
      path: 'derived.sub2api.model.cost',
      label: semanticTrendMetricLabel('derived.sub2api.model.cost'),
      knownness: 'derived',
    });
  }
  if (sub2ApiModels.requestsKnown) {
    addSample({
      value: sub2ApiModels.requests,
      unit: 'count',
      metricRole: 'used',
      timeBehavior: 'cumulative',
      subjectType: 'model',
      source: 'Sub2API',
      path: 'derived.sub2api.model.requests',
      label: semanticTrendMetricLabel('derived.sub2api.model.requests'),
      knownness: 'derived',
    });
  }

  return sanitizeCommandSemanticSamples(samples);
}

function sanitizeCommandHistory(items) {
  const cutoff = Date.now() - COMMAND_HISTORY_WINDOW_MS;
  return (Array.isArray(items) ? items : [])
    .filter(p => Number.isFinite(Number(p.ts)) && Number(p.ts) >= cutoff)
    .map(p => ({
      ts: Number(p.ts),
      cost: nullableNumber(p.cost),
      tokens: nullableNumber(p.tokens),
      projects: nullableNumber(p.projects),
      sourcesOk: Number(p.sourcesOk || 0),
      sourcesTotal: Number(p.sourcesTotal || 0),
      apiQuotaAvailable: nullableNumber(p.apiQuotaAvailable),
      apiQuotaUsed: nullableNumber(p.apiQuotaUsed),
      apiQuotaTotal: nullableNumber(p.apiQuotaTotal),
      apiUsagePercent: nullableNumber(p.apiUsagePercent),
      apiQuotaUnit: typeof p.apiQuotaUnit === 'string' ? p.apiQuotaUnit : 'quota',
      sub2ApiBalance: nullableNumber(p.sub2ApiBalance),
      sub2ApiTodayTokens: nullableNumber(p.sub2ApiTodayTokens),
      sub2ApiTodayCost: nullableNumber(p.sub2ApiTodayCost),
      sub2ApiTotalCost: nullableNumber(p.sub2ApiTotalCost),
      sub2ApiUnit: typeof p.sub2ApiUnit === 'string' ? p.sub2ApiUnit : 'usd',
      sub2ApiBalanceUnit: typeof p.sub2ApiBalanceUnit === 'string'
        ? p.sub2ApiBalanceUnit
        : (typeof p.sub2ApiUnit === 'string' ? p.sub2ApiUnit : 'usd'),
      sub2ApiCostUnit: typeof p.sub2ApiCostUnit === 'string'
        ? p.sub2ApiCostUnit
        : (typeof p.sub2ApiUnit === 'string' ? p.sub2ApiUnit : 'usd'),
      sub2ApiModelCostUnit: typeof p.sub2ApiModelCostUnit === 'string'
        ? p.sub2ApiModelCostUnit
        : (
            typeof p.sub2ApiCostUnit === 'string'
              ? p.sub2ApiCostUnit
              : (typeof p.sub2ApiUnit === 'string' ? p.sub2ApiUnit : 'usd')
          ),
      newApiModelTokens: nullableNumber(p.newApiModelTokens),
      newApiModelQuota: nullableNumber(p.newApiModelQuota ?? p.newApiModelCost),
      newApiModelRequests: nullableNumber(p.newApiModelRequests),
      sub2ApiModelTokens: nullableNumber(p.sub2ApiModelTokens),
      sub2ApiModelCost: nullableNumber(p.sub2ApiModelCost),
      sub2ApiModelRequests: nullableNumber(p.sub2ApiModelRequests),
      semanticSamples: sanitizeCommandSemanticSamples(p.semanticSamples),
    }))
    .slice(-MAX_COMMAND_HISTORY_PTS);
}

function recordCommandSnapshot(data) {
  const signals = data?.signals || [];
  const cost = signalNumber(signals, 'agent.usage.cost.aggregate');
  const tokens = signalNumber(signals, 'agent.usage.tokens.total.aggregate');
  const projects = signalNumber(signals, 'agent.usage.projects.count');
  const apiQuotaAvailableSignal = signals.find(s => s.path === 'api.newapi.quota.available');
  const apiQuotaUsedSignal = signals.find(s => s.path === 'api.newapi.quota.used');
  const apiQuotaTotalSignal = signals.find(s => s.path === 'api.newapi.quota.total');
  const apiQuotaAvailable = signalNumber(signals, 'api.newapi.quota.available');
  const apiQuotaUsed = signalNumber(signals, 'api.newapi.quota.used');
  const apiQuotaTotal = signalNumber(signals, 'api.newapi.quota.total');
  const apiUsagePercent = signalNumber(signals, 'api.newapi.usage.percent');
  const sub2ApiBalanceSignal = signals.find(s => s.path === 'api.sub2api.balance.available');
  const sub2ApiTodayCostSignal = signals.find(s => s.path === 'api.sub2api.cost.today');
  const sub2ApiTotalCostSignal = signals.find(s => s.path === 'api.sub2api.cost.total');
  const sub2ApiBalance = signalNumber(signals, 'api.sub2api.balance.available');
  const sub2ApiTodayTokens = signalNumber(signals, 'api.sub2api.tokens.today');
  const sub2ApiTodayCost = signalNumber(signals, 'api.sub2api.cost.today');
  const sub2ApiTotalCost = signalNumber(signals, 'api.sub2api.cost.total');
  const newApiModels = sumCommandModelStats(data?.datasets?.newapi_model_stats);
  const sub2ApiModels = sumCommandModelStats(data?.datasets?.sub2api_model_stats);
  const sub2ApiModelCostRow = (Array.isArray(data?.datasets?.sub2api_model_stats) ? data.datasets.sub2api_model_stats : [])
    .find(row => nullableNumber(row?.cost ?? row?.cost_usd) !== null && typeof row?.cost_unit === 'string');
  const sub2ApiBalanceUnit = sub2ApiBalanceSignal?.unit || 'usd';
  const sub2ApiCostUnit = sub2ApiTodayCostSignal?.unit || sub2ApiTotalCostSignal?.unit || 'usd';
  const sub2ApiModelCostUnit = sub2ApiModelCostRow?.cost_unit || sub2ApiCostUnit;
  const sources = data?.sources || [];
  const counts = data?.source_counts || {};
  if (cost === null && tokens === null && projects === null && sources.length === 0) return;

  const generated = Date.parse(data?.generated_at || '');
  const point = {
    ts: Number.isFinite(generated) ? generated : Date.now(),
    cost,
    tokens,
    projects,
    sourcesOk: counts.ok || 0,
    sourcesTotal: sources.length || 0,
    apiQuotaAvailable,
    apiQuotaUsed,
    apiQuotaTotal,
    apiUsagePercent,
    apiQuotaUnit: apiQuotaAvailableSignal?.unit || apiQuotaUsedSignal?.unit || apiQuotaTotalSignal?.unit || 'quota',
    sub2ApiBalance,
    sub2ApiTodayTokens,
    sub2ApiTodayCost,
    sub2ApiTotalCost,
    sub2ApiUnit: sub2ApiCostUnit,
    sub2ApiBalanceUnit,
    sub2ApiCostUnit,
    sub2ApiModelCostUnit,
    newApiModelTokens: newApiModels.tokensKnown ? newApiModels.tokens : null,
    newApiModelQuota: newApiModels.quotaKnown ? newApiModels.quota : null,
    newApiModelRequests: newApiModels.requestsKnown ? newApiModels.requests : null,
    sub2ApiModelTokens: sub2ApiModels.tokensKnown ? sub2ApiModels.tokens : null,
    sub2ApiModelCost: sub2ApiModels.costKnown ? sub2ApiModels.cost : null,
    sub2ApiModelRequests: sub2ApiModels.requestsKnown ? sub2ApiModels.requests : null,
    semanticSamples: buildCommandSemanticSamples(data),
  };

  const history = sanitizeCommandHistory(commandHistoryStorage);
  const last = history.at(-1);
  if (last && Math.abs(point.ts - last.ts) < 30_000) {
    history[history.length - 1] = point;
  } else {
    history.push(point);
  }
  commandHistoryStorage = sanitizeCommandHistory(history);
  localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(commandHistoryStorage));
}

function buildSemanticTrendGroups(history) {
  const groups = new Map();
  for (const point of history) {
    for (const sample of sanitizeCommandSemanticSamples(point.semanticSamples)) {
      const group = groups.get(sample.groupKey) || {
        key: sample.groupKey,
        label: sample.groupLabel,
        metricRole: sample.metricRole,
        timeBehavior: sample.timeBehavior,
        unit: sample.unit,
        unitFamily: sample.unitFamily,
        subjectType: sample.subjectType,
        source: sample.source,
        sources: new Set(),
        knownness: new Set(),
        extensionDomains: new Set(),
        extensionLabels: new Set(),
        presentationHints: new Set(),
        series: new Map(),
        latestAt: 0,
        latestValue: null,
      };
      const seriesKey = `${sample.source || 'unknown'}|${sample.seriesKey}`;
      const series = group.series.get(seriesKey) || {
        key: seriesKey,
        name: `${sample.source || 'unknown'} · ${sample.label || sample.seriesKey}`,
        path: sample.path,
        data: [],
      };
      series.data.push([point.ts, sample.value]);
      group.series.set(seriesKey, series);
      group.sources.add(sample.source || 'unknown');
      group.knownness.add(sample.knownness || 'known');
      group.extensionDomains.add(sample.extensionDomain || 'general_observation');
      group.extensionLabels.add(sample.extensionLabel || '通用态势观察');
      group.presentationHints.add(sample.presentationHint || '状态数值');
      if (point.ts >= group.latestAt) {
        group.latestAt = point.ts;
        group.latestValue = sample.value;
      }
      groups.set(sample.groupKey, group);
    }
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      sources: [...group.sources].sort((a, b) => String(a).localeCompare(String(b))),
      knownness: [...group.knownness].sort((a, b) => String(a).localeCompare(String(b))),
      extensionDomains: [...group.extensionDomains].sort((a, b) => String(a).localeCompare(String(b))),
      extensionLabels: [...group.extensionLabels].sort((a, b) => String(a).localeCompare(String(b))),
      presentationHints: [...group.presentationHints].sort((a, b) => String(a).localeCompare(String(b))),
    }))
    .filter(group => [...group.series.values()].some(series => series.data.length))
    .sort((a, b) => semanticTrendGroupRank(a) - semanticTrendGroupRank(b) || String(a.label).localeCompare(String(b.label)));
}

function filterCommandTrendHistoryByWindow(history, windowKey) {
  const option = COMMAND_TREND_WINDOW_OPTIONS[windowKey] || COMMAND_TREND_WINDOW_OPTIONS['6h'];
  const safeHistory = sanitizeCommandHistory(history);
  if (!safeHistory.length) return [];
  const maxTs = Math.max(...safeHistory.map(point => Number(point.ts) || 0));
  const cutoff = maxTs - option.ms;
  return safeHistory.filter(point => Number(point.ts) >= cutoff);
}

function semanticTrendGroupMatchesDimensionFilter(group, filter = commandDimensionTrendFilter) {
  if (!group) return false;
  if (filter === 'all') return true;
  if (filter === 'reserve') return ['available', 'capacity'].includes(group.metricRole);
  if (filter === 'usage') return group.metricRole === 'used';
  if (filter === 'ratio') return group.unitFamily === 'ratio' || group.metricRole === 'rate' || group.timeBehavior === 'rate';
  if (filter === 'relay') {
    return (group.extensionDomains || []).includes('agent_api_relay')
      || (group.sources || []).some(source => /newapi|sub2api/i.test(String(source || '')));
  }
  if (filter === 'local') {
    return (group.extensionDomains || []).includes('local_agent_usage')
      || (group.sources || []).some(source => /claude|codex|cc switch|本地/i.test(String(source || '')));
  }
  return true;
}

function semanticTrendDerivationStats(groups = []) {
  const countBy = pick => {
    const map = new Map();
    for (const group of groups) {
      const value = pick(group) || '--';
      map.set(value, (map.get(value) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, 5)
      .map(([label, count]) => `${label} ${count}`)
      .join(' / ') || '--';
  };
  return {
    units: countBy(group => (group.unit || group.unitFamily || '').toUpperCase()),
    roles: countBy(group => semanticTrendRoleLabel(group.metricRole)),
    subjects: countBy(group => semanticTrendSubjectLabel(group.subjectType)),
    domains: countBy(group => semanticTrendExtensionsLabel(group)),
  };
}

function renderCommandDimensionDerivationSummary(allGroups, visibleGroups, history) {
  const box = document.getElementById('command-dimension-derivation');
  const windowLabel = document.getElementById('command-trend-window');
  if (windowLabel) {
    const option = COMMAND_TREND_WINDOW_OPTIONS[commandDimensionTrendWindow] || COMMAND_TREND_WINDOW_OPTIONS['6h'];
    windowLabel.textContent = `${option.label} · ${COMMAND_DIMENSION_TREND_FILTERS[commandDimensionTrendFilter]?.label || '全部'}`;
  }
  if (!box) return;

  const stats = semanticTrendDerivationStats(allGroups);
  const visibleStats = semanticTrendDerivationStats(visibleGroups);
  const filterNote = COMMAND_DIMENSION_TREND_FILTERS[commandDimensionTrendFilter]?.note || '';
  box.innerHTML = `
    <div class="command-dimension-rule">
      <span>分图内涵</span>
      <strong>角色 + 时间行为 + 单位 + 对象</strong>
      <small>已用、可用、容量、速率分开；USD、Token、次数、比例不共轴。</small>
    </div>
    <div class="command-dimension-rule">
      <span>曲线外延</span>
      <strong>来源 + Signal Path</strong>
      <small>NewAPI、Sub2API、本地 Agent 作为曲线和证据，而不是默认先分来源。</small>
    </div>
    <div class="command-dimension-rule">
      <span>当前派生</span>
      <strong>${Number(visibleGroups.length).toLocaleString()} / ${Number(allGroups.length).toLocaleString()} 组</strong>
      <small>${Number(history.length).toLocaleString()} 个快照 · ${escapeHtml(filterNote)}</small>
    </div>
    <div class="command-dimension-rule">
      <span>量纲画像</span>
      <strong>${escapeHtml(visibleStats.units)}</strong>
      <small>全集: ${escapeHtml(stats.units)} · 角色: ${escapeHtml(visibleStats.roles)} · 对象: ${escapeHtml(visibleStats.subjects)}</small>
    </div>
  `;
}

function semanticTrendKnownnessLabel(knownness) {
  const labels = {
    known: '已知',
    derived: '推导',
    reported_zero: '报告为 0',
    unknown: '未知',
    planned: '计划接入',
  };
  const items = Array.isArray(knownness)
    ? knownness
    : knownness instanceof Set
      ? [...knownness]
      : [knownness].filter(Boolean);
  return items.map(item => labels[item] || item).filter(Boolean).join(' / ') || '已知';
}

function semanticTrendSourcesLabel(group) {
  const sources = Array.isArray(group?.sources) ? group.sources : [group?.source].filter(Boolean);
  return sources.length ? sources.join(' / ') : '来源待识别';
}

function semanticTrendChartDomId(prefix, key) {
  return `${prefix}-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function disposeMissingTrendCharts(chartMap, groupKeys) {
  const keep = new Set(groupKeys);
  for (const [key, chart] of chartMap.entries()) {
    if (keep.has(key)) continue;
    chart?.dispose?.();
    chartMap.delete(key);
  }
}

function renderSemanticTrendGrid({
  gridId,
  noteId,
  chartMap,
  chartIdPrefix,
  groups,
  emptyText,
  noteText,
}) {
  const grid = document.getElementById(gridId);
  const note = document.getElementById(noteId);
  if (!grid) return;

  disposeMissingTrendCharts(chartMap, groups.map(group => group.key));
  if (!groups.length) {
    for (const chart of chartMap.values()) chart?.dispose?.();
    chartMap.clear();
    grid.innerHTML = `<div class="command-semantic-empty">${escapeHtml(emptyText || '等待语义采样。')}</div>`;
    if (note) note.textContent = noteText || '语义趋势不会把 USD、Token、次数、比例混在同一轴，也不会把 unknown 当作 0。';
    return;
  }

  for (const chart of chartMap.values()) chart?.dispose?.();
  chartMap.clear();
  grid.innerHTML = groups.map(group => `
    <section class="command-semantic-trend-card" data-semantic-trend-key="${escapeHtml(group.key)}">
      <div class="command-semantic-trend-head">
        <div>
          <strong>${escapeHtml(group.label || group.groupLabel || '--')}</strong>
          <span>${escapeHtml(semanticTrendGroupSubtitle(group))}</span>
        </div>
        <small>${escapeHtml((group.unit || group.unitFamily || '--').toUpperCase())}</small>
      </div>
      <div class="command-semantic-trend-chart" id="${escapeHtml(semanticTrendChartDomId(chartIdPrefix, group.key))}" role="img" aria-label="${escapeHtml(group.label || group.groupLabel || '语义趋势图')}"></div>
    </section>
  `).join('');

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';
  const palette = COMMAND_MODEL_COLORS;
  for (const group of groups) {
    const elementId = semanticTrendChartDomId(chartIdPrefix, group.key);
    const element = document.getElementById(elementId);
    if (!element) continue;
    let trendChart = chartMap.get(group.key);
    if (!trendChart || trendChart.isDisposed?.()) {
      trendChart = echarts.init(element, null, { renderer: 'canvas' });
      chartMap.set(group.key, trendChart);
    }
    const formatValue = semanticTrendValueFormatter(group);
    const series = [...group.series.values()].map((item, idx) => ({
      name: item.name,
      type: 'line',
      smooth: true,
      symbol: item.data.length <= 12 ? 'circle' : 'none',
      lineStyle: { color: palette[idx % palette.length], width: 2 },
      itemStyle: { color: palette[idx % palette.length] },
      emphasis: { focus: 'series' },
      data: item.data,
    }));
    trendChart.setOption({
      backgroundColor: 'transparent',
      color: palette,
      textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
      grid: { left: 74, right: 24, top: 34, bottom: 28 },
      legend: {
        type: 'scroll',
        top: 0,
        left: 0,
        right: 0,
        textStyle: { color: textColor, fontSize: 10 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#21262d' : '#f6f8fa',
        borderColor: isDark ? '#30363d' : '#d0d7de',
        textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
        formatter: params => {
          const t = new Date(params[0]?.value?.[0] || params[0]?.axisValue).toLocaleString('zh-CN');
          const rows = params.map(p => `${p.marker}${escapeHtml(p.seriesName)}: <b>${formatValue(p.value?.[1] ?? p.value)}</b>`);
          return `${rows.join('<br>')}<div style="color:${textColor};font-size:10px;margin-top:4px">${t}</div>`;
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } },
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: group.unit || group.unitFamily,
        nameTextStyle: { color: textColor, fontSize: 10 },
        axisLabel: { color: textColor, fontSize: 10, formatter: v => formatValue(v) },
        splitLine: { lineStyle: { color: splitColor } },
      },
      series,
    }, { notMerge: true });
  }

  if (note) note.textContent = noteText || `${groups.length} 个语义趋势组；每组独立 y 轴，避免不同数量级互相压扁。`;
}

function isCommandDimensionTrendGroup(group) {
  const roleOk = ['used', 'available', 'capacity', 'rate'].includes(group.metricRole);
  const unitOk = ['currency', 'quota', 'token', 'count', 'ratio'].includes(group.unitFamily);
  const timeOk = !['health', 'evidence', 'rank'].includes(group.metricRole);
  return roleOk && unitOk && timeOk;
}

function renderCommandDimensionTrend(history, context = {}) {
  const windowedHistory = filterCommandTrendHistoryByWindow(history, commandDimensionTrendWindow);
  const allGroups = buildSemanticTrendGroups(windowedHistory)
    .filter(isCommandDimensionTrendGroup);
  const groups = allGroups
    .filter(group => semanticTrendGroupMatchesDimensionFilter(group))
    .slice(0, 10);
  renderCommandDimensionDerivationSummary(allGroups, groups, windowedHistory);
  const units = [...new Set(groups.map(group => group.unit || group.unitFamily).filter(Boolean))].join(' / ');
  const sources = [...new Set(groups.flatMap(group => group.sources || []))].join(' / ');
  const windowOption = COMMAND_TREND_WINDOW_OPTIONS[commandDimensionTrendWindow] || COMMAND_TREND_WINDOW_OPTIONS['6h'];
  const filterLabel = COMMAND_DIMENSION_TREND_FILTERS[commandDimensionTrendFilter]?.label || '全部';
  const remote = [
    context.hasApiQuota ? 'NewAPI' : null,
    context.hasSub2Api ? 'Sub2API' : null,
  ].filter(Boolean).join(' + ') || '远端额度等待可用 key';
  const noteText = windowedHistory.length < 2
    ? '已开始记录当前浏览器的语义快照；第二次刷新后会形成走势。分图键为角色、时间行为、单位、对象，来源作为曲线。'
    : `${windowOption.label} · ${filterLabel} · ${windowedHistory.length} 个快照 · ${groups.length}/${allGroups.length} 个语义组 · ${remote} · 单位 ${units || '--'} · 来源 ${sources || '--'}；unknown 跳过，reported_zero 保留为 0，本地缓存最多 ${MAX_COMMAND_HISTORY_PTS} 个快照。`;
  renderSemanticTrendGrid({
    gridId: 'command-dimension-trend-grid',
    noteId: 'command-trend-note',
    chartMap: commandDimensionTrendCharts,
    chartIdPrefix: 'dimension-trend',
    groups,
    emptyText: '等待语义采样；刷新后会按角色、时间、单位和对象自动分图。',
    noteText,
  });
}

function renderCommandSemanticTrend() {
  const history = filterCommandTrendHistoryByWindow(commandHistoryStorage, commandDimensionTrendWindow);
  const groups = buildSemanticTrendGroups(history).slice(0, 12);
  const units = [...new Set(groups.map(group => group.unit || group.unitFamily).filter(Boolean))].join(' / ');
  const windowOption = COMMAND_TREND_WINDOW_OPTIONS[commandDimensionTrendWindow] || COMMAND_TREND_WINDOW_OPTIONS['6h'];
  renderSemanticTrendGrid({
    gridId: 'command-semantic-trend-grid',
    noteId: 'command-semantic-trend-note',
    chartMap: commandSemanticTrendCharts,
    chartIdPrefix: 'semantic-trend',
    groups,
    emptyText: '等待语义采样；刷新后会按角色、窗口、单位和对象自动分图。',
    noteText: groups.length
      ? `${windowOption.label} · ${history.length} 个快照 · ${groups.length} 个语义趋势组 · 单位 ${units || '--'}；每组独立 y 轴，避免不同数量级互相压扁。`
      : '语义趋势不会把 USD、Token、次数、比例混在同一轴，也不会把 unknown 当作 0。',
  });
}

function relaySourceLabelFromSample(sample) {
  const source = String(sample?.source || '');
  const path = String(sample?.path || '').toLowerCase();
  if (source.toLowerCase().includes('newapi') || path.includes('newapi')) return 'NewAPI';
  if (source.toLowerCase().includes('sub2api') || path.includes('sub2api')) return 'Sub2API';
  return source || '中转来源';
}

function relaySourceRankFromLabel(label) {
  if (label === 'NewAPI') return 0;
  if (label === 'Sub2API') return 1;
  return 9;
}

function isRelaySemanticSample(sample) {
  const source = String(sample?.source || '').toLowerCase();
  const path = String(sample?.path || '').toLowerCase();
  return source.includes('newapi')
    || source.includes('sub2api')
    || path.includes('newapi')
    || path.includes('sub2api');
}

function relayTrendMetricKey(sample) {
  const path = String(sample?.path || '');
  const pathMetric = relayMetricFromPath(path);
  if (pathMetric) return pathMetric;
  if (path.includes('model.tokens')) return 'model_tokens';
  if (path.includes('model.cost')) return 'model_cost';
  if (path.includes('model.quota')) return 'model_quota';
  if (path.includes('model.requests')) return 'model_requests';
  return sample?.label || path || 'metric';
}

function relayTrendGroupSpec(sample, view = commandRelayView) {
  const relaySource = relaySourceLabelFromSample(sample);
  const metricKey = relayTrendMetricKey(sample);
  const metricLabel = relayMetricLabel(metricKey) || sample.label || semanticTrendMetricLabel(sample.path);
  if (view === 'metric') {
    return {
      key: [
        'relay-metric',
        metricKey,
        sample.metricRole,
        sample.timeBehavior,
        sample.unitFamily,
        sample.unit,
        sample.subjectType,
      ].join('|'),
      label: metricLabel,
      seriesKey: `${relaySource}|${sample.seriesKey || sample.path || metricKey}`,
      seriesName: relaySource,
      relaySource,
      relayMetric: metricKey,
    };
  }
  return {
    key: [
      'relay-source',
      relaySource,
      sample.metricRole,
      sample.timeBehavior,
      sample.unitFamily,
      sample.unit,
      sample.subjectType,
    ].join('|'),
    label: `${relaySource} · ${semanticTrendRoleLabel(sample.metricRole)} · ${semanticTrendTimeLabel(sample.timeBehavior)}`,
    seriesKey: `${metricKey}|${sample.seriesKey || sample.path || relaySource}`,
    seriesName: metricLabel,
    relaySource,
    relayMetric: metricKey,
  };
}

function buildRelayTrendGroups(history, view = commandRelayView) {
  const groups = new Map();
  for (const point of history) {
    for (const sample of sanitizeCommandSemanticSamples(point.semanticSamples).filter(isRelaySemanticSample)) {
      const spec = relayTrendGroupSpec(sample, view);
      const group = groups.get(spec.key) || {
        key: spec.key,
        label: spec.label,
        metricRole: sample.metricRole,
        timeBehavior: sample.timeBehavior,
        unit: sample.unit,
        unitFamily: sample.unitFamily,
        subjectType: sample.subjectType,
        source: spec.relaySource,
        relaySource: spec.relaySource,
        relayMetric: spec.relayMetric,
        sources: new Set(),
        knownness: new Set(),
        extensionDomains: new Set(),
        extensionLabels: new Set(),
        presentationHints: new Set(),
        series: new Map(),
        latestAt: 0,
        latestValue: null,
      };
      const series = group.series.get(spec.seriesKey) || {
        key: spec.seriesKey,
        name: spec.seriesName,
        path: sample.path,
        data: [],
      };
      series.data.push([point.ts, sample.value]);
      group.series.set(spec.seriesKey, series);
      group.sources.add(spec.relaySource);
      group.knownness.add(sample.knownness || 'known');
      group.extensionDomains.add(sample.extensionDomain || 'agent_api_relay');
      group.extensionLabels.add(sample.extensionLabel || 'Agent/API 中转');
      group.presentationHints.add(sample.presentationHint || '状态数值');
      if (point.ts >= group.latestAt) {
        group.latestAt = point.ts;
        group.latestValue = sample.value;
      }
      groups.set(spec.key, group);
    }
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      sources: [...group.sources].sort((a, b) => relaySourceRankFromLabel(a) - relaySourceRankFromLabel(b) || String(a).localeCompare(String(b))),
      knownness: [...group.knownness].sort((a, b) => String(a).localeCompare(String(b))),
      extensionDomains: [...group.extensionDomains].sort((a, b) => String(a).localeCompare(String(b))),
      extensionLabels: [...group.extensionLabels].sort((a, b) => String(a).localeCompare(String(b))),
      presentationHints: [...group.presentationHints].sort((a, b) => String(a).localeCompare(String(b))),
    }))
    .filter(group => [...group.series.values()].some(series => series.data.length))
    .sort((a, b) =>
      relaySourceRankFromLabel(a.relaySource) - relaySourceRankFromLabel(b.relaySource)
      || relayMetricRank(a.relayMetric) - relayMetricRank(b.relayMetric)
      || semanticTrendGroupRank(a) - semanticTrendGroupRank(b)
      || String(a.label).localeCompare(String(b.label))
    );
}

function renderCommandRelayTrend(history, context = {}) {
  const windowedHistory = filterCommandTrendHistoryByWindow(history, commandDimensionTrendWindow);
  const groups = buildRelayTrendGroups(windowedHistory, commandRelayView).slice(0, 12);
  const viewLabel = commandRelayView === 'metric' ? '按类型看中转站' : '按中转站看类型';
  const windowOption = COMMAND_TREND_WINDOW_OPTIONS[commandDimensionTrendWindow] || COMMAND_TREND_WINDOW_OPTIONS['6h'];
  const relaySources = [
    (context.hasApiQuota || context.hasNewApiModels) ? 'NewAPI' : null,
    (context.hasSub2Api || context.hasSub2ApiModels) ? 'Sub2API' : null,
  ].filter(Boolean).join(' / ') || '等待 NewAPI / Sub2API 采样';
  const units = [...new Set(groups.map(group => group.unit || group.unitFamily).filter(Boolean))].join(' / ');
  const noteText = groups.length
    ? `${viewLabel} · ${windowOption.label} · ${windowedHistory.length} 个快照 · ${groups.length} 个中转语义组 · ${relaySources} · 单位 ${units || '--'}；余额、可用、已用、成本、Token、请求独立分组，不共轴。`
    : `${viewLabel} · 等待 NewAPI / Sub2API 采样；采到数据后会按语义角色、时间行为、单位和对象自动分图。`;
  renderSemanticTrendGrid({
    gridId: 'command-relay-trend-grid',
    noteId: 'command-relay-trend-note',
    chartMap: commandRelayTrendCharts,
    chartIdPrefix: commandRelayView === 'metric' ? 'relay-metric-trend' : 'relay-source-trend',
    groups,
    emptyText: '等待 NewAPI / Sub2API 语义采样。',
    noteText,
  });
}

function renderCommandTrend() {
  const history = sanitizeCommandHistory(commandHistoryStorage);
  const hasApiQuota = history.some(p => p.apiQuotaAvailable !== null || p.apiQuotaUsed !== null);
  const hasNewApiModels = history.some(p =>
    p.newApiModelTokens !== null || p.newApiModelQuota !== null || p.newApiModelRequests !== null
  );
  const hasSub2Api = history.some(p =>
    p.sub2ApiBalance !== null || p.sub2ApiTodayTokens !== null || p.sub2ApiTodayCost !== null || p.sub2ApiTotalCost !== null
  );
  const hasSub2ApiModels = history.some(p =>
    p.sub2ApiModelTokens !== null || p.sub2ApiModelCost !== null || p.sub2ApiModelRequests !== null
  );
  renderCommandDimensionTrend(history, { hasApiQuota, hasSub2Api });
  renderCommandRelayTrend(history, { hasApiQuota, hasNewApiModels, hasSub2Api, hasSub2ApiModels });
  renderCommandSemanticTrend();
}

function renderCommandModelChart(modelRows) {
  if (!commandModelChart) return;
  const note = document.getElementById('command-model-note');
  const sortLabel = document.getElementById('command-model-chart-sort');
  const chartRows = commandModelSort === 'cost'
    ? (modelRows || []).filter(row => row.costKnown && row.costComparable)
    : (modelRows || []);
  const sorted = sortCommandModelRows(chartRows).slice(0, 8);
  const top = [...sorted].reverse();
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';
  const axisLabel = commandModelSort === 'tokens'
    ? 'Token'
    : commandModelSort === 'requests'
      ? '请求'
      : 'USD';
  const valueOf = row => {
    if (commandModelSort === 'tokens') return row.tokens || 0;
    if (commandModelSort === 'requests') return row.requests || 0;
    return row.cost || 0;
  };
  const valueFmt = value => {
    if (commandModelSort === 'tokens') return fmtTokens(value);
    if (commandModelSort === 'requests') return Number(value || 0).toLocaleString();
    return fmtUsd(value);
  };
  const chartTitle = COMMAND_MODEL_SORT_LABELS[commandModelSort] || '成本优先';

  if (sortLabel) sortLabel.textContent = chartTitle;

  if (note) {
    const sourceCount = new Set((modelRows || []).flatMap(row => row.sources || [])).size;
    const comparableCostCount = (modelRows || []).filter(row => row.costKnown && row.costComparable).length;
    note.textContent = top.length
      ? `当前聚合快照 · ${sourceCount} 个来源 · Top ${top.length} 模型 · ${chartTitle}。`
      : commandModelSort === 'cost'
        ? `暂无可比较 USD 成本；可切换 Token/请求排序。当前 ${sourceCount} 个来源中 ${comparableCostCount} 个模型有可比较成本。`
        : '暂无模型分布数据。';
  }

  commandModelChart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    grid: { left: 118, right: 28, top: 12, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      formatter: params => {
        const model = params[0].name;
        const source = top[params[0].dataIndex];
        const value = valueFmt(params[0].value);
        const tokens = source ? fmtTokens(source.tokens || 0) : '--';
        const cost = source?.costKnown ? formatUnitAmount(source.cost, source.costUnit || 'usd') : '--';
        const quota = source?.quotaKnown ? formatUnitAmount(source.quota, source.quotaUnit || 'quota') : '--';
        const requests = source?.requestKnown ? Number(source.requests || 0).toLocaleString() : '--';
        const sources = source?.sources?.join(' / ') || '--';
        return `${escapeHtml(model)}<br>${params[0].marker}${escapeHtml(chartTitle)}: <b>${value}</b><br><span style="color:${textColor}">来源: ${escapeHtml(sources)}<br>成本: ${cost}<br>额度: ${quota}<br>Token: ${tokens}<br>请求: ${requests}</span>`;
      },
    },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: textColor, fontSize: 10, formatter: v => valueFmt(v) },
      name: axisLabel,
      nameTextStyle: { color: textColor, fontSize: 10 },
      splitLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: 'category',
      data: top.map(m => m.model || '--'),
      axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } },
      axisLabel: { color: textColor, fontSize: 10, width: 104, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      data: top.map(m => valueOf(m)),
      barMaxWidth: 18,
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: p => COMMAND_MODEL_COLORS[p.dataIndex % COMMAND_MODEL_COLORS.length],
      },
    }],
  }, { notMerge: true });
}

function renderCommandModelTrend(datasets) {
  const trends = datasets?.model_trends || {};
  const trend = trends[commandModelTrendWindow]
    || datasets?.model_daily_trend
    || trends['7d']
    || trends['1d']
    || trends['6h'];
  document.querySelectorAll('.command-model-trend-window-btn').forEach(btn => {
    const active = btn.dataset.modelTrendWindow === commandModelTrendWindow;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderCommandModelDailyTrend(trend);
}

function renderCommandModelDailyTrend(trend) {
  if (!commandModelTrendChart) return;
  const note = document.getElementById('command-model-trend-note');
  const windowLabel = document.getElementById('command-model-trend-window');
  const rows = Array.isArray(trend?.rows) ? trend.rows : [];
  const buckets = Array.isArray(trend?.x)
    ? trend.x
    : Array.isArray(trend?.days)
      ? trend.days
      : [];
  const topModels = Array.isArray(trend?.models) ? trend.models.slice(0, 6).map(m => m.model) : [];
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';
  const fallbackWindow = COMMAND_MODEL_TREND_LABELS[commandModelTrendWindow] || '近 7 天';
  const trendWindow = trend?.window_label || fallbackWindow;
  const bucketLabel = trend?.bucket_label ? `${trend.bucket_label}粒度` : '按数据源粒度';
  const axisFormatter = value => {
    const text = String(value || '');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) return text.slice(11, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(5);
    return text;
  };

  if (windowLabel) windowLabel.textContent = trendWindow;
  if (!rows.length || !buckets.length || !topModels.length) {
    if (note) note.textContent = `${trendWindow}暂无可用模型趋势数据；当前来源仍以 CC Switch 请求日志为主。`;
    commandModelTrendChart.clear();
    return;
  }

  const rowBucket = row => row.bucket || row.date;
  const byKey = new Map(rows.map(row => [`${rowBucket(row)}::${row.model}`, row]));
  const showSymbol = buckets.length <= 14;
  const series = [];
  let hasKnownCost = false;
  for (const [idx, model] of topModels.entries()) {
    const color = COMMAND_MODEL_COLORS[idx % COMMAND_MODEL_COLORS.length];
    series.push({
      name: `${model} Token`,
      type: 'line',
      smooth: true,
      symbol: showSymbol ? 'circle' : 'none',
      xAxisIndex: 0,
      yAxisIndex: 0,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      emphasis: { focus: 'series' },
      data: buckets.map(bucket => [bucket, byKey.get(`${bucket}::${model}`)?.tokens || 0]),
    });
    const costData = buckets.map(bucket => {
      const row = byKey.get(`${bucket}::${model}`);
      const value = nullableNumber(row?.cost);
      if (value !== null) hasKnownCost = true;
      return [bucket, value];
    });
    series.push({
      name: `${model} 成本`,
      type: 'line',
      smooth: true,
      symbol: showSymbol ? 'circle' : 'none',
      xAxisIndex: 1,
      yAxisIndex: 1,
      lineStyle: { color, width: 2, type: 'dashed' },
      itemStyle: { color },
      emphasis: { focus: 'series' },
      data: costData,
    });
  }

  if (note) {
    const totalTokens = rows.reduce((sum, row) => sum + Number(row.tokens || 0), 0);
    const knownCostRows = rows.filter(row => nullableNumber(row.cost) !== null);
    const totalCost = knownCostRows.reduce((sum, row) => sum + Number(row.cost || 0), 0);
    const costText = knownCostRows.length ? fmtUsd(totalCost) : '成本未知';
    note.textContent = `${trend?.label || '模型请求日志'} · ${trendWindow} · ${bucketLabel} · Top ${topModels.length} 模型 · ${fmtTokens(totalTokens)} · ${costText} · 上图 Token，下图成本。`;
  }

  commandModelTrendChart.setOption({
    backgroundColor: 'transparent',
    color: COMMAND_MODEL_COLORS,
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    grid: [
      { left: 64, right: 26, top: 34, height: 126 },
      { left: 64, right: 26, top: 214, height: 96 },
    ],
    legend: {
      type: 'scroll',
      top: 0,
      left: 0,
      right: 0,
      textStyle: { color: textColor, fontSize: 10 },
      formatter: name => name.replace(/ (Token|成本)$/, ''),
      selectedMode: true,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      formatter: params => {
        const day = params[0]?.axisValue || '--';
        const grouped = new Map();
        for (const p of params) {
          const model = String(p.seriesName || '').replace(/ (Token|成本)$/, '');
          const item = grouped.get(model) || {};
          if (String(p.seriesName).endsWith('Token')) item.tokens = p.value?.[1] ?? p.value;
          if (String(p.seriesName).endsWith('成本')) item.cost = p.value?.[1] ?? p.value;
          item.marker = p.marker;
          grouped.set(model, item);
        }
        const lines = [...grouped.entries()].map(([model, item]) =>
          `${item.marker}${escapeHtml(model)}: <b>${fmtTokens(item.tokens || 0)}</b> · ${nullableNumber(item.cost) === null ? '成本未知' : fmtUsd(item.cost)}`
        );
        return `${escapeHtml(day)}<br>${lines.join('<br>')}`;
      },
    },
    xAxis: [
      {
        type: 'category',
        gridIndex: 0,
        data: buckets,
        axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } },
        axisLabel: { color: textColor, fontSize: 10, formatter: axisFormatter },
        splitLine: { show: false },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: buckets,
        axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } },
        axisLabel: { color: textColor, fontSize: 10, formatter: axisFormatter },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        name: 'Token',
        nameTextStyle: { color: textColor, fontSize: 10 },
        axisLabel: { color: textColor, fontSize: 10, formatter: v => fmtTokens(v) },
        splitLine: { lineStyle: { color: splitColor } },
      },
      {
        type: 'value',
        gridIndex: 1,
        name: 'USD',
        nameTextStyle: { color: textColor, fontSize: 10 },
        axisLabel: { color: textColor, fontSize: 10, formatter: v => `$${Number(v).toFixed(0)}` },
        splitLine: { lineStyle: { color: splitColor } },
      },
    ],
    series: hasKnownCost ? series : series.filter(item => !String(item.name).endsWith('成本')),
  }, { notMerge: true });
}

function renderLocalUsage(data) {
  const note = document.getElementById('local-usage-note');
  const modelBody = document.getElementById('local-model-body');
  const projectBody = document.getElementById('local-project-body');
  if (!note || !modelBody || !projectBody) return;

  if (!data || !data.configured || data.status?.state !== 'ok') {
    document.getElementById('local-cost').textContent = '--';
    document.getElementById('local-tokens').textContent = '--';
    document.getElementById('local-cache').textContent = '--';
    modelBody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">暂无本地聚合数据</td></tr>';
    projectBody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">暂无本地聚合数据</td></tr>';
    note.textContent = data?.status?.message || '未读取到 .claude.json 聚合字段。';
    return;
  }

  const s = data.summary || {};
  const input = s.input_tokens || 0;
  const output = s.output_tokens || 0;
  const cache = (s.cache_read_tokens || 0) + (s.cache_creation_tokens || 0);
  document.getElementById('local-cost').textContent = fmtUsd(s.cost_usd);
  document.getElementById('local-cost-sub').textContent = `${s.project_count || 0} 个工作区`;
  document.getElementById('local-tokens').textContent = `${fmtTokens(input)} / ${fmtTokens(output)}`;
  document.getElementById('local-token-sub').textContent = '输入 / 输出';
  document.getElementById('local-cache').textContent = fmtTokens(cache);
  document.getElementById('local-cache-sub').textContent = `${s.web_search_requests || 0} 次 Web 搜索`;

  const models = data.models || [];
  modelBody.innerHTML = models.length ? models.map(m => `
    <tr>
      <td>${escapeHtml(m.model || '--')}</td>
      <td>${fmtUsd(m.cost_usd)}</td>
      <td>${fmtTokens(m.input_tokens || 0)}</td>
      <td>${fmtTokens(m.output_tokens || 0)}</td>
      <td>${fmtTokens((m.cache_read_tokens || 0) + (m.cache_creation_tokens || 0))}</td>
      <td>${m.web_search_requests || 0}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" style="color:var(--muted)">暂无模型数据</td></tr>';

  const projects = data.top_projects || [];
  projectBody.innerHTML = projects.length ? projects.map(p => `
    <tr>
      <td>${escapeHtml(p.workspace || '--')}</td>
      <td>${fmtUsd(p.cost_usd)}</td>
      <td>${fmtTokens(p.input_tokens || 0)}</td>
      <td>${fmtTokens(p.output_tokens || 0)}</td>
      <td>${p.model_count || 0}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" style="color:var(--muted)">暂无工作区数据</td></tr>';

  const modified = data.status?.last_modified ? new Date(data.status.last_modified).toLocaleString('zh-CN') : '--';
  note.textContent = `来源: ${data.source || '.claude.json'} · 文件更新时间: ${modified} · 只展示聚合字段。`;
}

// ── Render DeepSeek Detail ──────────────────────────────────────────────────

function renderDeepSeek(data, accountIdx = 0) {
  const noKey = document.getElementById('ds-no-key');
  const content = document.getElementById('deepseek-content');

  const accounts = data.accounts || [];
  const acct = accounts[accountIdx];

  if (accounts.length === 0 || !acct || acct.status?.status === 'no_key') {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  // Show per-account balance (tab already selects the account)
  const bal = acct.balance;
  if (bal) {
    document.getElementById('ds-balance-cny').textContent = '¥' + bal.total_balance_cny.toFixed(2);
    document.getElementById('ds-balance-cny-sub').textContent = acct.label || '';
    document.getElementById('ds-balance-usd').textContent = '$' + bal.total_balance_usd.toFixed(2);
    document.getElementById('ds-balance-usd-sub').textContent = '';
  }
}

// ── Render DeepSeek Platform (daily usage) ──────────────────────────────────

function renderDeepSeekPlatform(data) {
  const noKey = document.getElementById('dsp-no-key');
  const content = document.getElementById('deepseek-platform-content');

  if (!data.configured) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  const usage = data.usage || [];
  const today = new Date().toISOString().split('T')[0];
  const todayUsage = usage.filter(u => u.date === today);
  const todayTotal = todayUsage.reduce((sum, u) => sum + u.cost_total, 0);
  const todayV4Pro = todayUsage.filter(u => u.model === 'deepseek-v4-pro').reduce((sum, u) => sum + u.cost_total, 0);
  const todayV4Flash = todayUsage.filter(u => u.model === 'deepseek-v4-flash').reduce((sum, u) => sum + u.cost_total, 0);

  document.getElementById('ds-daily-cost').textContent = '¥' + todayTotal.toFixed(2);
  document.getElementById('ds-v4pro-cost').textContent = '¥' + todayV4Pro.toFixed(2);
  document.getElementById('ds-v4flash-cost').textContent = '¥' + todayV4Flash.toFixed(2);

  // Cache hit rate for V4 Pro
  const v4ProRows = todayUsage.filter(u => u.model === 'deepseek-v4-pro');
  const totalCacheHit = v4ProRows.reduce((sum, u) => sum + u.tokens_cache_hit, 0);
  const totalCacheMiss = v4ProRows.reduce((sum, u) => sum + u.tokens_cache_miss, 0);
  const cacheHitRate = (totalCacheHit + totalCacheMiss) > 0
    ? (totalCacheHit / (totalCacheHit + totalCacheMiss) * 100)
    : 0;
  document.getElementById('ds-cache-hit-rate').textContent = cacheHitRate.toFixed(1) + '%';

  if (usage.length === 0) return;

  // Usage chart
  if (!dsUsageChart) {
    dsUsageChart = echarts.init(document.getElementById('ds-usage-chart'), null, { renderer: 'canvas' });
  }

  // Aggregate by date
  const dailyMap = {};
  for (const u of usage) {
    if (!dailyMap[u.date]) dailyMap[u.date] = { v4pro: 0, v4flash: 0, total: 0 };
    if (u.model === 'deepseek-v4-pro') dailyMap[u.date].v4pro += u.cost_total;
    else if (u.model === 'deepseek-v4-flash') dailyMap[u.date].v4flash += u.cost_total;
    dailyMap[u.date].total += u.cost_total;
  }

  const dates = Object.keys(dailyMap).sort();
  const v4proData = dates.map(d => [d, dailyMap[d].v4pro]);
  const v4flashData = dates.map(d => [d, dailyMap[d].v4flash]);
  const totalData = dates.map(d => [d, dailyMap[d].total]);

  // Theme-resolved hex colors (matches renderPowerTrend / renderZai siblings)
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor   = isDark ? '#8b949e' : '#656d76';
  const splitColor  = isDark ? '#30363d' : '#d0d7de';
  const tooltipBg   = isDark ? '#21262d' : '#f6f8fa';
  const tooltipText = isDark ? '#e6edf3' : '#1f2328';
  // DeepSeek brand color hex (--ds-color dark:#4f8ff7 / light:#1d4ed8)
  const dsHex       = isDark ? '#4f8ff7' : '#1d4ed8';
  const ds2Hex      = '#22d3ee'; // V4 Flash accent

  dsUsageChart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg,
      borderColor: splitColor,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: params => {
        let html = `<div style="font-weight:600;margin-bottom:4px">${params[0].value[0]}</div>`;
        for (const p of params) {
          html += `<div>${p.marker} ${p.seriesName}: ¥${Number(p.value[1]).toFixed(3)}</div>`;
        }
        return html;
      },
    },
    legend: {
      data: ['V4 Pro', 'V4 Flash', '总计'],
      textStyle: { color: textColor, fontSize: 11 },
      top: 0,
    },
    grid: { left: 60, right: 20, top: 30, bottom: 38 },
    xAxis: {
      type: 'category', data: dates,
      axisLine: { lineStyle: { color: splitColor } },
      axisLabel: { color: textColor, fontSize: 10, rotate: 40 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', name: 'CNY',
      nameTextStyle: { color: textColor, fontSize: 10 },
      axisLine: { show: false },
      axisLabel: { color: textColor, fontSize: 10, formatter: v => '¥' + v.toFixed(2) },
      splitLine: { lineStyle: { color: splitColor } },
    },
    series: [
      {
        name: 'V4 Pro', type: 'bar', stack: 'cost', data: v4proData,
        itemStyle: { color: dsHex, borderRadius: [0, 0, 0, 0] },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(79,143,247,0.4)' } },
      },
      {
        name: 'V4 Flash', type: 'bar', stack: 'cost', data: v4flashData,
        itemStyle: { color: ds2Hex, borderRadius: [3, 3, 0, 0] },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(34,211,238,0.4)' } },
      },
      {
        name: '总计', type: 'line', data: totalData, smooth: true, symbol: 'circle', symbolSize: 5,
        lineStyle: { color: isDark ? '#f59e0b' : '#d97706', width: 2 },
        itemStyle: { color: isDark ? '#f59e0b' : '#d97706' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: isDark ? 'rgba(245,158,11,0.18)' : 'rgba(217,119,6,0.15)' },
          { offset: 1, color: isDark ? 'rgba(245,158,11,0.01)' : 'rgba(217,119,6,0.01)' },
        ])},
      },
    ],
  }, { notMerge: true });
}

// ── Render Z.AI Detail ──────────────────────────────────────────────────────

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function renderZai(data, modelsData, accountIdx = 0) {
  const noKey = document.getElementById('zai-no-key');
  const content = document.getElementById('zai-content');

  const accounts = data.accounts || [];

  if (accounts.length === 0) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }

  // Select account by tab index
  const acct = accounts[accountIdx] || accounts[0];
  if (!acct || acct.status?.status === 'no_key') {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  // Per-account quota display
  const q = acct.quota;
  if (q) {
    document.getElementById('zai-level').textContent = q.level ? `Lv.${q.level}` : '';
    updateZaiBar('5h', q.token_5h_pct);
    document.getElementById('zai-reset-5h').textContent = fmtReset(q.token_5h_reset);
    const weekRow = document.getElementById('zai-row-week');
    if (q.token_week_pct >= 0) {
      weekRow.style.display = 'flex';
      updateZaiBar('week', q.token_week_pct);
    } else {
      weekRow.style.display = 'none';
    }
    updateZaiBar('mcp', q.mcp_month_pct);
    const mcpExtra = document.getElementById('zai-extra-mcp');
    if (q.mcp_total > 0) {
      mcpExtra.textContent = `${q.mcp_used} / ${q.mcp_total}`;
    }
    const mcpDetailsEl = document.getElementById('zai-mcp-details');
    try {
      const details = JSON.parse(q.usage_details_json || '[]');
      if (details.length > 0) {
        mcpDetailsEl.textContent = details.map(d => `${d.modelCode}: ${d.usage}`).join(' · ');
      } else {
        mcpDetailsEl.textContent = '';
      }
    } catch { mcpDetailsEl.textContent = ''; }
  }

  // Model usage chart — per-account
  const mdlAccts = (modelsData && modelsData.accounts) ? modelsData.accounts : null;
  const mdl = mdlAccts ? (mdlAccts[accountIdx]?.data || mdlAccts[0]?.data) : modelsData;
  const modelHighlightEl = document.getElementById('zai-model-highlight');
  const modelSummaryEl = document.getElementById('zai-model-summary');
  if (mdl && !mdl.error && mdl.models) {
    modelSummaryEl.textContent = `共 ${fmtTokens(mdl.total_tokens || 0)} tokens · ${mdl.total_calls || 0} calls`;

    const mainModel = mdl.models.find(m => m.name === 'GLM-5.1');
    if (mainModel) {
      modelHighlightEl.innerHTML = `
        <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:4px 12px;display:flex;align-items:center;justify-content:center;gap:8px">
          <span style="font-size:11px;color:var(--muted)">GLM-5.1</span>
          <span style="font-size:16px;font-weight:bold;color:#22d3ee">${fmtTokens(mainModel.total_tokens)}</span>
          <span style="font-size:10px;color:var(--muted)">tokens</span>
        </div>
      `;
    }

    renderZaiHourlyChart(mdl);
    renderZaiModelBar(mdl);
  } else {
    modelSummaryEl.textContent = mdl?.error ? '加载失败' : '';
    modelHighlightEl.innerHTML = '';
  }
}

function renderZaiHourlyChart(modelsData) {
  if (!zaiHourlyChart || !modelsData.hours || modelsData.hours.length === 0) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';

  // Reverse so most recent hour is on the left
  const xLabels = [...modelsData.hours].reverse()
    .map(h => {
      // "2026-05-19 16:00" → "19日 16:00"
      const m = h.match(/\d{4}-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
      if (m) return parseInt(m[2]) + '日 ' + m[3];
      return h.replace(/^\d{4}-/, '');
    });

  const colors = ['#22d3ee', '#818cf8', '#f472b6', '#fb923c', '#a3e635'];
  const series = [];
  if (modelsData.model_per_hour) {
    modelsData.model_per_hour.forEach((m, i) => {
      series.push({
        name: m.name,
        type: 'bar',
        stack: 'tokens',
        barMaxWidth: 16,
        itemStyle: { color: colors[i % colors.length] },
        data: [...(m.tokens_per_hour || [])].reverse(),
      });
    });
  }

  zaiHourlyChart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 11 },
      formatter: params => {
        let s = `<div style="color:${textColor};font-size:10px">${params[0].axisValue}</div>`;
        let total = 0;
        for (const p of params) {
          if (p.value > 0) {
            s += `${p.marker} ${p.seriesName}: <b>${fmtTokens(p.value)}</b><br/>`;
            total += p.value;
          }
        }
        if (total > 0) s += `<b>合计: ${fmtTokens(total)}</b>`;
        return s;
      },
    },
    legend: { textStyle: { color: textColor, fontSize: 10 }, top: 0, type: 'scroll' },
    grid: { left: 60, right: 20, top: 30, bottom: 55 },
    xAxis: { type: 'category', data: xLabels, axisLabel: { color: textColor, fontSize: 9, rotate: 30 }, axisLine: { lineStyle: { color: splitColor } } },
    yAxis: { type: 'value', axisLabel: { color: textColor, fontSize: 10, formatter: v => fmtTokens(v) }, axisLine: { show: false }, splitLine: { lineStyle: { color: splitColor } } },
    series,
  }, { notMerge: true });
}

function renderZaiModelBar(modelsData) {
  if (!zaiModelBar || !modelsData.models || modelsData.models.length === 0) return;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';
  const colors = ['#818cf8', '#f472b6', '#fb923c', '#a3e635', '#38bdf8', '#22d3ee'];

  // Exclude GLM-5.1 (shown in highlight block), sort by tokens desc
  const models = modelsData.models
    .filter(m => m.total_tokens > 0 && m.name !== 'GLM-5.1')
    .sort((a, b) => b.total_tokens - a.total_tokens);
  const names = models.map(m => m.name);
  const values = models.map(m => m.total_tokens);

  if (names.length === 0) { zaiModelBar.clear(); return; }

  zaiModelBar.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 11 },
      formatter: params => {
        const p = params[0];
        return `${p.marker} ${p.name}: <b>${fmtTokens(p.value)}</b> tokens`;
      },
    },
    grid: { left: 55, right: 20, top: 20, bottom: 65 },
    xAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: textColor, fontSize: 9, rotate: 35, interval: 0 },
      axisLine: { lineStyle: { color: splitColor } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'log',
      logBase: 10,
      min: 1,
      axisLabel: { color: textColor, fontSize: 9, formatter: v => fmtTokens(v) },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 48,
      barMinWidth: 16,
      barMinHeight: 16,
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length], borderRadius: [4, 4, 0, 0] } })),
      label: {
        show: true,
        position: 'top',
        fontSize: 9,
        fontWeight: 'bold',
        color: isDark ? '#e6edf3' : '#1f2328',
        formatter: p => fmtTokens(p.value),
      },
      emphasis: {
        itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' },
      },
    }],
  }, { notMerge: true });
}

function updateZaiBar(dim, pct) {
  const bar = document.getElementById('zai-bar-' + dim);
  const pctEl = document.getElementById('zai-pct-' + dim);
  if (!bar || !pctEl) return;

  bar.style.width = Math.min(100, pct) + '%';
  pctEl.textContent = pct + '%';

  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--zai-color)';
  bar.style.background = color;
  pctEl.style.color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--text)';
}

// ── Render Claude Detail ────────────────────────────────────────────────────

function fmtReset(ts) {
  if (!ts || ts <= 0) return '';
  return '→ ' + new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function claudeRow(label, pct, resetTs) {
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--claude-color)';
  const pctColor = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--text)';
  const row = document.createElement('div');
  row.className = 'zai-row';
  row.innerHTML =
    `<span class="zai-label">${label}</span>` +
    `<div class="zai-bar-wrap"><div class="zai-bar" style="width:${Math.min(100, pct)}%;background:${color}"></div></div>` +
    `<span class="zai-pct" style="color:${pctColor}">${pct}%</span>` +
    `<span class="zai-extra">${fmtReset(resetTs)}</span>`;
  return row;
}

function renderClaude(data, history) {
  const noKey = document.getElementById('claude-no-key');
  const content = document.getElementById('claude-content');

  if (data.status?.status === 'no_key') {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  const q = data.quota;
  const box = document.getElementById('claude-quotas');
  box.innerHTML = '';
  if (q) {
    box.appendChild(claudeRow('5h 窗口', q.five_h_pct, q.five_h_reset));
    box.appendChild(claudeRow('7d 窗口', q.seven_d_pct, q.seven_d_reset));
    for (const l of (q.extra || [])) {
      box.appendChild(claudeRow(l.label, l.pct, l.reset_ts));
    }
  }

  // History chart (5h / 7d utilization over 24h)
  if (!claudeHistoryChart || !history || history.length === 0) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';

  claudeHistoryChart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      formatter: params => {
        const t = new Date(params[0].value[0]).toLocaleTimeString();
        let s = `<div style="color:${textColor};font-size:10px">${t}</div>`;
        for (const p of params) {
          s += `${p.marker} ${p.seriesName}: <b>${p.value[1]}%</b><br/>`;
        }
        return s;
      },
    },
    legend: { data: ['5h', '7d'], textStyle: { color: textColor, fontSize: 10 }, top: 0 },
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: splitColor } }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: 'value', name: '%', max: 100, nameTextStyle: { color: textColor, fontSize: 10 }, axisLine: { show: false }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { lineStyle: { color: splitColor } } },
    series: [
      { name: '5h', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, itemStyle: { color: '#d97757' }, data: history.map(h => [h.timestamp, h.five_h_pct]) },
      { name: '7d', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, itemStyle: { color: '#e8a87c' }, data: history.map(h => [h.timestamp, h.seven_d_pct]) },
    ],
  }, { notMerge: true });
}


function renderMimo(data, history, accountIdx = 0) {
  const noKey = document.getElementById('mimo-no-key');
  const content = document.getElementById('mimo-content');

  const accounts = data.accounts || [];
  const acct = accounts[accountIdx];

  if (accounts.length === 0) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }

  if (!acct || acct.status?.status === 'no_key') {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  const box = document.getElementById('mimo-quotas');
  const planLabel = document.getElementById('mimo-plan-label');
  box.innerHTML = '';

  // Per-account rendering (tab selects the account)
  const q = acct.quota;
  if (!q) return;

  const usedPct = q.month_percent * 100;
  const fmtM = (v) => { const m = v / 1e6; return (m < 10 ? m.toFixed(2) : m.toFixed(1)) + 'M'; };
  planLabel.textContent = `${q.plan_name} · 到期 ${q.period_end}`;

  // Plan info row
  const info = document.createElement('div');
  info.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)';
  info.innerHTML = `
    <span style="color:var(--muted);font-size:12px">套餐</span>
    <span style="font-weight:600;color:${q.expired ? 'var(--red)' : 'var(--fg)'}">${q.plan_name}${q.expired ? ' (已过期)' : ''}</span>
  `;
  box.appendChild(info);

  // Usage bar
  const usageRow = document.createElement('div');
  usageRow.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--border)';
  usageRow.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="color:var(--muted);font-size:12px">月用量</span>
      <span style="font-weight:600">${fmtM(q.month_used)} / ${fmtM(q.month_limit)}</span>
    </div>
    <div style="background:var(--bg);border-radius:4px;height:8px;overflow:hidden">
      <div style="height:100%;width:${Math.min(100, usedPct).toFixed(1)}%;background:${usedPct > 80 ? 'var(--red)' : usedPct > 50 ? 'var(--yellow)' : 'var(--mimo-color)'};border-radius:4px;transition:width 0.5s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--muted)">
      <span>已用 ${usedPct.toFixed(2)}%</span>
      <span>剩余 ${fmtM(q.month_limit - q.month_used)}</span>
    </div>
    `;
    box.appendChild(usageRow);

    // Period end
    const periodRow = document.createElement('div');
    periodRow.style.cssText = 'display:flex;justify-content:space-between;padding:8px 0';
    periodRow.innerHTML = `
      <span style="color:var(--muted);font-size:12px">到期时间</span>
      <span>${q.period_end}</span>
    `;
    box.appendChild(periodRow);

  // History chart
  if (!mimoHistoryChart || !history || history.length === 0) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';

  mimoHistoryChart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      formatter: params => {
        const t = new Date(params[0].value[0]).toLocaleString();
        const fmtC = v => v >= 1e8 ? (v/1e8).toFixed(2)+'亿' : v >= 1e4 ? (v/1e4).toFixed(1)+'万' : v.toLocaleString();
        return `<div style="color:${textColor};font-size:10px">${t}</div>` +
          params.map(p => `${p.marker} ${p.seriesName}: <b>${fmtC(p.value[1])}</b>`).join('<br/>');
      },
    },
    grid: { left: 65, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: splitColor } }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { show: false } },
    yAxis: {
      type: 'value',
      axisLabel: { color: textColor, fontSize: 9, formatter: v => v >= 1e8 ? (v/1e8).toFixed(1)+'亿' : v >= 1e4 ? (v/1e4)+'万' : v },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
    },
    series: [{
      name: '月用量', type: 'line', smooth: true, symbol: 'circle', symbolSize: 4,
      lineStyle: { width: 2, color: '#818cf8' },
      itemStyle: { color: '#818cf8' },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(129,140,248,0.3)' }, { offset: 1, color: 'rgba(129,140,248,0.02)' }] } },
      data: history.map(h => [h.timestamp, h.month_used]),
    }],
  }, { notMerge: true });
}
// ── MiniMax Rendering (unchanged) ───────────────────────────────────────────

function renderConsumption(data) {
  const model = 'MiniMax-M*';
  const dayVal = data.day?.[model];
  const weekVal = data.week?.[model];
  document.getElementById('day-consumption').textContent =
    dayVal !== null && dayVal !== undefined ? dayVal.toLocaleString() : '--';
  document.getElementById('week-consumption').textContent =
    weekVal !== null && weekVal !== undefined ? weekVal.toLocaleString() : '--';
}

function renderWeeklyBar(weeklyBar) {
  if (!weeklyBarChart) return;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';

  const labels = weeklyBar.map(d => d.label);
  const values = weeklyBar.map(d => d.consumption ?? 0);

  weeklyBarChart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 11 },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } }, axisLabel: { color: textColor } },
    yAxis: { type: 'value', name: '消耗次数', nameTextStyle: { color: textColor, fontSize: 10 }, axisLine: { show: false }, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: splitColor } } },
    series: [{
      type: 'bar', data: values,
      itemStyle: { color: p => p.dataIndex === 0 ? '#388bfd' : '#3fb950', borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 40,
    }],
    tooltip: {
      trigger: 'axis', backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      formatter: params => {
        const isToday = params[0].dataIndex === 0 ? ' (今日)' : '';
        return `${params[0].name}${isToday}: <b>${params[0].value}</b> 次`;
      },
    },
  }, { notMerge: true });
}

// ── Countdown ────────────────────────────────────────────────────────────────

function startCountdown() {
  setInterval(() => {
    countdownSec = Math.max(0, countdownSec - 1);
    document.getElementById('countdown-val').textContent = formatCountdown(countdownSec);
    if (countdownSec === 0) countdownSec = 60;
  }, 1000);
}

function formatCountdown(sec) {
  if (sec <= 0) return '刷新中…';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Filter tabs ──────────────────────────────────────────────────────────────

function buildFilterTabs() {
  const bar = document.getElementById('filterBar');
  FILTER_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'filter-tab' + (activeFilter === cat.label ? ' active' : '');
    btn.textContent = cat.label;
    btn.addEventListener('click', () => {
      activeFilter = cat.label;
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCards(activeFilter);
    });
    bar.appendChild(btn);
  });
}

// ── MiniMax Cards (unchanged logic) ─────────────────────────────────────────

function getModelsToShow(filter) {
  let data = rawData;
  // Filter by active account label if set
  if (activeAccountLabel) {
    data = data.filter(m => (m.account_label || '') === activeAccountLabel);
  }
  const cat = FILTER_CATEGORIES.find(c => c.label === filter) || FILTER_CATEGORIES[0];
  if (!cat.models) return data;
  return data.filter(m => cat.models.includes(m.model_name));
}

function getDisplayName(name) { return DISPLAY_NAMES[name] || name; }

function pctColor(pct) {
  if (pct >= 90) return 'very-low';
  if (pct >= 70) return 'low';
  return 'ok';
}

function barColor(pct) {
  if (pct >= 90) return 'var(--red)';
  if (pct >= 70) return 'var(--yellow)';
  return 'var(--green)';
}

function buildCardHTML(m, subtitle) {
  const intervalTotal = m.current_interval_total_count;
  const intervalUsed  = m.current_interval_usage_count;
  const intervalLeft  = intervalTotal - intervalUsed;
  const intervalPct   = intervalTotal > 0 ? (intervalUsed / intervalTotal * 100) : 0;
  const intervalReset = formatDuration(m.remains_time);

  const weeklyTotal = m.current_weekly_total_count;
  const weeklyUsed  = m.current_weekly_usage_count;
  const weeklyLeft  = weeklyTotal - weeklyUsed;
  const weeklyPct   = weeklyTotal > 0 ? (weeklyUsed / weeklyTotal * 100) : 0;
  const weeklyReset = formatDuration(m.weekly_remains_time);

  const barW = Math.min(100, intervalPct).toFixed(1);

  const acctLabel = m.account_label ? `<span class="acct-badge">${escapeHtml(m.account_label)}</span>` : '';

  return `
    <div class="model-card">
      <div class="model-name">${acctLabel}${escapeHtml(getDisplayName(m.model_name))}</div>
      ${subtitle ? `<div class="shared-quota-hint">${escapeHtml(subtitle)}</div>` : ''}
      <div class="quota-row">
        <span class="quota-label">5h窗口</span>
        <div class="progress-wrap">
          <div class="progress-bar ${pctColor(intervalPct)}" style="width:${barW}%; background:${barColor(intervalPct)}"></div>
        </div>
        <div class="quota-info">
          <span class="quota-pct" style="color:${intervalPct >= 90 ? 'var(--red)' : intervalPct >= 70 ? 'var(--yellow)' : 'var(--green)'}">
            ${(100 - intervalPct).toFixed(1)}%
          </span>
          <span class="quota-count">${intervalLeft.toLocaleString()} / ${intervalTotal.toLocaleString()}</span>
          <span class="quota-reset">重置 ${intervalReset}</span>
        </div>
      </div>
      <div class="quota-row">
        <span class="quota-label">周配额</span>
        <div class="progress-wrap">
          <div class="progress-bar ${pctColor(weeklyPct)}" style="width:${Math.min(100, weeklyPct).toFixed(1)}%; background:${barColor(weeklyPct)}"></div>
        </div>
        <div class="quota-info">
          <span class="quota-pct" style="color:${weeklyPct >= 90 ? 'var(--red)' : weeklyPct >= 70 ? 'var(--yellow)' : 'var(--green)'}">
            ${(100 - weeklyPct).toFixed(1)}%
          </span>
          <span class="quota-count">${weeklyLeft.toLocaleString()} / ${weeklyTotal.toLocaleString()}</span>
          <span class="quota-reset">周重置 ${weeklyReset}</span>
        </div>
      </div>
    </div>`;
}

function renderCards(filter) {
  const container = document.getElementById('model-list');
  const models = getModelsToShow(filter);

  if (models.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);padding:12px">暂无数据</div>';
    return;
  }

  const SHARED_MODELS = ['MiniMax-M*', 'coding-plan-vlm', 'coding-plan-search'];
  if (filter === 'M*' && SHARED_MODELS.every(n => models.find(m => m.model_name === n))) {
    const primary = models.find(m => m.model_name === 'MiniMax-M*');
    const vlmName = DISPLAY_NAMES['coding-plan-vlm'] || 'Coding Plan VLM';
    const searchName = DISPLAY_NAMES['coding-plan-search'] || 'Coding Plan Search';
    container.innerHTML = buildCardHTML(primary, `与 ${searchName} · ${vlmName} 共享额度`);
    return;
  }

  container.innerHTML = models.map(m => buildCardHTML(m, null)).join('');
}

// ── MiniMax Table (unchanged) ───────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = rawData.map(m => {
    const intervalLeft = m.current_interval_total_count - m.current_interval_usage_count;
    const weeklyLeft   = m.current_weekly_total_count - m.current_weekly_usage_count;
    const iPct = m.current_interval_total_count > 0 ? (m.current_interval_usage_count / m.current_interval_total_count * 100) : 0;
    const wPct = m.current_weekly_total_count > 0 ? (m.current_weekly_usage_count / m.current_weekly_total_count * 100) : 0;

    const badge = (pct) => `<span class="pct-badge ${pctColor(pct)}">${pct.toFixed(1)}%</span>`;

    return `<tr>
      <td>${(m.account_label ? `<span class="acct-badge">${escapeHtml(m.account_label)}</span>` : '')}${escapeHtml(getDisplayName(m.model_name))}</td>
      <td>${m.current_interval_usage_count.toLocaleString()}</td>
      <td>${intervalLeft.toLocaleString()}</td>
      <td>${formatDuration(m.remains_time)}</td>
      <td>${m.current_weekly_usage_count.toLocaleString()}</td>
      <td>${weeklyLeft.toLocaleString()}</td>
      <td>${formatDuration(m.weekly_remains_time)}</td>
    </tr>`;
  }).join('');
}

// ── ECharts (MiniMax trend, theme-aware) ──────────────────────────────────────

function updateChart(history) {
  if (!chart || !history || history.length === 0) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#8b949e' : '#656d76';
  const splitColor = isDark ? '#21262d' : '#eaeef2';

  const times = history.map(h => new Date(h.ts));
  const consumed = history.map(h => h.interval_usage);

  chart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: textColor, fontFamily: 'Cascadia Code, Consolas, monospace' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#21262d' : '#f6f8fa',
      borderColor: isDark ? '#30363d' : '#d0d7de',
      textStyle: { color: isDark ? '#e6edf3' : '#1f2328', fontSize: 12 },
      formatter: params => {
        const t = new Date(params[0].value[0]).toLocaleTimeString();
        return `${params[0].marker} 5h消耗: <b>${Number(params[0].value[1]).toLocaleString()}</b><div style="color:${textColor};font-size:10px;margin-top:2px">${t}</div>`;
      },
    },
    grid: { left: 60, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: 'value', name: '消耗次数', nameTextStyle: { color: textColor, fontSize: 10 }, axisLine: { show: false }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { lineStyle: { color: splitColor } } },
    series: [{
      name: '5h消耗', type: 'line', smooth: true, symbol: 'none',
      lineStyle: { color: '#388bfd', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
        { offset: 0, color: 'rgba(56,139,253,0.25)' },
        { offset: 1, color: 'rgba(56,139,253,0.02)' },
      ]}},
      data: times.map((t, i) => [t, consumed[i]]),
    }],
  }, { notMerge: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '已重置';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}天${h % 24}h`;
  if (h > 0) return `${h}h${m % 60}m`;
  return `${m}m`;
}

function latestTsFromArray(accounts) {
  // Given an array of account objects, find the most recent lastTs
  let latest = 0;
  for (const acct of (accounts || [])) {
    const ts = acct?.status?.lastTs;
    if (ts && ts > latest) latest = ts;
  }
  return latest;
}

function updateFooter(data) {
  const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const mmxTs = latestTsFromArray(data?.minimax);
  const dsTs = latestTsFromArray(data?.deepseek);
  const zaiTs = latestTsFromArray(data?.zai);
  const ccTs = data?.claude?.status?.lastTs || 0;
  const fmtTs = ts => ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--';
  document.getElementById('footer').textContent =
    `最后更新: ${now}  ·  MMX🌐 ${fmtTs(mmxTs)}  ·  DS ${fmtTs(dsTs)}  ·  GLM ${fmtTs(zaiTs)}  ·  CC ${fmtTs(ccTs)}`;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

try {
  init();
} catch (err) {
  document.body.innerHTML = '<pre style="color:red;padding:20px">Init error: ' + err.message + '\n' + err.stack + '</pre>';
}

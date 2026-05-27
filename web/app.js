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

// ── State ───────────────────────────────────────────────────────────────────

let rawData = [];
let activeFilter = null;
let activeService = 'minimax';
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
  chart = echarts.init(document.getElementById('trend-chart'), null, { renderer: 'canvas' });
  weeklyBarChart = echarts.init(document.getElementById('weekly-bar-chart'), null, { renderer: 'canvas' });
  zaiHourlyChart = echarts.init(document.getElementById('zai-hourly-chart'), null, { renderer: 'canvas' });
  zaiModelBar = echarts.init(document.getElementById('zai-model-bar'), null, { renderer: 'canvas' });
  claudeHistoryChart = echarts.init(document.getElementById('claude-history-chart'), null, { renderer: 'canvas' });
  mimoHistoryChart = echarts.init(document.getElementById('mimo-history-chart'), null, { renderer: 'canvas' });
  powerTrendChart = echarts.init(document.getElementById('power-trend-chart'), null, { renderer: 'canvas' });
  try { powerLocalStorage = JSON.parse(localStorage.getItem(POWER_LS_KEY) || '[]'); } catch(e) { powerLocalStorage = []; }

  initTheme();
  buildFilterTabs();
  bindServiceTabs();
  bindSettings();

  document.getElementById('refreshBtn').addEventListener('click', manualRefresh);
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  window.addEventListener('resize', () => {
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

// ── Service Tabs ─────────────────────────────────────────────────────────────

function bindServiceTabs() {
  document.querySelectorAll('.service-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeService = tab.dataset.service;
      document.querySelectorAll('.service-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.service-section').forEach(s => s.classList.remove('active'));
      document.getElementById('sec-' + activeService).classList.add('active');
      // Resize charts when switching tabs
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
      // Power tab: start 1s polling
      if (activeService === 'power') {
        startPowerPolling();
      } else {
        stopPowerPolling();
      }
    });
  });
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
    fetchOverview(),
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
  if (lastOverviewData) renderOverview(lastOverviewData);
}

let lastOverviewData = null;

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
    renderDeepSeek(balanceData);
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
    renderZai(quotaData, modelsData);
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
    renderMimo(await quotaRes.json(), await historyRes.json());
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
      value = powerOverviewData.ac_w.toFixed(1) + 'W';
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

// ── Render DeepSeek Detail ──────────────────────────────────────────────────

function renderDeepSeek(data) {
  const noKey = document.getElementById('ds-no-key');
  const content = document.getElementById('deepseek-content');

  const accounts = data.accounts || [];

  if (accounts.length === 0) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }

  // Check if any account has a status other than no_key
  const hasData = accounts.some(a => a.status?.status !== 'no_key');
  if (!hasData) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  // Build multi-account balance display
  if (accounts.length === 1) {
    // Single account — render as before
    const acct = accounts[0];
    const bal = acct.balance;
    const label = acct.label || 'DeepSeek';
    if (bal) {
      document.getElementById('ds-balance-cny').textContent = '¥' + bal.total_balance_cny.toFixed(2);
      document.getElementById('ds-balance-cny-sub').textContent = '';
      document.getElementById('ds-balance-usd').textContent = '$' + bal.total_balance_usd.toFixed(2);
      document.getElementById('ds-balance-usd-sub').textContent = '';
    }
  } else {
    // Multiple accounts — sum CNY, show individual labels
    let totalCny = 0, totalUsd = 0;
    const details = [];
    for (const acct of accounts) {
      const bal = acct.balance;
      const label = acct.label || 'DeepSeek';
      if (bal) {
        totalCny += bal.total_balance_cny || 0;
        totalUsd += bal.total_balance_usd || 0;
        details.push(`${label}: ¥${bal.total_balance_cny.toFixed(2)}`);
      }
    }
    document.getElementById('ds-balance-cny').textContent = '¥' + totalCny.toFixed(2);
    document.getElementById('ds-balance-cny-sub').textContent = details.join(' · ');
    document.getElementById('ds-balance-usd').textContent = '$' + totalUsd.toFixed(2);
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

function renderZai(data, modelsData) {
  const noKey = document.getElementById('zai-no-key');
  const content = document.getElementById('zai-content');

  const accounts = data.accounts || [];

  if (accounts.length === 0) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }

  const hasData = accounts.some(a => a.status?.status !== 'no_key');
  if (!hasData) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  // If single account, use the existing static HTML elements directly
  if (accounts.length === 1) {
    const acct = accounts[0];
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
  } else {
    // Multiple accounts — render using worst (highest used pct) for bars
    let worst5h = 0, worst5hReset = 0, worstWeek = -1, worstMcp = 0;
    let worst5hAcct = null;
    let levelStr = '';
    for (const acct of accounts) {
      const q = acct.quota;
      if (!q) continue;
      if (q.token_5h_pct > worst5h) {
        worst5h = q.token_5h_pct;
        worst5hReset = q.token_5h_reset;
        worst5hAcct = acct;
      }
      if (q.token_week_pct >= 0) worstWeek = Math.max(worstWeek, q.token_week_pct);
      worstMcp = Math.max(worstMcp, q.mcp_month_pct);
      if (q.level && !levelStr) levelStr = `Lv.${q.level}`;
    }
    document.getElementById('zai-level').textContent = levelStr;
    updateZaiBar('5h', worst5h);
    document.getElementById('zai-reset-5h').textContent = fmtReset(worst5hReset);
    const weekRow = document.getElementById('zai-row-week');
    if (worstWeek >= 0) {
      weekRow.style.display = 'flex';
      updateZaiBar('week', worstWeek);
    } else {
      weekRow.style.display = 'none';
    }
    updateZaiBar('mcp', worstMcp);
    // Show per-account breakdown in MCP details area
    const detailsEl = document.getElementById('zai-mcp-details');
    const perAcct = accounts
      .filter(a => a.quota)
      .map(a => {
        const label = a.label || 'GLM';
        return `${label}: 5h ${a.quota.token_5h_pct}%`;
      });
    detailsEl.textContent = perAcct.join(' · ');
    const mcpExtra = document.getElementById('zai-extra-mcp');
    if (worst5hAcct?.quota?.mcp_total > 0) {
      mcpExtra.textContent = `${worst5hAcct.quota.mcp_used} / ${worst5hAcct.quota.mcp_total}`;
    }
  }

  // Model usage chart + highlight (shared across accounts)
  const modelHighlightEl = document.getElementById('zai-model-highlight');
  const modelSummaryEl = document.getElementById('zai-model-summary');
  if (modelsData && !modelsData.error && modelsData.models) {
    const total = modelsData.total_tokens || 0;
    modelSummaryEl.textContent = `共 ${fmtTokens(total)} tokens · ${modelsData.total_calls || 0} calls`;

    const mainModel = modelsData.models.find(m => m.name === 'GLM-5.1');
    if (mainModel) {
      modelHighlightEl.innerHTML = `
        <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:4px 12px;display:flex;align-items:center;justify-content:center;gap:8px">
          <span style="font-size:11px;color:var(--muted)">GLM-5.1</span>
          <span style="font-size:16px;font-weight:bold;color:#22d3ee">${fmtTokens(mainModel.total_tokens)}</span>
          <span style="font-size:10px;color:var(--muted)">tokens</span>
        </div>
      `;
    }

    renderZaiHourlyChart(modelsData);
    renderZaiModelBar(modelsData);
  } else {
    modelSummaryEl.textContent = modelsData?.error ? '加载失败' : '';
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


function renderMimo(data, history) {
  const noKey = document.getElementById('mimo-no-key');
  const content = document.getElementById('mimo-content');

  const accounts = data.accounts || [];

  if (accounts.length === 0) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }

  const hasData = accounts.some(a => a.status?.status !== 'no_key');
  if (!hasData) {
    noKey.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  noKey.style.display = 'none';
  content.style.display = 'block';

  const box = document.getElementById('mimo-quotas');
  const planLabel = document.getElementById('mimo-plan-label');
  box.innerHTML = '';

  // Render each account as a separate block
  for (let i = 0; i < accounts.length; i++) {
    const acct = accounts[i];
    const q = acct.quota;
    if (!q) continue;

    const displayLabel = acct.label || 'MiMo';

    // If multiple accounts, add a label header
    if (accounts.length > 1) {
      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)';
      if (i > 0) headerRow.style.marginTop = '12px';
      headerRow.innerHTML = `
        <span style="font-weight:600;font-size:13px;color:var(--mimo-color)">${escapeHtml(displayLabel)}</span>
      `;
      box.appendChild(headerRow);
    }

    const usedPct = q.month_percent * 100;
    const remainPct = 100 - usedPct;
    const fmtM = (v) => { const m = v / 1e6; return (m < 10 ? m.toFixed(2) : m.toFixed(1)) + 'M'; };

    // Update plan label with first account's info
    if (i === 0) {
      const extraLabel = accounts.length > 1 ? ` (${accounts.length} 账号)` : '';
      planLabel.textContent = `${q.plan_name} · 到期 ${q.period_end}${extraLabel}`;
    }

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
  }

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
  const cat = FILTER_CATEGORIES.find(c => c.label === filter) || FILTER_CATEGORIES[0];
  if (!cat.models) return rawData;
  return rawData.filter(m => cat.models.includes(m.model_name));
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

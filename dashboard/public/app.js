// tokentab dashboard — vanilla JS, hand-rolled SVG charts. No external deps.
const state = {
  window: "month",
  gran: "day",
  by: "tag",
  page: 0,
  pageSize: 25,
  heatmode: "3d",
  trendTall: false,
  activity: null, // cached /api/activity rows for heatmap re-renders
};

const $ = (sel) => document.querySelector(sel);
const fmtUSD = (n) => "$" + (n ?? 0).toFixed(n >= 100 ? 2 : 4);
const fmtInt = (n) => (n ?? 0).toLocaleString("en-US");
const fmtTime = (ts) => new Date(ts).toLocaleString();

async function api(path, params = {}) {
  const merged = { window: state.window, ...params };
  if (MOCK) return mockApi(path, merged);
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(merged)) {
    u.searchParams.set(k, v);
  }
  const res = await fetch(u);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// ---------- demo mock data (enable with ?mock=1) — for screenshots only ----------
// Generates coherent fake data entirely in the browser; the real /api/* store
// is never touched. Remove the query flag to return to live data.
const MOCK = new URLSearchParams(location.search).has("mock");
const DAY = 86_400_000;

// Small deterministic PRNG so screenshots are stable between reloads.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function utcDay(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const MOCK_MODELS = [
  { provider: "openai", model: "gpt-4o", inRate: 2.5, outRate: 10 },
  { provider: "openai", model: "gpt-4o-mini", inRate: 0.15, outRate: 0.6 },
  { provider: "anthropic", model: "claude-3-5-sonnet", inRate: 3, outRate: 15 },
  { provider: "anthropic", model: "claude-3-5-haiku", inRate: 0.8, outRate: 4 },
  { provider: "gemini", model: "gemini-1.5-pro", inRate: 1.25, outRate: 5 },
  { provider: "gemini", model: "gemini-1.5-flash", inRate: 0.075, outRate: 0.3 },
];
const MOCK_TAGS = ["chat", "summarize", "extract", "classify", "embeddings", "rerank", "agent"];
const MOCK_WINDOW_DAYS = { day: 1, week: 7, month: 30, total: 365 };

// Stable pool of daily activity for the trailing year, with a weekly rhythm
// and a gentle upward ramp so the heatmap and trend look alive.
let _mockPool = null;
function mockPool() {
  if (_mockPool) return _mockPool;
  const today = utcDay(Date.now());
  const r = rng(1337);
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const bucket = today - i * DAY;
    const dow = new Date(bucket).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const ramp = 0.35 + 0.65 * ((364 - i) / 364);
    if (r() > (weekend ? 0.4 : 0.85) * ramp + 0.1) continue; // some quiet days
    const base = weekend ? 60 : 220;
    const calls = Math.round((base + r() * base) * ramp) + 1;
    const inputTokens = calls * Math.round(700 + r() * 800);
    const outputTokens = calls * Math.round(300 + r() * 450);
    const totalTokens = inputTokens + outputTokens;
    const totalCost = (inputTokens * 4 + outputTokens * 16) / 1e6; // premium-blended
    days.push({ bucket, calls, totalTokens, inputTokens, outputTokens, totalCost });
  }
  _mockPool = days;
  return days;
}

function mockPoolForWindow(window) {
  const days = MOCK_WINDOW_DAYS[window] ?? 30;
  const cutoff = utcDay(Date.now()) - (days - 1) * DAY;
  return mockPool().filter((d) => d.bucket >= cutoff);
}

function mockSum(rows, key) {
  return rows.reduce((s, d) => s + d[key], 0);
}

function mockOverview(window) {
  const rows = mockPoolForWindow(window);
  const calls = mockSum(rows, "calls");
  const inputTokens = mockSum(rows, "inputTokens");
  const outputTokens = mockSum(rows, "outputTokens");
  const spent = mockSum(mockPoolForWindow("month"), "totalCost");
  const limit = 750;
  return {
    window,
    since: 0,
    totalCost: mockSum(rows, "totalCost"),
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    calls,
    avgLatencyMs: 680 + (calls % 420),
    estimatedShare: 0.12,
    budget: { limit, window: "month", spent, ratio: spent / limit },
  };
}

function mockTimeseries(window, gran) {
  const rows = mockPoolForWindow(window);
  const toBucket = (d) => ({
    bucket: d.bucket,
    totalCost: d.totalCost,
    totalTokens: d.totalTokens,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    estimatedTokens: Math.round(d.totalTokens * 0.12),
    calls: d.calls,
  });
  if (gran === "day") return rows.map(toBucket);
  const keyOf = (ts) => {
    const dt = new Date(ts);
    if (gran === "month") return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1);
    const daysSinceMonday = (dt.getUTCDay() + 6) % 7;
    return utcDay(ts) - daysSinceMonday * DAY;
  };
  const m = new Map();
  for (const d of rows) {
    const k = keyOf(d.bucket);
    const b =
      m.get(k) ??
      { bucket: k, totalCost: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, estimatedTokens: 0, calls: 0 };
    b.totalCost += d.totalCost;
    b.totalTokens += d.totalTokens;
    b.inputTokens += d.inputTokens;
    b.outputTokens += d.outputTokens;
    b.estimatedTokens += Math.round(d.totalTokens * 0.12);
    b.calls += d.calls;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => a.bucket - b.bucket);
}

function mockBy(by, window) {
  const rows = mockPoolForWindow(window);
  const totalCost = mockSum(rows, "totalCost") || 1;
  const totalTokens = mockSum(rows, "totalTokens") || 1;
  const totalCalls = mockSum(rows, "calls") || 1;
  const keys =
    by === "model"
      ? MOCK_MODELS.map((m) => m.model)
      : by === "provider"
        ? [...new Set(MOCK_MODELS.map((m) => m.provider))]
        : MOCK_TAGS;
  const r = rng(by === "model" ? 7 : by === "provider" ? 11 : 13);
  const weights = keys.map(() => 0.2 + r());
  const sum = weights.reduce((a, b) => a + b, 0);
  return keys
    .map((k, i) => {
      const f = weights[i] / sum;
      return {
        key: k,
        calls: Math.round(totalCalls * f),
        inputTokens: Math.round(totalTokens * f * 0.65),
        outputTokens: Math.round(totalTokens * f * 0.35),
        totalTokens: Math.round(totalTokens * f),
        totalCost: totalCost * f,
        avgLatencyMs: Math.round(500 + r() * 1200),
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);
}

function mockRecent(limit, offset) {
  const r = rng(99 + offset);
  const out = [];
  for (let i = 0; i < limit; i++) {
    const idx = offset + i;
    const m = MOCK_MODELS[Math.floor(r() * MOCK_MODELS.length)];
    const tag = MOCK_TAGS[Math.floor(r() * MOCK_TAGS.length)];
    const inputTokens = Math.round(300 + r() * 3200);
    const outputTokens = Math.round(120 + r() * 1600);
    const inputCost = (inputTokens * m.inRate) / 1e6;
    const outputCost = (outputTokens * m.outRate) / 1e6;
    out.push({
      id: "mock-" + idx,
      timestamp: Date.now() - idx * (1_800_000 + Math.round(r() * 5_400_000)),
      provider: m.provider,
      model: m.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      latencyMs: Math.round(280 + r() * 1900),
      tag,
      estimated: r() < 0.12,
      pricingMissing: false,
    });
  }
  return out;
}

function mockApi(path, p) {
  const window = p.window ?? "month";
  switch (path) {
    case "/api/overview":
      return mockOverview(window);
    case "/api/timeseries":
      return mockTimeseries(window, p.granularity ?? "day");
    case "/api/activity":
      return mockPool();
    case "/api/recent":
      return mockRecent(Number(p.limit) || 25, Number(p.offset) || 0);
    case "/api/by":
      return mockBy(p.by ?? "tag", window);
    default:
      return {};
  }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c != null) node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// ---------- Overview cards ----------
async function renderOverview() {
  const ov = await api("/api/overview");
  const cards = [
    { k: "Total cost", v: fmtUSD(ov.totalCost), sub: `${fmtInt(ov.calls)} calls` },
    { k: "Total tokens", v: fmtInt(ov.totalTokens), sub: `${fmtInt(ov.inputTokens)} in / ${fmtInt(ov.outputTokens)} out` },
    { k: "Avg latency", v: Math.round(ov.avgLatencyMs) + " ms", sub: "per call" },
    { k: "Estimated", v: Math.round(ov.estimatedShare * 100) + "%", sub: "of calls" },
  ];
  const wrap = $("#cards");
  wrap.replaceChildren(
    ...cards.map((c) =>
      el("div", { class: "card" }, [
        el("div", { class: "k" }, c.k),
        el("div", { class: "v" }, c.v),
        el("div", { class: "sub" }, c.sub),
      ]),
    ),
  );
  renderBudget(ov.budget);
}

function renderBudget(b) {
  const panel = $("#budget-panel");
  if (!b) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const ratio = Math.min(1, b.ratio);
  const fill = $("#budget-fill");
  fill.style.width = (ratio * 100).toFixed(1) + "%";
  fill.className = "budget-fill" + (b.ratio >= 1 ? " red" : b.ratio >= 0.8 ? " amber" : "");
  $("#budget-label").textContent =
    `${fmtUSD(b.spent)} of ${fmtUSD(b.limit)} ${b.window} budget used (${Math.round(b.ratio * 100)}%)`;
}

// ---------- SVG area chart (cost over time) ----------
async function renderTimeseries() {
  const data = await api("/api/timeseries", { granularity: state.gran });
  const box = $("#timeseries");
  if (!data.length) {
    box.replaceChildren(el("div", { class: "empty" }, "No data in this window yet."));
    return;
  }
  const W = 920;
  const H = 220;
  const pad = { l: 52, r: 12, t: 14, b: 28 };
  const max = Math.max(...data.map((d) => d.totalCost), 0.0001);
  const n = data.length;
  const x = (i) => pad.l + (n === 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);

  const linePts = data.map((d, i) => `${x(i)},${y(d.totalCost)}`).join(" ");
  const areaPts = `${pad.l},${H - pad.b} ${linePts} ${x(n - 1)},${H - pad.b}`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = pad.t + f * (H - pad.t - pad.b);
      const val = max * (1 - f);
      return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="#2a2a2a"/>
              <text x="${pad.l - 8}" y="${yy + 4}" fill="#8b90a3" font-size="11" text-anchor="end">${fmtUSD(val)}</text>`;
    })
    .join("");

  const labelEvery = Math.ceil(n / 7);
  const xLabels = data
    .map((d, i) =>
      i % labelEvery === 0
        ? `<text x="${x(i)}" y="${H - 8}" fill="#8b90a3" font-size="11" text-anchor="middle">${shortDate(d.bucket)}</text>`
        : "",
    )
    .join("");

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="cost over time">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <polygon points="${areaPts}" fill="url(#areaGrad)"/>
      <polyline points="${linePts}" fill="none" stroke="#6ee7b7" stroke-width="2"/>
      ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.totalCost)}" r="2.5" fill="#6ee7b7"><title>${shortDate(d.bucket)}: ${fmtUSD(d.totalCost)}</title></circle>`).join("")}
      ${xLabels}
    </svg>`;
}

function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function isoDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

// ---------- Activity heatmap (GitHub-style, 2D grid + 3D isometric) ----------
const DAY_MS = 86_400_000;
const HEAT_TOP = ["#232830", "#0e4429", "#006d32", "#26a641", "#39d353"];
const HEAT_LEFT = ["#1a1e24", "#0a3320", "#005526", "#1d8033", "#2cb344"];
const HEAT_RIGHT = ["#14171c", "#072617", "#003d1b", "#156026", "#1f8a35"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcMidnight(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function heatLevel(a, maxCalls) {
  if (!a || !a.calls) return 0;
  const r = a.calls / maxCalls;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

function heatTitle(ts, a) {
  return a
    ? `${isoDate(ts)}: ${a.calls} calls, ${fmtTokens(a.totalTokens)} tokens, ${fmtUSD(a.totalCost)}`
    : `${isoDate(ts)}: no activity`;
}

function heatGrid() {
  // Sunday-start weeks, trailing 52, ending on today (UTC).
  const today = utcMidnight(Date.now());
  const weeks = 52;
  const firstSunday = today - new Date(today).getUTCDay() * DAY_MS - (weeks - 1) * 7 * DAY_MS;
  return { today, weeks, firstSunday };
}

async function renderHeatmap(refetch = true) {
  if (refetch || !state.activity) state.activity = await api("/api/activity", { days: 365 });
  const days = new Map(state.activity.map((a) => [a.bucket, a]));
  const maxCalls = Math.max(1, ...state.activity.map((a) => a.calls));
  const box = $("#heatmap");
  if (state.heatmode === "2d") renderHeat2D(box, days, maxCalls);
  else renderHeat3D(box, days, maxCalls);
}

function renderHeat2D(box, days, maxCalls) {
  const { today, weeks, firstSunday } = heatGrid();
  const cell = 12;
  const step = 15;
  const padL = 32;
  const padT = 18;
  const W = padL + weeks * step + 4;
  const H = padT + 7 * step + 4;

  let rects = "";
  let monthLabels = "";
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const weekStart = firstSunday + w * 7 * DAY_MS;
    const m = new Date(weekStart).getUTCMonth();
    if (m !== lastMonth) {
      monthLabels += `<text x="${padL + w * step}" y="11" fill="#8b90a3" font-size="10">${MONTHS[m]}</text>`;
      lastMonth = m;
    }
    for (let d = 0; d < 7; d++) {
      const ts = weekStart + d * DAY_MS;
      if (ts > today) continue;
      const a = days.get(ts);
      const lv = heatLevel(a, maxCalls);
      rects += `<rect x="${padL + w * step}" y="${padT + d * step}" width="${cell}" height="${cell}" rx="3" fill="${HEAT_TOP[lv]}"><title>${heatTitle(ts, a)}</title></rect>`;
    }
  }
  const dayLabels = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ]
    .map(
      ([d, name]) =>
        `<text x="${padL - 6}" y="${padT + d * step + 10}" fill="#8b90a3" font-size="9" text-anchor="end">${name}</text>`,
    )
    .join("");

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="activity heatmap">${monthLabels}${dayLabels}${rects}</svg>`;
}

function renderHeat3D(box, days, maxCalls) {
  const { today, weeks, firstSunday } = heatGrid();
  // Axonometric strip: week axis nearly horizontal, day axis down-left.
  const WX = 10;
  const WY = 2.2; // grid step along weeks
  const DX = -7;
  const DY = 5; // grid step along days
  const ux = 9;
  const uy = 2; // tile edge along weeks (smaller than step -> gap)
  const vx = -6.3;
  const vy = 4.5; // tile edge along days
  const maxH = 24;
  const ox = 7 * -DX + 8;
  const oy = maxH + 10;
  const W = ox + weeks * WX + ux + 8;
  const H = oy + weeks * WY + 6 * DY + vy + uy + 8;

  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const ts = firstSunday + (w * 7 + d) * DAY_MS;
      if (ts > today) continue;
      cells.push({ w, d, ts, a: days.get(ts) });
    }
  }
  // Paint back-to-front so taller front boxes occlude correctly.
  cells.sort((p, q) => p.w * WY + p.d * DY - (q.w * WY + q.d * DY));

  let shapes = "";
  for (const c of cells) {
    const x = ox + c.w * WX + c.d * DX;
    const y = oy + c.w * WY + c.d * DY;
    const lv = heatLevel(c.a, maxCalls);
    const h = c.a && c.a.calls ? 3 + (c.a.calls / maxCalls) * maxH : 1;
    const t = y - h;
    const title = `<title>${heatTitle(c.ts, c.a)}</title>`;
    const top = `M${x},${t} l${ux},${uy} l${vx},${vy} l${-ux},${-uy} Z`;
    const faceV = `M${x + ux},${t + uy} l${vx},${vy} l0,${h} l${-vx},${-vy} Z`;
    const faceU = `M${x + vx},${t + vy} l${ux},${uy} l0,${h} l${-ux},${-uy} Z`;
    shapes += `<g>${title}<path d="${faceV}" fill="${HEAT_RIGHT[lv]}"/><path d="${faceU}" fill="${HEAT_LEFT[lv]}"/><path d="${top}" fill="${HEAT_TOP[lv]}"/></g>`;
  }

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="activity heatmap (3D)">${shapes}</svg>`;
}

// ---------- Usage trend (stacked token bars) ----------
async function renderTrend() {
  const data = await api("/api/timeseries", { granularity: "day" });
  const box = $("#trend");
  $("#trend-start").textContent = data.length ? isoDate(data[0].bucket) : "";
  $("#trend-end").textContent = data.length ? isoDate(data[data.length - 1].bucket) : "";
  if (!data.length) {
    box.replaceChildren(el("div", { class: "empty" }, "No data in this window yet."));
    return;
  }
  const W = 920;
  const H = state.trendTall ? 420 : 240;
  const pad = { l: 46, r: 12, t: 14, b: 10 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.totalTokens), 1);
  const n = data.length;
  const slot = plotW / n;
  const bw = Math.max(3, Math.min(26, slot * 0.72));
  const y = (v) => H - pad.b - (v / max) * plotH;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = pad.t + f * plotH;
      return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="#2a2a2a"/>
              <text x="${pad.l - 8}" y="${yy + 4}" fill="#8b90a3" font-size="11" text-anchor="end">${fmtTokens(max * (1 - f))}</text>`;
    })
    .join("");

  let bars = "";
  data.forEach((d, i) => {
    const cx = pad.l + slot * i + (slot - bw) / 2;
    // Estimated tokens overlap input/output totals; scale in/out down so the
    // stack still sums to totalTokens.
    const est = Math.min(d.estimatedTokens ?? 0, d.totalTokens);
    const scale = d.totalTokens > 0 ? (d.totalTokens - est) / d.totalTokens : 0;
    const inSeg = (d.inputTokens ?? 0) * scale;
    const outSeg = (d.outputTokens ?? 0) * scale;
    const title = `<title>${isoDate(d.bucket)}: ${fmtTokens(d.totalTokens)} tokens (${fmtTokens(d.inputTokens ?? 0)} in / ${fmtTokens(d.outputTokens ?? 0)} out), ${d.calls} calls, ${fmtUSD(d.totalCost)}</title>`;
    let base = 0;
    let segs = "";
    for (const [v, color] of [
      [inSeg, "#f08a4b"],
      [outSeg, "#2dd4a7"],
      [est, "#f472b6"],
    ]) {
      if (v <= 0) continue;
      const y1 = y(base + v);
      segs += `<rect x="${cx}" y="${y1}" width="${bw}" height="${Math.max(1, y(base) - y1)}" rx="1.5" fill="${color}"/>`;
      base += v;
    }
    bars += `<g>${title}${segs}</g>`;
  });

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="token usage trend">${grid}${bars}</svg>`;
}

// ---------- By feature (bars + table) ----------
async function renderBy() {
  const rows = await api("/api/by", { by: state.by });
  const chart = $("#by-chart");
  const tbl = $("#by-table");
  if (!rows.length) {
    chart.replaceChildren(el("div", { class: "empty" }, "No data."));
    tbl.replaceChildren();
    return;
  }
  const max = Math.max(...rows.map((r) => r.totalCost), 0.0001);
  chart.replaceChildren(
    ...rows.slice(0, 10).map((r) =>
      el("div", { class: "bar-row" }, [
        el("div", { class: "name", title: r.key }, r.key),
        el("div", { class: "bar-track" }, [
          el("div", { class: "bar-fill", style: `width:${Math.max(2, (r.totalCost / max) * 100)}%` }),
        ]),
        el("div", { class: "val" }, fmtUSD(r.totalCost)),
      ]),
    ),
  );

  const head = el("tr", {}, [
    el("th", {}, state.by),
    el("th", { class: "num" }, "calls"),
    el("th", { class: "num" }, "tokens"),
    el("th", { class: "num" }, "cost"),
  ]);
  const body = rows.map((r) =>
    el("tr", {}, [
      el("td", {}, r.key),
      el("td", { class: "num" }, fmtInt(r.calls)),
      el("td", { class: "num" }, fmtInt(r.totalTokens)),
      el("td", { class: "num" }, fmtUSD(r.totalCost)),
    ]),
  );
  tbl.replaceChildren(el("table", {}, [el("thead", {}, head), el("tbody", {}, body)]));
}

// ---------- Recent calls ----------
async function renderRecent() {
  const limit = state.pageSize;
  const offset = state.page * limit;
  const rows = await api("/api/recent", { limit, offset });
  const box = $("#recent");
  if (!rows.length && state.page === 0) {
    box.replaceChildren(el("div", { class: "empty" }, "No calls recorded yet."));
  } else {
    const head = el("tr", {}, [
      el("th", {}, "time"),
      el("th", {}, "tag"),
      el("th", {}, "model"),
      el("th", { class: "num" }, "in"),
      el("th", { class: "num" }, "out"),
      el("th", { class: "num" }, "cost"),
      el("th", { class: "num" }, "ms"),
      el("th", {}, ""),
    ]);
    const body = rows.map((r) =>
      el("tr", {}, [
        el("td", {}, fmtTime(r.timestamp)),
        el("td", {}, r.tag),
        el("td", {}, r.model),
        el("td", { class: "num" }, fmtInt(r.inputTokens)),
        el("td", { class: "num" }, fmtInt(r.outputTokens)),
        el("td", { class: "num" }, fmtUSD(r.totalCost)),
        el("td", { class: "num" }, String(r.latencyMs)),
        el("td", {}, r.estimated ? el("span", { class: "badge" }, "est") : ""),
      ]),
    );
    box.replaceChildren(el("table", {}, [el("thead", {}, head), el("tbody", {}, body)]));
  }
  $("#prev").disabled = state.page === 0;
  $("#next").disabled = rows.length < limit;
  $("#page-label").textContent = `page ${state.page + 1}`;
}

// ---------- wiring ----------
function bindSeg(id, key, after) {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const val = btn.dataset[Object.keys(btn.dataset)[0]];
    state[key] = val;
    for (const b of $(id).children) b.classList.toggle("active", b === btn);
    after();
  });
}

async function refreshAll() {
  await Promise.all([
    renderOverview(),
    renderTimeseries(),
    renderHeatmap(),
    renderTrend(),
    renderBy(),
    renderRecent(),
  ]);
}

bindSeg("#window-seg", "window", () => {
  state.page = 0;
  refreshAll();
});
bindSeg("#gran-seg", "gran", renderTimeseries);
bindSeg("#heat-seg", "heatmode", () => renderHeatmap(false));
bindSeg("#by-seg", "by", renderBy);
$("#trend-expand").addEventListener("click", () => {
  state.trendTall = !state.trendTall;
  $("#trend-expand").classList.toggle("active", state.trendTall);
  renderTrend();
});
$("#prev").addEventListener("click", () => {
  if (state.page > 0) {
    state.page--;
    renderRecent();
  }
});
$("#next").addEventListener("click", () => {
  state.page++;
  renderRecent();
});

$("#tz-label").textContent = (() => {
  const m = -new Date().getTimezoneOffset();
  const sign = m >= 0 ? "+" : "-";
  const a = Math.abs(m);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
})();

refreshAll().catch((err) => {
  document.body.append(el("div", { class: "empty" }, "Failed to load: " + err.message));
});

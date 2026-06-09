// tokenmeter dashboard — vanilla JS, hand-rolled SVG charts. No external deps.
const state = { window: "month", gran: "day", by: "model", tab: "daily", page: 0, pageSize: 25 };

const $ = (sel) => document.querySelector(sel);

const fmtUSD = (n) => {
  n = n ?? 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n >= 100 ? 2 : n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1 ? 2 : 4 });
};
const fmtInt = (n) => (n ?? 0).toLocaleString("en-US");
const fmtCompact = (n) => {
  n = n ?? 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};
const fmtTime = (ts) =>
  new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const PALETTE = ["#e8835a", "#5b8def", "#4ec9a3", "#a78bfa", "#ec6cb0", "#e0b454", "#56b6c2", "#d98c5f"];
const colorFor = (i) => PALETTE[i % PALETTE.length];
const WINDOW_LABEL = { day: "today", week: "this week", month: "this month", total: "all time" };

async function api(path, params = {}) {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries({ window: state.window, ...params })) {
    u.searchParams.set(k, v);
  }
  const res = await fetch(u);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// ───────────── Overview: hero + stat tiles + budget ─────────────
async function renderOverview() {
  const ov = await api("/api/overview");

  $("#hero-total").textContent = fmtUSD(ov.totalCost);
  $("#hero-tokens").textContent = `${fmtCompact(ov.totalTokens)} tokens · ${fmtInt(ov.calls)} calls`;

  // input / output stacked bar
  const inT = ov.inputTokens || 0;
  const outT = ov.outputTokens || 0;
  const tot = inT + outT || 1;
  $("#stack-bar").replaceChildren(
    el("span", { style: `width:${(inT / tot) * 100}%;background:${PALETTE[1]}` }),
    el("span", { style: `width:${(outT / tot) * 100}%;background:${PALETTE[0]}` }),
  );
  $("#stack-legend").replaceChildren(
    legendItem(PALETTE[1], "Input", fmtCompact(inT)),
    legendItem(PALETTE[0], "Output", fmtCompact(outT)),
  );

  const tiles = [
    { k: "Total tokens", v: fmtCompact(ov.totalTokens), sub: `${fmtInt(ov.inputTokens)} in` },
    { k: "Total cost", v: fmtUSD(ov.totalCost), sub: `${WINDOW_LABEL[state.window]}` },
    { k: "Avg latency", v: Math.round(ov.avgLatencyMs) + " ms", sub: "per call" },
    { k: "Estimated", v: Math.round(ov.estimatedShare * 100) + "%", sub: "of calls" },
  ];
  $("#stat-grid").replaceChildren(
    ...tiles.map((t) =>
      el("div", { class: "stat" }, [
        el("div", { class: "k" }, t.k),
        el("div", { class: "v" }, t.v),
        el("div", { class: "sub" }, t.sub),
      ]),
    ),
  );

  $("#meta-row").replaceChildren(
    el("span", { html: `Calls&nbsp; <b>${fmtInt(ov.calls)}</b>` }),
    el("span", { html: `Output&nbsp; <b>${fmtCompact(ov.outputTokens)}</b>` }),
  );

  $("#window-sub").textContent = `usage & cost · ${WINDOW_LABEL[state.window]}`;
  renderBudget(ov.budget);
}

function legendItem(color, label, value) {
  return el("span", { class: "item" }, [
    el("span", { class: "swatch", style: `background:${color}` }),
    el("span", {}, label),
    el("b", {}, value),
  ]);
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

// ───────────── Breakdown ranked list ─────────────
async function renderBreakdown() {
  const rows = await api("/api/by", { by: state.by });
  const box = $("#rank");
  if (!rows.length) {
    box.replaceChildren(el("div", { class: "empty" }, "No data in this window yet."));
    return;
  }
  const total = rows.reduce((s, r) => s + r.totalCost, 0) || 1;
  const sorted = [...rows].sort((a, b) => b.totalCost - a.totalCost).slice(0, 8);
  box.replaceChildren(
    ...sorted.map((r, i) => {
      const pct = (r.totalCost / total) * 100;
      const color = colorFor(i);
      return el("div", { class: "rank-row" }, [
        el("div", { class: "num" }, String(i + 1)),
        el("div", { class: "body" }, [
          el("div", { class: "name", title: r.key }, [
            el("span", { class: "dot", style: `background:${color}` }),
            r.key || "—",
          ]),
          el("div", { class: "track" }, [
            el("div", { class: "fill", style: `width:${Math.max(2, pct)}%;background:${color}` }),
          ]),
        ]),
        el("div", { class: "pct" }, pct.toFixed(1) + "%"),
      ]);
    }),
  );
}

// ───────────── Provider cards ─────────────
async function renderProviders() {
  const rows = await api("/api/by", { by: "provider" });
  const grid = $("#provider-grid");
  if (!rows.length) {
    grid.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" }, "No providers tracked yet."));
    return;
  }
  const total = rows.reduce((s, r) => s + r.totalCost, 0) || 1;
  const sorted = [...rows].sort((a, b) => b.totalCost - a.totalCost);
  grid.replaceChildren(
    ...sorted.map((r, i) => {
      const pct = (r.totalCost / total) * 100;
      const color = colorFor(i);
      const letter = (r.key || "?").charAt(0).toUpperCase();
      return el("div", { class: "pcard" }, [
        el("div", { class: "top" }, [
          el("div", { class: "badge", style: `background:${color}` }, letter),
          el("div", { class: "pname", title: r.key }, r.key || "unknown"),
        ]),
        el("div", { class: "pval" }, pct.toFixed(1) + "%"),
        el("div", { class: "ptrack" }, [
          el("div", { class: "pfill", style: `width:${Math.max(2, pct)}%;background:${color}` }),
        ]),
        el("div", { class: "psub" }, [
          el("span", {}, fmtUSD(r.totalCost)),
          el("span", {}, fmtCompact(r.totalTokens) + " tok"),
        ]),
      ]);
    }),
  );
}

// ───────────── Activity heatmap (all-time daily calls) ─────────────
const DAY_MS = 86_400_000;
function heatColor(level) {
  const a = [0, 0.28, 0.5, 0.74, 1][level];
  return level === 0 ? "var(--surface-2)" : `rgba(232, 131, 90, ${a})`;
}
async function renderHeatmap() {
  const data = await api("/api/timeseries", { window: "total", granularity: "day" });
  const byDay = new Map(data.map((d) => [d.bucket, d]));
  const maxCalls = Math.max(1, ...data.map((d) => d.calls));

  const weeks = 18;
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const start = todayUTC - daysSinceMonday * DAY_MS - (weeks - 1) * 7 * DAY_MS;

  const cells = [];
  let totalCalls = 0;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const key = start + (w * 7 + d) * DAY_MS;
      if (key > todayUTC) {
        cells.push(el("span", { class: "heat-cell", style: "opacity:0" }));
        continue;
      }
      const bucket = byDay.get(key);
      const calls = bucket ? bucket.calls : 0;
      totalCalls += calls;
      const level = calls === 0 ? 0 : Math.min(4, Math.ceil((calls / maxCalls) * 4));
      const date = new Date(key).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
      cells.push(
        el("span", {
          class: "heat-cell",
          style: `background:${heatColor(level)}`,
          title: bucket ? `${date}: ${fmtInt(calls)} calls · ${fmtUSD(bucket.totalCost)}` : `${date}: no activity`,
        }),
      );
    }
  }
  $("#heat-grid").replaceChildren(...cells);
  $("#heat-total").textContent = `${fmtInt(totalCalls)} calls · ${weeks}w`;
  $("#heat-scale").replaceChildren(
    ...[0, 1, 2, 3, 4].map((l) => el("i", { style: `background:${heatColor(l)}` })),
  );
}

// ───────────── Usage trend bar chart ─────────────
async function renderTrend() {
  const data = await api("/api/timeseries", { granularity: state.gran });
  const box = $("#trend");
  if (!data.length) {
    box.replaceChildren(el("div", { class: "empty" }, "No data in this window yet."));
    return;
  }
  const W = 920;
  const H = 240;
  const pad = { l: 56, r: 14, t: 16, b: 34 };
  const max = Math.max(...data.map((d) => d.totalCost), 0.0001);
  const n = data.length;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / n;
  const bw = Math.max(3, Math.min(34, slot * 0.62));
  const y = (v) => pad.t + plotH - (v / max) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = pad.t + f * plotH;
      const val = max * (1 - f);
      return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="#222"/>
        <text x="${pad.l - 10}" y="${yy + 4}" fill="#7d7d7d" font-size="11" text-anchor="end">${fmtUSD(val)}</text>`;
    })
    .join("");

  const bars = data
    .map((d, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const x = cx - bw / 2;
      const yy = y(d.totalCost);
      const h = Math.max(1, pad.t + plotH - yy);
      const r = Math.min(bw / 2, 5);
      return `<rect class="bar" x="${x}" y="${yy}" width="${bw}" height="${h}" rx="${r}" fill="url(#barGrad)">
        <title>${shortDate(d.bucket)}: ${fmtUSD(d.totalCost)} · ${fmtInt(d.calls)} calls</title></rect>`;
    })
    .join("");

  const labelEvery = Math.ceil(n / 8);
  const xLabels = data
    .map((d, i) =>
      i % labelEvery === 0
        ? `<text x="${pad.l + slot * i + slot / 2}" y="${H - 10}" fill="#7d7d7d" font-size="11" text-anchor="middle">${shortDate(d.bucket)}</text>`
        : "",
    )
    .join("");

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="usage trend">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f0976f"/>
          <stop offset="100%" stop-color="#d3633a"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${bars}
      ${xLabels}
    </svg>`;
}

function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
function longDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

// ───────────── Detail tables (daily / recent) ─────────────
async function renderDetail() {
  $("#pager").hidden = state.tab !== "recent";
  if (state.tab === "daily") return renderDaily();
  return renderRecent();
}

async function renderDaily() {
  const data = await api("/api/timeseries", { granularity: "day" });
  const box = $("#detail-body");
  if (!data.length) {
    box.replaceChildren(el("div", { class: "empty" }, "No data in this window yet."));
    return;
  }
  const rows = [...data].sort((a, b) => b.bucket - a.bucket);
  const head = el("tr", {}, [
    el("th", {}, "Date"),
    el("th", { class: "num" }, "Calls"),
    el("th", { class: "num" }, "Tokens"),
    el("th", { class: "num" }, "Cost"),
    el("th", { class: "num" }, "Avg / call"),
  ]);
  const body = rows.map((r) =>
    el("tr", {}, [
      el("td", { class: "strong" }, longDate(r.bucket)),
      el("td", { class: "num" }, fmtInt(r.calls)),
      el("td", { class: "num" }, fmtInt(r.totalTokens)),
      el("td", { class: "num strong" }, fmtUSD(r.totalCost)),
      el("td", { class: "num" }, fmtUSD(r.calls ? r.totalCost / r.calls : 0)),
    ]),
  );
  box.replaceChildren(el("table", {}, [el("thead", {}, head), el("tbody", {}, body)]));
}

async function renderRecent() {
  const limit = state.pageSize;
  const offset = state.page * limit;
  const rows = await api("/api/recent", { limit, offset });
  const box = $("#detail-body");
  if (!rows.length && state.page === 0) {
    box.replaceChildren(el("div", { class: "empty" }, "No calls recorded yet."));
  } else {
    const head = el("tr", {}, [
      el("th", {}, "Time"),
      el("th", {}, "Tag"),
      el("th", {}, "Model"),
      el("th", { class: "num" }, "In"),
      el("th", { class: "num" }, "Out"),
      el("th", { class: "num" }, "Cost"),
      el("th", { class: "num" }, "ms"),
      el("th", {}, ""),
    ]);
    const body = rows.map((r) =>
      el("tr", {}, [
        el("td", {}, fmtTime(r.timestamp)),
        el("td", {}, el("span", { class: "pill" }, r.tag || "—")),
        el("td", { class: "strong" }, r.model),
        el("td", { class: "num" }, fmtInt(r.inputTokens)),
        el("td", { class: "num" }, fmtInt(r.outputTokens)),
        el("td", { class: "num strong" }, fmtUSD(r.totalCost)),
        el("td", { class: "num" }, String(r.latencyMs)),
        el("td", {}, r.estimated ? el("span", { class: "badge-est" }, "est") : ""),
      ]),
    );
    box.replaceChildren(el("table", {}, [el("thead", {}, head), el("tbody", {}, body)]));
  }
  $("#prev").disabled = state.page === 0;
  $("#next").disabled = rows.length < limit;
  $("#page-label").textContent = `page ${state.page + 1}`;
}

// ───────────── Wiring ─────────────
function bindSeg(id, key, after) {
  $(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state[key] = btn.dataset[Object.keys(btn.dataset)[0]];
    for (const b of $(id).children) b.classList.toggle("active", b === btn);
    after();
  });
}

async function refreshAll() {
  await Promise.all([
    renderOverview(),
    renderBreakdown(),
    renderProviders(),
    renderHeatmap(),
    renderTrend(),
    renderDetail(),
  ]);
}

bindSeg("#window-seg", "window", () => {
  state.page = 0;
  refreshAll();
});
bindSeg("#gran-seg", "gran", renderTrend);
bindSeg("#by-seg", "by", renderBreakdown);

// detail tabs
$("#detail-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  state.page = 0;
  for (const b of $("#detail-tabs").children) b.classList.toggle("active", b === btn);
  renderDetail();
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

// refresh button
$("#refresh").addEventListener("click", () => {
  const btn = $("#refresh");
  btn.classList.add("spin");
  setTimeout(() => btn.classList.remove("spin"), 350);
  refreshAll();
});

// sidebar nav: scroll to section + active state
const navItems = [...document.querySelectorAll(".nav-item")];
for (const item of navItems) {
  item.addEventListener("click", () => {
    const target = document.getElementById(item.dataset.target);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        for (const it of navItems) it.classList.toggle("active", it.dataset.target === e.target.id);
      }
    }
  },
  { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
);
for (const id of ["sec-overview", "sec-trend", "sec-providers", "sec-detail"]) {
  const node = document.getElementById(id);
  if (node) spy.observe(node);
}

refreshAll().catch((err) => {
  document.body.append(el("div", { class: "empty" }, "Failed to load: " + err.message));
});

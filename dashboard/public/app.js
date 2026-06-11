// tokenmeter dashboard — vanilla JS, hand-rolled SVG charts. No external deps.
const state = { window: "month", gran: "day", by: "tag", page: 0, pageSize: 25 };

const $ = (sel) => document.querySelector(sel);
const fmtUSD = (n) => "$" + (n ?? 0).toFixed(n >= 100 ? 2 : 4);
const fmtInt = (n) => (n ?? 0).toLocaleString("en-US");
const fmtTime = (ts) => new Date(ts).toLocaleString();

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
  await Promise.all([renderOverview(), renderTimeseries(), renderBy(), renderRecent()]);
}

bindSeg("#window-seg", "window", () => {
  state.page = 0;
  refreshAll();
});
bindSeg("#gran-seg", "gran", renderTimeseries);
bindSeg("#by-seg", "by", renderBy);
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

refreshAll().catch((err) => {
  document.body.append(el("div", { class: "empty" }, "Failed to load: " + err.message));
});

// tokenmeter playground — a tiny local server with buttons that fire real LLM
// calls of varying token cost, so you can watch the dashboard fill up.
//
//   1. cp playground/.env.example playground/.env   (then paste your keys)
//   2. node playground/server.mjs                    (from the project root)
//   3. open http://127.0.0.1:4000  and click buttons
//   4. npx tokenmeter dashboard                      (in another terminal)
//
// Both processes read/write the SAME store (./.tokenmeter/usage.db), so calls
// made here show up live in the dashboard.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configure, withTracking } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 4000);

// ---- minimal .env loader (zero deps) ------------------------------------
function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env file — rely on real environment variables */
  }
}
loadEnv();

const GROQ_KEY = process.env.GROQ_API_KEY ?? "";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";

// ---- point tokenmeter at the same store the dashboard reads --------------
configure({
  store: "sqlite",
  dbPath: resolve(PROJECT_ROOT, ".tokenmeter", "usage.db"),
  redactPrompts: true,
  // Groq isn't in the bundled price table; add rates so cost shows up. Gemini
  // entries are merged over the built-ins to also cover suffixed modelVersions.
  pricing: {
    groq: {
      "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },
      "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
    },
    gemini: {
      "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
      "gemini-2.5-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4 },
      "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
    },
  },
});

// ---- provider clients (lazy; only built if a key is present) -------------
let _groq;
let _gemini;

function groqClient() {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY is not set (add it to playground/.env)");
  if (_groq) return _groq;
  // Minimal OpenAI-shaped client over fetch — no SDK needed. tokenmeter's
  // proxy only intercepts chat.completions.create, so that's all we expose.
  const raw = {
    chat: {
      completions: {
        create: async (body) => {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GROQ_KEY}`,
            },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
          }
          return res.json();
        },
      },
    },
  };
  _groq = withTracking(raw, { provider: "openai-compatible", providerLabel: "groq" });
  return _groq;
}

async function geminiClient() {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set (add it to playground/.env)");
  if (_gemini) return _gemini;
  const { GoogleGenAI } = await import("@google/genai");
  _gemini = withTracking(new GoogleGenAI({ apiKey: GEMINI_KEY }));
  return _gemini;
}

// ---- prompt sizing helpers -----------------------------------------------
const LOREM =
  "The quick brown fox jumps over the lazy dog while the engineering team " +
  "debates token budgets, latency tradeoffs, and the cost of a single API call. ";

function promptOf(approxWords) {
  const reps = Math.max(1, Math.ceil(approxWords / 20));
  return LOREM.repeat(reps).trim();
}

// ---- scenario catalog: varied provider / model / tag / token size --------
// `level` drives a rough cost tier shown in the UI: 1 = tiny … 4 = large.
const SCENARIOS = {
  // --- Groq (cheap, fast) ---
  "groq-classify-tiny": {
    label: "Groq · classify (tiny)",
    provider: "groq",
    level: 1,
    tag: "classify",
    model: "llama-3.1-8b-instant",
    prompt: "Reply with exactly one word — the sentiment of: 'I love this product!'",
    maxTokens: 8,
  },
  "groq-summarize-small": {
    label: "Groq · summarize (small)",
    provider: "groq",
    level: 2,
    tag: "summarize",
    model: "llama-3.1-8b-instant",
    prompt: `Summarize in one sentence:\n${promptOf(120)}`,
    maxTokens: 120,
  },
  "groq-draft-medium": {
    label: "Groq · draft (medium)",
    provider: "groq",
    level: 3,
    tag: "draft",
    model: "llama-3.3-70b-versatile",
    prompt: `Write a short professional email based on these notes:\n${promptOf(250)}`,
    maxTokens: 400,
  },
  "groq-codegen-large": {
    label: "Groq · codegen (large)",
    provider: "groq",
    level: 4,
    tag: "codegen",
    model: "llama-3.3-70b-versatile",
    prompt: `Given this context, write a detailed implementation plan:\n${promptOf(700)}`,
    maxTokens: 900,
  },

  // --- Gemini ---
  "gemini-classify-tiny": {
    label: "Gemini · classify (tiny)",
    provider: "gemini",
    level: 1,
    tag: "classify",
    model: "gemini-2.5-flash-lite",
    prompt: "Reply with one word: is 'refund my order' a complaint or a request?",
    maxTokens: 16,
  },
  "gemini-translate-small": {
    label: "Gemini · translate (small)",
    provider: "gemini",
    level: 2,
    tag: "translate",
    model: "gemini-2.5-flash-lite",
    prompt: `Translate to French:\n${promptOf(80)}`,
    maxTokens: 150,
  },
  "gemini-summarize-medium": {
    label: "Gemini · summarize (medium)",
    provider: "gemini",
    level: 3,
    tag: "summarize",
    model: "gemini-2.5-flash",
    prompt: `Summarize the key points as bullets:\n${promptOf(400)}`,
    maxTokens: 500,
  },
  "gemini-chat-large": {
    label: "Gemini · chat (large)",
    provider: "gemini",
    level: 4,
    tag: "chat",
    model: "gemini-2.5-flash",
    prompt: `Answer thoroughly with examples:\n${promptOf(800)}`,
    maxTokens: 1000,
  },
};

// ---- run one scenario, return a compact result for the UI ----------------
async function runScenario(id) {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`unknown scenario: ${id}`);
  const t0 = Date.now();

  let usage = null;
  let text = "";

  if (s.provider === "groq") {
    const client = groqClient().withTag(s.tag);
    const r = await client.chat.completions.create({
      model: s.model,
      max_tokens: s.maxTokens,
      messages: [{ role: "user", content: s.prompt }],
    });
    usage = {
      inputTokens: r.usage?.prompt_tokens ?? 0,
      outputTokens: r.usage?.completion_tokens ?? 0,
    };
    text = r.choices?.[0]?.message?.content ?? "";
  } else {
    const client = (await geminiClient()).withTag(s.tag);
    const r = await client.models.generateContent({
      model: s.model,
      contents: s.prompt,
      config: { maxOutputTokens: s.maxTokens },
    });
    usage = {
      inputTokens: r.usageMetadata?.promptTokenCount ?? 0,
      outputTokens:
        (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0),
    };
    text = typeof r.text === "string" ? r.text : (r.text?.() ?? "");
  }

  return {
    id,
    label: s.label,
    provider: s.provider,
    model: s.model,
    tag: s.tag,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - t0,
    preview: String(text).replace(/\s+/g, " ").slice(0, 140),
  };
}

// ---- HTTP server ----------------------------------------------------------
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, PAGE, "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/api/scenarios") {
      const list = Object.entries(SCENARIOS).map(([id, s]) => ({
        id,
        label: s.label,
        provider: s.provider,
        model: s.model,
        tag: s.tag,
        level: s.level,
      }));
      return send(res, 200, {
        scenarios: list,
        keys: { groq: Boolean(GROQ_KEY), gemini: Boolean(GEMINI_KEY) },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      const id = url.searchParams.get("id");
      const result = await runScenario(id);
      return send(res, 200, { ok: true, result });
    }

    // Fire a random sequence of N scenarios to quickly populate the dashboard.
    if (req.method === "POST" && url.pathname === "/api/burst") {
      const n = Math.min(20, Math.max(1, Number(url.searchParams.get("n") ?? 8)));
      const ids = Object.keys(SCENARIOS).filter((id) => {
        const p = SCENARIOS[id].provider;
        return (p === "groq" && GROQ_KEY) || (p === "gemini" && GEMINI_KEY);
      });
      if (ids.length === 0) {
        return send(res, 400, { ok: false, error: "No API keys set for any provider." });
      }
      const results = [];
      for (let i = 0; i < n; i++) {
        const id = ids[i % ids.length];
        try {
          results.push(await runScenario(id));
        } catch (err) {
          results.push({ id, error: String(err.message ?? err) });
        }
      }
      return send(res, 200, { ok: true, results });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  tokenmeter playground → http://127.0.0.1:${PORT}`);
  console.log(`  store: ${resolve(PROJECT_ROOT, ".tokenmeter", "usage.db")}`);
  console.log(
    `  keys:  groq=${GROQ_KEY ? "set" : "MISSING"}  gemini=${GEMINI_KEY ? "set" : "MISSING"}`,
  );
  console.log("  dashboard: run  npx tokenmeter dashboard  (from the project root)\n");
});

// ---- the page (inline, no build step) ------------------------------------
const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tokenmeter playground</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #0a0a0a; color: #ffffff; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8b90a3; margin: 0 0 24px; }
  .keys { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .pill { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .ok { background: #173a2a; color: #4ade80; }
  .miss { background: #3a1717; color: #f87171; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { background: #171717; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px; }
  .card h3 { margin: 0 0 6px; font-size: 14px; }
  .meta { color: #8b90a3; font-size: 12px; margin-bottom: 12px; }
  .lvl { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 2px; background: #2a2a2a; }
  .lvl.on1 { background: #4ade80; } .lvl.on2 { background: #facc15; }
  .lvl.on3 { background: #fb923c; } .lvl.on4 { background: #f87171; }
  button { font: inherit; font-weight: 600; cursor: pointer; border: 0; border-radius: 8px;
           padding: 9px 14px; background: #2563eb; color: white; }
  button:hover { background: #1d4ed8; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.ghost { background: #171717; color: #ffffff; border: 1px solid #2a2a2a; }
  .bar { display: flex; gap: 10px; align-items: center; margin: 0 0 24px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #2a2a2a; }
  th { color: #8b90a3; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .err { color: #f87171; }
  .tag { background: #222222; border-radius: 6px; padding: 1px 7px; font-size: 11px; }
  code { background: #222222; padding: 2px 6px; border-radius: 5px; }
</style>
</head>
<body>
  <h1>tokenmeter playground</h1>
  <p class="sub">Click a button to fire a real LLM call of a given token size. Then run
    <code>npx tokenmeter dashboard</code> to watch it land.</p>

  <div class="keys" id="keys"></div>

  <div class="bar">
    <button id="burst">⚡ Burst (8 random calls)</button>
    <button class="ghost" id="clear">Clear log</button>
    <span class="sub" id="status"></span>
  </div>

  <div class="grid" id="grid"></div>

  <table>
    <thead><tr>
      <th>scenario</th><th>provider</th><th>model</th><th>tag</th>
      <th class="num">in</th><th class="num">out</th><th class="num">ms</th><th>preview</th>
    </tr></thead>
    <tbody id="log"></tbody>
  </table>

<script>
const $ = (s) => document.querySelector(s);
const dots = (lvl) => [1,2,3,4].map(i => '<span class="lvl ' + (i<=lvl?('on'+lvl):'') + '"></span>').join('');

let busy = false;
function setBusy(b, msg) { busy = b; $('#status').textContent = msg || ''; document.querySelectorAll('button').forEach(x => x.disabled = b); }

function logRow(r) {
  const tr = document.createElement('tr');
  if (r.error) {
    tr.innerHTML = '<td>' + r.id + '</td><td colspan="7" class="err">' + r.error + '</td>';
  } else {
    tr.innerHTML =
      '<td>' + r.label + '</td>' +
      '<td>' + r.provider + '</td>' +
      '<td>' + r.model + '</td>' +
      '<td><span class="tag">' + r.tag + '</span></td>' +
      '<td class="num">' + r.inputTokens + '</td>' +
      '<td class="num">' + r.outputTokens + '</td>' +
      '<td class="num">' + r.latencyMs + '</td>' +
      '<td class="sub">' + (r.preview || '') + '</td>';
  }
  $('#log').prepend(tr);
}

async function run(id) {
  if (busy) return;
  setBusy(true, 'Running ' + id + ' …');
  try {
    const res = await fetch('/api/run?id=' + encodeURIComponent(id), { method: 'POST' });
    const data = await res.json();
    if (data.ok) logRow(data.result);
    else logRow({ id, error: data.error });
  } catch (e) {
    logRow({ id, error: String(e) });
  } finally {
    setBusy(false);
  }
}

async function burst() {
  if (busy) return;
  setBusy(true, 'Bursting …');
  try {
    const res = await fetch('/api/burst?n=8', { method: 'POST' });
    const data = await res.json();
    if (data.ok) data.results.forEach(logRow);
    else $('#status').textContent = data.error;
  } catch (e) {
    $('#status').textContent = String(e);
  } finally {
    setBusy(false);
  }
}

async function init() {
  const { scenarios, keys } = await (await fetch('/api/scenarios')).json();
  $('#keys').innerHTML =
    '<span class="pill ' + (keys.groq ? 'ok' : 'miss') + '">GROQ_API_KEY ' + (keys.groq ? '✓ set' : '✗ missing') + '</span>' +
    '<span class="pill ' + (keys.gemini ? 'ok' : 'miss') + '">GEMINI_API_KEY ' + (keys.gemini ? '✓ set' : '✗ missing') + '</span>';

  const grid = $('#grid');
  for (const s of scenarios) {
    const keyOk = (s.provider === 'groq' && keys.groq) || (s.provider === 'gemini' && keys.gemini);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<h3>' + s.label + '</h3>' +
      '<div class="meta">' + dots(s.level) + ' &nbsp; ' + s.model + ' · <span class="tag">' + s.tag + '</span></div>' +
      '<button data-id="' + s.id + '"' + (keyOk ? '' : ' disabled') + '>Run</button>';
    grid.appendChild(card);
  }
  grid.addEventListener('click', (e) => {
    const id = e.target?.dataset?.id;
    if (id) run(id);
  });
  $('#burst').addEventListener('click', burst);
  $('#clear').addEventListener('click', () => { $('#log').innerHTML = ''; });
}
init();
</script>
</body>
</html>`;

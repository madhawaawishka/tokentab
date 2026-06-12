<p align="center">
  <img src="https://raw.githubusercontent.com/madhawaawishka/tokenmeter/main/assets/logo.svg" alt="tokentab logo" width="110" />
</p>

<h1 align="center">tokentab</h1>

<p align="center">
  <strong>Local-first LLM usage &amp; cost tracker.</strong><br/>
  Wrap your OpenAI / Anthropic / Gemini client in one line to measure tokens, cost, latency and
  per-feature spend — with a budget guard and a local dashboard. Works in Node <em>and</em> the browser.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/tokentab"><img src="https://img.shields.io/npm/v/tokentab?color=cb3837&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/tokentab"><img src="https://img.shields.io/npm/dm/tokentab" alt="npm downloads"></a>
  <a href="https://github.com/madhawaawishka/tokenmeter/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="node >= 18">
  <img src="https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white" alt="TypeScript types included">
</p>

---

```bash
npm install tokentab
```

```ts
import "tokentab/auto"; // ← one line, before your first LLM call. That's it.
```

```bash
npx tokentab dashboard
```

Every OpenAI, Anthropic and Gemini call — SDK or raw `fetch`, Node or browser —
is now counted automatically. Your tokens, cost, latency and per-feature spend,
charted in your browser, from data that **never leaves your machine**.

## Why tokentab?

LLM bills are death by a thousand cuts: which *feature* is burning the money? Provider dashboards show totals per API key, not per feature — and shipping your usage data to a SaaS just to find out is overkill.

- 🪄 **One-line setup** — wrap your existing SDK client; no proxy server, no code rewrites
- 🏷️ **Per-feature attribution** — tag calls (`summarize`, `chat`, `codegen`…) and see exactly where the spend goes
- 💸 **Cost calculation** — bundled, overridable pricing table for OpenAI, Anthropic and Gemini models
- 🚦 **Budget guard** — set a daily/weekly/monthly USD limit; `block` throws *before* the request is sent, `warn` just logs
- 📊 **Local dashboard** — `npx tokentab dashboard` for charts; `npx tokentab report` for the terminal
- 🌊 **Streaming support** — streamed responses are measured too (token counts estimated when the provider doesn't report usage)
- 🌐 **Node and browser** — server apps use a local SQLite/JSONL file; web apps (Vite, webpack, …) get a dedicated browser build backed by `localStorage`, picked automatically by the bundler
- 🔒 **Local-first & private** — prompts are never stored, and usage data never leaves your machine
- 🪶 **Zero runtime dependencies** in the core, full TypeScript types, ESM + CJS

## Installation

```bash
npm install tokentab
# or
pnpm add tokentab
# or
yarn add tokentab
```

Requires **Node.js ≥ 18** for server apps and the CLI. Browser apps need no
extra setup — any modern bundler (Vite, webpack, Rollup, esbuild) automatically
picks the package's browser build. tokentab is a JavaScript/TypeScript library;
it does not instrument Python (or other non-JS) applications.

## Quick start

### 1. Install

```bash
npm install tokentab
```

### 2. Add one line — tokens are counted automatically

```ts
import "tokentab/auto";
```

Put it once at your app's entry point (e.g. `main.ts` / `index.js` / `App.jsx`),
before the first LLM call. Nothing else to set up: every call to OpenAI,
Anthropic or Gemini is detected — whether it goes through an SDK or raw
`fetch` — and its token counts are read straight from the provider's response
(exact, not guessed; estimated only when a response carries no usage at all).
Records are appended to a local store (`./.tokenmeter/usage.db` in Node,
`localStorage` in the browser).

### 3. See where the money goes

```bash
npx tokentab dashboard   # charts at http://127.0.0.1:3000
```

Make a few LLM calls, open the dashboard, and the counted tokens and cost are
there.

### Optional: wrap a client for tags & budgets

Auto mode counts everything under one tag. To attribute spend per feature (or
use the [Budget guard](#budget-guard)), wrap the SDK client object instead:

```ts
import OpenAI from "openai";
import { withTracking } from "tokentab";

const openai = withTracking(new OpenAI()); // provider auto-detected

const summarizer = openai.withTag("summarize");
const chatbot = openai.withTag("chat");

await summarizer.chat.completions.create({ /* ... */ }); // recorded as "summarize"
await chatbot.chat.completions.create({ /* ... */ });    // recorded as "chat"
```

The wrapped client is a transparent proxy — same types, same methods, same
behavior. Note `withTracking` wraps the **client object** (`new OpenAI()`,
`new GoogleGenAI({...})`…), not a string or a URL.

### Reports

Prefer the terminal? `npx tokentab report`:

```
tokentab — usage report (month)

Metric           Value
---------------  --------
Total cost       $1.2840
Calls            312
Input tokens     841,022
Output tokens    96,410
Avg latency      820 ms

By tag:

tag        calls  in       out     cost     avg ms
---------  -----  -------  ------  -------  ------
summarize  214    700,120  41,200  $0.8112  640
chat       98     140,902  55,210  $0.4728  1,210
```

## Automatic tracking — how it works

The `import "tokentab/auto"` one-liner from the Quick start patches global
`fetch`, so every call to OpenAI, Anthropic or Gemini is measured — including
**raw `fetch` calls**, not just SDK usage (the SDKs route through `fetch`
under the hood).

**Zero code** — in Node you can even skip the import and preload it at launch,
leaving your source untouched:

```bash
node --import tokentab/register app.js
# or
NODE_OPTIONS="--import tokentab/register" npm start
```

Then `npx tokentab dashboard` as usual. Both forms are idempotent and respect
`configure(...)` (pricing, `dbPath`, `enabled: false`).

> **No budget guard.** Auto-tracking records usage but cannot enforce the
> [Budget guard](#budget-guard) — `fetch` is intercepted *after* the request has
> already been sent, so there's nothing to block pre-flight. Use
> `withTracking(...)` if you need `block`/`warn` budget enforcement.

> **Works in the browser too.** In a web app the same import patches the
> browser's `fetch`; records go to `localStorage` and are mirrored to a locally
> running `tokentab dashboard`. See [Browser apps](#browser-apps-vite-webpack-).

For a self-hosted or proxied endpoint, map its host to a provider:

```ts
import { enableAutoTracking } from "tokentab/auto";

enableAutoTracking({
  hosts: { "my-gateway.internal": "openai" }, // merged over the built-ins
  tag: "auto",
});
```

## Browser apps (Vite, webpack, …)

tokentab ships a dedicated browser build, selected automatically by your
bundler via the package's `browser` export condition — no config needed. It
contains no `node:` imports, so it bundles cleanly in Vite, webpack, Next.js
client components, etc.

```ts
// Same one-liner as on the server — patches the browser's fetch:
import "tokentab/auto";

// Or wrap a client explicitly:
import { withTracking } from "tokentab";
const ai = withTracking(new GoogleGenAI({ apiKey }));
```

How storage works in the browser:

- Records are kept in **`localStorage`** (capped at the most recent 5,000;
  in-memory fallback when localStorage is unavailable).
- While the page is served from **localhost**, records are also mirrored,
  best-effort, to a running `tokentab dashboard` at `http://127.0.0.1:3000` —
  start it with `npx tokentab dashboard` and your browser app's usage shows up
  there. If the dashboard isn't running, mirroring silently retries on the
  next call or page reload; nothing ever breaks the host app.
- On a **deployed** page, mirroring is off unless you opt in explicitly:
  `configure({ syncUrl: "http://127.0.0.1:3000" })` (or `syncUrl: false` to
  disable it everywhere). Usage data never leaves the visitor's machine.

You can also read stats in-app: `overview()`, `breakdown("model")`,
`recentCalls()` etc. are exported from the package root.

## Budget guard

Stop runaway spend *before* the request leaves your process:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { BudgetExceededError, configure, withTracking } from "tokentab";

configure({
  budget: {
    limit: 5,            // USD
    window: "month",     // "day" | "week" | "month" | "total"
    mode: "block",       // "block" throws pre-flight; "warn" logs and proceeds
    perTag: { drafting: 1 }, // optional per-feature sub-limits
  },
});

const anthropic = withTracking(new Anthropic(), { tag: "drafting" });

try {
  await anthropic.messages.create({ /* ... */ });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`Blocked before sending: ${err.message}`);
  } else {
    throw err;
  }
}
```

## Supported providers

| Provider | SDK | Setup |
|---|---|---|
| **OpenAI** | `openai` | `withTracking(new OpenAI())` — auto-detected |
| **Anthropic** | `@anthropic-ai/sdk` | `withTracking(new Anthropic())` — auto-detected |
| **Google Gemini** | `@google/genai` | `withTracking(new GoogleGenAI({...}))` — auto-detected |
| **OpenAI-compatible** | any | Groq, Together, OpenRouter, Fireworks, Perplexity, Ollama, LM Studio, vLLM… |

For OpenAI-compatible endpoints, select the adapter explicitly and label it however you like:

```ts
const groq = withTracking(groqClient, {
  provider: "openai-compatible",
  providerLabel: "groq", // how it appears in reports & the dashboard
});
```

You can also register a fully custom adapter with `registerAdapter(...)` for anything else.

## CLI

```
tokentab dashboard        Start the local web dashboard
  --port <n>              Port (default 3000)
  --db <path>             Store file to read
  --no-open               Don't open the browser

tokentab report           Print a usage summary to the terminal
  --window <w>            day | week | month | total (default month)
  --by <dim>              tag | model | provider (default tag)

tokentab export           Export records to stdout or a file
  --format <fmt>          csv | json (default csv)
  --out <file>            Write to a file instead of stdout

tokentab reset            Clear the local usage store (destructive)
  --yes                   Skip the confirmation prompt
```

## Configuration

Everything is optional — `withTracking` works out of the box with sensible defaults.

```ts
import { configure } from "tokentab";

configure({
  store: "sqlite",                  // "sqlite" | "json" | "auto" | custom Store instance
  dbPath: "./.tokenmeter/usage.db", // where records live (localStorage key in the browser)
  syncUrl: "http://127.0.0.1:3000", // browser only — dashboard to mirror records to (false = off)
  redactPrompts: true,              // default true — prompt/completion text is never stored
  enabled: true,                    // kill switch — false = calls pass through untracked
  budget: { limit: 10, window: "month", mode: "warn" },
  pricing: {
    // merged over the bundled table — add new models or private rates
    "openai-compatible": {
      "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
    },
  },
});
```

| Option | Default | Description |
|---|---|---|
| `store` | `"auto"` | Node: SQLite when available, JSONL fallback. Browser: `localStorage`. Bring your own by passing a `Store` implementation |
| `dbPath` | `./.tokenmeter/usage.db` | Local store file (in the browser: the `localStorage` key) |
| `syncUrl` | localhost-only default | Browser builds: dashboard URL to mirror records to; `false` disables (see [Browser apps](#browser-apps-vite-webpack-)) |
| `pricing` | bundled table | Per-model USD rates per 1M tokens, deep-merged over the built-ins |
| `budget` | off | Pre-flight spend limit (see [Budget guard](#budget-guard)) |
| `redactPrompts` | `true` | Prompt/completion text is never written to disk |
| `enabled` | `true` | Set `false` to disable tracking entirely (e.g. in tests) |

## Programmatic access

The store is queryable, so you can build your own reporting:

```ts
import { getStore } from "tokentab";

const store = getStore();

// Recent calls for one feature
const records = await store.query({ tag: "summarize", limit: 50 });

// Spend grouped by model
const byModel = await store.aggregate({ groupBy: "model" });

// Total spend this month
const spent = await store.sumCost({ since: Date.now() - 30 * 24 * 3600 * 1000 });
```

## Privacy

tokentab is built local-first, by design:

- **Nothing leaves your machine.** In Node, usage records are written to a local file, full stop. In the browser they live in `localStorage`; the only network traffic tokentab ever produces is the optional mirror to **your own** `tokentab dashboard` on `127.0.0.1` (on by default only while the page itself runs on localhost, and disableable with `syncUrl: false`).
- **No prompt storage.** Only metadata is recorded (tokens, cost, latency, model, tag) — never the text, unless you opt out of `redactPrompts`.
- **No telemetry.** The package phones home to no one.

The recorded shape per call ([`UsageRecord`](https://github.com/madhawaawishka/tokenmeter/blob/main/src/types.ts)): provider, model, token counts, cost, latency, tag, timestamp — plus flags for whether tokens were estimated or pricing was missing, so you always know how accurate a number is.

## FAQ

**What if a model isn't in the pricing table?**
The call is still recorded with its token counts and flagged `pricingMissing` — add rates via `configure({ pricing })` and future calls are costed.

**Does it work with streaming?**
Yes. When the provider reports usage on the final chunk, exact counts are used; otherwise tokentab estimates them locally and flags the record `estimated`.

**Does it slow my calls down?**
No. Tracking happens after the response resolves, and store writes are failure-tolerant — a broken disk write never breaks your LLM call.

**Can the dashboard run while my app is writing?**
Yes — the dashboard and CLI read the same store file your app writes to, so you can keep it open and refresh as calls come in. Browser apps mirror their records to the running dashboard automatically during local dev.

**Does it work in browser apps (Vite, React, Next.js client)?**
Yes — since v0.3.0 a dedicated browser build ships in the package and your bundler selects it automatically. Records go to `localStorage` and sync to a locally running dashboard. See [Browser apps](#browser-apps-vite-webpack-).

**Does it work with Python apps?**
No. tokentab instruments JavaScript — it patches JS `fetch` and wraps JS SDK clients — so it works in Node.js and browser apps only.

## Development

```bash
git clone https://github.com/madhawaawishka/tokenmeter.git
cd tokenmeter
pnpm install
pnpm build
pnpm test
```

There's a [playground](https://github.com/madhawaawishka/tokenmeter/tree/main/playground) for firing real LLM calls (Groq / Gemini) and watching them land in the dashboard — see [playground/READTHIS.md](https://github.com/madhawaawishka/tokenmeter/tree/main/playground/READTHIS.md).

Issues and PRs welcome: [github.com/madhawaawishka/tokenmeter/issues](https://github.com/madhawaawishka/tokenmeter/issues)

## License

[MIT](https://github.com/madhawaawishka/tokenmeter/blob/main/LICENSE) © [madhawaawishka](https://github.com/madhawaawishka)

<p align="center">
  <img src="https://raw.githubusercontent.com/madhawaawishka/tokenmeter/main/assets/logo.svg" alt="tokentab logo" width="110" />
</p>

<h1 align="center">tokentab</h1>

<p align="center">
  <strong>Local-first LLM usage &amp; cost tracker.</strong><br/>
  Wrap your OpenAI / Anthropic / Gemini client in one line to measure tokens, cost, latency and
  per-feature spend — with a budget guard and a local dashboard.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/tokentab"><img src="https://img.shields.io/npm/v/tokentab?color=cb3837&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/tokentab"><img src="https://img.shields.io/npm/dm/tokentab" alt="npm downloads"></a>
  <a href="https://github.com/madhawaawishka/tokenmeter/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="node >= 18">
  <img src="https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white" alt="TypeScript types included">
</p>

---

```ts
import OpenAI from "openai";
import { withTracking } from "tokentab";

const openai = withTracking(new OpenAI()); // ← that's it

// ...use the client exactly as before. Every call is now metered.
```

```bash
npx tokentab dashboard
```

Your tokens, cost, latency and per-feature spend — charted in your browser, from a database that **never leaves your machine**.

## Why tokentab?

LLM bills are death by a thousand cuts: which *feature* is burning the money? Provider dashboards show totals per API key, not per feature — and shipping your usage data to a SaaS just to find out is overkill.

- 🪄 **One-line setup** — wrap your existing SDK client; no proxy server, no code rewrites
- 🏷️ **Per-feature attribution** — tag calls (`summarize`, `chat`, `codegen`…) and see exactly where the spend goes
- 💸 **Cost calculation** — bundled, overridable pricing table for OpenAI, Anthropic and Gemini models
- 🚦 **Budget guard** — set a daily/weekly/monthly USD limit; `block` throws *before* the request is sent, `warn` just logs
- 📊 **Local dashboard** — `npx tokentab dashboard` for charts; `npx tokentab report` for the terminal
- 🌊 **Streaming support** — streamed responses are measured too (token counts estimated when the provider doesn't report usage)
- 🔒 **Local-first & private** — records go to a local SQLite/JSONL file; prompts are never stored, nothing is ever transmitted
- 🪶 **Zero runtime dependencies** in the core, full TypeScript types, ESM + CJS

## Installation

```bash
npm install tokentab
# or
pnpm add tokentab
# or
yarn add tokentab
```

Requires **Node.js ≥ 18**.

## Quick start

### 1. Wrap your client

```ts
import OpenAI from "openai";
import { withTracking } from "tokentab";

const openai = withTracking(new OpenAI()); // provider auto-detected

const res = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Summarize: the quick brown fox..." }],
});
```

The wrapped client is a transparent proxy — same types, same methods, same behavior. Tokens, cost and latency for every call are appended to a local store (`./.tokenmeter/usage.db`).

### 2. Tag calls by feature

```ts
const summarizer = openai.withTag("summarize");
const chatbot = openai.withTag("chat");

await summarizer.chat.completions.create({ /* ... */ }); // recorded as "summarize"
await chatbot.chat.completions.create({ /* ... */ });    // recorded as "chat"
```

Or set a default tag for the whole wrapper:

```ts
const openai = withTracking(new OpenAI(), { tag: "drafting" });
```

### 3. See where the money goes

```bash
npx tokentab dashboard   # charts at http://127.0.0.1:3000
npx tokentab report      # summary in your terminal
```

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

## Automatic tracking (no client wrapping)

Don't want to wrap each client? Turn on auto-tracking and every call to OpenAI,
Anthropic or Gemini is measured — including **raw `fetch` calls**, not just SDK
usage (the SDKs route through `fetch` under the hood).

**One line** — add this once, before your first LLM call:

```ts
import "tokentab/auto"; // patches global fetch; that's the whole setup
```

**Zero code** — preload it at launch instead, leaving your source untouched:

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

> **Node only.** Auto-tracking instruments the server-side `fetch`. It cannot
> track calls made **from a browser** — tokentab writes to a local SQLite/JSONL
> file, which browsers have no access to. Run your LLM calls from a server,
> API route, or server action and point the dashboard at that machine.

For a self-hosted or proxied endpoint, map its host to a provider:

```ts
import { enableAutoTracking } from "tokentab/auto";

enableAutoTracking({
  hosts: { "my-gateway.internal": "openai" }, // merged over the built-ins
  tag: "auto",
});
```

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
  dbPath: "./.tokenmeter/usage.db", // where records live
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
| `store` | `"auto"` | SQLite when available, JSONL fallback. Bring your own by passing a `Store` implementation |
| `dbPath` | `./.tokenmeter/usage.db` | Local store file |
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

- **No network calls.** Usage records are written to a file on your machine, full stop.
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
Yes — the dashboard and CLI read the same store file your app writes to, so you can keep it open and refresh as calls come in.

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

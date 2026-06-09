# tokenmeter

**Wrap your LLM client in one line and see exactly what every call costs — by feature, by model, by provider — with a pre-flight budget guard and a local dashboard. Everything stays on your machine.**

> Honest scope: tokenmeter measures the calls **routed through the wrapper**. It does **not** read your provider's billing account. It's a code-level meter, not an invoice reconciler — which is exactly why it can attribute cost to *features* and *block* a call before you spend, things a provider console structurally cannot do.

[![zero runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](#zero-dependency-core)
[![node](https://img.shields.io/badge/node-%E2%89%A518-blue)](#)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## 10-second quickstart

```bash
npm install tokenmeter
```

```ts
import { withTracking } from "tokenmeter";
import OpenAI from "openai";

const openai = withTracking(new OpenAI()); // provider auto-detected

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
```

```bash
npx tokenmeter dashboard   # opens http://127.0.0.1:3000 — 100% local
```

That's it. Every call is now metered to a local store, and the dashboard shows
cost over time, cost-by-feature, and recent calls.

---

## Why tokenmeter

The provider's console tells you *how much you spent total, yesterday*. It can't
tell you **which feature** spent it, and it can't **stop** a call before it
happens. tokenmeter does both:

### 1. Per-feature cost attribution

Tag calls by what they're *for*, then see where the money actually goes:

```ts
const summarizer = openai.withTag("summarize");
await summarizer.chat.completions.create({ model: "gpt-4o-mini", messages });

const translator = openai.withTag("translate");
await translator.chat.completions.create({ model: "gpt-4o", messages });
```

The dashboard's headline **"By feature"** view answers *"what is `summarize`
costing me this month?"* — a question your OpenAI/Anthropic dashboard cannot.

### 2. Pre-flight budget guard

Set a spend limit in code. tokenmeter checks it **before the request is sent**
and throws a typed, catchable error in `block` mode:

```ts
import { configure, BudgetExceededError } from "tokenmeter";

configure({
  budget: {
    limit: 50,            // USD
    window: "month",      // "day" | "week" | "month" | "total"
    mode: "block",        // "block" -> throw before the call; "warn" -> log only
    perTag: { summarize: 10 },   // optional per-feature sub-budgets
  },
});

try {
  await openai.chat.completions.create({ model: "gpt-4o", messages });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    // handle gracefully — the request was never sent
  }
}
```

---

## Supported providers

| Provider | `provider` slug | Detection | Notes |
| --- | --- | --- | --- |
| OpenAI | `openai` | auto | Chat Completions + Responses API |
| Anthropic | `anthropic` | auto | Messages API + streaming |
| Google Gemini | `gemini` | auto | `@google/genai` and legacy SDK |
| **Any OpenAI-compatible** | `openai-compatible` | explicit | see below |

The single `openai-compatible` adapter covers **Groq, Together, Fireworks,
OpenRouter, Perplexity, DeepInfra, Hyperbolic, Novita, SiliconFlow, Cerebras,
NVIDIA NIM**, and local servers (**Ollama / LM Studio / vLLM**):

```ts
import OpenAI from "openai";
const groq = withTracking(
  new OpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY }),
  { provider: "openai-compatible", providerLabel: "groq" },
);
```

`providerLabel` is used for display and for pricing lookup — add your rates with
`configure({ pricing: { groq: { "llama-3.3-70b": { inputPer1M: 0.59, outputPer1M: 0.79 } } } })`.

---

## Streaming

Streaming works transparently. tokenmeter accumulates the stream to recover
usage; if the provider omits usage on a stream, it falls back to local token
estimation and flags the record `estimated: true`.

```ts
const stream = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
  stream: true,
  stream_options: { include_usage: true }, // recommended for exact OpenAI usage
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
// record is written automatically when the stream completes
```

---

## CLI

The CLI wraps the same functions the library exports, so everything is scriptable.

```bash
tokenmeter dashboard [--port 3000] [--db <path>] [--no-open]
tokenmeter report   [--window day|week|month|total] [--by tag|model|provider]
tokenmeter export   [--format csv|json] [--out <file>]
tokenmeter reset    [--yes]
```

`tokenmeter report` prints a summary table — handy in CI or a quick terminal check:

```
tokenmeter — usage report (month)

Metric           Value
---------------  --------
Total cost       $1.2841
Calls            312
Input tokens     1,204,553
Output tokens    98,210
Avg latency      842 ms
Estimated share  4%

By tag:

tag        calls  in        out      cost     avg ms
---------  -----  --------  -------  -------  ------
summarize  210    980,000   60,000   $0.9120  910
translate  102    224,553   38,210   $0.3721  701
```

---

## Privacy & security

- **Local-first / zero exfiltration.** There is no hosted backend. No usage
  data, prompts, or API keys ever leave your machine. The dashboard binds to
  `127.0.0.1` only.
- **Never touches credentials.** tokenmeter reads provider keys exactly the way
  the official SDKs do (it doesn't — it just wraps the client you already made).
  It never prompts for, stores, transmits, or logs an API key.
- **No prompt storage by default.** Only token counts + metadata are recorded
  (`redactPrompts: true`). There is no opt-in text capture; your prompts and
  completions are never written to the store.

---

## Zero-dependency core

The import you ship to production — `tokenmeter` — has **zero runtime
dependencies**. The CLI and dashboard are built from Node built-ins (`node:http`,
`node:sqlite`) only. Nothing to audit, nothing to bloat your bundle.

Storage uses Node's built-in `node:sqlite` when available (Node ≥ 22.5, or run
with `--experimental-sqlite` on Node 22), and transparently falls back to a
JSON-lines file otherwise — so it works on Node 18/20 too.

---

## Configuration reference

```ts
import { configure } from "tokenmeter";

configure({
  store: "auto",            // "sqlite" | "json" | "auto" | <your Store>  (default "auto")
  dbPath: "./.tokenmeter/usage.db",  // store file location
  pricing: { /* provider -> model -> { inputPer1M, outputPer1M } */ },
  budget: { limit: 50, window: "month", mode: "block", perTag: { summarize: 10 } },
  redactPrompts: true,      // never store prompt text (default true)
  enabled: true,            // global kill-switch — set false in tests (default true)
});
```

| Option | Default | Description |
| --- | --- | --- |
| `store` | `"auto"` | Backend. `auto` prefers SQLite, falls back to JSON. |
| `dbPath` | `./.tokenmeter/usage.{db,jsonl}` | Where records are written. |
| `pricing` | bundled table | Merged over the built-in rates; add/patch models. |
| `budget` | _none_ | Pre-flight spend guard (see above). |
| `redactPrompts` | `true` | Keep prompt/completion text out of the store. |
| `enabled` | `true` | When `false`, calls pass through completely untracked. |

### `withTracking(client, options?)`

```ts
withTracking(client, {
  tag: "default",          // default tag for all calls through this wrapper
  provider: "anthropic",   // optional; auto-detected if omitted
  providerLabel: "groq",   // display/pricing label for openai-compatible
});
```

The returned value is a transparent `Proxy` of your client — every method,
type, and streaming behavior is preserved, including private SDK state.

---

## Contributing an adapter

Adding a provider is one file plus one registration. An adapter answers two
questions: *is this my client?* and *where is the usage on a response?*

```ts
import { registerAdapter, type Adapter } from "tokenmeter";

const myAdapter: Adapter = {
  name: "myprovider",
  detect(client) {
    return (client as any)?.constructor?.name === "MyProviderSDK";
  },
  extractUsage(response) {
    const u = (response as any)?.usage;
    if (!u) return null; // null -> tokenmeter will estimate
    return {
      model: (response as any).model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
    };
  },
  // optional: accumulate usage across streamed chunks
  // extractStreamUsage(chunk, acc) { ... },
};

registerAdapter(myAdapter);
```

PRs that add native adapters or update `src/pricing/prices.json` are very
welcome. Pricing changes frequently — keeping the table current is the most
useful contribution.

---

## API exports

```ts
import {
  withTracking,
  configure,
  getStore,
  cost, findPrice, getPricingTable,
  estimate,
  checkBudget, windowStart,
  registerAdapter, getAdapter, listAdapters,
  BudgetExceededError, AdapterNotFoundError,
} from "tokenmeter";

import type {
  UsageRecord, Store, PricingTable, ModelPrice,
  BudgetConfig, BudgetWindow, BudgetMode,
  TokenmeterConfig, TrackingOptions,
  Adapter, ExtractedUsage,
} from "tokenmeter";
```

---

## License

MIT

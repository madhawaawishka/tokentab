# tokentab — CV Project Description

> Open-source LLM cost observability library, published on npm
> **Tech:** TypeScript · Node.js · SQLite · esbuild/tsup · Biome · pnpm
> **Links:** [npm](https://www.npmjs.com/package/tokentab) · [GitHub](https://github.com/madhawaawishka/tokenmeter)

---

## Overview

**tokentab** is a local-first LLM usage and cost tracker for Node.js. Developers wrap their
OpenAI / Anthropic / Gemini SDK client in a single line (`withTracking(new OpenAI())`) — or enable
zero-code auto-tracking that instruments the global `fetch` — and every LLM call is automatically
metered: tokens, USD cost, latency, and a per-feature tag. All records are written to a local
SQLite/JSONL store (prompts are never stored and nothing leaves the machine), a budget guard can
block requests pre-flight when a daily/weekly/monthly USD limit is reached, and a bundled CLI
provides a local web dashboard, terminal reports, and CSV/JSON export.

## Key Features

- **One-line setup** — transparent `Proxy`-based wrapper around existing SDK clients; same types, same behavior
- **Zero-code auto-tracking** — global `fetch` instrumentation (`node --import tokentab/register`) captures SDK *and* raw fetch calls
- **Per-feature cost attribution** — tag calls (`summarize`, `chat`, `codegen`…) and see exactly where the spend goes
- **Budget guard** — pre-flight USD limits (day/week/month/total) that throw *before* the request is sent, with per-tag sub-limits
- **Local dashboard & CLI** — `npx tokentab dashboard` for charts, `report` for the terminal, `export` for CSV/JSON
- **Streaming support** — exact token counts when the provider reports usage; local estimation (flagged) when it doesn't
- **Privacy by design** — no network calls, no telemetry, no prompt storage

## Technologies Used

| Area | Stack |
|---|---|
| Language / Runtime | TypeScript (strict), Node.js ≥ 18, dual ESM + CJS publishing |
| Build & Tooling | tsup (esbuild), Biome (lint/format), pnpm workspaces |
| Testing | Node native test runner (`node:test`) — 40 tests across 6 suites |
| Storage | Node built-in SQLite (`node:sqlite`) with JSONL fallback — zero runtime dependencies |
| Core Techniques | JS `Proxy` for transparent SDK wrapping, global `fetch` monkey-patching, streaming token estimation, pluggable provider adapter registry |
| Providers | OpenAI, Anthropic, Google Gemini, plus any OpenAI-compatible endpoint (Groq, Together, OpenRouter, Ollama, vLLM…) |
| Dashboard / CLI | Custom CLI (`dashboard` / `report` / `export` / `reset`), local web dashboard in vanilla HTML/CSS/JS served by a Node HTTP server |

## Resume Bullets (XYZ Format)

**tokentab — Open-source LLM cost observability library (npm) · TypeScript, Node.js**

- Built and published **tokentab**, a local-first LLM token/cost tracker adopted at **~1,100 monthly
  npm downloads**, by designing a one-line `Proxy`-based SDK wrapper and a zero-code global-`fetch`
  instrumentation layer for OpenAI, Anthropic, and Gemini.
- Eliminated per-feature LLM cost blind spots by implementing tag-based attribution, a bundled
  pricing engine covering **30+ models across 4 provider families**, and a pre-flight budget guard
  that blocks requests **before any spend occurs**.
- Achieved a **zero-runtime-dependency** core with full privacy guarantees (no network calls, no
  prompt storage) by building on Node's native SQLite with a JSONL fallback, shipped as dual
  ESM/CJS with complete TypeScript types.
- Ensured reliability across streaming and non-streaming responses with **40 automated tests**
  using Node's native test runner, plus a CLI dashboard, terminal reports, and CSV/JSON export.

## Short Version (one-liner for the CV header)

> **tokentab** — Local-first LLM usage & cost tracker for Node.js (TypeScript, npm, ~1,100 monthly
> downloads): one-line SDK wrapping, per-feature cost attribution, pre-flight budget guard, and a
> local dashboard — zero runtime dependencies, zero data exfiltration.

---

*Metrics note: download count (1,094/month) and version (v0.4.0) were pulled live from the npm
registry on 2026-07-13 — re-verify before submitting.*

# 🎮 tokenmeter playground — how to run it again

A guide to firing test LLM calls and watching them show up in the dashboard.
Everything runs locally. You need **two terminals**, both opened at the
**project root** (`...\tokenmeter`).

---

## TL;DR — the 4 commands

```powershell
# one-time: add your keys
copy playground\.env.example playground\.env      # then paste keys into playground\.env

# terminal 1 — the API hitting portal (generates data)
node playground\server.mjs                          # → http://127.0.0.1:4000

# terminal 2 — the usage view portal (shows data)
npx tokenmeter dashboard                            # → http://127.0.0.1:3000
```

Then open **http://127.0.0.1:4000**, click **Run** buttons, and refresh
**http://127.0.0.1:3000** to watch cost/tokens fill in.

---

## The two portals (don't mix them up)

| | **API hitting portal** | **Usage view portal** |
|---|---|---|
| **What it is** | Buttons that fire real LLM calls | The dashboard that displays results |
| **URL** | http://127.0.0.1:4000 | http://127.0.0.1:3000 |
| **Started by** | `node playground\server.mjs` | `npx tokenmeter dashboard` |
| **Has buttons?** | ✅ yes — click to generate data | ❌ no — read-only charts |

They share the same store file (`.tokenmeter\usage.db`), so anything you fire
on **:4000** appears on **:3000** after a refresh.

---

## Step 1 — Add your API keys (one-time)

```powershell
copy playground\.env.example playground\.env
notepad playground\.env
```

Paste one or both keys (either provider works on its own):

```
GROQ_API_KEY=gsk_xxxxxxxxxxxx
GEMINI_API_KEY=AIzaxxxxxxxxxxxx
```

- Groq keys: https://console.groq.com/keys
- Gemini keys: https://aistudio.google.com/apikey

> `playground\.env` is gitignored — your keys won't be committed.

---

## Step 2 — Start the API hitting portal (terminal 1)

From the project root:

```powershell
node playground\server.mjs
```

You'll see:

```
  tokenmeter playground → http://127.0.0.1:4000
  store: ...\tokenmeter\.tokenmeter\usage.db
  keys:  groq=set  gemini=set
```

Open **http://127.0.0.1:4000** in your browser. Leave this terminal running.

---

## Step 3 — Hit the endpoints

**Easiest — click buttons** on http://127.0.0.1:4000:

- Each card has a **Run** button → fires **one** real LLM call of that size.
- **⚡ Burst (8 random calls)** → fires 8 calls at once to fill the dashboard fast.
- Results appear instantly in the table at the bottom (tokens in/out, latency, preview).

**Or hit the endpoints directly** (PowerShell):

```powershell
# one call
curl.exe -X POST "http://127.0.0.1:4000/api/run?id=groq-classify-tiny"

# 8 calls at once
curl.exe -X POST "http://127.0.0.1:4000/api/burst?n=8"
```

### Available endpoints (on :4000)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`  | `/`                        | The button page |
| `GET`  | `/api/scenarios`           | List scenario ids + which keys are set |
| `POST` | `/api/run?id=<scenario>`   | Fire **one** call |
| `POST` | `/api/burst?n=8`           | Fire N calls (1–20) |

### Scenario ids (the `id=` values) — varied provider / model / tag / token size

| id | provider | model | tag | size |
|---|---|---|---|---|
| `groq-classify-tiny`      | groq   | llama-3.1-8b-instant     | classify  | tiny |
| `groq-summarize-small`    | groq   | llama-3.1-8b-instant     | summarize | small |
| `groq-draft-medium`       | groq   | llama-3.3-70b-versatile  | draft     | medium |
| `groq-codegen-large`      | groq   | llama-3.3-70b-versatile  | codegen   | large |
| `gemini-classify-tiny`    | gemini | gemini-2.5-flash-lite    | classify  | tiny |
| `gemini-translate-small`  | gemini | gemini-2.5-flash-lite    | translate | small |
| `gemini-summarize-medium` | gemini | gemini-2.5-flash         | summarize | medium |
| `gemini-chat-large`       | gemini | gemini-2.5-flash         | chat      | large |

---

## Step 4 — Watch the usage view portal (terminal 2)

In a **second terminal**, also at the project root:

```powershell
npx tokenmeter dashboard
```

Opens **http://127.0.0.1:3000**. After clicking buttons on :4000, **refresh**
this page. You'll see:

- **Total cost / tokens / latency / estimated** cards
- **Cost over time** (Day / Week / Month)
- **By feature** — switchable between **Tag / Model / Provider**

> Tip: the dashboard defaults to the **Day** window. If you don't see data,
> click **All** in the top-right.

---

## Resetting the data

To wipe all recorded usage and start fresh:

```powershell
npx tokenmeter reset --yes
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Buttons greyed out / `"...API_KEY is not set"` | Add the key to `playground\.env`, restart terminal 1 |
| Dashboard empty after firing calls | Click **All** in the dashboard top-right; or refresh the page |
| `Cannot find module '../dist/index.js'` | Run `pnpm build` first (rebuilds `dist/`) |
| `:4000` won't start (`EADDRINUSE`) | Another instance is running, or set a port: `$env:PORT=4100; node playground\server.mjs` |
| Groq `400 model_decommissioned` | Groq retired a model — update the `model` in `playground\server.mjs` |

---

## How it works (one paragraph)

`playground\server.mjs` builds provider clients (Groq over `fetch`, Gemini via
`@google/genai`), wraps each in `withTracking(...)`, and points tokenmeter at
`.tokenmeter\usage.db`. Every button click sends `POST /api/run`, which makes a
real API call through the wrapper — so tokenmeter records the tokens, cost, tag,
and latency to the store. The dashboard (`npx tokenmeter dashboard`) reads that
same store and renders it. **Button click (:4000) → real API call → usage.db →
dashboard (:3000).**

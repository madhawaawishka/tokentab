import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getBudgetConfig, getStore } from "../src/config.js";
import { breakdown, costOverTime, dailyActivity, overview, recentCalls } from "../src/report.js";
import type { BudgetWindow, UsageRecord } from "../src/types.js";

/** Uncommon by design — 3000 is almost always taken by the app being tracked. */
export const DEFAULT_DASHBOARD_PORT = 4242;
/** How many consecutive ports to try when the requested one is busy. */
const MAX_PORT_ATTEMPTS = 20;

export interface DashboardOptions {
  port?: number;
  /** Open the default browser when the server starts. Default true. */
  open?: boolean;
  host?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Locate the bundled static assets in both built and source layouts. */
function publicDir(): string {
  const candidates = [
    fileURLToPath(new URL("./public/", import.meta.url)), // dist/public (built)
    fileURLToPath(new URL("../dashboard/public/", import.meta.url)), // repo source
    fileURLToPath(new URL("./dashboard/public/", import.meta.url)),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

function asWindow(v: string | null): BudgetWindow {
  return v === "day" || v === "week" || v === "month" || v === "total" ? v : "month";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // The server binds to 127.0.0.1 only; CORS lets browser apps tracked with
    // tokentab mirror their records here during local development.
    "access-control-allow-origin": "*",
  });
  res.end(data);
}

function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Validate + coerce one ingested record; null when it is unusable. */
function sanitizeRecord(raw: unknown): UsageRecord | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !r.id) return null;
  const timestamp = Number(r.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const inputTokens = num(r.inputTokens);
  const outputTokens = num(r.outputTokens);
  return {
    id: r.id,
    timestamp,
    provider: typeof r.provider === "string" ? r.provider : "unknown",
    model: typeof r.model === "string" ? r.model : "unknown",
    inputTokens,
    outputTokens,
    totalTokens: num(r.totalTokens) || inputTokens + outputTokens,
    inputCost: num(r.inputCost),
    outputCost: num(r.outputCost),
    totalCost: num(r.totalCost),
    latencyMs: num(r.latencyMs),
    tag: typeof r.tag === "string" ? r.tag : "default",
    estimated: r.estimated === true,
    pricingMissing: r.pricingMissing === true,
  };
}

/**
 * Ingest records mirrored from a browser app's localStorage store. Re-sends
 * are deduplicated by record id (the SQLite store upserts; for other stores we
 * check existing ids in the batch's time range).
 */
async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : "invalid JSON" });
    return;
  }
  if (!Array.isArray(parsed)) {
    json(res, 400, { error: "expected an array of usage records" });
    return;
  }
  const records = parsed.map(sanitizeRecord).filter((r): r is UsageRecord => r !== null);
  if (records.length === 0) {
    json(res, 200, { ingested: 0, skipped: parsed.length });
    return;
  }

  const store = getStore();
  const since = Math.min(...records.map((r) => r.timestamp));
  const existing = new Set((await store.query({ since })).map((r) => r.id));
  let ingested = 0;
  for (const record of records) {
    if (existing.has(record.id)) continue;
    await store.append(record);
    ingested++;
  }
  json(res, 200, { ingested, skipped: parsed.length - ingested });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    });
    res.end();
    return true;
  }

  const window = asWindow(url.searchParams.get("window"));

  try {
    if (path === "/api/ingest" && req.method === "POST") {
      await handleIngest(req, res);
      return true;
    }
    if (path === "/api/overview") {
      const budget = getBudgetConfig();
      const ov = await overview(window);
      let budgetStatus: { limit: number; window: string; spent: number; ratio: number } | null =
        null;
      if (budget) {
        const bWindow = budget.window ?? "month";
        const spent = (await overview(bWindow)).totalCost;
        budgetStatus = {
          limit: budget.limit,
          window: bWindow,
          spent,
          ratio: budget.limit > 0 ? spent / budget.limit : 0,
        };
      }
      json(res, 200, { ...ov, budget: budgetStatus });
      return true;
    }
    if (path === "/api/by") {
      const by = url.searchParams.get("by");
      const dim = by === "model" || by === "provider" ? by : "tag";
      json(res, 200, await breakdown(dim, window));
      return true;
    }
    if (path === "/api/timeseries") {
      const g = url.searchParams.get("granularity");
      const gran = g === "week" || g === "month" ? g : "day";
      json(res, 200, await costOverTime(window, gran));
      return true;
    }
    if (path === "/api/activity") {
      const days = Math.min(366, Math.max(1, Number(url.searchParams.get("days") ?? 365) || 365));
      json(res, 200, await dailyActivity(days));
      return true;
    }
    if (path === "/api/recent") {
      const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 50) || 50);
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
      json(res, 200, await recentCalls(limit, offset));
      return true;
    }
    json(res, 404, { error: "not found" });
    return true;
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

async function serveStatic(res: ServerResponse, url: URL): Promise<void> {
  const root = publicDir();
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  // Prevent path traversal.
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, safe);
  if (!file.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA-ish fallback to index.html for unknown routes.
    try {
      const data = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"]! });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  }
}

/**
 * Start the local dashboard server. Binds to 127.0.0.1 only — the API and UI
 * are reachable from this machine alone. No usage data ever leaves the host.
 */
export async function startDashboard(
  options: DashboardOptions = {},
): Promise<{ close: () => void; port: number }> {
  const preferredPort = options.port ?? DEFAULT_DASHBOARD_PORT;
  const host = options.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    void handleApi(req, res, url).then((handled) => {
      if (!handled) void serveStatic(res, url);
    });
  });

  const port = await listenOnFreePort(server, preferredPort, host);
  if (port !== preferredPort) {
    console.error(`Port ${preferredPort} is busy — switched to ${port}.`);
  }
  const addr = `http://${host}:${port}`;
  console.error(
    `tokentab dashboard running at ${addr}  (local only — no data leaves this machine)`,
  );
  console.error("Press Ctrl+C to stop.");
  if (options.open !== false) openBrowser(addr);
  return { close: () => server.close(), port };
}

/** Resolves true when listening, false when the port is taken; rejects otherwise. */
function tryListen(server: Server, port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") resolve(false);
      else reject(err);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve(true);
    });
  });
}

/** Bind to the preferred port, walking up to the next free one when busy. */
async function listenOnFreePort(server: Server, preferred: number, host: string): Promise<number> {
  const last = Math.min(preferred + MAX_PORT_ATTEMPTS - 1, 65535);
  for (let port = preferred; port <= last; port++) {
    if (await tryListen(server, port, host)) return port;
  }
  throw new Error(`No free port found between ${preferred} and ${last}.`);
}

function openBrowser(addr: string): void {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${addr}"`
      : platform === "darwin"
        ? `open "${addr}"`
        : `xdg-open "${addr}"`;
  exec(cmd, () => {
    /* best-effort; ignore failures (e.g. headless) */
  });
}

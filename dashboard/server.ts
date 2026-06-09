import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getBudgetConfig } from "../src/config.js";
import { breakdown, costOverTime, overview, recentCalls } from "../src/report.js";
import type { BudgetWindow } from "../src/types.js";

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
  });
  res.end(data);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;

  const window = asWindow(url.searchParams.get("window"));

  try {
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
export function startDashboard(options: DashboardOptions = {}): Promise<{ close: () => void }> {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    void handleApi(req, res, url).then((handled) => {
      if (!handled) void serveStatic(res, url);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = `http://${host}:${port}`;
      console.error(
        `tokenmeter dashboard running at ${addr}  (local only — no data leaves this machine)`,
      );
      console.error("Press Ctrl+C to stop.");
      if (options.open !== false) openBrowser(addr);
      resolve({ close: () => server.close() });
    });
  });
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

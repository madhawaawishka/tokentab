import { windowStart } from "./budget.js";
import { getStore } from "./config.js";
import type { AggregateRow, BudgetWindow, UsageRecord } from "./types.js";

export interface Overview {
  window: BudgetWindow;
  since: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  avgLatencyMs: number;
  estimatedShare: number;
}

function sinceFor(window: BudgetWindow): number {
  return windowStart(window, Date.now());
}

/** High-level totals for a window. */
export async function overview(window: BudgetWindow = "month"): Promise<Overview> {
  const since = sinceFor(window);
  const store = getStore();
  const rows = await store.query({ since });
  const calls = rows.length;
  const inputTokens = rows.reduce((s, r) => s + r.inputTokens, 0);
  const outputTokens = rows.reduce((s, r) => s + r.outputTokens, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const latency = rows.reduce((s, r) => s + r.latencyMs, 0);
  const estimated = rows.filter((r) => r.estimated).length;
  return {
    window,
    since,
    totalCost,
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    calls,
    avgLatencyMs: calls ? latency / calls : 0,
    estimatedShare: calls ? estimated / calls : 0,
  };
}

/** Grouped breakdown for a window. */
export async function breakdown(
  by: "tag" | "model" | "provider",
  window: BudgetWindow = "month",
): Promise<AggregateRow[]> {
  return getStore().aggregate({ since: sinceFor(window), groupBy: by });
}

/** Time-bucketed cost series for charting. */
export interface TimeBucket {
  bucket: number; // epoch ms at the start of the bucket
  totalCost: number;
  totalTokens: number;
  calls: number;
}

export async function costOverTime(
  window: BudgetWindow = "month",
  granularity: "day" | "week" | "month" = "day",
): Promise<TimeBucket[]> {
  const since = sinceFor(window);
  const rows = await getStore().query({ since, order: "asc" });
  const buckets = new Map<number, TimeBucket>();
  for (const r of rows) {
    const key = bucketStart(r.timestamp, granularity);
    const b = buckets.get(key) ?? { bucket: key, totalCost: 0, totalTokens: 0, calls: 0 };
    b.totalCost += r.totalCost;
    b.totalTokens += r.totalTokens;
    b.calls += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.bucket - b.bucket);
}

function bucketStart(ts: number, granularity: "day" | "week" | "month"): number {
  const d = new Date(ts);
  if (granularity === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (granularity === "week") {
    const daysSinceMonday = (d.getUTCDay() + 6) % 7;
    return (
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysSinceMonday * 86_400_000
    );
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Most recent calls. */
export async function recentCalls(limit = 50, offset = 0): Promise<UsageRecord[]> {
  return getStore().query({ order: "desc", limit, offset });
}

// ---- export formats ----

export function toCsv(records: UsageRecord[]): string {
  const cols: (keyof UsageRecord)[] = [
    "id",
    "timestamp",
    "provider",
    "model",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "inputCost",
    "outputCost",
    "totalCost",
    "latencyMs",
    "tag",
    "estimated",
    "pricingMissing",
  ];
  const head = cols.join(",");
  const lines = records.map((r) =>
    cols
      .map((c) => {
        const v = r[c];
        if (typeof v === "string" && /[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
        return String(v);
      })
      .join(","),
  );
  return [head, ...lines].join("\n");
}

export function toJson(records: UsageRecord[]): string {
  return JSON.stringify(records, null, 2);
}

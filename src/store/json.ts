import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AggregateOptions, AggregateRow, QueryFilter, Store, UsageRecord } from "../types.js";

/**
 * JSON-lines store: one record per line. Used when `node:sqlite` is
 * unavailable (Node < 22.5) or selected explicitly. Reads the whole file for
 * queries; fine for the local, single-developer scale this tool targets.
 */
export class JsonStore implements Store {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, "");
  }

  append(record: UsageRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`);
  }

  private readAll(): UsageRecord[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8");
    if (!raw.trim()) return [];
    const out: UsageRecord[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as UsageRecord);
      } catch {
        /* skip corrupt lines */
      }
    }
    return out;
  }

  query(filter: QueryFilter = {}): UsageRecord[] {
    let rows = this.readAll();
    rows = rows.filter((r) => {
      if (filter.since != null && r.timestamp < filter.since) return false;
      if (filter.until != null && r.timestamp > filter.until) return false;
      if (filter.provider != null && r.provider !== filter.provider) return false;
      if (filter.model != null && r.model !== filter.model) return false;
      if (filter.tag != null && r.tag !== filter.tag) return false;
      return true;
    });
    rows.sort((a, b) =>
      filter.order === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp,
    );
    const offset = filter.offset ?? 0;
    const end = filter.limit != null ? offset + filter.limit : undefined;
    return rows.slice(offset, end);
  }

  count(filter: QueryFilter = {}): number {
    return this.query({ ...filter, limit: undefined, offset: undefined }).length;
  }

  sumCost(opts: { since?: number; until?: number; tag?: string } = {}): number {
    return this.query({ since: opts.since, until: opts.until, tag: opts.tag }).reduce(
      (sum, r) => sum + r.totalCost,
      0,
    );
  }

  aggregate(opts: AggregateOptions = {}): AggregateRow[] {
    const rows = this.query({ since: opts.since, until: opts.until, tag: opts.tag });
    const groupBy = opts.groupBy ?? "tag";
    const groups = new Map<string, UsageRecord[]>();
    for (const r of rows) {
      const key =
        groupBy === "none"
          ? "all"
          : groupBy === "tag"
            ? r.tag
            : groupBy === "model"
              ? r.model
              : r.provider;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }
    const result: AggregateRow[] = [];
    for (const [key, recs] of groups) {
      const calls = recs.length;
      const inputTokens = recs.reduce((s, r) => s + r.inputTokens, 0);
      const outputTokens = recs.reduce((s, r) => s + r.outputTokens, 0);
      const totalCost = recs.reduce((s, r) => s + r.totalCost, 0);
      const avgLatencyMs = calls ? recs.reduce((s, r) => s + r.latencyMs, 0) / calls : 0;
      result.push({
        key,
        calls,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        totalCost,
        avgLatencyMs,
      });
    }
    result.sort((a, b) => b.totalCost - a.totalCost);
    return result;
  }

  reset(): void {
    if (existsSync(this.path)) rmSync(this.path);
    writeFileSync(this.path, "");
  }
}

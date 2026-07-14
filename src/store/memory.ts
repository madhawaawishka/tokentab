import type { AggregateOptions, AggregateRow, QueryFilter, Store, UsageRecord } from "../types.js";

/** Apply a QueryFilter to an in-memory record list (sort, slice included). */
export function filterRecords(rows: UsageRecord[], filter: QueryFilter = {}): UsageRecord[] {
  let out = rows.filter((r) => {
    if (filter.since != null && r.timestamp < filter.since) return false;
    if (filter.until != null && r.timestamp > filter.until) return false;
    if (filter.provider != null && r.provider !== filter.provider) return false;
    if (filter.model != null && r.model !== filter.model) return false;
    if (filter.tag != null && r.tag !== filter.tag) return false;
    return true;
  });
  out = out.sort((a, b) =>
    filter.order === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp,
  );
  const offset = filter.offset ?? 0;
  const end = filter.limit != null ? offset + filter.limit : undefined;
  return out.slice(offset, end);
}

/** Group + sum an in-memory record list the same way the SQLite store does. */
export function aggregateRecords(rows: UsageRecord[], opts: AggregateOptions = {}): AggregateRow[] {
  const filtered = filterRecords(rows, { since: opts.since, until: opts.until, tag: opts.tag });
  const groupBy = opts.groupBy ?? "tag";
  const groups = new Map<string, UsageRecord[]>();
  for (const r of filtered) {
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

/**
 * Plain in-memory store. Works in every runtime; used directly as the
 * last-resort default and as the base class for the browser store. Subclasses
 * override `persist`/`load` to add durability.
 */
export class MemoryStore implements Store {
  protected records: UsageRecord[] = [];

  append(record: UsageRecord): void {
    this.records.push(record);
    this.persist();
  }

  query(filter: QueryFilter = {}): UsageRecord[] {
    return filterRecords(this.records, filter);
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
    return aggregateRecords(this.records, opts);
  }

  reset(): void {
    this.records = [];
    this.persist();
  }

  /** Durability hook for subclasses. No-op for the pure memory store. */
  protected persist(): void {
    /* memory only */
  }
}

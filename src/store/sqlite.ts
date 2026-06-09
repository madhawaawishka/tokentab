import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AggregateOptions, AggregateRow, QueryFilter, Store, UsageRecord } from "../types.js";

// node:sqlite is typed loosely to avoid a hard dependency on its experimental types.
type DatabaseSyncCtor = new (
  path: string,
) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

/** True if this runtime ships a usable `node:sqlite`. */
export async function sqliteAvailable(): Promise<boolean> {
  try {
    const mod = await import("node:sqlite");
    return typeof (mod as { DatabaseSync?: unknown }).DatabaseSync === "function";
  } catch {
    return false;
  }
}

export class SqliteStore implements Store {
  private readonly db: InstanceType<DatabaseSyncCtor>;

  constructor(path: string, DatabaseSync: DatabaseSyncCtor) {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        inputTokens INTEGER NOT NULL,
        outputTokens INTEGER NOT NULL,
        totalTokens INTEGER NOT NULL,
        inputCost REAL NOT NULL,
        outputCost REAL NOT NULL,
        totalCost REAL NOT NULL,
        latencyMs INTEGER NOT NULL,
        tag TEXT NOT NULL,
        estimated INTEGER NOT NULL,
        pricingMissing INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_tag ON usage(tag);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);
      CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage(provider);
    `);
  }

  /** Create a store after confirming the runtime has node:sqlite. */
  static async create(path: string): Promise<SqliteStore> {
    const mod = (await import("node:sqlite")) as { DatabaseSync: DatabaseSyncCtor };
    return new SqliteStore(path, mod.DatabaseSync);
  }

  append(record: UsageRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO usage
         (id, timestamp, provider, model, inputTokens, outputTokens, totalTokens,
          inputCost, outputCost, totalCost, latencyMs, tag, estimated, pricingMissing)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        record.id,
        record.timestamp,
        record.provider,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.totalTokens,
        record.inputCost,
        record.outputCost,
        record.totalCost,
        record.latencyMs,
        record.tag,
        record.estimated ? 1 : 0,
        record.pricingMissing ? 1 : 0,
      );
  }

  private where(filter: QueryFilter): { clause: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter.since != null) {
      conds.push("timestamp >= ?");
      params.push(filter.since);
    }
    if (filter.until != null) {
      conds.push("timestamp <= ?");
      params.push(filter.until);
    }
    if (filter.provider != null) {
      conds.push("provider = ?");
      params.push(filter.provider);
    }
    if (filter.model != null) {
      conds.push("model = ?");
      params.push(filter.model);
    }
    if (filter.tag != null) {
      conds.push("tag = ?");
      params.push(filter.tag);
    }
    return { clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
  }

  query(filter: QueryFilter = {}): UsageRecord[] {
    const { clause, params } = this.where(filter);
    const order = filter.order === "asc" ? "ASC" : "DESC";
    let sql = `SELECT * FROM usage ${clause} ORDER BY timestamp ${order}`;
    if (filter.limit != null) {
      sql += " LIMIT ?";
      params.push(filter.limit);
      sql += " OFFSET ?";
      params.push(filter.offset ?? 0);
    } else if (filter.offset != null) {
      sql += " LIMIT -1 OFFSET ?";
      params.push(filter.offset);
    }
    return this.db
      .prepare(sql)
      .all(...params)
      .map(rowToRecord);
  }

  count(filter: QueryFilter = {}): number {
    const { clause, params } = this.where(filter);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM usage ${clause}`).get(...params);
    return Number(row?.n ?? 0);
  }

  sumCost(opts: { since?: number; until?: number; tag?: string } = {}): number {
    const { clause, params } = this.where(opts);
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(totalCost), 0) AS s FROM usage ${clause}`)
      .get(...params);
    return Number(row?.s ?? 0);
  }

  aggregate(opts: AggregateOptions = {}): AggregateRow[] {
    const groupBy = opts.groupBy ?? "tag";
    const { clause, params } = this.where({ since: opts.since, until: opts.until, tag: opts.tag });
    const keyExpr =
      groupBy === "none"
        ? "'all'"
        : groupBy === "tag"
          ? "tag"
          : groupBy === "model"
            ? "model"
            : "provider";
    const sql = `
      SELECT ${keyExpr} AS key,
             COUNT(*) AS calls,
             COALESCE(SUM(inputTokens),0) AS inputTokens,
             COALESCE(SUM(outputTokens),0) AS outputTokens,
             COALESCE(SUM(totalTokens),0) AS totalTokens,
             COALESCE(SUM(totalCost),0) AS totalCost,
             COALESCE(AVG(latencyMs),0) AS avgLatencyMs
      FROM usage ${clause}
      GROUP BY ${keyExpr}
      ORDER BY totalCost DESC`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => ({
        key: String(r.key),
        calls: Number(r.calls),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        totalTokens: Number(r.totalTokens),
        totalCost: Number(r.totalCost),
        avgLatencyMs: Number(r.avgLatencyMs),
      }));
  }

  reset(): void {
    this.db.exec("DELETE FROM usage");
  }

  close(): void {
    this.db.close();
  }
}

function rowToRecord(r: Record<string, unknown>): UsageRecord {
  return {
    id: String(r.id),
    timestamp: Number(r.timestamp),
    provider: String(r.provider),
    model: String(r.model),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    totalTokens: Number(r.totalTokens),
    inputCost: Number(r.inputCost),
    outputCost: Number(r.outputCost),
    totalCost: Number(r.totalCost),
    latencyMs: Number(r.latencyMs),
    tag: String(r.tag),
    estimated: Number(r.estimated) === 1,
    pricingMissing: Number(r.pricingMissing) === 1,
  };
}

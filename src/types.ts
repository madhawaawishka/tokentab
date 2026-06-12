/**
 * Core types for tokenmeter. These are the public contracts re-exported from
 * the package root, so changing them is a breaking change.
 */

/** A single measured LLM call. */
export interface UsageRecord {
  /** uuid for the record. */
  id: string;
  /** Epoch milliseconds when the call started. */
  timestamp: number;
  /** Provider slug, e.g. "openai" | "anthropic" | "gemini". */
  provider: string;
  /** Model id reported by the provider (or requested, if not reported). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** USD. 0 when pricing is missing (see `pricingMissing`). */
  inputCost: number;
  /** USD. 0 when pricing is missing. */
  outputCost: number;
  /** USD. 0 when pricing is missing. */
  totalCost: number;
  /** Wall-clock latency of the call in milliseconds. */
  latencyMs: number;
  /** Free-form feature tag, e.g. "summarize". Defaults to "default". */
  tag: string;
  /** True when token counts were estimated locally, not reported by the provider. */
  estimated: boolean;
  /** True when no pricing entry was found for this provider/model. */
  pricingMissing: boolean;
}

/** Per-model rates in USD per 1,000,000 tokens. */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

/** provider -> model -> rates. */
export type PricingTable = Record<string, Record<string, ModelPrice>>;

export type BudgetWindow = "day" | "week" | "month" | "total";
export type BudgetMode = "block" | "warn";

export interface BudgetConfig {
  /** Spend limit for the window, in USD. */
  limit: number;
  /** Rolling window the limit applies to. Default "month". */
  window?: BudgetWindow;
  /** "block" throws before the call; "warn" logs and proceeds. Default "block". */
  mode?: BudgetMode;
  /** Optional per-tag sub-limits in USD. */
  perTag?: Record<string, number>;
}

/** Filter passed to `Store.query`. */
export interface QueryFilter {
  since?: number;
  until?: number;
  provider?: string;
  model?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  /** "asc" | "desc" by timestamp. Default "desc". */
  order?: "asc" | "desc";
}

export interface AggregateOptions {
  since?: number;
  until?: number;
  tag?: string;
  /** Dimension to group by. */
  groupBy?: "tag" | "model" | "provider" | "none";
}

export interface AggregateRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
}

/** Storage backend. Implementations must be failure-tolerant on `append`. */
export interface Store {
  append(record: UsageRecord): void | Promise<void>;
  query(filter?: QueryFilter): UsageRecord[] | Promise<UsageRecord[]>;
  aggregate(opts?: AggregateOptions): AggregateRow[] | Promise<AggregateRow[]>;
  /** Sum of totalCost within [since, until], optionally for one tag. */
  sumCost(opts?: {
    since?: number;
    until?: number;
    tag?: string;
  }): number | Promise<number>;
  count(filter?: QueryFilter): number | Promise<number>;
  reset(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface TokenmeterConfig {
  /** Storage backend: built-in name or a custom Store instance. */
  store?: "sqlite" | "json" | "auto" | Store;
  /** Path to the store file. Default "./.tokenmeter/usage.db" (or .jsonl). */
  dbPath?: string;
  /**
   * Browser builds only: base URL of a running `tokentab dashboard` to mirror
   * records to (default http://127.0.0.1:3000 while the page is served from
   * localhost; off otherwise). Set `false` to disable mirroring entirely.
   */
  syncUrl?: string | false;
  /** Pricing overrides merged over the bundled table. */
  pricing?: PricingTable;
  budget?: BudgetConfig;
  /** When true (default), prompt/completion text is never stored. */
  redactPrompts?: boolean;
  /** Global kill-switch. When false, calls pass through untracked. Default true. */
  enabled?: boolean;
}

/** Options for `withTracking`. */
export interface TrackingOptions {
  /** Default tag applied to all calls through this wrapper. */
  tag?: string;
  /** Force a provider instead of auto-detecting. */
  provider?: string;
  /** Display label for openai-compatible providers (e.g. "groq"). */
  providerLabel?: string;
}

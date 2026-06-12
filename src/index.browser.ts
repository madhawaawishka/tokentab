/**
 * Browser entry. Identical public API to index.ts, but installs the
 * localStorage store backend and pulls in no `node:` modules, so bundlers
 * (Vite, webpack, …) resolve it via the package's "browser" export condition
 * with zero configuration. Records are kept in localStorage and mirrored,
 * best-effort, to a locally running `tokentab dashboard`.
 */
import { installBrowserStoreFactory } from "./store/install-browser.js";

installBrowserStoreFactory();

export { withTracking } from "./tracker.js";
export {
  enableAutoTracking,
  disableAutoTracking,
} from "./auto-instrument.js";
export type { AutoTrackingOptions } from "./auto-instrument.js";
export {
  configure,
  getStore,
  resetConfig,
} from "./config.js";
export { registerAdapter, getAdapter, listAdapters } from "./adapters/index.js";
export { registerBuiltinAdapters } from "./adapters/register.js";
export { cost, findPrice, getPricingTable } from "./pricing/index.js";
export { estimate } from "./tokenize.js";
export { checkBudget, windowStart } from "./budget.js";
export { BudgetExceededError, AdapterNotFoundError } from "./errors.js";
export {
  overview,
  breakdown,
  costOverTime,
  dailyActivity,
  recentCalls,
  toCsv,
  toJson,
} from "./report.js";
export type { Overview, TimeBucket, DayActivity } from "./report.js";
export { LocalStorageStore } from "./store/browser.js";
export type { BrowserStoreOptions } from "./store/browser.js";
export { MemoryStore } from "./store/memory.js";

export type { Adapter, ExtractedUsage, StreamAccumulator } from "./adapters/index.js";
export type {
  UsageRecord,
  Store,
  PricingTable,
  ModelPrice,
  BudgetConfig,
  BudgetWindow,
  BudgetMode,
  TokenmeterConfig,
  TrackingOptions,
  QueryFilter,
  AggregateOptions,
  AggregateRow,
} from "./types.js";

// Install the Node (SQLite / JSON-file) store backend for this entry.
import { installNodeStoreFactory } from "./store/install-node.js";

installNodeStoreFactory();

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

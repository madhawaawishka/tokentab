import { createStore } from "./store/index.js";
import type { BudgetConfig, PricingTable, Store, TokenmeterConfig } from "./types.js";

interface ResolvedConfig {
  storeOption: "sqlite" | "json" | "auto" | Store;
  dbPath?: string;
  pricingOverrides: PricingTable;
  budget?: BudgetConfig;
  redactPrompts: boolean;
  enabled: boolean;
}

const DEFAULTS: ResolvedConfig = {
  storeOption: "auto",
  dbPath: undefined,
  pricingOverrides: {},
  budget: undefined,
  redactPrompts: true,
  enabled: true,
};

let config: ResolvedConfig = { ...DEFAULTS };
let storeInstance: Store | null = null;

/**
 * Configure tokenmeter globally. Merges over existing config (and over the
 * bundled pricing table for `pricing`). Calling this invalidates any cached
 * store so a new `dbPath`/`store` takes effect on next use.
 */
export function configure(options: TokenmeterConfig = {}): void {
  if (options.store !== undefined) config.storeOption = options.store;
  if (options.dbPath !== undefined) config.dbPath = options.dbPath;
  if (options.pricing !== undefined) {
    config.pricingOverrides = mergePricing(config.pricingOverrides, options.pricing);
  }
  if (options.budget !== undefined) config.budget = options.budget;
  if (options.redactPrompts !== undefined) config.redactPrompts = options.redactPrompts;
  if (options.enabled !== undefined) config.enabled = options.enabled;

  // Store-affecting options changed: drop the cached instance.
  if (options.store !== undefined || options.dbPath !== undefined) {
    if (storeInstance?.close) {
      try {
        void storeInstance.close();
      } catch {
        /* ignore */
      }
    }
    storeInstance = null;
  }
}

/** Reset all configuration to defaults (used by tests). */
export function resetConfig(): void {
  if (storeInstance?.close) {
    try {
      void storeInstance.close();
    } catch {
      /* ignore */
    }
  }
  storeInstance = null;
  config = { ...DEFAULTS, pricingOverrides: {} };
}

export function getConfigState(): Readonly<ResolvedConfig> {
  return config;
}

export function isEnabled(): boolean {
  return config.enabled;
}

export function getRedactPrompts(): boolean {
  return config.redactPrompts;
}

export function getBudgetConfig(): BudgetConfig | undefined {
  return config.budget;
}

export function getPricingOverrides(): PricingTable {
  return config.pricingOverrides;
}

/** Lazily create (and cache) the configured store. */
export function getStore(): Store {
  if (config.storeOption && typeof config.storeOption === "object") {
    return config.storeOption;
  }
  if (!storeInstance) {
    storeInstance = createStore(config.storeOption, config.dbPath);
  }
  return storeInstance;
}

function mergePricing(base: PricingTable, override: PricingTable): PricingTable {
  const out: PricingTable = {};
  for (const [provider, models] of Object.entries(base)) {
    out[provider] = { ...models };
  }
  for (const [provider, models] of Object.entries(override)) {
    out[provider] = { ...(out[provider] ?? {}), ...models };
  }
  return out;
}

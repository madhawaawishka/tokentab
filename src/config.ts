import { MemoryStore } from "./store/memory.js";
import type { BudgetConfig, PricingTable, Store, TokenmeterConfig } from "./types.js";

interface ResolvedConfig {
  storeOption: "sqlite" | "json" | "auto" | Store;
  dbPath?: string;
  syncUrl?: string | false;
  pricingOverrides: PricingTable;
  budget?: BudgetConfig;
  redactPrompts: boolean;
  enabled: boolean;
}

const DEFAULTS: ResolvedConfig = {
  storeOption: "auto",
  dbPath: undefined,
  syncUrl: undefined,
  pricingOverrides: {},
  budget: undefined,
  redactPrompts: true,
  enabled: true,
};

/** Arguments handed to the store factory for the current environment. */
export interface StoreRequest {
  option: "sqlite" | "json" | "auto";
  dbPath?: string;
  syncUrl?: string | false;
}

// The default store backend differs per build: the Node entries install the
// SQLite/JSON-file factory, the browser entries install the localStorage one.
// config.ts itself must stay free of `node:` imports so it bundles anywhere;
// the memory store is the universally safe fallback.
let storeFactory: (req: StoreRequest) => Store = () => new MemoryStore();

/** Install the environment's default store backend (called by entry modules). */
export function setStoreFactory(factory: (req: StoreRequest) => Store): void {
  storeFactory = factory;
}

interface GlobalState {
  config: ResolvedConfig;
  storeInstance: Store | null;
}

// The package ships several entry points (index, auto, register, cli). With code
// splitting off, each bundle would otherwise carry its OWN copy of this module's
// state — so `configure()` from `tokentab` wouldn't reach a call tracked by
// `tokentab/auto`. Anchoring the mutable state on globalThis keeps it singular
// across every bundle copy in the process.
const STATE_KEY = Symbol.for("tokentab.configState");

function state(): GlobalState {
  const g = globalThis as unknown as Record<symbol, GlobalState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = { config: { ...DEFAULTS, pricingOverrides: {} }, storeInstance: null };
    g[STATE_KEY] = s;
  }
  return s;
}

/**
 * Configure tokenmeter globally. Merges over existing config (and over the
 * bundled pricing table for `pricing`). Calling this invalidates any cached
 * store so a new `dbPath`/`store` takes effect on next use.
 */
export function configure(options: TokenmeterConfig = {}): void {
  const s = state();
  const config = s.config;
  if (options.store !== undefined) config.storeOption = options.store;
  if (options.dbPath !== undefined) config.dbPath = options.dbPath;
  if (options.syncUrl !== undefined) config.syncUrl = options.syncUrl;
  if (options.pricing !== undefined) {
    config.pricingOverrides = mergePricing(config.pricingOverrides, options.pricing);
  }
  if (options.budget !== undefined) config.budget = options.budget;
  if (options.redactPrompts !== undefined) config.redactPrompts = options.redactPrompts;
  if (options.enabled !== undefined) config.enabled = options.enabled;

  // Store-affecting options changed: drop the cached instance.
  if (
    options.store !== undefined ||
    options.dbPath !== undefined ||
    options.syncUrl !== undefined
  ) {
    if (s.storeInstance?.close) {
      try {
        void s.storeInstance.close();
      } catch {
        /* ignore */
      }
    }
    s.storeInstance = null;
  }
}

/** Reset all configuration to defaults (used by tests). */
export function resetConfig(): void {
  const s = state();
  if (s.storeInstance?.close) {
    try {
      void s.storeInstance.close();
    } catch {
      /* ignore */
    }
  }
  s.storeInstance = null;
  s.config = { ...DEFAULTS, pricingOverrides: {} };
}

export function getConfigState(): Readonly<ResolvedConfig> {
  return state().config;
}

export function isEnabled(): boolean {
  return state().config.enabled;
}

export function getRedactPrompts(): boolean {
  return state().config.redactPrompts;
}

export function getBudgetConfig(): BudgetConfig | undefined {
  return state().config.budget;
}

export function getPricingOverrides(): PricingTable {
  return state().config.pricingOverrides;
}

/** Lazily create (and cache) the configured store. */
export function getStore(): Store {
  const s = state();
  const option = s.config.storeOption;
  if (option && typeof option === "object") {
    return option;
  }
  if (!s.storeInstance) {
    s.storeInstance = storeFactory({
      option,
      dbPath: s.config.dbPath,
      syncUrl: s.config.syncUrl,
    });
  }
  return s.storeInstance;
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

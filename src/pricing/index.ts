import { getPricingOverrides } from "../config.js";
import type { ModelPrice, PricingTable } from "../types.js";
import bundled from "./prices.json" with { type: "json" };

const bundledTable = bundled as PricingTable;

export interface CostResult {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  pricingMissing: boolean;
}

const warnedMissing = new Set<string>();

/** Merge of the bundled table and any runtime overrides (overrides win). */
export function getPricingTable(): PricingTable {
  const overrides = getPricingOverrides();
  const out: PricingTable = {};
  for (const [provider, models] of Object.entries(bundledTable)) {
    out[provider] = { ...models };
  }
  for (const [provider, models] of Object.entries(overrides)) {
    out[provider] = { ...(out[provider] ?? {}), ...models };
  }
  return out;
}

/** The raw bundled pricing table (no overrides). */
export function getBundledPricingTable(): PricingTable {
  return bundledTable;
}

function stripDateSuffix(model: string): string {
  // "claude-3-5-sonnet-20241022" -> "claude-3-5-sonnet"
  return model.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

/** Find a price for provider/model, tolerating dated and prefixed variants. */
export function findPrice(provider: string, model: string): ModelPrice | undefined {
  const table = getPricingTable();
  const models = table[provider];
  if (!models) return undefined;
  if (models[model]) return models[model];

  const stripped = stripDateSuffix(model);
  if (models[stripped]) return models[stripped];

  // Longest-prefix match (e.g. "gpt-4o-mini-2024-..." -> "gpt-4o-mini").
  let best: { key: string; price: ModelPrice } | undefined;
  for (const [key, price] of Object.entries(models)) {
    if (
      (model.startsWith(key) || stripped.startsWith(key)) &&
      key.length > (best?.key.length ?? 0)
    ) {
      best = { key, price };
    }
  }
  return best?.price;
}

/**
 * Compute USD cost. Missing pricing is non-fatal: returns zeros with
 * `pricingMissing: true` and emits a one-time warning per provider/model.
 */
export function cost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostResult {
  const price = findPrice(provider, model);
  if (!price) {
    const key = `${provider}/${model}`;
    if (!warnedMissing.has(key)) {
      warnedMissing.add(key);
      console.warn(
        `[tokenmeter] No pricing for "${model}" (provider "${provider}"). Cost recorded as 0. Add it via configure({ pricing }) or contribute to prices.json.`,
      );
    }
    return { inputCost: 0, outputCost: 0, totalCost: 0, pricingMissing: true };
  }
  const inputCost = (inputTokens / 1_000_000) * price.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * price.outputPer1M;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    pricingMissing: false,
  };
}

/** Reset the one-time warning cache (used by tests). */
export function resetPricingWarnings(): void {
  warnedMissing.clear();
}

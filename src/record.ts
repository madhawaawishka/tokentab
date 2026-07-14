import { getStore } from "./config.js";
import { cost } from "./pricing/index.js";
import type { UsageRecord } from "./types.js";

/**
 * Portable UUID v4. `crypto.randomUUID` exists in Node >= 18 and in browsers,
 * but browsers expose it only in secure contexts (https / localhost), so a
 * Math.random fallback keeps tracking alive on plain-http pages.
 */
function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface RecordInput {
  provider: string;
  tag: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  latencyMs: number;
}

/**
 * Cost a call and append it to the store. Non-blocking and failure-tolerant:
 * a store error must never break the user's LLM call.
 */
export function recordUsage(data: RecordInput): void {
  const { inputCost, outputCost, totalCost, pricingMissing } = cost(
    data.provider,
    data.model,
    data.inputTokens,
    data.outputTokens,
  );
  const record: UsageRecord = {
    id: uuid(),
    timestamp: Date.now(),
    provider: data.provider,
    model: data.model,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens: data.inputTokens + data.outputTokens,
    inputCost,
    outputCost,
    totalCost,
    latencyMs: data.latencyMs,
    tag: data.tag,
    estimated: data.estimated,
    pricingMissing,
  };
  try {
    const r = getStore().append(record);
    if (r && typeof (r as Promise<void>).catch === "function") {
      (r as Promise<void>).catch(() => {});
    }
  } catch {
    /* swallow store errors */
  }
}

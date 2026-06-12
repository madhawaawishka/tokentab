import { randomUUID } from "node:crypto";
import { getStore } from "./config.js";
import { cost } from "./pricing/index.js";
import type { UsageRecord } from "./types.js";

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
    id: randomUUID(),
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

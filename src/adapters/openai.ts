import type { Adapter, ExtractedUsage, StreamAccumulator } from "./index.js";

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function hasFn(obj: any, path: string[]): boolean {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return false;
    cur = cur[key];
  }
  return typeof cur === "function";
}

/**
 * Extract usage from both the Chat Completions shape
 * (`usage.prompt_tokens` / `completion_tokens`) and the Responses API shape
 * (`usage.input_tokens` / `output_tokens`).
 */
export function extractOpenAIUsage(response: unknown): ExtractedUsage | null {
  const r = response as any;
  const usage = r?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = num(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = num(usage.completion_tokens ?? usage.output_tokens);
  const model = typeof r.model === "string" ? r.model : "unknown";
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { model, inputTokens, outputTokens };
}

export const openaiAdapter: Adapter = {
  name: "openai",
  detect(client) {
    const c = client as any;
    if (!c || typeof c !== "object") return false;
    // OpenAI SDK exposes chat.completions.create and (newer) responses.create.
    const looksOpenAI =
      hasFn(c, ["chat", "completions", "create"]) || hasFn(c, ["responses", "create"]);
    if (!looksOpenAI) return false;
    // Disambiguate from Anthropic, which uses messages.create instead.
    if (c.constructor?.name === "Anthropic") return false;
    return true;
  },
  extractUsage: extractOpenAIUsage,
  extractStreamUsage(chunk, acc: StreamAccumulator) {
    const ch = chunk as any;
    if (typeof ch?.model === "string") acc.model = ch.model;
    const delta = ch?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") acc.text += delta;
    if (ch?.usage && typeof ch.usage === "object") {
      const found = extractOpenAIUsage(ch);
      if (found) {
        acc.inputTokens = found.inputTokens;
        acc.outputTokens = found.outputTokens;
        acc.model = found.model;
        return found;
      }
    }
    return null;
  },
};

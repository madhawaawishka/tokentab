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

export function extractAnthropicUsage(response: unknown): ExtractedUsage | null {
  const r = response as any;
  const usage = r?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const model = typeof r.model === "string" ? r.model : "unknown";
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { model, inputTokens, outputTokens };
}

export const anthropicAdapter: Adapter = {
  name: "anthropic",
  detect(client) {
    const c = client as any;
    if (!c || typeof c !== "object") return false;
    if (c.constructor?.name === "Anthropic") return true;
    // messages.create, but NOT chat.completions (that's OpenAI-compatible).
    return hasFn(c, ["messages", "create"]) && !hasFn(c, ["chat", "completions", "create"]);
  },
  extractUsage: extractAnthropicUsage,
  extractStreamUsage(chunk, acc: StreamAccumulator) {
    const ch = chunk as any;
    const type = ch?.type;
    // message_start carries the model and input_tokens.
    if (type === "message_start" && ch.message) {
      if (typeof ch.message.model === "string") acc.model = ch.message.model;
      const u = ch.message.usage;
      if (u) {
        acc.inputTokens = num(u.input_tokens);
        acc.outputTokens = num(u.output_tokens);
      }
    }
    // content_block_delta carries streamed text.
    if (type === "content_block_delta" && typeof ch.delta?.text === "string") {
      acc.text += ch.delta.text;
    }
    // message_delta carries the final cumulative output_tokens.
    if (type === "message_delta" && ch.usage) {
      acc.outputTokens = num(ch.usage.output_tokens);
    }
    if (acc.inputTokens != null && acc.outputTokens != null) {
      return {
        model: acc.model ?? "unknown",
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
      };
    }
    return null;
  },
};

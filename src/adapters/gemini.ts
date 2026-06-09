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

export function extractGeminiUsage(response: unknown): ExtractedUsage | null {
  const r = response as any;
  const meta = r?.usageMetadata;
  if (!meta || typeof meta !== "object") return null;
  const inputTokens = num(meta.promptTokenCount);
  // Gemini counts thinking tokens separately; include them in output cost.
  const outputTokens = num(meta.candidatesTokenCount) + num(meta.thoughtsTokenCount);
  const model = typeof r.modelVersion === "string" ? r.modelVersion : "unknown";
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { model, inputTokens, outputTokens };
}

export const geminiAdapter: Adapter = {
  name: "gemini",
  detect(client) {
    const c = client as any;
    if (!c || typeof c !== "object") return false;
    const ctor = c.constructor?.name;
    if (ctor === "GoogleGenAI" || ctor === "GoogleGenerativeAI") return true;
    // @google/genai exposes models.generateContent; legacy SDK getGenerativeModel.
    return hasFn(c, ["models", "generateContent"]) || hasFn(c, ["getGenerativeModel"]);
  },
  extractUsage: extractGeminiUsage,
  extractStreamUsage(chunk, acc: StreamAccumulator) {
    const ch = chunk as any;
    const text = ch?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
    if (typeof text === "string") acc.text += text;
    // Streamed Gemini responses include usageMetadata on the final chunk.
    const found = extractGeminiUsage(ch);
    if (found) {
      acc.inputTokens = found.inputTokens;
      acc.outputTokens = found.outputTokens;
      acc.model = found.model;
      return found;
    }
    return null;
  },
};

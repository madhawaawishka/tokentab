/**
 * Zero-dependency token estimation. Used only when a provider returns no usage
 * (some streamed or OpenAI-compatible responses). Records built from these
 * counts are flagged `estimated: true`. This deliberately avoids bundling a
 * multi-megabyte tokenizer; the heuristic is "good enough" for budgeting, not
 * billing-grade.
 */

/** Rough characters-per-token ratio by model family. */
function charsPerToken(model: string): number {
  const m = model.toLowerCase();
  // English text averages ~4 chars/token across modern BPE tokenizers.
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return 4;
  if (m.includes("claude")) return 3.8;
  if (m.includes("gemini")) return 4;
  return 4;
}

/** Estimate the token count of a string for the given model. */
export function estimate(text: string, model = "gpt-4o"): number {
  if (!text) return 0;
  const byChars = text.length / charsPerToken(model);
  // Whitespace-split word count is a useful floor for short strings.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const byWords = words * 1.3;
  return Math.max(1, Math.ceil(Math.max(byChars, byWords)));
}

/**
 * Best-effort extraction of prompt text from a provider request payload, for
 * pre-flight input estimation. Handles OpenAI chat `messages`, Anthropic
 * `messages` + `system`, a bare `prompt`, and Gemini `contents`.
 */
export function estimateInputTokens(args: unknown, model = "gpt-4o"): number {
  const text = collectRequestText(args);
  return estimate(text, model);
}

function collectRequestText(args: unknown): string {
  const a = args as any;
  if (!a || typeof a !== "object") return typeof a === "string" ? a : "";
  const parts: string[] = [];

  if (typeof a.prompt === "string") parts.push(a.prompt);
  if (typeof a.system === "string") parts.push(a.system);
  if (Array.isArray(a.system)) parts.push(textFromBlocks(a.system));

  if (Array.isArray(a.messages)) {
    for (const msg of a.messages) {
      if (typeof msg?.content === "string") parts.push(msg.content);
      else if (Array.isArray(msg?.content)) parts.push(textFromBlocks(msg.content));
    }
  }

  // Gemini-style contents.
  if (Array.isArray(a.contents)) {
    for (const c of a.contents) {
      if (typeof c === "string") parts.push(c);
      else if (Array.isArray(c?.parts)) parts.push(textFromBlocks(c.parts));
    }
  } else if (typeof a.contents === "string") {
    parts.push(a.contents);
  }

  return parts.join("\n");
}

function textFromBlocks(blocks: unknown[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (typeof b === "string") out.push(b);
    else if (typeof (b as any)?.text === "string") out.push((b as any).text);
  }
  return out.join("\n");
}

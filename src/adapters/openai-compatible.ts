import type { Adapter } from "./index.js";
import { extractOpenAIUsage, openaiAdapter } from "./openai.js";

/**
 * Covers any provider that speaks the OpenAI wire format: Groq, Together,
 * Fireworks, OpenRouter, Perplexity, DeepInfra, Hyperbolic, Novita,
 * SiliconFlow, Cerebras, NVIDIA NIM, and local servers (Ollama / LM Studio /
 * vLLM). Reached only by selecting `provider: "openai-compatible"` explicitly,
 * so `detect` always returns false to avoid hijacking the native openai client.
 */
export const openaiCompatibleAdapter: Adapter = {
  name: "openai-compatible",
  detect() {
    return false;
  },
  extractUsage: extractOpenAIUsage,
  extractStreamUsage: openaiAdapter.extractStreamUsage,
};

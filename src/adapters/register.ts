import { anthropicAdapter } from "./anthropic.js";
import { geminiAdapter } from "./gemini.js";
import { registerAdapter } from "./index.js";
import { openaiCompatibleAdapter } from "./openai-compatible.js";
import { openaiAdapter } from "./openai.js";

let registered = false;

/** Register all bundled adapters exactly once. */
export function registerBuiltinAdapters(): void {
  if (registered) return;
  registered = true;
  registerAdapter(openaiAdapter);
  registerAdapter(anthropicAdapter);
  registerAdapter(geminiAdapter);
  registerAdapter(openaiCompatibleAdapter);
}

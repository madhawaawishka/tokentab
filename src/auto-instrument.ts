import { getAdapter } from "./adapters/index.js";
import type { Adapter, StreamAccumulator } from "./adapters/index.js";
import { registerBuiltinAdapters } from "./adapters/register.js";
import { isEnabled } from "./config.js";
import { recordUsage } from "./record.js";

export interface AutoTrackingOptions {
  /** Feature label recorded for auto-tracked calls (default "auto"). */
  tag?: string;
  /**
   * Extra host substrings → provider slug, for self-hosted or proxied
   * endpoints (e.g. an OpenAI-compatible gateway). Merged over the built-ins.
   */
  hosts?: Record<string, string>;
}

type Fetch = typeof fetch;

interface PatchState {
  original: Fetch;
  tag: string;
  hosts: Record<string, string>;
}

// One patch per process, shared across every bundle copy of this module.
const PATCH_KEY = Symbol.for("tokentab.autoFetchPatch");

function patchSlot(): { current?: PatchState } {
  const g = globalThis as unknown as Record<symbol, { current?: PatchState } | undefined>;
  let slot = g[PATCH_KEY];
  if (!slot) {
    slot = {};
    g[PATCH_KEY] = slot;
  }
  return slot;
}

const BUILTIN_HOSTS: Record<string, string> = {
  "api.openai.com": "openai",
  "api.anthropic.com": "anthropic",
  "generativelanguage.googleapis.com": "gemini",
};

function urlOf(input: unknown): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input === "object" && typeof (input as Request).url === "string") {
      return (input as Request).url;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function providerFor(url: string, hosts: Record<string, string>): string | null {
  for (const [host, provider] of Object.entries(hosts)) {
    if (url.includes(host)) return provider;
  }
  return null;
}

/**
 * Tee an SSE response: bytes pass through to the caller unchanged while we parse
 * `data:` chunks for usage and record once the stream ends.
 */
function teeStream(
  res: Response,
  adapter: Adapter,
  provider: string,
  tag: string,
  started: number,
): Response {
  if (!res.body) return res;
  const decoder = new TextDecoder();
  const acc: StreamAccumulator = { text: "" };
  let finalUsage: ReturnType<Adapter["extractUsage"]> = null;
  let buffer = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk); // never alter the user's bytes
      try {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const u = adapter.extractStreamUsage?.(parsed, acc);
          if (u) finalUsage = u;
        }
      } catch {
        /* parsing must never break the passthrough */
      }
    },
    flush() {
      const latencyMs = Date.now() - started;
      if (finalUsage && (finalUsage.inputTokens || finalUsage.outputTokens)) {
        recordUsage({
          provider,
          tag,
          model: finalUsage.model || acc.model || "unknown",
          inputTokens: finalUsage.inputTokens,
          outputTokens: finalUsage.outputTokens,
          estimated: false,
          latencyMs,
        });
      } else if (acc.inputTokens || acc.outputTokens) {
        recordUsage({
          provider,
          tag,
          model: acc.model || "unknown",
          inputTokens: acc.inputTokens ?? 0,
          outputTokens: acc.outputTokens ?? 0,
          estimated: true,
          latencyMs,
        });
      }
    },
  });

  return new Response(res.body.pipeThrough(transform), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

function recordJson(
  res: Response,
  adapter: Adapter,
  provider: string,
  tag: string,
  started: number,
): void {
  // clone() so reading the body here never disturbs the caller's own read.
  res
    .clone()
    .json()
    .then((data) => {
      const u = adapter.extractUsage(data);
      if (u && (u.inputTokens || u.outputTokens)) {
        recordUsage({
          provider,
          tag,
          model: u.model || "unknown",
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          estimated: false,
          latencyMs: Date.now() - started,
        });
      }
    })
    .catch(() => {
      /* non-JSON or unreadable body: nothing to record */
    });
}

/**
 * Replace global `fetch` so calls to known LLM REST endpoints (OpenAI,
 * Anthropic, Gemini — and anything routed through their SDKs, which use global
 * fetch under the hood) are measured automatically, with no client wrapping.
 *
 * Idempotent. Server-side only — requires Node's filesystem for the store.
 */
export function enableAutoTracking(options: AutoTrackingOptions = {}): void {
  const slot = patchSlot();
  if (slot.current) return; // already patched

  const original = globalThis.fetch;
  if (typeof original !== "function") {
    // No global fetch (e.g. Node < 18): nothing to instrument.
    return;
  }

  registerBuiltinAdapters();

  const stateForCall: PatchState = {
    original,
    tag: options.tag ?? "auto",
    hosts: { ...BUILTIN_HOSTS, ...(options.hosts ?? {}) },
  };
  slot.current = stateForCall;

  const patched: Fetch = async (input, init) => {
    const url = urlOf(input);
    const started = Date.now();
    const res = await stateForCall.original(input as RequestInfo, init);
    try {
      if (!isEnabled() || !res.ok) return res;
      const provider = providerFor(url, stateForCall.hosts);
      if (!provider) return res;
      const adapter = getAdapter(provider);
      if (!adapter) return res;

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        return teeStream(res, adapter, provider, stateForCall.tag, started);
      }
      recordJson(res, adapter, provider, stateForCall.tag, started);
      return res;
    } catch {
      // Any failure in tracking must hand back the untouched response.
      return res;
    }
  };

  globalThis.fetch = patched;
}

/** Restore the original global `fetch`. No-op if auto-tracking isn't enabled. */
export function disableAutoTracking(): void {
  const slot = patchSlot();
  if (!slot.current) return;
  globalThis.fetch = slot.current.original;
  slot.current = undefined;
}

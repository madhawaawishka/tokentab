import { AdapterNotFoundError } from "../errors.js";

export interface ExtractedUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * An adapter teaches tokenmeter two things about a provider: how to recognize
 * its client, and where usage lives on a response. Add a provider by dropping
 * one file here and calling `registerAdapter`.
 */
export interface Adapter {
  /** Unique provider slug, e.g. "openai". */
  name: string;
  /** Return true if `client` looks like this provider's SDK instance. */
  detect(client: unknown): boolean;
  /** Pull usage from a (non-streaming) response, or null if absent. */
  extractUsage(response: unknown): ExtractedUsage | null;
  /**
   * Optional: accumulate usage from streamed chunks. Called once per chunk;
   * the adapter returns the best-known usage so far (or null). The tracker uses
   * the final non-null value. Many providers send a final chunk carrying usage.
   */
  extractStreamUsage?(chunk: unknown, acc: StreamAccumulator): ExtractedUsage | null;
}

/** Mutable scratch space handed to `extractStreamUsage` across chunks. */
export interface StreamAccumulator {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Concatenated text content, used for estimation fallback. */
  text: string;
}

const registry = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  registry.set(adapter.name, adapter);
}

export function getAdapter(name: string): Adapter | undefined {
  return registry.get(name);
}

export function listAdapters(): Adapter[] {
  return [...registry.values()];
}

/** Find the adapter whose `detect` matches the client. */
export function detectAdapter(client: unknown): Adapter | undefined {
  for (const adapter of registry.values()) {
    try {
      if (adapter.detect(client)) return adapter;
    } catch {
      /* a flaky detect must not break detection of others */
    }
  }
  return undefined;
}

/**
 * Resolve an adapter for a client: explicit name wins, else auto-detect.
 * Throws AdapterNotFoundError when neither yields a result.
 */
export function resolveAdapter(client: unknown, explicit?: string): Adapter {
  if (explicit) {
    const found = registry.get(explicit);
    if (!found) {
      throw new AdapterNotFoundError(
        `No adapter registered for provider "${explicit}". ` +
          `Known providers: ${[...registry.keys()].join(", ")}.`,
      );
    }
    return found;
  }
  const detected = detectAdapter(client);
  if (!detected) {
    throw new AdapterNotFoundError(
      "Could not auto-detect the LLM provider from the client. " +
        'Pass an explicit `provider` option, e.g. withTracking(client, { provider: "openai" }).',
    );
  }
  return detected;
}

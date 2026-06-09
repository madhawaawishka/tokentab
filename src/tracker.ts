import { randomUUID } from "node:crypto";
import type { Adapter, ExtractedUsage, StreamAccumulator } from "./adapters/index.js";
import { resolveAdapter } from "./adapters/index.js";
import { registerBuiltinAdapters } from "./adapters/register.js";
import { checkBudget } from "./budget.js";
import { getStore, isEnabled } from "./config.js";
import { cost } from "./pricing/index.js";
import { estimate, estimateInputTokens } from "./tokenize.js";
import type { TrackingOptions, UsageRecord } from "./types.js";

registerBuiltinAdapters();

/** Dotted paths to the tracked completion method for each adapter. */
const ENDPOINTS: Record<string, string[][]> = {
  openai: [
    ["chat", "completions", "create"],
    ["responses", "create"],
  ],
  "openai-compatible": [
    ["chat", "completions", "create"],
    ["responses", "create"],
  ],
  anthropic: [["messages", "create"]],
  gemini: [
    ["models", "generateContent"],
    ["models", "generateContentStream"],
  ],
};

interface TrackContext {
  adapter: Adapter;
  /** Display + pricing provider slug (label for openai-compatible). */
  provider: string;
  tag: string;
  originalClient: unknown;
  options: TrackingOptions;
}

/**
 * Wrap an LLM client so every completion call is measured. Returns a transparent
 * proxy of the same type — methods, signatures, streaming and private state are
 * preserved. Disabled or unrecognized clients are returned untracked.
 */
export function withTracking<T extends object>(client: T, options: TrackingOptions = {}): T {
  let adapter: Adapter;
  try {
    adapter = resolveAdapter(client, options.provider);
  } catch (err) {
    // If a provider can't be resolved we must not break the user's client.
    if (options.provider) throw err; // explicit but unknown provider is a real error
    return client;
  }

  const provider =
    adapter.name === "openai-compatible"
      ? (options.providerLabel ?? "openai-compatible")
      : adapter.name;

  const ctx: TrackContext = {
    adapter,
    provider,
    tag: options.tag ?? "default",
    originalClient: client,
    options,
  };

  return createProxy(client, ctx, []);
}

function isEndpoint(ctx: TrackContext, path: string[]): boolean {
  const paths = ENDPOINTS[ctx.adapter.name] ?? [];
  return paths.some((p) => p.length === path.length && p.every((seg, i) => seg === path[i]));
}

/** Is `path` a strict prefix of any tracked endpoint path? */
function isOnPath(ctx: TrackContext, path: string[]): boolean {
  const paths = ENDPOINTS[ctx.adapter.name] ?? [];
  return paths.some((p) => path.length < p.length && path.every((seg, i) => seg === p[i]));
}

function createProxy<T extends object>(target: T, ctx: TrackContext, path: string[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      // Top-level helper: scoped re-tag without mutating SDK method signatures.
      if (path.length === 0 && prop === "withTag" && !(prop in obj)) {
        return (tag: string) => createProxy(ctx.originalClient as object, { ...ctx, tag }, []);
      }

      const value = Reflect.get(obj, prop, receiver);
      if (typeof prop === "symbol") return value;
      const childPath = [...path, prop];

      if (typeof value === "function") {
        if (isEndpoint(ctx, childPath)) {
          return makeTrackedMethod(value as (...a: any[]) => any, obj, ctx);
        }
        // Non-tracked methods: bind to the real object so `this`/private fields work.
        return (value as (...a: any[]) => any).bind(obj);
      }

      if (value && typeof value === "object" && isOnPath(ctx, childPath)) {
        return createProxy(value as object, ctx, childPath);
      }

      return value;
    },
  });
}

function makeTrackedMethod(
  original: (...args: any[]) => any,
  realParent: object,
  ctx: TrackContext,
) {
  return async function tracked(this: unknown, ...args: any[]): Promise<unknown> {
    if (!isEnabled()) {
      return original.apply(realParent, args);
    }

    const requestArgs = args[0];
    const requestedModel = readRequestedModel(requestArgs);
    const started = Date.now();

    // Pre-flight budget guard (may throw before the request is sent).
    await preflightBudget(ctx, requestArgs, requestedModel, started);

    const result = await original.apply(realParent, args);

    if (isAsyncIterable(result)) {
      return wrapStream(result, ctx, requestArgs, requestedModel, started);
    }
    if (result && typeof result === "object" && isAsyncIterable((result as any).stream)) {
      // Legacy Gemini shape: { stream, response }
      const wrapped = wrapStream((result as any).stream, ctx, requestArgs, requestedModel, started);
      return { ...(result as object), stream: wrapped };
    }

    recordFromResponse(result, ctx, requestedModel, started);
    return result;
  };
}

async function preflightBudget(
  ctx: TrackContext,
  requestArgs: unknown,
  model: string,
  now: number,
): Promise<void> {
  const inputTokens = estimateInputTokens(requestArgs, model);
  const outputGuess = guessMaxOutput(requestArgs) ?? inputTokens;
  const { totalCost } = cost(ctx.provider, model, inputTokens, outputGuess);
  await checkBudget({ tag: ctx.tag, projectedCost: totalCost, now });
}

function recordFromResponse(
  response: unknown,
  ctx: TrackContext,
  requestedModel: string,
  started: number,
): void {
  const latencyMs = Date.now() - started;
  let usage: ExtractedUsage | null = null;
  try {
    usage = ctx.adapter.extractUsage(response);
  } catch {
    usage = null;
  }

  if (usage) {
    writeRecord(ctx, {
      model: pickModel(usage.model, requestedModel),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimated: false,
      latencyMs,
    });
  } else {
    // No usage reported: estimate from the response text if we can find any.
    const text = extractResponseText(response);
    const model = pickModel(undefined, requestedModel);
    writeRecord(ctx, {
      model,
      inputTokens: estimateInputTokens(undefined, model),
      outputTokens: estimate(text, model),
      estimated: true,
      latencyMs,
    });
  }
}

function wrapStream(
  stream: AsyncIterable<unknown>,
  ctx: TrackContext,
  requestArgs: unknown,
  requestedModel: string,
  started: number,
): AsyncIterable<unknown> {
  // Proxy the stream so extra methods/props pass through while we tee iteration.
  return new Proxy(stream as object, {
    get(obj, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return () =>
          teeIterator(
            (obj as AsyncIterable<unknown>)[Symbol.asyncIterator](),
            ctx,
            requestArgs,
            requestedModel,
            started,
          );
      }
      const v = Reflect.get(obj, prop, receiver);
      return typeof v === "function" ? v.bind(obj) : v;
    },
  }) as AsyncIterable<unknown>;
}

function teeIterator(
  inner: AsyncIterator<unknown>,
  ctx: TrackContext,
  requestArgs: unknown,
  requestedModel: string,
  started: number,
): AsyncIterableIterator<unknown> {
  const acc: StreamAccumulator = { text: "" };
  let finalUsage: ExtractedUsage | null = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    const latencyMs = Date.now() - started;
    if (finalUsage && (finalUsage.inputTokens || finalUsage.outputTokens)) {
      writeRecord(ctx, {
        model: pickModel(finalUsage.model ?? acc.model, requestedModel),
        inputTokens: finalUsage.inputTokens,
        outputTokens: finalUsage.outputTokens,
        estimated: false,
        latencyMs,
      });
    } else {
      const model = pickModel(acc.model, requestedModel);
      const inputTokens = acc.inputTokens ?? estimateInputTokens(requestArgs, model);
      const outputTokens = acc.outputTokens ?? estimate(acc.text, model);
      writeRecord(ctx, { model, inputTokens, outputTokens, estimated: true, latencyMs });
    }
  };

  return {
    async next(...a: [] | [unknown]) {
      const r = await inner.next(...a);
      if (r.done) {
        finish();
        return r;
      }
      try {
        const u = ctx.adapter.extractStreamUsage?.(r.value, acc);
        if (u) finalUsage = u;
      } catch {
        /* ignore extraction errors mid-stream */
      }
      return r;
    },
    async return(value?: unknown) {
      finish();
      return inner.return ? inner.return(value) : { done: true, value };
    },
    async throw(err?: unknown) {
      finish();
      if (inner.throw) return inner.throw(err);
      throw err;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function writeRecord(
  ctx: TrackContext,
  data: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimated: boolean;
    latencyMs: number;
  },
): void {
  const { inputCost, outputCost, totalCost, pricingMissing } = cost(
    ctx.provider,
    data.model,
    data.inputTokens,
    data.outputTokens,
  );
  const record: UsageRecord = {
    id: randomUUID(),
    timestamp: Date.now(),
    provider: ctx.provider,
    model: data.model,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    totalTokens: data.inputTokens + data.outputTokens,
    inputCost,
    outputCost,
    totalCost,
    latencyMs: data.latencyMs,
    tag: ctx.tag,
    estimated: data.estimated,
    pricingMissing,
  };
  // Non-blocking and failure-tolerant: a store error must never break the call.
  try {
    const r = getStore().append(record);
    if (r && typeof (r as Promise<void>).catch === "function") {
      (r as Promise<void>).catch(() => {});
    }
  } catch {
    /* swallow store errors */
  }
}

// ---- small helpers ----

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return !!v && typeof (v as any)[Symbol.asyncIterator] === "function";
}

function readRequestedModel(args: unknown): string {
  const a = args as any;
  if (a && typeof a === "object" && typeof a.model === "string") return a.model;
  return "unknown";
}

function pickModel(reported: string | undefined, requested: string): string {
  if (reported && reported !== "unknown") return reported;
  return requested;
}

function guessMaxOutput(args: unknown): number | null {
  const a = args as any;
  if (!a || typeof a !== "object") return null;
  const v =
    a.max_tokens ??
    a.max_completion_tokens ??
    a.max_output_tokens ??
    a.maxOutputTokens ??
    a.generationConfig?.maxOutputTokens;
  return typeof v === "number" ? v : null;
}

function extractResponseText(response: unknown): string {
  const r = response as any;
  if (!r || typeof r !== "object") return "";
  // OpenAI chat
  const chat = r.choices?.[0]?.message?.content;
  if (typeof chat === "string") return chat;
  // Anthropic
  if (Array.isArray(r.content)) {
    return r.content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("");
  }
  // Gemini
  const parts = r.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  }
  if (typeof r.output_text === "string") return r.output_text;
  return "";
}

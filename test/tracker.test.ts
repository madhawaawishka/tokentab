import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { configure, getStore, resetConfig } from "../src/config.js";
import { BudgetExceededError } from "../src/errors.js";
import { withTracking } from "../src/tracker.js";
import {
  anthropicResponse,
  anthropicStreamChunks,
  openaiChatResponse,
  openaiStreamChunks,
} from "./fixtures.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tm-"));
  configure({ store: "json", dbPath: join(dir, "u.jsonl") });
});

afterEach(() => {
  resetConfig();
  rmSync(dir, { recursive: true, force: true });
});

// A class-based fake to verify private fields survive wrapping.
class FakeOpenAI {
  #apiKey = "sk-secret";
  baseURL = "https://api.openai.com/v1";
  chat = {
    completions: {
      // arrow keeps lexical access to #apiKey via closure-free pattern below
      create: (_args: unknown) => this.#respond(),
    },
  };
  responses = { create: (_args: unknown) => this.#respond() };
  #respond() {
    // touches a private field to prove `this` is the real instance
    if (!this.#apiKey) throw new Error("no key");
    return Promise.resolve(openaiChatResponse);
  }
  ping() {
    return "pong";
  }
}

const fakeAnthropic = {
  messages: {
    create: async (args: any) => {
      if (args?.stream) {
        return (async function* () {
          for (const c of anthropicStreamChunks) yield c;
        })();
      }
      return anthropicResponse;
    },
  },
};

test("wrapped client preserves methods and non-tracked properties", async () => {
  const client = withTracking(new FakeOpenAI(), { provider: "openai" });
  assert.equal(client.ping(), "pong");
  assert.equal(client.baseURL, "https://api.openai.com/v1");
});

test("records usage on a tracked call and returns response untouched", async () => {
  const client = withTracking(new FakeOpenAI(), { provider: "openai", tag: "summarize" });
  const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
  assert.equal(res, openaiChatResponse); // untouched identity

  const rows = await getStore().query();
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.provider, "openai");
  assert.equal(r.model, "gpt-4o-mini");
  assert.equal(r.inputTokens, 12);
  assert.equal(r.outputTokens, 8);
  assert.equal(r.tag, "summarize");
  assert.equal(r.estimated, false);
  assert.ok(r.totalCost > 0);
});

test("withTag scopes the tag without altering signatures", async () => {
  const client = withTracking(new FakeOpenAI(), { provider: "openai" });
  const tagged = (client as any).withTag("translate");
  await tagged.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
  const rows = await getStore().query();
  assert.equal(rows[0]!.tag, "translate");
});

test("anthropic non-streaming call is recorded", async () => {
  const client = withTracking(fakeAnthropic, { provider: "anthropic" });
  await client.messages.create({ model: "claude-sonnet-4-5-20250929", messages: [] });
  const rows = await getStore().query();
  assert.equal(rows[0]!.inputTokens, 25);
  assert.equal(rows[0]!.outputTokens, 7);
});

test("streaming: usage recovered from anthropic stream chunks", async () => {
  const client = withTracking(fakeAnthropic, { provider: "anthropic" });
  const stream = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    messages: [],
    stream: true,
  });
  const chunks: unknown[] = [];
  for await (const c of stream as AsyncIterable<unknown>) chunks.push(c);
  assert.equal(chunks.length, anthropicStreamChunks.length);

  const rows = await getStore().query();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.inputTokens, 18);
  assert.equal(rows[0]!.outputTokens, 6);
  assert.equal(rows[0]!.estimated, false);
});

test("streaming: estimates when provider omits usage", async () => {
  const noUsageClient = {
    chat: {
      completions: {
        create: async (_args: unknown) =>
          (async function* () {
            for (const c of openaiStreamChunks.slice(0, 3)) yield c; // drop the usage chunk
          })(),
      },
    },
  };
  const client = withTracking(noUsageClient, { provider: "openai" });
  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hello world" }],
    stream: true,
  });
  for await (const _ of stream as AsyncIterable<unknown>) {
    /* drain */
  }
  const rows = await getStore().query();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.estimated, true);
  assert.ok(rows[0]!.outputTokens >= 1);
});

test("a store failure never breaks the API call", async () => {
  configure({
    store: {
      append() {
        throw new Error("disk full");
      },
      query: () => [],
      aggregate: () => [],
      sumCost: () => 0,
      count: () => 0,
      reset() {},
    },
  });
  const client = withTracking(new FakeOpenAI(), { provider: "openai" });
  const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
  assert.equal(res, openaiChatResponse); // call still succeeds
});

test("enabled:false passes through untracked", async () => {
  configure({ store: "json", dbPath: join(dir, "u.jsonl"), enabled: false });
  const client = withTracking(new FakeOpenAI(), { provider: "openai" });
  await client.chat.completions.create({ model: "gpt-4o-mini", messages: [] });
  const rows = await getStore().query();
  assert.equal(rows.length, 0);
});

test("budget block prevents the call from being recorded", async () => {
  configure({
    store: "json",
    dbPath: join(dir, "u.jsonl"),
    budget: { limit: 0.0000001, window: "total", mode: "block" },
  });
  const client = withTracking(new FakeOpenAI(), { provider: "openai" });
  await assert.rejects(
    () =>
      client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "a fairly long prompt here" }],
      }),
    BudgetExceededError,
  );
});

test("unrecognized client without provider is returned untracked", () => {
  const weird = {
    foo() {
      return 1;
    },
  };
  const wrapped = withTracking(weird);
  assert.equal(wrapped.foo(), 1);
});

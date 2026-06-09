import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JsonStore, createStore, sqliteAvailable } from "../src/store/index.js";
import type { Store, UsageRecord } from "../src/types.js";

function rec(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: 1_000_000,
    provider: "openai",
    model: "gpt-4o-mini",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    inputCost: 0.001,
    outputCost: 0.002,
    totalCost: 0.003,
    latencyMs: 200,
    tag: "default",
    estimated: false,
    pricingMissing: false,
    ...over,
  };
}

function runStoreContract(name: string, makeStore: (dir: string) => Store) {
  test(`${name}: append/query/aggregate/sumCost/reset`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-"));
    try {
      const store = makeStore(dir);

      await store.append(rec({ tag: "summarize", totalCost: 0.01, timestamp: 100 }));
      await store.append(rec({ tag: "summarize", totalCost: 0.02, timestamp: 200 }));
      await store.append(rec({ tag: "chat", totalCost: 0.05, model: "gpt-4o", timestamp: 300 }));

      assert.equal(await store.count(), 3);

      const summ = await store.query({ tag: "summarize" });
      assert.equal(summ.length, 2);
      // default order is desc by timestamp
      assert.equal(summ[0]?.timestamp, 200);

      const asc = await store.query({ order: "asc" });
      assert.equal(asc[0]?.timestamp, 100);

      const limited = await store.query({ limit: 1, offset: 1, order: "asc" });
      assert.equal(limited.length, 1);
      assert.equal(limited[0]?.timestamp, 200);

      assert.ok(Math.abs(Number(await store.sumCost()) - 0.08) < 1e-9);
      assert.ok(Math.abs(Number(await store.sumCost({ tag: "summarize" })) - 0.03) < 1e-9);
      assert.ok(Math.abs(Number(await store.sumCost({ since: 250 })) - 0.05) < 1e-9);

      const byTag = await store.aggregate({ groupBy: "tag" });
      const tags = byTag.map((r) => r.key).sort();
      assert.deepEqual(tags, ["chat", "summarize"]);

      const byModel = await store.aggregate({ groupBy: "model" });
      assert.equal(byModel.length, 2);

      await store.reset();
      assert.equal(await store.count(), 0);
      if (store.close) await store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

runStoreContract("JsonStore", (dir) => new JsonStore(join(dir, "usage.jsonl")));

runStoreContract("createStore(auto)", (dir) => createStore("auto", join(dir, "usage.db")));

test("sqliteAvailable reflects runtime", async () => {
  // Just assert it resolves to a boolean without throwing.
  const ok = await sqliteAvailable();
  assert.equal(typeof ok, "boolean");
});

test("JsonStore tolerates corrupt lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-"));
  try {
    const p = join(dir, "usage.jsonl");
    const store = new JsonStore(p);
    store.append(rec());
    // append a junk line directly
    appendFileSync(p, "not json\n");
    store.append(rec());
    assert.equal(store.count(), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { checkBudget, windowStart } from "../src/budget.js";
import { configure, getStore, resetConfig } from "../src/config.js";
import { BudgetExceededError } from "../src/errors.js";
import type { UsageRecord } from "../src/types.js";

function rec(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    provider: "openai",
    model: "gpt-4o-mini",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputCost: 0,
    outputCost: 0,
    totalCost: 0,
    latencyMs: 1,
    tag: "default",
    estimated: false,
    pricingMissing: false,
    ...over,
  };
}

afterEach(() => resetConfig());

test("windowStart: day/week/month/total boundaries (UTC)", () => {
  const now = Date.UTC(2026, 5, 9, 13, 30); // 2026-06-09T13:30Z, a Tuesday
  assert.equal(windowStart("day", now), Date.UTC(2026, 5, 9));
  assert.equal(windowStart("month", now), Date.UTC(2026, 5, 1));
  assert.equal(windowStart("week", now), Date.UTC(2026, 5, 8)); // Monday
  assert.equal(windowStart("total", now), 0);
});

test("no budget configured is a no-op", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-"));
  configure({ store: "json", dbPath: join(dir, "u.jsonl") });
  await checkBudget({ tag: "default", projectedCost: 999, now: Date.now() });
  rmSync(dir, { recursive: true, force: true });
});

test("block mode throws when projected exceeds limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-"));
  const now = Date.now();
  configure({
    store: "json",
    dbPath: join(dir, "u.jsonl"),
    budget: { limit: 1, window: "total", mode: "block" },
  });
  getStore().append(rec({ totalCost: 0.9, timestamp: now }));
  await assert.rejects(
    () => checkBudget({ tag: "default", projectedCost: 0.2, now }),
    BudgetExceededError,
  );
  // Under the limit: allowed.
  await checkBudget({ tag: "default", projectedCost: 0.05, now });
  rmSync(dir, { recursive: true, force: true });
});

test("warn mode does not throw", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-"));
  const now = Date.now();
  configure({
    store: "json",
    dbPath: join(dir, "u.jsonl"),
    budget: { limit: 1, window: "total", mode: "warn" },
  });
  getStore().append(rec({ totalCost: 5, timestamp: now }));
  await checkBudget({ tag: "default", projectedCost: 5, now }); // should not throw
  rmSync(dir, { recursive: true, force: true });
});

test("per-tag sub-budget is enforced independently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-"));
  const now = Date.now();
  configure({
    store: "json",
    dbPath: join(dir, "u.jsonl"),
    budget: { limit: 100, window: "total", mode: "block", perTag: { summarize: 1 } },
  });
  getStore().append(rec({ tag: "summarize", totalCost: 0.95, timestamp: now }));
  // overall fine, but summarize tag exceeds
  await assert.rejects(
    () => checkBudget({ tag: "summarize", projectedCost: 0.2, now }),
    BudgetExceededError,
  );
  // a different tag is unaffected
  await checkBudget({ tag: "chat", projectedCost: 50, now });
  rmSync(dir, { recursive: true, force: true });
});

test("window boundary excludes spend before the window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-"));
  const now = Date.UTC(2026, 5, 9, 12, 0);
  configure({
    store: "json",
    dbPath: join(dir, "u.jsonl"),
    budget: { limit: 1, window: "day", mode: "block" },
  });
  // Spend from yesterday should not count toward today's window.
  getStore().append(rec({ totalCost: 5, timestamp: now - 86_400_000 }));
  await checkBudget({ tag: "default", projectedCost: 0.5, now }); // allowed
  rmSync(dir, { recursive: true, force: true });
});

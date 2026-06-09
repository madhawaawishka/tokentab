import assert from "node:assert/strict";
import { test } from "node:test";
import { configure, resetConfig } from "../src/config.js";
import { cost, findPrice, resetPricingWarnings } from "../src/pricing/index.js";

test("computes cost from known pricing", () => {
  resetConfig();
  resetPricingWarnings();
  // gpt-4o-mini: $0.15 / 1M input, $0.6 / 1M output.
  const r = cost("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
  assert.equal(r.inputCost, 0.15);
  assert.equal(r.outputCost, 0.6);
  assert.equal(r.totalCost, 0.75);
  assert.equal(r.pricingMissing, false);
});

test("scales cost linearly with tokens", () => {
  const r = cost("anthropic", "claude-sonnet-4-5-20250929", 2000, 500);
  // 2000/1M * 3 = 0.006 ; 500/1M * 15 = 0.0075
  assert.ok(Math.abs(r.inputCost - 0.006) < 1e-9);
  assert.ok(Math.abs(r.outputCost - 0.0075) < 1e-9);
});

test("matches dated model variants via date-strip", () => {
  const p = findPrice("openai", "gpt-4o-2024-08-06");
  assert.ok(p);
  assert.equal(p?.inputPer1M, 2.5);
});

test("matches via longest-prefix fallback", () => {
  const p = findPrice("openai", "gpt-4o-mini-2099-01-01");
  assert.equal(p?.inputPer1M, 0.15);
});

test("missing pricing returns zeros and the missing flag", () => {
  resetPricingWarnings();
  const r = cost("openai", "totally-made-up-model", 1000, 1000);
  assert.equal(r.totalCost, 0);
  assert.equal(r.pricingMissing, true);
});

test("runtime pricing override applies", () => {
  resetConfig();
  configure({ pricing: { custom: { "my-model": { inputPer1M: 1, outputPer1M: 2 } } } });
  const r = cost("custom", "my-model", 1_000_000, 1_000_000);
  assert.equal(r.totalCost, 3);
  resetConfig();
});

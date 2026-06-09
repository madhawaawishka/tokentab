import assert from "node:assert/strict";
import { test } from "node:test";
import { estimate, estimateInputTokens } from "../src/tokenize.js";

test("estimate returns 0 for empty string", () => {
  assert.equal(estimate(""), 0);
});

test("estimate grows with text length", () => {
  const short = estimate("hello");
  const long = estimate("hello ".repeat(100));
  assert.ok(long > short);
  assert.ok(short >= 1);
});

test("estimate is in a sane range for known text", () => {
  // ~4 chars/token; 40 chars -> ~10 tokens
  const t = estimate("0123456789".repeat(4), "gpt-4o");
  assert.ok(t >= 8 && t <= 20);
});

test("estimateInputTokens reads openai messages", () => {
  const n = estimateInputTokens(
    { model: "gpt-4o", messages: [{ role: "user", content: "summarize this article please" }] },
    "gpt-4o",
  );
  assert.ok(n >= 4);
});

test("estimateInputTokens reads anthropic system + content blocks", () => {
  const n = estimateInputTokens({
    system: "You are helpful.",
    messages: [{ role: "user", content: [{ type: "text", text: "Translate hello to French" }] }],
  });
  assert.ok(n >= 5);
});

test("estimateInputTokens reads gemini contents", () => {
  const n = estimateInputTokens({
    contents: [{ parts: [{ text: "What is the capital of France?" }] }],
  });
  assert.ok(n >= 5);
});

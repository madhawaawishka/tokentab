import assert from "node:assert/strict";
import { test } from "node:test";
import { extractAnthropicUsage } from "../src/adapters/anthropic.js";
import { extractGeminiUsage } from "../src/adapters/gemini.js";
import { detectAdapter, resolveAdapter } from "../src/adapters/index.js";
import { extractOpenAIUsage } from "../src/adapters/openai.js";
import { registerBuiltinAdapters } from "../src/adapters/register.js";
import { AdapterNotFoundError } from "../src/errors.js";
import {
  anthropicResponse,
  fakeAnthropicClient,
  fakeGeminiClient,
  fakeOpenAIClient,
  geminiResponse,
  openaiChatResponse,
  openaiResponsesApiResponse,
} from "./fixtures.js";

registerBuiltinAdapters();

test("openai adapter extracts chat completion usage", () => {
  const u = extractOpenAIUsage(openaiChatResponse);
  assert.deepEqual(u, { model: "gpt-4o-mini", inputTokens: 12, outputTokens: 8 });
});

test("openai adapter extracts responses-api usage", () => {
  const u = extractOpenAIUsage(openaiResponsesApiResponse);
  assert.deepEqual(u, { model: "gpt-4.1", inputTokens: 30, outputTokens: 5 });
});

test("openai adapter returns null when usage absent", () => {
  assert.equal(extractOpenAIUsage({ model: "x" }), null);
});

test("anthropic adapter extracts usage", () => {
  const u = extractAnthropicUsage(anthropicResponse);
  assert.deepEqual(u, {
    model: "claude-sonnet-4-5-20250929",
    inputTokens: 25,
    outputTokens: 7,
  });
});

test("gemini adapter extracts usage including thoughts", () => {
  const u = extractGeminiUsage(geminiResponse);
  assert.deepEqual(u, { model: "gemini-2.5-flash", inputTokens: 14, outputTokens: 8 });
});

test("detects openai, anthropic, gemini clients", () => {
  assert.equal(detectAdapter(fakeOpenAIClient)?.name, "openai");
  assert.equal(detectAdapter(fakeAnthropicClient)?.name, "anthropic");
  assert.equal(detectAdapter(fakeGeminiClient)?.name, "gemini");
});

test("openai-compatible never auto-detects", () => {
  const a = resolveAdapter(fakeOpenAIClient, "openai-compatible");
  assert.equal(a.name, "openai-compatible");
  // but auto-detect of an openai-shaped client yields openai
  assert.equal(detectAdapter(fakeOpenAIClient)?.name, "openai");
});

test("resolveAdapter throws on unknown explicit provider", () => {
  assert.throws(() => resolveAdapter(fakeOpenAIClient, "nope"), AdapterNotFoundError);
});

test("resolveAdapter throws when nothing detected", () => {
  assert.throws(() => resolveAdapter({}, undefined), AdapterNotFoundError);
});

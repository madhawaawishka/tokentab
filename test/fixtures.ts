// Recorded provider response shapes used by adapter tests. No live calls.

export const openaiChatResponse = {
  id: "chatcmpl-abc",
  object: "chat.completion",
  model: "gpt-4o-mini",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello!" } }],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
};

export const openaiResponsesApiResponse = {
  id: "resp_123",
  object: "response",
  model: "gpt-4.1",
  output: [{ type: "message", content: [{ type: "output_text", text: "Hi" }] }],
  usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35 },
};

export const openaiStreamChunks = [
  { model: "gpt-4o-mini", choices: [{ delta: { role: "assistant" } }] },
  { model: "gpt-4o-mini", choices: [{ delta: { content: "Hel" } }] },
  { model: "gpt-4o-mini", choices: [{ delta: { content: "lo" } }] },
  { model: "gpt-4o-mini", choices: [{ delta: {} }], usage: null },
  {
    model: "gpt-4o-mini",
    choices: [],
    usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
  },
];

export const anthropicResponse = {
  id: "msg_01",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5-20250929",
  content: [{ type: "text", text: "Hello there." }],
  usage: { input_tokens: 25, output_tokens: 7 },
};

export const anthropicStreamChunks = [
  {
    type: "message_start",
    message: {
      id: "msg_02",
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 18, output_tokens: 1 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } },
  { type: "message_stop" },
];

export const geminiResponse = {
  modelVersion: "gemini-2.5-flash",
  candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }],
  usageMetadata: {
    promptTokenCount: 14,
    candidatesTokenCount: 5,
    thoughtsTokenCount: 3,
    totalTokenCount: 22,
  },
};

export const geminiStreamChunks = [
  { candidates: [{ content: { parts: [{ text: "Hel" }] } }] },
  { candidates: [{ content: { parts: [{ text: "lo" }] } }] },
  {
    modelVersion: "gemini-2.5-flash",
    candidates: [{ content: { parts: [{ text: "!" }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
  },
];

// Minimal fake SDK clients for detection tests.
export const fakeOpenAIClient = {
  chat: { completions: { create: async () => openaiChatResponse } },
  responses: { create: async () => openaiResponsesApiResponse },
  baseURL: "https://api.openai.com/v1",
};

export const fakeAnthropicClient = {
  messages: { create: async () => anthropicResponse },
};

export const fakeGeminiClient = {
  models: { generateContent: async () => geminiResponse },
};

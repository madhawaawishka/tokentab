// OpenAI: one-line drop-in. Run: OPENAI_API_KEY=... tsx examples/openai.ts
import OpenAI from "openai";
import { withTracking } from "tokenmeter";

const openai = withTracking(new OpenAI()); // provider auto-detected

// Tag calls by feature to get per-feature cost attribution in the dashboard.
const summarizer = openai.withTag("summarize");

const res = await summarizer.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Summarize: the quick brown fox..." }],
});

console.log(res.choices[0]?.message?.content);
console.log("\nRun `npx tokenmeter report` or `npx tokenmeter dashboard` to see cost.");

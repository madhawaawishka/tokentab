// Runnable demo with NO API key and NO provider SDK — uses a fake client that
// returns OpenAI-shaped responses, so you can see tokenmeter end-to-end offline.
//
//   pnpm build && node examples/local-demo.mjs && npx tokenmeter dashboard
//
import { configure, withTracking } from "../dist/index.js";

configure({ store: "json", dbPath: "./.tokenmeter/usage.jsonl" });

const fakeOpenAI = {
  chat: {
    completions: {
      create: async (args) => ({
        model: args.model,
        choices: [{ message: { role: "assistant", content: "(demo response)" } }],
        usage: {
          prompt_tokens: 50 + Math.floor(args.messages?.[0]?.content?.length ?? 0),
          completion_tokens: 30,
          total_tokens: 80,
        },
      }),
    },
  },
};

const client = withTracking(fakeOpenAI, { provider: "openai" });

const features = [
  ["summarize", "gpt-4o-mini"],
  ["translate", "gpt-4o"],
  ["classify", "gpt-4o-mini"],
];

for (let i = 0; i < 30; i++) {
  const [tag, model] = features[i % features.length];
  await client.withTag(tag).chat.completions.create({
    model,
    messages: [{ role: "user", content: "x".repeat((i % 5) * 40 + 20) }],
  });
}

console.log("Wrote 30 demo records to ./.tokenmeter/usage.jsonl");
console.log("Now run:  npx tokenmeter report   or   npx tokenmeter dashboard");

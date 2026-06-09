// Anthropic + pre-flight budget guard.
// Run: ANTHROPIC_API_KEY=... tsx examples/anthropic-budget.ts
import Anthropic from "@anthropic-ai/sdk";
import { BudgetExceededError, configure, withTracking } from "tokenmeter";

configure({
  budget: {
    limit: 5, // USD per month
    window: "month",
    mode: "block", // throw before the request is sent
    perTag: { drafting: 1 },
  },
});

const anthropic = withTracking(new Anthropic(), { tag: "drafting" });

try {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    messages: [{ role: "user", content: "Draft a haiku about budgets." }],
  });
  console.log(msg.content);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`Blocked before sending: ${err.message}`);
  } else {
    throw err;
  }
}

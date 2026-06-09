import { getBudgetConfig, getStore } from "./config.js";
import { BudgetExceededError } from "./errors.js";
import type { BudgetWindow } from "./types.js";

/**
 * Start (epoch ms) of the active budget window containing `now`, using UTC
 * calendar boundaries. "total" returns 0 (count everything).
 */
export function windowStart(window: BudgetWindow, now: number): number {
  if (window === "total") return 0;
  const d = new Date(now);
  if (window === "day") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (window === "week") {
    // Week starts Monday (ISO).
    const dayOfWeek = d.getUTCDay(); // 0 = Sunday
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return monday - daysSinceMonday * 86_400_000;
  }
  // month
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * Pre-flight budget check. Sums already-recorded spend in the active window
 * (overall and for `tag`), adds `projectedCost`, and compares to the limits.
 * In "block" mode a breach throws `BudgetExceededError` before the call is
 * sent; in "warn" mode it logs and returns. No-op when no budget is configured.
 */
export async function checkBudget(opts: {
  tag: string;
  projectedCost: number;
  now: number;
}): Promise<void> {
  const budget = getBudgetConfig();
  if (!budget) return;

  const window = budget.window ?? "month";
  const mode = budget.mode ?? "block";
  const since = windowStart(window, opts.now);
  const store = getStore();

  // Overall limit.
  const spent = await store.sumCost({ since });
  const projected = spent + opts.projectedCost;
  if (projected > budget.limit) {
    handleBreach(mode, {
      limit: budget.limit,
      spent,
      projected,
      window,
      scope: "overall",
    });
  }

  // Per-tag sub-limit.
  const tagLimit = budget.perTag?.[opts.tag];
  if (tagLimit != null) {
    const tagSpent = await store.sumCost({ since, tag: opts.tag });
    const tagProjected = tagSpent + opts.projectedCost;
    if (tagProjected > tagLimit) {
      handleBreach(mode, {
        limit: tagLimit,
        spent: tagSpent,
        projected: tagProjected,
        window,
        scope: "tag",
        tag: opts.tag,
      });
    }
  }
}

function handleBreach(
  mode: "block" | "warn",
  detail: ConstructorParameters<typeof BudgetExceededError>[0],
): void {
  const err = new BudgetExceededError(detail);
  if (mode === "block") throw err;
  console.warn(`[tokenmeter] ${err.message}`);
}

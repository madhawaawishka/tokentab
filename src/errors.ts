import type { BudgetWindow } from "./types.js";

/** Thrown by the budget guard in "block" mode before a call is sent. */
export class BudgetExceededError extends Error {
  override readonly name = "BudgetExceededError";
  readonly limit: number;
  readonly spent: number;
  readonly projected: number;
  readonly window: BudgetWindow;
  readonly scope: "overall" | "tag";
  readonly tag?: string;

  constructor(opts: {
    limit: number;
    spent: number;
    projected: number;
    window: BudgetWindow;
    scope: "overall" | "tag";
    tag?: string;
  }) {
    const where = opts.scope === "tag" ? `tag "${opts.tag}"` : "overall";
    super(
      `Budget exceeded for ${where}: projected $${opts.projected.toFixed(4)} ` +
        `would exceed the ${opts.window} limit of $${opts.limit.toFixed(2)} ` +
        `(already spent $${opts.spent.toFixed(4)}).`,
    );
    this.limit = opts.limit;
    this.spent = opts.spent;
    this.projected = opts.projected;
    this.window = opts.window;
    this.scope = opts.scope;
    this.tag = opts.tag;
  }
}

/** Thrown when a provider cannot be detected and none was supplied. */
export class AdapterNotFoundError extends Error {
  override readonly name = "AdapterNotFoundError";
}

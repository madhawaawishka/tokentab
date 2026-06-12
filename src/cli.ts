#!/usr/bin/env node
import "./store/install-node.js";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { startDashboard } from "../dashboard/server.js";
import { configure, getStore } from "./config.js";
import { breakdown, costOverTime, overview, recentCalls, toCsv, toJson } from "./report.js";
import type { BudgetWindow } from "./types.js";

const DEFAULT_SQLITE = "./.tokenmeter/usage.db";
const DEFAULT_JSON = "./.tokenmeter/usage.jsonl";

interface Flags {
  _: string[];
  [k: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

/** Point the config at the right store file, inferring backend from extension. */
function applyStoreSelection(dbFlag: string | undefined): void {
  if (dbFlag) {
    const isSqlite = /\.(db|sqlite|sqlite3)$/i.test(dbFlag);
    configure({ store: isSqlite ? "sqlite" : "json", dbPath: dbFlag });
    return;
  }
  // No --db: use whichever default file already exists.
  if (existsSync(DEFAULT_SQLITE)) {
    configure({ store: "sqlite", dbPath: DEFAULT_SQLITE });
  } else if (existsSync(DEFAULT_JSON)) {
    configure({ store: "json", dbPath: DEFAULT_JSON });
  }
  // else leave the auto default in place.
}

function asWindow(v: unknown): BudgetWindow {
  return v === "day" || v === "week" || v === "month" || v === "total" ? v : "month";
}

const USD = (n: number) => `$${n.toFixed(4)}`;
const fmtInt = (n: number) => n.toLocaleString("en-US");

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

async function cmdReport(flags: Flags): Promise<void> {
  const window = asWindow(flags.window);
  const by = (flags.by === "model" || flags.by === "provider" ? flags.by : "tag") as
    | "tag"
    | "model"
    | "provider";

  const ov = await overview(window);
  console.log(`\ntokenmeter — usage report (${window})\n`);
  console.log(
    table(
      ["Metric", "Value"],
      [
        ["Total cost", USD(ov.totalCost)],
        ["Calls", fmtInt(ov.calls)],
        ["Input tokens", fmtInt(ov.inputTokens)],
        ["Output tokens", fmtInt(ov.outputTokens)],
        ["Avg latency", `${Math.round(ov.avgLatencyMs)} ms`],
        ["Estimated share", `${Math.round(ov.estimatedShare * 100)}%`],
      ],
    ),
  );

  const rows = await breakdown(by, window);
  console.log(`\nBy ${by}:\n`);
  if (rows.length === 0) {
    console.log("  (no data in this window)");
  } else {
    console.log(
      table(
        [by, "calls", "in", "out", "cost", "avg ms"],
        rows.map((r) => [
          r.key,
          fmtInt(r.calls),
          fmtInt(r.inputTokens),
          fmtInt(r.outputTokens),
          USD(r.totalCost),
          String(Math.round(r.avgLatencyMs)),
        ]),
      ),
    );
  }
  console.log("");
}

async function cmdExport(flags: Flags): Promise<void> {
  const format = flags.format === "json" ? "json" : "csv";
  const records = await getStore().query({ order: "asc" });
  const out = format === "json" ? toJson(records) : toCsv(records);
  if (typeof flags.out === "string") {
    await writeFile(flags.out, out, "utf8");
    console.error(`Wrote ${records.length} records to ${flags.out}`);
  } else {
    process.stdout.write(`${out}\n`);
  }
}

async function cmdReset(flags: Flags): Promise<void> {
  if (flags.yes !== true) {
    const ok = await confirm("This permanently clears all local usage records. Continue? [y/N] ");
    if (!ok) {
      console.error("Aborted.");
      return;
    }
  }
  await getStore().reset();
  console.error("Local usage store cleared.");
}

async function cmdDashboard(flags: Flags): Promise<void> {
  const port = Number(flags.port ?? 3000) || 3000;
  const open = flags["no-open"] !== true && flags.open !== false;
  await startDashboard({ port, open });
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function printHelp(): void {
  console.log(`tokentab — local-first LLM usage & cost tracker

Usage: tokentab <command> [options]

Commands:
  dashboard            Start the local web dashboard
    --port <n>         Port (default 3000)
    --db <path>        Store file to read
    --no-open          Do not open the browser

  report               Print a usage summary to the terminal
    --window <w>       day | week | month | total (default month)
    --by <dim>         tag | model | provider (default tag)
    --db <path>        Store file to read

  export               Export records to stdout or a file
    --format <fmt>     csv | json (default csv)
    --out <file>       Write to a file instead of stdout
    --db <path>        Store file to read

  reset                Clear the local usage store (destructive)
    --yes              Skip the confirmation prompt
    --db <path>        Store file to clear

All data stays on this machine. tokenmeter never transmits usage or keys.
`);
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];

  if (!cmd || cmd === "help" || flags.help === true) {
    printHelp();
    return;
  }

  applyStoreSelection(typeof flags.db === "string" ? flags.db : undefined);

  switch (cmd) {
    case "report":
      await cmdReport(flags);
      break;
    case "export":
      await cmdExport(flags);
      break;
    case "reset":
      await cmdReset(flags);
      break;
    case "dashboard":
      await cmdDashboard(flags);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

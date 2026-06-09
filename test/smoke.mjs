// End-to-end smoke test against the BUILT dist: library, CLI report/export,
// and the dashboard server (driven through the built CLI in a child process).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configure, getStore, withTracking } from "../dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "tm-smoke-"));
const dbPath = join(dir, "usage.jsonl");

configure({ store: "json", dbPath, budget: { limit: 100, window: "total", mode: "warn" } });

const fakeOpenAI = {
  chat: {
    completions: {
      create: async (args) => ({
        model: args.model,
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }),
    },
  },
};

const client = withTracking(fakeOpenAI, { provider: "openai" });
await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
});
await client.withTag("summarize").chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "summarize" }],
});

const rows = await getStore().query();
assert.equal(rows.length, 2);
assert.ok(rows.every((r) => r.totalCost > 0));
console.log(
  "library OK: 2 records ->",
  rows.map((r) => `${r.tag}/${r.model}=$${r.totalCost.toFixed(5)}`).join(", "),
);

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { cwd: root });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      err += d;
    });
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

// CLI report
const report = await run(["report", "--db", dbPath, "--window", "total"]);
assert.equal(report.code, 0);
assert.ok(report.out.includes("Total cost"), "report shows totals");
assert.ok(report.out.includes("summarize"), "report shows the summarize tag");
console.log("CLI report OK");

// CLI export (csv to stdout)
const exp = await run(["export", "--db", dbPath, "--format", "csv"]);
assert.equal(exp.code, 0);
assert.equal(exp.out.trim().split("\n").length, 3, "csv header + 2 rows");
console.log("CLI export OK");

// Dashboard via CLI child process
const port = 39521;
const dash = spawn(
  process.execPath,
  [cli, "dashboard", "--db", dbPath, "--port", String(port), "--no-open"],
  {
    cwd: root,
  },
);
try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("dashboard did not start")), 8000);
    dash.stderr.on("data", (d) => {
      if (String(d).includes("running at")) {
        clearTimeout(t);
        resolve();
      }
    });
    dash.on("exit", (c) => reject(new Error(`dashboard exited early: ${c}`)));
  });

  const ov = await (await fetch(`http://127.0.0.1:${port}/api/overview?window=total`)).json();
  assert.equal(ov.calls, 2);
  assert.ok(ov.totalCost > 0);
  // Budget is a code-level config, not persisted to the store, so a CLI-launched
  // dashboard (no budget configured in its process) reports null. Expected.
  assert.equal(ov.budget, null, "no budget configured in the CLI process");

  const by = await (await fetch(`http://127.0.0.1:${port}/api/by?window=total&by=tag`)).json();
  assert.deepEqual(by.map((r) => r.key).sort(), ["default", "summarize"]);

  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.ok(html.includes("tokenmeter"), "index.html served");
  console.log("dashboard OK: overview calls=2, by-tag served, budget status, index.html served");
} finally {
  await new Promise((resolve) => {
    dash.on("exit", resolve);
    dash.kill();
    setTimeout(resolve, 1500);
  });
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup is best-effort on Windows */
  }
}

console.log("\nSMOKE PASSED");

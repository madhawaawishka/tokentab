import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  // Node build: CLI, server-side tracking, file-backed stores.
  {
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      auto: "src/auto.ts",
      register: "src/register.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: "node18",
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".js" };
    },
    // Copy the static dashboard assets into dist so they ship in the tarball.
    async onSuccess() {
      const from = resolve(here, "dashboard/public");
      const to = resolve(here, "dist/public");
      if (existsSync(from)) {
        mkdirSync(to, { recursive: true });
        cpSync(from, to, { recursive: true });
      }
    },
  },
  // Browser build: zero `node:` imports, localStorage store. Selected by the
  // "browser" condition in package.json exports (Vite, webpack, etc.).
  {
    entry: {
      "index.browser": "src/index.browser.ts",
      "auto.browser": "src/auto.browser.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: false, // keep the Node build's output
    splitting: false,
    sourcemap: true,
    platform: "browser",
    target: "es2020",
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".js" };
    },
  },
]);

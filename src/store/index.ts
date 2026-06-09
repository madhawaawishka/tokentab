import { createRequire } from "node:module";
import type { Store } from "../types.js";
import { JsonStore } from "./json.js";
import { SqliteStore } from "./sqlite.js";

export { JsonStore } from "./json.js";
export { SqliteStore, sqliteAvailable } from "./sqlite.js";

const DEFAULT_DIR = "./.tokenmeter";
const DEFAULT_SQLITE = `${DEFAULT_DIR}/usage.db`;
const DEFAULT_JSON = `${DEFAULT_DIR}/usage.jsonl`;

let warnedFallback = false;

/** Synchronously load node:sqlite's DatabaseSync, or null if unavailable. */
function loadDatabaseSync(): (new (path: string) => any) | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("node:sqlite") as { DatabaseSync?: new (path: string) => any };
    return typeof mod.DatabaseSync === "function" ? mod.DatabaseSync : null;
  } catch {
    return null;
  }
}

/**
 * Create a store synchronously. "auto" prefers SQLite and silently falls back
 * to the JSON-lines store when `node:sqlite` is unavailable (e.g. Node < 22.5).
 */
export function createStore(option: "sqlite" | "json" | "auto", dbPath?: string): Store {
  if (option === "json") {
    return new JsonStore(dbPath ?? DEFAULT_JSON);
  }

  const DatabaseSync = loadDatabaseSync();
  if (DatabaseSync) {
    return new SqliteStore(dbPath ?? DEFAULT_SQLITE, DatabaseSync);
  }

  if (option === "sqlite" && !warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[tokenmeter] node:sqlite is unavailable in this runtime; " +
        "falling back to the JSON-lines store.",
    );
  }
  return new JsonStore(dbPath ?? DEFAULT_JSON);
}

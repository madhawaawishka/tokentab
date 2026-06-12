import type { UsageRecord } from "../types.js";
import { MemoryStore } from "./memory.js";

const DEFAULT_KEY = "tokentab.usage.v1";
/** Keep localStorage well under quota; old records are dropped first. */
const MAX_RECORDS = 5000;
/** Default `tokentab dashboard` address records are mirrored to during local dev. */
const DEFAULT_SYNC_URL = "http://127.0.0.1:3000";
const SYNC_DEBOUNCE_MS = 1500;

export interface BrowserStoreOptions {
  /** localStorage key for the records. Default "tokentab.usage.v1". */
  key?: string;
  /**
   * Base URL of a running `tokentab dashboard` to mirror records to, or
   * `false` to disable mirroring. When omitted, mirroring to
   * http://127.0.0.1:3000 is enabled only while the page itself is served
   * from localhost (i.e. during development) — deployed apps never emit
   * network traffic unless a URL is configured explicitly.
   */
  syncUrl?: string | false;
}

function localStorageOrNull(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = "tokentab.probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null; // unavailable (SSR, sandboxed iframe, private mode quota)
  }
}

function isLocalhostPage(): boolean {
  try {
    const host = (globalThis as { location?: { hostname?: string } }).location?.hostname ?? "";
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Browser store: records live in localStorage (in-memory fallback when it is
 * unavailable) and are mirrored, best-effort, to a locally running
 * `tokentab dashboard` so the dashboard shows browser-app usage too. Every
 * sync failure is swallowed — tracking must never affect the host app.
 */
export class LocalStorageStore extends MemoryStore {
  private readonly key: string;
  private readonly storage: Storage | null;
  private readonly syncUrl: string | false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncInFlight = false;

  constructor(options: BrowserStoreOptions = {}) {
    super();
    this.key = options.key ?? DEFAULT_KEY;
    this.storage = localStorageOrNull();
    this.syncUrl = options.syncUrl ?? (isLocalhostPage() ? DEFAULT_SYNC_URL : false);
    this.load();
    // Push anything recorded before the dashboard was started (e.g. on reload).
    this.scheduleSync();
  }

  override append(record: UsageRecord): void {
    super.append(record);
    this.scheduleSync();
  }

  override reset(): void {
    super.reset();
    this.setSyncedThrough(0);
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.records = parsed as UsageRecord[];
    } catch {
      /* corrupt payload: start fresh */
    }
  }

  protected override persist(): void {
    if (!this.storage) return;
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(this.records));
    } catch {
      // Quota hit: drop the oldest half and try once more.
      try {
        this.records = this.records.slice(-Math.floor(MAX_RECORDS / 2));
        this.storage.setItem(this.key, JSON.stringify(this.records));
      } catch {
        /* keep running in memory only */
      }
    }
  }

  // ---- dashboard mirroring ----

  private syncedThrough(): number {
    if (!this.storage) return 0;
    try {
      return Number(this.storage.getItem(`${this.key}.syncedThrough`)) || 0;
    } catch {
      return 0;
    }
  }

  private setSyncedThrough(ts: number): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(`${this.key}.syncedThrough`, String(ts));
    } catch {
      /* ignore */
    }
  }

  private scheduleSync(): void {
    if (this.syncUrl === false) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.flush();
    }, SYNC_DEBOUNCE_MS);
  }

  /** POST unsynced records to the dashboard's ingest endpoint. Best-effort. */
  private async flush(): Promise<void> {
    if (this.syncUrl === false || this.syncInFlight) return;
    const since = this.syncedThrough();
    const pending = this.records.filter((r) => r.timestamp > since);
    if (pending.length === 0) return;
    this.syncInFlight = true;
    try {
      const res = await fetch(`${this.syncUrl.replace(/\/$/, "")}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending),
      });
      if (res.ok) {
        this.setSyncedThrough(Math.max(...pending.map((r) => r.timestamp)));
      }
    } catch {
      /* dashboard not running — retry on the next append/reload */
    } finally {
      this.syncInFlight = false;
    }
  }
}

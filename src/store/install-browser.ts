// Imported by the browser entry points, which call this explicitly (see
// install-node.ts for why it is a function call rather than a bare
// side-effect import). Installs the localStorage-backed store factory so web
// bundles never touch `node:` modules.
import { setStoreFactory } from "../config.js";
import { LocalStorageStore } from "./browser.js";

export function installBrowserStoreFactory(): void {
  setStoreFactory(({ dbPath, syncUrl }) => new LocalStorageStore({ key: dbPath, syncUrl }));
}

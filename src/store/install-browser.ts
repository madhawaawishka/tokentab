// Side-effect module imported by the browser entry points. Installs the
// localStorage-backed store factory so web bundles never touch `node:` modules.
import { setStoreFactory } from "../config.js";
import { LocalStorageStore } from "./browser.js";

setStoreFactory(
  ({ dbPath, syncUrl }) => new LocalStorageStore({ key: dbPath, syncUrl }),
);

// Side-effect module imported by the Node entry points (index, auto, register,
// cli). Installs the file-backed store factory. The browser entries import
// install-browser.ts instead, which keeps `node:` modules out of web bundles.
import { setStoreFactory } from "../config.js";
import { createStore } from "./index.js";

setStoreFactory(({ option, dbPath }) => createStore(option, dbPath));

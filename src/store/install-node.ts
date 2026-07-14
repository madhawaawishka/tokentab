// Imported by the Node entry points (index, auto, register, cli). The entries
// call this explicitly — a plain function call survives every bundler's
// tree-shaking, unlike a bare side-effect import (esbuild drops those for
// files not listed in package.json "sideEffects"). The browser entries call
// install-browser.ts instead, which keeps `node:` modules out of web bundles.
import { setStoreFactory } from "../config.js";
import { createStore } from "./index.js";

export function installNodeStoreFactory(): void {
  setStoreFactory(({ option, dbPath }) => createStore(option, dbPath));
}

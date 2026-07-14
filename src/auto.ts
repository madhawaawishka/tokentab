// Side-effect entry: `import "tokentab/auto"` turns on automatic tracking with
// one line. Re-exports the control functions for callers who want them.
import { enableAutoTracking } from "./auto-instrument.js";
import { installNodeStoreFactory } from "./store/install-node.js";

installNodeStoreFactory();
enableAutoTracking();

export {
  enableAutoTracking,
  disableAutoTracking,
  type AutoTrackingOptions,
} from "./auto-instrument.js";

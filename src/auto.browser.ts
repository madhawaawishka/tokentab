// Browser variant of the side-effect entry: `import "tokentab/auto"` in a web
// app patches global fetch so calls to known LLM endpoints are measured with
// no client wrapping. Uses the localStorage store backend.
import { enableAutoTracking } from "./auto-instrument.js";
import { installBrowserStoreFactory } from "./store/install-browser.js";

installBrowserStoreFactory();
enableAutoTracking();

export {
  enableAutoTracking,
  disableAutoTracking,
  type AutoTrackingOptions,
} from "./auto-instrument.js";

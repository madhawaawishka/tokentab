// Preload entry for zero-code setup:
//   node --import tokentab/register app.js
//   NODE_OPTIONS="--import tokentab/register" npm start
// Enabling tracking before any app code runs means every later LLM call is
// instrumented without touching the application source. The explicit call (vs a
// bare `import "./auto.js"`) survives bundler tree-shaking.
import { enableAutoTracking } from "./auto-instrument.js";

enableAutoTracking();

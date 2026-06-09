// Dev-only ESM resolve hook for running TypeScript sources directly under
// `node --test`. Node's built-in type-stripping loads `.ts` files but does not
// rewrite `.js` import specifiers (which our source uses for the compiled
// output) to their `.ts` sources. This hook does that rewrite, and only for
// relative specifiers that fail to resolve as-is. It is never shipped.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);

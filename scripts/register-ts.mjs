/**
 * `node --import ./scripts/register-ts.mjs …` so generate-og and tests can
 * load `src/lib/*.ts` on Node 22.14 (no `registerHooks`) and on later 22.x.
 */
import { register } from "node:module";

register(new URL("./ts-loader.mjs", import.meta.url).href, import.meta.url);

/**
 * Importing the app's TypeScript modules from the plain-Node test runner.
 *
 * Node strips the types itself. The two things it does not do are resolve the
 * extensionless specifiers the app writes (that is the bundler's resolution,
 * `tsconfig.json: moduleResolution: bundler`) and define `import.meta.env`,
 * which is Vite's. Both live in `scripts/ts-loader.mjs` so `lib/` — the
 * React-free layer where the display rules live — can be tested without a
 * bundler and without a second test runner.
 *
 * Import this module for its side effect before importing anything under
 * `src/`. It touches nothing else: the modules under test are the shipped
 * files, byte for byte.
 */

import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loader = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/ts-loader.mjs"),
).href;
register(loader, import.meta.url);

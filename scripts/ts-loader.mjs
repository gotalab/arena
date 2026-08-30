/**
 * Resolve extensionless `./foo` to `./foo.ts` and stand down Vite's
 * `import.meta.env` so Node can load `src/lib/*.ts` without a bundler.
 *
 * Node 22.14 cannot import `.ts` through `nextLoad` (no strip-types by
 * default). Read and strip here; JSON default-imports get a module body.
 */
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const extensionless = specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier);
  return nextResolve(extensionless ? `${specifier}.ts` : specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const json = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${json}`, shortCircuit: true };
  }
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const raw = readFileSync(fileURLToPath(url), "utf8").replaceAll("import.meta.env", "({})");
    return {
      format: "module",
      source: stripTypeScriptTypes(raw),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}

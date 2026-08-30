import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";

const BLIND_ID = "virtual:arena-public-blind";
const NAMED_ID = "virtual:arena-public-named";
const RESOLVED_BLIND_ID = `\0${BLIND_ID}`;
const RESOLVED_NAMED_ID = `\0${NAMED_ID}`;

export function publicReleaseModule(bundlePath) {
  const absoluteBundle = resolve(bundlePath);
  return {
    name: "arena-public-release-module",
    resolveId(id) {
      if (id === BLIND_ID) return RESOLVED_BLIND_ID;
      if (id === NAMED_ID) return RESOLVED_NAMED_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_BLIND_ID && id !== RESOLVED_NAMED_ID) return null;
      const bundle = JSON.parse(readFileSync(absoluteBundle, "utf8"));
      if (id === RESOLVED_BLIND_ID) {
        return `export default ${JSON.stringify({ schema: bundle.schema, blind: bundle.blind, catalog: bundle.catalog, taskManifests: bundle.taskManifests })};`;
      }
      return `export default ${JSON.stringify(bundle.release)};`;
    },
  };
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".woff": "font/woff", ".woff2": "font/woff2",
};

export function publicArtifactAssets(publicReleaseRoot) {
  const root = resolve(publicReleaseRoot, "artifacts");
  let outDir = null;
  return {
    name: "arena-public-artifacts",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?", 1)[0] ?? "";
        const match = /^\/artifacts\/([a-f0-9]{64})\/(.+)$/.exec(path);
        if (!match) return next();
        const file = resolve(root, match[1], match[2]);
        const type = TYPES[extname(file).toLowerCase()];
        if (!file.startsWith(root + sep) || !type || !existsSync(file)) {
          response.statusCode = 404;
          return response.end("Not Found");
        }
        response.setHeader("Content-Type", type);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!outDir || !existsSync(root)) return;
      cpSync(root, resolve(outDir, "artifacts"), { recursive: true, force: true });
    },
  };
}

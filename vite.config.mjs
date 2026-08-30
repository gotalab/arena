import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { publicArtifactAssets, publicReleaseModule } from "./scripts/public-release-vite.mjs";

const publicReleaseRoot = resolve(process.env.ARENA_PUBLIC_RELEASE_DIR ?? "public-release/accepted");
const embedPublicArtifacts = process.env.VITE_PUBLIC_ARTIFACTS !== "false";

export default defineConfig({
  define: {
    "import.meta.env.VITE_PUBLIC_ARTIFACTS": JSON.stringify(embedPublicArtifacts ? "true" : "false"),
    "import.meta.env.VITE_ARTIFACT_ORIGIN": JSON.stringify(process.env.VITE_ARTIFACT_ORIGIN),
    "import.meta.env.VITE_RUNTIME_API": JSON.stringify(process.env.VITE_RUNTIME_API ?? "false"),
    "import.meta.env.VITE_WEBMCP_PROBE": JSON.stringify(process.env.VITE_WEBMCP_PROBE ?? "false"),
    "import.meta.env.VITE_WEBMCP_PROBE_ARTIFACT": JSON.stringify(process.env.VITE_WEBMCP_PROBE_ARTIFACT ?? "false"),
  },
  build: { outDir: "dist/public-client", emptyOutDir: true },
  optimizeDeps: { include: ["react", "react-dom/client"] },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    watch: { ignored: ["**/public-release/**", "**/dist/**"] },
  },
  plugins: [
    publicReleaseModule(resolve(publicReleaseRoot, "bundle.json")),
    ...(embedPublicArtifacts ? [publicArtifactAssets(publicReleaseRoot)] : []),
    react(),
  ],
});

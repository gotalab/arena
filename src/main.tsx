import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initArtifactDelivery } from "./platform/env";
// Order is the cascade: tokens and primitives, then one file per surface.
import "./styles/base.css";
import "./styles/components.css";
import "./styles/play.css";
import "./styles/doc.css";
import "./styles/benchmark.css";

// The signed game-delivery base is fetched before first render so every
// stage URL is built once, correctly; on failure the app still boots with
// the fallback origin (see platform/env.ts).
initArtifactDelivery().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

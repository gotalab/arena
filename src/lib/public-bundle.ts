import bundle from "virtual:arena-public-blind";

if (bundle.schema !== "arena.public-release.v1") {
  throw new Error(`Unsupported Arena public release: ${String(bundle.schema)}`);
}

export const publicBundle = bundle;

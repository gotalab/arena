import assert from "node:assert/strict";
import test from "node:test";
import { validateProductBuildReceipt, validateRuntimeInputManifest } from "../public-contract/validate-product-build-receipt.mjs";

const hash = "a".repeat(64);
const receipt = () => ({ schema:"arena.product-build-receipt.v2", product:{repository:"gotalab/arena",commit:"b".repeat(40),gitTree:"c".repeat(40)}, publicRelease:{schema:"arena.public-release.v1",bundleSha256:hash,artifactTreeSha256:hash}, webDistSha256:hash, runtime:{routeContractSha256:hash,mainWorkerSha256:hash,artifactWorkerSha256:hash,sourceTreeSha256:hash,inputManifestSha256:hash}, webMcpProbe:{enabled:true,artifactSha256:hash}, licenseManifestSha256:hash, status:"built" });

test("product receipt v2 is closed and rejects v1 or tamper", () => {
  assert.equal(validateProductBuildReceipt(receipt()).schema, "arena.product-build-receipt.v2");
  assert.throws(() => validateProductBuildReceipt({...receipt(),extra:true}), /unexpected/);
  assert.throws(() => validateProductBuildReceipt({...receipt(),schema:"arena.product-build-receipt.v1"}), /unsupported/);
  const changed=receipt(); changed.runtime.mainWorkerSha256="bad";
  assert.throws(() => validateProductBuildReceipt(changed), /sha256_required/);
});

test("runtime input manifest fixes toolchain and entry names", () => {
  const manifest={schema:"arena.runtime-input-manifest.v1",esbuild:{package:"esbuild",version:"0.28.1",bundle:true,format:"esm",platform:"browser",target:"es2022",sourcemap:false,legalComments:"none",charset:"ascii"},contracts:{route:"src/lib/match-path.ts",routeSha256:hash,gameProtocol:"arena.game.v1",gameManifest:"arena.game-manifest.v1",tools:["get_game_state","take_game_action"]},inputs:[{kind:"route",path:"src/lib/match-path.ts",sha256:hash}],entryOutputPairs:[{entry:"runtime/src/artifact.ts",output:"worker-runtime/artifact-worker.js"},{entry:"runtime/src/main.ts",output:"worker-runtime/main-worker.js"}]};
  assert.equal(validateRuntimeInputManifest(manifest).schema,"arena.runtime-input-manifest.v1");
  assert.throws(()=>validateRuntimeInputManifest({...manifest,esbuild:{...manifest.esbuild,sourcemap:true}}),/unsupported_configuration/);
});

#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { verifyProductRuntimeOutput } from "./build-product-runtime.mjs";

const source = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("product_runtime_test:output_required");
const scratch = mkdtempSync(join(tmpdir(), "arena-product-tamper-"));
const dirtyProbe = resolve(import.meta.dirname, "../.product-runtime-dirty-probe");

function copy(name) {
  const target = join(scratch, name);
  cpSync(source, target, { recursive: true });
  return target;
}

try {
  const worker = copy("worker");
  writeFileSync(join(worker, "worker-runtime/main-worker.js"), "\n", { flag: "a" });
  assert.throws(() => verifyProductRuntimeOutput(worker), /main_worker_mismatch/);

  const manifestRoot = copy("manifest");
  const manifestPath = join(manifestRoot, "runtime-input-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.inputs[0].sha256 = "0".repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => verifyProductRuntimeOutput(manifestRoot), /input_manifest_mismatch/);

  const receiptRoot = copy("receipt");
  const receiptPath = join(receiptRoot, "product-build-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath));
  receipt.runtime.routeContractSha256 = "0".repeat(64);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.throws(() => verifyProductRuntimeOutput(receiptRoot), /route_contract_mismatch/);

  const revisionRoot = copy("revision");
  const revisionPath = join(revisionRoot, "product-build-receipt.json");
  const revision = JSON.parse(readFileSync(revisionPath));
  revision.product.commit = "0".repeat(40);
  writeFileSync(revisionPath, `${JSON.stringify(revision, null, 2)}\n`);
  assert.throws(() => verifyProductRuntimeOutput(revisionRoot), /revision_mismatch/);

  writeFileSync(dirtyProbe, "test-only\n", { flag: "wx" });
  assert.throws(() => verifyProductRuntimeOutput(source), /dirty_checkout/);
  console.log("Verified Worker, manifest, receipt, revision, and dirty-checkout tamper rejection.");
} finally {
  rmSync(dirtyProbe, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}

/**
 * Regression guard for the "ingested data, but the page's AI narrative stayed stale"
 * class of bug (Paulo cholesterol, 2026-07). Two invariants every ingest path must keep:
 *
 *   1. Writing clinical source rows must trigger an AI-insight rebuild, so the derived
 *      narrative can never silently lag the data a patient just uploaded.
 *   2. The lab extractor must not silently under-extract: no 4000-token cap that truncates
 *      large panels, and an explicit instruction to capture the whole urinalysis section
 *      (the block the table-biased prompt empirically dropped, up to 14 markers).
 *
 * Static-scan test (no DB / no network) so it can run in the pre-deploy gate. If someone
 * adds a NEW ingest route that writes source rows without calling enqueueInsightRebuild,
 * extend REBUILD_ROUTES below — that is the point where the guard forces a decision.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = fs.readFileSync(path.join(root, "web/_worker.js"), "utf8");
const ingest = fs.readFileSync(path.join(root, "lib/ingest.js"), "utf8");

// Ingest routes that write clinical source rows and MUST refresh insights.
const REBUILD_ROUTES = ["/api/admin/reclassify"];

test("the generic ingest->insight invalidation helper exists", () => {
  assert.match(worker, /async function enqueueInsightRebuild\(/,
    "enqueueInsightRebuild (the generic ingest-triggered rebuild hook) must exist in web/_worker.js");
});

for (const route of REBUILD_ROUTES) {
  test(`route ${route} triggers an insight rebuild after writing source rows`, () => {
    const i = worker.indexOf(route);
    assert.ok(i >= 0, `route ${route} must exist in the worker`);
    const block = worker.slice(i, i + 1600);
    assert.match(block, /enqueueInsightRebuild\(/,
      `${route} must call enqueueInsightRebuild so the AI narrative can't go stale after ingest`);
  });
}

test("lab extractor cannot silently truncate large panels", () => {
  assert.doesNotMatch(ingest, /max_tokens:\s*4000\b/,
    "the 4000-token extractor cap truncates 80+ analyte panels mid-JSON — it must be raised");
  assert.match(ingest, /max_tokens:\s*16000\b/,
    "extractor max_tokens must be large enough for full panels");
});

test("lab extractor is instructed to capture the whole urinalysis section", () => {
  assert.match(ingest, /urinalysis section/i,
    "the extractor prompt must explicitly capture every urinalysis dipstick/sediment line (the empirically-dropped block)");
});

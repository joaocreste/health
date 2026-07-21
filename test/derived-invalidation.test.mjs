/**
 * The regression WALL. Statically scans every scripts/*.mjs: if a file writes to a
 * clinical SOURCE_TABLE (INSERT/UPDATE/DELETE) it MUST call markSourceWritten, so a
 * future ingest script cannot silently reintroduce the "ingested data, stale narrative"
 * bug. A new writer that forgets the call fails CI here.
 *
 * If a writer legitimately should NOT trigger a rebuild (e.g. a pure de-identify or a
 * throwaway seed), add it to EXEMPT with a written reason — an explicit decision, not
 * an accidental omission.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_TABLES } from "../lib/derived-registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(root, "scripts");

// { filename: "reason it writes a source table but need not trigger a rebuild" }
const EXEMPT = {
  "backfill-imaging-provenance.mjs":
    "COALESCE-fills only non-clinical provenance columns (requesting/performing doctor, lab name/city/country) on imaging_studies; never touches .notes/findings the insight engine reads, keyed by study id not patient.",
  "backfill-joao-imaging-viewers.mjs":
    "COALESCE-fills only viewer/display pointer columns (manifest_blob_key, jpeg_preview_prefix, report_blob_key, file_count) so the renderer can build the .ct-viewer; access-scoping, not clinical content.",
};

const writeRe = (t) => new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?${t}"?\\b`, "i");

test("every script that writes a clinical source table calls markSourceWritten", () => {
  const offenders = [];
  for (const f of fs.readdirSync(scriptsDir)) {
    if (!f.endsWith(".mjs")) continue;
    const src = fs.readFileSync(path.join(scriptsDir, f), "utf8");
    if (!SOURCE_TABLES.some((t) => writeRe(t).test(src))) continue; // doesn't write a source table
    if (EXEMPT[f]) continue;
    if (!/markSourceWritten/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `scripts that write a source table without calling markSourceWritten ` +
    `(add the call, or add to EXEMPT with a reason):\n  ${offenders.join("\n  ")}`);
});

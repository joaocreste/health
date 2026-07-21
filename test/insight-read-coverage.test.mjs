/**
 * Enforces the derivation-registry invariant so a new source table can't silently
 * become invisible to the AI-insight engine (the bioimpedance_exams class of bug:
 * written, but never read by assembleRecord, so no rebuild can ever surface it).
 *
 *   SOURCE_TABLES === INSIGHT_READ_SET  ∪  KNOWN_NOT_READ   (disjoint)
 *   every INSIGHT_READ_SET table actually appears in a FROM in lib/ai-insights.js
 *
 * Adding a source table forces a conscious choice: wire it into assembleRecord (READ)
 * or list it in KNOWN_NOT_READ — either way it's acknowledged, never accidental.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_TABLES, INSIGHT_READ_SET, KNOWN_NOT_READ } from "../lib/derived-registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const set = (a) => new Set(a);

test("READ and NOT_READ are disjoint", () => {
  const overlap = INSIGHT_READ_SET.filter((t) => set(KNOWN_NOT_READ).has(t));
  assert.deepEqual(overlap, [], `a table is both read and not-read: ${overlap}`);
});

test("SOURCE_TABLES === INSIGHT_READ_SET ∪ KNOWN_NOT_READ", () => {
  const union = set([...INSIGHT_READ_SET, ...KNOWN_NOT_READ]);
  const src = set(SOURCE_TABLES);
  const missing = [...src].filter((t) => !union.has(t)); // source table neither read nor declared-not-read
  const extra = [...union].filter((t) => !src.has(t));   // registered but not a source table
  assert.deepEqual(missing, [], `source tables not accounted for (wire into assembleRecord or KNOWN_NOT_READ): ${missing}`);
  assert.deepEqual(extra, [], `read/not-read entries that aren't in SOURCE_TABLES: ${extra}`);
});

test("every INSIGHT_READ_SET table is actually read by lib/ai-insights.js", () => {
  const src = fs.readFileSync(path.join(root, "lib/ai-insights.js"), "utf8");
  const notFound = INSIGHT_READ_SET.filter((t) => !new RegExp(`FROM\\s+${t}\\b`).test(src));
  assert.deepEqual(notFound, [], `registry claims these are read but no FROM found in ai-insights.js: ${notFound}`);
});

test("no source table is read by ai-insights.js without being in INSIGHT_READ_SET", () => {
  const src = fs.readFileSync(path.join(root, "lib/ai-insights.js"), "utf8");
  const readButUnregistered = SOURCE_TABLES.filter(
    (t) => new RegExp(`FROM\\s+${t}\\b`).test(src) && !set(INSIGHT_READ_SET).has(t));
  assert.deepEqual(readButUnregistered, [], `read by the engine but missing from INSIGHT_READ_SET: ${readButUnregistered}`);
});

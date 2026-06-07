/**
 * Tests for the data-driven export manifest.
 * Run: node --test lib/export-manifest.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildManifest,
  availableLeafIds,
  validateSections,
  allLeafIds,
  leafLabel,
} from "./export-manifest.js";

/** Collect ids present in a built manifest tree (groups + leaves). */
function idsIn(tree) {
  const out = [];
  const walk = (nodes) => nodes.forEach((n) => { out.push(n.id); if (n.children) walk(n.children); });
  walk(tree);
  return out;
}

test("empty counts -> empty manifest (no empty checkboxes)", () => {
  const { tree } = buildManifest({});
  assert.deepEqual(tree, []);
});

test("a patient with only blood tests shows only that branch", () => {
  const { tree } = buildManifest({ labResults: 12 });
  const ids = idsIn(tree);
  // physical > exams > exams.blood survives; nothing else does
  assert.deepEqual(ids, ["physical", "exams", "exams.blood"]);
});

test("blood + urine both under exams; sibling empty branches pruned", () => {
  const { tree } = buildManifest({ labResults: 5, urinalysis: 3 });
  const ids = idsIn(tree);
  assert.ok(ids.includes("exams.blood"));
  assert.ok(ids.includes("exams.urine"));
  assert.ok(!ids.includes("genetics")); // no pgx data -> pruned
  assert.ok(!ids.includes("vitals"));   // no vitals data -> pruned
});

test("a patient with no mental data has no mental checkboxes (acceptance #6)", () => {
  const { tree } = buildManifest({ labResults: 1, vitalsDays: 200 });
  assert.ok(!idsIn(tree).includes("mental"));
});

test("vitals cardiovascular surfaces on ECG alone (no daily rows)", () => {
  const ids = availableLeafIds({ ecgEvents: 4 });
  assert.ok(ids.has("vitals.cardiovascular"));
  assert.ok(!ids.has("vitals.sleep")); // sleep needs vitalsDays
});

test("vitals sleep/movement/respiratory ride on vitalsDays together", () => {
  const ids = availableLeafIds({ vitalsDays: 100 });
  assert.ok(ids.has("vitals.sleep"));
  assert.ok(ids.has("vitals.movement"));
  assert.ok(ids.has("vitals.respiratory"));
  assert.ok(ids.has("vitals.cardiovascular"));
  assert.ok(!ids.has("vitals.glucose")); // needs glucosePoints
});

test("mental leaves gate on their own tables", () => {
  assert.ok(availableLeafIds({ psychItems: 84 }).has("mental.architecture"));
  assert.ok(availableLeafIds({ moodEntries: 30 }).has("mental.mood"));
  assert.ok(availableLeafIds({ riskAssessments: 1 }).has("mental.assessments"));
  assert.ok(availableLeafIds({ writings: 2 }).has("mental.writings"));
});

test("validateSections accepts available, rejects empty/unreal, canonicalises order", () => {
  const counts = { labResults: 5, moodEntries: 10 };
  const v = validateSections(["mental.mood", "exams.blood", "vitals.glucose", "not.a.section"], counts);
  assert.equal(v.ok, true);
  // canonical order: exams.blood comes before mental.mood in the tree
  assert.deepEqual(v.sections, ["exams.blood", "mental.mood"]);
  assert.deepEqual(v.rejected.sort(), ["not.a.section", "vitals.glucose"]);
});

test("validateSections returns ok:false when nothing requested is available", () => {
  const v = validateSections(["vitals.glucose"], { labResults: 5 });
  assert.equal(v.ok, false);
  assert.deepEqual(v.sections, []);
});

test("every leaf has a predicate and bilingual labels", () => {
  for (const id of allLeafIds()) {
    const lbl = leafLabel(id);
    assert.ok(lbl && lbl.en && lbl.pt, `missing label for ${id}`);
  }
});

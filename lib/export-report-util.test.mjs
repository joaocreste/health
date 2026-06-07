/**
 * Tests for the topic-curated report helpers.
 * Run: node --test lib/export-report-util.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reportFilename,
  neededSections,
  composeReportDocument,
  chromeHideSelectors,
  TOPIC_SECTIONS,
  PAGE_ORDER,
} from "./export-report-util.js";

test("reportFilename: 'Lumen Health <Patient> <DD-MM-YYYY>.pdf'", () => {
  const d = new Date(Date.UTC(2026, 5, 7));
  assert.equal(reportFilename("Joao Victor Creste", d), "Lumen Health Joao Victor Creste 07-06-2026.pdf");
});

test("reportFilename strips illegal chars and falls back", () => {
  const d = new Date(Date.UTC(2026, 0, 1));
  assert.equal(reportFilename('A/B:C*?"<>|D', d), "Lumen Health A B C D 01-01-2026.pdf");
  assert.equal(reportFilename("", d), "Lumen Health Patient 01-01-2026.pdf");
});

test("cardiovascular pulls cardio + bp (Vitals) AND coronary CT (Exams)", () => {
  const need = neededSections(["vitals.cardiovascular"]);
  assert.deepEqual([...need.get("physical-vitals.html")].sort(), ["bp", "cardio"]);
  assert.deepEqual([...need.get("physical-exams.html")], ["tc-heart"]);
});

test("selecting one topic does NOT pull unrelated sections", () => {
  const need = neededSections(["vitals.cardiovascular"]);
  const vitals = need.get("physical-vitals.html");
  assert.ok(!vitals.has("sleep"));
  assert.ok(!vitals.has("glucose"));
  assert.ok(!vitals.has("body"));
  assert.ok(!need.has("mental.html"));
});

test("tc-heart is de-duped when cardiovascular AND imaging are both selected", () => {
  const need = neededSections(["vitals.cardiovascular", "exams.imaging"]);
  const exams = need.get("physical-exams.html");
  // imaging contributes imaging/mri/eeg; cardiovascular contributes tc-heart — once.
  assert.equal([...exams].filter((id) => id === "tc-heart").length, 1);
  assert.ok(exams.has("imaging") && exams.has("tc-heart") && exams.has("labs") === false);
});

test("blood maps to the labs section", () => {
  assert.deepEqual([...neededSections(["exams.blood"]).get("physical-exams.html")], ["labs"]);
});

test("every leaf in the manifest tree has a topic mapping", () => {
  // (sanity: the leaves the manifest can offer must all resolve to sections)
  const leaves = Object.keys(TOPIC_SECTIONS);
  assert.ok(leaves.includes("vitals.cardiovascular"));
  for (const leaf of leaves) {
    assert.ok(Array.isArray(TOPIC_SECTIONS[leaf]) && TOPIC_SECTIONS[leaf].length, `empty mapping for ${leaf}`);
    for (const pair of TOPIC_SECTIONS[leaf]) {
      assert.equal(pair.length, 2);
      assert.ok(PAGE_ORDER.includes(pair[0]), `unknown page ${pair[0]} for ${leaf}`);
    }
  }
});

test("composeReportDocument: clean white doc with fragments, base href, chrome hidden", () => {
  const html = composeReportDocument({
    fragments: ['<section class="report-section" id="cardio">CARDIO</section>'],
    language: "pt",
    origin: "https://lumenhealth.io",
  });
  assert.match(html, /<html lang="pt">/);
  assert.ok(html.includes("CARDIO"));
  assert.ok(html.includes('<base href="https://lumenhealth.io/">'));
  assert.ok(html.includes("background: #fff")); // white, not the app tint
  assert.ok(html.includes("break-inside: avoid"));
  assert.ok(html.includes(".topnav")); // chrome hidden
  assert.ok(html.includes("styles.css?v=54"));
});

test("chromeHideSelectors covers nav + the app widgets", () => {
  const s = chromeHideSelectors().join(" ");
  ["topnav", "signout-btn", "add-data", "iu-wrap", "jc-chat", "report-export-row"].forEach((k) =>
    assert.ok(s.includes(k), `missing ${k}`)
  );
});

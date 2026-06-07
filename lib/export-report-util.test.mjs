/**
 * Tests for the pure server-report helpers.
 * Run: node --test lib/export-report-util.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reportFilename,
  pageKeepIds,
  groupByPage,
  printCss,
  chromeHideSelectors,
} from "./export-report-util.js";

test("reportFilename: 'Lumen Health <Patient> <DD-MM-YYYY>.pdf'", () => {
  const d = new Date(Date.UTC(2026, 5, 7)); // 7 June 2026
  assert.equal(reportFilename("Joao Victor Creste", d), "Lumen Health Joao Victor Creste 07-06-2026.pdf");
});

test("reportFilename strips filesystem-illegal characters and collapses spaces", () => {
  const d = new Date(Date.UTC(2026, 0, 1));
  assert.equal(reportFilename('A/B:C*?"<>|D', d), "Lumen Health A B C D 01-01-2026.pdf");
});

test("reportFilename falls back to 'Patient' when name missing", () => {
  const d = new Date(Date.UTC(2026, 11, 31));
  assert.equal(reportFilename("", d), "Lumen Health Patient 31-12-2026.pdf");
  assert.equal(reportFilename(null, d), "Lumen Health Patient 31-12-2026.pdf");
});

test("groupByPage maps leaves to backing pages, preserves order, dedupes pages", () => {
  const groups = groupByPage(["exams.blood", "exams.imaging", "vitals.sleep", "mental.mood"]);
  assert.deepEqual(groups.map((g) => g.page), ["physical-exams.html", "physical-vitals.html", "mental.html"]);
  assert.deepEqual(groups[0].leaves, ["exams.blood", "exams.imaging"]);
});

test("pageKeepIds: exams filters by section id; other pages keep all (null)", () => {
  assert.deepEqual(pageKeepIds("physical-exams.html", ["exams.blood"]), ["labs"]);
  assert.deepEqual(
    pageKeepIds("physical-exams.html", ["exams.imaging"]).sort(),
    ["eeg", "imagery", "imaging", "mri-cervical", "mri-head", "tc-heart"]
  );
  assert.equal(pageKeepIds("physical-vitals.html", ["vitals.sleep"]), null);
});

test("pageKeepIds dedupes when blood+urine both map to #labs", () => {
  assert.deepEqual(pageKeepIds("physical-exams.html", ["exams.blood", "exams.urine"]), ["labs"]);
});

test("printCss hides the app chrome and forbids splitting cards", () => {
  const css = printCss();
  assert.ok(css.includes(".topnav"));
  assert.ok(css.includes(".add-data"));      // add-data widget
  assert.ok(css.includes(".iu-wrap"));       // update-AI-insights widget
  assert.ok(css.includes("jc-chat"));        // chatbot
  assert.ok(css.includes("[data-export-btn]"));
  assert.ok(css.includes("display: none"));
  assert.ok(css.includes("break-inside: avoid"));
});

test("chromeHideSelectors covers nav + the three app widgets the report must exclude", () => {
  const s = chromeHideSelectors().join(" ");
  ["topnav", "signout-btn", "add-data", "iu-wrap", "jc-chat", "danger-zone"].forEach((k) =>
    assert.ok(s.includes(k), `missing ${k}`)
  );
});

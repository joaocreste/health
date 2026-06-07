/**
 * Tests for the server-rendered dark cover document.
 * Run: node --test lib/export-print.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoverDocument, formatGeneratedDate } from "./export-print.js";

const PATIENT = {
  name: "Joao Victor Creste",
  dob: "17 October 1992",
  sex: "Male",
  patientId: "LMN-0001",
  clinician: "Dr. Ageu",
};
const GEN = new Date(Date.UTC(2026, 5, 6)); // 6 June 2026

test("formatGeneratedDate localises EN and PT", () => {
  assert.equal(formatGeneratedDate(GEN, "en"), "6 June 2026");
  assert.equal(formatGeneratedDate(GEN, "pt"), "6 de junho de 2026");
});

test("PT cover: only Portuguese strings, correct lang attr, no English bleed", () => {
  const html = buildCoverDocument({ patient: PATIENT, sections: ["exams.blood"], language: "pt", generatedAt: GEN });
  assert.match(html, /<html lang="pt">/);
  assert.ok(html.includes("RELATÓRIO DE SAÚDE CONFIDENCIAL"));
  assert.ok(html.includes("DE DADOS DISPERSOS A INSIGHTS"));
  assert.ok(html.includes("6 de junho de 2026"));
  assert.ok(html.includes("Exames de Sangue")); // PT leaf label chip
  // English equivalents must be absent
  assert.ok(!html.includes("CONFIDENTIAL HEALTH REPORT"));
  assert.ok(!html.includes("FROM SCATTERED DATA TO INSIGHTS"));
  assert.ok(!html.includes("Blood Tests"));
});

test("EN cover: English strings + patient meta present", () => {
  const html = buildCoverDocument({ patient: PATIENT, sections: ["exams.blood", "mental.mood"], language: "en", generatedAt: GEN });
  assert.match(html, /<html lang="en">/);
  assert.ok(html.includes("FROM SCATTERED DATA TO INSIGHTS"));
  assert.ok(html.includes("Joao Victor Creste"));
  assert.ok(html.includes("17 October 1992"));
  assert.ok(html.includes("LMN-0001"));
  assert.ok(html.includes("Dr. Ageu"));
  assert.ok(html.includes("Blood Tests"));
  assert.ok(html.includes("Mood &amp; Panic")); // escaped ampersand
});

test("dark theme tokens + grid overlay + A4 are present", () => {
  const html = buildCoverDocument({ patient: PATIENT, sections: [], language: "en", generatedAt: GEN });
  assert.ok(html.includes("#0A1428"));   // --bg-page
  assert.ok(html.includes("#F4B942"));   // --accent-gold
  assert.ok(html.includes("64px 64px")); // grid overlay
  assert.ok(html.includes("size: A4"));
  assert.ok(html.includes("__lxReady = true"));
});

test("escapes patient fields (no HTML injection)", () => {
  const html = buildCoverDocument({
    patient: { name: '<script>alert(1)</script>', patientId: "x" },
    sections: [], language: "en", generatedAt: GEN,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("missing patient fields render the em-dash placeholder, not 'undefined'", () => {
  const html = buildCoverDocument({ patient: { name: "X" }, sections: [], language: "en", generatedAt: GEN });
  assert.ok(!html.includes("undefined"));
});

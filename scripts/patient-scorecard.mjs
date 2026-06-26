#!/usr/bin/env node
/**
 * Patient data scorecard — the enforcement tool for docs/data-canon.md.
 *
 * For every non-archived patient, prints render class + DB-completeness across
 * the surfaces the front-end shows, and flags violations of the data contract:
 *   - has labs but NO insights              (synthesis missing)
 *   - imaging study with a thin `notes`     (findings stranded in manifest only)
 *   - ECG study with NULL interpretation     (no headline in DB)
 *
 * Render classes are read from the dispatch in web/assets/patient-context.js
 * (STATIC / BESPOKE) — everything else is DB-DEFAULT. Reads DATABASE_URL from .env.
 *
 *   node scripts/patient-scorecard.mjs           # table + gap list
 *   node scripts/patient-scorecard.mjs --gaps    # only patients with gaps
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const GAPS_ONLY = process.argv.includes("--gaps");
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL);

// Keep in sync with the dispatch in web/assets/patient-context.js.
const STATIC = new Set(["pending:joao", "pending:leo-keller-a3f1c2"]);
const BESPOKE = new Set([
  "pending:paulo-silotto-df3441",
  "pending:silvana-creste-18ba19",
  "pending:cristina-cresti-d7479c",
]);
const cls = (clerk) => (STATIC.has(clerk) ? "STATIC" : BESPOKE.has(clerk) ? "BESPOKE" : "DB-DEFAULT");

const users = await sql`SELECT id, clerk_user_id AS clerk, full_name FROM users
  WHERE role = 'patient' AND archived_at IS NULL ORDER BY created_at`;

const rows = [];
for (const u of users) {
  const pid = u.id;
  const lab = (await sql`SELECT count(*)::int n FROM lab_results WHERE patient_id=${pid}`)[0].n;
  const img = (await sql`SELECT count(*)::int n,
      count(*) FILTER (WHERE length(coalesce(notes,'')) > 120)::int rich
      FROM imaging_studies WHERE patient_id=${pid}`)[0];
  const ecg = (await sql`SELECT count(*)::int n,
      count(*) FILTER (WHERE interpretation IS NOT NULL)::int wi
      FROM ecg_studies WHERE patient_id=${pid}`)[0];
  const ins = (await sql`SELECT (cards_json->>'generated_at') ga FROM patient_dashboards
      WHERE patient_id=${pid} AND section='ai-insights'`)[0]?.ga || null;

  const gaps = [];
  if (lab > 0 && !ins) gaps.push("labs-but-no-insights");
  if (img.n > img.rich) gaps.push(`imaging-thin-notes(${img.n - img.rich})`);
  if (ecg.n > ecg.wi) gaps.push(`ecg-no-interp(${ecg.n - ecg.wi})`);
  const empty = lab === 0 && img.n === 0 && ecg.n === 0;
  rows.push({ clerk: u.clerk, cls: cls(u.clerk), lab, img: `${img.rich}/${img.n}`, ecg: `${ecg.wi}/${ecg.n}`, ins: ins ? "yes" : "—", empty, gaps });
}

const show = GAPS_ONLY ? rows.filter((r) => r.gaps.length) : rows;
console.log("CLERK".padEnd(40), "CLASS".padEnd(11), "labs".padStart(5), "img".padStart(6), "ecg".padStart(5), "ins".padStart(4), " GAPS");
for (const r of show) {
  console.log(
    r.clerk.padEnd(40), r.cls.padEnd(11), String(r.lab).padStart(5), r.img.padStart(6),
    r.ecg.padStart(5), r.ins.padStart(4), " " + (r.empty ? "(empty patient)" : r.gaps.join(", ") || "OK")
  );
}
const withGaps = rows.filter((r) => r.gaps.length && !r.empty);
console.log(`\n${rows.length} patients · ${withGaps.length} with gaps · ${rows.filter(r=>r.empty).length} empty`);
if (withGaps.length) console.log("ACTION:", withGaps.map((r) => `${r.clerk} [${r.gaps.join(",")}]`).join("  "));

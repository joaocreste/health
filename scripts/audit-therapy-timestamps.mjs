#!/usr/bin/env node
/**
 * READ-ONLY audit: mental-health timestamp integrity.
 *
 * Verifies that every therapy session (and every time-stamped mental-health
 * record, if the sweep is enabled) carries a valid THERAPY date — the date the
 * session/event actually happened, not the import date. This guarantee is what
 * the longitudinal product ("themes over the past 35 days", "patterns over two
 * years") silently depends on.
 *
 * Runs SELECTs only. No INSERT/UPDATE/DELETE/ALTER. Remediation is a separate,
 * confirmed step. session_date and ingested_at are treated as distinct columns
 * at all times; a date sourced FROM the ingest date is the defect we hunt.
 *
 *   node scripts/audit-therapy-timestamps.mjs                 # all patients, full sweep
 *   node scripts/audit-therapy-timestamps.mjs --patient=<clerk>
 *   node scripts/audit-therapy-timestamps.mjs --no-sweep      # therapy only
 *   node scripts/audit-therapy-timestamps.mjs --floor=1990-01-01
 *   DATABASE_URL=... node scripts/audit-therapy-timestamps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon, Pool } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const PATIENT = arg("patient", null);
const FLOOR = arg("floor", "1990-01-01");
const SWEEP = !process.argv.includes("--no-sweep");
if (!/^\d{4}-\d{2}-\d{2}$/.test(FLOOR)) { console.error(`Invalid --floor (need YYYY-MM-DD): ${FLOOR}`); process.exit(2); }

const CHILD_TABLES = [
  "therapy_themes", "therapy_lens_interpretations", "therapy_strengths_growth",
  "therapy_interventions", "therapy_risk_flags", "therapy_quotes",
];
// Sweep tables -> their authoritative event-date column (discovered from schema).
const SWEEP_TABLES = [
  { table: "mood_entries", col: "ts",            type: "timestamptz" },
  { table: "panic_events", col: "occurred_at",   type: "timestamptz" },
  { table: "life_events",  col: "occurred_on",   type: "date" },
  { table: "writings",     col: "written_at",    type: "date" },
  { table: "documents",    col: "document_date", type: "date" },
];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    return m ? m[1] : null;
  } catch { return null; }
}

const results = []; // {id, desc, count, status, examples}
const rec = (id, desc, count, status, examples = []) => results.push({ id, desc, count, status, examples });
const ex = (rows, key = "id") => rows.slice(0, 8).map((r) => r[key]).join(", ");

async function main() {
  const dsn = loadDatabaseUrl();
  if (!dsn) { console.error("INCONCLUSIVE: no DATABASE_URL (env or .env)."); process.exit(2); }
  const sql = neon(dsn);
  // Pool client for the few queries with dynamic identifiers (child table names),
  // which tagged templates can't parameterize and the HTTP client can't run via
  // sql.query(). Read-only use only.
  const pool = new Pool({ connectionString: dsn });
  const prows = async (text) => (await pool.query(text)).rows;

  // ── Live connection + therapy tables exist (Phase 2) ─────────────────────
  let liveCount;
  try {
    const c = await sql`SELECT count(*)::int AS n FROM therapy_sessions`;
    liveCount = c[0].n;
  } catch (e) {
    if (/password authentication|does not exist|relation .* does not exist/i.test(e.message)) {
      console.error(`INCONCLUSIVE (not a clean pass): ${e.message}`);
      console.error("If this is the stale-password gotcha, supply the live DATABASE_URL and retry.");
      process.exit(2);
    }
    throw e;
  }
  console.log(`Live DB OK. therapy_sessions total = ${liveCount}`);
  console.log(`Scope: ${PATIENT ? "patient " + PATIENT : "ALL patients"} | sweep: ${SWEEP ? "on" : "off"} | floor: ${FLOOR}\n`);
  if (liveCount === 0) {
    console.log("therapy_sessions has 0 rows — nothing to audit on the therapy side. (Connection confirmed, so this is a true empty, not a false negative.)");
  }

  // ── A. Structural ────────────────────────────────────────────────────────
  const sd = await sql`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'therapy_sessions' AND column_name = 'session_date'`;
  if (!sd.length) {
    rec("A1", "therapy_sessions.session_date exists, date, NOT NULL, no default", 0, "FAIL", ["column missing"]);
  } else {
    const c = sd[0];
    const ok = c.data_type === "date" && c.is_nullable === "NO" && c.column_default === null;
    rec("A1", `session_date type=${c.data_type} nullable=${c.is_nullable} default=${c.column_default || "none"}`,
      ok ? 0 : 1, ok ? "PASS" : "FAIL", ok ? [] : ["a default (esp. now()) is a latent bug"]);
  }

  const childCols = await sql`
    SELECT table_name, is_nullable FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'session_date'
      AND table_name = ANY(${CHILD_TABLES})`;
  const byTable = Object.fromEntries(childCols.map((r) => [r.table_name, r.is_nullable]));
  const missingCol = CHILD_TABLES.filter((t) => !(t in byTable));
  const nullableCol = CHILD_TABLES.filter((t) => byTable[t] === "YES");
  rec("A2", "every child table has session_date NOT NULL",
    missingCol.length + nullableCol.length, (missingCol.length + nullableCol.length) ? "FAIL" : "PASS",
    [...missingCol.map((t) => t + ":missing"), ...nullableCol.map((t) => t + ":nullable")]);

  const idx = await sql`SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = ANY(${["therapy_themes", ...CHILD_TABLES]})`;
  const hasIdx = (table, cols) => idx.some((i) =>
    i.tablename === table && cols.every((c) => new RegExp(`\\b${c}\\b`).test(i.indexdef)));
  const a3miss = [];
  for (const t of CHILD_TABLES) if (!hasIdx(t, ["patient_id", "session_date"])) a3miss.push(`${t}(patient_id,session_date)`);
  if (!hasIdx("therapy_themes", ["patient_id", "canonical_label", "session_date"])) a3miss.push("therapy_themes(patient_id,canonical_label,session_date)");
  rec("A3", "required (patient_id,session_date) + theme freq index present", a3miss.length, a3miss.length ? "REVIEW" : "PASS", a3miss);

  // ── B. Integrity ─────────────────────────────────────────────────────────
  const B = async (id, desc, status, rows) => rec(id, desc, rows.length, rows.length ? status : "PASS", [ex(rows)]);

  await B("B1", "MISSING: session_date IS NULL", "FAIL",
    await sql`SELECT s.id FROM therapy_sessions s JOIN users u ON u.id=s.patient_id WHERE s.session_date IS NULL AND (${PATIENT}::text IS NULL OR u.clerk_user_id = ${PATIENT})`);
  await B("B2", "FUTURE: session_date > current_date", "FAIL",
    await sql`SELECT s.id FROM therapy_sessions s JOIN users u ON u.id=s.patient_id WHERE s.session_date > current_date AND (${PATIENT}::text IS NULL OR u.clerk_user_id = ${PATIENT})`);
  await B("B3", `SENTINEL/IMPLAUSIBLE: < ${FLOOR}, classic sentinels, or before DOB`, "FAIL",
    await sql`
      SELECT s.id FROM therapy_sessions s
      JOIN users u ON u.id = s.patient_id
      LEFT JOIN patient_profiles pp ON pp.user_id = u.id
      WHERE ( s.session_date < ${FLOOR}::date
              OR s.session_date IN ('1900-01-01','1970-01-01')
              OR (pp.date_of_birth IS NOT NULL AND s.session_date < pp.date_of_birth) )
      AND (${PATIENT}::text IS NULL OR u.clerk_user_id = ${PATIENT})`);
  await B("B4", "SUSPECT FALLBACK: session_date = ingested_at::date (review, not auto-fail)", "REVIEW",
    await sql`SELECT s.id FROM therapy_sessions s JOIN users u ON u.id=s.patient_id
      WHERE s.session_date = (s.ingested_at AT TIME ZONE 'UTC')::date AND (${PATIENT}::text IS NULL OR u.clerk_user_id = ${PATIENT})`);
  const b5 = await sql`
    SELECT u.clerk_user_id AS patient, s.session_date::text AS session_date, count(*)::int AS n
    FROM therapy_sessions s JOIN users u ON u.id = s.patient_id
    WHERE s.session_date = (s.ingested_at AT TIME ZONE 'UTC')::date AND (${PATIENT}::text IS NULL OR u.clerk_user_id = ${PATIENT})
    GROUP BY u.clerk_user_id, s.session_date HAVING count(*) > 1`;
  rec("B5", "BULK-IMPORT COLLAPSE: multiple sessions on a shared date == ingest date", b5.length,
    b5.length ? "REVIEW" : "PASS", b5.map((r) => `${r.patient}@${r.session_date}x${r.n}`));

  // B6 drift + B7 orphans per child table
  let b6Total = 0, b7Total = 0; const b6Ex = [], b7Ex = [];
  for (const t of CHILD_TABLES) {
    const drift = await prows(
      `SELECT c.id FROM ${t} c JOIN therapy_sessions s ON s.id = c.session_id
       WHERE c.session_date <> s.session_date LIMIT 8`);
    const orph = await prows(
      `SELECT c.id FROM ${t} c LEFT JOIN therapy_sessions s ON s.id = c.session_id
       WHERE s.id IS NULL LIMIT 8`);
    b6Total += drift.length; b7Total += orph.length;
    if (drift.length) b6Ex.push(`${t}:${drift.map((r) => r.id).join(",")}`);
    if (orph.length) b7Ex.push(`${t}:${orph.map((r) => r.id).join(",")}`);
  }
  rec("B6", "DENORMALISATION DRIFT: child session_date <> parent", b6Total, b6Total ? "FAIL" : "PASS", b6Ex);
  rec("B7", "ORPHANS: child session_id with no parent session", b7Total, b7Total ? "FAIL" : "PASS", b7Ex);

  // ── C. Functional (per patient with sessions) ────────────────────────────
  const patients = await sql`
    SELECT u.id, u.clerk_user_id AS clerk, u.full_name
    FROM users u WHERE u.role = 'patient' AND u.archived_at IS NULL
      AND EXISTS (SELECT 1 FROM therapy_sessions s WHERE s.patient_id = u.id)
      AND (${PATIENT}::text IS NULL OR u.clerk_user_id = ${PATIENT})
    ORDER BY u.full_name`;

  const coverage = [];
  const functional = [];
  for (const p of patients) {
    const cov = await sql`
      SELECT min(session_date)::text AS min_date, max(session_date)::text AS max_date,
             count(DISTINCT session_date)::int AS distinct_dates, count(*)::int AS total
      FROM therapy_sessions WHERE patient_id = ${p.id}`;
    const gap = await sql`
      SELECT COALESCE(max(d - prev), 0)::int AS max_gap_days FROM (
        SELECT session_date AS d, lag(session_date) OVER (ORDER BY session_date) AS prev
        FROM (SELECT DISTINCT session_date FROM therapy_sessions WHERE patient_id = ${p.id}) q
      ) z WHERE prev IS NOT NULL`;
    coverage.push({ patient: p.full_name, clerk: p.clerk, ...cov[0], max_gap_days: gap[0].max_gap_days });

    const win = async (days) => sql`
      SELECT canonical_label, count(*)::int AS n FROM therapy_themes
      WHERE patient_id = ${p.id} AND session_date >= current_date - (${days} || ' days')::interval
      GROUP BY canonical_label ORDER BY n DESC LIMIT 5`;
    const c1 = await win(15), c2 = await win(35);
    const c3 = await sql`
      SELECT to_char(date_trunc('quarter', session_date),'YYYY-"Q"Q') AS quarter, count(*)::int AS themes
      FROM therapy_themes
      WHERE patient_id = ${p.id} AND session_date >= current_date - interval '2 years'
      GROUP BY 1 ORDER BY 1`;
    functional.push({ patient: p.full_name, c1, c2, c3 });
  }

  // ── D. Sweep ─────────────────────────────────────────────────────────────
  const sweep = [];
  if (SWEEP) {
    for (const { table, col, type } of SWEEP_TABLES) {
      const cast = type === "timestamptz" ? `(${col} AT TIME ZONE 'UTC')::date` : col;
      // FLOOR is validated as YYYY-MM-DD at startup, so inlining it is safe
      // (the neon HTTP driver doesn't bind $1 params via sql.query()).
      const qrows = await prows(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE ${col} IS NULL)::int AS nulls,
           count(*) FILTER (WHERE ${cast} > current_date)::int AS future,
           count(*) FILTER (WHERE ${col} IS NOT NULL AND ${cast} < DATE '${FLOOR}')::int AS implausible,
           count(*) FILTER (WHERE ${cast} >= current_date - interval '35 days')::int AS last35
         FROM ${table}`);
      const r = qrows[0];
      const bad = r.nulls + r.future + r.implausible;
      sweep.push({ table, col, ...r, status: bad ? (r.future + r.implausible ? "FAIL" : "REVIEW") : "PASS" });
    }
  }

  await pool.end(); // all DB reads done; report uses in-memory results only

  // ════════════════════════ REPORT ════════════════════════
  const fails = results.filter((r) => r.status === "FAIL");
  const reviews = results.filter((r) => r.status === "REVIEW");
  const therapyDateValid = !fails.some((r) => ["B1", "B2", "B3", "B6", "B7"].includes(r.id));

  console.log("================ HEADLINE VERDICT ================");
  console.log(`Every therapy session has a valid therapy date: ${therapyDateValid ? "YES" : "NO"}`);
  if (!therapyDateValid) {
    const off = fails.filter((r) => ["B1", "B2", "B3", "B6", "B7"].includes(r.id));
    console.log(`  offending checks: ${off.map((r) => `${r.id}(${r.count})`).join(", ")}`);
  }

  console.log("\n================ PER-CHECK TABLE ================");
  console.log("check  status  count  description / examples");
  for (const r of results) {
    console.log(`${r.id.padEnd(5)}  ${r.status.padEnd(6)}  ${String(r.count).padEnd(5)}  ${r.desc}`);
    if (r.examples.filter(Boolean).length) console.log(`            e.g. ${r.examples.filter(Boolean).join(" | ")}`);
  }

  console.log("\n================ PER-PATIENT COVERAGE ================");
  for (const c of coverage)
    console.log(` ${c.patient} (${c.clerk}): ${c.total} sessions, ${c.distinct_dates} distinct dates, ${c.min_date} -> ${c.max_date}, largest gap ${c.max_gap_days}d`);

  console.log("\n================ FUNCTIONAL PROOF (temporal windows) ================");
  for (const f of functional) {
    console.log(` ${f.patient}`);
    console.log(`   C1 past 15d themes: ${f.c1.length ? f.c1.map((x) => `${x.canonical_label}(${x.n})`).join(", ") : "(none — window empty)"}`);
    console.log(`   C2 past 35d themes: ${f.c2.length ? f.c2.map((x) => `${x.canonical_label}(${x.n})`).join(", ") : "(none — window empty)"}`);
    console.log(`   C3 past 2y by qtr:  ${f.c3.length ? f.c3.map((x) => `${x.quarter}:${x.themes}`).join(", ") : "(none)"}`);
  }

  if (SWEEP) {
    console.log("\n================ MENTAL-HEALTH SWEEP (D) ================");
    console.log("table          col            status  total  nulls  future  implausible  last35d");
    for (const s of sweep)
      console.log(` ${s.table.padEnd(13)} ${s.col.padEnd(13)} ${s.status.padEnd(6)}  ${String(s.total).padEnd(5)}  ${String(s.nulls).padEnd(5)}  ${String(s.future).padEnd(6)}  ${String(s.implausible).padEnd(11)}  ${s.last35}`);
  }

  console.log("\n================ PRIORITISED NEEDS-ATTENTION ================");
  if (!fails.length && !reviews.length) console.log(" None — all checks PASS.");
  for (const r of fails) console.log(` FAIL   ${r.id}: ${r.desc} [${r.count}] ${r.examples.filter(Boolean).join(" | ")}`);
  for (const r of reviews) console.log(` REVIEW ${r.id}: ${r.desc} [${r.count}] ${r.examples.filter(Boolean).join(" | ")}`);
  const sweepBad = sweep.filter((s) => s.status !== "PASS");
  for (const s of sweepBad) console.log(` ${s.status.padEnd(6)} D/${s.table}.${s.col}: nulls=${s.nulls} future=${s.future} implausible=${s.implausible}`);

  console.log("\n[read-only audit complete — zero rows modified]");
}

main().catch((e) => { console.error("AUDIT ERROR (inconclusive):", e.message); process.exit(2); });

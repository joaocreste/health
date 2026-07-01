/**
 * clone-joao-to-john.mjs — create "John Smith Jr" as a FULL 1:1 mirror of
 * Patient Zero (Joao Victor Creste) in Postgres.
 *
 * Unlike ingest-leo-from-joao.mjs (which applied clinical deltas + scrubbed
 * suicidality), this is an EXACT clone with no data removed. The only changes:
 *   - identity: new users row, full_name 'John Smith Jr',
 *     clerk_user_id 'pending:john-smith-jr-9d4e21', demo login johnsmithjr.
 *   - locale/language: users.locale 'pt-BR', profile native_language 'pt',
 *     country_of_residence 'BR'.
 *   - AI insights (patient_dashboards.cards_json / summary_md) have the name
 *     "Joao Victor Creste" text-replaced with "John Smith Jr" (and London ->
 *     Sao Paulo) so the stored insight prose reads as John's. Everything else
 *     (labs, vitals, imaging, ECG, genetics, therapy, psych, writings) is
 *     copied verbatim.
 *
 * The static HTML frontend is shared with Joao and re-skinned at the DOM level
 * by web/assets/john-mode.js (name + demographic swaps, force PT). John reuses
 * Joao's /scans/* and data.js/metrics.json assets, so a patient_access grant
 * John -> Joao (all scopes) is added so John-as-self can load them.
 *
 * Idempotent: deletes John's rows first (FK-safe), then re-clones.
 * Reads DATABASE_URL from .env.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
neonConfig.webSocketConstructor = globalThis.WebSocket;
const pool = new Pool({ connectionString: env.DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;

const J = "d984faba-4a3a-45ff-9ef2-fd52606a02d3"; // Joao (source) users.id
const JOHN_CLERK = "pending:john-smith-jr-9d4e21";
const JOHN_NAME = "John Smith Jr";
const JOHN_EMAIL = "john.smith.jr@lumenhealth.io";

// Name/demographic scrub applied to stored AI-insight prose (cards_json,
// summary_md). Mirrors web/assets/john-mode.js so DB text and DOM text agree.
function scrub(s) {
  if (s == null) return s;
  return String(s)
    .replace(/Joao Victor Creste Dias de Souza/g, JOHN_NAME)
    .replace(/João Victor Creste Dias de Souza/g, JOHN_NAME)
    .replace(/Joao Victor Creste/g, JOHN_NAME)
    .replace(/João Victor Creste/g, JOHN_NAME)
    .replace(/Joao Creste/g, JOHN_NAME)
    .replace(/João Creste/g, JOHN_NAME)
    .replace(/\bJoão\b/g, "John")
    .replace(/\bJoao\b/g, "John")
    .replace(/\bLondon\b/g, "São Paulo")
    .replace(/\bLondres\b/g, "São Paulo");
}
const scrubJson = (v) => (v == null ? v : JSON.parse(scrub(JSON.stringify(v))));

// ── column introspection ──
async function colsOf(t) {
  return (await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
      AND column_name NOT IN ('fts')
      AND is_generated='NEVER'
    ORDER BY ordinal_position`, [t])).map((r) => r.column_name);
}
async function idTypeOf(t) {
  return (await q(`SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name='id'`, [t]))[0]?.data_type;
}

// Simple bulk clones: INSERT ... SELECT, patient_id -> John, fresh uuid id.
// No cross-row FK to remap. (documents has no import FK column; ecg_events /
// ecg_studies carry no cross-reference to each other.)
const BULK = [
  "lab_results", "vitals_daily", "hr_readings", "glucose_points", "pgx_findings",
  "ecg_studies", "ecg_events", "wheel_of_life_assessments", "imaging_studies",
  "patient_procedures", "documents", "medications", "therapy_period_digests",
];

// FK-safe delete order for John's existing rows (children before parents).
async function cleanup(JOHN) {
  await q(`DELETE FROM psych_evidence WHERE psych_item_id IN (SELECT id FROM psych_items WHERE patient_id=$1)`, [JOHN]);
  await q(`DELETE FROM psych_items WHERE patient_id=$1`, [JOHN]);
  const therapyChildren = ["therapy_quotes", "therapy_themes", "therapy_lens_interpretations",
    "therapy_strengths_growth", "therapy_interventions", "therapy_risk_flags", "therapy_participants"];
  for (const t of therapyChildren) { try { await q(`DELETE FROM "${t}" WHERE patient_id=$1`, [JOHN]); } catch {} }
  await q(`DELETE FROM therapy_sessions WHERE patient_id=$1`, [JOHN]);
  await q(`DELETE FROM writings WHERE patient_id=$1`, [JOHN]);
  await q(`DELETE FROM patient_dashboards WHERE patient_id=$1`, [JOHN]);
  for (const t of BULK) { try { await q(`DELETE FROM "${t}" WHERE patient_id=$1`, [JOHN]); } catch {} }
  await q(`DELETE FROM patient_access WHERE patient_id=$1`, [JOHN]);
  await q(`DELETE FROM patient_access WHERE user_id=$1`, [JOHN]);
}

async function bulkClone(t, JOHN) {
  const cols = await colsOf(t);
  const insCols = cols.filter((c) => c !== "id");
  const ins = insCols.map((c) => `"${c}"`).join(",");
  const sel = insCols.map((c) => (c === "patient_id" ? `$2::uuid` : `"${c}"`)).join(",");
  if ((await idTypeOf(t)) === "uuid") {
    await q(`INSERT INTO "${t}" (id,${ins}) SELECT gen_random_uuid(),${sel} FROM "${t}" WHERE patient_id=$1::uuid`, [J, JOHN]);
  } else {
    await q(`INSERT INTO "${t}" (${ins}) SELECT ${sel} FROM "${t}" WHERE patient_id=$1::uuid`, [J, JOHN]);
  }
  const n = (await q(`SELECT count(*)::int n FROM "${t}" WHERE patient_id=$1::uuid`, [JOHN]))[0].n;
  console.log(`  ${t.padEnd(28)} -> ${n}`);
}

// Row-by-row clone with a fresh uuid id and column value overrides.
// `overrides` maps column -> (oldValue, row) => newValue. Returns Map(oldId->newId).
async function remapClone(t, JOHN, whereSql, whereParams, overrides = {}) {
  const cols = await colsOf(t);
  const rows = await q(`SELECT * FROM "${t}" WHERE ${whereSql}`, whereParams);
  const idMap = new Map();
  for (const row of rows) {
    const newId = randomUUID();
    idMap.set(row.id, newId);
    const insCols = [], vals = [];
    for (const c of cols) {
      insCols.push(`"${c}"`);
      if (c === "id") vals.push(newId);
      else if (c === "patient_id") vals.push(row.patient_id == null ? null : JOHN);
      else if (overrides[c]) vals.push(overrides[c](row[c], row));
      else vals.push(row[c]);
    }
    const ph = vals.map((_, i) => `$${i + 1}`).join(",");
    await q(`INSERT INTO "${t}" (${insCols.join(",")}) VALUES (${ph})`, vals);
  }
  console.log(`  ${t.padEnd(28)} -> ${rows.length}`);
  return idMap;
}

async function main() {
  console.log(`Cloning Joao (${J}) -> John Smith Jr (${JOHN_CLERK})\n`);

  // ── 1. users row (idempotent on clerk_user_id) ──
  await q(`INSERT INTO users (id, clerk_user_id, email, role, locale, full_name, demo_username, demo_password, created_by, created_at, updated_at)
    SELECT gen_random_uuid(), $1, $2, 'patient', 'pt-BR', $3, 'johnsmithjr', 'lumen', $4, now(), now()
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      email=EXCLUDED.email, full_name=EXCLUDED.full_name, locale=EXCLUDED.locale,
      demo_username=EXCLUDED.demo_username, demo_password=EXCLUDED.demo_password, updated_at=now()`,
    [JOHN_CLERK, JOHN_EMAIL, JOHN_NAME, J]);
  const JOHN = (await q(`SELECT id FROM users WHERE clerk_user_id=$1`, [JOHN_CLERK]))[0].id;
  console.log(`users -> John id = ${JOHN}`);

  // ── 2. idempotent cleanup of any prior clone ──
  await cleanup(JOHN);
  console.log("cleared John's existing clinical rows\n");

  // ── 3. patient_profiles (copy Joao's, override locale/country) ──
  const pcols = await colsOf("patient_profiles");
  const insP = pcols.filter((c) => !["user_id", "created_at", "updated_at"].includes(c));
  const selP = insP.map((c) =>
    c === "native_language" ? `'pt'` :
    c === "country_of_residence" ? `'BR'` : `"${c}"`).join(",");
  await q(`INSERT INTO patient_profiles (user_id, ${insP.map((c) => `"${c}"`).join(",")}, created_at, updated_at)
    SELECT $2::uuid, ${selP}, now(), now() FROM patient_profiles WHERE user_id=$1::uuid
    ON CONFLICT (user_id) DO UPDATE SET
      native_language='pt', country_of_residence='BR', updated_at=now()`, [J, JOHN]);
  console.log("patient_profiles -> pt / BR\n");

  // ── 4. bulk clones ──
  console.log("bulk clones:");
  for (const t of BULK) await bulkClone(t, JOHN);

  // ── 5. FK-remapped clones ──
  console.log("\nremapped clones:");
  // writings (parent of psych_evidence.writing_id)
  const wMap = await remapClone("writings", JOHN, "patient_id=$1", [J]);
  // psych_items (parent of psych_evidence.psych_item_id and therapy_themes.psych_item_id)
  const piMap = await remapClone("psych_items", JOHN, "patient_id=$1", [J]);
  // psych_evidence (via psych_items) — remap item + writing ids
  {
    const cols = await colsOf("psych_evidence");
    const rows = await q(`SELECT e.* FROM psych_evidence e
      JOIN psych_items pi ON pi.id=e.psych_item_id WHERE pi.patient_id=$1`, [J]);
    for (const row of rows) {
      const insCols = [], vals = [];
      for (const c of cols) {
        insCols.push(`"${c}"`);
        if (c === "id") vals.push(randomUUID());
        else if (c === "psych_item_id") vals.push(piMap.get(row.psych_item_id) || null);
        else if (c === "writing_id") vals.push(row.writing_id ? (wMap.get(row.writing_id) || null) : null);
        else vals.push(row[c]);
      }
      const ph = vals.map((_, i) => `$${i + 1}`).join(",");
      await q(`INSERT INTO psych_evidence (${insCols.join(",")}) VALUES (${ph})`, vals);
    }
    console.log(`  ${"psych_evidence".padEnd(28)} -> ${rows.length}`);
  }
  // therapy_sessions (parent of all therapy_* children via session_id)
  const sMap = await remapClone("therapy_sessions", JOHN, "patient_id=$1", [J]);
  const sess = (v) => sMap.get(v) || null;
  // therapy_themes (parent of therapy_quotes.linked_theme_id; refs psych_item_id)
  const tMap = await remapClone("therapy_themes", JOHN, "patient_id=$1", [J],
    { session_id: sess, psych_item_id: (v) => (v ? (piMap.get(v) || null) : null) });
  // remaining therapy children (session_id only)
  for (const t of ["therapy_lens_interpretations", "therapy_strengths_growth",
    "therapy_interventions", "therapy_risk_flags", "therapy_participants"]) {
    await remapClone(t, JOHN, "patient_id=$1", [J], { session_id: sess });
  }
  // therapy_quotes (session_id + linked_theme_id)
  await remapClone("therapy_quotes", JOHN, "patient_id=$1", [J],
    { session_id: sess, linked_theme_id: (v) => (v ? (tMap.get(v) || null) : null) });

  // ── 6. patient_dashboards (AI insights) with name-scrub ──
  {
    const rows = await q(`SELECT * FROM patient_dashboards WHERE patient_id=$1`, [J]);
    const cols = await colsOf("patient_dashboards");
    for (const row of rows) {
      const insCols = [], vals = [];
      for (const c of cols) {
        insCols.push(`"${c}"`);
        if (c === "patient_id") vals.push(JOHN);
        else if (c === "summary_md") vals.push(scrub(row[c]));
        else if (c === "cards_json") vals.push(scrubJson(row[c]));
        else if (c === "highlights") vals.push(scrubJson(row[c]));
        else vals.push(row[c]);
      }
      const casts = cols.map((c, i) =>
        (["cards_json", "highlights"].includes(c)) ? `$${i + 1}::jsonb` : `$${i + 1}`);
      // jsonb params must be passed as strings
      for (let i = 0; i < cols.length; i++) {
        if (["cards_json", "highlights"].includes(cols[i]) && vals[i] != null) vals[i] = JSON.stringify(vals[i]);
      }
      await q(`INSERT INTO patient_dashboards (${insCols.join(",")}) VALUES (${casts.join(",")})`, vals);
    }
    console.log(`\npatient_dashboards (insights) -> ${rows.length} (name-scrubbed)`);
  }

  // ── 7. patient_access: mirror Joao's viewer grants + John-self grant to Joao ──
  {
    // Copy every "viewer X can see Joao" row to "viewer X can see John".
    const acols = (await colsOf("patient_access")).filter((c) => c !== "granted_at");
    const asel = acols.map((c) => (c === "patient_id" ? `$2::uuid` : `"${c}"`)).join(",");
    await q(`INSERT INTO patient_access (${acols.map((c) => `"${c}"`).join(",")}, granted_at)
      SELECT ${asel}, now() FROM patient_access WHERE patient_id=$1::uuid
      ON CONFLICT (user_id, patient_id) DO NOTHING`, [J, JOHN]);
    // John (self) needs to read Joao-owned shared assets (data.js, metrics.json,
    // /scans/*) which the worker gates to pending:joao. Grant John full scopes on Joao.
    const ALL = JSON.stringify(["profile_basic", "imaging", "labs", "vitals",
      "medications", "clinical_history", "genetics", "mental", "journal"]);
    await q(`INSERT INTO patient_access (user_id, patient_id, granted_by, scopes, reason, granted_at)
      VALUES ($1::uuid, $2::uuid, $2::uuid, $3::jsonb, 'mirror patient shares Patient Zero static assets', now())
      ON CONFLICT (user_id, patient_id) DO UPDATE SET scopes=EXCLUDED.scopes`, [JOHN, J, ALL]);
    const na = (await q(`SELECT count(*)::int n FROM patient_access WHERE patient_id=$1`, [JOHN]))[0].n;
    console.log(`patient_access -> ${na} viewer grant(s) on John + John->Joao asset grant`);
  }

  // ── 8. sanity ──
  console.log("\nSANITY (John row counts):");
  const tabs = await q(`SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='patient_id' ORDER BY table_name`);
  for (const { table_name } of tabs) {
    try {
      const n = (await q(`SELECT count(*)::int n FROM "${table_name}" WHERE patient_id=$1`, [JOHN]))[0].n;
      if (n > 0) console.log(`  ${table_name.padEnd(30)} ${n}`);
    } catch {}
  }
  console.log(`  psych_evidence(join)          ${(await q(`SELECT count(*)::int n FROM psych_evidence e JOIN psych_items pi ON pi.id=e.psych_item_id WHERE pi.patient_id=$1`, [JOHN]))[0].n}`);
  console.log(`\nJohn clerk: ${JOHN_CLERK}\nJohn id:    ${JOHN}\nDONE.`);
  await pool.end();
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });

import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { authenticate } from "../lib/auth.js";
import { handleIngest, reclassifyForPatient } from "../lib/ingest.js";

const SYSTEM_INSTRUCTIONS = `You are the JC Advisory health-portal assistant for the patient Joao Victor Creste.

STRICT RULES — non-negotiable:
1. Answer ONLY using information present in the <patient_record> below. Treat the record as your single source of truth.
2. If the record does not contain enough information to answer, say so explicitly. Do not guess, infer beyond the text, or use general medical knowledge.
3. Never fabricate dates, values, names, diagnoses, medications, or events.
4. Reply in the same language the user wrote in (English or Portuguese). The record contains both languages interleaved — both are valid sources.
5. Be concise and direct. Plain prose. Use short line breaks when listing items, but no markdown syntax (no #, *, -, **bold**, [links], or backticks) — the UI renders plain text.
6. When you cite something specific, mention which section it comes from in parentheses (e.g. "(Vitals)", "(Mental)").
7. If asked about something outside this patient's health record (general advice, other people, off-topic questions), politely refuse and redirect: "I can only answer questions about Joao's health record."

You are not a doctor. You do not give clinical advice or diagnoses — only summarise what is in the record.`;

let cachedRecord = null;

async function loadPatientRecord(request, env) {
  if (cachedRecord) return cachedRecord;
  const url = new URL("/assets/patient-record.txt", request.url);
  const resp = await env.ASSETS.fetch(url);
  if (!resp.ok) throw new Error(`patient-record.txt fetch failed: ${resp.status}`);
  cachedRecord = await resp.text();
  return cachedRecord;
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleChat(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError(500, "Server is not configured (missing API key).");
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return jsonError(400, "messages array required.");
  }
  if (messages.length > 40) {
    return jsonError(400, "Conversation too long.");
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return jsonError(400, "Each message needs role (user|assistant) and string content.");
    }
    if (m.content.length > 4000) {
      return jsonError(400, "Message too long (max 4000 chars).");
    }
  }

  let record;
  try {
    record = await loadPatientRecord(request, env);
  } catch (e) {
    return jsonError(500, `Could not load patient record: ${e.message}`);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const stream = client.messages.stream({
          model: "claude-opus-4-7",
          max_tokens: 2048,
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          system: [
            { type: "text", text: SYSTEM_INSTRUCTIONS },
            {
              type: "text",
              text: `<patient_record>\n${record}\n</patient_record>`,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
          messages,
        });

        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ text: event.delta.text });
          }
        }

        const final = await stream.finalMessage();
        send({
          done: true,
          stop_reason: final.stop_reason,
          usage: {
            input: final.usage.input_tokens,
            output: final.usage.output_tokens,
            cache_read: final.usage.cache_read_input_tokens ?? 0,
            cache_write: final.usage.cache_creation_input_tokens ?? 0,
          },
        });
      } catch (e) {
        send({ error: e?.message ?? String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleMe(request, env) {
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return new Response(JSON.stringify({ authenticated: false, reason: auth.reason }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    authenticated: true,
    clerkUserId: auth.clerkUserId,
    role: auth.role,
    email: auth.email,
    fullName: auth.fullName,
    locale: auth.locale,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePatientSummary(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  if (!clerk) return jsonError(400, "clerk_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const patientRows = await sql`
      SELECT u.id, u.clerk_user_id, u.full_name, u.email, u.locale, u.created_at,
             pp.date_of_birth, pp.sex, pp.country_of_residence, pp.native_language
      FROM users u
      LEFT JOIN patient_profiles pp ON pp.user_id = u.id
      WHERE u.clerk_user_id = ${clerk} AND u.role = 'patient' AND u.archived_at IS NULL
      LIMIT 1
    `;
    if (patientRows.length === 0) return jsonError(404, "patient_not_found");
    const patient = patientRows[0];
    const pid = patient.id;

    // Single multi-pillar count query — saves round trips.
    const [pillars, recentDocs, recentLabs, pendingFiles] = await Promise.all([
      sql`
        SELECT
          -- Physical
          (SELECT count(*)::int FROM lab_results      WHERE patient_id = ${pid}) AS lab_results,
          (SELECT count(*)::int FROM imaging_studies  WHERE patient_id = ${pid}) AS imaging_studies,
          (SELECT count(*)::int FROM medications      WHERE patient_id = ${pid}) AS medications,
          (SELECT count(*)::int FROM supplements      WHERE patient_id = ${pid}) AS supplements,
          (SELECT count(*)::int FROM encounters       WHERE patient_id = ${pid}) AS encounters,
          (SELECT count(*)::int FROM prescriptions    WHERE patient_id = ${pid}) AS prescriptions,
          (SELECT count(DISTINCT day)::int FROM vitals_daily WHERE patient_id = ${pid}) AS vitals_days,
          (SELECT count(*)::int FROM ecg_events       WHERE patient_id = ${pid}) AS ecg_events,
          (SELECT count(*)::int FROM pgx_findings     WHERE patient_id = ${pid}) AS pgx_findings,
          (SELECT count(*)::int FROM surgeries        WHERE patient_id = ${pid}) AS surgeries,
          (SELECT count(*)::int FROM injuries         WHERE patient_id = ${pid}) AS injuries,
          (SELECT count(*)::int FROM clinical_history WHERE patient_id = ${pid}) AS clinical_history,
          -- Mental
          (SELECT count(*)::int FROM psych_items      WHERE patient_id = ${pid}) AS psych_items,
          (SELECT count(*)::int FROM mood_entries     WHERE patient_id = ${pid}) AS mood_entries,
          (SELECT count(*)::int FROM panic_events     WHERE patient_id = ${pid}) AS panic_events,
          (SELECT count(*)::int FROM risk_assessments WHERE patient_id = ${pid}) AS risk_assessments,
          (SELECT count(*)::int FROM writings         WHERE patient_id = ${pid}) AS writings,
          -- Spiritual
          (SELECT count(*)::int FROM wheel_of_life_assessments WHERE patient_id = ${pid}) AS wheel_of_life,
          (SELECT count(*)::int FROM life_events      WHERE patient_id = ${pid}) AS life_events,
          -- Cross-cutting
          (SELECT count(*)::int FROM documents        WHERE patient_id = ${pid}) AS documents,
          (SELECT count(*)::int FROM imports          WHERE patient_id = ${pid}) AS imports
      `,
      sql`
        SELECT id, kind, title, original_filename, document_date, created_at
        FROM documents
        WHERE patient_id = ${pid}
        ORDER BY COALESCE(document_date, created_at::date) DESC, created_at DESC
        LIMIT 10
      `,
      sql`
        SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at, laboratory
        FROM lab_results
        WHERE patient_id = ${pid}
        ORDER BY taken_at DESC, created_at DESC
        LIMIT 10
      `,
      sql`
        SELECT if_.original_path, if_.status, if_.classified_as, if_.error_message, if_.created_at
        FROM import_files if_
        JOIN imports i ON i.id = if_.import_id
        WHERE i.patient_id = ${pid} AND if_.status NOT IN ('parsed', 'classified')
        ORDER BY if_.created_at DESC
        LIMIT 20
      `,
    ]);

    const c = pillars[0] || {};
    const physicalKeys = [
      "lab_results", "imaging_studies", "medications", "supplements",
      "encounters", "prescriptions", "vitals_days", "ecg_events",
      "pgx_findings", "surgeries", "injuries", "clinical_history",
    ];
    const mentalKeys = ["psych_items", "mood_entries", "panic_events", "risk_assessments", "writings"];
    const spiritualKeys = ["wheel_of_life", "life_events"];
    const totalIn = (keys) => keys.reduce((acc, k) => acc + (c[k] || 0), 0);

    return new Response(JSON.stringify({
      patient,
      pillars: {
        physical: { total: totalIn(physicalKeys), breakdown: pick(c, physicalKeys) },
        mental:   { total: totalIn(mentalKeys),   breakdown: pick(c, mentalKeys) },
        spiritual:{ total: totalIn(spiritualKeys),breakdown: pick(c, spiritualKeys) },
      },
      counts: { documents: c.documents || 0, imports: c.imports || 0 },
      recent_documents: recentDocs,
      recent_labs: recentLabs,
      pending_files: pendingFiles,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Summary failed: ${e.message}`);
  }
}

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => { out[k] = obj[k] || 0; });
  return out;
}

async function handlePatientExams(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  if (!clerk) return jsonError(400, "clerk_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const patientRows = await sql`
      SELECT u.id, u.clerk_user_id, u.full_name
      FROM users u
      WHERE u.clerk_user_id = ${clerk} AND u.role = 'patient' AND u.archived_at IS NULL
      LIMIT 1
    `;
    if (patientRows.length === 0) return jsonError(404, "patient_not_found");
    const patient = patientRows[0];
    const pid = patient.id;

    const [labs, labDocs, imaging] = await Promise.all([
      sql`
        SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag,
               taken_at, laboratory, source_blob_key
        FROM lab_results
        WHERE patient_id = ${pid}
        ORDER BY COALESCE(panel, 'zz') ASC, marker ASC, taken_at DESC
      `,
      sql`
        SELECT id, kind, title, original_filename, document_date, blob_key, created_at
        FROM documents
        WHERE patient_id = ${pid} AND (kind = 'lab_pdf' OR kind = 'unclassified')
        ORDER BY COALESCE(document_date, created_at::date) DESC, created_at DESC
      `,
      sql`
        SELECT id, modality, body_part, study_date, source_format,
               file_count, notes, blob_prefix, report_blob_key
        FROM imaging_studies
        WHERE patient_id = ${pid}
        ORDER BY study_date DESC
      `,
    ]);

    // Group labs by panel → marker → array of points
    const panels = {};
    for (const row of labs) {
      const panel = row.panel || "Other";
      if (!panels[panel]) panels[panel] = {};
      if (!panels[panel][row.marker]) panels[panel][row.marker] = [];
      panels[panel][row.marker].push(row);
    }
    // Convert to ordered arrays with summary per marker
    const groupedPanels = Object.keys(panels).sort().map((panelName) => {
      const markers = Object.keys(panels[panelName]).sort().map((markerName) => {
        const points = panels[panelName][markerName];
        const latest = points[0]; // already ordered by taken_at DESC
        return {
          marker: markerName,
          latest_value: latest.value,
          latest_value_text: latest.value_text,
          unit: latest.unit,
          ref_low: latest.ref_low,
          ref_high: latest.ref_high,
          flag: latest.flag,
          latest_taken_at: latest.taken_at,
          laboratory: latest.laboratory,
          source_blob_key: latest.source_blob_key,
          points,
        };
      });
      return { panel: panelName, markers };
    });

    return new Response(JSON.stringify({
      patient,
      panels: groupedPanels,
      lab_documents: labDocs,
      imaging,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Exams query failed: ${e.message}`);
  }
}

async function handleLogin(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  if (!username || !password) return jsonError(400, "username_and_password_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT clerk_user_id, role, full_name, demo_password
      FROM users
      WHERE demo_username = ${username} AND archived_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0 || rows[0].demo_password !== password) {
      return jsonError(401, "invalid_credentials");
    }
    return new Response(JSON.stringify({
      ok: true,
      clerk_user_id: rows[0].clerk_user_id,
      role: rows[0].role,
      full_name: rows[0].full_name,
      username,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Login failed: ${e.message}`);
  }
}

async function handlePatients(request, env) {
  if (!env.DATABASE_URL) {
    return jsonError(500, "DATABASE_URL not configured.");
  }
  const url = new URL(request.url);
  const forClerkId = url.searchParams.get("for");

  try {
    const sql = neon(env.DATABASE_URL);

    if (!forClerkId) {
      const rows = await sql`
        SELECT id, full_name, role, clerk_user_id
        FROM users
        WHERE archived_at IS NULL
        ORDER BY role, full_name
      `;
      return new Response(JSON.stringify({ users: rows }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const viewer = await sql`
      SELECT id, full_name, role, clerk_user_id
      FROM users
      WHERE clerk_user_id = ${forClerkId} AND archived_at IS NULL
      LIMIT 1
    `;
    if (viewer.length === 0) {
      return new Response(JSON.stringify({
        viewer: null,
        patients: [],
        reason: "viewer_not_in_db",
      }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Admins see every patient; everyone else is gated by patient_access.
    const patients = viewer[0].role === "admin"
      ? await sql`
          SELECT
            u.id,
            u.clerk_user_id,
            u.full_name,
            u.locale,
            pp.date_of_birth,
            pp.sex,
            pp.country_of_residence,
            NULL::text AS relation
          FROM users u
          LEFT JOIN patient_profiles pp ON pp.user_id = u.id
          WHERE u.role = 'patient' AND u.archived_at IS NULL
          ORDER BY u.full_name
        `
      : await sql`
          SELECT
            u.id,
            u.clerk_user_id,
            u.full_name,
            u.locale,
            pp.date_of_birth,
            pp.sex,
            pp.country_of_residence,
            pa.notes AS relation
          FROM patient_access pa
          JOIN users u ON u.id = pa.patient_id
          LEFT JOIN patient_profiles pp ON pp.user_id = u.id
          WHERE pa.user_id = ${viewer[0].id}
            AND u.archived_at IS NULL
            AND u.role = 'patient'
          ORDER BY u.full_name
        `;
    return new Response(JSON.stringify({
      viewer: viewer[0],
      patients,
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return jsonError(500, `DB query failed: ${e.message}`);
  }
}

/**
 * Demo-phase admin gate. Looks up the viewer's clerk_user_id (sent via the
 * `X-Viewer-Clerk` header or `?viewer=` query param) in the DB and verifies
 * role='admin'. When Clerk lands, swap this for requireAuth(['admin']) from
 * lib/auth.js. Trust model is identical to /api/patients?for=: the client
 * asserts its own clerk_user_id; this is fine for personal-demo phase only.
 */
async function getAdminViewer(request, sql) {
  const url = new URL(request.url);
  const viewerClerk =
    request.headers.get("x-viewer-clerk") ||
    url.searchParams.get("viewer") ||
    "";
  if (!viewerClerk) return { error: jsonError(401, "viewer_required") };
  const rows = await sql`
    SELECT id, clerk_user_id, role, full_name
    FROM users
    WHERE clerk_user_id = ${viewerClerk} AND archived_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return { error: jsonError(401, "viewer_not_in_db") };
  if (rows[0].role !== "admin") return { error: jsonError(403, "not_admin") };
  return { viewer: rows[0] };
}

function slugifyForClerkPlaceholder(name) {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "patient";
  // 6-hex random suffix → unique even across same-name collisions
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `pending:${base}-${suffix}`;
}

async function handleAdmin(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const sql = neon(env.DATABASE_URL);

  const gate = await getAdminViewer(request, sql);
  if (gate.error) return gate.error;
  const admin = gate.viewer;

  const url = new URL(request.url);
  const path = url.pathname;

  // GET /api/admin/everything — single-shot bundle for the admin UI
  if (path === "/api/admin/everything" && request.method === "GET") {
    try {
      const [patients, users, access, pending] = await Promise.all([
        sql`
          SELECT u.id, u.clerk_user_id, u.full_name, u.email, u.locale, u.created_at,
                 pp.date_of_birth, pp.sex, pp.country_of_residence, pp.native_language
          FROM users u
          LEFT JOIN patient_profiles pp ON pp.user_id = u.id
          WHERE u.role = 'patient' AND u.archived_at IS NULL
          ORDER BY u.full_name
        `,
        sql`
          SELECT id, clerk_user_id, full_name, email, role
          FROM users
          WHERE archived_at IS NULL
          ORDER BY role, full_name
        `,
        sql`
          SELECT
            pa.user_id, pa.patient_id, pa.notes, pa.granted_at,
            u_user.clerk_user_id   AS user_clerk,
            u_user.full_name       AS user_name,
            u_user.role            AS user_role,
            u_pat.clerk_user_id    AS patient_clerk,
            u_pat.full_name        AS patient_name
          FROM patient_access pa
          JOIN users u_user ON u_user.id = pa.user_id
          JOIN users u_pat  ON u_pat.id  = pa.patient_id
          ORDER BY u_pat.full_name, u_user.full_name
        `,
        sql`
          SELECT u.clerk_user_id AS patient_clerk,
                 sum(t.n)::int   AS pending
          FROM users u
          JOIN (
            SELECT i.patient_id AS pid, count(*)::int AS n
              FROM import_files if_
              JOIN imports i ON i.id = if_.import_id
              WHERE if_.status NOT IN ('parsed', 'classified')
                AND if_.blob_key IS NOT NULL
              GROUP BY i.patient_id
            UNION ALL
            SELECT patient_id AS pid, count(*)::int AS n
              FROM documents
              WHERE kind = 'unclassified'
              GROUP BY patient_id
          ) t ON t.pid = u.id
          WHERE u.role = 'patient' AND u.archived_at IS NULL
          GROUP BY u.clerk_user_id
        `,
      ]);
      const pendingMap = {};
      pending.forEach((r) => { pendingMap[r.patient_clerk] = r.pending; });
      return new Response(JSON.stringify({
        admin, patients, users, access,
        pending_by_patient: pendingMap,
      }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `DB query failed: ${e.message}`);
    }
  }

  // POST /api/admin/patients — create a new patient
  if (path === "/api/admin/patients" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const fullName = String(body?.full_name || "").trim();
    if (!fullName) return jsonError(400, "full_name_required");
    const email = String(body?.email || "").trim() || `${slugifyForClerkPlaceholder(fullName).replace(/^pending:/, "")}@placeholder.local`;
    const locale = body?.locale === "pt" ? "pt" : "en";
    const dob = body?.date_of_birth || null;
    const sex = body?.sex || null;
    const nativeLanguage = body?.native_language || null;
    const country = body?.country_of_residence || null;
    const clerk = slugifyForClerkPlaceholder(fullName);

    try {
      const inserted = await sql`
        INSERT INTO users (clerk_user_id, email, role, full_name, locale, created_by)
        VALUES (${clerk}, ${email}, 'patient', ${fullName}, ${locale}, ${admin.id})
        RETURNING id, clerk_user_id, full_name, email, locale, created_at
      `;
      const patient = inserted[0];
      await sql`
        INSERT INTO patient_profiles
          (user_id, date_of_birth, sex, native_language, country_of_residence)
        VALUES (${patient.id}, ${dob}, ${sex}, ${nativeLanguage}, ${country})
        ON CONFLICT (user_id) DO NOTHING
      `;
      // Self-access row so the patient can see their own record
      await sql`
        INSERT INTO patient_access (user_id, patient_id, notes, granted_by)
        VALUES (${patient.id}, ${patient.id}, 'self', ${admin.id})
        ON CONFLICT (user_id, patient_id) DO NOTHING
      `;
      return new Response(JSON.stringify({ ok: true, patient }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Insert failed: ${e.message}`);
    }
  }

  // POST /api/admin/users — create a user (role: patient | doctor) with login creds
  if (path === "/api/admin/users" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const fullName = String(body?.full_name || "").trim();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const role = body?.role;
    if (!fullName) return jsonError(400, "full_name_required");
    if (!username) return jsonError(400, "username_required");
    if (!password) return jsonError(400, "password_required");
    if (role !== "patient" && role !== "doctor") return jsonError(400, "role_must_be_patient_or_doctor");

    const email = String(body?.email || "").trim() || `${username}@placeholder.local`;
    const locale = body?.locale === "pt" ? "pt" : "en";
    const clerk = slugifyForClerkPlaceholder(fullName);

    try {
      // Pre-check username uniqueness for a clean 409 instead of a 500
      const existing = await sql`
        SELECT 1 FROM users WHERE demo_username = ${username} LIMIT 1
      `;
      if (existing.length > 0) return jsonError(409, "username_taken");

      const inserted = await sql`
        INSERT INTO users
          (clerk_user_id, email, role, full_name, locale,
           demo_username, demo_password, created_by)
        VALUES
          (${clerk}, ${email}, ${role}, ${fullName}, ${locale},
           ${username}, ${password}, ${admin.id})
        RETURNING id, clerk_user_id, full_name, email, role, locale, created_at
      `;
      const user = inserted[0];

      if (role === "patient") {
        const dob = body?.date_of_birth || null;
        const sex = body?.sex || null;
        const nativeLanguage = body?.native_language || null;
        const country = body?.country_of_residence || null;
        await sql`
          INSERT INTO patient_profiles
            (user_id, date_of_birth, sex, native_language, country_of_residence)
          VALUES (${user.id}, ${dob}, ${sex}, ${nativeLanguage}, ${country})
          ON CONFLICT (user_id) DO NOTHING
        `;
        await sql`
          INSERT INTO patient_access (user_id, patient_id, notes, granted_by)
          VALUES (${user.id}, ${user.id}, 'self', ${admin.id})
          ON CONFLICT (user_id, patient_id) DO NOTHING
        `;
      } else {
        const specialty = body?.specialty || null;
        const licenseCountry = body?.license_country || null;
        await sql`
          INSERT INTO doctor_profiles (user_id, specialty, license_country)
          VALUES (${user.id}, ${specialty}, ${licenseCountry})
          ON CONFLICT (user_id) DO NOTHING
        `;
      }

      return new Response(JSON.stringify({ ok: true, user }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Create user failed: ${e.message}`);
    }
  }

  // POST /api/admin/patients/delete — { patient_clerk }
  // Soft-delete: sets users.archived_at and removes incoming patient_access rows
  // so revoked-by-default for any granted viewers. Patient data (lab_results,
  // documents, imports) is preserved on disk and in R2; the row simply stops
  // surfacing in admin / patient-picker queries (which all filter archived_at).
  if (path === "/api/admin/patients/delete" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim();
    if (!patientClerk) return jsonError(400, "patient_clerk_required");

    try {
      const rows = await sql`
        SELECT id, role, full_name, archived_at
        FROM users
        WHERE clerk_user_id = ${patientClerk}
        LIMIT 1
      `;
      if (rows.length === 0)                  return jsonError(404, "patient_not_found");
      if (rows[0].role !== "patient")         return jsonError(400, "target_must_be_patient");
      if (rows[0].id === admin.id)            return jsonError(400, "cannot_delete_self");
      if (rows[0].archived_at !== null)       return jsonError(409, "already_archived");

      await sql`UPDATE users SET archived_at = now() WHERE id = ${rows[0].id}`;
      await sql`DELETE FROM patient_access WHERE patient_id = ${rows[0].id}`;

      return new Response(JSON.stringify({
        ok: true,
        archived: { clerk_user_id: patientClerk, full_name: rows[0].full_name },
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return jsonError(500, `Delete patient failed: ${e.message}`);
    }
  }

  // POST /api/admin/access — { action: 'grant' | 'revoke', user_clerk, patient_clerk, notes? }
  if (path === "/api/admin/access" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const action = body?.action;
    const userClerk = String(body?.user_clerk || "").trim();
    const patientClerk = String(body?.patient_clerk || "").trim();
    if (!userClerk || !patientClerk) return jsonError(400, "user_and_patient_required");
    if (action !== "grant" && action !== "revoke") return jsonError(400, "action_must_be_grant_or_revoke");

    try {
      const [userRow, patRow] = await Promise.all([
        sql`SELECT id, role FROM users WHERE clerk_user_id = ${userClerk} AND archived_at IS NULL LIMIT 1`,
        sql`SELECT id, role FROM users WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1`,
      ]);
      if (userRow.length === 0) return jsonError(404, "user_not_found");
      if (patRow.length === 0) return jsonError(404, "patient_not_found");
      if (patRow[0].role !== "patient") return jsonError(400, "target_must_be_patient");

      if (action === "grant") {
        const notes = String(body?.notes || "").trim() || null;
        await sql`
          INSERT INTO patient_access (user_id, patient_id, notes, granted_by)
          VALUES (${userRow[0].id}, ${patRow[0].id}, ${notes}, ${admin.id})
          ON CONFLICT (user_id, patient_id) DO UPDATE SET
            notes = COALESCE(EXCLUDED.notes, patient_access.notes),
            granted_by = EXCLUDED.granted_by,
            granted_at = now()
        `;
      } else {
        await sql`
          DELETE FROM patient_access
          WHERE user_id = ${userRow[0].id} AND patient_id = ${patRow[0].id}
        `;
      }
      return new Response(JSON.stringify({ ok: true, action }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Access change failed: ${e.message}`);
    }
  }

  // POST /api/admin/reclassify — { patient_clerk, limit? } batched re-run of
  // the ingest classifier (and lab/writing extractor) on stuck import_files
  // and documents.kind='unclassified'. Call multiple times until remaining=0.
  if (path === "/api/admin/reclassify" && request.method === "POST") {
    if (!env.ANTHROPIC_API_KEY) return jsonError(500, "anthropic_api_key_not_configured");
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim();
    if (!patientClerk) return jsonError(400, "patient_clerk_required");
    const limit = Math.min(Math.max(parseInt(body?.limit, 10) || 1, 1), 5);

    try {
      const patientRows = await sql`
        SELECT id, role FROM users
        WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1
      `;
      if (patientRows.length === 0 || patientRows[0].role !== "patient") {
        return jsonError(404, "patient_not_found");
      }
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const result = await reclassifyForPatient(sql, anthropic, env, patientRows[0].id, limit);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `Reclassify failed: ${e.message}`);
    }
  }

  return jsonError(404, "unknown_admin_route");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") {
      return handleChat(request, env);
    }
    if (url.pathname === "/api/me") {
      return handleMe(request, env);
    }
    if (url.pathname === "/api/login") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/patient-summary") {
      return handlePatientSummary(request, env);
    }
    if (url.pathname === "/api/patient-exams") {
      return handlePatientExams(request, env);
    }
    if (url.pathname === "/api/patients") {
      return handlePatients(request, env);
    }
    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdmin(request, env);
    }
    if (url.pathname === "/api/ingest") {
      return handleIngest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

/**
 * Ingest pipeline — Phase 1.
 *
 * Per file:
 *   1. Stream the bytes into R2 at a unique key.
 *   2. Insert an `import_files` row (and a parent `imports` row per request).
 *   3. Ask Claude to classify the file (small Haiku call, cheap).
 *   4. Insert a `documents` row (always).
 *   5. For the few classes we extract today (lab_pdf, writing), run the
 *      type-specific extractor and insert typed-table rows.
 *
 * Returns per-file status the client can render line-by-line. Failures of
 * classification or extraction do NOT fail the upload — the blob is preserved
 * and the file is recorded under `documents` so nothing is ever lost.
 */

import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";

/* ───── Taxonomy ───────────────────────────────────── */

export const TAXONOMY = [
  "lab_pdf",              // → lab_results
  "writing",              // → writings
  "dicom_series",         // → imaging_studies (blob only in Phase 1)
  "imaging_image",        // → imaging_studies (blob only in Phase 1)
  "apple_health_export",  // → vitals_daily (deferred)
  "oura_csv",             // → vitals_daily (deferred)
  "ecg_pdf",              // → ecg_events (deferred)
  "ecg_csv",              // → ecg_events (deferred)
  "genetics_report",      // → pgx_findings (deferred)
  "medication_csv",       // → medications (deferred)
  "wheel_of_life_csv",    // → wheel_of_life_assessments (deferred)
  "doctor_report",        // → encounters (deferred)
  "unclassified",         // → documents only
];

const CLASS_TO_TABLE = {
  lab_pdf: "lab_results",
  writing: "writings",
  dicom_series: "imaging_studies",
  imaging_image: "imaging_studies",
  apple_health_export: "vitals_daily",
  oura_csv: "vitals_daily",
  ecg_pdf: "ecg_events",
  ecg_csv: "ecg_events",
  genetics_report: "pgx_findings",
  medication_csv: "medications",
  wheel_of_life_csv: "wheel_of_life_assessments",
  doctor_report: "encounters",
  unclassified: "documents",
};

/* ───── Helpers ────────────────────────────────────── */

function nowIso() { return new Date().toISOString(); }

function buildBlobKey(patientId, importId, filename) {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return `patients/${patientId}/imports/${importId}/${Date.now()}_${safe}`;
}

function inferKindFromName(name) {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return { lower, ext };
}

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readFileText(file, maxBytes = 64 * 1024) {
  // For text-y files only. Truncates so classification calls stay cheap.
  const buf = await file.arrayBuffer();
  const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

/* ───── R2 ────────────────────────────────────────── */

async function putR2(env, key, body, contentType) {
  if (!env.R2_BUCKET) {
    throw new Error("R2_BUCKET is not bound to this worker.");
  }
  await env.R2_BUCKET.put(key, body, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
  });
}

/* ───── DB primitives ─────────────────────────────── */

async function getPatientByClerk(sql, clerkId) {
  const rows = await sql`
    SELECT id, role FROM users
    WHERE clerk_user_id = ${clerkId} AND archived_at IS NULL LIMIT 1
  `;
  return rows[0] || null;
}

async function getViewerByClerk(sql, clerkId) {
  const rows = await sql`
    SELECT id FROM users
    WHERE clerk_user_id = ${clerkId} AND archived_at IS NULL LIMIT 1
  `;
  return rows[0] || null;
}

async function createImportRow(sql, patientId, viewerId) {
  const rows = await sql`
    INSERT INTO imports (patient_id, initiated_by, source, status, started_at)
    VALUES (${patientId}, ${viewerId}, 'self_files', 'processing', now())
    RETURNING id
  `;
  return rows[0].id;
}

async function createImportFileRow(sql, importId, originalPath, mimeType, sizeBytes) {
  const rows = await sql`
    INSERT INTO import_files (import_id, original_path, mime_type, size_bytes, status)
    VALUES (${importId}, ${originalPath}, ${mimeType || null}, ${sizeBytes}, 'received')
    RETURNING id
  `;
  return rows[0].id;
}

async function markImportFile(sql, importFileId, fields) {
  const {
    blob_key = null,
    classified_as = null,
    target_table = null,
    target_ids = null,
    status = "received",
    error_message = null,
  } = fields;
  await sql`
    UPDATE import_files
    SET blob_key      = COALESCE(${blob_key}, blob_key),
        classified_as = COALESCE(${classified_as}, classified_as),
        target_table  = COALESCE(${target_table}, target_table),
        target_ids    = COALESCE(${target_ids ? JSON.stringify(target_ids) : null}::jsonb, target_ids),
        status        = ${status},
        error_message = ${error_message}
    WHERE id = ${importFileId}
  `;
}

async function finishImport(sql, importId, total, processed, failed) {
  const status = failed === 0 ? "completed" : (processed === 0 ? "failed" : "partial");
  await sql`
    UPDATE imports
    SET status = ${status},
        total_files = ${total},
        processed_files = ${processed},
        failed_files = ${failed},
        completed_at = now()
    WHERE id = ${importId}
  `;
}

/* ───── Classifier ────────────────────────────────── */

const CLASSIFIER_SYSTEM = `You classify a single uploaded health-data file into a fixed taxonomy.

Taxonomy (return exactly one of these strings as "class"):
  - "lab_pdf"             — blood/urine/etc lab report (markers + values)
  - "writing"             — personal text/journal/letter (the patient's own prose)
  - "dicom_series"        — DICOM file (CT/MRI/etc imagery)
  - "imaging_image"       — single JPEG/PNG of an exam or body region
  - "apple_health_export" — Apple Health export.xml or its zip wrapper
  - "oura_csv"            — Oura Ring daily-summary CSV
  - "ecg_pdf"             — ECG report PDF (Apple Watch, Kardia, Withings, etc.)
  - "ecg_csv"             — ECG CSV (raw voltage samples)
  - "genetics_report"     — pharmacogenomic or DNA report
  - "medication_csv"      — list of medications (CSV)
  - "wheel_of_life_csv"   — wheel-of-life self-assessment CSV
  - "doctor_report"       — clinician's narrative report (consultation, encounter notes)
  - "unclassified"        — none of the above

Return STRICT JSON only, no prose, matching:
  { "class": "<taxonomy-key>",
    "confidence": <number 0..1>,
    "title": "<short human-readable title>",
    "document_date": "<YYYY-MM-DD or null>",
    "summary": "<one-sentence description, max 200 chars>" }`;

async function classifyFile(client, file, sample) {
  const { ext } = inferKindFromName(file.name);
  const isPdf = file.type === "application/pdf" || ext === "pdf";

  let model;
  let userContent;
  if (isPdf) {
    // Send the actual PDF so the model can read its contents. Sonnet supports
    // document input; Haiku does not. Cost is acceptable because (a) classify
    // is rarely re-run per file, and (b) most other branches still use Haiku.
    const pdfB64 = arrayBufferToBase64(await file.arrayBuffer());
    model = "claude-sonnet-4-6";
    userContent = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
      { type: "text", text:
        `Filename: ${file.name}\n` +
        `MIME type: ${file.type || "unknown"}\n` +
        `Size bytes: ${file.size}\n\n` +
        `Classify the attached PDF using the taxonomy in the system prompt. ` +
        `Use the actual content, not just the filename.`,
      },
    ];
  } else {
    model = "claude-haiku-4-5-20251001";
    userContent = [{
      type: "text",
      text:
        `Filename: ${file.name}\n` +
        `MIME type: ${file.type || "unknown"}\n` +
        `Size bytes: ${file.size}\n` +
        (sample
          ? `\nFirst ${Math.min(sample.length, 4000)} chars of the file:\n${sample.slice(0, 4000)}`
          : `\n(Binary file with no extractable text — classify from filename, MIME and extension.)`),
    }];
  }

  const resp = await client.messages.create({
    model,
    max_tokens: 400,
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Classifier returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!TAXONOMY.includes(parsed.class)) parsed.class = "unclassified";
  return parsed;
}

/* ───── Extractors (Phase 1: lab_pdf, writing) ────── */

const LAB_EXTRACTOR_SYSTEM = `You extract structured lab results from a single lab-report PDF.

Return STRICT JSON only, matching:
  { "laboratory": "<name or null>",
    "taken_at":   "<YYYY-MM-DD or null>",
    "markers": [
      { "panel": "<panel name or null>",
        "marker": "<marker name>",
        "value":  <number or null>,
        "value_text": "<string for non-numeric results or null>",
        "unit": "<string or null>",
        "ref_low":  <number or null>,
        "ref_high": <number or null>,
        "flag":   "<L|H|HH|LL or null>" }
    ]
  }

Do not invent values. If a marker is illegible or absent, omit it. If the date is ambiguous, return null.`;

async function extractLabResults(client, pdfBase64) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: LAB_EXTRACTOR_SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: "Extract the lab results. Strict JSON only." },
      ],
    }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned);
}

async function insertLabRows(sql, patientId, extracted, blobKey) {
  if (!extracted?.markers?.length) return [];
  const ids = [];
  const taken = extracted.taken_at || new Date().toISOString().slice(0, 10);
  for (const m of extracted.markers) {
    if (!m.marker) continue;
    const rows = await sql`
      INSERT INTO lab_results
        (patient_id, panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at, laboratory, source_blob_key)
      VALUES
        (${patientId}, ${m.panel || null}, ${m.marker}, ${m.value ?? null}, ${m.value_text || null},
         ${m.unit || null}, ${m.ref_low ?? null}, ${m.ref_high ?? null}, ${m.flag || null},
         ${taken}::date, ${extracted.laboratory || null}, ${blobKey})
      RETURNING id
    `;
    ids.push(rows[0].id);
  }
  return ids;
}

async function insertWritingRow(sql, patientId, title, writtenAt, language, extractedText, blobKey) {
  const rows = await sql`
    INSERT INTO writings (patient_id, title, written_at, language, blob_key, extracted_text)
    VALUES (${patientId}, ${title}, ${writtenAt || null}, ${language || null}, ${blobKey}, ${extractedText || null})
    RETURNING id
  `;
  return rows[0].id;
}

async function insertDocumentRow(sql, patientId, kind, title, originalFilename, blobKey, mimeType, sizeBytes, documentDate, metadata) {
  const rows = await sql`
    INSERT INTO documents
      (patient_id, kind, title, original_filename, blob_key, mime_type, size_bytes, document_date, metadata)
    VALUES
      (${patientId}, ${kind}, ${title || null}, ${originalFilename}, ${blobKey},
       ${mimeType || null}, ${sizeBytes ?? null}, ${documentDate || null},
       ${metadata ? JSON.stringify(metadata) : null}::jsonb)
    RETURNING id
  `;
  return rows[0].id;
}

/* ───── Per-file pipeline ────────────────────────── */

async function processOneFile({ sql, anthropic, env, file, patientId, importId }) {
  const importFileId = await createImportFileRow(sql, importId, file.name, file.type, file.size);
  const blobKey = buildBlobKey(patientId, importId, file.name);

  // 1. Stream to R2
  try {
    await putR2(env, blobKey, await file.arrayBuffer(), file.type);
  } catch (e) {
    await markImportFile(sql, importFileId, { status: "failed", error_message: `R2 put failed: ${e.message}` });
    return { ok: false, filename: file.name, stage: "upload", error: e.message };
  }

  // 2. Sample for classification (textish only)
  const { ext } = inferKindFromName(file.name);
  const textyExts = new Set(["txt", "md", "csv", "tsv", "json", "xml", "html"]);
  let sample = null;
  if (textyExts.has(ext) || (file.type || "").startsWith("text/")) {
    try { sample = await readFileText(file); } catch { /* ignore */ }
  }

  // 3. Classify
  let cls;
  try {
    cls = await classifyFile(anthropic, file, sample);
  } catch (e) {
    cls = { class: "unclassified", confidence: 0, title: file.name, document_date: null, summary: `Classifier error: ${e.message}` };
  }

  const targetTable = CLASS_TO_TABLE[cls.class] || "documents";
  const createdIds = [];
  let stageError = null;

  // 4. Always record in documents
  const docId = await insertDocumentRow(
    sql, patientId,
    cls.class,
    cls.title || file.name,
    file.name,
    blobKey,
    file.type || null,
    file.size || null,
    cls.document_date || null,
    { classifier: cls, ext, classified_as: cls.class },
  );
  createdIds.push({ table: "documents", id: docId });

  // 5. Type-specific extraction (Phase 1: lab_pdf, writing)
  try {
    if (cls.class === "lab_pdf" && (file.type === "application/pdf" || ext === "pdf")) {
      const pdfB64 = arrayBufferToBase64(await file.arrayBuffer());
      const extracted = await extractLabResults(anthropic, pdfB64);
      const labIds = await insertLabRows(sql, patientId, extracted, blobKey);
      labIds.forEach((id) => createdIds.push({ table: "lab_results", id }));
    } else if (cls.class === "writing") {
      let text = null;
      if (ext === "txt" || ext === "md" || (file.type || "").startsWith("text/")) {
        text = await readFileText(file, 4 * 1024 * 1024); // up to 4MB of text
      }
      // For DOCX we'd need a ZIP parser; Phase 1 stores the blob and skips text extraction.
      const wid = await insertWritingRow(
        sql, patientId, cls.title || file.name,
        cls.document_date, null, text, blobKey,
      );
      createdIds.push({ table: "writings", id: wid });
    }
  } catch (e) {
    stageError = `Extractor (${cls.class}) failed: ${e.message}`;
  }

  await markImportFile(sql, importFileId, {
    blob_key: blobKey,
    classified_as: cls.class,
    target_table: targetTable,
    target_ids: createdIds.map((c) => c.id),
    status: stageError ? "skipped" : "parsed",
    error_message: stageError,
  });

  return {
    ok: true,
    filename: file.name,
    classified_as: cls.class,
    confidence: cls.confidence,
    target_table: targetTable,
    summary: cls.summary,
    document_date: cls.document_date,
    created: createdIds,
    note: stageError,
  };
}

/* ───── Combined classify + extract (single PDF call) ────────── */

const CLASSIFY_AND_EXTRACT_SYSTEM = `You process a single medical PDF and return strict JSON.

Step 1: classify into the taxonomy:
  - "lab_pdf"             — blood/urine/etc lab report (markers + values)
  - "writing"             — personal text/journal/letter
  - "dicom_series"        — DICOM imagery
  - "imaging_image"       — JPEG/PNG of an exam
  - "ecg_pdf"             — ECG report
  - "genetics_report"     — pharmacogenomic or DNA report
  - "doctor_report"       — clinician narrative (consultation, encounter notes)
  - "medication_csv"      — medication list
  - "wheel_of_life_csv"   — wheel-of-life self-assessment
  - "unclassified"        — none of the above

Step 2: if class == "lab_pdf", extract every lab marker visible in the PDF.

Return JSON of shape:
{
  "class":         "<taxonomy-key>",
  "confidence":    <0..1>,
  "title":         "<short human-readable title>",
  "document_date": "<YYYY-MM-DD or null>",
  "summary":       "<one sentence, max 200 chars>",
  "lab_data": null | {
    "laboratory": "<lab name or null>",
    "taken_at":   "<YYYY-MM-DD or null>",
    "markers": [
      { "panel": "<panel name or null>",
        "marker": "<marker name>",
        "value":  <number or null>,
        "value_text": "<string for non-numeric or null>",
        "unit": "<string or null>",
        "ref_low":  <number or null>,
        "ref_high": <number or null>,
        "flag": "<L|H|HH|LL or null>" }
    ]
  }
}

Rules:
- Output ONLY the JSON object, no prose, no code fences.
- Never invent values. Omit markers that are illegible or absent.
- "lab_data" is null unless class is "lab_pdf".`;

async function classifyAndExtractPdf(client, file) {
  const pdfB64 = arrayBufferToBase64(await file.arrayBuffer());
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: CLASSIFY_AND_EXTRACT_SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
        { type: "text", text: `Filename: ${file.name}\n\nClassify (and, for lab_pdf, extract). Strict JSON only.` },
      ],
    }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new Error(`Classify+extract returned non-JSON: ${text.slice(0, 200)}`); }
  if (!TAXONOMY.includes(parsed.class)) parsed.class = "unclassified";
  if (parsed.class !== "lab_pdf") parsed.lab_data = null;
  return parsed;
}

/* ───── Reclassify (re-runs the pipeline on stuck/unclassified items) ─── */

async function getR2(env, key) {
  if (!env.R2_BUCKET) throw new Error("R2_BUCKET not bound");
  const obj = await env.R2_BUCKET.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  return obj;
}

async function reclassifyBlob(sql, anthropic, env, ctx) {
  const { patientId, blobKey, originalFilename, mimeType, sizeBytes,
          existingDocumentId, importFileId } = ctx;

  const obj = await getR2(env, blobKey);
  const buf = await obj.arrayBuffer();
  const contentType = mimeType || (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
  const size = sizeBytes || buf.byteLength;

  const fakeFile = {
    name: originalFilename,
    type: contentType,
    size,
    arrayBuffer: async () => buf,
  };

  const { ext } = inferKindFromName(originalFilename);
  const isPdf = contentType === "application/pdf" || ext === "pdf";

  // PDFs use the combined classify+extract call (1 Sonnet round-trip).
  // Everything else uses the existing two-stage path (Haiku classify, then
  // text-extractor for writings).
  let cls;
  let preFetchedLabData = null;
  if (isPdf) {
    const combined = await classifyAndExtractPdf(anthropic, fakeFile);
    cls = combined;
    preFetchedLabData = combined.lab_data || null;
  } else {
    const textyExts = new Set(["txt", "md", "csv", "tsv", "json", "xml", "html"]);
    let sample = null;
    if (textyExts.has(ext) || contentType.startsWith("text/")) {
      try {
        sample = new TextDecoder("utf-8", { fatal: false })
          .decode(buf.slice(0, 64 * 1024));
      } catch { /* ignore */ }
    }
    cls = await classifyFile(anthropic, fakeFile, sample);
  }

  const targetTable = CLASS_TO_TABLE[cls.class] || "documents";
  let labRows = 0;
  let writingInserted = false;
  let stageError = null;

  if (existingDocumentId) {
    await sql`
      UPDATE documents
      SET kind          = ${cls.class},
          title         = ${cls.title || originalFilename},
          document_date = ${cls.document_date || null},
          metadata      = ${JSON.stringify({ classifier: cls, ext, classified_as: cls.class, reclassified_at: nowIso() })}
      WHERE id = ${existingDocumentId}
    `;
  } else {
    const docId = await insertDocumentRow(
      sql, patientId,
      cls.class, cls.title || originalFilename,
      originalFilename, blobKey, contentType, size,
      cls.document_date || null,
      { classifier: cls, ext, classified_as: cls.class, reclassified: true },
    );
    ctx.existingDocumentId = docId;
  }

  try {
    if (cls.class === "lab_pdf") {
      const existing = await sql`
        SELECT count(*)::int AS n FROM lab_results
        WHERE patient_id = ${patientId} AND source_blob_key = ${blobKey}
      `;
      if (existing[0].n === 0) {
        let extracted = preFetchedLabData;
        if (!extracted) {
          // Non-PDF lab file (shouldn't happen often) — fall back to dedicated extractor.
          extracted = await extractLabResults(anthropic, arrayBufferToBase64(buf));
        }
        const labIds = await insertLabRows(sql, patientId, extracted, blobKey);
        labRows = labIds.length;
      }
    } else if (cls.class === "writing") {
      const existing = await sql`
        SELECT count(*)::int AS n FROM writings
        WHERE patient_id = ${patientId} AND blob_key = ${blobKey}
      `;
      if (existing[0].n === 0) {
        let text = null;
        if (ext === "txt" || ext === "md" || contentType.startsWith("text/")) {
          text = new TextDecoder("utf-8", { fatal: false })
            .decode(buf.slice(0, 4 * 1024 * 1024));
        }
        await insertWritingRow(
          sql, patientId, cls.title || originalFilename,
          cls.document_date, null, text, blobKey,
        );
        writingInserted = true;
      }
    }
  } catch (e) {
    stageError = `Extractor (${cls.class}) failed: ${e.message}`;
  }

  if (importFileId) {
    await markImportFile(sql, importFileId, {
      blob_key: blobKey,
      classified_as: cls.class,
      target_table: targetTable,
      status: stageError ? "skipped" : "parsed",
      error_message: stageError,
    });
  }

  return {
    new_class: cls.class,
    target_table: targetTable,
    lab_rows: labRows,
    writing_inserted: writingInserted,
    error: stageError,
  };
}

/**
 * Re-run classification (and lab/writing extraction) on documents that
 * landed as 'unclassified' and import_files stuck in a non-terminal state.
 * Idempotent on lab_results / writings via source_blob_key checks. Bounded
 * by `limit` to stay inside Worker CPU budget — caller may invoke repeatedly.
 */
export async function reclassifyForPatient(sql, anthropic, env, patientId, limit = 5) {
  const stuck = await sql`
    SELECT if_.id AS import_file_id, if_.blob_key, if_.original_path AS filename,
           if_.mime_type, if_.size_bytes
    FROM import_files if_
    JOIN imports i ON i.id = if_.import_id
    WHERE i.patient_id = ${patientId}
      AND if_.status NOT IN ('parsed', 'classified')
      AND if_.blob_key IS NOT NULL
    ORDER BY if_.created_at ASC
  `;
  const unclassified = await sql`
    SELECT id AS document_id, blob_key, original_filename AS filename,
           mime_type, size_bytes
    FROM documents
    WHERE patient_id = ${patientId} AND kind = 'unclassified'
    ORDER BY created_at ASC
  `;

  const candidates = [];
  stuck.forEach((s) => candidates.push({
    kind: "import_file",
    importFileId: s.import_file_id,
    existingDocumentId: null,
    blobKey: s.blob_key,
    originalFilename: s.filename,
    mimeType: s.mime_type,
    sizeBytes: s.size_bytes,
  }));
  unclassified.forEach((d) => candidates.push({
    kind: "document",
    importFileId: null,
    existingDocumentId: d.document_id,
    blobKey: d.blob_key,
    originalFilename: d.filename,
    mimeType: d.mime_type,
    sizeBytes: d.size_bytes,
  }));

  const toProcess = candidates.slice(0, limit);
  const processed = [];
  for (const c of toProcess) {
    try {
      const r = await reclassifyBlob(sql, anthropic, env, {
        patientId,
        blobKey: c.blobKey,
        originalFilename: c.originalFilename,
        mimeType: c.mimeType,
        sizeBytes: c.sizeBytes,
        existingDocumentId: c.existingDocumentId,
        importFileId: c.importFileId,
      });
      processed.push({
        source: c.kind,
        original_path: c.originalFilename,
        new_class: r.new_class,
        target_table: r.target_table,
        lab_rows: r.lab_rows,
        writing_inserted: r.writing_inserted,
        error: r.error,
      });
    } catch (e) {
      processed.push({
        source: c.kind,
        original_path: c.originalFilename,
        error: e.message,
      });
    }
  }

  return {
    processed,
    remaining: Math.max(0, candidates.length - processed.length),
    total: candidates.length,
  };
}

/* ───── Public entry point ────────────────────────── */

export async function handleIngest(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  if (!env.DATABASE_URL) {
    return new Response(JSON.stringify({ error: "DATABASE_URL not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (!env.R2_BUCKET) {
    return new Response(JSON.stringify({ error: "R2_BUCKET not bound to the worker" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: `bad_multipart: ${e.message}` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const patientClerk = form.get("patient_clerk");
  const viewerClerk = form.get("viewer_clerk");
  if (!patientClerk) {
    return new Response(JSON.stringify({ error: "patient_clerk required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const files = form.getAll("files").filter((f) => f && typeof f.arrayBuffer === "function");
  if (files.length === 0) {
    return new Response(JSON.stringify({ error: "no files in multipart" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const sql = neon(env.DATABASE_URL);
  const patient = await getPatientByClerk(sql, patientClerk);
  if (!patient) {
    return new Response(JSON.stringify({ error: `unknown patient_clerk: ${patientClerk}` }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  const viewer = viewerClerk ? await getViewerByClerk(sql, viewerClerk) : null;

  const importId = await createImportRow(sql, patient.id, viewer?.id || null);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const results = [];
  let processed = 0;
  let failed = 0;
  for (const file of files) {
    let r;
    try {
      r = await processOneFile({ sql, anthropic, env, file, patientId: patient.id, importId });
      processed += r.ok ? 1 : 0;
      if (!r.ok) failed++;
    } catch (e) {
      failed++;
      r = { ok: false, filename: file.name, stage: "pipeline", error: e.message };
    }
    results.push(r);
  }

  await finishImport(sql, importId, files.length, processed, failed);

  return new Response(JSON.stringify({
    ok: failed === 0,
    import_id: importId,
    processed,
    failed,
    results,
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

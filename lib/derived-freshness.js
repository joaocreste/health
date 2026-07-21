// The generic derived-data freshness primitive.
//
// Call markSourceWritten(sql, patientId, { writer }) after ANY write to a patient's
// clinical source tables (see lib/derived-registry.js SOURCE_TABLES). It makes silent
// staleness impossible by doing two cheap, idempotent things:
//   1. advances patient_source_watermark.watermark to now() (denormalized high-water
//      mark so read-time staleness is O(1), not a UNION-max over ~25 tables), and
//   2. enqueues an AI-insight rebuild job (insight_jobs) unless one is already
//      queued/running.
//
// It does NOT run the rebuild — that dies on the Pages wall-clock for large records
// (see project_insight_rebuild_wallclock). The worker's reclassify path additionally
// kicks runInsightJob for a best-effort immediate rebuild; ingest scripts leave the
// queued job for scripts/run-insights-local.mjs (or the read-time banner) to surface.
//
// Portable: pure Neon SQL, no ctx / no worker globals — callable from ingest scripts
// AND the worker. NEVER throws into the caller: a freshness-bookkeeping failure must
// not abort the ingest that triggered it.

export async function markSourceWritten(sql, patientId, opts = {}) {
  const writer = opts.writer || opts.source || null;
  if (!patientId) return { error: "markSourceWritten: no patientId" };
  try {
    await sql`
      INSERT INTO patient_source_watermark (patient_id, watermark, updated_by, updated_at)
      VALUES (${patientId}, now(), ${writer}, now())
      ON CONFLICT (patient_id) DO UPDATE SET
        watermark = now(), updated_by = ${writer}, updated_at = now()`;
    const running = await sql`
      SELECT id FROM insight_jobs
      WHERE patient_id = ${patientId} AND status IN ('queued','running')
      ORDER BY started_at DESC LIMIT 1`;
    if (running.length > 0) return { watermarked: true, job: "already_queued" };
    const created = await sql`
      INSERT INTO insight_jobs (patient_id, status, progress, stage)
      VALUES (${patientId}, 'queued', 0, 'queued') RETURNING id`;
    return { watermarked: true, jobId: created[0].id };
  } catch (e) {
    return { error: e.message };
  }
}

// Read-time staleness check: is the patient's AI narrative built against older source
// data than what is now in the DB? O(1) — one row each from the watermark + dashboard.
export async function computeStale(sql, patientId) {
  const w = await sql`SELECT watermark FROM patient_source_watermark WHERE patient_id = ${patientId} LIMIT 1`;
  const d = await sql`SELECT built_against_watermark FROM patient_dashboards
                       WHERE patient_id = ${patientId} AND section = 'ai-insights' LIMIT 1`;
  const watermark = w[0]?.watermark || null;
  const builtAgainst = d[0]?.built_against_watermark || null;
  const stale = !!(watermark && builtAgainst && new Date(watermark) > new Date(builtAgainst));
  return { stale, watermark, builtAgainst };
}

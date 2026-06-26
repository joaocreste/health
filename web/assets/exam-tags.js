/* ════════════════════════════════════════════════════════════════════════════
 * Lumen Health — shared exam-type tag vocabulary.
 *
 * Used by the patient upload portal (assets/upload-page.js) to let a patient
 * self-tag what each upload is, and by the admin review queue
 * (assets/uploads-review.js) to surface those tags per upload.
 *
 * The `id` values are the stable contract and are validated server-side
 * (ALLOWED_UPLOAD_TAGS in web/_worker.js) — KEEP THIS LIST IN SYNC with that set
 * and with db/migrations/0021_upload_tags.sql. Labels are bilingual (EN/PT).
 * Order is logical (labs → cardiac → imaging → scopes → genetics → sleep →
 * wearables → lifestyle → other), not alphabetical.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var TAGS = [
    { id: 'blood',          en: 'Blood test',          pt: 'Exame de sangue' },
    { id: 'urine',          en: 'Urine test',          pt: 'Exame de urina' },
    { id: 'ecg',            en: 'ECG / EKG',           pt: 'Eletrocardiograma' },
    { id: 'stress_test',    en: 'Cardiac stress test', pt: 'Teste ergométrico' },
    { id: 'echocardiogram', en: 'Echocardiogram',      pt: 'Ecocardiograma' },
    { id: 'mri',            en: 'MRI',                 pt: 'Ressonância (RM)' },
    { id: 'ct',             en: 'CT scan',             pt: 'Tomografia (TC)' },
    { id: 'xray',           en: 'X-ray',               pt: 'Raio-X' },
    { id: 'ultrasound',     en: 'Ultrasound',          pt: 'Ultrassom' },
    { id: 'endoscopy',      en: 'Endoscopy',           pt: 'Endoscopia' },
    { id: 'colonoscopy',    en: 'Colonoscopy',         pt: 'Colonoscopia' },
    { id: 'genetics',       en: 'Genetic test',        pt: 'Teste genético' },
    { id: 'sleep_study',    en: 'Sleep study',         pt: 'Polissonografia' },
    { id: 'apple_watch',    en: 'Apple Watch vitals',  pt: 'Sinais do Apple Watch' },
    { id: 'oura',           en: 'Oura ring vitals',    pt: 'Sinais do anel Oura' },
    { id: 'withings',       en: 'Withings data',       pt: 'Dados Withings' },
    { id: 'blood_pressure', en: 'Blood pressure',      pt: 'Pressão arterial' },
    { id: 'alcohol',        en: 'Alcohol patterns',    pt: 'Padrões de álcool' },
    { id: 'prescription',   en: 'Prescription / meds', pt: 'Receita / medicamentos' },
    { id: 'other',          en: 'Other',               pt: 'Outro' }
  ];

  var BY_ID = {};
  TAGS.forEach(function (t) { BY_ID[t.id] = t; });

  // Label for a tag id in the given language ('pt' | anything else -> 'en').
  // Falls back to the raw id for unknown tags (forward-compat with new ids).
  function label(id, lang) {
    var t = BY_ID[id];
    if (!t) return id;
    return (lang === 'pt') ? t.pt : t.en;
  }

  window.EXAM_TAGS = TAGS;
  window.EXAM_TAGS_BY_ID = BY_ID;
  window.examTagLabel = label;
})();

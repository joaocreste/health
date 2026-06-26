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

  // Four main categories the upload picker renders under small labelled dividers.
  // Every tag id above belongs to exactly one group; order within a group matches
  // the flat list. Keep coverage total — a tag missing from every group would be
  // unpickable.
  var GROUPS = [
    { id: 'labs',      en: 'Labs & genetics',      pt: 'Laboratório e genética',
      tags: ['blood', 'urine', 'genetics'] },
    { id: 'cardiac',   en: 'Cardiac & vitals',     pt: 'Cardíaco e sinais vitais',
      tags: ['ecg', 'stress_test', 'echocardiogram', 'blood_pressure'] },
    { id: 'imaging',   en: 'Imaging & scopes',     pt: 'Imagem e endoscopia',
      tags: ['mri', 'ct', 'xray', 'ultrasound', 'endoscopy', 'colonoscopy'] },
    { id: 'lifestyle', en: 'Wearables & lifestyle', pt: 'Dispositivos e estilo de vida',
      tags: ['apple_watch', 'oura', 'withings', 'sleep_study', 'alcohol', 'prescription', 'other'] }
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
  window.EXAM_TAG_GROUPS = GROUPS;
  window.examTagLabel = label;
})();

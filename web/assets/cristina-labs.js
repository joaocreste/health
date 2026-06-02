/* Lumen Health — Cristina Cresti lab history
 *
 * First data ingested for this patient: a single thyroid-autoantibody panel
 * from Laboratório Gambarini, collected 11 Mar 2026 (released 13 Mar 2026,
 * printed 16 Mar 2026). Transcribed from the photographed source report in
 * Patients/Cristina Cresti/Gambarini 2026.jpeg — the image lives at
 * web/scans/cristina-source-pdfs/ and is linked from the source-document card.
 *
 * Both antibodies are reported qualitatively as "below the limit of
 * detection" (Inferior a …), so they carry a `value_text` (e.g. "< 0,25")
 * and a null numeric `value` — there is no point plotting a sub-threshold
 * result on a reference bar. Both sit comfortably under their upper
 * reference limits, i.e. NORMAL / non-reactive.
 *
 * Identity note: the lab report prints the patient's full legal name
 * "Maria Cristina Creste Martins Costa" and a birth date of 06/04/1955;
 * the system record is registered as "Cristina Cresti" with DOB 26/03/1956.
 * The discrepancy is surfaced to the maintainer rather than silently
 * reconciled — the registry value is used for the patient block below.
 */
window.CRISTINA_LABS = {
  patient: {
    full_name: 'Cristina Cresti',
    legal_name: 'Maria Cristina Creste Martins Costa',
    dob: '1956-03-26',
    sex: 'female',
    country: 'BR',
    native_language: 'pt',
  },

  /* Source documents, newest first */
  documents: [
    {
      date: '2026-03-11',
      laboratory: 'Laboratório Gambarini · Análises Clínicas',
      doctor: 'Dra. Taciane Torres Lourenço',
      payer: 'Unimed',
      order_no: '004-67640-131',
      pdf: 'cristina-source-pdfs/cristina-gambarini-thyroid-ab-2026-03-11.jpeg',
      title_en: 'Thyroid autoantibodies — Gambarini (11 Mar 2026)',
      title_pt: 'Autoanticorpos tireoidianos — Gambarini (11 mar 2026)',
    },
  ],

  /* No non-lab imaging / pathology / functional studies yet */
  studies: [],

  /* Lab panels → markers → points */
  panels: [
    {
      slug: 'thyroid-autoantibodies',
      title_en: 'Thyroid autoantibodies',
      title_pt: 'Autoanticorpos tireoidianos',
      subtitle_en: 'Chemiluminescence · serum · Gambarini · 11 Mar 2026',
      subtitle_pt: 'Quimioluminescência · soro · Gambarini · 11 mar 2026',
      markers: [
        {
          marker_en: 'Anti-microsomal antibody (anti-TPO)',
          marker_pt: 'Anticorpo anti-microssomal (anti-TPO)',
          unit: 'UI/mL',
          ref_low: null,
          ref_high: 9.00,
          ref_text_en: '< 9.00 UI/mL',
          ref_text_pt: 'Inferior a 9,00 UI/mL',
          points: [
            {
              date: '2026-03-11',
              value: null,
              value_text: '< 0,25',
              flag: null,
              note_en: 'Below the limit of detection — non-reactive (normal). Method: chemiluminescence, serum.',
              note_pt: 'Abaixo do limite de detecção — não reagente (normal). Método: quimioluminescência, soro.',
            },
          ],
        },
        {
          marker_en: 'Anti-thyroglobulin antibody (anti-Tg)',
          marker_pt: 'Anticorpo anti-tireoglobulina (anti-Tg)',
          unit: 'UI/mL',
          ref_low: null,
          ref_high: 4.00,
          ref_text_en: '< 4.00 UI/mL',
          ref_text_pt: 'Inferior a 4,00 UI/mL',
          points: [
            {
              date: '2026-03-11',
              value: null,
              value_text: '< 0,90',
              flag: null,
              note_en: 'Below the limit of detection — non-reactive (normal). Method: chemiluminescence, serum.',
              note_pt: 'Abaixo do limite de detecção — não reagente (normal). Método: quimioluminescência, soro.',
            },
          ],
        },
      ],
    },
  ],
};

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
      date: '2026-06-15',
      laboratory: 'DIAGi · Clínica de Diagnóstico por Imagem · Jaú-SP',
      doctor: 'Dr. Fabiano Turi (CRM 84648)',
      requested_by: 'Dr. Raul Bauab Filho',
      pdf: 'cristina-source-pdfs/cristina-diagi-shoulder-mri-2026-06-15.jpeg',
      title_en: 'Right-shoulder MRI report — DIAGi (15 Jun 2026)',
      title_pt: 'Laudo de RM do ombro direito — DIAGi (15 jun 2026)',
    },
    {
      date: '2026-06-15',
      laboratory: 'DIAGi · Clínica de Diagnóstico por Imagem · Jaú-SP',
      doctor: 'Dr. Fabiano Turi (CRM 84648)',
      requested_by: 'Dr. Raul Bauab Filho',
      pdf: 'cristina-source-pdfs/cristina-diagi-shoulder-xray-2026-06-15.jpeg',
      title_en: 'Both-shoulder X-ray report — DIAGi (15 Jun 2026)',
      title_pt: 'Laudo de raio-X dos ombros — DIAGi (15 jun 2026)',
    },
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

  /* Imaging / pathology / functional studies, newest first.
     A single DIAGi shoulder report (15 Jun 2026) carries two reads on one
     sheet: an MRI of the RIGHT shoulder (the clinically significant exam —
     full-thickness supraspinatus tear) and a plain X-ray of BOTH shoulders.
     Transcribed verbatim (PT) from the photographed report, with an EN
     translation. Source scans live under web/scans/cristina-source-pdfs/. */
  studies: [
    {
      slug: 'shoulder-mri-right-2026-06-15',
      category: 'imaging',
      modality: 'MRI',
      date: '2026-06-15',
      title_en: 'MRI — right shoulder',
      title_pt: 'RM — ombro direito',
      laboratory: 'DIAGi · Diagnóstico por Imagem · Jaú-SP',
      doctor: 'Dr. Fabiano Turi (CRM 84648)',
      requested_by: 'Dr. Raul Bauab Filho',
      images: ['cristina-source-pdfs/cristina-diagi-shoulder-mri-2026-06-15.jpeg'],
      technique_en: 'Fast spin-echo sequences; multiplanar acquisitions, T2- and proton-density-weighted, with and without fat suppression.',
      technique_pt: 'Sequências fast spin-echo; aquisições multiplanares, ponderadas em T2 e densidade de prótons, sem e com supressão de gordura.',
      findings_en: [
        'Acromioclavicular joint with signs of osteoarthritis — capsuloligamentous thickening and marginal osteophytes.',
        'Small glenohumeral joint effusion communicating with the subcoracoid space.',
        'Fluid distension of the subacromial/subdeltoid bursa.',
        'Full-thickness tear of the supraspinatus tendon; the tendon stump shows tendinopathy and is retracted 2 cm from its insertion.',
        'Tendinopathy with diffuse irregularity and thinning of the subscapularis, without evident full-thickness tear.',
        'The remaining rotator-cuff tendons and the long head of the biceps tendon show normal morphology and signal.',
        'Goutallier grade I atrophy of the supraspinatus muscle belly.',
        'No significant atrophy of the other muscle bellies assessed.',
        'Rotator interval without abnormalities.',
        'Degenerative change of the glenoid labrum.',
      ],
      findings_pt: [
        'Articulação acromioclavicular com sinais de artrose, caracterizada por espessamento capsuloligamentar e osteófitos marginais.',
        'Pequeno derrame articular glenoumeral comunicando-se com o espaço subcoracoide.',
        'Distensão líquida da bursa subacromial/subdeltoidea.',
        'Rotura de espessura completa do tendão do supraespinhal, com coto tendíneo apresentando sinais de tendinopatia, retraído a 2 cm da inserção.',
        'Tendinopatia com irregularidade e afilamento difuso do subescapular, sem transfixação evidente.',
        'Demais tendões do manguito rotador e tendão da cabeça longa do bíceps com morfologia e intensidade de sinal normais.',
        'Atrofia grau I de Goutallier do ventre muscular do supraespinhal.',
        'Não há atrofia significativa dos demais ventres musculares avaliados.',
        'Intervalo rotador sem anormalidades.',
        'Alteração degenerativa do lábio glenoidal.',
      ],
      impression_en: [
        'Full-thickness tear of the supraspinatus tendon with 2 cm stump retraction; Goutallier grade I muscle atrophy.',
        'Tendinopathy with diffuse thinning of the subscapularis tendon, without full-thickness tear.',
        'Acromioclavicular osteoarthritis.',
        'Degenerative change of the glenoid labrum.',
        'Glenohumeral joint effusion and subacromial/subdeltoid bursitis.',
      ],
      impression_pt: [
        'Rotura de espessura completa do tendão do supraespinhal, com retração do coto em 2 cm; atrofia muscular grau I de Goutallier.',
        'Tendinopatia com afilamento difuso do tendão subescapular, sem transfixação.',
        'Artrose acromioclavicular.',
        'Alteração degenerativa do lábio glenoidal.',
        'Derrame articular glenoumeral e bursite subacromial/subdeltoidea.',
      ],
      conclusion_en: 'Full-thickness supraspinatus tear, retracted 2 cm, with Goutallier grade I atrophy; subscapularis tendinopathy; AC osteoarthritis; glenohumeral effusion and subacromial/subdeltoid bursitis.',
      conclusion_pt: 'Rotura de espessura completa do supraespinhal, retraída 2 cm, com atrofia grau I de Goutallier; tendinopatia do subescapular; artrose acromioclavicular; derrame glenoumeral e bursite subacromial/subdeltoidea.',
    },
    {
      slug: 'shoulder-xray-both-2026-06-15',
      category: 'imaging',
      modality: 'X-ray',
      date: '2026-06-15',
      title_en: 'X-ray — both shoulders (AP + axial)',
      title_pt: 'Raio-X — ombros direito e esquerdo (AP + axial)',
      laboratory: 'DIAGi · Diagnóstico por Imagem · Jaú-SP',
      doctor: 'Dr. Fabiano Turi (CRM 84648)',
      requested_by: 'Dr. Raul Bauab Filho',
      images: ['cristina-source-pdfs/cristina-diagi-shoulder-xray-2026-06-15.jpeg'],
      findings_en: [
        'Normal bone density.',
        'Signs of mild acromioclavicular arthropathy.',
        'Slight reduction of the glenohumeral joint space.',
        'No focal bone lesions.',
        'Periarticular soft tissues preserved.',
      ],
      findings_pt: [
        'Densidade óssea normal.',
        'Sinais de discreta artropatia acromioclavicular.',
        'Leve redução do espaço articular glenoumeral.',
        'Ausência de lesões ósseas focais.',
        'Partes moles periarticulares preservadas.',
      ],
      conclusion_en: 'Normal bone density; mild AC arthropathy and slight glenohumeral joint-space narrowing; no focal bone lesions.',
      conclusion_pt: 'Densidade óssea normal; discreta artropatia acromioclavicular e leve redução do espaço glenoumeral; sem lesões ósseas focais.',
    },
  ],

  /* Plain-language AI synthesis over the imaging studies — rendered in an
     amber .ai-insight-card with the purple .ai-pill. Patient-facing; not a
     diagnosis. */
  imaging_ai: {
    en: '<p>This MRI of the <strong>right shoulder</strong> shows a <strong>full-thickness tear of the supraspinatus tendon</strong> — the main rotator-cuff tendon used to lift the arm — pulled back about <strong>2 cm</strong> from where it attaches, with early (Goutallier <strong>grade I</strong>) fatty change in its muscle. Grade I is the mildest of the four grades, which generally favours a better result if surgical repair is considered. Alongside it there is wear of the subscapularis tendon (thinned but not torn through), <strong>arthritis of the AC joint</strong>, a small amount of joint fluid, and inflammation of the overlying bursa (bursitis) — a picture typical of a degenerative, age-related cuff tear rather than a single acute injury. The other cuff tendons and the biceps tendon are intact. The plain X-ray of both shoulders agrees: normal bone density, mild AC-joint wear, and slight narrowing of the right joint space, with no fracture or bone lesion.</p>' +
        '<p>In practice, a full-thickness supraspinatus tear with retraction is a structural problem that does not heal on its own. Management ranges from physiotherapy and pain control to surgical repair, and the right choice depends on her symptoms (pain, weakness, loss of overhead reach), activity level, and what an orthopaedic shoulder specialist finds on examination. The mild atrophy grade and the intact remaining tendons are favourable features. A referral to an orthopaedic/shoulder surgeon to discuss options is worthwhile.</p>',
    pt: '<p>Esta ressonância do <strong>ombro direito</strong> mostra uma <strong>rotura de espessura completa do tendão do supraespinhal</strong> — o principal tendão do manguito rotador usado para elevar o braço — retraído cerca de <strong>2 cm</strong> do ponto de inserção, com alteração gordurosa inicial (grau I de Goutallier) no músculo. O grau I é o mais leve dos quatro graus, o que em geral favorece um melhor resultado caso se considere o reparo cirúrgico. Junto a isso há desgaste do tendão subescapular (afilado, mas sem rotura completa), <strong>artrose da articulação acromioclavicular</strong>, pequena quantidade de líquido articular e inflamação da bursa (bursite) — um quadro típico de rotura degenerativa do manguito relacionada à idade, e não de uma lesão aguda única. Os demais tendões do manguito e o tendão do bíceps estão íntegros. O raio-X dos dois ombros concorda: densidade óssea normal, desgaste leve da articulação acromioclavicular e leve redução do espaço articular à direita, sem fratura ou lesão óssea.</p>' +
        '<p>Na prática, uma rotura de espessura completa do supraespinhal com retração é um problema estrutural que não cicatriza sozinho. As condutas variam de fisioterapia e controle da dor até reparo cirúrgico, e a escolha depende dos sintomas (dor, fraqueza, perda da elevação do braço), do nível de atividade e da avaliação de um ortopedista especialista em ombro. O grau leve de atrofia e os demais tendões íntegros são fatores favoráveis. Vale um encaminhamento ao ortopedista de ombro para discutir as opções.</p>',
  },

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

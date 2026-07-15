/* Silvana Creste - InBody120 body-composition data (bespoke vitals).
 * PHI data asset: served only to viewers holding the `vitals` scope on
 * Silvana (GATED_ASSETS in web/_worker.js); injected per-patient by
 * patient-context.js loadPatientDataAssets. renderSilvanaVitals fails
 * closed (renders nothing) when this global is absent (403'd). */
window.SILVANA_INBODY = {
  device: 'InBody120',
  test_id: '191125-1',
  date: '2026-02-11',
  height_cm: 162,
  age: 58,
  sex: 'female',
  nutritionist: 'Nutr. Ricardo Moretto',
  crn: 'CRN-3 63704',
  score: 61, // /100

  // Análise da Composição Corporal — five primary markers w/ ranges
  composition: [
    { marker_en: 'Total Body Water',  marker_pt: 'Água Corporal Total',  value: 29.8, unit: 'L',  ref_low: 28.1, ref_high: 34.3 },
    { marker_en: 'Protein',           marker_pt: 'Proteína',             value: 7.9,  unit: 'kg', ref_low: 7.4,  ref_high: 9.1  },
    { marker_en: 'Minerals',          marker_pt: 'Minerais',             value: 2.99, unit: 'kg', ref_low: 2.60, ref_high: 3.17 },
    { marker_en: 'Body Fat Mass',     marker_pt: 'Massa de Gordura',     value: 29.4, unit: 'kg', ref_low: 11.8, ref_high: 17.6 },
    { marker_en: 'Weight',            marker_pt: 'Peso',                 value: 70.1, unit: 'kg', ref_low: 46.9, ref_high: 63.4 },
  ],

  // Análise Músculo-Gordura — three indicators
  muscle_fat: [
    { marker_en: 'Weight',                       marker_pt: 'Peso',                       value: 70.1, unit: 'kg', ref_low: 46.9, ref_high: 63.4 },
    { marker_en: 'Skeletal Muscle Mass',         marker_pt: 'Massa Muscular Esquelética', value: 22.0, unit: 'kg', ref_low: 17.3, ref_high: 21.1 },
    { marker_en: 'Body Fat Mass',                marker_pt: 'Massa de Gordura',           value: 29.4, unit: 'kg', ref_low: 11.8, ref_high: 17.6 },
  ],

  // Análise de Obesidade — BMI + body-fat %
  obesity: [
    { marker_en: 'BMI',                  marker_pt: 'IMC', value: 26.7, unit: 'kg/m²', ref_low: 18.5, ref_high: 25.0 },
    { marker_en: 'Body Fat Percentage',  marker_pt: 'PGC', value: 41.9, unit: '%',     ref_low: 18.0, ref_high: 28.0 },
  ],

  // Análise da Massa Magra Segmentar (5 limbs)
  lean_segmental: [
    { limb: 'left_arm',  label_pt: 'Braço Esquerdo',  label_en: 'Left arm',  kg: 2.13, pct: 110.7, status: 'normal' },
    { limb: 'right_arm', label_pt: 'Braço Direito',   label_en: 'Right arm', kg: 2.11, pct: 109.8, status: 'normal' },
    { limb: 'trunk',     label_pt: 'Tronco',          label_en: 'Trunk',     kg: 19.2, pct: 91.6,  status: 'normal' },
    { limb: 'left_leg',  label_pt: 'Perna Esquerda',  label_en: 'Left leg',  kg: 5.84, pct: 81.3,  status: 'below' },
    { limb: 'right_leg', label_pt: 'Perna Direita',   label_en: 'Right leg', kg: 5.78, pct: 80.3,  status: 'below' },
  ],

  // Análise da Gordura Segmentar (5 limbs)
  fat_segmental: [
    { limb: 'left_arm',  label_pt: 'Braço Esquerdo',  label_en: 'Left arm',  kg: 2.4,  pct: 254.0, status: 'above' },
    { limb: 'right_arm', label_pt: 'Braço Direito',   label_en: 'Right arm', kg: 2.3,  pct: 253.6, status: 'above' },
    { limb: 'trunk',     label_pt: 'Tronco',          label_en: 'Trunk',     kg: 15.6, pct: 301.5, status: 'above' },
    { limb: 'left_leg',  label_pt: 'Perna Esquerda',  label_en: 'Left leg',  kg: 3.9,  pct: 166.3, status: 'above' },
    { limb: 'right_leg', label_pt: 'Perna Direita',   label_en: 'Right leg', kg: 3.9,  pct: 166.3, status: 'above' },
  ],

  // Histórico da Composição Corporal — most recent two timepoints
  history: [
    { date: '2025-11-18', weight: 69.3, smm: 21.1, pbf: 43.5 },
    { date: '2026-02-11', weight: 70.1, smm: 22.0, pbf: 41.9 },
  ],

  // Misc additional metrics from the printout
  additional: {
    basal_metabolic_rate: { value: 1249, unit: 'kcal', ref_low: 1419, ref_high: 1652 },
    visceral_fat_level:   { value: 13,   unit: null,   ref_low: 1,    ref_high: 9    },
    obesity_degree:       { value: 127,  unit: '%',    ref_low: 90,   ref_high: 110  },
  },
};

/* Narrative copy (PHI: values, findings, DOB) — must live in this gated file,
 * never in the public patient-context.js. Consumed by silvanaVitalsHero /
 * silvanaVitalsAiSummary, which fail closed when these fields are absent. */
(function () {
  var d = window.SILVANA_INBODY;
  function t(en, pt) { return '<span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span>'; }

  d.hero_sub_html = t(
    'Bio-impedance panel on the ' + d.device + ' (11/02/2026) ordered by ' + d.nutritionist + '. Three primary findings: weight above the recommended range (70.1 kg vs. 46.9\u201363.4), body-fat percentage well above the female reference (41.9% vs. 18\u201328%), and a clear lower-body lean-mass deficit \u2014 both legs are below the InBody norm (~81% of expected) while arms and trunk are within range.',
    'Painel de bioimped\u00e2ncia no ' + d.device + ' (11/02/2026) solicitado pelo ' + d.nutritionist + '. Tr\u00eas achados principais: peso acima da faixa recomendada (70,1 kg vs. 46,9\u201363,4), percentual de gordura corporal bem acima da refer\u00eancia feminina (41,9% vs. 18\u201328%), e um d\u00e9ficit claro de massa magra nas pernas \u2014 ambas est\u00e3o abaixo da norma InBody (~81% do esperado) enquanto bra\u00e7os e tronco est\u00e3o dentro da faixa.');

  d.dob_html = '29 ' + t('Sep', 'set') + ' 1967 \u00b7 ' + d.age;

  d.ai_summary_html = (
    '<section class="silv-ai-summary">' +
      '<header class="silv-ai-summary-head">' +
        '<h2>' + t('AI summary · body composition + 7-year lab context',
                   'Resumo da IA · composição corporal + contexto laboratorial') + '</h2>' +
        '<span class="ai-pill">AI</span>' +
      '</header>' +
      '<div class="silv-ai-summary-meta">' +
        t('Synthesised from the 11 Feb 2026 InBody120 panel and 7 years of lab markers (Jun 2019 → Apr 2026)',
          'Sintetizado a partir do painel InBody120 de 11 fev 2026 e 7 anos de exames (jun 2019 → abr 2026)') +
      '</div>' +

      // EN body
      '<div class="silv-ai-summary-body lang-en">' +
        '<p>The body composition panel (weight 70.1 kg, body fat 41.9%, visceral fat level 13, obesity degree 127%) tells the same story the chronic lipid profile has been signalling for years: <strong>central adiposity with a borderline cardiometabolic profile</strong>. Total cholesterol has stayed between 196–233 mg/dL since 2019, triglycerides chronically above 150 mg/dL, non-HDL near 160 mg/dL — all consistent with the fat-mass excess, especially the elevated visceral component. The reassuring counterpoint is preserved glycemic control: HbA1c 5.1% in Apr 2026 (trending down from 5.5%) and HOMA-IR 1.05 in 2022. The lipid drift is still reversible before it spills into insulin resistance, but the window is narrowing.</p>' +
        '<p>The segmental analysis reveals a structurally important finding: <strong>both legs are below the InBody norm (81.3% and 80.3% of expected)</strong> while arms and trunk stay within range. At 58, this is the typical pattern of <strong>incipient sarcopenic obesity</strong> — lower-body lean deficit combined with excess body fat. It is an independent risk factor for declining metabolic function, future frailty and cardiovascular events. Total skeletal muscle mass is still 22.0 kg (upper bound of normal), but the distribution is the issue. Compared with Nov 2025 (21.1 → 22.0 kg in 3 months), there is modest total muscle gain — right direction, insufficient pace to correct the segmental deficit on its own.</p>' +
        '<p>Other markers fit the picture: moderate DAO activity (6.99 U/mL) and the flat 2022 lactose curve suggest that <strong>diet has a functional-tolerance component beyond raw calories</strong> — a protein-consistent, low-histamine/low-lactose pattern would outperform generic caloric restriction. Vitamin D at 61.49 ng/mL (just above the upper risk-group bound) warrants reviewing supplementation. The transiently elevated TSH in Feb 2026 (4.755 µIU/mL) needs a 6–12 week recheck — subclinical hypothyroidism would directly affect body composition and metabolism.</p>' +
      '</div>' +

      // PT body
      '<div class="silv-ai-summary-body lang-pt">' +
        '<p>A composição corporal (peso 70,1 kg, PGC 41,9%, gordura visceral nível 13, grau de obesidade 127%) conta a mesma história que o perfil lipídico crônico vinha sinalizando há anos: <strong>adiposidade central com perfil cardiometabólico borderline</strong>. Colesterol total persistiu entre 196 e 233 mg/dL desde 2019, triglicérides cronicamente acima de 150 mg/dL, não-HDL próximo de 160 mg/dL — todos coerentes com excesso de massa de gordura, especialmente a visceral elevada. O contraponto tranquilizador é o controle glicêmico preservado: HbA1c 5,1% em abr 2026 (em queda de 5,5%) e HOMA-IR 1,05 em 2022. Ainda há margem para reverter o drift lipídico antes que evolua para resistência à insulina, mas a janela está se estreitando.</p>' +
        '<p>A análise segmentar revela um achado estrutural relevante: <strong>ambas as pernas estão abaixo da norma InBody (81,3% e 80,3% do esperado)</strong> enquanto braços e tronco permanecem na faixa normal. Aos 58 anos, este é o padrão típico de <strong>obesidade sarcopênica incipiente</strong> — déficit de massa magra nas pernas combinado com excesso de gordura corporal. É um fator de risco independente para queda de função metabólica, fragilidade futura e eventos cardiovasculares. A massa muscular esquelética total ainda está em 22,0 kg (limite superior da faixa), mas a distribuição é o problema. Comparado a nov 2025 (21,1 → 22,0 kg em 3 meses), há ganho modesto de músculo total — direção correta, ritmo insuficiente para corrigir o déficit segmentar isoladamente.</p>' +
        '<p>Outros marcadores se encaixam no quadro: a atividade da DAO moderada (6,99 U/mL) e a curva de lactose plana de 2022 sugerem que <strong>alimentação tem um componente de tolerância funcional além da quantidade calórica</strong> — um padrão com proteína consistente e baixo em histamina/lactose seria mais eficiente do que restrição calórica genérica. Vitamina D em 61,49 ng/mL (logo acima do limite superior do grupo de risco) sugere revisar a suplementação. O TSH transitoriamente alto em fev 2026 (4,755 µIU/mL) também merece reverificação em 6–12 semanas — hipotireoidismo subclínico afetaria diretamente composição corporal e metabolismo.</p>' +
      '</div>' +

      // Three pillars
      '<div class="silv-insights">' +
        '<div class="silv-insights-heading">' +
          t('Three big insights · one per pillar',
            'Três insights · um por pilar') +
        '</div>' +
        '<div class="silv-insights-grid">' +

          // Physical — specific recommendation
          '<div class="silv-insight silv-insight-physical">' +
            '<div class="silv-insight-eyebrow">' + t('Physical', 'Físico') + '</div>' +
            '<div class="silv-insight-headline">' +
              t('Lower-body strength + clinical pilates',
                'Força nas pernas + pilates clínico') +
            '</div>' +
            '<div class="silv-insight-body">' +
              '<div class="lang-en">' +
                '<p>Resistance training focused on the legs — squat, leg press, lunges, step-ups — 2–3× weekly, progressive, supervised. <strong>Clinical pilates</strong> is a good entry point: joint-friendly, posterior-chain activation, no impact. Add a daily 30+ min walk for cardiovascular base.</p>' +
                '<p>Target: <strong>−5 to −7 kg in 6 months with preservation of total muscle mass</strong>. Track body-fat % and segmental lean distribution, not just weight — the lower-body deficit is the structural target, not the scale.</p>' +
              '</div>' +
              '<div class="lang-pt">' +
                '<p>Treino de força focado nas pernas — agachamento, leg press, avanços, step-up — 2 a 3×/semana, progressivo, supervisionado. <strong>Pilates clínico</strong> é uma boa porta de entrada: respeita as articulações, ativa cadeia posterior, sem impacto. Adicionar caminhada de 30+ min/dia para base cardiovascular.</p>' +
                '<p>Meta: <strong>−5 a −7 kg em 6 meses com preservação da massa muscular total</strong>. Acompanhar PGC e distribuição segmentar da massa magra, não apenas o peso — o déficit nas pernas é o alvo estrutural, não a balança.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Mental — TBD pending therapy
          '<div class="silv-insight silv-insight-mental">' +
            '<div class="silv-insight-eyebrow">' + t('Mental', 'Mental') + '</div>' +
            '<div class="silv-insight-headline">' +
              t('Therapy contact, then reassess in 3 months',
                'Contato com terapeuta e reavaliar em 3 meses') +
            '</div>' +
            '<div class="silv-insight-body">' +
              '<div class="lang-en">' +
                '<p>Body-composition change at 58 needs psychological scaffolding — relationship with food, motivation for the exercise regimen, possible emotional component to the central adiposity. Recommend an evaluation by a therapist experienced with mid-life women\'s health.</p>' +
                '<p>No mental-health data uploaded yet; this insight will sharpen once journal entries, mood logs or a clinical evaluation are added.</p>' +
              '</div>' +
              '<div class="lang-pt">' +
                '<p>Mudança de composição corporal aos 58 anos exige acompanhamento psicológico — relação com alimentação, motivação para o regime de exercícios, possível componente emocional na adiposidade central. Sugerir avaliação por terapeuta com experiência em saúde da mulher na meia-idade.</p>' +
                '<p>Ainda não há dados de saúde mental no histórico; este insight ganhará precisão quando diários, registros de humor ou uma avaliação clínica forem adicionados.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Spiritual — TBD
          '<div class="silv-insight silv-insight-spiritual silv-insight-tbd">' +
            '<div class="silv-insight-eyebrow">' + t('Spiritual', 'Espiritual') + '</div>' +
            '<div class="silv-insight-headline">TBD</div>' +
            '<div class="silv-insight-body">' +
              '<div class="lang-en">' +
                '<p>No spiritual data uploaded yet — wheel-of-life self-assessment, life-event log or similar would unlock this pillar.</p>' +
              '</div>' +
              '<div class="lang-pt">' +
                '<p>Sem dados espirituais ainda — uma autoavaliação de roda da vida, registro de eventos de vida ou similar liberaria este pilar.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +

        '</div>' +
      '</div>' +
    '</section>'
  );
})();

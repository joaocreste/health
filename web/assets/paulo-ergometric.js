/* Paulo Augusto Silotto Dias de Souza — ergometric (exercise stress test) series.
   Source of truth for the bespoke "Cardiac · Ergometric" section rendered by
   renderPauloErgometricSection() in patient-context.js. Mirrors the per-patient
   embedded-data pattern of paulo-labs.js (window.PAULO_LABS).

   Reconciled from 4 scanned ergometric reports, 2011 -> 2023, cross-checked
   against the Lumen triage covers. Canonical copies (PDFs + per-exam JSON +
   _series.json) live in R2 under patients/pending:paulo-silotto-df3441/ergometric/.
   Bump the ?v= query string on the <script> tag whenever this file changes. */
window.PAULO_ERGOMETRIC = {
  schema_version: 'ergometric.series.v1',
  patient: { full_name: 'Paulo Augusto Silotto Dias de Souza', dob: '1961-07-14', sex: 'M' },
  exam_count: 4,
  latest_exam_date: '2023-04-04',

  exams: [
    {
      date: '2011-02-25', dateLabelEn: '25 Feb 2011', dateLabelPt: '25 fev 2011',
      protocol: 'Bruce', ergometer: 'Esteira (treadmill)',
      lab: 'Dr. Paulo Christian Machado · Cardiologia', city: 'Pirassununga, SP',
      performing_doctor: 'Dr. Paulo Christian Machado', crm: 'CRM 94583',
      age: 49, weight_kg: 108.0, bmi: 33.0,
      fc_max_bpm: 169, fc_max_pct_predicted: 98.8, fc_max_predicted_bpm: 171,
      vo2_max: 35.0, met_max: 10.0, pas_max: 210, pas_rest: 130, dp_max: 35490,
      duration_hms: '00:09:08', distance_km: 0.626,
      ischemia: 'negative', test_quality: 'maximal', fitness: 'Regular (AHA)', nyha: 'I',
      meds: ['Diovan HCT'],
      conclusionPt: 'Teste ergométrico eficaz, máximo, de resposta cardiovascular normal frente ao esforço físico realizado.',
      conclusionEn: 'Effective, maximal exercise test with a normal cardiovascular response to the effort performed.',
      bundled: []
    },
    {
      date: '2015-05-12', dateLabelEn: '12 May 2015', dateLabelPt: '12 mai 2015',
      protocol: 'Rampa', ergometer: 'Esteira (treadmill)',
      lab: 'CINCOR · Centro Integrado do Coração', city: 'Americana, SP',
      performing_doctor: 'Dr. Felipe B. Toledo', crm: 'CRM 135.880',
      age: 53, weight_kg: 113.0, bmi: 33.7,
      fc_max_bpm: 169, fc_max_pct_predicted: 101.2, fc_max_predicted_bpm: 167,
      vo2_max: 35.63, met_max: 10.58, pas_max: 200, pas_rest: 130, dp_max: 33800,
      duration_hms: '00:08:29', distance_km: 0.84,
      ischemia: 'negative', test_quality: 'maximal', fitness: 'Boa (AHA)', nyha: 'I',
      meds: ['Diovan Triplo'],
      conclusionPt: 'Teste negativo para segmento ST. Prova supramáxima, assintomática, interrompida por exaustão física; comportamento fisiológico da PA e da FC.',
      conclusionEn: 'Negative for the ST segment. Supramaximal, asymptomatic test stopped by physical exhaustion; physiological BP and HR behaviour.',
      bundled: [
        { labelEn: 'Echocardiogram', labelPt: 'Ecocardiograma',
          textEn: 'Normal echocardiographic study. Normal chamber dimensions and myocardial thickness, normal LV systolic function (EF 72%, Teicholz), no segmental wall-motion abnormality.',
          textPt: 'Estudo ecocardiográfico normal. Câmaras e espessura miocárdica normais, função sistólica do VE normal (FE 72%, Teicholz), sem alteração segmentar da contratilidade.' },
        { labelEn: 'Carotid & vertebral doppler', labelPt: 'Doppler de carótidas e vertebrais',
          textEn: 'Discrete bilateral parietal atheromatosis (shallow atheroma plaque on the right bulb), normal calibre and flows, no stenosis described.',
          textPt: 'Ateromatose parietal discreta bilateral (placa de ateroma rasa no bulbo direito), calibre e fluxos normais, sem estenose descrita.' }
      ]
    },
    {
      date: '2017-03-31', dateLabelEn: '31 Mar 2017', dateLabelPt: '31 mar 2017',
      protocol: 'Rampa', ergometer: 'Esteira (treadmill)',
      lab: 'Fernando J. Vallada Roselino · consultório', city: 'Ribeirão Preto, SP',
      performing_doctor: 'Dr. Fernando Jorge Vallada Roselino', crm: 'CRM 49.840',
      age: 55, weight_kg: 110.0, bmi: 33.2,
      fc_max_bpm: 147, fc_max_pct_predicted: 89.1, fc_max_predicted_bpm: 165,
      vo2_max: 34.83, met_max: 9.95, pas_max: 180, pas_rest: 130, dp_max: 26460,
      duration_hms: '00:08:25', distance_km: 0.71,
      ischemia: 'negative', test_quality: 'maximal', fitness: 'Boa (AHA)', nyha: 'I',
      meds: ['Exforge HCT 160/12.5 + 5mg'],
      conclusionPt: 'Teste ergométrico eficaz, sem resposta isquêmica do miocárdio por critérios clínicos e eletrocardiográficos, até a FC atingida (92% da FC máxima). Aptidão cardiorrespiratória boa (AHA), 9.95 MET.',
      conclusionEn: 'Effective test, no myocardial ischaemic response by clinical and ECG criteria up to the HR reached (92% of max HR). Good cardiorespiratory fitness (AHA), 9.95 MET.',
      bundled: []
    },
    {
      date: '2023-04-04', dateLabelEn: '4 Apr 2023', dateLabelPt: '4 abr 2023',
      protocol: 'Ellestad', ergometer: 'Esteira (treadmill)',
      lab: null, city: null,
      performing_doctor: 'Dr. Mauricio de Almeida Ferreira', crm: null,
      age: 61, weight_kg: 107.0, bmi: 31.95,
      fc_max_bpm: 160, fc_max_pct_predicted: 100.6, fc_max_predicted_bpm: 159,
      vo2_max: 41.76, met_max: 11.93, pas_max: 180, pas_rest: 120, dp_max: 25600,
      duration_hms: '00:07:38', distance_km: 0.595,
      ischemia: 'negative', test_quality: 'maximal', fitness: 'Boa (AHA)', nyha: 'I',
      meds: ['Exforge', 'Ozempic'],
      conclusionPt: 'Teste de resposta normal ao esforço. Sem modificações significativas do segmento ST; ritmo sinusal.',
      conclusionEn: 'Normal response to exercise. No significant ST-segment changes; sinus rhythm.',
      bundled: []
    }
  ],

  comparison: {
    exam_dates: ['2011-02-25', '2015-05-12', '2017-03-31', '2023-04-04'],
    metrics: [
      { key: 'vo2_max_ml_kg_min', labelEn: 'VO₂ max', labelPt: 'VO₂ máx', unit: 'ml/kg/min', protocol_sensitive: true, values: [35.0, 35.63, 34.83, 41.76] },
      { key: 'met_max', labelEn: 'METs max', labelPt: 'METs máx', unit: '', protocol_sensitive: true, values: [10.0, 10.58, 9.95, 11.93] },
      { key: 'fc_max_bpm', labelEn: 'Peak HR', labelPt: 'FC máx atingida', unit: 'bpm', protocol_sensitive: false, values: [169, 169, 147, 160] },
      { key: 'fc_max_pct_predicted', labelEn: 'Peak HR (% predicted)', labelPt: 'FC máx (% previsto)', unit: '%', protocol_sensitive: false, values: [98.8, 101.2, 89.1, 100.6] },
      { key: 'pas_max_mmhg', labelEn: 'Peak SBP', labelPt: 'PAS máx (pico)', unit: 'mmHg', protocol_sensitive: false, values: [210, 200, 180, 180] },
      { key: 'pas_rest_mmhg', labelEn: 'Resting SBP', labelPt: 'PAS repouso', unit: 'mmHg', protocol_sensitive: false, values: [130, 130, 130, 120] },
      { key: 'dp_max', labelEn: 'Peak rate-pressure product', labelPt: 'Duplo produto máx', unit: 'bpm·mmHg', protocol_sensitive: false, values: [35490, 33800, 26460, 25600] },
      { key: 'hr_recovery_1min_bpm', labelEn: 'HR recovery 1 min', labelPt: 'Recuperação FC 1 min', unit: 'bpm', protocol_sensitive: false, values: [14, 25, 24, 24] },
      { key: 'duration_s', labelEn: 'Test duration', labelPt: 'Duração da prova', unit: 's', protocol_sensitive: true, values: [548, 509, 505, 458] },
      { key: 'weight_kg', labelEn: 'Weight', labelPt: 'Peso', unit: 'kg', protocol_sensitive: false, values: [108.0, 113.0, 110.0, 107.0] },
      { key: 'bmi', labelEn: 'BMI', labelPt: 'IMC', unit: 'kg/m²', protocol_sensitive: false, values: [33.0, 33.7, 33.2, 31.95] }
    ]
  },

  ai_card: {
    headlineEn: 'Four exercise stress tests over 12 years (2011–2023), all negative for ischaemia',
    headlinePt: 'Quatro testes ergométricos em 12 anos (2011–2023), todos negativos para isquemia',
    summaryEn: 'Series of four stress tests between ages 49 and 61. In all four — Bruce (2011), Rampa (2015 and 2017) and Ellestad (2023) — the ST-segment response was negative and the test judged effective / maximal, with no symptoms of coronary insufficiency. The most consistent finding of the series is exactly that stability: no test showed an ischaemic response. Functional capacity stayed good (METs ≈ 10–12; VO₂ ≈ 35–42 ml/kg/min), with the caveat that the 2023 test used the Ellestad protocol, which tends to estimate higher VO₂/METs than the Bruce/Rampa of the earlier tests. Peak SBP fell from 210 mmHg (2011) to 180 mmHg (2017 and 2023), tracking the intensification of antihypertensive therapy, and weight dropped from 113 kg (2015) to 107 kg (2023), with Ozempic introduced by the last test.',
    summaryPt: 'Série de quatro provas de esforço entre os 49 e os 61 anos. Em todas as quatro — Bruce (2011), Rampa (2015 e 2017) e Ellestad (2023) — a resposta do segmento ST foi negativa e o teste considerado eficaz / máximo, sem sintomatologia de insuficiência coronariana. O achado mais consistente da série é justamente essa estabilidade: nenhuma prova demonstrou resposta isquêmica. A capacidade funcional manteve-se boa (METs ≈ 10–12; VO₂ ≈ 35–42 ml/kg/min), com a ressalva de que a prova de 2023 usou protocolo Ellestad, que tende a estimar VO₂/METs mais altos que o Bruce/Rampa das provas anteriores. A PAS de pico caiu de 210 mmHg (2011) para 180 mmHg (2017 e 2023), acompanhando a intensificação do tratamento anti-hipertensivo, e o peso recuou de 113 kg (2015) para 107 kg (2023), com Ozempic introduzido até a última prova.',
    trends: [
      { en: 'ST (ischaemic) response — negative in all four tests (2011, 2015, 2017, 2023). Stability is the dominant finding of the series.', pt: 'Resposta isquêmica (ST) — negativa nas quatro provas (2011, 2015, 2017, 2023). A estabilidade é o achado dominante da série.' },
      { en: 'Functional capacity (VO₂/METs) — stable ~35 ml/kg/min and ~10 METs on the Bruce/Rampa tests (2011–2017); 41.76 ml/kg/min and 11.93 METs in 2023, but on the Ellestad protocol — the apparent gain should be read cautiously given protocol heterogeneity.', pt: 'Capacidade funcional (VO₂/METs) — estável ~35 ml/kg/min e ~10 METs nas provas Bruce/Rampa (2011–2017); 41,76 ml/kg/min e 11,93 METs em 2023, mas em protocolo Ellestad — o ganho aparente deve ser lido com cautela pela heterogeneidade de protocolo.' },
      { en: 'Peak HR & % predicted — peak 169 bpm (2011 and 2015) and 160 bpm (2023), ≈100% of predicted; in 2017 the peak was 147 bpm (89% of predicted), the lowest of the series though still above the submaximal target.', pt: 'FC máx e % do previsto — pico 169 bpm (2011 e 2015) e 160 bpm (2023), ≈100% do previsto; em 2017 o pico foi 147 bpm (89% do previsto), o mais baixo da série embora ainda acima da FC submáxima-alvo.' },
      { en: 'Peak SBP — 210 → 200 → 180 → 180 mmHg; resting SBP from 130 to 120 mmHg at the last test.', pt: 'PAS de pico — 210 → 200 → 180 → 180 mmHg; PAS de repouso de 130 para 120 mmHg na última prova.' },
      { en: 'Weight / BMI — weight 108→113→110→107 kg; BMI from ~33 to 31.95 kg/m² in 2023, still in the obesity range.', pt: 'Peso / IMC — peso 108→113→110→107 kg; IMC de ~33 para 31,95 kg/m² em 2023, ainda na faixa de obesidade.' }
    ],
    watch: [
      { en: 'Peak SBP at the two most recent tests (180 mmHg) lower than at the first in 2011 (210 mmHg), in a hypertensive patient on triple therapy (Exforge).', pt: 'PAS de pico nas duas provas mais recentes (180 mmHg) menor que na prova inicial de 2011 (210 mmHg), em paciente hipertenso sob tripla terapia (Exforge).' },
      { en: 'In 2017 the peak HR reached 89% of predicted, below the ~100% of the adjacent tests — to be weighed against that day’s effort / medication.', pt: 'Em 2017 a FC de pico atingiu 89% do previsto, abaixo dos ~100% das provas adjacentes — a ponderar com o esforço / medicação do dia.' },
      { en: 'Highest VO₂/METs of the series in 2023 coincide with the protocol change to Ellestad.', pt: 'VO₂/METs mais altos da série em 2023 coincidem com a mudança de protocolo para Ellestad.' },
      { en: '2015 carotid doppler (bundled exam) described discrete bilateral parietal atheromatosis — a one-off vascular correlate, no stenosis described.', pt: 'Doppler de carótidas de 2015 (exame agrupado) descreveu ateromatose parietal discreta bilateral — correlato vascular pontual, sem estenose descrita.' }
    ],
    notes: [
      { en: 'Heterogeneous protocols across the series (Bruce 2011; Rampa 2015 and 2017; Ellestad 2023): VO₂/METs/duration comparisons are indicative only.', pt: 'Protocolos heterogêneos ao longo da série (Bruce 2011; Rampa 2015 e 2017; Ellestad 2023): comparações de VO₂/METs/duração são apenas indicativas.' },
      { en: '1-minute HR recovery: 2015/2017/2023 derived from recovery rows; 2011 from the report’s printed 1-minute delta — methods not identical.', pt: 'Recuperação de FC ao 1º minuto: 2015/2017/2023 derivadas das linhas de recuperação; 2011 a partir do delta de 1 minuto impresso no laudo — métodos não idênticos.' },
      { en: '2011 triage cover (168 bpm / 98% predicted) disagreed with the report body (169 bpm / 99% predicted); the report was used.', pt: 'Capa de triagem de 2011 (168 bpm / 98% previsto) divergiu do corpo do laudo (169 bpm / 99% previsto); usou-se o laudo.' },
      { en: '2023 distance reported in miles (0.37 mi), converted to km (0.595).', pt: 'Distância de 2023 informada em milhas (0,37 mi) e convertida para km (0,595).' }
    ],
    disclaimerEn: 'AI-generated descriptive analysis of prior reports — not a diagnosis or recommendation. Estimated metrics (VO₂, METs) vary by protocol and effort. Findings must be correlated clinically by the treating cardiologist.',
    disclaimerPt: 'Análise descritiva gerada por IA de laudos anteriores — não constitui diagnóstico nem recomendação. Métricas estimadas (VO₂, METs) variam conforme o protocolo e o esforço. Os achados devem ser correlacionados clinicamente pelo cardiologista assistente.'
  }
};

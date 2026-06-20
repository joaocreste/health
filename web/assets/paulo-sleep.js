/* Paulo Augusto Silotto Dias de Souza — sleep-medicine studies (bespoke).
 *
 * Two exams, both sourced verbatim from the ORIGINAL physician reports (never
 * the Lumen triage cover), ingested into Neon by scripts/ingest-paulo-sleep.mjs:
 *   - PSG  2017-05-05 (INCEF, Dr. João Espir Filho)  -> sleep_studies
 *   - DISE 2019-09-26 (Dr. Fábio Rabelo)             -> imaging_studies
 *
 * This file is the FRONT-END view-model only (read by renderPauloSleepSection()
 * in patient-context.js). The DB rows are the queryable / AI-insight mirror.
 * Verbatim Portuguese narrative is preserved untranslated for the transcript
 * panels. Report PDFs are gated under /scans/paulo-* (SCAN_OWNERS wildcard).
 */
window.PAULO_SLEEP = {
  psg: {
    date: '2017-05-05',
    dateLabelEn: '5 May 2017',
    dateLabelPt: '5 mai 2017',
    lab: 'INCEF — Instituto de Neurologia, Neurofisiologia Clínica e Medicina do Sono',
    city: 'Ribeirão Preto, SP',
    performing_doctor: 'Dr. João Espir Filho · CRM-SP 54557',
    requesting_doctor: null,

    // AHI severity readout (normal <5 / mild 5-15 / moderate 15-30 / severe 30+)
    ahi: 7.64,
    ahi_obstructive: 5.96,
    ahi_hypopnea: 1.68,
    severity: 'mild',          // -> band class
    severityEn: 'Mild obstructive sleep apnoea',
    severityPt: 'Apneia obstrutiva do sono de grau leve',

    events: { total: 50, obstructive: 31, central: 8, mixed: 0, hypopnea: 11 },
    rera: 0,
    max_event_s: 26.83,

    // key metrics (chips)
    efficiency: 85.98,
    tst_min: 392.5,
    waso_min: 26,
    wake_min: 63,
    nrem_latency: 28.5,
    rem_latency: 94.5,
    arousal_index: 4.89,
    awakenings: 9,
    micro_arousals: 23,
    snore_index: 70.47,
    snore_count: 461,
    spo2_baseline: 90,
    spo2_mean: 94.64,
    spo2_max: 99,
    spo2_nadir: 81,
    time_below_90_min: 9.94,
    time_below_90_pct: 2.53,
    desaturations: 245,
    odi: null,                 // not stated as an index in the report

    stages: { n1: 49.55, n2: 32.61, n34: 3.18, rem: 14.65 },
    stagingNoteEn: 'R&K staging — “estágios 3 e 4” (3.18%) maps to AASM N3.',
    stagingNotePt: 'Estadiamento R&K — “estágios 3 e 4” (3,18%) corresponde a N3 (AASM).',

    aiEn: 'A <strong>mild obstructive sleep apnoea</strong> (AHI 7.64/h; 31 obstructive events, 8 central, 11 hypopnoeas over the night). Sleep efficiency is preserved at 85.98% and the oxygen profile stays gentle — nadir 81%, only 9.94 min (2.53%) below 90% — so the night is not deeply hypoxaemic. The clinically louder signals are <strong>heavy snoring</strong> (index 70.47/h, 461 snores) and a <strong>fragmented architecture</strong>: very little deep and REM sleep (N3 3.18%, REM 14.65%), long REM latency (94.5 min) and 9 awakenings plus 23 micro-arousals. The report states no ODI as an index, so none is recorded here. Read together: an early, snoring-dominant, lightly-desaturating OSA — the kind that responds well to positional / weight / airway measures, and the natural baseline against which the 2019 sleep endoscopy was done.',
    aiPt: 'Uma <strong>apneia obstrutiva do sono de grau leve</strong> (IAH 7,64/h; 31 eventos obstrutivos, 8 centrais, 11 hipopneias na noite). A eficiência do sono está preservada (85,98%) e o perfil de oxigenação é suave — mínima de 81%, apenas 9,94 min (2,53%) abaixo de 90% — sem hipoxemia importante. Os sinais clinicamente mais relevantes são o <strong>ronco intenso</strong> (índice 70,47/h, 461 roncos) e uma <strong>arquitetura fragmentada</strong>: pouco sono profundo e REM (N3 3,18%, REM 14,65%), latência REM longa (94,5 min) e 9 despertares com 23 micro-despertares. O laudo não registra IDO como índice, portanto nenhum é anotado aqui. Em conjunto: uma AOS inicial, dominada por ronco e com dessaturação leve — que costuma responder bem a medidas posturais / de peso / de via aérea, e a base natural contra a qual a sonoendoscopia de 2019 foi realizada.',

    reportHref: 'scans/paulo-sleep-psg-2017-05-05-report.pdf',
    verbatim: {
      comentarios: 'Polissonografia de noite inteira realizada em boas condições técnicas, tendo início às 22:25 horas e término às 6:01 horas, com latência para o sono não-REM de 28,5 minutos e para o sono REM de 94,5 minutos. O tempo total de sono foi 392,5 minutos, com eficiência de 85,98%. A distribuição do sono mostrou 49,55% de estágio 1, 32,61% de estágio 2, 3,18% de estágios 3 e 4 e 14,65% de sono REM. No período total de registro permaneceu 63 minutos em estágio 0 (vigília). Despertares (9), micro-despertares (23) e RERAs (0) fragmentaram o sono com índice de 4,89/hora. O tempo total acordado após o início do sono foi de 26 minutos. O índice de apnéia/hipopnéia foi 7,64/hora, sendo 5,96 apnéia/hora e 1,68 hipopnéia/hora. O número de eventos ventilatórios foi 50, sendo 31 obstrutivos, 8 centrais, 0 mistos e 11 hipopnéia. O índice de transtorno ventilatório (ITV = índice de apnéia + hipopnéia + rera) foi de 7,64/hora e o número de Reras foi 0. A duração máxima de apnéias e hipopnéias foi de 26,83 segundos. Roncos foram registrados 461 vezes, sendo 281 inspiratórios, 149 expiratórios e 31 mistos (insp+exp). O índice de roncos foi 70,47/hora. A saturação basal da oxihemoglobina foi de 90%, sendo a saturação média de 94,64%, a maior de 99% e a mínima de 81%, permanecendo 2,53% do tempo de registro com a saturação abaixo de 90%. Ao longo do exame ficou 9,94 minutos com SATO2% abaixo de 90. Ocorreram 245 dessaturações da oxihemoglobina.',
      conclusao: 'Polissonografia de noite inteira caracterizada por:\n- Eficiência do sono preservada 85,98% (normal acima de 85%).\n- Aumento para a latência do sono N-REM e latência normal para o sono REM.\n- Continuidade comprometida (sono fragmentado) devido ao elevado índice de despertar.\n- O exame polissonográfico registrou IAH leve 7,64/h.\n- Registro de roncos com índice de 70,47/h.\n- Dessaturação da oxihemoglobina com saturação mínima de 81%.\n- Dados consistentes com a síndrome da apnéia do sono de natureza obstrutiva e de grau leve.'
    }
  },

  dise: {
    date: '2019-09-26',
    dateLabelEn: '26 Sep 2019',
    dateLabelPt: '26 set 2019',
    requesting_doctor: 'Dr. Fabio Augusto Winckler Rabelo',
    performing_doctor: 'Dr. Fábio Rabelo',
    attendance: '6147493',
    route_en: 'Flexible transnasal endoscope',
    route_pt: 'Endoscópio flexível por via nasal',
    sedation: { agent: 'Propofol (TCI)', conc: '3.5 mcg/ml', bis: '55–70', topical_en: 'no topical anaesthetic', topical_pt: 'sem anestésico tópico' },

    // VOTE airway readout: degree 0 none / 1 partial / 2 complete
    vote: [
      { letter: 'V', site_en: 'Velum',       site_pt: 'Véu palatino', degree: 2, config: 'CC', label_en: 'Complete · concentric',        label_pt: 'Completa · concêntrica' },
      { letter: 'O', site_en: 'Oropharynx',  site_pt: 'Orofaringe',   degree: 2, config: 'LL', label_en: 'Complete · lateral walls',     label_pt: 'Completa · laterolateral' },
      { letter: 'T', site_en: 'Tongue base', site_pt: 'Base da língua', degree: 2, config: 'AP', label_en: 'Complete · antero-posterior', label_pt: 'Completa · anteroposterior' },
      { letter: 'E', site_en: 'Epiglottis',  site_pt: 'Epiglote',     degree: 0, config: null, label_en: 'No obstruction',              label_pt: 'Sem obstrução' }
    ],
    voteRef: 'Kezirian EJ, Eur Arch Otorhinolaryngol 2011 — VOTE classification',

    maneuvers: [
      { en: 'Left lateral decubitus', pt: 'Decúbito lateral esquerdo', resultEn: 'No improvement in the obstructive pattern', resultPt: 'Sem melhora do padrão obstrutivo', good: false },
      { en: 'Mandibular advancement 5 mm', pt: 'Avanço mandibular 5 mm', resultEn: 'Improved hypopharyngeal obstruction, partial at the velopalate', resultPt: 'Melhora da obstrução em hipofaringe e parcial em região velopalatal', good: true }
    ],

    aiEn: 'Drug-induced sleep endoscopy shows <strong>complete (grade 2) collapse at three levels</strong> — velum (concentric), oropharyngeal lateral walls, and tongue base (antero-posterior) — with a <strong>normal epiglottis</strong>. This is a multilevel, predominantly retropalatal/retrolingual pattern. Two findings steer management: the velum collapses <em>concentrically</em>, the configuration classically associated with a poorer response to hypoglossal-nerve stimulation; and a 5 mm <strong>mandibular advancement improved the hypopharynx</strong> (partial at the velopalate), which supports a trial of a mandibular-advancement device and is consistent with the snoring-dominant mild OSA seen on the 2017 polysomnogram. Positional change alone (lateral decubitus) did not help.',
    aiPt: 'A sonoendoscopia mostra <strong>colapso completo (grau 2) em três níveis</strong> — véu palatino (concêntrico), paredes laterais da orofaringe e base da língua (anteroposterior) — com <strong>epiglote normal</strong>. É um padrão multinível, predominantemente retropalatal/retrolingual. Dois achados orientam a conduta: o véu colapsa de forma <em>concêntrica</em>, configuração classicamente associada a pior resposta à estimulação do nervo hipoglosso; e o <strong>avanço mandibular de 5 mm melhorou a hipofaringe</strong> (parcial no véu), o que apoia um teste com aparelho de avanço mandibular e é coerente com a AOS leve dominada por ronco vista na polissonografia de 2017. A mudança postural isolada (decúbito lateral) não trouxe melhora.',

    reportHref: 'scans/paulo-dise-2019-09-26-report.pdf',
    verbatim: {
      procedimento: 'Realizado exame com endoscópio flexível, por via nasal, para avaliação dinâmica da via aérea superior em situação de sono induzido com propofol (bomba de infusão alvo controlada), sem utilização de anestésico tópico.\nOs parâmetros da sedação durante o exame foram: concentração efetiva estimada de propofol de 3,5 mcg/ml e BIS mantido com valor entre 55-70.\nOs achados seguem descritos abaixo:',
      descricao_sumaria: 'Observado respiração predominante nasal, com vedamento lingual em palato.\nRegião nasal com desvio caudal à esquerda, cornetos inferiores hipertroficos, cavum livre.\nDurante o exame, apresentou diminuição do calibre de via aérea predominante em regiões: velopalatal concêntrica 100%, faríngea laterolateral 100% (com extensão até terço inferior de faringe), retrolingual 100% anteroposterior (base de língua com hipertrofia moderada).',
      manobras: '- realizado mudança de decúbito para lateral esquerdo sem melhora do padrão obstrutivo\n- realizado avanço mandibular com melhora da obstrução em hipofaringe e parcial em região velopalatal (avanço de 5mm – próximo ao máximo tolerado)',
      vote: 'Classificação VOTE (Kezirian EJ. Eur Arch Otorhinolaryngol. 2011 — Drug-induced sleep endoscopy: the VOTE classification):\nV (velopharynx) – 2CC\nO (oropharynx) – 2LL\nT (Tongue) – 2AP\nE (Epiglottis) – 0'
    }
  }
};

/* ── Lumen Health · Section Registry ─────────────────────────────────────
   Layout as data (FRONTEND-CONTRACT.md §2, Registry v1). The page assembler
   (assets/page-assembler.js) iterates these entries IN `order` and renders
   each section only when its gate passes against the fetched payloads.
   A failing gate emits NOTHING — no heading, no 0-count grid (I-5).

   Entry shape:
     { id, order, title:{en,pt},
       gate:{ fn:'G-DASH'|'G-DOMAIN'|'G-ARR'|'G-NUM'|'PATIENT', args:[...] },
       provider:'<name in window.LUMEN_PROVIDERS>',
       badge:bool,             // block is interpretive → carries the AI pill
       summary:bool,           // slot-2 concise AI summary (not a topic section;
                               // excluded from the empty-state count)
       patientScope:'<clerk>'  // renders only for that patient (gate PATIENT)
     }

   Gate predicates (payload facts per contract §2):
     G-DASH        dashboard.sections['ai-insights'] key exists
     G-DOMAIN(d)   G-DASH && cards_json.pages[d].data_sufficient === true
     G-ARR(paths…) any dotted path resolves to an array with length > 0
     G-NUM(path)   value non-null and > 0 ('*' segment = any key matches)
     PATIENT       active patient === entry.patientScope

   Sections whose backing data is not yet queryable client-side (connected
   sources, clinical history encounters, gut microbiota, alcohol audit, PGx
   arrays, spiritual topic arrays — D6 / build prompt #3 territory) are listed
   with gates on payload paths that are absent today, so they fail closed and
   render nothing until the data exists. That keeps Registry v1's shape while
   never fabricating a section.                                              */
(function () {
  'use strict';

  var PAULO    = 'pending:paulo-silotto-df3441';
  var SILVANA  = 'pending:silvana-creste-18ba19';
  var CRISTINA = 'pending:cristina-cresti-d7479c';

  /* Per-page chrome metadata consumed by the assembler: the unified page
     banner (pillar crumb / title / description — prompt #2b canonical copy),
     the AI-insights domain backing G-DOMAIN on that page, and (spiritual) the
     registry-driven pastoral footnote line that replaces its bespoke footer.
     Subpage pillar strings carry the middot; the banner renderer splits on it
     and wraps each separator in a gold .crumb-sep span. */
  window.LUMEN_PAGE_META = {
    'home': {
      domain: null,
      pillar: { en: 'SUMMARY', pt: 'SUMÁRIO' },
      title: { en: 'Health Summary', pt: 'Resumo de Saúde' },
      description: { en: 'From scattered data to a clinical picture.', pt: 'De dados dispersos a um quadro clínico.' },
    },
    'physical': {
      domain: 'physical',
      pillar: { en: 'PHYSICAL', pt: 'FÍSICO' },
      title: { en: 'Physical Health Overview', pt: 'Visão Geral da Saúde Física' },
      description: { en: 'Body systems, clinical history and physician assessments.', pt: 'Sistemas do corpo, histórico clínico e avaliações médicas.' },
    },
    'physical-vitals': {
      domain: 'physical',
      pillar: { en: 'PHYSICAL · VITALS', pt: 'FÍSICO · VITAIS' },
      title: { en: 'Vitals', pt: 'Vitais' },
      description: { en: 'Continuous signals from wearables and devices — heart, sleep, movement, glucose.', pt: 'Sinais contínuos de wearables e dispositivos — coração, sono, movimento, glicose.' },
    },
    'physical-exams': {
      domain: 'physical',
      pillar: { en: 'PHYSICAL · EXAMS', pt: 'FÍSICO · EXAMES' },
      title: { en: 'Exams', pt: 'Exames' },
      description: { en: 'Imaging studies and laboratory panels, read across time.', pt: 'Exames de imagem e painéis laboratoriais, lidos ao longo do tempo.' },
    },
    'physical-genetics': {
      domain: 'physical',
      pillar: { en: 'PHYSICAL · GENETICS', pt: 'FÍSICO · GENÉTICA' },
      title: { en: 'Genetics', pt: 'Genética' },
      description: { en: 'Pharmacogenomics — how your genes shape medication response.', pt: 'Farmacogenômica — como seus genes moldam a resposta a medicamentos.' },
    },
    'mental': {
      domain: 'mental',
      pillar: { en: 'MENTAL', pt: 'MENTAL' },
      title: { en: 'Mental Health Overview', pt: 'Visão Geral da Saúde Mental' },
      description: { en: 'Psychological architecture, therapy trends and life history.', pt: 'Arquitetura psicológica, tendências terapêuticas e história de vida.' },
    },
    'spiritual': {
      domain: 'spiritual',
      pillar: { en: 'SPIRITUAL', pt: 'ESPIRITUAL' },
      title: { en: 'Spiritual Health Overview', pt: 'Visão Geral da Saúde Espiritual' },
      description: { en: 'Faith practice, values and meaning — the third pillar.', pt: 'Prática de fé, valores e significado — o terceiro pilar.' },
      footnote: {
        en: 'For pastoral and clinical communication only · Does not replace spiritual direction or licensed medical advice.',
        pt: 'Apenas para comunicação pastoral e clínica · Não substitui direção espiritual nem aconselhamento médico licenciado.',
      },
    },
  };

  window.LUMEN_REGISTRY = {

    'home': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'aiSummary', badge: true, summary: true },
      { id: 'reports-nav', order: 20, title: { en: 'Reports', pt: 'Relatórios' },
        gate: { fn: 'G-NUM', args: ['summary.pillars.*.total'] }, provider: 'homeReportsNav', badge: false },
      { id: 'at-a-glance', order: 30, title: { en: 'At a glance', pt: 'Resumo rápido' },
        gate: { fn: 'G-NUM', args: ['summary.pillars.*.total'] }, provider: 'homeAtAGlance', badge: false },
      { id: 'active-priorities', order: 40, title: { en: 'Active clinical priorities', pt: 'Prioridades clínicas ativas' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'homeActivePriorities', badge: true },
      { id: 'injuries-surgeries', order: 50, title: { en: 'Injury & surgical history', pt: 'Histórico de lesões e cirurgias' },
        gate: { fn: 'G-ARR', args: ['summary.procedures'] }, provider: 'homeInjuries', badge: false },
      { id: 'connected-sources', order: 60, title: { en: 'Connected sources', pt: 'Fontes conectadas' },
        gate: { fn: 'G-ARR', args: ['summary.sources'] }, provider: 'homeConnectedSources', badge: false }, // D6: no DB source yet → closed
      { id: 'medications', order: 70, title: { en: 'Medications & Supplements', pt: 'Medicações e Suplementos' },
        gate: { fn: 'G-ARR', args: ['summary.medications', 'summary.supplements'] }, provider: 'homeMedications', badge: false },
      { id: 'health-synthesis', order: 80, title: { en: 'Health synthesis', pt: 'Síntese de saúde' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'homeHealthSynthesis', badge: true },
      { id: 'paulo-painmap', order: 90, title: { en: 'AI pain map', pt: 'Mapa de dor · IA' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: PAULO, provider: 'pauloPainMap', badge: true },
    ],

    'physical': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DOMAIN', args: ['physical'] }, provider: 'aiSummary', badge: true, summary: true },
      { id: 'silvana-landing', order: 15, title: { en: 'Physical health', pt: 'Saúde física' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: SILVANA, provider: 'silvanaLanding', badge: false },
      { id: 'cristina-exams', order: 16, title: { en: 'Exams', pt: 'Exames' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: CRISTINA, provider: 'cristinaExams', badge: false },
      { id: 'browse-cards', order: 20, title: { en: 'Browse', pt: 'Navegar' },
        gate: { fn: 'G-NUM', args: ['summary.pillars.physical.total'] }, provider: 'physBrowseCards', badge: false },
      { id: 'clinical-history', order: 30, title: { en: 'Clinical history', pt: 'Histórico clínico' },
        gate: { fn: 'G-ARR', args: ['summary.encounters'] }, provider: 'physClinicalHistory', badge: false }, // no payload array yet → closed
      { id: 'medications', order: 40, title: { en: 'Medications & Supplements', pt: 'Medicações e Suplementos' },
        gate: { fn: 'G-ARR', args: ['summary.medications', 'summary.supplements'] }, provider: 'physMedications', badge: false },
      { id: 'attention-strengths', order: 50, title: { en: 'Attention points & strengths', pt: 'Pontos de atenção e fortalezas' },
        gate: { fn: 'G-DOMAIN', args: ['physical'] }, provider: 'aiAttentionStrengths', badge: true },
    ],

    'physical-vitals': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DOMAIN', args: ['physical'] }, provider: 'aiSummary', badge: true, summary: true },
      { id: 'silvana-vitals', order: 15, title: { en: 'Vitals', pt: 'Vitais' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: SILVANA, provider: 'silvanaVitals', badge: false },
      { id: 'body-composition', order: 20, title: { en: 'Body composition', pt: 'Composição corporal' },
        gate: { fn: 'G-ARR', args: ['vitals.weight'] }, provider: 'vitalsSection', badge: false },
      { id: 'glucose', order: 30, title: { en: 'Glucose', pt: 'Glicose' },
        gate: { fn: 'G-ARR', args: ['vitals.glucose'] }, provider: 'vitalsSection', badge: false }, // no series in vitals-range yet → closed
      { id: 'sleep', order: 40, title: { en: 'Sleep architecture', pt: 'Arquitetura do sono' },
        gate: { fn: 'G-ARR', args: ['vitals.sleepStagesByWeek'] }, provider: 'vitalsSection', badge: false },
      { id: 'exercise', order: 50, title: { en: 'Exercise', pt: 'Exercício' },
        gate: { fn: 'G-ARR', args: ['vitals.exercise'] }, provider: 'vitalsSection', badge: false }, // no series yet → closed
      { id: 'movement', order: 60, title: { en: 'Movement', pt: 'Movimento' },
        gate: { fn: 'G-ARR', args: ['vitals.steps'] }, provider: 'vitalsSection', badge: false },
      { id: 'cardiovascular', order: 70, title: { en: 'Cardiovascular & recovery', pt: 'Cardiovascular e recuperação' },
        gate: { fn: 'G-ARR', args: ['vitals.hrvRhr'] }, provider: 'vitalsSection', badge: false },
      { id: 'stress-resilience', order: 80, title: { en: 'Stress & resilience', pt: 'Estresse e resiliência' },
        gate: { fn: 'G-ARR', args: ['vitals.stressRes'] }, provider: 'vitalsSection', badge: false },
      { id: 'blood-pressure', order: 90, title: { en: 'Blood pressure', pt: 'Pressão arterial' },
        gate: { fn: 'G-ARR', args: ['vitals.bp'] }, provider: 'vitalsSection', badge: false },
      { id: 'physician-assessment', order: 100, title: { en: 'Physician assessment', pt: 'Avaliação médica' },
        gate: { fn: 'G-ARR', args: ['summary.encounters'] }, provider: 'physClinicalHistory', badge: false }, // no payload array yet → closed
      { id: 'specific-findings', order: 110, title: { en: 'Specific findings', pt: 'Achados específicos' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'aiSpecificFindings', badge: true },
    ],

    'physical-exams': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DOMAIN', args: ['physical'] }, provider: 'aiSummary', badge: true, summary: true },
      { id: 'paulo-exams', order: 15, title: { en: 'Exams', pt: 'Exames' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: PAULO, provider: 'pauloExams', badge: false },
      { id: 'silvana-exams', order: 16, title: { en: 'Exams', pt: 'Exames' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: SILVANA, provider: 'silvanaExams', badge: false },
      { id: 'cristina-exams', order: 17, title: { en: 'Exams', pt: 'Exames' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: CRISTINA, provider: 'cristinaExams', badge: false },
      { id: 'imaging', order: 20, title: { en: 'Imaging studies', pt: 'Estudos de imagem' },
        gate: { fn: 'G-ARR', args: ['exams.imaging', 'exams.ecg_studies'] }, provider: 'examsImaging', badge: false },
      { id: 'laboratory', order: 30, title: { en: 'Laboratory', pt: 'Laboratório' },
        gate: { fn: 'G-ARR', args: ['exams.panels', 'exams.lab_documents'] }, provider: 'examsLaboratory', badge: false },
      { id: 'gut-microbiota', order: 40, title: { en: 'Gut microbiota', pt: 'Microbiota intestinal' },
        gate: { fn: 'G-ARR', args: ['exams.microbiota'] }, provider: 'examsMicrobiota', badge: false }, // no payload array yet → closed
      { id: 'alcohol-audit', order: 50, title: { en: 'Alcohol · AUDIT', pt: 'Álcool · AUDIT' },
        gate: { fn: 'G-ARR', args: ['exams.audit'] }, provider: 'examsAudit', badge: false }, // no payload array yet → closed
      { id: 'specific-findings', order: 60, title: { en: 'Specific findings', pt: 'Achados específicos' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'aiSpecificFindings', badge: true },
    ],

    'physical-genetics': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DOMAIN', args: ['physical'] }, provider: 'aiSummary', badge: true, summary: true },
      { id: 'pgx-summary', order: 20, title: { en: 'Pharmacogenetic profile', pt: 'Perfil farmacogenético' },
        gate: { fn: 'G-ARR', args: ['summary.pgx'] }, provider: 'pgxSummary', badge: true }, // D6/prompt #3: no payload array yet → closed
      { id: 'meds-vs-pgx', order: 30, title: { en: 'Medications vs PGx', pt: 'Medicações vs PGx' },
        gate: { fn: 'G-ARR', args: ['summary.pgx'] }, provider: 'pgxMedsTable', badge: true }, // closed until D6
      { id: 'pgx-modules', order: 40, title: { en: 'PGx modules', pt: 'Módulos PGx' },
        gate: { fn: 'G-ARR', args: ['summary.pgx'] }, provider: 'pgxModules', badge: false }, // closed until D6
      { id: 'specific-findings', order: 50, title: { en: 'Specific findings', pt: 'Achados específicos' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'aiSpecificFindings', badge: true },
    ],

    'mental': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DOMAIN', args: ['mental'] }, provider: 'aiSummary', badge: true, summary: true },
      { id: 'paulo-mental', order: 15, title: { en: 'Mental health', pt: 'Saúde mental' },
        gate: { fn: 'PATIENT', args: [] }, patientScope: PAULO, provider: 'pauloMental', badge: true },
      { id: 'attention-strengths', order: 20, title: { en: 'Attention points & strengths', pt: 'Pontos de atenção e fortalezas' },
        gate: { fn: 'G-DOMAIN', args: ['mental'] }, provider: 'aiAttentionStrengths', badge: true },
      /* Contract ids archetype/coping/self-awareness/strengths/risk/substance/
         formulation render INSIDE psych-architecture as its data-driven
         dimensions (per-dimension items.length gate) until each has its own
         queryable payload path. */
      { id: 'psych-architecture', order: 30, title: { en: 'Psychological architecture', pt: 'Arquitetura psicológica' },
        gate: { fn: 'G-ARR', args: ['psych.dimensions'] }, provider: 'psychArchitecture', badge: true },
      { id: 'life-history', order: 40, title: { en: 'A life in events', pt: 'Uma vida em eventos' },
        gate: { fn: 'G-ARR', args: ['psych.life_events'] }, provider: 'psychLifeHistory', badge: false },
      { id: 'from-your-record', order: 50, title: { en: 'From your record', pt: 'Do seu prontuário' },
        gate: { fn: 'G-DOMAIN', args: ['mental'] }, provider: 'aiFromYourRecord', badge: true },
    ],

    'spiritual': [
      { id: 'ai-summary', order: 10, title: { en: 'AI summary', pt: 'Resumo por IA' },
        gate: { fn: 'G-DOMAIN', args: ['spiritual'] }, provider: 'aiSummary', badge: true, summary: true },
      /* Spiritual topic arrays (confession/witness/scriptures/timeline/
         practices/struggles/wheel-of-life) have no queryable client payload
         yet — every gate below fails closed until that data exists (D6). */
      { id: 'confession', order: 20, title: { en: 'Confession', pt: 'Confissão' },
        gate: { fn: 'G-ARR', args: ['spiritual.confession'] }, provider: 'spiritualTopic', badge: false },
      { id: 'witness', order: 30, title: { en: 'Witness', pt: 'Testemunho' },
        gate: { fn: 'G-ARR', args: ['spiritual.witness'] }, provider: 'spiritualTopic', badge: false },
      { id: 'scriptures', order: 40, title: { en: 'Scriptures', pt: 'Escrituras' },
        gate: { fn: 'G-ARR', args: ['spiritual.scriptures'] }, provider: 'spiritualTopic', badge: false },
      { id: 'timeline', order: 50, title: { en: 'Timeline', pt: 'Linha do tempo' },
        gate: { fn: 'G-ARR', args: ['spiritual.timeline'] }, provider: 'spiritualTopic', badge: false },
      { id: 'practices', order: 60, title: { en: 'Practices', pt: 'Práticas' },
        gate: { fn: 'G-ARR', args: ['spiritual.practices'] }, provider: 'spiritualTopic', badge: false },
      { id: 'struggles', order: 70, title: { en: 'Struggles', pt: 'Lutas' },
        gate: { fn: 'G-ARR', args: ['spiritual.struggles'] }, provider: 'spiritualTopic', badge: false },
      { id: 'wheel-of-life', order: 80, title: { en: 'Wheel of life', pt: 'Roda da vida' },
        gate: { fn: 'G-ARR', args: ['spiritual.wheel_of_life'] }, provider: 'spiritualTopic', badge: false },
      { id: 'specific-findings', order: 90, title: { en: 'Specific findings', pt: 'Achados específicos' },
        gate: { fn: 'G-DASH', args: [] }, provider: 'aiSpecificFindings', badge: true },
    ],
  };
})();

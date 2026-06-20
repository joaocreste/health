/* Lumen Health — patient-context.js
 *
 * Runs on every section page. Resolves the current patient, injects the
 * "Change patient" button, and — for any patient other than Patient Zero
 * (pending:joao), whose section pages are bespoke hardcoded HTML —
 * replaces the page body with a data-driven view.
 *
 * Page-aware rendering for non-Joao patients:
 *   /home              → three pillar cards (Physical, Mental, Spiritual)
 *                        + recent docs + recent labs + pending files
 *   /physical-exams    → labs grouped by panel + lab PDFs + imaging list
 *   any other section  → "empty for this patient" shell with back link
 *
 * Set window.JC_PUBLIC=true (login) or window.JC_PICKER_PAGE=true (picker)
 * before this script loads to skip everything.
 */
(function () {
  'use strict';

  if (window.JC_PUBLIC === true || window.JC_PICKER_PAGE === true) return;

  var PATIENT_ZERO    = 'pending:joao';
  var PAULO_SILOTTO   = 'pending:paulo-silotto-df3441';
  var SILVANA_CRESTE  = 'pending:silvana-creste-18ba19';
  var CRISTINA_CRESTI = 'pending:cristina-cresti-d7479c';
  // Leo Keller is rendered by transforming Patient Zero's static HTML
  // in place — see assets/leo-mode.js. From this script's perspective,
  // he behaves the same way Patient Zero does: skip the data-driven
  // renderer and let the static page show.
  var LEO_KELLER      = 'pending:leo-keller-a3f1c2';

  var params = new URLSearchParams(location.search);
  var fromUrl = params.get('patient');
  var stored = sessionStorage.getItem('jc_current_patient');
  var patient = fromUrl || stored;

  if (!patient) {
    location.replace('patients.html');
    return;
  }
  if (fromUrl && fromUrl !== stored) {
    sessionStorage.setItem('jc_current_patient', fromUrl);
  }

  // ─── Page detection ─────────────────────────────────────────────
  function currentSection() {
    var p = location.pathname.replace(/\/+$/, '').toLowerCase();
    var last = p.split('/').pop() || 'home';
    last = last.replace(/\.html$/, '');
    if (!last || last === 'index') return 'home';
    return last; // 'home', 'physical', 'physical-exams', 'mental', 'spiritual', etc.
  }

  // ─── Helpers ────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Paired translation. CSS hides whichever .lang-* doesn't match html[lang].
  // Inputs assumed pre-escaped (or trusted literal markup like en-dashes).
  function t(en, pt) {
    return '<span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span>';
  }

  // Plain-text translation for contexts that can't host HTML (SVG <text>,
  // .textContent, document.title, alert/confirm messages). Picks the
  // current html[lang] at call time — caller must re-call to refresh
  // after a language toggle.
  function tPlain(en, pt) {
    var l = (document.documentElement.lang || 'en').toLowerCase().slice(0, 2);
    return l === 'pt' ? pt : en;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var s = String(iso);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : s;
  }

  function fmtFlag(flag) {
    if (!flag) return '';
    var cls = (flag === 'H' || flag === 'HH') ? 'high'
            : (flag === 'L' || flag === 'LL') ? 'low'
            : 'norm';
    return ' <span class="lab-flag ' + cls + '">' + escapeHtml(flag) + '</span>';
  }

  /* ── Medication intelligence ───────────────────────────────────────
     Two patient-friendly, de-identified knowledge bases, both keyed off
     the patient's OWN medication + supplement list (so they activate from
     real data and stay silent for patients who lack the relevant drugs):

       1. MED_INTERACTIONS — cross-specialty interaction hints. The premise
          is the silo problem: the cardiologist, endocrinologist and
          psychiatrist each prescribe without seeing the full list, so an
          interaction can hide in plain sight. Surfaced on the Summary card
          and on any off-panel whose flagged markers implicate one of the
          paired drugs.
       2. MARKER_MED_EFFECTS — "this medication can move this marker". Lets an
          out-of-range value read as an expected drug effect rather than a
          new disease. Surfaced inline on each off marker.

     Strings are authored literal HTML (trusted, no user input) and rendered
     through t() at display time. Not a diagnosis — every card keeps its
     "discuss with your doctor" disclaimer. */
  var DRUG_DEFS = [
    { id: 'clopidogrel',  rx: /clopidogrel|plavix|iscover/i,                                   oral: true },
    { id: 'fluoxetine',   rx: /fluoxetin|verotina|prozac|daforin/i,                            oral: true },
    { id: 'diltiazem',    rx: /diltiazem|balcor|cardizem|incoril/i,                            oral: true },
    { id: 'losartan',     rx: /losartan|losartana|corus|cozaar|aradois/i,                      oral: true },
    { id: 'valacyclovir', rx: /valacyclovir|valaciclovir|valtrex/i,                            oral: true },
    { id: 'dobesilate',   rx: /dobesilate|dobesilato|dobeven|doxium/i,                         oral: true },
    { id: 'tirzepatide',  rx: /tirzepatid[ae]|mounjaro|zepbound/i,                             oral: false },
    { id: 'omega3',       rx: /omega[\s-]?3|fish[\s-]?oil|óleo de peixe|\bepa\b|\bdha\b/i },
    { id: 'flaxseed',     rx: /flaxseed|linseed|linha[çc]a/i },
    { id: 'vitamind',     rx: /vitamin\s*d\b|vitamina\s*d\b|colecalciferol|cholecalciferol|\bd3\b/i },
    { id: 'b12',          rx: /\bb12\b|cobalamin|mecobalamin|cobalamina/i },
    { id: 'magnesium',    rx: /magnesium|magn[ée]sio/i },
  ];

  // Build a Set of drug ids present in the patient's meds + supplements.
  function detectDrugs(meds, supps) {
    var names = []
      .concat((meds  || []).map(function (m) { return String(m.name || ''); }))
      .concat((supps || []).map(function (s) { return String(s.name || ''); }));
    var set = {}; // plain object as a Set (older-engine safe)
    DRUG_DEFS.forEach(function (d) {
      if (names.some(function (n) { return d.rx.test(n); })) set[d.id] = true;
    });
    return set;
  }
  function has(set, id) { return !!set[id]; }
  var ORAL_IDS = DRUG_DEFS.filter(function (d) { return d.oral; }).map(function (d) { return d.id; });

  // Each interaction: explicit participant ids + a bilingual hint. The
  // tirzepatide rule is special (it interacts with *any* oral medicine via
  // delayed gastric emptying), so it carries an `anyOral` flag.
  var MED_INTERACTIONS = [
    { id: 'clopidogrel+fluoxetine', need: ['clopidogrel', 'fluoxetine'], text: {
      en: '<strong>Clopidogrel + fluoxetine.</strong> Fluoxetine can blunt the liver step (CYP2C19) that switches clopidogrel on, which may weaken its clot-prevention. These usually come from different doctors — worth making sure the cardiologist and whoever prescribed the fluoxetine both know.',
      pt: '<strong>Clopidogrel + fluoxetina.</strong> A fluoxetina pode reduzir a etapa hepática (CYP2C19) que ativa o clopidogrel, podendo enfraquecer sua proteção antiplaquetária. Costumam vir de médicos diferentes — vale garantir que o cardiologista e quem prescreveu a fluoxetina saibam.' } },
    { id: 'clopidogrel+omega3', need: ['clopidogrel', 'omega3'], text: {
      en: '<strong>Clopidogrel + fish-oil omega-3.</strong> Both reduce clotting; together they can add to a tendency to bruise or bleed.',
      pt: '<strong>Clopidogrel + ômega-3 (óleo de peixe).</strong> Ambos reduzem a coagulação; juntos podem aumentar a tendência a hematomas ou sangramento.' } },
    { id: 'diltiazem+fluoxetine', need: ['diltiazem', 'fluoxetine'], text: {
      en: '<strong>Diltiazem + fluoxetine.</strong> Fluoxetine can raise diltiazem blood levels (shared liver enzymes), which may amplify its slowing of the heart rate and lowering of blood pressure.',
      pt: '<strong>Diltiazem + fluoxetina.</strong> A fluoxetina pode elevar os níveis de diltiazem (enzimas hepáticas em comum), podendo acentuar a redução da frequência cardíaca e da pressão.' } },
    { id: 'diltiazem+losartan', need: ['diltiazem', 'losartan'], text: {
      en: '<strong>Diltiazem + losartan.</strong> Both lower blood pressure — together, watch for dizziness or readings that run low.',
      pt: '<strong>Diltiazem + losartana.</strong> Ambos baixam a pressão — juntos, atenção a tonturas ou pressão muito baixa.' } },
    { id: 'tirzepatide+oral', anyOral: true, text: {
      en: '<strong>Tirzepatide (Mounjaro) + tablets taken by mouth.</strong> It slows stomach emptying, which can change how much and how fast oral medicines are absorbed — so a pill\'s effect, and any marker it moves, can shift.',
      pt: '<strong>Tirzepatida (Mounjaro) + comprimidos via oral.</strong> Ela retarda o esvaziamento do estômago, podendo mudar quanto e com que rapidez os remédios orais são absorvidos — então o efeito de um comprimido, e qualquer marcador que ele altere, pode variar.' } },
  ];
  function interactionDrugs(it, set) {
    if (it.anyOral) return ['tirzepatide'].concat(ORAL_IDS.filter(function (x) { return has(set, x); }));
    return it.need.slice();
  }
  function interactionApplies(it, set) {
    if (it.anyOral) return has(set, 'tirzepatide') && ORAL_IDS.some(function (x) { return has(set, x); });
    return it.need.every(function (x) { return has(set, x); });
  }
  // Active interactions for this patient. `restrict` (a drug-id Set) keeps
  // only interactions that touch one of those drugs — used to scope a panel
  // card to the drugs its own flagged markers implicate.
  function interactionsFor(set, restrict) {
    return MED_INTERACTIONS.filter(function (it) {
      if (!interactionApplies(it, set)) return false;
      if (restrict) {
        var ds = interactionDrugs(it, set);
        if (!ds.some(function (x) { return restrict[x]; })) return false;
      }
      return true;
    }).map(function (it) { return it.text; });
  }

  // marker (lowercased canonical) → list of { need, dir, text }. `need` is the
  // drug id(s) that trigger the note (OR semantics); `dir` limits it to a
  // high/low deviation. Returns { text, drugs } so the caller knows which of
  // the patient's drugs were implicated (to scope panel-level interactions).
  var MARKER_MED_EFFECTS = {
    'egfr': [
      { need: 'losartan', dir: 'low', text: {
        en: 'Losartan (a blood-pressure ARB) eases the pressure inside the kidney\'s filters, so it can nudge eGFR down (and creatinine up) without meaning kidney damage — an expected drug effect to read in context.',
        pt: 'A losartana (ARB para pressão) reduz a pressão dentro dos filtros renais, podendo abaixar a TFG (e elevar a creatinina) sem significar lesão renal — efeito esperado do remédio, a interpretar no contexto.' } },
      { need: 'valacyclovir', dir: 'low', text: {
        en: 'Valacyclovir is cleared by the kidneys and, especially with low fluid intake, can transiently affect kidney-filtration numbers.',
        pt: 'O valaciclovir é eliminado pelos rins e, sobretudo com pouca ingestão de líquidos, pode afetar temporariamente os números de filtração renal.' } },
    ],
    'creatinine': [
      { need: 'losartan', dir: 'high', text: {
        en: 'Losartan can raise creatinine slightly by easing pressure in the kidney\'s filters — often an expected effect rather than new kidney injury.',
        pt: 'A losartana pode elevar levemente a creatinina ao reduzir a pressão nos filtros renais — em geral efeito esperado, não lesão renal nova.' } },
      { need: 'valacyclovir', dir: 'high', text: {
        en: 'Valacyclovir is kidney-cleared and can transiently raise creatinine, more so if under-hydrated.',
        pt: 'O valaciclovir é eliminado pelos rins e pode elevar a creatinina temporariamente, mais ainda se houver pouca hidratação.' } },
    ],
    'potassium': [
      { need: 'losartan', dir: 'high', text: {
        en: 'ARBs like losartan tend to nudge potassium up — usually mild, but worth keeping on the radar.',
        pt: 'ARBs como a losartana tendem a elevar um pouco o potássio — geralmente leve, mas vale acompanhar.' } },
    ],
    'uric acid': [
      { need: 'losartan', dir: 'low', text: {
        en: 'Losartan mildly increases uric-acid excretion, which can lower its level.',
        pt: 'A losartana aumenta levemente a excreção de ácido úrico, podendo reduzir seu nível.' } },
    ],
    'sodium': [
      { need: 'fluoxetine', dir: 'low', text: {
        en: 'SSRIs like fluoxetine can lower sodium (a mild SIADH effect), usually slightly.',
        pt: 'ISRSs como a fluoxetina podem reduzir o sódio (efeito leve de SIADH), em geral discretamente.' } },
    ],
    'fasting glucose': [
      { need: 'tirzepatide', dir: 'low', text: {
        en: 'Tirzepatide (Mounjaro) lowers blood glucose by design — a low or improved reading is an expected treatment effect.',
        pt: 'A tirzepatida (Mounjaro) reduz a glicose por desígnio — um valor baixo ou melhorado é efeito esperado do tratamento.' } },
    ],
    'hba1c': [
      { need: 'tirzepatide', dir: 'low', text: {
        en: 'Tirzepatide (Mounjaro) lowers HbA1c by design — a low or improved value reflects the treatment working.',
        pt: 'A tirzepatida (Mounjaro) reduz a HbA1c por desígnio — um valor baixo ou melhorado reflete o tratamento funcionando.' } },
    ],
    'triglycerides': [
      { need: 'omega3', dir: 'low', text: {
        en: 'Fish-oil omega-3 lowers triglycerides — a low value can simply reflect the supplement.',
        pt: 'O ômega-3 (óleo de peixe) reduz os triglicérides — um valor baixo pode apenas refletir o suplemento.' } },
      { need: 'tirzepatide', dir: 'low', text: {
        en: 'Tirzepatide also tends to lower triglycerides as weight and glucose improve.',
        pt: 'A tirzepatida também tende a reduzir os triglicérides à medida que peso e glicose melhoram.' } },
    ],
    'ldl-c': [
      { need: 'omega3', dir: 'high', text: {
        en: 'High-dose fish-oil omega-3 can nudge LDL up a little even as it lowers triglycerides.',
        pt: 'O ômega-3 em dose alta pode elevar um pouco o LDL mesmo reduzindo os triglicérides.' } },
    ],
    'alt': [
      { need: ['diltiazem', 'fluoxetine'], dir: 'high', text: {
        en: 'Diltiazem and fluoxetine can each occasionally raise liver enzymes — usually mild and reversible.',
        pt: 'Diltiazem e fluoxetina podem, ocasionalmente, elevar enzimas hepáticas — em geral leve e reversível.' } },
    ],
    'ast': [
      { need: ['diltiazem', 'fluoxetine'], dir: 'high', text: {
        en: 'Diltiazem and fluoxetine can each occasionally raise liver enzymes — usually mild and reversible.',
        pt: 'Diltiazem e fluoxetina podem, ocasionalmente, elevar enzimas hepáticas — em geral leve e reversível.' } },
    ],
    'platelets': [
      { need: ['clopidogrel', 'fluoxetine'], dir: 'low', text: {
        en: 'Clopidogrel and fluoxetine can each lower the platelet count or how well platelets work — relevant if you bruise or bleed easily.',
        pt: 'Clopidogrel e fluoxetina podem reduzir a contagem ou a função das plaquetas — relevante se você tem hematomas ou sangramentos fáceis.' } },
    ],
    'aptt': [
      { need: ['clopidogrel', 'omega3'], dir: 'high', text: {
        en: 'A mildly long aPTT is most often a sampling or lab effect. Separately, your clopidogrel and fish-oil omega-3 raise bleeding tendency through platelet effects (not through this test) — useful context for whoever tracks your clotting.',
        pt: 'Um TTPA pouco alongado costuma ser efeito de coleta ou laboratório. À parte, seu clopidogrel e o ômega-3 aumentam a tendência a sangramento por efeito nas plaquetas (não por este exame) — contexto útil para quem acompanha sua coagulação.' } },
    ],
    'vitamin d (25-oh)': [
      { need: 'vitamind', dir: 'high', text: {
        en: 'A high-normal or high vitamin D reflects your vitamin D3 supplement — worth confirming the dose is still right.',
        pt: 'Uma vitamina D no limite alto ou alta reflete seu suplemento de vitamina D3 — vale confirmar se a dose ainda está adequada.' } },
    ],
    'vitamin b12': [
      { need: 'b12', dir: 'high', text: {
        en: 'A high B12 simply reflects your B12 supplement.',
        pt: 'Uma B12 alta reflete apenas seu suplemento de B12.' } },
    ],
    'calcium': [
      { need: 'vitamind', dir: 'high', text: {
        en: 'Vitamin D3 supplementation increases calcium absorption and can mildly raise blood calcium.',
        pt: 'O suplemento de vitamina D3 aumenta a absorção de cálcio e pode elevar levemente o cálcio no sangue.' } },
    ],
    'magnesium': [
      { need: 'magnesium', dir: 'high', text: {
        en: 'A high magnesium reflects your magnesium supplement.',
        pt: 'Um magnésio alto reflete seu suplemento de magnésio.' } },
    ],
  };
  // Returns [{ text:{en,pt}, drugs:[ids] }] — drug-driven explanations for one
  // off marker. drugs lists which of the patient's drugs were implicated.
  function medEffectsFor(markerKey, dir, set) {
    var defs = MARKER_MED_EFFECTS[markerKey] || [];
    var out = [];
    defs.forEach(function (d) {
      if (d.dir && d.dir !== dir) return;
      var needs = Array.isArray(d.need) ? d.need : [d.need];
      var hit = needs.filter(function (x) { return has(set, x); });
      if (hit.length) out.push({ text: d.text, drugs: hit });
    });
    return out;
  }

  function injectChangeButton() {
    var signOut = document.querySelector('.signout-btn');
    if (!signOut) return;
    if (document.querySelector('.changepatient-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'changepatient-btn';
    btn.setAttribute('aria-label', 'Change patient');
    btn.setAttribute('title', 'Change patient');
    btn.onclick = function () {
      if (typeof window.jcChangePatient === 'function') {
        window.jcChangePatient();
      } else {
        sessionStorage.removeItem('jc_current_patient');
        location.href = 'patients.html';
      }
    };
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
        '<circle cx="9" cy="7" r="4"/>' +
        '<polyline points="16 11 18 13 22 9"/>' +
        '<polyline points="22 13 18 9"/>' +
      '</svg>' +
      '<span class="changepatient-label">' +
        '<span class="lang-en">Change patient</span>' +
        '<span class="lang-pt">Trocar paciente</span>' +
      '</span>';
    signOut.parentNode.insertBefore(btn, signOut);
  }

  function hidePageBody() {
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      // Keep <nav> (the top bar) and <script>; explicitly hide
      // <header class="page-header"> because it hardcodes Joao's hero
      // copy on the static pages and would leak through for every
      // other patient.
      if (el.tagName === 'NAV' || el.tagName === 'SCRIPT' ||
          el.classList.contains('jc-empty-shell') ||
          el.classList.contains('jc-overview') ||
          el.classList.contains('jc-exams') ||
          el.classList.contains('jc-home') ||
          el.classList.contains('jc-paulo-exams') ||
          el.classList.contains('jc-paulo-mental') ||
          el.classList.contains('jc-silvana-exams') ||
          el.classList.contains('jc-danger-zone') ||
          el.classList.contains('jc-danger-backdrop') ||
          el.classList.contains('lumen-chat-root')) continue;
      el.style.display = 'none';
    }
  }

  // ─── Renderers ──────────────────────────────────────────────────
  function renderPatientHeader(p) {
    var profileBits = [];
    if (p.date_of_birth) profileBits.push(t('DOB ', 'Nasc. ') + formatDate(p.date_of_birth));
    if (p.sex) profileBits.push(escapeHtml(p.sex));
    if (p.country_of_residence) profileBits.push(escapeHtml(p.country_of_residence));
    if (p.native_language) profileBits.push(t('lang: ', 'idioma: ') + escapeHtml(p.native_language));
    var profile = profileBits.length
      ? profileBits.join(' · ')
      : '<em>' + t('No profile fields set.', 'Nenhum dado de perfil definido.') + '</em>';
    return (
      '<header class="ov-header">' +
        '<div class="ov-eyebrow">' + t('Patient record', 'Prontuário do paciente') + '</div>' +
        '<h1 class="ov-title">' + (p.full_name ? escapeHtml(p.full_name) : t('Unnamed', 'Sem nome')) + '</h1>' +
        '<div class="ov-profile">' + profile + '</div>' +
        '<div class="ov-id">' + escapeHtml(p.clerk_user_id || '') + '</div>' +
      '</header>'
    );
  }

  function renderPillarCard(name, total, breakdown, href, accent) {
    var rows = Object.keys(breakdown).map(function (k) {
      var label = k.replace(/_/g, ' ');
      var v = breakdown[k];
      return '<li class="pillar-row' + (v === 0 ? ' empty' : '') + '">' +
               '<span>' + escapeHtml(label) + '</span>' +
               '<span>' + v + '</span>' +
             '</li>';
    }).join('');
    var emptyNote = total === 0
      ? '<div class="pillar-empty">No data yet for this pillar.</div>' : '';
    return (
      '<section class="pillar-card pillar-' + accent + '">' +
        '<header class="pillar-head">' +
          '<h2>' + escapeHtml(name) + '</h2>' +
          '<div class="pillar-total">' + total + '</div>' +
        '</header>' +
        emptyNote +
        '<ul class="pillar-rows">' + rows + '</ul>' +
        '<a class="pillar-link" href="' + href + '">Open ' + escapeHtml(name) + ' →</a>' +
      '</section>'
    );
  }

  function renderPendingBanner(pending) {
    if (!pending || pending.length === 0) return '';
    var n = pending.length;
    var headline = t(
      n + (n === 1 ? ' file' : ' files') + ' did not process.',
      n + (n === 1 ? ' arquivo' : ' arquivos') + ' não foi processado.'
    );
    var sub = t(
      'Uploaded but classification or parsing failed (often an API billing or transient error). ',
      'Enviado, mas a classificação ou o parsing falhou (frequentemente erro de billing da API ou transitório). '
    );
    return (
      '<div class="ov-pending">' +
        '<strong>' + headline + '</strong> ' + sub +
        '<ul class="ov-list">' +
          pending.map(function (f) {
            return '<li>' +
              '<span class="ov-list-title">' + (f.original_path ? escapeHtml(f.original_path) : t('(no name)', '(sem nome)')) + '</span>' +
              '<span class="ov-list-meta">' + escapeHtml(f.status || '?') +
                (f.error_message ? ' — ' + escapeHtml(String(f.error_message).slice(0, 160)) : '') +
              '</span></li>';
          }).join('') +
        '</ul>' +
      '</div>'
    );
  }

  function renderDocList(docs) {
    if (!docs || docs.length === 0) {
      return '<div class="ov-empty">' + t('No documents yet.', 'Nenhum documento ainda.') + '</div>';
    }
    return '<ul class="ov-list">' + docs.map(function (d) {
      var title = d.title || d.original_filename || null;
      var titleHtml = title ? escapeHtml(title) : t('(untitled)', '(sem título)');
      var date = d.document_date || (d.created_at && String(d.created_at).slice(0, 10));
      return '<li>' +
               '<span class="ov-list-title">' + titleHtml + '</span>' +
               '<span class="ov-list-meta">' +
                 escapeHtml(d.kind || '—') + ' · ' + escapeHtml(formatDate(date)) +
               '</span>' +
             '</li>';
    }).join('') + '</ul>';
  }

  function renderLabList(labs) {
    if (!labs || labs.length === 0) {
      return '<div class="ov-empty">' + t('No lab results yet.', 'Nenhum resultado de exame ainda.') + '</div>';
    }
    return '<div class="lab-panel-body lab-panel-body-flat">' +
      labs.map(renderLabTest).join('') +
    '</div>';
  }

  // Mirror Patient-Zero's landing page exactly: dark-blue hero + Reports cards.
  // Counts/recent-docs/recent-labs from `summary` are intentionally ignored —
  // the layout is identical for every patient regardless of how much data has
  // been ingested. The user gets to data by clicking "Add or edit data" in the
  // top nav (or by opening one of the three pillar cards).
  // ── Medications + Supplements tables ─────────────────────────────
  // Renders two .exam-table cards (reusing the Exams page styling) from the
  // medications/supplements arrays on /api/patient-summary. Returns '' when the
  // patient has neither (graceful sparsity — never an empty grid). Used on both
  // the Summary page (below the pillar cards) and the Physical landing (below
  // the Vitals/Exams/Genetics hub).
  function medsTablesInner(summary) {
    var meds = (summary && summary.medications) || [];
    var supps = (summary && summary.supplements) || [];
    if (!meds.length && !supps.length) return '';
    var html = '';
    if (meds.length) {
      var rows = meds.map(function (m) {
        var hasDaily = (m.daily_dose_amount != null && isFinite(Number(m.daily_dose_amount)));
        var amt = hasDaily
          ? fmtLabNum(Number(m.daily_dose_amount)) + ' ' + escapeHtml(m.daily_dose_unit || '') + '/day'
          : '—';
        var pill = '';
        if (m.status && m.status !== 'active') {
          var cls = (m.status === 'needs-review') ? 'high' : 'norm';
          pill = ' <span class="lab-flag ' + cls + '">' + escapeHtml(m.status) + '</span>';
        }
        return '<tr>' +
          '<td class="exam-marker">' + escapeHtml(m.name || '') + pill + '</td>' +
          '<td class="exam-ref">' + escapeHtml(m.dose || '—') + '</td>' +
          '<td class="exam-value">' + amt + '</td>' +
          '<td class="exam-ref">' + escapeHtml(m.frequency || '—') + '</td>' +
          '<td class="exam-ref">' + escapeHtml(m.drug_class || '—') + '</td>' +
        '</tr>';
      }).join('');
      html += '<section class="exam-panel">' +
        '<div class="exam-panel-head">' +
          '<h2><span class="lang-en">Medications</span><span class="lang-pt">Medicações</span></h2>' +
          '<span class="exam-panel-count">' + meds.length + '</span>' +
        '</div>' +
        '<table class="exam-table"><thead><tr>' +
          '<th><span class="lang-en">Medication</span><span class="lang-pt">Medicação</span></th>' +
          '<th><span class="lang-en">Strength</span><span class="lang-pt">Concentração</span></th>' +
          '<th><span class="lang-en">Daily dose</span><span class="lang-pt">Dose diária</span></th>' +
          '<th><span class="lang-en">Frequency</span><span class="lang-pt">Frequência</span></th>' +
          '<th><span class="lang-en">Class</span><span class="lang-pt">Classe</span></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</section>';
    }
    if (supps.length) {
      var srows = supps.map(function (s) {
        return '<tr>' +
          '<td class="exam-marker">' + escapeHtml(s.name || '') + '</td>' +
          '<td class="exam-value">' + escapeHtml(s.dose || '—') + '</td>' +
        '</tr>';
      }).join('');
      html += '<section class="exam-panel">' +
        '<div class="exam-panel-head">' +
          '<h2><span class="lang-en">Supplements</span><span class="lang-pt">Suplementos</span></h2>' +
          '<span class="exam-panel-count">' + supps.length + '</span>' +
        '</div>' +
        '<table class="exam-table"><thead><tr>' +
          '<th><span class="lang-en">Supplement</span><span class="lang-pt">Suplemento</span></th>' +
          '<th><span class="lang-en">Daily dose</span><span class="lang-pt">Dose diária</span></th>' +
        '</tr></thead><tbody>' + srows + '</tbody></table>' +
      '</section>';
    }
    html += '<p class="ov-section-note">' +
      '<span class="lang-en">Daily dose = strength × units per dose × doses per day. Informational — not a prescription.</span>' +
      '<span class="lang-pt">Dose diária = concentração × unidades por tomada × tomadas por dia. Informativo — não é uma prescrição.</span>' +
    '</p>';
    return html;
  }

  // Summary page: wrap in a report-section so it matches the pillar-card block above it.
  function medsSectionHome(summary) {
    var inner = medsTablesInner(summary);
    if (!inner) return '';
    return '<section class="report-section meds-section"><div class="container">' +
      '<div class="section-label"><span class="lang-en">02 · Treatment</span><span class="lang-pt">02 · Tratamento</span></div>' +
      '<h2 class="section-title"><span class="lang-en">Medications &amp; Supplements</span><span class="lang-pt">Medicações e Suplementos</span></h2>' +
      inner +
    '</div></section>';
  }

  // Physical landing: inline block placed inside .ov-shell, below the hub cards.
  function medsSectionInline(summary) {
    var inner = medsTablesInner(summary);
    if (!inner) return '';
    return '<div class="meds-section-inline" style="margin-top:28px;">' +
      '<h2 class="ov-panels-title"><span class="lang-en">Medications &amp; Supplements</span><span class="lang-pt">Medicações e Suplementos</span></h2>' +
      inner +
    '</div>';
  }

  function renderHome(summary) {
    var p = (summary && summary.patient) || {};
    var name = p.full_name || 'this patient';

    document.title = 'Lumen Health — Health Summary · ' + name;

    // ── Hero meta values ──────────────────────────────────────────
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var monthsPt = ['janeiro','fevereiro','março','abril','maio','junho',
                    'julho','agosto','setembro','outubro','novembro','dezembro'];
    var today = new Date();
    var todayEn = today.getDate() + ' ' + months[today.getMonth()].slice(0, 3) + ' ' + today.getFullYear();
    var todayPt = today.getDate() + ' de ' + monthsPt[today.getMonth()] + ' de ' + today.getFullYear();

    var dobEn = '—', dobPt = '—';
    if (p.date_of_birth) {
      var dob = new Date(p.date_of_birth);
      if (!isNaN(dob)) {
        var age = today.getFullYear() - dob.getFullYear();
        var beforeBirthday = (today.getMonth() < dob.getMonth()) ||
                             (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
        if (beforeBirthday) age--;
        dobEn = dob.getDate() + ' ' + months[dob.getMonth()] + ' ' + dob.getFullYear() + ' · age ' + age;
        dobPt = dob.getDate() + ' de ' + monthsPt[dob.getMonth()] + ' de ' + dob.getFullYear() + ' · ' + age + ' anos';
      }
    }

    var residence = p.country_of_residence ? escapeHtml(p.country_of_residence) : '—';

    // ── Hero ──────────────────────────────────────────────────────
    var hero =
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' +
            '<span class="lang-en">Health Summary · ' + todayEn + '</span>' +
            '<span class="lang-pt">Resumo de saúde · ' + todayPt + '</span>' +
          '</div>' +
          '<h1 class="hero-title">' +
            '<span class="lang-en">From scattered data to a clinical picture.</span>' +
            '<span class="lang-pt">Dos dados dispersos a um quadro clínico.</span>' +
          '</h1>' +
          '<p class="hero-sub">' +
            '<span class="lang-en">A single, structured view of ' + escapeHtml(name) + '’s physical, mental and spiritual health.</span>' +
            '<span class="lang-pt">Uma visão única e estruturada da saúde física, mental e espiritual de ' + escapeHtml(name) + '.</span>' +
          '</p>' +
          '<div class="hero-meta">' +
            '<div class="hero-meta-item">' +
              '<span class="lang-en">Patient</span><span class="lang-pt">Paciente</span>' +
              '<span>' + escapeHtml(name) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span class="lang-en">Date of birth</span><span class="lang-pt">Data de nascimento</span>' +
              '<span><span class="lang-en">' + dobEn + '</span><span class="lang-pt">' + dobPt + '</span></span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span class="lang-en">Residence</span><span class="lang-pt">Residência</span>' +
              '<span>' + residence + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span class="lang-en">Prepared</span><span class="lang-pt">Preparado em</span>' +
              '<span><span class="lang-en">' + todayEn + '</span><span class="lang-pt">' + todayPt + '</span></span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span class="lang-en">Classification</span><span class="lang-pt">Classificação</span>' +
              '<span><span class="lang-en">Strictly confidential</span><span class="lang-pt">Estritamente confidencial</span></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    // ── Reports — three pillar cards (identical to Patient Zero) ─
    var reports =
      '<section class="report-section">' +
        '<div class="container">' +
          '<div class="section-label"><span class="lang-en">01 · Browse</span><span class="lang-pt">01 · Navegar</span></div>' +
          '<h2 class="section-title"><span class="lang-en">Reports</span><span class="lang-pt">Relatórios</span></h2>' +
          '<div class="entry-grid entry-grid-visual">' +
            '<a class="entry-card entry-card-visual" href="physical.html">' +
              '<svg class="entry-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M32 54 L13 36 C7 30 7 22 13 18 C18 13 25 13 29 18 L32 21 L35 18 C39 13 46 13 51 18 C57 22 57 30 51 36 L32 54 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<polyline points="6,36 18,36 22,28 27,44 32,30 37,38 42,36 58,36" stroke="#3E7CA3" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
              '</svg>' +
              '<div class="entry-title"><span class="lang-en">Physical Health Overview</span><span class="lang-pt">Visão geral da saúde física</span></div>' +
              '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
            '</a>' +
            '<a class="entry-card entry-card-visual" href="mental.html">' +
              '<svg class="entry-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M32 14 C22 14 14 20 14 30 C14 40 22 50 32 50 V14 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M32 14 C42 14 50 20 50 30 C50 40 42 50 32 50 V14 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M22 24 Q26 26 22 30 Q26 34 22 38" stroke="#3E7CA3" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
                '<path d="M42 24 Q38 26 42 30 Q38 34 42 38" stroke="#3E7CA3" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
              '</svg>' +
              '<div class="entry-title"><span class="lang-en">Mental Health Overview</span><span class="lang-pt">Visão geral da saúde mental</span></div>' +
              '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
            '</a>' +
            '<a class="entry-card entry-card-visual" href="spiritual.html">' +
              '<svg class="entry-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M27 8 L37 8 L37 22 L50 22 L50 32 L37 32 L37 56 L27 56 L27 32 L14 32 L14 22 L27 22 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<line x1="32" y1="14" x2="32" y2="54" stroke="#3E7CA3" stroke-width="2" stroke-linecap="round"/>' +
                '<line x1="18" y1="27" x2="46" y2="27" stroke="#3E7CA3" stroke-width="2" stroke-linecap="round"/>' +
              '</svg>' +
              '<div class="entry-title"><span class="lang-en">Spiritual Health Overview</span><span class="lang-pt">Visão geral da saúde espiritual</span></div>' +
              '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</section>';

    var overview = document.createElement('main');
    overview.className = 'jc-home';
    overview.innerHTML = hero + reports + medsSectionHome(summary);
    document.body.appendChild(overview);
  }

  /* ── Paulo Silotto · AI pain map / symptom inference (Summary) ──────
     A bespoke rebuild of section "04 · Inferência da IA" from the
     standalone spine-journey report, refreshed against the full record
     now on file (18 imaging studies 2013→2026, the cervical/lumbar MRIs,
     the ergometric series and 13-year labs) and rendered bilingually.
     There is no symptom/pain/medication data in the chart — every value
     below is inferred from anatomy, framed as an educational estimate.
     Injected on the Summary page just under the AI-authored summary card
     via injectPauloPainMap(). */
  function injectPauloPainMapStyles() {
    if (document.getElementById('paulo-painmap-styles')) return;
    var s = document.createElement('style');
    s.id = 'paulo-painmap-styles';
    var P = '.paulo-painmap-section ';
    s.textContent = [
      P + '.painwrap { background: #FFFCF5; border: 1px solid #F0E4C8; border-radius: 16px; padding: 28px 28px 12px; margin-top: 6px; }',
      P + '.painmap-disclaimer { font-size: 13px; color: #9c7a32; background: #FFF6E5; border: 1px solid #E0C681; border-radius: 8px; padding: 10px 14px; margin: 0 0 22px; }',
      P + '.painlayout { display: grid; grid-template-columns: 300px 1fr; gap: 30px; align-items: start; }',
      '@media (max-width: 820px) { ' + P + '.painlayout { grid-template-columns: 1fr; } }',
      P + '.bodymap { position: sticky; top: 18px; }',
      P + '.bodymap svg { width: 100%; height: auto; }',
      P + '.painmap-legend { margin-top: 12px; font-size: 12.5px; }',
      P + '.painmap-legend div { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; color: #1E2D3D; }',
      P + '.painmap-legend .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }',
      P + '.painzones { display: flex; flex-direction: column; gap: 16px; }',
      P + '.pz { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 12px; padding: 16px 18px; border-left: 5px solid #7A8FA6; }',
      P + '.pz.r5 { border-left-color: #B23B3B; }',
      P + '.pz.r4 { border-left-color: #CC6B3A; }',
      P + '.pz.r3 { border-left-color: #C98A2B; }',
      P + '.pz-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }',
      P + '.pz-head h4 { margin: 0; font-size: 16.5px; font-family: "Raleway", sans-serif; font-weight: 700; color: #0D1B2A; }',
      P + '.eva { font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 600; color: #fff; background: #7A8FA6; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }',
      P + '.eva.r5 { background: #B23B3B; }',
      P + '.eva.r4 { background: #CC6B3A; }',
      P + '.eva.r3 { background: #C98A2B; }',
      P + '.pz dl { margin: 10px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 13.5px; }',
      P + '.pz dt { font-family: "IBM Plex Mono", monospace; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: #B8954A; padding-top: 3px; }',
      P + '.pz dd { margin: 0; color: #1E2D3D; }',
      P + '.painmap-synth { margin-top: 22px; background: #0D1B2A; color: #fff; border-radius: 12px; padding: 22px 24px; }',
      P + '.painmap-synth h4 { color: #B8954A; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; font-family: "IBM Plex Mono", monospace; margin-bottom: 10px; }',
      P + '.painmap-synth p { margin: 0; color: rgba(255,255,255,.9); font-size: 15px; line-height: 1.6; }',
      P + '.ai-pill { display: inline-block; background: #FFF6E5; color: #9c7a32; border: 1px solid #E0C681; padding: 2px 10px; border-radius: 999px; font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 600; letter-spacing: .06em; vertical-align: middle; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function pauloPainZone(cls, titleEn, titlePt, evaEn, evaPt, rows) {
    var dl = rows.map(function (r) {
      return '<dt>' + t(r[0], r[1]) + '</dt><dd>' + t(r[2], r[3]) + '</dd>';
    }).join('');
    return (
      '<div class="pz ' + cls + '">' +
        '<div class="pz-head">' +
          '<h4>' + t(titleEn, titlePt) + '</h4>' +
          '<span class="eva ' + cls + '">' + t(evaEn, evaPt) + '</span>' +
        '</div>' +
        '<dl>' + dl + '</dl>' +
      '</div>'
    );
  }

  function renderPauloPainMap() {
    injectPauloPainMapStyles();

    var bodymap =
      '<div class="bodymap">' +
        '<svg viewBox="0 0 200 430" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Body pain map (posterior view)">' +
          '<defs>' +
            '<radialGradient id="pm-red"><stop offset="0%" stop-color="#B23B3B" stop-opacity=".85"/><stop offset="100%" stop-color="#B23B3B" stop-opacity="0"/></radialGradient>' +
            '<radialGradient id="pm-org"><stop offset="0%" stop-color="#CC6B3A" stop-opacity=".8"/><stop offset="100%" stop-color="#CC6B3A" stop-opacity="0"/></radialGradient>' +
            '<radialGradient id="pm-amb"><stop offset="0%" stop-color="#C98A2B" stop-opacity=".8"/><stop offset="100%" stop-color="#C98A2B" stop-opacity="0"/></radialGradient>' +
          '</defs>' +
          '<g fill="#DfDAD0" stroke="#C9C2B4" stroke-width="1.5">' +
            '<circle cx="100" cy="34" r="20"/>' +
            '<rect x="90" y="52" width="20" height="14" rx="5"/>' +
            '<path d="M68 70 Q100 60 132 70 L140 150 Q140 175 128 200 L120 205 Q100 210 80 205 L72 200 Q60 175 60 150 Z"/>' +
            '<path d="M68 74 Q48 86 42 130 Q40 150 46 168 L56 165 Q54 130 64 100 Z"/>' +
            '<path d="M132 74 Q152 86 158 130 Q160 150 154 168 L144 165 Q146 130 136 100 Z"/>' +
            '<path d="M82 205 Q80 270 86 330 Q88 372 92 408 L102 408 Q102 360 100 300 Q100 360 108 408 L118 408 Q120 360 120 300 Q124 260 118 205 Q100 212 82 205 Z"/>' +
          '</g>' +
          '<ellipse cx="100" cy="66" rx="26" ry="20" fill="url(#pm-org)"/>' +
          '<ellipse cx="100" cy="178" rx="40" ry="30" fill="url(#pm-red)"/>' +
          '<ellipse cx="92" cy="225" rx="20" ry="18" fill="url(#pm-red)"/>' +
          '<ellipse cx="96" cy="300" rx="15" ry="34" fill="url(#pm-org)"/>' +
          '<ellipse cx="150" cy="92" rx="16" ry="14" fill="url(#pm-amb)"/>' +
          '<ellipse cx="118" cy="335" rx="13" ry="14" fill="url(#pm-amb)"/>' +
          '<g font-family="IBM Plex Mono, monospace" font-size="8" fill="#1E2D3D">' +
            '<text x="128" y="64">C5–C6</text>' +
            '<text x="143" y="182">L3–L4 · L5–S1</text>' +
            '<text x="2" y="300">S1 L</text>' +
          '</g>' +
        '</svg>' +
        '<div class="painmap-legend">' +
          '<div><span class="dot" style="background:#B23B3B"></span>' + t('Dominant pain (VAS 5–9)', 'Dor dominante (EVA 5–9)') + '</div>' +
          '<div><span class="dot" style="background:#CC6B3A"></span>' + t('Major pain (VAS 4–8)', 'Dor importante (EVA 4–8)') + '</div>' +
          '<div><span class="dot" style="background:#C98A2B"></span>' + t('Secondary pain (VAS 2–6)', 'Dor secundária (EVA 2–6)') + '</div>' +
        '</div>' +
      '</div>';

    var zones =
      '<div class="painzones">' +
        pauloPainZone('r5',
          'Lower back (axial)', 'Lombar baixa (axial)',
          'VAS 4–7 · flare 9', 'EVA 4–7 · crise 9',
          [
            ['Where', 'Onde', 'Low lumbar band, “belt”-like, central / bilateral; midline points over L3–L4 and L5–S1.', 'Faixa lombar baixa, em “cinta”, central/bilateral; pontos na linha média sobre L3–L4 e L5–S1.'],
            ['Character', 'Caráter', 'Mixed inflammatory + mechanical (active Modic I + facet joints).', 'Misto inflamatório + mecânico (Modic I ativo + facetário).'],
            ['How it behaves', 'Como se comporta', 'Morning stiffness; worse sitting for long, bending, lifting and standing; eases lying down.', 'Rigidez matinal; piora sentado por muito tempo, ao inclinar, levantar peso e em pé; alivia deitado.'],
          ]) +
        pauloPainZone('r5',
          'Left-leg sciatica (S1 root)', 'Ciática na perna esquerda (raiz S1)',
          'VAS 5–8', 'EVA 5–8',
          [
            ['Where', 'Onde', 'Left buttock → back of the thigh → calf → lateral border of the foot (S1 dermatome).', 'Glúteo esquerdo → posterior da coxa → panturrilha → borda lateral do pé (dermátomo S1).'],
            ['Character', 'Caráter', 'Neuropathic — burning, electric shocks, stabbing; possible numbness / weakness rising on the toes.', 'Neuropático — queimação, choque, fisgada; possível dormência/fraqueza para ficar na ponta do pé.'],
            ['How it behaves', 'Como se comporta', 'Worse sitting, coughing / sneezing, straining and bending forward.', 'Piora ao sentar, tossir/espirrar, fazer força e inclinar para frente.'],
          ]) +
        pauloPainZone('r4',
          'Neurogenic claudication (L3–L4 stenosis)', 'Claudicação neurogênica (estenose L3–L4)',
          'VAS 3–6', 'EVA 3–6',
          [
            ['Where', 'Onde', 'Both legs — heaviness / fatigue / cramping on walking.', 'Ambas as pernas — peso/cansaço/câimbra ao caminhar.'],
            ['Character', 'Caráter', 'Load- and posture-dependent.', 'Dependente de carga e postura.'],
            ['How it behaves', 'Como se comporta', 'Worse standing and walking upright; <strong>eases sitting or leaning forward</strong> (“shopping-cart sign”).', 'Piora em pé e andando ereto; <strong>alivia ao sentar ou inclinar para frente</strong> (“sinal do carrinho de supermercado”).'],
          ]) +
        pauloPainZone('r4',
          'Neck + arm (C5–C6 radiculopathy)', 'Cervical + braço (radiculopatia C5–C6)',
          'VAS 3–6', 'EVA 3–6',
          [
            ['Where', 'Onde', 'Nape / posterior neck, shoulder blade; if radicular, runs down the arm to thumb / index finger (C6).', 'Nuca/cervical posterior, escápula; se radicular, desce o braço até polegar/indicador (C6).'],
            ['Character', 'Caráter', 'Mechanical + possible neuropathic (tingling / burning in the arm).', 'Mecânico + possível neuropático (formigamento/queimação no braço).'],
            ['How it behaves', 'Como se comporta', 'Worse with extension / rotation and sustained postures (“tech-neck”).', 'Piora com extensão/rotação e posturas mantidas (“tech-neck”).'],
          ]) +
        pauloPainZone('r3',
          'Right shoulder (AC arthrosis)', 'Ombro direito (artrose AC)',
          'VAS 2–5', 'EVA 2–5',
          [
            ['Where', 'Onde', 'Top of the shoulder, over the AC joint, tender to palpation.', 'Topo do ombro, sobre a articulação AC, dor à palpação.'],
            ['How it behaves', 'Como se comporta', 'Worse crossing the arm in front, reaching overhead and lying on that side.', 'Piora ao cruzar o braço à frente, elevar acima da cabeça e deitar sobre o lado.'],
          ]) +
        pauloPainZone('r3',
          'Right knee (chondropathy)', 'Joelho direito (condropatia)',
          'VAS 2–5', 'EVA 2–5',
          [
            ['Where', 'Onde', 'Front of the knee ± medial line.', 'Face anterior do joelho ± linha medial.'],
            ['How it behaves', 'Como se comporta', 'Worse going down stairs, squatting, kneeling; intermittent swelling.', 'Piora ao descer escadas, agachar, ajoelhar; inchaço intermitente.'],
          ]) +
      '</div>';

    var synth =
      '<div class="painmap-synth">' +
        '<h4>' + t('Synthesis', 'Síntese') + '</h4>' +
        '<p class="lang-en">A state of <strong>chronic, fluctuating and multifocal</strong> pain, dominated by <strong>low-back pain + left-sided sciatica</strong>, with episodes of claudication on walking, layered over neck pain and peripheral joint pain. Functionally: lower tolerance for walking / standing, disturbed sleep and activity avoidance — consistent with the muscle atrophy seen on imaging. On a bad day this is someone significantly limited by pain — but nearly every one of these pain generators has a targeted, validated treatment.</p>' +
        '<p class="lang-pt">Um estado de dor <strong>crônica, flutuante e multifocal</strong>, dominado por <strong>lombalgia + ciática à esquerda</strong>, com episódios de claudicação ao caminhar, somado a dor cervical e a dor articular periférica. Funcionalmente: menor tolerância para caminhar/ficar em pé, sono perturbado e evitação de atividades — coerente com a atrofia muscular vista nas imagens. Num dia ruim, é alguém significativamente limitado pela dor — mas quase todos esses geradores de dor têm tratamento dirigido e validado.</p>' +
      '</div>';

    return (
      '<div class="container">' +
        '<div class="section-label">' + t('04 · AI inference — symptoms, pain level &amp; where', '04 · Inferência da IA — sintomas, nível de dor e onde') + ' <span class="ai-pill">AI</span></div>' +
        '<h2 class="section-title">' + t('What Paulo’s body most likely feels', 'O que o corpo do Paulo provavelmente sente') + '</h2>' +
        '<p class="section-desc">' +
          t('There is no record of symptoms, pain scores or medication in the chart. <strong>Everything below is inferred from the imaging</strong> — the anatomy explains the pain but does not measure it. Even so, taken together the studies confidently sketch the profile of someone living with chronic, fluctuating, multi-region pain.',
            'Não há registro de sintomas, escala de dor ou medicação no prontuário. <strong>Tudo abaixo é inferência a partir das imagens</strong> — a anatomia explica a dor, mas não a mede. Ainda assim, o conjunto desenha, com segurança, o perfil de alguém que convive com dor crônica, flutuante e em várias regiões.') +
        '</p>' +
        '<div class="painwrap">' +
          '<p class="painmap-disclaimer">' +
            t('<strong>Important:</strong> an educational estimate based on imaging alone. Not a diagnosis. The VAS scale (0–10) is presumed. Confirmation requires a consultation with a neurological exam.',
              '<strong>Importante:</strong> estimativa educativa baseada apenas em imagem. Não é diagnóstico. A escala EVA (0–10) é presumida. A confirmação depende de consulta com exame neurológico.') +
          '</p>' +
          '<div class="painlayout">' +
            bodymap +
            zones +
          '</div>' +
          synth +
        '</div>' +
      '</div>'
    );
  }

  // Dock the pain-map section as the LAST content section on the Summary
  // page — below the AI summary card and the Reports block. The danger zone /
  // AI-insights live in the body-level bottom dock beneath main.jc-home, so
  // appending here lands the pain map at the end of the summary content,
  // just above that action dock. renderHome is synchronous; wait until its
  // first .report-section exists so we append after the real content rather
  // than racing an empty main.
  function injectPauloPainMap() {
    injectPauloPainMapStyles();
    var tries = 0;
    (function place() {
      var home = document.querySelector('main.jc-home');
      if (!home) { if (tries++ < 40) setTimeout(place, 80); return; }
      if (document.getElementById('paulo-painmap')) return;
      if (!home.querySelector('.report-section') && tries++ < 25) { setTimeout(place, 80); return; }
      var sec = document.createElement('section');
      sec.id = 'paulo-painmap';
      sec.className = 'report-section paulo-painmap-section';
      sec.innerHTML = renderPauloPainMap();
      home.appendChild(sec); // last content section on the Summary page
    })();
  }

  function fmtLabNum(n) {
    if (n == null || !isFinite(n)) return '';
    var abs = Math.abs(Number(n));
    var s = (abs >= 1000) ? Number(n).toFixed(0)
          : (abs >= 100)  ? Number(n).toFixed(1)
          :                  Number(n).toFixed(2);
    return s.replace(/\.?0+$/, '');
  }

  function classifyLab(value, refLow, refHigh, flag) {
    if (flag === 'H' || flag === 'HH' || flag === 'L' || flag === 'LL') return 'flag';
    if (value == null || !isFinite(value)) return 'normal';
    if (refLow  != null && isFinite(refLow)  && value < refLow)  return 'flag';
    if (refHigh != null && isFinite(refHigh) && value > refHigh) return 'flag';
    return 'normal';
  }

  function pillLabel(status, flag) {
    if (status === 'flag') {
      if (flag === 'H' || flag === 'HH') return t('High', 'Alto');
      if (flag === 'L' || flag === 'LL') return t('Low',  'Baixo');
      return t('Out of range', 'Fora do intervalo');
    }
    if (status === 'watch') return t('Watch', 'Atenção');
    return t('Normal', 'Normal');
  }

  function renderLabBar(value, refLow, refHigh, status) {
    var hasNumericValue = (value != null && isFinite(value));
    var hasLow  = (refLow  != null && isFinite(refLow));
    var hasHigh = (refHigh != null && isFinite(refHigh));
    if (!hasNumericValue || (!hasLow && !hasHigh)) return '';

    // Synthesize the missing bound so one-sided refs still get a bar.
    // Upper-only ("< high"): assume lower bound = 0 (typical for lab markers).
    // Lower-only ("> low"):  assume upper bound = max(low * 2, value * 1.2).
    var lo = hasLow  ? refLow  : 0;
    var hi = hasHigh ? refHigh : Math.max(refLow * 2, value * 1.2, refLow + 1);
    if (hi <= lo) return '';

    var pct = 10 + ((value - lo) / (hi - lo)) * 80;
    if (pct < 0)   pct = 0;
    if (pct > 100) pct = 100;
    var markerCls = (status === 'flag') ? 'lab-bar-marker-flag'
                  : (status === 'watch') ? 'lab-bar-marker-watch'
                  : 'lab-bar-marker-normal';
    var loStr = escapeHtml(fmtLabNum(refLow));
    var hiStr = escapeHtml(fmtLabNum(refHigh));
    var leftLabel  = hasLow
      ? '<span>' + t('min ' + loStr, 'mín ' + loStr) + '</span>'
      : '<span></span>';
    var rightLabel = hasHigh
      ? '<span>' + t('max ' + hiStr, 'máx ' + hiStr) + '</span>'
      : '<span></span>';
    return (
      '<div class="lab-bar-wrap">' +
        '<div class="lab-bar">' +
          '<div class="lab-bar-bg"></div>' +
          '<div class="lab-bar-range"></div>' +
          '<div class="lab-bar-tick lab-bar-tick-min"></div>' +
          '<div class="lab-bar-tick lab-bar-tick-max"></div>' +
          '<div class="lab-bar-marker ' + markerCls + '" style="left: ' + pct.toFixed(2) + '%;">' +
            '<div class="lab-bar-dot"></div>' +
          '</div>' +
        '</div>' +
        '<div class="lab-bar-labels">' + leftLabel + rightLabel + '</div>' +
      '</div>'
    );
  }

  function formatRefText(refLow, refHigh, unit) {
    var lo = (refLow  != null && isFinite(refLow))  ? fmtLabNum(refLow)  : null;
    var hi = (refHigh != null && isFinite(refHigh)) ? fmtLabNum(refHigh) : null;
    var u = unit ? ' ' + escapeHtml(unit) : '';
    if (lo != null && hi != null) return escapeHtml(lo) + ' – ' + escapeHtml(hi) + u;
    if (lo != null) return '&gt; ' + escapeHtml(lo) + u;
    if (hi != null) return '&lt; ' + escapeHtml(hi) + u;
    return '—';
  }

  function renderLabTest(m) {
    var rawValue = m.latest_value != null ? m.latest_value : m.value;
    var value = (rawValue != null && isFinite(Number(rawValue))) ? Number(rawValue) : null;
    var status = classifyLab(value, m.ref_low, m.ref_high, m.flag);
    var pillCls = (status === 'flag') ? 'pill-flag' : (status === 'watch') ? 'pill-watch' : 'pill-ok';
    var valueText = m.latest_value_text != null ? m.latest_value_text : m.value_text;
    var valHtml = (value != null)
      ? '<span class="lab-val-num">' + escapeHtml(fmtLabNum(value)) + '</span>' +
        (m.unit ? ' <span class="lab-val-unit">' + escapeHtml(m.unit) + '</span>' : '')
      : '<span class="lab-val-num">' + escapeHtml(valueText || '—') + '</span>';
    var dateIso = m.latest_taken_at != null ? m.latest_taken_at
                : m.date != null ? m.date
                : m.taken_at;
    var subBits = [];
    if (m.panel) subBits.push(escapeHtml(m.panel));
    if (dateIso) subBits.push(escapeHtml(formatDate(dateIso)));
    var subline = subBits.length
      ? '<span class="lab-test-ref" style="margin-left:auto;">' + subBits.join(' · ') + '</span>'
      : '';
    var hasHistory = !!(m.points && m.points.length > 1);
    var historyBadge = hasHistory
      ? '<span class="lab-test-history-badge" aria-hidden="true">' +
          '<span class="lab-test-history-count">' + m.points.length + '</span>' +
          '<svg class="lab-test-history-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">' +
            '<path d="M2 3.5 L5 7 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
        '</span>'
      : '';
    var cardCls = 'lab-test lab-test-' + status + (hasHistory ? ' lab-test-has-history' : '');
    var attrs = hasHistory
      ? ' role="button" tabindex="0" aria-expanded="false"' +
        ' aria-label="' + tPlain('Click to view exam history', 'Clique para ver o histórico do exame') + '"'
      : '';
    return (
      '<div class="' + cardCls + '"' + attrs + '>' +
        '<div class="lab-test-head">' +
          '<div class="lab-test-name">' + (m.marker_html || escapeHtml(m.marker)) + '</div>' +
          '<div class="lab-test-meta">' +
            '<span class="lab-test-val">' + valHtml + '</span>' +
            '<span class="pill ' + pillCls + '">' + pillLabel(status, m.flag) + '</span>' +
            historyBadge +
          '</div>' +
        '</div>' +
        renderLabBar(value, m.ref_low, m.ref_high, status) +
        '<div class="lab-test-foot">' +
          '<div class="lab-test-ref">' + t('Reference:', 'Referência:') + ' ' + formatRefText(m.ref_low, m.ref_high, m.unit) + '</div>' +
          subline +
        '</div>' +
        renderLabHistory(m) +
      '</div>'
    );
  }

  // Per-card click-to-expand history. Renders one row per sample in
  // m.points (Date · Requested by · Result · Status pill) — newest first,
  // latest row highlighted. Empty string when there's only one sample
  // (no history to show). Caller wraps the result inside .lab-test;
  // installLabHistoryHandler() toggles visibility on card click.
  function renderLabHistory(m) {
    if (!m.points || m.points.length < 2) return '';
    var pts = m.points.slice().sort(function (a, b) {
      return (dateMs(b.taken_at) || 0) - (dateMs(a.taken_at) || 0);
    });
    var rows = pts.map(function (p, i) {
      var v = (p.value != null && isFinite(Number(p.value))) ? Number(p.value) : null;
      var status = classifyLab(v, m.ref_low, m.ref_high, p.flag);
      var pillCls = (status === 'flag') ? 'pill-flag' : (status === 'watch') ? 'pill-watch' : 'pill-ok';
      var valStr = v != null ? fmtLabNum(v) : (p.value_text || '—');
      var dateStr = p.taken_at ? formatDate(p.taken_at) : '—';
      var requested = p.requesting_doctor
        ? escapeHtml(p.requesting_doctor)
        : p.laboratory
          ? '<span class="lab-hist-lab">' + escapeHtml(p.laboratory) + '</span>'
          : '<span class="lab-hist-empty">—</span>';
      var unit = m.unit ? ' <span class="lab-hist-unit">' + escapeHtml(m.unit) + '</span>' : '';
      var rowCls = 'lab-hist-row' + (i === 0 ? ' is-latest' : '');
      return (
        '<tr class="' + rowCls + '">' +
          '<td class="lab-hist-date">' + escapeHtml(dateStr) + '</td>' +
          '<td class="lab-hist-doctor">' + requested + '</td>' +
          '<td class="lab-hist-val">' + escapeHtml(valStr) + unit + '</td>' +
          '<td class="lab-hist-status"><span class="pill ' + pillCls + '">' + pillLabel(status, p.flag) + '</span></td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="lab-test-history" aria-hidden="true">' +
        '<table class="lab-test-history-table">' +
          '<thead><tr>' +
            '<th>' + t('Date', 'Data') + '</th>' +
            '<th>' + t('Requested by', 'Solicitado por') + '</th>' +
            '<th>' + t('Result', 'Resultado') + '</th>' +
            '<th>' + t('Status', 'Status') + '</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  // Patient Zero's physical-exams page is hardcoded HTML — the cards
  // don't pass through renderLabTest(). The historical-comparison table
  // at the bottom of that page already carries every sample, doctor and
  // lab; this function reads it, builds a per-marker history map, then
  // upgrades each .lab-test card in place (badge + role/tabindex +
  // appended .lab-test-history block) so the click-to-expand UX matches
  // LLM-rendered patients. Idempotent. Also runs for Leo, who inherits
  // Joao's static HTML.
  function retrofitStaticLabHistory() {
    var cmpTable = document.querySelector('.lab-cmp-table');
    if (!cmpTable) return;

    // ── 1. Read column metadata from <thead> ─────────────────────
    var colHeaders = cmpTable.querySelectorAll('thead .lab-cmp-col-head');
    var cols = [];
    colHeaders.forEach(function (th) {
      var d = th.querySelector('.lab-cmp-date');
      var l = th.querySelector('.lab-cmp-lab');
      var m = th.querySelector('.lab-cmp-md');
      cols.push({
        date: d ? d.textContent.trim() : '',
        lab: l ? l.textContent.trim() : '',
        doctor: m ? m.textContent.trim() : '',
      });
    });
    if (!cols.length) return;

    // ── 2. Build per-marker history map from <tbody> rows ────────
    var markerHistory = {};
    var bodyRows = cmpTable.querySelectorAll('tbody tr');
    bodyRows.forEach(function (tr) {
      if (tr.classList.contains('lab-cmp-section')) return;
      var nameTh = tr.querySelector('.lab-cmp-marker');
      if (!nameTh) return;
      // Marker name: text content minus the <small class="lab-cmp-unit"> child.
      var unitEl = nameTh.querySelector('.lab-cmp-unit');
      var unitTxt = unitEl ? unitEl.textContent.replace(/^\s*\(|\)\s*$/g, '').trim() : '';
      var clone = nameTh.cloneNode(true);
      var cloneUnit = clone.querySelector('.lab-cmp-unit');
      if (cloneUnit) cloneUnit.remove();
      var markerName = clone.textContent.trim();
      if (!markerName) return;

      var valCells = tr.querySelectorAll('td.lab-cmp-val');
      var samples = [];
      valCells.forEach(function (td, i) {
        var col = cols[i];
        if (!col) return;
        if (td.classList.contains('lab-cmp-empty')) return;
        var raw = td.textContent.trim();
        if (!raw || raw === '—' || raw === '-') return;
        samples.push({
          date: col.date,
          lab: col.lab,
          doctor: col.doctor,
          value: raw,
          unit: unitTxt,
          flag: td.getAttribute('data-flag') || '',
        });
      });
      if (samples.length > 1) {
        markerHistory[markerName.toLowerCase()] = samples;
      }
    });
    if (!Object.keys(markerHistory).length) return;

    // ── 3. Walk every .lab-test card and upgrade where matching ──
    var cards = document.querySelectorAll('.lab-test');
    cards.forEach(function (card) {
      if (card.classList.contains('lab-test-has-history')) return;
      if (card.querySelector('.lab-test-history')) return;

      var nameEl = card.querySelector('.lab-test-name');
      if (!nameEl) return;
      // Strip the PT alternative span before matching.
      var nameClone = nameEl.cloneNode(true);
      var ptEls = nameClone.querySelectorAll('.lab-name-pt');
      ptEls.forEach(function (el) { el.remove(); });
      var cardMarker = nameClone.textContent.trim().toLowerCase();

      var samples = markerHistory[cardMarker];
      if (!samples) return;

      var rowsHtml = samples.map(function (s, i) {
        var rowCls = 'lab-hist-row' + (i === 0 ? ' is-latest' : '');
        var pillCls, pillLabel;
        if (s.flag === 'high') {
          pillCls = 'pill-flag';
          pillLabel = '<span class="lang-en">High</span><span class="lang-pt">Alto</span>';
        } else if (s.flag === 'low') {
          pillCls = 'pill-flag';
          pillLabel = '<span class="lang-en">Low</span><span class="lang-pt">Baixo</span>';
        } else {
          pillCls = 'pill-ok';
          pillLabel = '<span class="lang-en">Normal</span><span class="lang-pt">Normal</span>';
        }
        var requested = (s.doctor && s.doctor !== '—')
          ? escapeHtml(s.doctor)
          : (s.lab && s.lab !== '—')
            ? '<span class="lab-hist-lab">' + escapeHtml(s.lab) + '</span>'
            : '<span class="lab-hist-empty">—</span>';
        var unit = s.unit ? ' <span class="lab-hist-unit">' + escapeHtml(s.unit) + '</span>' : '';
        return (
          '<tr class="' + rowCls + '">' +
            '<td class="lab-hist-date">' + escapeHtml(s.date) + '</td>' +
            '<td class="lab-hist-doctor">' + requested + '</td>' +
            '<td class="lab-hist-val">' + escapeHtml(s.value) + unit + '</td>' +
            '<td class="lab-hist-status"><span class="pill ' + pillCls + '">' + pillLabel + '</span></td>' +
          '</tr>'
        );
      }).join('');

      var historyHtml =
        '<div class="lab-test-history" aria-hidden="true">' +
          '<table class="lab-test-history-table">' +
            '<thead><tr>' +
              '<th><span class="lang-en">Date</span><span class="lang-pt">Data</span></th>' +
              '<th><span class="lang-en">Requested by</span><span class="lang-pt">Solicitado por</span></th>' +
              '<th><span class="lang-en">Result</span><span class="lang-pt">Resultado</span></th>' +
              '<th><span class="lang-en">Status</span><span class="lang-pt">Status</span></th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>';

      card.classList.add('lab-test-has-history');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-expanded', 'false');

      var meta = card.querySelector('.lab-test-meta');
      if (meta && !meta.querySelector('.lab-test-history-badge')) {
        var badge = document.createElement('span');
        badge.className = 'lab-test-history-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.innerHTML =
          '<span class="lab-test-history-count">' + samples.length + '</span>' +
          '<svg class="lab-test-history-caret" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">' +
            '<path d="M2 3.5 L5 7 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
        meta.appendChild(badge);
      }

      card.insertAdjacentHTML('beforeend', historyHtml);
    });
  }

  // Delegated click + keyboard toggler for .lab-test-has-history cards.
  // Idempotent: installs the listener once per page load.
  function installLabHistoryHandler() {
    if (document.body && document.body.dataset.jcLabHistoryHandler === '1') return;
    if (document.body) document.body.dataset.jcLabHistoryHandler = '1';
    function toggle(card) {
      var open = card.classList.toggle('is-open');
      card.setAttribute('aria-expanded', open ? 'true' : 'false');
      var hist = card.querySelector('.lab-test-history');
      if (hist) hist.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    document.addEventListener('click', function (e) {
      var card = e.target && e.target.closest && e.target.closest('.lab-test-has-history');
      if (!card) return;
      if (e.target.closest('a, button, input, select, textarea')) return;
      toggle(card);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var card = e.target && e.target.closest && e.target.closest('.lab-test-has-history');
      if (!card || card !== e.target) return;
      e.preventDefault();
      toggle(card);
    });
  }

  // Regroup the API's DB-grouped panels into the curated standard panels from
  // window.LAB_TAXONOMY (lab-taxonomy.js): each marker gets a bilingual
  // marker_html and is bucketed into its standard panel, panels render in the
  // taxonomy's order, markers in their declared order. This is what makes a
  // DB-driven patient's Exams page read like Patient Zero's curated one. If the
  // taxonomy asset isn't loaded, returns the panels untouched (graceful
  // fallback to the raw DB panel/marker names).
  function regroupByTaxonomy(panels) {
    var TAX = (typeof window !== 'undefined') && window.LAB_TAXONOMY;
    if (!TAX || !TAX.MARKERS || !TAX.PANELS) return panels;
    var order = {}; // marker key -> declaration index, for stable in-panel ordering
    Object.keys(TAX.MARKERS).forEach(function (k, i) { order[k] = i; });
    var byPanel = {};
    panels.forEach(function (pn) {
      (pn.markers || []).forEach(function (m) {
        var meta = TAX.MARKERS[m.marker];
        var pkey = meta ? meta.panel : 'other';
        if (meta) m.marker_html = t(escapeHtml(meta.en), escapeHtml(meta.pt));
        (byPanel[pkey] = byPanel[pkey] || []).push(m);
      });
    });
    var out = [];
    TAX.PANELS.forEach(function (pdef) {
      var ms = byPanel[pdef.key];
      if (!ms || !ms.length) return;
      ms.sort(function (a, b) {
        var ai = order[a.marker], bi = order[b.marker];
        if (ai == null) ai = 9999; if (bi == null) bi = 9999;
        return ai - bi;
      });
      out.push({ panel: pdef.en, panel_html: t(escapeHtml(pdef.en), escapeHtml(pdef.pt)), markers: ms });
    });
    return out;
  }

  function renderExams(exams) {
    var p = exams.patient || {};
    var panels = regroupByTaxonomy(exams.panels || []);
    var docs = exams.lab_documents || [];
    var imaging = exams.imaging || [];
    var ecg = exams.ecg_studies || [];
    // Drugs present in this patient's record drive the AI cards' interaction
    // and "meds that move this marker" hints. Empty for patients with no meds.
    var drugSet = detectDrugs(exams.medications, exams.supplements);

    var panelsHtml = panels.length === 0
      ? '<div class="ov-empty">' +
          t('No lab results yet. Upload exam PDFs from Add data; once parsed they appear here grouped by panel.',
            'Sem resultados de exames. Envie PDFs em "Adicionar dados"; após processados aparecerão aqui agrupados por painel.') +
        '</div>'
      : '<div class="lab-panel-grid">' + panels.map(function (pn) {
          var body = pn.markers.map(renderLabTest).join('');
          var n = pn.markers.length;
          var countHtml = n + ' ' + t(n === 1 ? 'marker' : 'markers', n === 1 ? 'marcador' : 'marcadores');
          return (
            '<details class="lab-panel" open>' +
              '<summary class="lab-panel-head">' +
                '<span class="lab-panel-title">' + (pn.panel_html || escapeHtml(pn.panel)) + '</span>' +
                '<span class="lab-panel-sub"></span>' +
                '<span class="lab-panel-count">' + countHtml + '</span>' +
              '</summary>' +
              '<div class="lab-panel-body">' + body + '</div>' +
            '</details>'
          );
        }).join('') + '</div>';

    // Bilingual study label from modality + body part.
    function imagingTitle(s) {
      if (s.modality === 'US' && s.body_part === 'heart') return t('Echocardiogram', 'Ecocardiograma');
      if (s.modality === 'CT' && s.body_part === 'heart') return t('Cardiac CT', 'TC cardíaca');
      var mod = { MRI: ['MRI', 'RM'], CT: ['CT', 'TC'], US: ['Ultrasound', 'US'], PET: ['PET', 'PET'],
                  XR: ['X-ray', 'RX'], EEG: ['EEG', 'EEG'], ECG: ['ECG', 'ECG'] }[s.modality] ||
                [s.modality || 'Imaging', s.modality || 'Imagem'];
      var body = { lumbar_spine: ['Lumbar spine', 'Coluna lombar'], thigh: ['Thigh / femur', 'Coxa / fêmur'],
                   cervical_spine: ['Cervical spine', 'Coluna cervical'], heart: ['Heart', 'Coração'],
                   head: ['Head', 'Cabeça'] }[s.body_part] || (s.body_part ? [s.body_part, s.body_part] : ['', '']);
      var en = (body[0] ? body[0] + ' ' : '') + mod[0];
      var pt = (body[1] ? body[1] + ' — ' : '') + mod[1];
      return t(escapeHtml(en), escapeHtml(pt));
    }

    // One imaging study: bilingual title + (interactive .ct-viewer if it has a
    // manifest with images) + report button. The .ct-viewer is wired by app.js's
    // generic ways/stacks engine via window.JCInitCtViewers() after injection.
    function renderImagingStudy(s) {
      var meta = escapeHtml(formatDate(s.study_date)) +
                 (s.file_count ? ' · ' + s.file_count + ' ' + t('images', 'imagens') : '');
      var reportBtn = s.report_blob_key
        ? '<div class="report-export-row"><a class="export-btn-primary" href="' + escapeHtml(s.report_blob_key) +
            '" target="_blank" rel="noopener">' + t('Report (PDF)', 'Laudo (PDF)') + '</a></div>'
        : '';
      var body;
      if (s.manifest_blob_key && s.file_count > 0) {
        var prefix = s.manifest_blob_key.replace(/-manifest\.json$/, '/');
        body =
          '<div class="ct-grid ct-grid-single">' +
            '<div class="ct-viewer" data-prefix="' + escapeHtml(prefix) + '" data-manifest="' + escapeHtml(s.manifest_blob_key) + '?v=1">' +
              '<div class="ct-viewer-head">' +
                '<div class="ct-viewer-title">' + t('Series viewer', 'Visualizador por série') + '</div>' +
                '<div class="ct-viewer-meta">' +
                  '<span class="ct-lbl ct-lbl-2d">' + t('Image', 'Imagem') + '</span>' +
                  '<span class="ct-lbl ct-lbl-3d">' + t('View', 'Vista') + '</span> ' +
                  '<span class="ct-idx">1</span> / <span class="ct-total">1</span><span class="ct-rot"></span>' +
                '</div>' +
              '</div>' +
              '<div class="ct-controls"></div>' +
              '<div class="ct-stage"><img class="ct-img" alt="" loading="eager"></div>' +
              '<input class="ct-slider" type="range" min="0" max="0" value="0" aria-label="slice">' +
            '</div>' +
          '</div>';
      } else {
        body = '<div class="ov-section-note">' +
          t('Report only — no image series in this study.', 'Apenas laudo — sem série de imagens neste exame.') + '</div>';
      }
      return '<div class="img-study" data-manifest="' + escapeHtml(s.manifest_blob_key || '') + '">' +
        '<h3 class="img-study-title">' + imagingTitle(s) + ' <span class="ov-count-inline">' + meta + '</span></h3>' +
        reportBtn + body +
      '</div>';
    }

    var imagingHtml = imaging.length === 0 ? '' :
      '<section class="ov-section" id="imaging">' +
        '<h2>' + t('Imaging studies', 'Estudos de imagem') + ' <span class="ov-count-inline">' + imaging.length + '</span></h2>' +
        imaging.map(renderImagingStudy).join('') +
      '</section>';

    var docsHtml = docs.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>' + t('Source PDFs', 'PDFs de origem') + ' <span class="ov-count-inline">' + docs.length + '</span></h2>' +
        '<p class="ov-section-note">' +
          t('PDFs uploaded to this patient. Items marked "unclassified" landed here because the LLM classifier was unreachable when they were ingested.',
            'PDFs enviados deste paciente. Itens marcados como "não classificado" pararam aqui porque o classificador LLM estava indisponível durante a ingestão.') +
        '</p>' +
        renderDocList(docs) +
      '</section>';

    var ecgInner = buildEcgSectionHtml(ecg, p.clerk_user_id);
    var ecgHtml = ecgInner === '' ? '' :
      '<section class="ov-section" id="ecg">' +
        '<h2>' + t('Electrocardiogram', 'Eletrocardiograma') +
          ' <span class="ov-count-inline">' + ecg.length + '</span></h2>' +
        ecgInner +
      '</section>';

    var comparisonHtml = renderHistoricalComparison(panels);

    // Title before the panels begin, so the section is always clearly labelled.
    var totalMarkers = panels.reduce(function (acc, pn) { return acc + pn.markers.length; }, 0);
    var panelsTitleInner = panels.length === 0 ? '' :
      t('Blood &amp; urine panel', 'Painel de sangue e urina') +
        ' <span class="ov-count-inline">' + totalMarkers + ' ' +
        t(totalMarkers === 1 ? 'marker' : 'markers', totalMarkers === 1 ? 'marcador' : 'marcadores') +
      '</span>';

    var view = document.createElement('main');
    view.className = 'jc-overview jc-exams';
    view.innerHTML =
      '<div class="ov-shell">' +
        renderPatientHeader(p) +
        '<div class="ov-section-eyebrow">' + t('Physical → Exams', 'Físico → Exames') + '</div>' +
        '<section class="ov-ai-summary" id="exams-ai-summary"></section>' +
        '<h2 class="ov-panels-title" id="blood-urine">' + panelsTitleInner + '</h2>' +
        panelsHtml +
        comparisonHtml +
        imagingHtml +
        ecgHtml +
        docsHtml +
      '</div>';
    document.body.appendChild(view);
    // Wire any .ct-viewer blocks we just injected (app.js's generic engine).
    if (typeof window !== 'undefined' && window.JCInitCtViewers) window.JCInitCtViewers();
    hydrateEcgCharts(view, p.clerk_user_id); // inject the Lumen ECG SVG(s) inline
    wireEcgSwitcher(view, ecg, p.clerk_user_id); // date pill + version dropdown

    function amberCardHtml(label, bodyHtml) {
      return '<div class="ov-ai-inner">' +
        '<div class="ov-ai-head">' + aiPill() + ' <span class="ov-ai-label">' + label + '</span></div>' +
        '<div class="ov-ai-body">' + bodyHtml + '</div>' +
        '<div class="ov-ai-disc">' +
          t('AI-generated explanation from your data — not a diagnosis. Discuss with your doctor.',
            'Explicação gerada por IA a partir dos seus dados — não é um diagnóstico. Converse com seu médico.') +
        '</div></div>';
    }
    function dirOf(m) {
      var v = m.latest_value;
      if (typeof v !== 'number' || !isFinite(v)) return null;
      if (m.flag === 'H' || m.flag === 'HH' || (m.ref_high != null && v > m.ref_high)) return 'high';
      if (m.flag === 'L' || m.flag === 'LL' || (m.ref_low != null && v < m.ref_low)) return 'low';
      return null;
    }
    function offFromPanels(pnls) {
      var off = [];
      (pnls || []).forEach(function (pn) {
        (pn.markers || []).forEach(function (m) {
          var dir = dirOf(m);
          if (dir) off.push({ marker: m.marker_html || escapeHtml(m.marker), key: String(m.marker || '').toLowerCase(), v: m.latest_value, unit: m.unit || '', dir: dir });
        });
      });
      return off;
    }
    // De-identified, patient-friendly explanations keyed by canonical analyte.
    // Generic + reusable across patients; neutral fallback keeps the invariant.
    var LAB_EXPL = {
      'eosinophils': { en: 'A low eosinophil count is common and usually temporary — it can follow stress, infection, or steroid use and is generally not a concern on its own.', pt: 'Uma contagem baixa de eosinófilos é comum e geralmente temporária — pode ocorrer após estresse, infecção ou uso de corticoide e, isoladamente, costuma não ser preocupante.' },
      'eosinophils (abs)': { en: 'A low eosinophil count is common and usually temporary — often related to stress or steroids and generally not a concern on its own.', pt: 'Contagem baixa de eosinófilos é comum e geralmente temporária — muitas vezes ligada a estresse ou corticoides e, isoladamente, sem maior significado.' },
      'basophils (abs)': { en: 'A low basophil count is common and usually not clinically significant on its own.', pt: 'Contagem baixa de basófilos é comum e geralmente sem significado clínico isolado.' },
      'aptt': { en: 'A slightly long aPTT (a clotting time) is often a lab or sampling effect, or a mild variation; a single mildly high value is usually just rechecked.', pt: 'Um TTPA (tempo de coagulação) levemente alongado costuma ser efeito de coleta/laboratório ou variação leve; um único valor pouco alterado geralmente é apenas repetido.' },
      'egfr': { en: 'An eGFR a little below 90 suggests mildly reduced kidney filtration, which is common with age — the trend over time matters more than a single value.', pt: 'Uma TFG um pouco abaixo de 90 sugere filtração renal levemente reduzida, comum com a idade — a tendência ao longo do tempo importa mais que um único valor.' },
      'alt': { en: 'A low ALT (a liver enzyme) is generally benign and not a sign of liver disease.', pt: 'Um ALT (enzima do fígado) baixo costuma ser benigno e não indica doença hepática.' },
    };
    function labExpl(m) {
      var k = String(m.marker || '').toLowerCase().replace(/\s*\(abs\)/, ' (abs)');
      var e = LAB_EXPL[k] || LAB_EXPL[k.replace(/\s*\(abs\)$/, '')];
      return e ? t(escapeHtml(e.en), escapeHtml(e.pt))
               : t('This value is outside its reference range — worth a mention to your doctor.',
                   'Este valor está fora da faixa de referência — vale comentar com seu médico.');
    }
    // Possible reasons drawn ONLY from the patient's own record. When the
    // patient has meds/supplements, the per-marker notes above already name the
    // specific drug links, so this footer just points there; otherwise it keeps
    // the sparse-record line (no meds to correlate against, so say so plainly).
    function anyDrug() { return Object.keys(drugSet).length > 0; }
    function labReasonsHtml() {
      var body = anyDrug()
        ? t('Possible reasons: some of these can be expected effects of your current medications or supplements — see the medication notes above. Worth confirming with your doctor.',
            'Possíveis causas: alguns destes podem ser efeitos esperados dos seus medicamentos ou suplementos atuais — veja as notas de medicação acima. Vale confirmar com seu médico.')
        : t('Possible reasons: your current records show no medications, supplements, genetics, or related conditions that would explain this. Worth discussing with your doctor.',
            'Possíveis causas: seus registros atuais não mostram medicamentos, suplementos, genética ou condições relacionadas que expliquem isto. Vale conversar com seu médico.');
      return '<p class="ov-ai-reasons">' + body + '</p>';
    }
    function examsSummaryHtml(off, imgCount) {
      var bits = [];
      // Plain-language intro — explanation, not just numbers.
      if (off.length) {
        bits.push('<p>' + t(
          'This is a plain-language summary of your exams. Most of your blood and urine values are within their normal ranges; the ' + off.length + ' that fall outside are listed below and explained where they appear — values that are out of range like these are most often mild and common rather than a sign of a serious problem. Your imaging studies are summarized in their own cards further down. This is a summary, not a diagnosis — worth going over the highlights with your doctor.',
          'Este é um resumo em linguagem simples dos seus exames. A maioria dos seus valores de sangue e urina está dentro das faixas normais; os ' + off.length + ' que estão fora são listados abaixo e explicados onde aparecem — valores alterados como estes costumam ser leves e comuns, e não sinal de um problema grave. Seus exames de imagem são resumidos nos cartões mais abaixo. Este é um resumo, não um diagnóstico — vale revisar os destaques com seu médico.'
        ) + '</p>');
      } else {
        bits.push('<p>' + t(
          'This is a plain-language summary of your exams. All of your blood and urine values that were reviewed are within their normal reference ranges. Your imaging studies are summarized in their own cards further down. This is a summary, not a diagnosis — worth going over with your doctor.',
          'Este é um resumo em linguagem simples dos seus exames. Todos os seus valores de sangue e urina revisados estão dentro das faixas normais de referência. Seus exames de imagem são resumidos nos cartões mais abaixo. Este é um resumo, não um diagnóstico — vale conversar com seu médico.'
        ) + '</p>');
      }
      if (off.length) {
        var items = off.map(function (o) {
          var fx = medEffectsFor(o.key, o.dir, drugSet);
          var fxHtml = fx.length
            ? ' <span class="ov-ai-med">' + t('Medication note: ', 'Nota de medicação: ') +
                fx.map(function (e) { return t(e.text.en, e.text.pt); }).join(' ') + '</span>'
            : '';
          return '<li>' + o.marker + ' — <strong>' + o.v + (o.unit ? ' ' + escapeHtml(o.unit) : '') + '</strong> (' +
            (o.dir === 'high' ? t('high', 'alto') : t('low', 'baixo')) + ')' + fxHtml + '</li>';
        }).join('');
        bits.push('<p>' + t('Lab values outside their reference range:', 'Valores laboratoriais fora da faixa de referência:') +
          '</p><ul class="ov-ai-list">' + items + '</ul>' +
          '<p><a href="#blood-urine">' + t('See blood &amp; urine panel', 'Ver painel de sangue e urina') + '</a></p>');
      }
      // Cross-specialty interaction check — the silo problem made explicit:
      // each prescriber sees only their own slice, so a pairing can hide.
      var inter = interactionsFor(drugSet);
      if (inter.length) {
        bits.push('<p class="ov-ai-interact-lead"><strong>' +
          t('Cross-specialty check — possible medication interactions',
            'Checagem entre especialidades — possíveis interações medicamentosas') + '</strong></p>' +
          '<p>' + t('These surface because different specialists may each prescribe without seeing your full list. Not necessarily a problem — worth confirming with your doctor or pharmacist:',
            'Aparecem porque especialistas diferentes podem prescrever sem ver sua lista completa. Não necessariamente um problema — vale confirmar com seu médico ou farmacêutico:') +
          '</p><ul class="ov-ai-list ov-ai-interact">' +
          inter.map(function (x) { return '<li>' + t(x.en, x.pt) + '</li>'; }).join('') + '</ul>');
      }
      if (imgCount) {
        bits.push('<p>' + imgCount + ' ' +
          t('imaging studies on record — each with its report and a plain explanation below.',
            'exames de imagem no registro — cada um com seu laudo e uma explicação simples abaixo.') +
          ' <a href="#imaging">' + t('See imaging', 'Ver imagens') + '</a></p>');
      }
      return amberCardHtml(t('AI Summary', 'Resumo por IA'), bits.join(''));
    }
    function fillExamsAi(pnls, imgs) {
      // 1.2.1 consolidated AI Summary at the top of Exams.
      var summaryEl = document.getElementById('exams-ai-summary');
      if (summaryEl) summaryEl.innerHTML = examsSummaryHtml(offFromPanels(pnls), (imgs || []).length);

      // Per blood panel with out-of-range values: one grouped amber card —
      // what each marker means + possible reasons grounded in the patient's record.
      // Scope to OUR rendered view — Patient Zero's hidden static page also has a
      // .lab-panel-grid, and an unscoped index would inject into those hidden panels.
      var examMain = document.querySelector('main.jc-exams');
      var gridPanels = examMain ? examMain.querySelectorAll('.lab-panel-grid > .lab-panel') : [];
      (pnls || []).forEach(function (pn, i) {
        var offM = (pn.markers || []).filter(function (m) { return dirOf(m); });
        if (!offM.length) return;
        var el = gridPanels[i];
        if (!el || el.querySelector('.ov-ai-card')) return;
        var implicated = {}; // drug ids this panel's flagged markers point at
        var lis = offM.map(function (m) {
          var dir = dirOf(m);
          var fx = medEffectsFor(String(m.marker || '').toLowerCase(), dir, drugSet);
          var fxHtml = fx.map(function (e) {
            e.drugs.forEach(function (id) { implicated[id] = true; });
            return ' <span class="ov-ai-med">' + t('Medication note: ', 'Nota de medicação: ') + t(e.text.en, e.text.pt) + '</span>';
          }).join('');
          return '<li><strong>' + (m.marker_html || escapeHtml(m.marker)) + '</strong> (' +
            (dir === 'high' ? t('high', 'alto') : t('low', 'baixo')) + ') — ' + labExpl(m) + fxHtml + '</li>';
        }).join('');
        // Interactions scoped to the drugs THIS panel's off markers implicate,
        // so the cross-specialty hint lands where it's relevant.
        var panelInter = Object.keys(implicated).length ? interactionsFor(drugSet, implicated) : [];
        var interHtml = panelInter.length
          ? '<p class="ov-ai-interact-lead"><strong>' +
              t('Interactions to flag across your specialists', 'Interações a sinalizar entre seus especialistas') + '</strong></p>' +
              '<ul class="ov-ai-list ov-ai-interact">' +
              panelInter.map(function (x) { return '<li>' + t(x.en, x.pt) + '</li>'; }).join('') + '</ul>'
          : '';
        var card = document.createElement('div');
        card.className = 'ov-ai-card';
        card.innerHTML = amberCardHtml(t('What this can mean', 'O que isto pode significar'),
          '<ul class="ov-ai-list">' + lis + '</ul>' + interHtml + labReasonsHtml());
        var bodyEl = el.querySelector('.lab-panel-body') || el;
        bodyEl.appendChild(card);
      });

      // Per imagery study: doctor's report TEXT below the viewer, then the AI card
      // (Joao's structure: viewer -> radiologist's report -> impression).
      var withMan = (imgs || []).filter(function (s) { return s.manifest_blob_key; });
      Promise.all(withMan.map(function (s) {
        return fetch(s.manifest_blob_key + '?v=2').then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; }).then(function (m) { return { s: s, m: m }; });
      })).then(function (res) {
        res.forEach(function (rr) {
          if (!rr.m) return;
          var host = document.querySelector('.img-study[data-manifest="' + rr.s.manifest_blob_key + '"]');
          if (!host) return;
          var rep = rr.m.report && (Array.isArray(rr.m.report) ? rr.m.report[0] : rr.m.report);
          if (rep && rep.textPt && !host.querySelector('.img-report')) {
            var doc = rr.m.reportingDoctor
              ? '<p class="img-report-doc">' + t('Reported by', 'Laudo por') + ': ' + escapeHtml(rr.m.reportingDoctor) + '</p>'
              : '';
            var rd = document.createElement('div');
            rd.className = 'img-report';
            rd.innerHTML = '<h4 class="img-report-h">' + t('Radiologist\'s report', 'Laudo do radiologista') + '</h4>' +
              '<div class="list-card"><p class="img-report-text">' + escapeHtml(rep.textPt) + '</p>' + doc + '</div>';
            host.appendChild(rd);
          }
          if (rr.m.aiFinding && !host.querySelector('.ov-ai-card')) {
            var card = document.createElement('div');
            card.className = 'ov-ai-card';
            card.innerHTML = amberCardHtml(t('What this can mean', 'O que isto pode significar'),
              t(escapeHtml(rr.m.aiFinding.en), escapeHtml(rr.m.aiFinding.pt)));
            host.appendChild(card);
          }
        });
      });
    }

    // Amber-card invariant: consolidated AI Summary at top + per-panel lab cards
    // + per-imagery finding cards. Called after all defs so LAB_EXPL is assigned.
    fillExamsAi(panels, imaging);
  }

  function renderHistoricalComparison(panels) {
    // Build the union of (date, lab, doctor) samples across every marker.
    // Each unique sample = one column; each marker = one row; panel boundaries
    // become tbody section headers — mirroring the Patient-Zero lab-cmp-table.
    var sampleMap = {}; // key -> { date, laboratory, doctor, ts }
    var anyMultiple = false;
    panels.forEach(function (pn) {
      pn.markers.forEach(function (m) {
        if (m.points && m.points.length > 1) anyMultiple = true;
        (m.points || []).forEach(function (p) {
          var key = (p.taken_at || '') + '|' + (p.laboratory || '') + '|' + (p.requesting_doctor || '');
          if (!sampleMap[key]) {
            sampleMap[key] = {
              key: key,
              date: p.taken_at,
              laboratory: p.laboratory,
              doctor: p.requesting_doctor,
              ts: dateMs(p.taken_at) || 0,
            };
          }
        });
      });
    });
    var samples = Object.keys(sampleMap).map(function (k) { return sampleMap[k]; });
    if (samples.length < 2 || !anyMultiple) return ''; // nothing to compare
    samples.sort(function (a, b) { return b.ts - a.ts; }); // newest first

    var headerCols = samples.map(function (s, i) {
      var dateLbl = s.date ? escapeHtml(formatDate(s.date)) : '—';
      var labLbl  = s.laboratory ? escapeHtml(s.laboratory) : '—';
      var docLbl  = s.doctor ? escapeHtml(s.doctor) : '—';
      var cls = 'lab-cmp-col-head' + (i === 0 ? ' lab-cmp-col-latest' : '');
      return (
        '<th class="' + cls + '">' +
          '<div class="lab-cmp-date">' + dateLbl + '</div>' +
          '<div class="lab-cmp-lab">' + labLbl + '</div>' +
          '<div class="lab-cmp-md">' + docLbl + '</div>' +
        '</th>'
      );
    }).join('');

    var bodyRows = panels.map(function (pn) {
      var rows = pn.markers.map(function (m) {
        // Index points by sample key for O(1) lookup.
        var byKey = {};
        (m.points || []).forEach(function (p) {
          var k = (p.taken_at || '') + '|' + (p.laboratory || '') + '|' + (p.requesting_doctor || '');
          byKey[k] = p;
        });
        var cells = samples.map(function (s, i) {
          var p = byKey[s.key];
          if (!p) return '<td class="lab-cmp-val lab-cmp-empty">—</td>';
          var v = (p.value != null && isFinite(Number(p.value)))
            ? fmtLabNum(Number(p.value))
            : (p.value_text || '—');
          var flagAttr = (p.flag === 'H' || p.flag === 'HH') ? ' data-flag="high"'
                       : (p.flag === 'L' || p.flag === 'LL') ? ' data-flag="low"' : '';
          var cls = 'lab-cmp-val' + (i === 0 ? ' lab-cmp-latest' : '');
          return '<td class="' + cls + '"' + flagAttr + '>' + escapeHtml(String(v)) + '</td>';
        }).join('');
        var unit = m.unit ? ' <small class="lab-cmp-unit">(' + escapeHtml(m.unit) + ')</small>' : '';
        return (
          '<tr>' +
            '<th class="lab-cmp-marker">' + (m.marker_html || escapeHtml(m.marker)) + unit + '</th>' +
            cells +
          '</tr>'
        );
      }).join('');
      return (
        '<tr class="lab-cmp-section"><th colspan="' + (samples.length + 1) + '">' + (pn.panel_html || escapeHtml(pn.panel)) + '</th></tr>' +
        rows
      );
    }).join('');

    var nMarkers = panels.reduce(function (acc, pn) { return acc + pn.markers.length; }, 0);
    var countLine = nMarkers + ' ' + t(nMarkers === 1 ? 'marker' : 'markers', nMarkers === 1 ? 'marcador' : 'marcadores') +
                    ' · ' + samples.length + ' ' + t(samples.length === 1 ? 'sample' : 'samples', samples.length === 1 ? 'amostra' : 'amostras');

    return (
      '<details class="lab-panel" open style="margin-top:18px;">' +
        '<summary class="lab-panel-head">' +
          '<span class="lab-panel-title">' + t('Historical comparison', 'Comparação histórica') + '</span>' +
          '<span class="lab-panel-sub">' +
            t('All samples side-by-side · most recent at left · empty cells where a marker wasn\'t tested',
              'Todas as amostras lado a lado · mais recente à esquerda · células vazias onde um marcador não foi dosado') +
          '</span>' +
          '<span class="lab-panel-count">' + countLine + '</span>' +
        '</summary>' +
        '<div class="lab-panel-body">' +
          '<div class="lab-cmp-wrap">' +
            '<table class="lab-cmp-table">' +
              '<thead><tr>' +
                '<th class="lab-cmp-marker-head">' + t('Marker', 'Marcador') + '</th>' +
                headerCols +
              '</tr></thead>' +
              '<tbody>' + bodyRows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }

  /* ── Generic section views ────────────────────────────────────────
     For every section page other than home + physical-exams we used to
     just render the "Not built yet" shell. The summary endpoint already
     gives us per-pillar counts, recent docs and recent labs, so we now
     render a proper data-driven landing instead.                      */

  function renderMetricGrid(rows) {
    return (
      '<section class="ov-section">' +
        '<div class="ov-metrics">' + rows.map(function (r) {
          // r.label is pre-built HTML (typically via t()). Don't escape.
          var inner =
            '<div class="ov-metric-num">' + escapeHtml(String(r.value)) + '</div>' +
            '<div class="ov-metric-label">' + r.label + '</div>';
          return r.href
            ? '<a class="ov-metric ov-metric-link" href="' + r.href + '">' + inner + '</a>'
            : '<div class="ov-metric">' + inner + '</div>';
        }).join('') + '</div>' +
      '</section>'
    );
  }

  function renderSectionView(opts) {
    /* opts: { summary, title, eyebrow, metrics, emptyHint, extra }
       eyebrow and emptyHint are pre-built HTML (already paired via t()). */
    var p = (opts.summary && opts.summary.patient) || {};
    var pending = (opts.summary && opts.summary.pending_files) || [];
    var anyValue = (opts.metrics || []).some(function (m) { return m.value > 0; });

    document.title = 'Lumen Health — ' + opts.title + ' · ' + (p.full_name || 'Patient');

    var view = document.createElement('main');
    view.className = 'jc-overview jc-section';
    view.innerHTML =
      '<div class="ov-shell">' +
        renderPatientHeader(p) +
        renderPendingBanner(pending) +
        '<div class="ov-section-eyebrow">' + opts.eyebrow + '</div>' +
        renderMetricGrid(opts.metrics) +
        (anyValue ? '' :
          '<div class="ov-section ov-empty-hint">' +
            '<p>' + opts.emptyHint + '</p>' +
          '</div>') +
        (opts.extra || '') +
      '</div>';
    document.body.appendChild(view);
  }

  function recentSection(titleHtml, count, body) {
    return (
      '<section class="ov-section">' +
        '<h2>' + titleHtml + ' <span class="ov-count-inline">' + count + '</span></h2>' +
        body +
      '</section>'
    );
  }

  // Physical Health Overview = the canonical hub: three options (Vitals, Exams,
  // Genetics). It does NOT show the data itself — Exams holds blood + imaging one
  // click away. Each card carries a live count (or "no data yet"); empty options
  // stay visible as the structural frame and open to a clean empty state.
  function renderPhysical(summary) {
    var p = summary.patient || {};
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    function statusPill(n, en, pt) {
      return n > 0
        ? '<span class="pill pill-info">' + n + ' ' + t(en, pt) + '</span>'
        : '<span class="pill">' + t('No data yet', 'Sem dados ainda') + '</span>';
    }
    var SVG = 'viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"';
    var ICON_VITALS = '<svg class="entry-icon" ' + SVG + '><circle cx="32" cy="32" r="22" fill="rgba(36,78,110,0.10)" stroke="#244E6E" stroke-width="1.5"/><polyline points="14,32 22,32 26,22 30,42 34,28 38,36 42,32 50,32" stroke="#B8860B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_EXAMS = '<svg class="entry-icon" ' + SVG + '><line x1="20" y1="8" x2="44" y2="8" stroke="#244E6E" stroke-width="2" stroke-linecap="round"/><path d="M22 8 L22 46 C22 52 26 56 32 56 C38 56 42 52 42 46 L42 8 Z" fill="rgba(36,78,110,0.10)" stroke="#244E6E" stroke-width="1.5" stroke-linejoin="round"/><path d="M22 34 L22 46 C22 52 26 56 32 56 C38 56 42 52 42 46 L42 34 Z" fill="rgba(184,134,11,0.55)"/></svg>';
    var ICON_GEN = '<svg class="entry-icon" ' + SVG + '><path d="M24 10 C44 22 24 42 44 54" stroke="#244E6E" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M44 10 C24 22 44 42 24 54" stroke="#B8860B" stroke-width="2" fill="none" stroke-linecap="round"/><line x1="27" y1="18" x2="41" y2="18" stroke="#7A8FA6" stroke-width="1.5"/><line x1="29" y1="32" x2="39" y2="32" stroke="#7A8FA6" stroke-width="1.5"/><line x1="27" y1="46" x2="41" y2="46" stroke="#7A8FA6" stroke-width="1.5"/></svg>';
    function card(icon, href, en, pt, statusHtml, descEn, descPt) {
      return '<a class="entry-card entry-card-overview" href="' + href + '">' + icon +
        '<div class="entry-title"><span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span></div>' +
        '<div class="entry-status">' + statusHtml + '</div>' +
        '<ul class="entry-bullets"><li><span class="lang-en">' + descEn + '</span><span class="lang-pt">' + descPt + '</span></li></ul>' +
        '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
      '</a>';
    }
    var labsN = b.lab_results || 0, imgN = b.imaging_studies || 0;
    var examsStatus = '<span class="pill pill-info">' + labsN + ' ' + t('lab markers', 'marcadores') + '</span>' +
                      (imgN ? ' <span class="pill pill-info">' + imgN + ' ' + t('imaging', 'imagem') + '</span>' : '');
    // Route only into sub-sections that have data (omit empty — no count grid).
    var hasVitals = (b.vitals_days || 0) + (b.ecg_events || 0) > 0;
    var hasExams = (b.lab_results || 0) + (b.imaging_studies || 0) > 0;
    var hasGen = (b.pgx_findings || 0) > 0;
    var cards = '';
    if (hasVitals) cards += card(ICON_VITALS, 'physical-vitals.html', 'Vitals', 'Vitais',
      statusPill((b.vitals_days || 0) + (b.ecg_events || 0), 'records', 'registros'),
      'Daily vitals, sleep, cardiovascular', 'Sinais vitais diários, sono, cardiovascular');
    if (hasExams) cards += card(ICON_EXAMS, 'physical-exams.html', 'Exams', 'Exames',
      examsStatus, 'Blood &amp; urine + imaging (MRI, CT, echo)', 'Sangue e urina + imagem (RM, TC, eco)');
    if (hasGen) cards += card(ICON_GEN, 'physical-genetics.html', 'Genetics', 'Genética',
      statusPill(b.pgx_findings || 0, 'findings', 'achados'), 'Pharmacogenomics', 'Farmacogenômica');

    // Overview leads with the AI Summary (the full consolidated review lives on Exams).
    var leadBits = imgN
      ? labsN + ' ' + t('lab markers across the panels and', 'marcadores nos painéis e') + ' ' + imgN + ' ' +
        t('imaging studies, each with its report and a plain explanation.', 'exames de imagem, cada um com seu laudo e uma explicação simples.')
      : labsN + ' ' + t('lab markers across the panels.', 'marcadores nos painéis.');
    var lead = '<section class="ov-ai-summary"><div class="ov-ai-inner">' +
      '<div class="ov-ai-head">' + aiPill() + ' <span class="ov-ai-label">' + t('AI Summary', 'Resumo por IA') + '</span></div>' +
      '<div class="ov-ai-body"><p>' +
        t('Your exams have been reviewed — ', 'Seus exames foram revisados — ') + leadBits +
        ' <a href="physical-exams.html">' + t('Open Exams', 'Abrir Exames') + '</a></p></div>' +
      '<div class="ov-ai-disc">' +
        t('AI-generated summary from your data — not a diagnosis. Discuss with your doctor.',
          'Resumo gerado por IA a partir dos seus dados — não é um diagnóstico. Converse com seu médico.') +
      '</div></div></section>';

    var view = document.createElement('main');
    view.className = 'jc-overview jc-section';
    view.innerHTML =
      '<div class="ov-shell">' +
        '<div class="ov-section-eyebrow">' + t('Physical', 'Físico') + '</div>' +
        '<h1 class="ov-title">' + t('Physical Health Overview', 'Visão Geral da Saúde Física') + '</h1>' +
        '<p class="ov-profile">' + (p.full_name ? escapeHtml(p.full_name) : '') + '</p>' +
        lead +
        '<div class="entry-grid entry-grid-overview">' + cards + '</div>' +
        medsSectionInline(summary) +
      '</div>';
    document.body.appendChild(view);
  }

  function renderVitals(summary) {
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    renderSectionView({
      summary: summary, title: 'Vitals',
      eyebrow: t('Physical → Vitals', 'Físico → Vitais'),
      metrics: [
        { label: t('Vitals days', 'Dias de vitais'),  value: b.vitals_days || 0 },
        { label: t('ECG events',  'Eventos de ECG'),  value: b.ecg_events  || 0 },
      ],
      emptyHint: t('No vitals data ingested yet. Drop CSV/JSON exports from Oura, Apple Health, Withings, Whoop, etc.',
                   'Sem dados de vitais ainda. Envie exports CSV/JSON de Oura, Apple Health, Withings, Whoop, etc.'),
    });
  }

  function renderGenetics(summary) {
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    renderSectionView({
      summary: summary, title: 'Genetics',
      eyebrow: t('Physical → Genetics', 'Físico → Genética'),
      metrics: [
        { label: t('PGx findings', 'Achados PGx'), value: b.pgx_findings || 0 },
      ],
      emptyHint: t('No genetics data ingested yet. Upload a 23andMe / AncestryDNA raw file or a pharmacogenomic report PDF.',
                   'Sem dados genéticos ainda. Envie um arquivo bruto 23andMe / AncestryDNA ou um PDF de relatório farmacogenômico.'),
    });
  }

  function renderMental(summary) {
    var b = (summary.pillars && summary.pillars.mental && summary.pillars.mental.breakdown) || {};
    var writings = (summary.recent_documents || []).filter(function (d) { return d.kind === 'writing'; });
    var extra = writings.length === 0 ? '' :
      recentSection(t('Recent writings', 'Escritos recentes'), writings.length, renderDocList(writings.slice(0, 8)));
    renderSectionView({
      summary: summary, title: 'Mental',
      eyebrow: t('Mental', 'Mental'),
      metrics: [
        { label: t('Writings',         'Escritos'),               value: b.writings         || 0 },
        { label: t('Mood entries',     'Registros de humor'),     value: b.mood_entries     || 0 },
        { label: t('Psych items',      'Itens psiquiátricos'),    value: b.psych_items      || 0 },
        { label: t('Panic events',     'Eventos de pânico'),      value: b.panic_events     || 0 },
        { label: t('Risk assessments', 'Avaliações de risco'),    value: b.risk_assessments || 0 },
      ],
      extra: extra,
      emptyHint: t('No mental-health data ingested yet. Drop journals, mood logs, or psych evaluations from Add data.',
                   'Sem dados de saúde mental ainda. Envie diários, registros de humor ou avaliações psiquiátricas em "Adicionar dados".'),
    });
  }

  function renderSpiritual(summary) {
    var b = (summary.pillars && summary.pillars.spiritual && summary.pillars.spiritual.breakdown) || {};
    renderSectionView({
      summary: summary, title: 'Spiritual',
      eyebrow: t('Spiritual', 'Espiritual'),
      metrics: [
        { label: t('Wheel of life', 'Roda da vida'),    value: b.wheel_of_life || 0 },
        { label: t('Life events',   'Eventos de vida'), value: b.life_events   || 0 },
      ],
      emptyHint: t('No spiritual data ingested yet. Drop wheel-of-life self-assessments or life-event CSVs from Add data.',
                   'Sem dados espirituais ainda. Envie autoavaliações de roda da vida ou CSVs de eventos de vida em "Adicionar dados".'),
    });
  }

  function renderEmptyShell(clerkId, patientName, sectionLabelHtml) {
    var nameHtml = patientName ? escapeHtml(patientName) : t('this patient', 'este paciente');
    var shell = document.createElement('main');
    shell.className = 'jc-empty-shell';
    shell.innerHTML =
      '<div class="jc-empty-card">' +
        '<div class="jc-empty-eyebrow">' + (sectionLabelHtml || t('Patient record', 'Prontuário do paciente')) + '</div>' +
        '<h1 class="jc-empty-title">' +
          t('Not built yet for ' + nameHtml + '.', 'Ainda não construído para ' + nameHtml + '.') +
        '</h1>' +
        '<p class="jc-empty-body">' +
          t('This section still uses Patient Zero\'s hardcoded layout. Data for ' + nameHtml + ' will appear here once a data-driven view is built.',
            'Esta seção ainda usa o layout fixo do Paciente Zero. Os dados de ' + nameHtml + ' aparecerão aqui quando uma visão orientada a dados for construída.') +
        '</p>' +
        '<div class="jc-empty-id">' + escapeHtml(clerkId) + '</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">' +
          '<a href="home.html" class="jc-empty-back" style="text-decoration:none;display:inline-block;">' +
            t('← Back to summary', '← Voltar ao resumo') +
          '</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(shell);
  }

  // ─── Styles ─────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('jc-overview-styles')) return;
    var s = document.createElement('style');
    s.id = 'jc-overview-styles';
    s.textContent = [
      // jc-home reuses Patient Zero's hero + report-section styles from styles.css
      // so it must NOT inherit the padded/centered card layout used by jc-overview.
      '.jc-home { display: block; padding: 0; margin: 0; background: #F9F7F4; }',
      '.jc-overview { padding: 32px 24px 96px; background: #F9F7F4; min-height: 100vh; }',
      '.ov-shell { max-width: 1080px; margin: 0 auto; }',
      '.ov-header { margin-bottom: 24px; }',
      '.ov-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 6px; }',
      '.ov-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; color: #0D1B2A; margin: 0 0 4px; }',
      '.ov-profile { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; color: #7A8FA6; margin-bottom: 4px; }',
      '.ov-id { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #B8954A; letter-spacing: 0.04em; }',
      '.ov-section { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }',
      '.ov-section h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0 0 14px; }',
      '.ov-count-inline { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: #7A8FA6; font-weight: 400; margin-left: 8px; letter-spacing: 0.04em; }',
      '.ov-section-note { font-size: 12px; color: #7A8FA6; margin: -6px 0 12px; }',
      '.ov-section-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; margin: 8px 0 16px; }',
      '.ov-panels-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 20px; letter-spacing: 0.01em; color: #0D1B2A; margin: 0 0 16px; }',
      '.img-study { margin: 0 0 28px; }',
      '.img-study + .img-study { border-top: 1px solid #E5E2DC; padding-top: 20px; }',
      '.img-study-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 16px; color: #0D1B2A; margin: 0 0 12px; }',
      '.ov-ai-summary { margin: 0 0 22px; }',
      '.ov-ai-card { margin: 14px 0 4px; }',
      '.ov-ai-inner { background: #FDF8EC; border: 1px solid #F4DD9C; border-radius: 10px; padding: 16px 18px; }',
      '.ov-ai-head { margin-bottom: 8px; }',
      '.ov-ai-label { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; color: #0D1B2A; }',
      '.ov-ai-body { font-size: 13.5px; line-height: 1.5; color: #1E2D3D; }',
      '.ov-ai-body p { margin: 0 0 8px; }',
      '.ov-ai-body a { color: #B8954A; }',
      '.ov-ai-list { margin: 4px 0 8px 18px; }',
      '.ov-ai-reasons { margin: 8px 0 0; font-size: 12.5px; color: #1E2D3D; }',
      '.ov-ai-med { display: block; margin-top: 3px; font-size: 12px; color: #6B5418; }',
      '.ov-ai-med::before { content: "\\1F48A\\00A0"; }',
      '.ov-ai-interact-lead { margin: 12px 0 4px; padding-top: 10px; border-top: 1px dashed #E6CF8E; font-size: 13px; color: #0D1B2A; }',
      '.ov-ai-interact li { margin-bottom: 5px; }',
      '.ov-ai-disc { margin-top: 10px; font-size: 11px; color: #7A8FA6; }',
      '.img-report { margin: 18px 0 4px; }',
      '.img-report-h { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 14px; color: #0D1B2A; margin: 0 0 8px; }',
      '.img-report-text { font-size: 13px; line-height: 1.55; color: #1E2D3D; white-space: pre-line; margin: 0; }',
      '.img-report-doc { font-size: 11px; color: #7A8FA6; margin: 8px 0 0; }',
      '.ov-list { list-style: none; padding: 0; margin: 0; }',
      '.ov-list li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #EFEBE3; font-size: 13px; }',
      '.ov-list li:first-child { border-top: none; }',
      '.ov-list-title { color: #0D1B2A; font-family: "IBM Plex Sans", sans-serif; font-weight: 500; }',
      '.ov-list-meta { color: #7A8FA6; font-family: "IBM Plex Mono", monospace; font-size: 11px; }',
      '.ov-empty { font-size: 13px; color: #7A8FA6; font-style: italic; }',
      '.ov-pending { background: #FBE9E7; border: 1px solid #E5B5AB; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px; color: #7A2E22; }',
      '.ov-pending strong { color: #7A2E22; }',
      '.ov-pending .ov-list { margin-top: 8px; }',
      '.ov-pending .ov-list li { border-top-color: #E5B5AB; }',
      '.ov-pending .ov-list-title { color: #7A2E22; }',
      '.ov-pending .ov-list-meta { color: #9c5446; }',
      '.lab-flag { font-family: "IBM Plex Mono", monospace; font-size: 10px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }',
      '.lab-flag.high { background: #FBE9E7; color: #7A2E22; border: 1px solid #E5B5AB; }',
      '.lab-flag.low  { background: #E7EEFB; color: #22417A; border: 1px solid #ABBFE5; }',
      '.lab-flag.norm { background: #F0EEE9; color: #7A8FA6; border: 1px solid #DDD8CC; }',
      // Pillars
      '.pillar-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }',
      '@media (max-width: 880px) { .pillar-grid { grid-template-columns: 1fr; } }',
      '.pillar-card { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; min-height: 220px; }',
      '.pillar-card.pillar-physical  { border-top: 3px solid #244E6E; }',
      '.pillar-card.pillar-mental    { border-top: 3px solid #B8954A; }',
      '.pillar-card.pillar-spiritual { border-top: 3px solid #7A8FA6; }',
      '.pillar-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }',
      '.pillar-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 16px; color: #0D1B2A; margin: 0; letter-spacing: 0; text-transform: none; }',
      '.pillar-total { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 24px; color: #0D1B2A; }',
      '.pillar-empty { font-size: 12px; color: #7A8FA6; font-style: italic; margin-bottom: 8px; }',
      '.pillar-rows { list-style: none; padding: 0; margin: 0 0 14px; flex: 1; }',
      '.pillar-row { display: flex; justify-content: space-between; font-size: 12px; font-family: "IBM Plex Sans", sans-serif; padding: 4px 0; color: #0D1B2A; text-transform: capitalize; }',
      '.pillar-row.empty { opacity: 0.5; }',
      '.pillar-row span:last-child { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; }',
      '.pillar-link { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; align-self: flex-start; border: 1px solid #B8954A; padding: 6px 12px; border-radius: 6px; transition: background 0.15s; }',
      '.pillar-link:hover { background: #FFF6E5; }',
      // Exam tables
      '.exam-panel { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 16px 20px; margin-bottom: 14px; }',
      '.exam-panel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }',
      '.exam-panel-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 14px; color: #0D1B2A; margin: 0; text-transform: none; letter-spacing: 0; }',
      '.exam-panel-count { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; letter-spacing: 0.04em; }',
      '.exam-table { width: 100%; border-collapse: collapse; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; }',
      '.exam-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 8px 6px; border-bottom: 1px solid #E5E2DC; }',
      '.exam-table td { padding: 8px 6px; border-bottom: 1px solid #EFEBE3; vertical-align: top; }',
      '.exam-table tr:last-child td { border-bottom: none; }',
      '.exam-marker { color: #0D1B2A; font-weight: 500; }',
      '.exam-value { font-family: "IBM Plex Mono", monospace; color: #0D1B2A; }',
      '.exam-ref, .exam-date, .exam-lab { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; font-size: 12px; }',
      '.exam-points { display: inline-block; background: #F4F1EA; border: 1px solid #DDD8CC; border-radius: 4px; padding: 1px 6px; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; }',
      // Section metric grid
      '.ov-metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }',
      '.ov-metric { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }',
      '.ov-metric-num { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 24px; color: #0D1B2A; line-height: 1.1; }',
      '.ov-metric-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; }',
      '.ov-metric-link { text-decoration: none; transition: border-color 0.15s, transform 0.15s; }',
      '.ov-metric-link:hover { border-color: #B8954A; transform: translateY(-1px); }',
      '.ov-empty-hint p { margin: 0; font-size: 13px; color: #7A8FA6; font-style: italic; }',
      // AI-authored card layout
      '.ov-cards { margin: 0 0 22px; }',
      '.ov-cards-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }',
      '.ov-cards-head h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 4px; font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; }',
      '.ai-pill { display: inline-block; background: #FFF6E5; color: #B8954A; border: 1px solid #E0C681; padding: 1px 8px; border-radius: 999px; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: none; }',
      '.ov-dashboard-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',
      '.ov-dashboard-meta code { font-size: 10px; color: #7A8FA6; background: transparent; }',
      '.ov-cards-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
      '.ov-cards-head-actions .btn { padding: 6px 12px; font-size: 12px; }',
      '.ov-cards-stack { display: flex; flex-direction: column; gap: 12px; }',
      // Generic dashboard cards now use the canon .chart-card shell — their styling
      // (shell, per-kind accents, card-body, lab-panel-body, timeline pills) lives in
      // styles.css under "Generic dashboard cards (CARD_RENDERERS)". Single source of truth.
      '.lab-panel-body-flat { padding: 0; border-top: none; }',
      // Flagged cells in the historical-comparison table
      '.lab-cmp-val[data-flag="high"] { color: #7A2E22; }',
      '.lab-cmp-val[data-flag="low"]  { color: #B8862B; }',
      // Per-card click-to-expand history (.lab-test-has-history)
      '.lab-test-has-history { cursor: pointer; transition: box-shadow 0.15s ease, border-color 0.15s ease; }',
      '.lab-test-has-history:hover { border-color: #B8954A; box-shadow: 0 2px 6px rgba(13,27,42,0.06); }',
      '.lab-test-has-history:focus { outline: 2px solid #B8954A; outline-offset: 2px; }',
      '.lab-test-history-badge { display: inline-flex; align-items: center; gap: 4px; background: #F4F1EA; border: 1px solid #DDD8CC; border-radius: 999px; padding: 2px 8px 2px 9px; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; letter-spacing: 0.04em; margin-left: 6px; }',
      '.lab-test-history-caret { transition: transform 0.18s ease; }',
      '.lab-test.is-open .lab-test-history-caret { transform: rotate(180deg); }',
      '.lab-test-history { display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid #E5E2DC; }',
      '.lab-test.is-open .lab-test-history { display: block; }',
      '.lab-test-history-table { width: 100%; border-collapse: collapse; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      '.lab-test-history-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 4px 8px 8px; border-bottom: 1px solid #E5E2DC; }',
      '.lab-test-history-table th:last-child { text-align: right; }',
      '.lab-test-history-table td { padding: 8px; border-bottom: 1px solid #EFEBE3; vertical-align: middle; color: #1E2D3D; }',
      '.lab-test-history-table tr:last-child td { border-bottom: none; }',
      '.lab-test-history-table .lab-hist-row.is-latest td { background: #FFF6E5; }',
      '.lab-test-history-table .lab-hist-row.is-latest .lab-hist-date::after { content: " · " attr(data-latest); color: #B8954A; }',
      '.lab-test-history-table .lab-hist-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #1E2D3D; white-space: nowrap; }',
      '.lab-test-history-table .lab-hist-doctor { color: #1E2D3D; }',
      '.lab-test-history-table .lab-hist-val { font-family: "IBM Plex Mono", monospace; color: #0D1B2A; white-space: nowrap; font-weight: 500; }',
      '.lab-test-history-table .lab-hist-unit { color: #7A8FA6; font-weight: 400; font-size: 10px; margin-left: 2px; }',
      '.lab-test-history-table .lab-hist-status { text-align: right; white-space: nowrap; }',
      '.lab-test-history-table .lab-hist-lab { color: #7A8FA6; }',
      '.lab-test-history-table .lab-hist-empty { color: #B8954A; font-style: italic; }',
      '@media (max-width: 540px) { .lab-test-history-table .lab-hist-doctor { font-size: 11px; } .lab-test-history-table td, .lab-test-history-table th { padding: 6px 4px; } }',
      // Danger zone (Delete my health data)
      '.jc-danger-zone { max-width: 1080px; margin: 32px auto; padding: 0 24px; }',
      '.jc-danger-card { background: #FFFFFF; border: 1px solid #E5B5AB; border-radius: 10px; padding: 20px 24px; display: flex; flex-direction: column; gap: 10px; }',
      '.jc-danger-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A2E22; }',
      '.jc-danger-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; color: #0D1B2A; margin: 0; }',
      '.jc-danger-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; color: #1E2D3D; line-height: 1.5; margin: 0; }',
      '.jc-danger-btn { align-self: flex-start; padding: 8px 16px; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 500; color: #7A2E22; background: #FFFFFF; border: 1px solid #E5B5AB; border-radius: 6px; cursor: pointer; transition: background 0.15s, color 0.15s; }',
      '.jc-danger-btn:hover { background: #7A2E22; color: #FFFFFF; }',
      '.jc-danger-backdrop { position: fixed; inset: 0; background: rgba(13, 27, 42, 0.55); display: none; align-items: center; justify-content: center; z-index: 200; }',
      '.jc-danger-backdrop.open { display: flex; }',
      '.jc-danger-modal { background: #FFFFFF; border-radius: 12px; padding: 28px 32px; min-width: 360px; max-width: 480px; box-shadow: 0 24px 60px rgba(13, 27, 42, 0.4); display: flex; flex-direction: column; gap: 14px; }',
      '.jc-danger-modal h3 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 16px; color: #0D1B2A; margin: 0; }',
      '.jc-danger-modal p { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; color: #1E2D3D; line-height: 1.55; margin: 0; }',
      '.jc-danger-modal input { font-family: "IBM Plex Mono", monospace; font-size: 14px; padding: 8px 12px; border: 1px solid #DDD8CC; border-radius: 6px; color: #0D1B2A; }',
      '.jc-danger-modal input:focus { outline: 2px solid #B8954A; outline-offset: 1px; border-color: #B8954A; }',
      '.jc-danger-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }',
      '.jc-danger-modal-actions button { padding: 8px 16px; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 500; border-radius: 6px; cursor: pointer; border: 1px solid #DDD8CC; background: #FFFFFF; color: #0D1B2A; }',
      '.jc-danger-modal-actions button.jc-danger-go { color: #FFFFFF; background: #7A2E22; border-color: #7A2E22; }',
      '.jc-danger-modal-actions button.jc-danger-go:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.jc-danger-error { color: #7A2E22; font-size: 12px; font-family: "IBM Plex Mono", monospace; }',
      // .card-chart-svg + .ov-pt-* relocated to styles.css (Generic dashboard cards).
      '.ov-chart { width: 100%; max-width: 100%; height: auto; display: block; }',
      '.ov-rangebar { width: 160px; height: 14px; display: block; }',
      '.exam-bar { width: 180px; padding-right: 0; }',
      '@media (max-width: 720px) { .exam-bar { display: none; } }',
      '.jc-home-dash-wrap { background: #F9F7F4; padding: 28px 0 8px; }',
      // Donut overlay
      '.jc-donut-backdrop { position: fixed; inset: 0; background: rgba(13, 27, 42, 0.55); display: none; align-items: center; justify-content: center; z-index: 200; }',
      '.jc-donut-backdrop.open { display: flex; }',
      '.jc-donut-card { background: #FFFFFF; border-radius: 14px; padding: 28px 32px; min-width: 320px; max-width: 420px; box-shadow: 0 24px 60px rgba(13, 27, 42, 0.4); display: flex; align-items: center; gap: 24px; }',
      '.jc-donut { width: 92px; height: 92px; flex-shrink: 0; }',
      '.jc-donut-fg { transition: stroke-dashoffset 0.5s ease; }',
      '.jc-donut-text { flex: 1; min-width: 0; }',
      '.jc-donut-pct { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 22px; color: #0D1B2A; line-height: 1.1; }',
      '.jc-donut-label { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; color: #1E2D3D; margin: 4px 0 8px; }',
      '.jc-donut-trail { list-style: none; padding: 0; margin: 0; max-height: 96px; overflow-y: auto; font-family: "IBM Plex Mono", monospace; font-size: 11px; line-height: 1.5; }',
      '.jc-donut-trail-item.ok { color: #2D5F3F; }',
      '.jc-donut-trail-item.err { color: #7A2E22; }',
    ].join('\n');
    document.head.appendChild(s);
    installLabHistoryHandler();
  }

  // insertAfterEl: optional. When the patient's home is rendered by JS
  // (non-Patient-Zero), pass the just-appended <main> so the zone lands
  // beneath it. When omitted (Patient Zero's static page), fall back to
  // "before footer" → "append to body".
  /* ── Bottom dock: Update-AI-Insights + AI cards (left) side by side with the
     Danger zone (right). The three pieces are injected by different code paths
     (this file + insights-update.js) at different times, so rather than fight
     placement we REFLOW: gather whatever exists into a two-column row pinned to
     the visual bottom of the page. Idempotent — safe to call repeatedly. ── */
  function injectBottomDockStyles() {
    if (document.getElementById('jc-bottom-dock-styles')) return;
    var s = document.createElement('style');
    s.id = 'jc-bottom-dock-styles';
    s.textContent = [
      '.jc-bottom-dock { max-width: 1080px; margin: 32px auto; padding: 0 24px; }',
      // The three action cards: one row, three EQUAL columns, tops/bottoms aligned.
      '.jc-bottom-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: stretch; }',
      '.jc-bottom-actions > div:empty { display: none; }',
      // The AI synthesis block sits full-width BELOW the action row (not an action card).
      '.jc-bottom-ai { margin-top: 24px; }',
      '.jc-bottom-ai:empty { display: none; }',
      // neutralise each child\'s own centring/width so the columns control layout
      '.jc-bottom-dock .uc-wrap, .jc-bottom-dock .iu-wrap, .jc-bottom-dock .jc-danger-zone { max-width: none; margin: 0; padding: 0; height: 100%; }',
      '.jc-bottom-dock .ai-ins-block { max-width: none; margin: 0; padding: 0; border-top: none; }',
      // equal-height cards so the three line up top and bottom
      '.jc-bottom-actions .uc-card, .jc-bottom-actions .iu-card, .jc-bottom-actions .jc-danger-card { height: 100%; box-sizing: border-box; }',
      '@media (max-width: 880px) { .jc-bottom-actions { grid-template-columns: 1fr; gap: 18px; } }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function ensureBottomDock() {
    injectBottomDockStyles();
    var dock = document.querySelector('.jc-bottom-dock');
    if (dock) return dock;
    dock = document.createElement('div');
    dock.className = 'jc-bottom-dock';
    dock.innerHTML =
      '<div class="jc-bottom-actions">' +
        '<div class="jc-bottom-upload" data-bottom-upload></div>' +
        '<div class="jc-bottom-aibtn" data-bottom-aibtn></div>' +
        '<div class="jc-bottom-danger" data-bottom-danger></div>' +
      '</div>' +
      '<div class="jc-bottom-ai" data-bottom-ai></div>';
    // Pin to the visual bottom: before a VISIBLE footer (static pages) or at the
    // end of <body> (dynamic pages hide the original footer and append content).
    var footer = document.querySelector('footer.doc-footer') || document.querySelector('footer');
    var footerVisible = footer && footer.offsetParent !== null;
    if (footerVisible && footer.parentNode) footer.parentNode.insertBefore(dock, footer);
    else document.body.appendChild(dock);
    return dock;
  }

  function reflowBottomDock() {
    var upload = document.querySelector('.uc-wrap[data-upload-card]');
    var iu = document.querySelector('.iu-wrap[data-insights-update]');
    var ai = document.querySelector('section[data-ai-insights]');
    var danger = document.querySelector('.jc-danger-zone');
    if (!upload && !iu && !ai && !danger) return;
    var dock = ensureBottomDock();
    // Re-pin the dock to the visual bottom on every reflow. The dock can be
    // created early (insights-update mounts on DOMContentLoaded) while the page's
    // main content is appended later by an async render — without this the dock
    // would sit ABOVE the summary. Move it after the last rendered content.
    var pinFooter = document.querySelector('footer.doc-footer') || document.querySelector('footer');
    if (pinFooter && pinFooter.offsetParent !== null) {
      if (pinFooter.previousElementSibling !== dock) pinFooter.parentNode.insertBefore(dock, pinFooter);
    } else if (document.body.lastElementChild !== dock) {
      document.body.appendChild(dock);
    }
    var uploadCol = dock.querySelector('[data-bottom-upload]');
    var aiBtnCol = dock.querySelector('[data-bottom-aibtn]');
    var aiCol = dock.querySelector('[data-bottom-ai]');
    var dangerCol = dock.querySelector('[data-bottom-danger]');
    // Three equal action cards on one line: Upload | Update AI Insights | Delete.
    if (upload && uploadCol && upload.parentNode !== uploadCol) uploadCol.appendChild(upload);
    if (iu && aiBtnCol && iu.parentNode !== aiBtnCol) aiBtnCol.appendChild(iu);
    if (danger && danger.parentNode !== dangerCol) dangerCol.appendChild(danger);
    // The big AI synthesis block goes full-width BELOW the action row.
    if (ai && ai.parentNode !== aiCol) aiCol.appendChild(ai);
  }
  // Exposed so assets/insights-update.js can trigger a reflow after it mounts /
  // refreshes the button + cards.
  window.jcReflowBottom = reflowBottomDock;

  function injectDangerZone(insertAfterEl) {
    if (document.querySelector('.jc-danger-zone')) return;
    var zone = document.createElement('section');
    zone.className = 'jc-danger-zone';
    zone.innerHTML =
      '<div class="jc-danger-card">' +
        '<div class="jc-danger-eyebrow">' + t('Danger zone', 'Zona de risco') + '</div>' +
        '<h3 class="jc-danger-title">' + t('Delete my health data', 'Excluir meus dados de saúde') + '</h3>' +
        '<p class="jc-danger-body">' +
          t('Wipes every exam, lab result, vital reading, mental-health entry, document and AI summary attached to this account. Your login stays — you can start over from a blank state. This cannot be undone.',
            'Apaga todo exame, resultado de laboratório, vital, registro de saúde mental, documento e resumo da IA vinculado a esta conta. Seu acesso permanece — você pode recomeçar do zero. Esta ação não pode ser desfeita.') +
        '</p>' +
        '<button type="button" class="jc-danger-btn">' +
          t('Delete my health data', 'Excluir meus dados de saúde') +
        '</button>' +
      '</div>';
    if (insertAfterEl && insertAfterEl.parentNode) {
      insertAfterEl.parentNode.insertBefore(zone, insertAfterEl.nextSibling);
    } else {
      var footer = document.querySelector('footer.doc-footer') || document.querySelector('footer');
      if (footer && footer.parentNode) footer.parentNode.insertBefore(zone, footer);
      else document.body.appendChild(zone);
    }
    zone.querySelector('.jc-danger-btn').addEventListener('click', openDangerModal);
    reflowBottomDock(); // move the danger zone into the side-by-side bottom dock
  }

  function openDangerModal() {
    var existing = document.querySelector('.jc-danger-backdrop');
    if (existing) { existing.classList.add('open'); return; }
    var bd = document.createElement('div');
    bd.className = 'jc-danger-backdrop';
    bd.innerHTML =
      '<div class="jc-danger-modal" role="dialog" aria-modal="true">' +
        '<h3>' + t('Delete my health data?', 'Excluir meus dados de saúde?') + '</h3>' +
        '<p>' +
          t('This will permanently delete every exam, lab result, document, vital, mental-health entry and AI summary on this account. Your username and password stay intact. This action cannot be undone.',
            'Isto apagará permanentemente todo exame, resultado, documento, vital, registro de saúde mental e resumo da IA desta conta. Seu usuário e senha permanecem intactos. Esta ação não pode ser desfeita.') +
        '</p>' +
        '<p>' + t('Type <strong>DELETE</strong> to confirm:', 'Digite <strong>DELETE</strong> para confirmar:') + '</p>' +
        '<input type="text" class="jc-danger-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
        '<div class="jc-danger-error" style="display:none;"></div>' +
        '<div class="jc-danger-modal-actions">' +
          '<button type="button" class="jc-danger-cancel">' + t('Cancel', 'Cancelar') + '</button>' +
          '<button type="button" class="jc-danger-go" disabled>' +
            t('Delete everything', 'Apagar tudo') +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    var input  = bd.querySelector('.jc-danger-input');
    var goBtn  = bd.querySelector('.jc-danger-go');
    var cancel = bd.querySelector('.jc-danger-cancel');
    var errEl  = bd.querySelector('.jc-danger-error');
    input.addEventListener('input', function () {
      goBtn.disabled = (input.value.trim().toUpperCase() !== 'DELETE');
    });
    cancel.addEventListener('click', function () { bd.remove(); });
    bd.addEventListener('click', function (e) { if (e.target === bd) bd.remove(); });
    goBtn.addEventListener('click', async function () {
      goBtn.disabled = true; cancel.disabled = true;
      goBtn.textContent = tPlain('Deleting…', 'Apagando…');
      errEl.style.display = 'none';
      try {
        var resp = await fetch('/api/patient-wipe-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Viewer-Clerk': viewerClerkHeader(),
          },
          body: JSON.stringify({ patient_clerk: patient }),
        });
        var body = await resp.json().catch(function () { return null; });
        if (!resp.ok || !body || !body.ok) {
          var msg = (body && body.error) ? body.error : ('HTTP ' + resp.status);
          throw new Error(msg);
        }
        // Force a hard reload so every cached view rebuilds from a blank
        // state. Append a cache-buster to the URL so the browser drops
        // any stale JSON.
        var url = new URL(location.href);
        url.searchParams.set('wiped', String(Date.now()));
        location.replace(url.toString());
      } catch (e) {
        errEl.textContent = (tPlain('Failed: ', 'Falhou: ') + (e.message || e));
        errEl.style.display = 'block';
        goBtn.textContent = tPlain('Delete everything', 'Apagar tudo');
        goBtn.disabled = false;
        cancel.disabled = false;
      }
    });
    setTimeout(function () { bd.classList.add('open'); input.focus(); }, 0);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ── Injury & surgical history (DB-driven) ─────────────────────────────
     The #injury section on the static home page ships with empty tbodies.
     This fills them from /api/patient-summary (patient_procedures), groups
     by type (Injury vs everything-else), formats the date the way the page
     used to, and re-derives the flag pills (Concussion / Suicide risk) from
     the notes prefix. Each table+heading hides when its group is empty, and
     the whole section hides when the patient has no rows — so Leo, who
     inherits this HTML but has no procedures, shows nothing here.          */
  var PROC_FLAGS = ['Concussion', 'Suicide risk'];
  function formatProcDate(row) {
    var iso = row.event_date;
    if (!iso) return escapeHtml(row.date_raw || '—');
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return escapeHtml(row.date_raw || iso);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var mon = months[parseInt(m[2], 10) - 1] || m[2];
    var day = parseInt(m[3], 10);
    // CSV uses day=01 as a month-only placeholder; show "Mon YYYY" for those,
    // "D Mon YYYY" for a real day (e.g. the 29 Apr overdose).
    return day === 1 ? (mon + ' ' + m[1]) : (day + ' ' + mon + ' ' + m[1]);
  }
  function renderProcNotes(notes) {
    var n = (notes == null) ? '' : String(notes);
    for (var i = 0; i < PROC_FLAGS.length; i++) {
      var kw = PROC_FLAGS[i];
      var re = new RegExp('^' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*·\\s*([\\s\\S]*)$', 'i');
      var hit = n.match(re);
      if (hit) return '<span class="pill pill-flag">' + escapeHtml(kw) + '</span> · ' + escapeHtml(hit[1]);
    }
    return escapeHtml(n);
  }
  function procRow(row) {
    return '<tr><td>' + formatProcDate(row) + '</td>' +
      '<td class="strong">' + escapeHtml(row.description || '') + '</td>' +
      '<td>' + escapeHtml(row.location || '') + '</td>' +
      '<td>' + renderProcNotes(row.notes) + '</td></tr>';
  }
  function decorateProceduresFromDb(clerk) {
    var section = document.getElementById('injury');
    if (!section) return;
    var injBody = document.getElementById('proc-injuries-body');
    var surBody = document.getElementById('proc-surgeries-body');
    var injWrap = document.getElementById('proc-injuries-wrap');
    var surWrap = document.getElementById('proc-surgeries-wrap');
    fetch('/api/patient-summary?clerk=' + encodeURIComponent(clerk), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (s) {
        var rows = (s && s.procedures) || [];
        // Injuries table = type 'Injury'; surgeries table = everything else
        // (Surgery + any Procedure/Diagnostic/Hospitalization), so nothing is
        // silently dropped for future patients.
        var injuries = rows.filter(function (r) { return (r.type || '').toLowerCase() === 'injury'; });
        var surgeries = rows.filter(function (r) { return (r.type || '').toLowerCase() !== 'injury'; });
        if (rows.length === 0) { section.style.display = 'none'; return; }
        if (injBody) injBody.innerHTML = injuries.map(procRow).join('');
        if (surBody) surBody.innerHTML = surgeries.map(procRow).join('');
        if (injWrap) injWrap.style.display = injuries.length ? '' : 'none';
        if (surWrap) surWrap.style.display = surgeries.length ? '' : 'none';
      })
      .catch(function () {
        // No data / fetch failure → hide the section rather than show empty
        // tables or stale content.
        section.style.display = 'none';
      });
  }

  /* ── Clinical ECG studies (DB-driven, migration 0012) ──────────────────
     One reusable render path for EVERY patient (no special-casing). The shared
     renderExams() injects buildEcgSectionHtml() for database-default patients;
     Joao's static physical-exams page exposes an #ecg-mount that
     decorateEcgStudies() fills the same way. The Lumen SVG is fetched and
     injected INLINE (so it scales + uses the page fonts) by hydrateEcgCharts().
     The amber AI card reuses the platform .ov-ai-summary tokens and is grounded
     on the validated interpretation — it never over-reassures and always points
     back to the ordering doctor. */
  function injectEcgStyles() {
    if (document.getElementById('ecg-style')) return;
    var s = document.createElement('style');
    s.id = 'ecg-style';
    s.textContent =
      '.ecg-study{margin:0 0 1rem;}' +
      '.ecg-chart{background:#FFFFFF;border:1px solid #E4E9F0;border-radius:14px;padding:10px;overflow:hidden;}' +
      '.ecg-chart .ecg-svg{display:block;width:100%;height:auto;}' +
      '.ecg-chart-loading{color:#8895AC;font-family:"IBM Plex Mono",monospace;font-size:13px;padding:28px;text-align:center;}' +
      '.ecg-fidelity{color:#4A5B73;font-family:"IBM Plex Mono",monospace;font-size:12px;margin:6px 2px 0;letter-spacing:.04em;}' +
      '.ecg-sep{border:none;border-top:1px solid #EFEAE0;margin:2rem 0;}' +
      /* version-switcher: small date pill + dropdown of every study */
      '.ecg-switcher{margin:0 0 1rem;}' +
      '.ecg-pill-wrap{position:relative;display:inline-block;margin:0 0 1rem;}' +
      '.ecg-pill{display:inline-flex;align-items:center;gap:8px;background:#F7F8FA;border:1px solid #E4E9F0;' +
        'border-radius:999px;padding:5px 14px;font-family:"IBM Plex Mono",monospace;font-size:13px;' +
        'color:#4A5B73;cursor:pointer;line-height:1.4;}' +
      '.ecg-pill:hover{background:#EEF1F6;border-color:#D3DAE6;}' +
      '.ecg-pill[aria-expanded="true"]{background:#EEF1F6;border-color:#C9D2E0;}' +
      '.ecg-pill-caret{width:9px;height:9px;flex:none;transition:transform .15s ease;color:#8895AC;}' +
      '.ecg-pill[aria-expanded="true"] .ecg-pill-caret{transform:rotate(180deg);}' +
      '.ecg-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:40;min-width:240px;max-height:320px;' +
        'overflow:auto;background:#FFFFFF;border:1px solid #E4E9F0;border-radius:12px;' +
        'box-shadow:0 8px 28px rgba(13,27,42,.12);padding:6px;display:none;}' +
      '.ecg-pill-wrap.open .ecg-menu{display:block;}' +
      '.ecg-menu-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;' +
        'border:none;border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit;color:#1E2D3D;}' +
      '.ecg-menu-item:hover{background:#F2F5FA;}' +
      '.ecg-menu-item[aria-current="true"]{background:#F2F5FA;font-weight:600;}' +
      '.ecg-menu-date{font-family:"IBM Plex Mono",monospace;font-size:13px;}' +
      '.ecg-menu-sub{display:block;font-size:11px;color:#8895AC;margin-top:1px;}' +
      '.ecg-menu-check{margin-left:auto;color:#9B3535;width:14px;height:14px;flex:none;visibility:hidden;}' +
      '.ecg-menu-item[aria-current="true"] .ecg-menu-check{visibility:visible;}';
    document.head.appendChild(s);
  }

  function ecgDateNice(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return { en: String(iso || ''), pt: String(iso || '') };
    var en = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var pt = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    var d = parseInt(m[3], 10), mo = parseInt(m[2], 10) - 1;
    return { en: d + ' ' + en[mo] + ' ' + m[1], pt: d + ' de ' + pt[mo] + ' de ' + m[1] };
  }

  function ecgFriendlyLine(s) {
    var interp = (s.interpretation || s.report_text || '').toLowerCase();
    var abnormal = /(abnormal|anormal|fibrill|flutter|\bblock\b|bloqueio|isch|isquem|infarct|infart|eleva|prolong|ectop|taquic|bradic|hypertroph|hipertrof)/.test(interp);
    var normal = /(within normal|dentro dos limites normais|normal ecg|ecg normal|sinus rhythm|ritmo sinusal)/.test(interp) && !abnormal;
    if (normal) {
      return t(
        'An ECG records your heart’s electrical rhythm. This one was read as normal — a regular (sinus) rhythm with a tracing within normal limits. Keep it on file and bring it to your next visit with the doctor who ordered it.',
        'O ECG registra o ritmo elétrico do coração. Este foi avaliado como normal — ritmo regular (sinusal), com traçado dentro dos limites normais. Guarde-o e leve à sua próxima consulta com o médico que solicitou o exame.');
    }
    return t(
      'An ECG records your heart’s electrical rhythm. The doctor’s validated reading is shown below — go through it with the doctor who ordered the exam; they can explain what it means for you.',
      'O ECG registra o ritmo elétrico do coração. A leitura validada pelo médico está abaixo — converse com o médico que solicitou o exame para entender o que significa para você.');
  }

  function ecgLi(label, val) {
    return val ? ('<li><strong>' + label + '.</strong> ' + escapeHtml(String(val)) + '</li>') : '';
  }

  function buildEcgStudyHtml(s, clerk) {
    var dn = ecgDateNice(s.study_date);
    var qs = 'clerk=' + encodeURIComponent(clerk) + '&id=' + encodeURIComponent(s.id);
    var dlIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    var reportBtn = s.has_report
      ? ('<a class="export-btn-primary" href="/api/patient-ecg-object?' + qs + '&kind=report" target="_blank" rel="noopener">' + dlIcon +
         '<span class="lang-en">Open report (PDF)</span><span class="lang-pt">Abrir laudo (PDF)</span></a>')
      : '';
    var ids = [
      ecgLi(t('Exam', 'Exame'), (s.modality || 'ECG') + (s.lead_layout ? (' · ' + s.lead_layout) : '')),
      ecgLi(t('Ordered by', 'Solicitado por'), s.ordering_doctor),
      ecgLi(t('Validated by', 'Validado por'), s.validating_doctor),
      ecgLi(t('Clinic', 'Clínica'), s.clinic),
    ].join('');
    var meas = [
      ecgLi('HR', s.heart_rate ? (s.heart_rate + ' bpm') : null),
      ecgLi('PR', s.pr_ms ? (s.pr_ms + ' ms') : null),
      ecgLi('QRS', s.qrs_ms ? (s.qrs_ms + ' ms') : null),
      ecgLi('QT', s.qt_ms ? (s.qt_ms + ' ms') : null),
      ecgLi('QTcF', s.qtc_ms ? (s.qtc_ms + ' ms') : null),
    ].join('');
    var concl = s.interpretation
      ? ('<div class="alert alert-info"><strong>' + t('Conclusion', 'Conclusão') + ':</strong> ' + escapeHtml(s.interpretation) + '</div>')
      : '';
    return '' +
      '<h2 class="section-title"><span class="lang-en">Electrocardiogram (ECG) · ' + dn.en + '</span>' +
        '<span class="lang-pt">Eletrocardiograma (ECG) · ' + dn.pt + '</span></h2>' +
      (s.clinic || s.ordering_doctor
        ? ('<p class="section-desc">' + escapeHtml([s.clinic, s.ordering_doctor ? ('· ' + t('ordered by', 'solicitado por') + ' ' + s.ordering_doctor) : ''].filter(Boolean).join(' ')) + '</p>')
        : '') +
      '<div class="ecg-chart" data-ecg-id="' + escapeHtml(String(s.id)) + '" data-clerk="' + escapeHtml(String(clerk)) + '">' +
        '<div class="ecg-chart-loading">' + t('Loading chart…', 'Carregando traçado…') + '</div></div>' +
      (s.fidelity ? ('<p class="ecg-fidelity">' + escapeHtml(s.fidelity) + '</p>') : '') +
      (reportBtn ? ('<div class="report-export-row" style="margin-top:1rem;">' + reportBtn + '</div>') : '') +
      '<div class="two-col mb-3" style="margin-top:1.25rem;">' +
        '<div class="list-card"><h4>' + t('Study', 'Estudo') + '</h4><ul>' + ids + '</ul></div>' +
        (meas ? ('<div class="list-card"><h4>' + t('Measurements', 'Medidas') + '</h4><ul>' + meas + '</ul></div>') : '') +
      '</div>' +
      concl +
      '<section class="ov-ai-summary"><div class="ov-ai-inner">' +
        '<div class="ov-ai-head"><span class="ai-pill">AI</span> <span class="ov-ai-label">' + t('AI Summary', 'Resumo por IA') + '</span></div>' +
        '<div class="ov-ai-body">' + ecgFriendlyLine(s) + '</div>' +
        '<div class="ov-ai-disc">' +
          t('AI-generated explanation from your data — not a diagnosis. Discuss with your doctor.',
            'Explicação gerada por IA a partir dos seus dados — não é um diagnóstico. Converse com seu médico.') +
        '</div></div></section>';
  }

  // Caret + check glyphs for the switcher pill/menu.
  function ecgCaretSvg() {
    return '<svg class="ecg-pill-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2 4 6 8 10 4"/></svg>';
  }
  function ecgCheckSvg() {
    return '<svg class="ecg-menu-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8.5 6.5 12 13 4"/></svg>';
  }
  // Bilingual "ECG · <date>" label used on the pill for the selected study.
  function ecgPillLabel(s) {
    var dn = ecgDateNice(s.study_date);
    return '<span class="lang-en">ECG · ' + dn.en + '</span><span class="lang-pt">ECG · ' + dn.pt + '</span>';
  }
  // Secondary line in the dropdown to disambiguate same-day / repeat studies.
  function ecgMenuSub(s) {
    var bits = [s.modality, s.lead_layout, s.clinic].filter(Boolean);
    return bits.length ? escapeHtml(bits.join(' · ')) : '';
  }

  // ONE ECG block per patient. Shows the LATEST study by default with a small
  // date pill; the dropdown lists every study (newest first) and selecting an
  // older one swaps the chart/report/amber card in place (wireEcgSwitcher).
  // The `studies` array arrives ordered study_date DESC from /api/patient-exams,
  // so index 0 is the latest — that is what renders first, with no flicker.
  function buildEcgSectionHtml(studies, clerk) {
    if (!studies || !studies.length) return '';
    var current = studies[0];
    var menuItems = studies.map(function (s, i) {
      var dn = ecgDateNice(s.study_date);
      var sub = ecgMenuSub(s);
      return '<button type="button" class="ecg-menu-item" role="option" data-ecg-idx="' + i + '"' +
        (i === 0 ? ' aria-current="true"' : '') + '>' +
        '<span>' +
          '<span class="ecg-menu-date"><span class="lang-en">' + dn.en + '</span><span class="lang-pt">' + dn.pt + '</span></span>' +
          (sub ? ('<span class="ecg-menu-sub">' + sub + '</span>') : '') +
        '</span>' + ecgCheckSvg() +
      '</button>';
    }).join('');
    return '<div class="ecg-switcher" data-clerk="' + escapeHtml(String(clerk)) + '">' +
      '<div class="ecg-pill-wrap">' +
        '<button type="button" class="ecg-pill" aria-haspopup="listbox" aria-expanded="false">' +
          '<span class="ecg-pill-label">' + ecgPillLabel(current) + '</span>' + ecgCaretSvg() +
        '</button>' +
        '<div class="ecg-menu" role="listbox">' + menuItems + '</div>' +
      '</div>' +
      '<div class="ecg-current">' + buildEcgStudyHtml(current, clerk) + '</div>' +
    '</div>';
  }

  // Wire the date pill + dropdown for every .ecg-switcher under `root`. Selecting
  // a study re-renders the .ecg-current block to that study and re-hydrates its
  // SVG. Must be called AFTER the switcher markup is in the DOM; `studies` is the
  // same array (study_date DESC) used to build it.
  function wireEcgSwitcher(root, studies, clerk) {
    if (!root || !studies || !studies.length) return;
    var sw = root.querySelector('.ecg-switcher');
    if (!sw || sw.__ecgWired) return;
    sw.__ecgWired = true;
    var wrap = sw.querySelector('.ecg-pill-wrap');
    var pill = sw.querySelector('.ecg-pill');
    var menu = sw.querySelector('.ecg-menu');
    var current = sw.querySelector('.ecg-current');
    if (!wrap || !pill || !menu || !current) return;

    function close() { wrap.classList.remove('open'); pill.setAttribute('aria-expanded', 'false'); }
    function open() { wrap.classList.add('open'); pill.setAttribute('aria-expanded', 'true'); }

    pill.addEventListener('click', function (e) {
      e.stopPropagation();
      if (wrap.classList.contains('open')) close(); else open();
    });
    // Click-away closes the menu.
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });

    menu.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.ecg-menu-item') : null;
      if (!item) return;
      var idx = parseInt(item.getAttribute('data-ecg-idx'), 10);
      var s = studies[idx];
      if (!s) { close(); return; }
      // Swap the displayed study, update pill + selected mark, re-hydrate SVG.
      current.innerHTML = buildEcgStudyHtml(s, clerk);
      var label = sw.querySelector('.ecg-pill-label');
      if (label) label.innerHTML = ecgPillLabel(s);
      Array.prototype.forEach.call(menu.querySelectorAll('.ecg-menu-item'), function (it) {
        if (it === item) it.setAttribute('aria-current', 'true');
        else it.removeAttribute('aria-current');
      });
      close();
      hydrateEcgCharts(current, clerk);
    });
  }

  function hydrateEcgCharts(root, clerk) {
    injectEcgStyles();
    var nodes = (root || document).querySelectorAll('.ecg-chart[data-ecg-id]');
    Array.prototype.forEach.call(nodes, function (node) {
      var id = node.getAttribute('data-ecg-id');
      var ck = node.getAttribute('data-clerk') || clerk;
      fetch('/api/patient-ecg-object?clerk=' + encodeURIComponent(ck) + '&id=' + encodeURIComponent(id) + '&kind=svg')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (svg) { node.innerHTML = svg; })
        .catch(function () { node.innerHTML = '<div class="ecg-chart-loading">' + t('Chart unavailable', 'Traçado indisponível') + '</div>'; });
    });
  }

  // Joao's static physical-exams page: fill #ecg-mount from /api/patient-exams.
  function decorateEcgStudies(clerk) {
    var section = document.getElementById('ecg-section');
    var mount = document.getElementById('ecg-mount');
    if (!section || !mount) return;
    fetch('/api/patient-exams?clerk=' + encodeURIComponent(clerk), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (e) {
        var studies = (e && e.ecg_studies) || [];
        if (!studies.length) { section.style.display = 'none'; return; }
        injectEcgStyles();
        mount.innerHTML = buildEcgSectionHtml(studies, clerk);
        section.style.display = '';
        hydrateEcgCharts(mount, clerk);
        wireEcgSwitcher(mount, studies, clerk);
      })
      .catch(function () { section.style.display = 'none'; });
  }

  ready(function () {
    injectChangeButton();
    // Patient Zero's home is a static page that ends in <footer> — we can
    // inject the danger zone right away, before the footer.
    if (patient === PATIENT_ZERO || patient === LEO_KELLER) {
      var section0 = currentSection();
      if (section0 === 'home') {
        injectStyles();
        injectDangerZone();
        decorateProceduresFromDb(patient); // fill #injury tables from the DB
      } else if (section0 === 'physical-exams') {
        // Static lab cards on Joao's hardcoded page — read the
        // historical comparison table at the bottom and graft the same
        // click-to-expand history UX onto every card. Runs for Leo too
        // (he inherits Joao's static HTML; leo-mode's hide pass only
        // touches alerts/timeline rows, not .lab-test or .lab-cmp-table).
        injectStyles();
        retrofitStaticLabHistory();
        decorateExamsWithAiOutliers(); // 9a — AI outlier explanation onto static lab cards
        decorateEcgStudies(patient);   // DB-driven ECG block on the static page
      }
      // LLM-authored AI insights (patient_dashboards / section 'ai-insights').
      // Static pages otherwise skip the dashboard layer, so do it here. No-ops
      // when the patient has no insights row yet (e.g. Leo).
      decorateWithAiInsights(section0);
      return;
    }

    injectStyles();
    hidePageBody();

    var section = currentSection();

    if (section === 'home') {
      fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (s) {
          renderHome(s);
          // Place the danger zone AFTER the just-rendered home — otherwise
          // it would land above it (renderHome appends to body, which would
          // sit below any sibling already inserted higher up).
          injectDangerZone(document.querySelector('main.jc-home'));
          decorateWithDashboard('home', { isHome: true });
          // LLM-authored AI insights (patient_dashboards / 'ai-insights'):
          // headline + cross-domain links on the landing. No-ops when the
          // patient has no insights row (docks next to the danger zone).
          decorateWithAiInsights('home');
          // Paulo Silotto: bespoke AI pain-map / symptom-inference section,
          // docked on the Summary page directly below the AI summary card.
          if (patient === PAULO_SILOTTO) injectPauloPainMap();
        })
        .catch(function () {
          renderEmptyShell(patient, null, t('Patient record', 'Prontuário do paciente'));
          injectDangerZone(document.querySelector('main.jc-empty-shell'));
        });
      return;
    }

    if (section === 'physical-exams') {
      if (patient === PAULO_SILOTTO) {
        renderPauloPhysicalExams();
        decorateWithAiInsights('physical'); // DB attention points + strengths -> bottom dock
        return;
      }
      if (patient === SILVANA_CRESTE) {
        renderSilvanaPhysicalExams();
      setTimeout(decorateExamsWithAiOutliers, 600); // 9a (bespoke; no-op if no .lab-test cards)
        return;
      }
      if (patient === CRISTINA_CRESTI) {
        renderCristinaPhysicalExams();
        setTimeout(decorateExamsWithAiOutliers, 600); // 9a (bespoke; no-op if no .lab-test cards)
        return;
      }
      fetch('/api/patient-exams?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (e) { renderExams(e); decorateWithDashboard('physical'); decorateExamsWithAiOutliers(); })
        .catch(function () { renderEmptyShell(patient, null, t('Physical → Exams', 'Físico → Exames')); });
      return;
    }

    // Paulo's only physical data is the manually-curated MRI pair, so
    // every Physical sub-page short-circuits to the bespoke MRI page.
    // Avoids the "0 / 0 / 0" metric grid that hides the actual content.
    if (patient === PAULO_SILOTTO &&
        (section === 'physical' || section === 'physical-vitals' || section === 'physical-genetics')) {
      renderPauloPhysicalExams();
      decorateWithAiInsights('physical'); // DB attention points + strengths -> bottom dock
      return;
    }

    // Paulo's Mental section is the verbatim collateral family account
    // (window.PAULO_MENTAL_NARRATIVE) rendered as a primary-source document,
    // not the DB metric grid. AI insights dock beneath once they exist.
    if (patient === PAULO_SILOTTO && section === 'mental') {
      renderPauloMental();
      decorateWithAiInsights('mental');
      return;
    }

    // Cristina's only physical data is the bespoke thyroid-antibody panel,
    // so the Physical overview short-circuits to the exams page — otherwise
    // the DB-driven "0 lab markers" metric grid hides the actual content.
    if (patient === CRISTINA_CRESTI && section === 'physical') {
      renderCristinaPhysicalExams();
      setTimeout(decorateExamsWithAiOutliers, 600); // 9a (bespoke; no-op if no .lab-test cards)
      return;
    }

    // Silvana's data is hand-curated. Routes:
    //   Physical (overview)  → 2-card landing (Sinais Vitais + Exames)
    //   Physical → Vitals    → bespoke InBody body-composition view
    //   Physical → Exams     → multi-year lab history page
    //   Physical → Genetics  → not built yet
    if (patient === SILVANA_CRESTE && section === 'physical') {
      renderSilvanaPhysicalLanding();
      return;
    }
    if (patient === SILVANA_CRESTE && section === 'physical-vitals') {
      renderSilvanaVitals();
      return;
    }
    if (patient === SILVANA_CRESTE && section === 'physical-exams') {
      renderSilvanaPhysicalExams();
      setTimeout(decorateExamsWithAiOutliers, 600); // 9a (bespoke; no-op if no .lab-test cards)
      return;
    }
    if (patient === SILVANA_CRESTE && section === 'physical-genetics') {
      renderEmptyShell(patient, 'Silvana Creste', t('Physical → Genetics', 'Físico → Genética'));
      return;
    }

    // Other section pages — show a small "not built yet" shell rather than the
    // home overview, so the user knows where they are.
    var labels = {
      'physical':          t('Physical',           'Físico'),
      'physical-vitals':   t('Physical → Vitals',  'Físico → Vitais'),
      'physical-genetics': t('Physical → Genetics','Físico → Genética'),
      'mental':            t('Mental',             'Mental'),
      'spiritual':         t('Spiritual',          'Espiritual'),
      'loops':             t('Loops',              'Loops'),
      'assessment':        t('Assessment',         'Avaliação'),
    };
    var dataRenderers = {
      'physical':          renderPhysical,
      'physical-vitals':   renderVitals,
      'physical-genetics': renderGenetics,
      'mental':            renderMental,
      'spiritual':         renderSpiritual,
    };
    fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (summary) {
        var renderer = dataRenderers[section];
        if (renderer) { renderer(summary); decorateWithDashboard(section); }
        else renderEmptyShell(patient, summary.patient && summary.patient.full_name, labels[section] || escapeHtml(section));
      })
      .catch(function () { renderEmptyShell(patient, null, labels[section] || escapeHtml(section)); });
  });

  /* ── LLM-authored dashboard layer ──────────────────────────────────
     Each rendered view (jc-home, jc-overview, jc-exams) gets an extra
     "AI Summary" card injected via decorateWithDashboard(section). The
     card shows the cached patient_dashboards.summary_md when present,
     otherwise a "Build summary" CTA. Home gets a second "Build all
     sections" CTA. Building triggers the donut overlay and fires one
     POST per section sequentially.                                    */

  var DASHBOARD_SECTIONS = ['home', 'physical', 'mental', 'spiritual', 'assessment'];
  var SECTION_LABEL = {
    home:       t('Home',       'Início'),
    physical:   t('Physical',   'Físico'),
    mental:     t('Mental',     'Mental'),
    spiritual:  t('Spiritual',  'Espiritual'),
    assessment: t('Assessment', 'Avaliação'),
  };
  var SECTION_LABEL_PLAIN_EN = {
    home: 'Home', physical: 'Physical', mental: 'Mental',
    spiritual: 'Spiritual', assessment: 'Assessment',
  };
  var SECTION_LABEL_PLAIN_PT = {
    home: 'Início', physical: 'Físico', mental: 'Mental',
    spiritual: 'Espiritual', assessment: 'Avaliação',
  };
  // Which dashboard section to inject onto which page slug.
  var PAGE_TO_DASHBOARD = {
    home:               'home',
    physical:           'physical',
    'physical-exams':   'physical',
    'physical-vitals':  'physical',
    'physical-genetics':'physical',
    mental:             'mental',
    spiritual:          'spiritual',
    assessment:         'assessment',
  };

  function viewerClerkHeader() {
    var vc = sessionStorage.getItem('jc_viewer_clerk') || sessionStorage.getItem('jc_current_patient') || patient;
    return vc;
  }

  function mdToHtml(md) {
    // Plain markdown only (the system prompt forbids headings / bullets).
    // Split on blank lines into paragraphs, apply minimal inline emphasis.
    var paragraphs = String(md || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
    return paragraphs.map(function (para) {
      var safe = escapeHtml(para.trim()).replace(/\n/g, '<br>');
      safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      return '<p>' + safe + '</p>';
    }).join('');
  }

  function relativeWhen(iso) {
    if (!iso) return '';
    var ts = new Date(iso).getTime();
    var secs = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (secs < 60)         return t(secs + 's ago',                  'há ' + secs + 's');
    if (secs < 3600)       return t(Math.floor(secs / 60) + 'm ago', 'há ' + Math.floor(secs / 60) + 'min');
    if (secs < 86400)      return t(Math.floor(secs / 3600) + 'h ago','há ' + Math.floor(secs / 3600) + 'h');
    if (secs < 86400 * 30) return t(Math.floor(secs / 86400) + 'd ago','há ' + Math.floor(secs / 86400) + 'd');
    return formatDate(iso);
  }

  /* ── SVG chart helpers ─────────────────────────────────────────── */

  var CHART_PALETTE = ['#244E6E', '#B8954A', '#3E7CA3', '#7A2E22', '#3F7A4F', '#7A8FA6'];

  function dateMs(s) {
    if (!s) return NaN;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  // SVG <text> can't host paired HTML spans, so pick the language at render
  // time. Charts won't re-translate mid-session when the user toggles
  // language — they re-render the next time the page is opened.
  function fmtTickDate(ms) {
    var d = new Date(ms);
    var yr = String(d.getUTCFullYear()).slice(2);
    var months = tPlain('en', 'pt') === 'pt'
      ? ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getUTCMonth()] + ' ' + yr;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function pickTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max) || min === max) return [min];
    var step = (max - min) / Math.max(1, count - 1);
    var ticks = [];
    for (var i = 0; i < count; i++) ticks.push(min + i * step);
    return ticks;
  }

  // Returns SVG markup for a line chart with an optional ref band.
  // series = [{ color, points: [{date, value, flag}] }, ...]
  function svgLineChart(opts) {
    var series = opts.series || [];
    var width  = opts.width  || 600;
    var height = opts.height || 200;
    var padL = 56, padR = 18, padT = 16, padB = 32;
    var iw = width - padL - padR;
    var ih = height - padT - padB;
    if (series.length === 0) return '';

    // Aggregate x / y bounds
    var xs = [], ys = [];
    series.forEach(function (s) {
      (s.points || []).forEach(function (p) {
        var x = dateMs(p.date);
        if (!isNaN(x) && p.value != null && isFinite(p.value)) {
          xs.push(x); ys.push(+p.value);
        }
      });
    });
    if (xs.length === 0) return '';

    var xMin = Math.min.apply(null, xs);
    var xMax = Math.max.apply(null, xs);
    if (xMin === xMax) { xMin = xMin - 86400000; xMax = xMax + 86400000; }
    var yLow  = opts.ref_low,  yHigh = opts.ref_high;
    if (yLow  != null && isFinite(yLow))  ys.push(+yLow);
    if (yHigh != null && isFinite(yHigh)) ys.push(+yHigh);
    var yMin = Math.min.apply(null, ys);
    var yMax = Math.max.apply(null, ys);
    var ySpan = yMax - yMin;
    if (ySpan === 0) { ySpan = Math.abs(yMin) || 1; yMin -= ySpan / 2; yMax += ySpan / 2; }
    var pad5 = ySpan * 0.08;
    yMin -= pad5; yMax += pad5;

    function xPx(t) { return padL + ((t - xMin) / (xMax - xMin)) * iw; }
    function yPx(v) { return padT + ih - ((v - yMin) / (yMax - yMin)) * ih; }

    var refBand = '';
    if (yLow != null && yHigh != null && isFinite(yLow) && isFinite(yHigh)) {
      var y1 = yPx(yHigh), y2 = yPx(yLow);
      refBand =
        '<rect x="' + padL + '" y="' + y1 + '" width="' + iw + '" height="' + (y2 - y1) +
        '" fill="#E7EEFB" opacity="0.6"/>' +
        '<line x1="' + padL + '" x2="' + (padL + iw) + '" y1="' + y1 + '" y2="' + y1 + '" stroke="#ABBFE5" stroke-dasharray="3,3" stroke-width="1"/>' +
        '<line x1="' + padL + '" x2="' + (padL + iw) + '" y1="' + y2 + '" y2="' + y2 + '" stroke="#ABBFE5" stroke-dasharray="3,3" stroke-width="1"/>';
    }

    // Y-axis ticks (3 lines)
    var yTicks = pickTicks(yMin + pad5, yMax - pad5, 3);
    var yAxis = yTicks.map(function (v) {
      var y = yPx(v);
      var label = (Math.abs(v) >= 100) ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '');
      return '<line x1="' + padL + '" x2="' + (padL + iw) + '" y1="' + y + '" y2="' + y + '" stroke="#EFEBE3" stroke-width="1"/>' +
             '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" fill="#7A8FA6">' + label + '</text>';
    }).join('');

    // X-axis ticks (use min, mid, max)
    var xTicks = [xMin, (xMin + xMax) / 2, xMax];
    var xAxis = xTicks.map(function (t) {
      var x = xPx(t);
      return '<text x="' + x + '" y="' + (padT + ih + 16) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" fill="#7A8FA6">' + fmtTickDate(t) + '</text>';
    }).join('');

    var seriesSvg = series.map(function (s, i) {
      var color = s.color || CHART_PALETTE[i % CHART_PALETTE.length];
      var pts = (s.points || []).slice().sort(function (a, b) { return dateMs(a.date) - dateMs(b.date); });
      var d = pts.map(function (p, j) {
        var x = xPx(dateMs(p.date)), y = yPx(+p.value);
        return (j === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
      var line = pts.length > 1
        ? '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '';
      var dots = pts.map(function (p) {
        var x = xPx(dateMs(p.date)), y = yPx(+p.value);
        var isFlag = p.flag === 'H' || p.flag === 'HH' || p.flag === 'L' || p.flag === 'LL';
        var fill = isFlag ? '#7A2E22' : color;
        return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5" fill="' + fill + '" stroke="#FFFFFF" stroke-width="1.2"><title>' + escapeHtml(formatDate(p.date)) + ' · ' + escapeHtml(String(p.value)) + (s.unit ? ' ' + escapeHtml(s.unit) : '') + '</title></circle>';
      }).join('');
      return line + dots;
    }).join('');

    var legend = series.length > 1
      ? '<g transform="translate(' + padL + ',' + (padT - 6) + ')">' +
          series.map(function (s, i) {
            var color = s.color || CHART_PALETTE[i % CHART_PALETTE.length];
            return '<g transform="translate(' + (i * 110) + ',0)">' +
                     '<rect x="0" y="-7" width="10" height="3" fill="' + color + '" rx="1"/>' +
                     '<text x="14" y="-3" font-family="IBM Plex Mono, monospace" font-size="10" fill="#1E2D3D">' + escapeHtml(s.marker || '') + '</text>' +
                   '</g>';
          }).join('') +
        '</g>'
      : '';

    return (
      '<svg class="ov-chart" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet">' +
        refBand + yAxis + xAxis + seriesSvg + legend +
      '</svg>'
    );
  }

  // Horizontal range bar: where does `value` sit between ref_low and ref_high?
  function svgRangeBar(value, refLow, refHigh, flag) {
    if (value == null || !isFinite(+value)) return '';
    if (refLow == null || refHigh == null || refLow === refHigh) return '';
    var v = +value, lo = +refLow, hi = +refHigh;
    var span = hi - lo;
    var lowEnd = Math.min(lo, v) - span * 0.15;
    var hiEnd  = Math.max(hi, v) + span * 0.15;
    var total = hiEnd - lowEnd;
    var w = 160, h = 12;
    function xp(x) { return ((x - lowEnd) / total) * w; }
    var bandX = xp(lo), bandW = xp(hi) - xp(lo);
    var dotX = xp(v);
    var isFlag = flag === 'H' || flag === 'HH' || flag === 'L' || flag === 'LL';
    var dotFill = isFlag ? '#7A2E22' : '#244E6E';
    return (
      '<svg class="ov-rangebar" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<rect x="0" y="' + (h/2 - 0.6) + '" width="' + w + '" height="1.2" fill="#E5E2DC"/>' +
        '<rect x="' + bandX.toFixed(1) + '" y="' + (h/2 - 3) + '" width="' + bandW.toFixed(1) + '" height="6" rx="3" fill="#D8E8F2"/>' +
        '<circle cx="' + dotX.toFixed(1) + '" cy="' + (h/2) + '" r="4" fill="' + dotFill + '" stroke="#FFFFFF" stroke-width="1.2"/>' +
      '</svg>'
    );
  }

  function fmtNum(n) {
    if (n === null || n === undefined || n === '') return '—';
    if (typeof n === 'number' && !Number.isFinite(n)) return '—';
    return String(n);
  }

  function refRangeStr(low, high) {
    if (low == null && high == null) return '—';
    return (low == null ? '–' : fmtNum(low)) + ' – ' + (high == null ? '–' : fmtNum(high));
  }

  function valueWithUnit(v, vText, unit) {
    if (v == null && vText == null) return '—';
    var s = v != null ? fmtNum(v) : String(vText);
    return s + (unit ? ' ' + escapeHtml(unit) : '');
  }

  // Canon card shell (matches the chart-card family in styles.css + the template).
  // kind -> a chart-card--<kind> modifier carries the per-section accent border.
  function ovCardHead(title, subtitle, extraMeta) {
    var meta = '';
    if (subtitle) meta += '<div class="chart-card-meta">' + escapeHtml(subtitle) + '</div>';
    if (extraMeta) meta += extraMeta;
    return '<div class="chart-card-head"><div class="chart-card-title">' + escapeHtml(title) + '</div>' + meta + '</div>';
  }

  function renderCardNarrative(c) {
    return (
      '<section class="chart-card chart-card--narrative">' +
        ovCardHead(c.title, c.subtitle) +
        '<div class="card-body">' + mdToHtml(c.body_md || '') + '</div>' +
      '</section>'
    );
  }

  function renderCardPanelSnapshot(c) {
    var tests = (c.markers || []).map(renderLabTest).join('');
    return (
      '<section class="chart-card chart-card--panel">' +
        ovCardHead(c.title, c.subtitle) +
        '<div class="lab-panel-body">' + tests + '</div>' +
      '</section>'
    );
  }

  function renderCardMarkerTimeline(c) {
    var points = (c.points || []).slice().sort(function (a, b) {
      return dateMs(a.date) - dateMs(b.date);
    });
    var ref = refRangeStr(c.ref_low, c.ref_high);
    var refLine = (ref !== '—' ? '<div class="chart-card-meta">' + t('Reference:', 'Referência:') + ' ' + escapeHtml(ref) + (c.unit ? ' ' + escapeHtml(c.unit) : '') + '</div>' : '');
    var chart = svgLineChart({
      series: [{ marker: c.marker, unit: c.unit, color: CHART_PALETTE[0], points: points }],
      ref_low: c.ref_low, ref_high: c.ref_high,
      width: 640, height: 200,
    });
    // Compact value list below the chart so exact numbers stay accessible.
    var unit = c.unit ? ' ' + c.unit : '';
    var pills = points.map(function (p) {
      var flagged = p.flag ? fmtFlag(p.flag) : '';
      return '<span class="ov-pt-pill">' +
        '<span class="ov-pt-date">' + escapeHtml(formatDate(p.date)) + '</span>' +
        '<span class="ov-pt-val">' + escapeHtml(fmtNum(p.value)) + escapeHtml(unit) + flagged + '</span>' +
      '</span>';
    }).join('');
    return (
      '<section class="chart-card chart-card--timeline">' +
        ovCardHead(c.title, c.subtitle, refLine) +
        '<div class="card-chart-svg">' + chart + '</div>' +
        (pills ? '<div class="ov-pt-pills">' + pills + '</div>' : '') +
      '</section>'
    );
  }

  function renderCardMultiMarkerTimeline(c) {
    var series = (c.series || []).map(function (s, i) {
      return {
        marker: s.marker,
        unit: s.unit,
        color: s.color || CHART_PALETTE[i % CHART_PALETTE.length],
        points: (s.points || []).slice().sort(function (a, b) { return dateMs(a.date) - dateMs(b.date); }),
      };
    });
    // Multi-series ref band only makes sense if all series share a range.
    var sharedLow  = series.length && series.every(function (s) { return s.ref_low  === series[0].ref_low;  }) ? series[0].ref_low  : null;
    var sharedHigh = series.length && series.every(function (s) { return s.ref_high === series[0].ref_high; }) ? series[0].ref_high : null;
    var chart = svgLineChart({
      series: series,
      ref_low: sharedLow, ref_high: sharedHigh,
      width: 640, height: 220,
    });
    return (
      '<section class="chart-card chart-card--timeline">' +
        ovCardHead(c.title, c.subtitle) +
        '<div class="card-chart-svg">' + chart + '</div>' +
      '</section>'
    );
  }

  function renderCardFlagList(c) {
    var tests = (c.items || []).map(renderLabTest).join('');
    return (
      '<section class="chart-card chart-card--flags">' +
        ovCardHead(c.title, c.subtitle) +
        '<div class="lab-panel-body">' + tests + '</div>' +
      '</section>'
    );
  }

  var CARD_RENDERERS = {
    'narrative':              renderCardNarrative,
    'panel-snapshot':         renderCardPanelSnapshot,
    'marker-timeline':        renderCardMarkerTimeline,
    'multi-marker-timeline':  renderCardMultiMarkerTimeline,
    'flag-list':              renderCardFlagList,
  };

  /* ── AI insights renderer (single-pass whole-record payload) ───────
     Consumes patient_dashboards.cards_json for section 'ai-insights'
     (see lib/ai-insights.js). Renders per current page, always inserted
     below the hero + Reports (before <footer>) per the hero-first rule.   */

  function aiBt(o) {
    if (!o) return '';
    var en = o.en || o.pt || '', pt = o.pt || o.en || '';
    return t(escapeHtml(en), escapeHtml(pt));
  }
  function aiPill() { return '<span class="ai-pill">AI</span>'; }
  function aiSevChip(sev) {
    if (!sev) return '';
    return '<span class="ai-chip ai-sevchip-' + sev + '">' + escapeHtml(sev) + '</span>';
  }
  function aiEvidence(ev) {
    if (!ev || !ev.length) return '';
    var items = ev.map(function (e) {
      if (!e) return '';
      var main = [];
      if (e.ref) main.push('<strong>' + escapeHtml(e.ref) + '</strong>');
      if (e.value) main.push(escapeHtml(e.value));
      var meta = [];
      if (e.source) meta.push(escapeHtml(e.source));
      if (e.date) meta.push(escapeHtml(formatDate(e.date)));
      return '<li>' + main.join(' — ') + (meta.length ? ' <span class="ai-ev-meta">' + meta.join(' · ') + '</span>' : '') + '</li>';
    }).join('');
    return '<ul class="ai-ev">' + items + '</ul>';
  }
  function aiClin(note) {
    if (!note || !(note.en || note.pt)) return '';
    return '<p class="ai-clin">' + t('Discuss with your clinician', 'Converse com seu médico') + ': '
      + '<span class="ai-clin-body">' + aiBt(note).replace(/^<span/, '<span') + '</span></p>';
  }
  // ── New comprehensive-rebuild schema: risk_level / strength_level /
  //    trajectory. Legacy payloads (severity / kind) still render via the
  //    fallbacks in normRisk + aiTierClass.
  function normRisk(r) {
    if (r === 'elevated') return 'high';
    if (r === 'watch') return 'medium';
    if (r === 'info') return 'low';
    return (r === 'high' || r === 'medium' || r === 'low') ? r : 'medium';
  }
  function aiTierClass(it) {
    if (it.kind === 'strength') return 'str-' + (normRisk(it.strength_level) || 'medium');
    return 'risk-' + normRisk(it.risk_level || it.severity);
  }
  function aiTierChip(it) {
    if (it.kind === 'strength') {
      var sl = normRisk(it.strength_level);
      var sLab = { high: ['key strength', 'força-chave'], medium: ['strength', 'força'], low: ['emerging strength', 'força emergente'] }[sl];
      return '<span class="ai-chip ai-chip-str ai-chip-str-' + sl + '">' + t(sLab[0], sLab[1]) + '</span>';
    }
    var r = normRisk(it.risk_level || it.severity);
    var rLab = { high: ['high risk', 'risco alto'], medium: ['medium risk', 'risco médio'], low: ['low risk', 'risco baixo'] }[r];
    return '<span class="ai-chip ai-chip-risk ai-chip-risk-' + r + '">' + t(rLab[0], rLab[1]) + '</span>';
  }
  var AI_TRAJ = {
    improving: ['▲', 'improving', 'melhorando'], worsening: ['▼', 'worsening', 'piorando'],
    stable: ['▬', 'stable', 'estável'], 'new': ['✦', 'new', 'novo'],
    insufficient_history: ['…', 'limited history', 'histórico limitado'],
  };
  function aiTrajChip(tr) {
    var m = AI_TRAJ[tr];
    return m ? '<span class="ai-traj ai-traj-' + tr + '">' + m[0] + ' ' + t(m[1], m[2]) + '</span>' : '';
  }
  function aiTrajNote(it) {
    return (it.trajectory_note && (it.trajectory_note.en || it.trajectory_note.pt))
      ? '<p class="ai-traj-note">' + aiBt(it.trajectory_note) + '</p>' : '';
  }
  function aiInsightCard(it) {
    if (!it || !it.title) return '';
    var hasDetail = it.detail && (it.detail.en || it.detail.pt);
    var foot = hasDetail
      ? '<details class="ai-detail"><summary>' + t('More', 'Mais') + '</summary>'
        + '<div class="ai-detail-body">' + aiBt(it.detail) + '</div>'
        + aiEvidence(it.evidence) + aiClin(it.clinician_note) + '</details>'
      : (aiEvidence(it.evidence) + aiClin(it.clinician_note));
    return '<div class="ai-card ai-insight-card ai-edge-' + aiTierClass(it) + '">'
      + '<div class="ai-card-head">' + aiPill() + aiTierChip(it) + aiTrajChip(it.trajectory)
      + '<span class="ai-card-title">' + aiBt(it.title) + '</span></div>'
      + '<p class="ai-card-summary">' + aiBt(it.summary) + '</p>' + aiTrajNote(it)
      + foot + '</div>';
  }
  function aiCrossCard(l) {
    if (!l || !l.summary) return '';
    return '<div class="ai-card ai-insight-card ai-sevedge-cross">' + aiPill()
      + '<p class="ai-card-summary">' + aiBt(l.summary) + '</p>' + aiEvidence(l.evidence) + '</div>';
  }
  function aiInlineSub(headEn, headPt, inner) {
    return '<div class="ai-inline-sub"><span class="ai-inline-sub-h">' + t(headEn, headPt) + '</span>' + inner + '</div>';
  }
  function aiInlineCard(x) {
    if (!x || !x.title) return '';
    var isImaging = x.trigger === 'concerning_imaging' || x.trigger === 'imaging_followup';
    var isLab = x.trigger === 'out_of_range_lab' || x.trigger === 'trending_lab';
    var has = function (b) { return b && (b.en || b.pt); };
    var body = '';
    if (isImaging) {
      if (has(x.plain_language_reading)) body += '<p class="ai-card-summary">' + aiBt(x.plain_language_reading) + '</p>';
      if (has(x.what_the_report_says)) body += aiInlineSub('What the report says', 'O que o laudo diz', aiBt(x.what_the_report_says));
    } else if (isLab) {
      if (has(x.interpretation)) body += '<p class="ai-card-summary">' + aiBt(x.interpretation) + '</p>';
      var cf = (x.contributing_factors || []).filter(Boolean).map(function (f) { return '<li>' + aiBt(f) + '</li>'; }).join('');
      if (cf) body += aiInlineSub('Possible contributing factors', 'Possíveis fatores contribuintes', '<ul class="ai-inline-list">' + cf + '</ul>');
    }
    if (!body && has(x.body)) body = '<p class="ai-card-summary">' + aiBt(x.body) + '</p>';
    var ns = (x.next_steps || []).filter(Boolean).map(function (s) { return '<li>' + aiBt(s) + '</li>'; }).join('');
    var nsHtml = ns ? aiInlineSub('Next steps', 'Próximos passos', '<ul class="ai-inline-list">' + ns + '</ul>') : '';
    return '<div class="ai-card ai-insight-card ai-edge-risk-' + normRisk(x.risk_level || x.severity) + '">'
      + '<div class="ai-card-head">' + aiPill()
      + aiTierChip({ kind: 'attention', risk_level: x.risk_level, severity: x.severity })
      + aiTrajChip(x.trajectory)
      + (x.trigger ? '<span class="ai-trigger">' + escapeHtml(String(x.trigger).replace(/_/g, ' ')) + '</span>' : '')
      + '<span class="ai-card-title">' + aiBt(x.title) + '</span></div>'
      + (x.anchor ? '<p class="ai-anchor">' + escapeHtml(x.anchor) + '</p>' : '')
      + body + aiTrajNote(x) + nsHtml + aiEvidence(x.evidence) + '</div>';
  }
  function aiPillarCards(page) {
    if (!page) return '';
    var att = (page.attention_points || []).map(aiInsightCard).join('');
    var str = (page.strengths || []).map(aiInsightCard).join('');
    if (!att && !str) return '';
    return (att ? '<h3 class="ai-sub">' + t('Attention points', 'Pontos de atenção') + '</h3>' + att : '')
      + (str ? '<h3 class="ai-sub">' + t('Strengths', 'Pontos fortes') + '</h3>' + str : '');
  }
  function aiHeader(titleEn, titlePt, subHtml) {
    return '<div class="ai-ins-header">'
      + '<div class="ai-ins-titlerow">' + aiPill() + '<h2 class="ai-ins-title">' + t(escapeHtml(titleEn), escapeHtml(titlePt)) + '</h2></div>'
      + '<p class="ai-ins-disc">' + t(
        'AI-generated synthesis over your record — for discussion with your clinician, not a diagnosis.',
        'Síntese gerada por IA sobre seu prontuário — para discussão com seu médico, não um diagnóstico.') + '</p>'
      + (subHtml ? '<p class="ai-ins-sub">' + subHtml + '</p>' : '') + '</div>';
  }

  // Resolve summary refs (points_to_work_on / points_to_leverage, or legacy
  // top_attention_points / top_strengths) into the actual insight objects.
  function aiResolveRefs(p, refs) {
    var byId = {};
    ['physical', 'mental', 'spiritual'].forEach(function (pg) {
      var pp = (p.pages && p.pages[pg]) || {};
      [].concat(pp.attention_points || [], pp.strengths || []).forEach(function (i) { byId[i.id] = i; });
    });
    return (refs || []).map(function (r) { return byId[r && r.insight_id]; }).filter(Boolean);
  }
  function aiOverview(b) { return (b && (b.en || b.pt)) ? '<p class="ai-overview">' + aiBt(b) + '</p>' : ''; }

  function buildAiInsightsHtml(p, section) {
    var pages = p.pages || {};
    var sm = p.summary || {};
    var headline = sm.headline ? aiBt(sm.headline) : '';
    // Accept new subpage anchors AND the legacy short names.
    var INLINE_FOR = {
      'physical-exams': ['labs', 'imaging', 'physical-exams'],
      'physical-vitals': ['vitals', 'ecg', 'physical-vitals'],
      'physical-genetics': ['pgx', 'physical-genetics'],
    };

    if (section === 'home') {
      var work = aiResolveRefs(p, sm.points_to_work_on || sm.top_attention_points).map(aiInsightCard).join('');
      var lev = aiResolveRefs(p, sm.points_to_leverage || sm.top_strengths).map(aiInsightCard).join('');
      var links = (sm.cross_domain_links || []).map(aiCrossCard).join('');
      var overview = aiOverview(sm.overview);
      if (!headline && !overview && !work && !lev && !links) return '';
      return aiHeader('Health synthesis', 'Síntese de saúde', headline)
        + overview
        + (work ? '<h3 class="ai-sub">' + t('Points to work on', 'Pontos a trabalhar') + '</h3>' + work : '')
        + (lev ? '<h3 class="ai-sub">' + t('Points to leverage', 'Pontos a favor') + '</h3>' + lev : '')
        + (links ? '<h3 class="ai-sub">' + t('Cross-domain links', 'Conexões entre domínios') + '</h3>' + links : '');
    }
    if (section === 'assessment') {
      var links2 = (sm.cross_domain_links || []).map(aiCrossCard).join('');
      var allInline = (p.inline_insights || []).map(aiInlineCard).join('');
      var body = aiOverview(sm.overview)
        + (links2 ? '<h3 class="ai-sub">' + t('Cross-domain links', 'Conexões entre domínios') + '</h3>' + links2 : '');
      [['physical', 'Physical', 'Físico'], ['mental', 'Mental', 'Mental'], ['spiritual', 'Spiritual', 'Espiritual']].forEach(function (d) {
        var pc = aiPillarCards(pages[d[0]]);
        if (pc) body += '<h3 class="ai-sub ai-pillar-h">' + t(d[1], d[2]) + '</h3>' + aiOverview(pages[d[0]] && pages[d[0]].overview) + pc;
      });
      if (allInline) body += '<h3 class="ai-sub">' + t('Specific findings', 'Achados específicos') + '</h3>' + allInline;
      if (!headline && !body) return '';
      return aiHeader('AI health overview', 'Visão geral por IA', headline) + body;
    }
    if (section === 'physical' || section === 'mental' || section === 'spiritual') {
      var ov = aiOverview(pages[section] && pages[section].overview);
      var cards = aiPillarCards(pages[section]);
      var extra = '';
      if (section === 'mental') {
        var w = (p.inline_insights || []).filter(function (x) {
          return x.subpage === 'writings' || x.subpage === 'mental';
        }).map(aiInlineCard).join('');
        if (w) extra = '<h3 class="ai-sub">' + t('From your record', 'A partir do seu prontuário') + '</h3>' + w;
      }
      if (!ov && !cards && !extra) return '';
      var lbl = { physical: ['Physical', 'Físico'], mental: ['Mental', 'Mental'], spiritual: ['Spiritual', 'Espiritual'] }[section];
      return aiHeader(lbl[0] + ' — AI synthesis', lbl[1] + ' — síntese por IA') + ov + cards + extra;
    }
    if (INLINE_FOR[section]) {
      var subs = INLINE_FOR[section];
      var inl = (p.inline_insights || []).filter(function (x) { return subs.indexOf(x.subpage) >= 0; }).map(aiInlineCard).join('');
      if (!inl) return '';
      return aiHeader('Specific findings', 'Achados específicos') + inl;
    }
    return '';
  }

  function injectAiInsightsStyles() {
    if (document.getElementById('ai-ins-styles')) return;
    var css = [
      '.ai-ins-block{max-width:880px;margin:32px auto 8px;padding:28px 22px 8px;border-top:1px solid #E5E2DC;}',
      '.ai-ins-header{margin-bottom:18px;}',
      '.ai-ins-titlerow{display:flex;align-items:center;gap:10px;}',
      '.ai-ins-title{font-family:Raleway,system-ui,sans-serif;font-size:1.25rem;color:#0D1B2A;margin:0;}',
      '.ai-ins-disc{font-size:.78rem;color:#7A8FA6;margin:6px 0 0;}',
      '.ai-ins-sub{font-size:1rem;line-height:1.5;color:#1E2D3D;margin:12px 0 0;font-weight:500;}',
      '.ai-sub{font-family:"IBM Plex Mono",monospace;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#7A8FA6;margin:22px 0 10px;}',
      '.ai-sub.ai-pillar-h{color:#B8954A;border-top:1px solid #EFEAE0;padding-top:14px;}',
      // Amber AI-insight card (design-system rule 7a): every text-based AI insight
      // reads amber. Tokens from styles.css; literal fallbacks keep it robust.
      '.ai-card{background:var(--ai-insight-bg,#FDF8EC);border:1px solid var(--ai-insight-stroke,#F4DD9C);border-left:4px solid #7A8FA6;border-radius:10px;padding:14px 16px;margin:10px 0;box-shadow:0 1px 2px rgba(13,27,42,.04);}',
      '.ai-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;}',
      '.ai-card-title{font-weight:600;color:#0D1B2A;font-size:.96rem;}',
      '.ai-card-summary{margin:4px 0 0;color:#1E2D3D;font-size:.9rem;line-height:1.5;}',
      '.ai-sevedge-high{border-left-color:#c0392b;}.ai-sevedge-elevated{border-left-color:#d97706;}',
      '.ai-sevedge-watch{border-left-color:#B8954A;}.ai-sevedge-info{border-left-color:#7A8FA6;}',
      '.ai-sevedge-strength{border-left-color:#2e7d52;}.ai-sevedge-cross{border-left-color:#B8954A;background:#FBF8F2;}',
      // New schema: risk_level / strength_level edges + chips + trajectory.
      '.ai-edge-risk-high{border-left-color:#c0392b;}.ai-edge-risk-medium{border-left-color:#d97706;}.ai-edge-risk-low{border-left-color:#7A8FA6;}',
      '.ai-edge-str-high{border-left-color:#2e7d52;}.ai-edge-str-medium{border-left-color:#3a9d6a;}.ai-edge-str-low{border-left-color:#7Fae93;}',
      '.ai-chip-risk-high{background:#fbe9e7;color:#c0392b;}.ai-chip-risk-medium{background:#fef3e2;color:#b45309;}.ai-chip-risk-low{background:#eef1f4;color:#566;}',
      '.ai-chip-str-high{background:#e6f4ec;color:#2e7d52;}.ai-chip-str-medium{background:#e9f5ef;color:#2e7d52;}.ai-chip-str-low{background:#eef6f1;color:#4a8a68;}',
      '.ai-traj{font-family:"IBM Plex Mono",monospace;font-size:.62rem;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:#EEF1F4;color:#566;}',
      '.ai-traj-improving{background:#e6f4ec;color:#2e7d52;}.ai-traj-worsening{background:#fbe9e7;color:#c0392b;}',
      '.ai-traj-stable{background:#eef1f4;color:#566;}.ai-traj-new{background:#ede7f6;color:#6B4FA0;}.ai-traj-insufficient_history{background:#f3f1ea;color:#8a7d5a;}',
      '.ai-traj-note{margin:6px 0 0;font-size:.82rem;color:#5a6b5f;font-style:italic;line-height:1.45;}',
      '.ai-overview{margin:10px 0 4px;color:#1E2D3D;font-size:.92rem;line-height:1.55;}',
      '.ai-inline-sub{margin:8px 0 0;}',
      '.ai-inline-sub-h{display:block;font-family:"IBM Plex Mono",monospace;font-size:.64rem;letter-spacing:.06em;text-transform:uppercase;color:#8a6d23;font-weight:700;margin-bottom:3px;}',
      '.ai-inline-list{list-style:disc;margin:0;padding-left:18px;}.ai-inline-list li{font-size:.84rem;color:#3a4a5a;margin:2px 0;line-height:1.45;}',
      '.ai-chip{font-family:"IBM Plex Mono",monospace;font-size:.62rem;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:#EEF1F4;color:#566;}',
      '.ai-sevchip-high{background:#fbe9e7;color:#c0392b;}.ai-sevchip-elevated{background:#fef3e2;color:#b45309;}',
      '.ai-sevchip-watch{background:#f7f0dd;color:#8a6d23;}.ai-sevchip-info{background:#eef1f4;color:#566;}',
      '.ai-sevchip-strength{background:#e6f4ec;color:#2e7d52;}',
      '.ai-trigger{font-family:"IBM Plex Mono",monospace;font-size:.62rem;letter-spacing:.04em;color:#7A8FA6;}',
      '.ai-anchor{font-size:.74rem;color:#7A8FA6;margin:2px 0 4px;}',
      '.ai-ev{list-style:none;margin:8px 0 0;padding:0;border-top:1px dashed #EAE6DE;padding-top:8px;}',
      '.ai-ev li{font-size:.8rem;color:#3a4a5a;margin:3px 0;line-height:1.4;}',
      '.ai-ev-meta{color:#9aa7b4;font-size:.72rem;}',
      '.ai-detail{margin-top:8px;}.ai-detail summary{cursor:pointer;font-size:.78rem;color:#B8954A;font-weight:600;}',
      '.ai-detail-body{margin:8px 0 0;color:#1E2D3D;font-size:.86rem;line-height:1.55;}',
      '.ai-clin{margin:8px 0 0;font-size:.82rem;color:#0D1B2A;}.ai-clin-body{color:#3a4a5a;}',
      // Exam outlier explanation (9a) — attached inside each .lab-test card.
      '.lab-ai-explain{margin-top:12px;padding-top:12px;border-top:1px dashed #EAE6DE;}',
      '.lab-ai-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;}',
      '.lab-ai-trigger{font-family:"IBM Plex Mono",monospace;font-size:.62rem;letter-spacing:.05em;text-transform:uppercase;color:#7A8FA6;}',
      '.lab-ai-interp{margin:2px 0 10px;color:#1E2D3D;font-size:.88rem;line-height:1.5;}',
      '.lab-ai-cf{border-radius:10px;padding:12px 14px;margin:8px 0;}',
      '.lab-ai-cf-head{font-family:"IBM Plex Mono",monospace;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:#8a6d23;font-weight:700;}',
      '.lab-ai-cf-disc{font-size:.74rem;font-style:italic;color:#8a6d23;margin:4px 0 8px;}',
      '.lab-ai-cf-list{list-style:disc;margin:0;padding-left:18px;}',
      '.lab-ai-cf-list li{font-size:.84rem;color:#3a4a5a;margin:3px 0;line-height:1.45;}',
      '.lab-ai-next{margin-top:8px;}',
      '.lab-ai-next-head{font-family:"IBM Plex Mono",monospace;font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:#7A8FA6;margin-bottom:3px;}',
      '.lab-ai-next ul{list-style:disc;margin:0;padding-left:18px;}',
      '.lab-ai-next li{font-size:.82rem;color:#3a4a5a;margin:2px 0;line-height:1.45;}',
    ].join('');
    var s = document.createElement('style');
    s.id = 'ai-ins-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function decorateWithAiInsights(section) {
    fetch('/api/patient-dashboard?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { sections: {} }; })
      .catch(function () { return { sections: {} }; })
      .then(function (data) {
        var rec = data && data.sections && data.sections['ai-insights'];
        var payload = rec && rec.cards_json;
        if (!payload || !payload.pages) return;
        var html = buildAiInsightsHtml(payload, section);
        if (!html) return;
        injectAiInsightsStyles();
        var prior = document.querySelector('section[data-ai-insights]');
        if (prior) prior.remove();
        var sec = document.createElement('section');
        sec.className = 'ai-ins-block';
        sec.setAttribute('data-ai-insights', '1');
        sec.innerHTML = html;
        var footer = document.querySelector('footer');
        if (footer && footer.parentNode) footer.parentNode.insertBefore(sec, footer);
        else document.body.appendChild(sec);
        reflowBottomDock(); // dock the AI cards next to the danger zone
      });
  }

  // ── Exam-page outlier explanation cards (9a) ───────────────────────
  // For each AI lab inline insight (out_of_range_lab / trending_lab) carrying the
  // structured card fields, attach an interpretation + amber POSSIBLE CONTRIBUTING
  // FACTORS block + next-steps onto the matching .lab-test card. The reference bar
  // and clickable history (9b) are already rendered by renderLabTest /
  // retrofitStaticLabHistory. No-op for analytes with no AI insight (those cards
  // keep their data-only view). Generated one-per-outlier — never hand-curated.
  function normAnalyte(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }
  function aiOutlierExplainHtml(x) {
    var interp = (x.interpretation && (x.interpretation.en || x.interpretation.pt)) ? aiBt(x.interpretation) : '';
    var cf = (x.contributing_factors || []).filter(Boolean).map(function (f) { return '<li>' + aiBt(f) + '</li>'; }).join('');
    var ns = (x.next_steps || []).filter(Boolean).map(function (s) { return '<li>' + aiBt(s) + '</li>'; }).join('');
    if (!interp && !cf && !ns) return '';
    var html = '<div class="lab-ai-head">' + aiPill()
      + aiTierChip({ kind: 'attention', risk_level: x.risk_level, severity: x.severity }) + aiTrajChip(x.trajectory)
      + '<span class="lab-ai-trigger">' + t('AI reading', 'Leitura por IA') + '</span></div>';
    if (interp) html += '<p class="lab-ai-interp">' + interp + '</p>';
    if (cf) html += '<div class="ai-insight-card lab-ai-cf">'
      + '<div class="lab-ai-cf-head">' + t('Possible contributing factors', 'Possíveis fatores contribuintes') + '</div>'
      + '<p class="lab-ai-cf-disc">' + t(
          '— suggestive only, based on current medication and history. Does not replace clinical evaluation.',
          '— apenas sugestivo, com base na medicação e no histórico atuais. Não substitui avaliação clínica.') + '</p>'
      + '<ul class="lab-ai-cf-list">' + cf + '</ul></div>';
    if (ns) html += '<div class="lab-ai-next"><div class="lab-ai-next-head">' + t('Next steps', 'Próximos passos') + '</div><ul>' + ns + '</ul></div>';
    return html;
  }
  function decorateExamsWithAiOutliers() {
    fetch('/api/patient-dashboard?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { sections: {} }; })
      .catch(function () { return { sections: {} }; })
      .then(function (data) {
        var rec = data && data.sections && data.sections['ai-insights'];
        var payload = rec && rec.cards_json;
        var inl = payload && payload.inline_insights;
        if (!inl || !inl.length) return;
        var byKey = {};
        inl.forEach(function (x) {
          if (!x) return;
          if (x.trigger !== 'out_of_range_lab' && x.trigger !== 'trending_lab') return;
          var k = normAnalyte(x.analyte || (x.title && (x.title.en || x.title.pt)) || x.anchor);
          if (k && !byKey[k]) byKey[k] = x;
        });
        if (!Object.keys(byKey).length) return;
        injectAiInsightsStyles();
        var cards = document.querySelectorAll('.lab-test');
        for (var i = 0; i < cards.length; i++) {
          var card = cards[i];
          if (card.querySelector('.lab-ai-explain')) continue;
          var nameEl = card.querySelector('.lab-test-name');
          if (!nameEl) continue;
          var x = byKey[normAnalyte(nameEl.textContent)];
          if (!x) continue;
          var html = aiOutlierExplainHtml(x);
          if (!html) continue;
          var div = document.createElement('div');
          div.className = 'lab-ai-explain';
          div.innerHTML = html;
          var hist = card.querySelector('.lab-test-history');
          if (hist) card.insertBefore(div, hist); else card.appendChild(div);
        }
      });
  }
  // Exposed so a rebuild can refresh the per-outlier cards too.
  window.jcDecorateExamOutliers = decorateExamsWithAiOutliers;

  // Exposed so assets/insights-update.js can re-render the insight cards in place
  // after a rebuild job succeeds — no full page reload. Safe/idempotent: it
  // removes any prior [data-ai-insights] block before re-inserting.
  window.jcRefreshAiInsights = function (sec) {
    try {
      decorateWithAiInsights(sec || currentSection());
      if ((sec || currentSection()) === 'physical-exams') decorateExamsWithAiOutliers();
    } catch (e) { /* keep existing cards */ }
  };

  function dashboardCardHtml(dashSection, record, opts) {
    opts = opts || {};
    var isHome = !!opts.isHome;
    var titleHtml = isHome
      ? t('AI-authored summary', 'Resumo escrito pela IA')
      : (SECTION_LABEL[dashSection] || escapeHtml(dashSection)) + ' · ' + t('AI-authored', 'escrito pela IA');
    var cards = (record && Array.isArray(record.cards)) ? record.cards : [];
    var hasCards = cards.length > 0;
    // Build affordances ("Refresh" / "Build cards" / "Build all sections")
    // and the empty-state "click Build cards to…" prompt are removed for
    // now while the ingestion is being reworked. The cards themselves
    // still render when they exist in patient_dashboards.
    if (!hasCards) return ''; // nothing to show
    var nCards = cards.length;
    var cardsCountHtml = nCards + ' ' + t(nCards === 1 ? 'card' : 'cards', nCards === 1 ? 'cartão' : 'cartões');
    var meta = (record && record.generated_at)
      ? '<div class="ov-dashboard-meta">' +
          t('Generated', 'Gerado') + ' ' + relativeWhen(record.generated_at) +
          (record.model ? ' · <code>' + escapeHtml(record.model) + '</code>' : '') +
          ' · ' + cardsCountHtml +
        '</div>'
      : '';
    var cardsHtml = cards.map(function (c) {
      var fn = CARD_RENDERERS[c.kind];
      return fn ? fn(c) : '';
    }).join('');
    return (
      '<div class="ov-cards" data-dash-section="' + escapeHtml(dashSection) + '">' +
        '<header class="ov-cards-head">' +
          '<div class="ov-cards-head-left">' +
            '<h2>' + titleHtml + ' <span class="ai-pill">AI</span></h2>' + meta +
          '</div>' +
        '</header>' +
        '<div class="ov-cards-stack">' + cardsHtml + '</div>' +
      '</div>'
    );
  }

  function findInsertionTarget(opts) {
    if (opts && opts.isHome) {
      // jc-home: insert between hero and the report-section.
      var home = document.querySelector('main.jc-home');
      if (!home) return null;
      var reports = home.querySelector('.report-section');
      var wrapper = document.createElement('div');
      wrapper.className = 'jc-home-dash-wrap';
      wrapper.innerHTML = '<div class="container"></div>';
      if (reports) home.insertBefore(wrapper, reports);
      else home.appendChild(wrapper);
      return wrapper.querySelector('.container');
    }
    // ov-shell: insert just after .ov-header
    var shell = document.querySelector('.jc-overview .ov-shell');
    if (!shell) return null;
    return shell;
  }

  function decorateWithDashboard(pageSection, opts) {
    var dashSection = PAGE_TO_DASHBOARD[pageSection];
    if (!dashSection) return;
    fetch('/api/patient-dashboard?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { sections: {} }; })
      .catch(function () { return { sections: {} }; })
      .then(function (data) {
        var record = (data && data.sections && data.sections[dashSection]) || null;
        injectDashboardCard(dashSection, record, opts);
      });
  }

  function injectDashboardCard(dashSection, record, opts) {
    var html = dashboardCardHtml(dashSection, record, opts);
    if (!html) return; // empty when there are no AI cards yet — skip the wrapper
    var target = findInsertionTarget(opts);
    if (!target) return;
    // Remove any prior dashboard card for this section (defensive)
    var prior = target.querySelector('[data-dash-section="' + dashSection + '"]');
    if (prior) prior.remove();
    if (opts && opts.isHome) {
      target.insertAdjacentHTML('beforeend', html);
    } else {
      var header = target.querySelector('.ov-header');
      if (header) header.insertAdjacentHTML('afterend', html);
      else target.insertAdjacentHTML('afterbegin', html);
    }
  }

  function wireDashboardButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.dash-build-btn'), function (btn) {
      if (btn.dataset.wired === '1') return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        buildSections([btn.getAttribute('data-section')]);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dash-build-all-btn'), function (btn) {
      if (btn.dataset.wired === '1') return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        buildSections(btn.getAttribute('data-sections').split(','));
      });
    });
  }

  /* ── Donut overlay ─────────────────────────────────────────────── */
  var donutEl = null;
  function ensureDonut() {
    if (donutEl) return donutEl;
    donutEl = document.createElement('div');
    donutEl.className = 'jc-donut-backdrop';
    donutEl.innerHTML =
      '<div class="jc-donut-card">' +
        '<svg class="jc-donut" viewBox="0 0 100 100" aria-hidden="true">' +
          '<circle cx="50" cy="50" r="42" fill="none" stroke="#E5E2DC" stroke-width="8"/>' +
          '<circle class="jc-donut-fg" cx="50" cy="50" r="42" fill="none" stroke="#B8954A" stroke-width="8"' +
            ' stroke-dasharray="263.9" stroke-dashoffset="263.9"' +
            ' stroke-linecap="round" transform="rotate(-90 50 50)"/>' +
        '</svg>' +
        '<div class="jc-donut-text">' +
          '<div class="jc-donut-pct">0 / 0</div>' +
          '<div class="jc-donut-label">' + tPlain('Building…', 'Gerando…') + '</div>' +
          '<ul class="jc-donut-trail"></ul>' +
        '</div>' +
      '</div>';
    document.body.appendChild(donutEl);
    return donutEl;
  }
  function setDonut(done, total, label) {
    var el = ensureDonut();
    el.classList.add('open');
    el.querySelector('.jc-donut-pct').textContent = done + ' / ' + total;
    el.querySelector('.jc-donut-label').textContent = label || tPlain('Building…', 'Gerando…');
    var pct = total > 0 ? done / total : 0;
    var dashLen = 263.9;
    el.querySelector('.jc-donut-fg').setAttribute('stroke-dashoffset', String(dashLen * (1 - pct)));
  }
  function sectionLabelPlain(section) {
    var map = tPlain('en', 'pt') === 'pt' ? SECTION_LABEL_PLAIN_PT : SECTION_LABEL_PLAIN_EN;
    return map[section] || section;
  }
  function pushDonutTrail(section, status, ms) {
    var trail = (donutEl && donutEl.querySelector('.jc-donut-trail'));
    if (!trail) return;
    var li = document.createElement('li');
    li.className = 'jc-donut-trail-item ' + status;
    li.textContent = (status === 'ok' ? '✓ ' : '✗ ') + sectionLabelPlain(section) +
                     (typeof ms === 'number' ? ' · ' + (ms/1000).toFixed(1) + 's' : '');
    trail.appendChild(li);
  }
  function closeDonut() { if (donutEl) donutEl.classList.remove('open'); }

  async function buildSections(sections) {
    sections = (sections || []).filter(function (s) { return DASHBOARD_SECTIONS.indexOf(s) !== -1; });
    if (sections.length === 0) return;
    var total = sections.length;
    setDonut(0, total, tPlain('Starting…', 'Iniciando…'));
    var viewerClerk = viewerClerkHeader();
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      setDonut(i, total, tPlain('Building ', 'Gerando ') + sectionLabelPlain(section) + '…');
      var startedAt = Date.now();
      try {
        var resp = await fetch('/api/patient-dashboard-build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerk },
          body: JSON.stringify({ patient_clerk: patient, section: section }),
        });
        var bodyText = await resp.text();
        var data; try { data = JSON.parse(bodyText); } catch (e) { data = null; }
        if (!resp.ok || !data || data.error) {
          pushDonutTrail(section, 'err', Date.now() - startedAt);
          // If rate-limited, wait ~30s before continuing.
          if (resp.status === 429 || /rate_limit/i.test(bodyText)) {
            setDonut(i, total, tPlain('Rate-limited, waiting 30s…', 'Limite de taxa, aguardando 30s…'));
            await new Promise(function (r) { setTimeout(r, 30000); });
            i--; continue; // retry this section
          }
        } else {
          pushDonutTrail(section, 'ok', Date.now() - startedAt);
        }
      } catch (e) {
        pushDonutTrail(section, 'err', Date.now() - startedAt);
      }
    }
    setDonut(total, total, tPlain('Done. Reloading…', 'Pronto. Recarregando…'));
    setTimeout(function () { location.reload(); }, 700);
  }

  /* ── Paulo Silotto · bespoke physical-exams page ────────────────────
     Two manually-curated DICOM exports (cervical + lumbar MRI, 15 May
     2026, Dr. Marco Antonio de Carvalho, CETAM Diagnóstico). The page
     is rendered structurally to mirror Patient Zero's static
     physical-exams.html: a hero header, then per-exam `.imagery-exam`
     blocks with a `.ct-viewer`, AXI/COR/SAG view toggle, slider, and a
     full radiologist's report — Portuguese original with English
     translation, swapped by the top-bar language buttons. */

  /* ── Full Paulo physical-exams page ─────────────────────────────────
     Bypasses /api/patient-exams and renders a structured page that
     reuses Patient Zero's CSS classes (.report-section, .imagery-exam,
     .section-label, .section-title, .section-desc, .ct-grid,
     .ct-viewer, .ct-stage, .ct-img, .ct-slider, .list-card, .alert,
     .export-btn-primary, .report-export-row). Marked .jc-paulo-exams
     so hidePageBody keeps it visible while the static-page content
     gets dimmed. */

  var PAULO_STUDIES = [
    {
      slug: 'paulo-cervical-mri-2026-05-15',
      labelEn: '2A · MRI · Cervical spine',
      labelPt: '2A · RM · Coluna cervical',
      titleEn: 'MRI cervical spine · 15 May 2026',
      titlePt: 'RM da coluna cervical · 15 de maio de 2026',
      blurbEn: 'MRI of the cervical spine without intravenous contrast. Three orientations were acquired — axial T2 (35 slices), coronal T2 (12) and sagittal (45, across T1 / T2 / STIR weightings, grouped in that order on the slider). Use the AXI / COR / SAG buttons inside the viewer to switch plane, then scrub the slider to walk through the slices.',
      blurbPt: 'Ressonância da coluna cervical sem contraste endovenoso. Três orientações adquiridas — axial T2 (35 cortes), coronal T2 (12) e sagital (45, com sequências T1 / T2 / STIR, agrupadas nessa ordem ao longo do slider). Use os botões AXI / COR / SAG no visualizador para alternar o plano e depois deslize o controle para percorrer os cortes.',
      pdfHref: 'scans/paulo-cervical-mri-2026-05-15-report.pdf',
      pdfLabelEn: 'Export cervical MRI report (PDF)',
      pdfLabelPt: 'Exportar laudo da RM cervical (PDF)',
      identsEn: [
        '<strong>Patient.</strong> Paulo Augusto Silotto Dias de Souza',
        '<strong>DOB.</strong> 14 July 1961',
        '<strong>Exam date.</strong> 15 May 2026',
        '<strong>Exam.</strong> MRI cervical spine',
        '<strong>Accession.</strong> 5463652',
        '<strong>Reporting physician.</strong> Dr. Marco Antonio de Carvalho · CRM-99607',
        '<strong>Provider.</strong> CETAM Diagnóstico',
        '<strong>Insurance.</strong> Bradesco Saúde',
      ],
      identsPt: [
        '<strong>Paciente.</strong> Paulo Augusto Silotto Dias de Souza',
        '<strong>Data de nascimento.</strong> 14 de julho de 1961',
        '<strong>Data do exame.</strong> 15 de maio de 2026',
        '<strong>Exame.</strong> RM da coluna cervical',
        '<strong>Identificador.</strong> 5463652',
        '<strong>Médico responsável.</strong> Dr. Marco Antonio de Carvalho · CRM-99607',
        '<strong>Prestador.</strong> CETAM Diagnóstico',
        '<strong>Convênio.</strong> Bradesco Saúde',
      ],
      techniqueEn: [
        'Multi-planar acquisition in T1, T2 and STIR weighted sequences.',
        'No paramagnetic intravenous contrast administered.',
      ],
      techniquePt: [
        'Aquisição multiplanar em sequências ponderadas em T1, T2 e STIR.',
        'Sem administração de contraste endovenoso paramagnético.',
      ],
      findingsEn: [
        'Cranio-vertebral junction structures without abnormalities.',
        'Sinistroconvex deviation of the axis in the position of study.',
        'Vertebral bodies aligned, with normal height and marginal osteophytes.',
        'Posterior elements intact. Arthrosis of the uncovertebral and facet joints, more evident at the lower cervical levels, with diffuse thickening of the ligamentum flavum.',
        'Signs of diffuse disc dehydration predominating at <strong>C6–C7</strong>, where reduced disc height is observed.',
        'Mild disc bulging at <strong>C3–C4 and C4–C5</strong> that flattens the ventral aspect of the dural sac and mildly reduces the bilateral foraminal dimensions.',
        'Diffuse disco-osteophytic bulging at <strong>C5–C6</strong> that compresses the ventral aspect of the spinal cord, without myelopathy, and reduces the bilateral foraminal dimensions, contacting the respective exiting nerve roots.',
        'Spinal cord with normal morphology and signal intensity.',
        'Mild hypotrophy of the paravertebral musculature, predominating in the lumbosacral region.',
      ],
      findingsPt: [
        'Estruturas da junção crânio-vertebral sem anormalidades.',
        'Desvio sinistro-convexo do eixo na posição do estudo.',
        'Corpos vertebrais alinhados, com altura normal e osteófitos marginais.',
        'Elementos posteriores íntegros. Artrose das uncovertebrais e interapofisárias, mais evidente nos níveis cervicais inferiores, com espessamento difuso do ligamento amarelo.',
        'Sinais de hipohidratação discal difusa predominando em <strong>C6–C7</strong>, onde se observa redução da altura discal.',
        'Abaulamento discal discreto de <strong>C3–C4 e C4–C5</strong> que retifica a face ventral do saco dural e reduz discretamente as amplitudes foraminais bilaterais.',
        'Abaulamento disco-osteofitário difuso de <strong>C5–C6</strong> que comprime a face ventral da medula, sem mielopatia, e reduz as amplitudes foraminais bilaterais tocando as respectivas emergentes.',
        'Medula de morfologia e intensidade de sinal normais.',
        'Discreta hipotrofia da musculatura paravertebral predominando na região lombossacra.',
      ],
      conclusionEn: '<strong>Impression:</strong> Multilevel cervical degenerative change. Mild C3–C4 and C4–C5 disc bulging with shallow bilateral foraminal narrowing. <strong>Diffuse C5–C6 disco-osteophytic bulging with ventral cord compression — no myelopathy</strong> — and bilateral foraminal narrowing contacting both exiting roots. Sinistroconvex deviation of the cervical axis and mild paravertebral muscle hypotrophy.',
      conclusionPt: '<strong>Conclusão:</strong> Alterações degenerativas cervicais multinivelares. Abaulamento discal discreto em C3–C4 e C4–C5 com redução foraminal bilateral. <strong>Abaulamento disco-osteofitário difuso em C5–C6 com compressão ventral da medula — sem mielopatia</strong> — e redução foraminal bilateral tocando ambas as emergentes. Desvio sinistro-convexo do eixo cervical e hipotrofia discreta da musculatura paravertebral.',
    },
    {
      slug: 'paulo-lombar-mri-2026-05-15',
      labelEn: '2B · MRI · Lumbar spine',
      labelPt: '2B · RM · Coluna lombar',
      titleEn: 'MRI lumbar spine · 15 May 2026',
      titlePt: 'RM da coluna lombar · 15 de maio de 2026',
      blurbEn: 'MRI of the lumbar spine without intravenous contrast. Three orientations were acquired — axial T2 (25 slices), coronal T2 (12) and sagittal (48, across STIR / T2 CLEAR / T1 weightings, grouped in that order on the slider). Use the AXI / COR / SAG buttons inside the viewer to switch plane, then scrub the slider to walk through the slices.',
      blurbPt: 'Ressonância da coluna lombar sem contraste endovenoso. Três orientações adquiridas — axial T2 (25 cortes), coronal T2 (12) e sagital (48, com sequências STIR / T2 CLEAR / T1, agrupadas nessa ordem ao longo do slider). Use os botões AXI / COR / SAG no visualizador para alternar o plano e depois deslize o controle para percorrer os cortes.',
      pdfHref: 'scans/paulo-lombar-mri-2026-05-15-report.pdf',
      pdfLabelEn: 'Export lumbar MRI report (PDF)',
      pdfLabelPt: 'Exportar laudo da RM lombar (PDF)',
      identsEn: [
        '<strong>Patient.</strong> Paulo Augusto Silotto Dias de Souza',
        '<strong>DOB.</strong> 14 July 1961',
        '<strong>Exam date.</strong> 15 May 2026',
        '<strong>Exam.</strong> MRI lumbar spine',
        '<strong>Accession.</strong> 5463652',
        '<strong>Reporting physician.</strong> Dr. Marco Antonio de Carvalho · CRM-99607',
        '<strong>Provider.</strong> CETAM Diagnóstico',
        '<strong>Insurance.</strong> Bradesco Saúde',
      ],
      identsPt: [
        '<strong>Paciente.</strong> Paulo Augusto Silotto Dias de Souza',
        '<strong>Data de nascimento.</strong> 14 de julho de 1961',
        '<strong>Data do exame.</strong> 15 de maio de 2026',
        '<strong>Exame.</strong> RM da coluna lombar',
        '<strong>Identificador.</strong> 5463652',
        '<strong>Médico responsável.</strong> Dr. Marco Antonio de Carvalho · CRM-99607',
        '<strong>Prestador.</strong> CETAM Diagnóstico',
        '<strong>Convênio.</strong> Bradesco Saúde',
      ],
      techniqueEn: [
        'Multi-planar acquisition in T1, T2 and STIR weighted sequences.',
        'No paramagnetic intravenous contrast administered.',
      ],
      techniquePt: [
        'Aquisição multiplanar em sequências ponderadas em T1, T2 e STIR.',
        'Sem administração de contraste endovenoso paramagnético.',
      ],
      findingsEn: [
        'Sinistroconvex deviation of the axis in the position of study. Flattening of the physiological lumbar curvature.',
        'Mild anterolisthesis of <strong>L3 over L4</strong>. Minimal retrolisthesis of <strong>L1 over L2</strong>.',
        'Vertebral bodies with normal height and marginal osteophytes.',
        'Diffuse disc dehydration and reduction in disc heights.',
        'Degenerative discopathy at <strong>L1–L2, L2–L3 and L4–L5</strong> with irregularity of the opposing endplates and <strong>Modic I (oedema)</strong> signal changes at the three levels, and <strong>Modic II (fatty)</strong> at L4–L5.',
        'Mild disc bulging at <strong>L1–L2</strong> that flattens the ventral aspect of the dural sac and reduces the bilateral foraminal dimensions, notably on the left.',
        'Diffuse disc bulging at <strong>L2–L3</strong> that compresses the ventral aspect of the dural sac, contacts the anterior descending roots, and reduces the bilateral foraminal dimensions with <strong>stenosis and compression of the exiting root on the left</strong>.',
        'Diffuse disc pseudo-bulging at <strong>L3–L4</strong> that compresses the ventral aspect of the dural sac and, combined with facet joint hypertrophy and ligamentum flavum thickening, produces <strong>spinal canal stenosis</strong> with compression of the anterior descending roots and bilateral reduction of foraminal dimensions, notably on the left, contacting the respective exiting root.',
        'Diffuse disco-osteophytic bulging at <strong>L4–L5</strong> with a protruding central disc component that compresses the ventral aspect of the dural sac, contacting the bilateral anterior descending roots, and reduces the foraminal dimensions, contacting the right exiting root.',
        '<strong>Left paramedian / foraminal disc extrusion at L5–S1</strong> which, combined with ipsilateral facet hypertrophy, compresses the ipsilateral S1 descending root.',
        'Conus medullaris and cauda equina in normal topographic position, with normal morphology and signal intensity.',
        'Moderate hypotrophy of the paravertebral musculature.',
        'Oedema of the interspinous ligament at <strong>L2–L3, L3–L4 and L5–S1</strong>.',
      ],
      findingsPt: [
        'Desvio sinistro-convexo do eixo na posição do estudo. Retificação da curvatura lombar fisiológica.',
        'Anterolistese discreta de <strong>L3 sob L4</strong>. Mínima retrolistese de <strong>L1 sobre L2</strong>.',
        'Corpos vertebrais com altura normal e osteófitos marginais.',
        'Hipohidratação e redução difusa das alturas discais.',
        'Discopatia degenerativa de <strong>L1–L2, L2–L3 e L4–L5</strong> com irregularidade dos platôs apostos e alteração de sinal do tipo <strong>Modic I (edema)</strong> nos três níveis e <strong>Modic II (gordura)</strong> em L4–L5.',
        'Abaulamento discal discreto de <strong>L1–L2</strong> que retifica a face ventral do saco dural e reduz as amplitudes foraminais bilaterais, notadamente à esquerda.',
        'Abaulamento discal difuso de <strong>L2–L3</strong> que comprime a face ventral do saco dural, toca as descendentes anteriores e reduz as amplitudes foraminais bilaterais com <strong>estenose e compressão da emergente à esquerda</strong>.',
        'Pseudo-abaulamento discal difuso de <strong>L3–L4</strong> que comprime a face ventral do saco dural e, associado à hipertrofia das interfacetárias e espessamento dos ligamentos amarelos, determina <strong>estenose do canal vertebral</strong>, com compressão das descendentes anteriores e redução das amplitudes foraminais bilaterais, notadamente à esquerda, tocando a respectiva emergente.',
        'Abaulamento disco-osteofitário difuso de <strong>L4–L5</strong> com componente discal protruso central, que comprime a face ventral do saco dural, toca as descendentes anteriores bilaterais e reduz as amplitudes foraminais tocando a emergente direita.',
        '<strong>Extrusão discal paramediana / foraminal esquerda em L5–S1</strong> que, associada à hipertrofia da facetária ipsilateral, comprime a respectiva descendente ipsilateral de S1.',
        'Cone medular e cauda equina tópicos, de morfologia e intensidade de sinal normais.',
        'Moderada hipotrofia da musculatura paravertebral.',
        'Edema do ligamento interespinhoso de <strong>L2–L3, L3–L4 e L5–S1</strong>.',
      ],
      conclusionEn: '<strong>Impression:</strong> Diffuse multisegmental degenerative spondylodiscopathy. Spinal canal stenosis at L3–L4 with anterior descending root compression; <strong>foraminal disc extrusion at L5–S1 compressing the left S1 root</strong>; bilateral foraminal narrowing throughout the lumbar segments, more severe on the left. Sinistroconvex deviation of the axis, mild L3 anterolisthesis over L4, moderate paravertebral muscle hypotrophy, and interspinous ligament oedema at L2–L3, L3–L4 and L5–S1.',
      conclusionPt: '<strong>Conclusão:</strong> Espondilodiscopatia degenerativa difusa e multissegmentar. Estenose do canal vertebral em L3–L4 com compressão das descendentes anteriores; <strong>extrusão discal foraminal em L5–S1 comprimindo a raiz S1 esquerda</strong>; estreitamento foraminal bilateral em todo o segmento lombar, mais acentuado à esquerda. Desvio sinistro-convexo do eixo, anterolistese discreta de L3 sobre L4, hipotrofia moderada da musculatura paravertebral e edema do ligamento interespinhoso em L2–L3, L3–L4 e L5–S1.',
    },
  ];

  function injectPauloExamsStyles() {
    if (document.getElementById('paulo-exams-styles')) return;
    var s = document.createElement('style');
    s.id = 'paulo-exams-styles';
    s.textContent = [
      'main.jc-paulo-exams { background: var(--surface-base, #F9F7F4); padding: 0 0 96px; }',
      'main.jc-paulo-exams .hero { background: #0D1B2A; color: #FFFFFF; padding: 48px 0 56px; }',
      'main.jc-paulo-exams .hero .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-paulo-exams .hero-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 10px; }',
      'main.jc-paulo-exams .hero-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; line-height: 1.15; color: #FFFFFF; margin: 0 0 12px; }',
      'main.jc-paulo-exams .hero-sub { color: rgba(255,255,255,0.78); font-size: 15px; line-height: 1.6; margin: 0 0 18px; max-width: 70ch; }',
      'main.jc-paulo-exams .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px; margin-top: 8px; }',
      'main.jc-paulo-exams .hero-meta-item { display: flex; flex-direction: column; gap: 2px; font-family: "IBM Plex Mono", monospace; font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0.06em; text-transform: uppercase; }',
      'main.jc-paulo-exams .hero-meta-item > span:last-child { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 400; color: #FFFFFF; text-transform: none; letter-spacing: 0; }',
      'main.jc-paulo-exams #imagery { padding: 48px 0 24px; }',
      'main.jc-paulo-exams #imagery > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-paulo-exams #imagery .imagery-exam > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      // View-tab strip inside the .ct-viewer head
      'main.jc-paulo-exams .ct-viewer-head { flex-wrap: wrap; gap: 10px; }',
      'main.jc-paulo-exams .pl-view-tabs { display: inline-flex; gap: 4px; background: rgba(13, 27, 42, 0.06); border: 1px solid var(--border-subtle, #E5E2DC); border-radius: 6px; padding: 3px; }',
      'main.jc-paulo-exams .pl-view-tab { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #1E2D3D; background: transparent; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; transition: background 0.12s, color 0.12s; }',
      'main.jc-paulo-exams .pl-view-tab:hover { background: rgba(13, 27, 42, 0.06); }',
      'main.jc-paulo-exams .pl-view-tab[aria-pressed="true"] { background: #244E6E; color: #FFFFFF; }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tabs { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tab { color: rgba(255,255,255,0.85); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tab:hover { background: rgba(255,255,255,0.08); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tab[aria-pressed="true"] { background: #FFFFFF; color: #0D1B2A; }',
      // Unified-viewer toggle bar (region + plane)
      'main.jc-paulo-exams .pl-toggle-bar { display: flex; flex-wrap: wrap; gap: 18px; padding: 10px 14px; background: var(--blue-50, #EBF2F8); border-bottom: 1px solid var(--border-subtle, #E5E2DC); }',
      'main.jc-paulo-exams .pl-tab-group { display: flex; align-items: center; gap: 8px; }',
      'main.jc-paulo-exams .pl-tab-group-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--blue-700, #244E6E); font-weight: 500; }',
      'main.jc-paulo-exams .pl-tabs { display: inline-flex; gap: 2px; background: #FFFFFF; border: 1px solid var(--border-subtle, #E5E2DC); border-radius: 6px; padding: 2px; }',
      'main.jc-paulo-exams .pl-tab { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #1E2D3D; background: transparent; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; transition: background 0.12s, color 0.12s; }',
      'main.jc-paulo-exams .pl-tab:hover { background: rgba(13, 27, 42, 0.06); }',
      'main.jc-paulo-exams .pl-tab[aria-pressed="true"] { background: #244E6E; color: #FFFFFF; }',
      'main.jc-paulo-exams .pl-sequence-tag { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; padding: 2px 8px; background: rgba(13, 27, 42, 0.08); border-radius: 999px; color: #244E6E; margin-right: 10px; vertical-align: 1px; }',
      'main.jc-paulo-exams .pl-sequence-tag:empty { display: none; }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-toggle-bar { background: rgba(0,0,0,0.55); border-bottom-color: rgba(255,255,255,0.12); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab-group-label { color: rgba(255,255,255,0.78); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tabs { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab { color: rgba(255,255,255,0.85); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab:hover { background: rgba(255,255,255,0.08); }',
      'main.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab[aria-pressed="true"] { background: #FFFFFF; color: #0D1B2A; }',

      // Side-by-side reports
      'main.jc-paulo-exams .paulo-reports-heading { font-family: "Raleway", sans-serif; font-size: 20px; font-weight: 700; color: var(--blue-800, #0D1B2A); margin: 2.5rem 0 0.75rem; }',
      'main.jc-paulo-exams .paulo-reports-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }',
      '@media (max-width: 960px) { main.jc-paulo-exams .paulo-reports-grid { grid-template-columns: 1fr; } }',
      'main.jc-paulo-exams .paulo-report-col { display: flex; flex-direction: column; gap: 12px; }',
      'main.jc-paulo-exams .paulo-report-col-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 0 0 6px; border-bottom: 1px solid var(--border-subtle, #E5E2DC); }',
      'main.jc-paulo-exams .paulo-report-col-title { font-family: "Raleway", sans-serif; font-size: 15px; font-weight: 700; color: var(--blue-800, #0D1B2A); margin: 0; }',
      'main.jc-paulo-exams .paulo-report-col-pdf { display: inline-flex; align-items: center; gap: 4px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; border: 1px solid #B8954A; padding: 3px 8px; border-radius: 6px; }',
      'main.jc-paulo-exams .paulo-report-col-pdf:hover { background: #FFF6E5; }',
      // Override the global .ct-grid-single cap (620px) so the viewer fills the page.
      'main.jc-paulo-exams .ct-grid.ct-grid-single { max-width: none; margin-left: 0; margin-right: 0; }',
      'main.jc-paulo-exams .ct-stage { aspect-ratio: 16 / 9; max-height: 720px; }',
      // AI summary card slot above the exam blocks
      'main.jc-paulo-exams .paulo-ai-summary-wrap { padding: 0 0 8px; }',
      'main.jc-paulo-exams .paulo-ai-summary-wrap .container { max-width: 1080px; margin: 0 auto; padding: 24px 24px 0; }',
      'main.jc-paulo-exams .paulo-ai-summary { background: #FFFFFF; border: 1px solid #E5E2DC; border-top: 3px solid #B8954A; border-radius: 10px; padding: 22px 26px; }',
      'main.jc-paulo-exams .paulo-ai-summary-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }',
      'main.jc-paulo-exams .paulo-ai-summary-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0; }',
      'main.jc-paulo-exams .paulo-ai-summary-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-bottom: 14px; }',
      // Sub-heading row inside the synthesis card ("Current snapshot", "Longitudinal evolution")
      'main.jc-paulo-exams .paulo-ai-subhead { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 600; margin: 8px 0 10px; }',
      // Evolution-arc block (cervical + lumbar arc cards inside the AI synthesis card)
      'main.jc-paulo-exams .paulo-ai-arcs-block { margin-top: 18px; padding-top: 18px; border-top: 1px solid #E5E2DC; }',
      'main.jc-paulo-exams .paulo-ai-arcs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }',
      '@media (max-width: 820px) { main.jc-paulo-exams .paulo-ai-arcs { grid-template-columns: 1fr; } }',
      'main.jc-paulo-exams .paulo-ai-arc { background: #F9F7F4; border: 1px solid #E5E2DC; border-left: 3px solid #B8954A; border-radius: 8px; padding: 14px 16px; }',
      'main.jc-paulo-exams .paulo-ai-arc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #E5E2DC; }',
      'main.jc-paulo-exams .paulo-ai-arc-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 14px; color: #0D1B2A; margin: 0; }',
      'main.jc-paulo-exams .paulo-ai-arc-span { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; }',
      'main.jc-paulo-exams .paulo-ai-arc-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.65; color: #1E2D3D; margin: 0; }',
      'main.jc-paulo-exams .paulo-ai-arc-body strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .paulo-ai-arcs-cross { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.65; color: #1E2D3D; margin: 14px 0 0; padding-top: 12px; border-top: 1px dashed #E5E2DC; }',
      'main.jc-paulo-exams .paulo-ai-arcs-cross strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .paulo-ai-summary-body { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; line-height: 1.65; color: #1E2D3D; }',
      'main.jc-paulo-exams .paulo-ai-summary-body p { margin: 0 0 10px; }',
      'main.jc-paulo-exams .paulo-ai-summary-body p:last-child { margin-bottom: 0; }',
      'main.jc-paulo-exams .paulo-ai-summary-body strong { color: #0D1B2A; }',
      // Three holistic insights — Physical / Mental / Spiritual
      'main.jc-paulo-exams .paulo-ai-insights-block { margin-top: 18px; padding-top: 18px; border-top: 1px solid #E5E2DC; }',
      'main.jc-paulo-exams .paulo-ai-insights-head { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 12px; }',
      'main.jc-paulo-exams .paulo-ai-insights { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }',
      'main.jc-paulo-exams .paulo-ai-insight { background: #F9F7F4; border: 1px solid #E5E2DC; border-radius: 8px; padding: 14px 16px; }',
      'main.jc-paulo-exams .paulo-ai-insight-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; margin-bottom: 8px; }',
      'main.jc-paulo-exams .paulo-ai-insight-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      'main.jc-paulo-exams .paulo-ai-insight-body strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .paulo-ai-insight.is-tbd { background: #FFFFFF; border-style: dashed; }',
      'main.jc-paulo-exams .paulo-ai-insight.is-tbd .paulo-ai-insight-label { color: #7A8FA6; }',
      'main.jc-paulo-exams .paulo-ai-insight.is-tbd .paulo-ai-insight-body { color: #7A8FA6; font-style: italic; }',
      '@media (max-width: 820px) { main.jc-paulo-exams .paulo-ai-insights { grid-template-columns: 1fr; } }',

      // ── History section (cervical + lumbar timelines) ─────────────
      'main.jc-paulo-exams #paulo-history { padding: 16px 0 40px; }',
      'main.jc-paulo-exams #paulo-history > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-paulo-exams .ph-timeline-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 18px; }',
      '@media (max-width: 960px) { main.jc-paulo-exams .ph-timeline-grid { grid-template-columns: 1fr; } }',
      'main.jc-paulo-exams .ph-timeline { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 22px 24px; }',
      'main.jc-paulo-exams .ph-timeline-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid #E5E2DC; }',
      'main.jc-paulo-exams .ph-timeline-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 18px; color: #0D1B2A; margin: 0; }',
      'main.jc-paulo-exams .ph-timeline-span { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; color: #7A8FA6; }',
      'main.jc-paulo-exams .ph-entry { position: relative; padding: 0 0 20px 22px; border-left: 1px solid #E5E2DC; }',
      'main.jc-paulo-exams .ph-entry:last-child { padding-bottom: 0; }',
      'main.jc-paulo-exams .ph-entry::before { content: ""; position: absolute; left: -5px; top: 5px; width: 9px; height: 9px; background: #B8954A; border-radius: 50%; border: 2px solid #FFFFFF; box-shadow: 0 0 0 1px #B8954A; }',
      'main.jc-paulo-exams .ph-entry-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; font-weight: 600; }',
      'main.jc-paulo-exams .ph-entry-meta { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; color: #7A8FA6; margin: 2px 0 8px; }',
      'main.jc-paulo-exams .ph-entry-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0 0 10px; }',
      'main.jc-paulo-exams .ph-entry-body strong { color: #0D1B2A; }',
      // Per-entry AI evolution callout (between meta and body)
      'main.jc-paulo-exams .ph-evolution { background: #FFFBF1; border: 1px solid #EAD9A8; border-left: 3px solid #B8954A; border-radius: 8px; padding: 12px 14px; margin: 8px 0 12px; }',
      'main.jc-paulo-exams .ph-evolution-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
      'main.jc-paulo-exams .ph-evolution-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7C5B15; font-weight: 700; }',
      'main.jc-paulo-exams .ph-evolution-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      'main.jc-paulo-exams .ph-evolution-body strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .ph-evolution-body em { color: #7C5B15; font-style: italic; }',
      // Section title with inline AI pill
      'main.jc-paulo-exams .ph-section-title { display: inline-flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }',
      'main.jc-paulo-exams .ph-section-title .ai-pill { font-size: 10px; }',
      'main.jc-paulo-exams .ph-entry-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }',
      'main.jc-paulo-exams .ph-badge { display: inline-flex; align-items: center; gap: 4px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; }',
      'main.jc-paulo-exams .ph-badge-stable { background: #E8F2E8; color: #2E5A2E; }',
      'main.jc-paulo-exams .ph-badge-progress { background: #FFF1D6; color: #7C5B15; }',
      'main.jc-paulo-exams .ph-badge-flag { background: #F7E1E1; color: #7E2929; }',
      'main.jc-paulo-exams .ph-badge-baseline { background: rgba(13, 27, 42, 0.06); color: #244E6E; }',
      'main.jc-paulo-exams .ph-entry-pdf { display: inline-flex; align-items: center; gap: 4px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; border: 1px solid #B8954A; padding: 3px 9px; border-radius: 6px; margin-left: 6px; }',
      'main.jc-paulo-exams .ph-entry-pdf:hover { background: #FFF6E5; }',
      'main.jc-paulo-exams .ph-takeaway { margin-top: 16px; padding-top: 14px; border-top: 1px dashed #E5E2DC; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; }',
      'main.jc-paulo-exams .ph-takeaway strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .ph-takeaway::before { content: "11-year arc · "; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 700; }',
      'main.jc-paulo-exams .ph-takeaway.is-lumbar::before { content: "3-year arc · "; }',

      // ── Other studies section ─────────────────────────────────────
      'main.jc-paulo-exams #paulo-other-studies { padding: 16px 0 48px; }',
      'main.jc-paulo-exams #paulo-other-studies > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-paulo-exams .po-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 18px; }',
      '@media (max-width: 820px) { main.jc-paulo-exams .po-grid { grid-template-columns: 1fr; } }',
      'main.jc-paulo-exams .po-card { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }',
      'main.jc-paulo-exams .po-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }',
      'main.jc-paulo-exams .po-card-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 600; }',
      'main.jc-paulo-exams .po-card-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 17px; color: #0D1B2A; margin: 2px 0 0; line-height: 1.25; }',
      'main.jc-paulo-exams .po-card-meta { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; color: #7A8FA6; margin: 4px 0 0; }',
      'main.jc-paulo-exams .po-card-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.04em; color: #244E6E; font-weight: 600; white-space: nowrap; }',
      'main.jc-paulo-exams .po-findings { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0; padding-left: 18px; }',
      'main.jc-paulo-exams .po-findings li { margin-bottom: 6px; }',
      'main.jc-paulo-exams .po-findings li:last-child { margin-bottom: 0; }',
      'main.jc-paulo-exams .po-findings strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .po-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; padding-top: 12px; border-top: 1px dashed #E5E2DC; }',
      'main.jc-paulo-exams .po-pending { display: inline-flex; align-items: center; gap: 6px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; }',
      'main.jc-paulo-exams .po-pending::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #B8954A; }',
      'main.jc-paulo-exams .po-pdf { display: inline-flex; align-items: center; gap: 5px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; border: 1px solid #B8954A; padding: 4px 10px; border-radius: 6px; }',
      'main.jc-paulo-exams .po-pdf:hover { background: #FFF6E5; }',
      'main.jc-paulo-exams .po-ai { margin-top: 2px; padding: 12px 14px; background: #FFFCF5; border: 1px solid #F0E4C8; border-radius: 8px; }',
      'main.jc-paulo-exams .po-ai-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }',
      'main.jc-paulo-exams .po-ai-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 600; }',
      'main.jc-paulo-exams .po-ai-body { font-family: "IBM Plex Sans", sans-serif; font-size: 12.5px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      'main.jc-paulo-exams .po-ai-body strong { color: #0D1B2A; }',
      'main.jc-paulo-exams .po-ai-body em { font-style: italic; color: #244E6E; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function pauloLi(s) { return '<li>' + s + '</li>'; }

  /* ── Unified spine MRI section ───────────────────────────────────
     The CETAM portal exported both regions in the same six DICOM
     bundles (cervical + lumbar slices intermixed), so showing two
     separate viewer cards was misleading. This builder renders ONE
     viewer with two toggles (region + plane) and places both
     radiology reports side-by-side underneath. */

  function buildPauloReportColumn(study) {
    return (
      '<div class="paulo-report-col">' +
        '<div class="paulo-report-col-head">' +
          '<h4 class="paulo-report-col-title">' + t(study.titleEn, study.titlePt) + '</h4>' +
          '<a class="paulo-report-col-pdf" href="' + study.pdfHref + '" download>' +
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
              '<polyline points="7 10 12 15 17 10"/>' +
              '<line x1="12" y1="15" x2="12" y2="3"/>' +
            '</svg>' +
            t('PDF', 'PDF') +
          '</a>' +
        '</div>' +
        '<div class="list-card">' +
          '<h4>' + t('Identifiers', 'Identificadores') + '</h4>' +
          '<ul class="lang-en">' + study.identsEn.map(pauloLi).join('') + '</ul>' +
          '<ul class="lang-pt">' + study.identsPt.map(pauloLi).join('') + '</ul>' +
        '</div>' +
        '<div class="list-card">' +
          '<h4>' + t('Technique', 'Técnica') + '</h4>' +
          '<ul class="lang-en">' + study.techniqueEn.map(pauloLi).join('') + '</ul>' +
          '<ul class="lang-pt">' + study.techniquePt.map(pauloLi).join('') + '</ul>' +
        '</div>' +
        '<div class="list-card">' +
          '<h4>' + t('Findings', 'Achados') + '</h4>' +
          '<ul class="lang-en">' + study.findingsEn.map(pauloLi).join('') + '</ul>' +
          '<ul class="lang-pt">' + study.findingsPt.map(pauloLi).join('') + '</ul>' +
        '</div>' +
        '<div class="alert alert-warn">' +
          '<span class="lang-en">' + study.conclusionEn + '</span>' +
          '<span class="lang-pt">' + study.conclusionPt + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function buildPauloUnifiedSection(studies) {
    // Two PDF buttons at the top
    function pdfBtn(study) {
      return (
        '<a class="export-btn-primary" href="' + study.pdfHref + '" download>' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
            '<polyline points="7 10 12 15 17 10"/>' +
            '<line x1="12" y1="15" x2="12" y2="3"/>' +
          '</svg>' +
          t(study.pdfLabelEn, study.pdfLabelPt) +
        '</a>'
      );
    }

    return (
      '<div class="imagery-exam" id="paulo-spine-mri"><div class="container">' +
        '<div class="section-label">' + t('2 · MRI · Spine', '2 · RM · Coluna') + '</div>' +
        '<h2 class="section-title">' + t('Spine MRI · 15 May 2026', 'RM da coluna · 15 de maio de 2026') + '</h2>' +
        '<p class="section-desc">' +
          t('Same-day cervical and lumbar MRI at CETAM Diagnóstico, reported by Dr. Marco Antonio de Carvalho (CRM-99607). Pick the region (Cervical / Lumbar) and the plane (AXI / COR / SAG), then drag the slider, scroll the wheel, click-and-drag the image, or use the arrow keys to walk through the slices. The two reports follow side-by-side beneath the viewer.',
            'RM cervical e lombar do mesmo dia no CETAM Diagnóstico, laudadas pelo Dr. Marco Antonio de Carvalho (CRM-99607). Escolha a região (Cervical / Lombar) e o plano (AXI / COR / SAG), depois arraste o controle, role o mouse, clique-e-arraste a imagem ou use as setas para percorrer os cortes. Os dois laudos seguem lado a lado abaixo do visualizador.') +
        '</p>' +
        '<div class="report-export-row">' + studies.map(pdfBtn).join('') + '</div>' +

        '<div class="ct-grid ct-grid-single">' +
          '<div class="pl-ct-viewer ct-viewer" data-paulo-study="spine-combined">' +
            '<div class="ct-viewer-head">' +
              '<div class="ct-viewer-title">' + t('Spine MRI', 'RM da coluna') + '</div>' +
              '<div class="ct-viewer-meta">' +
                '<span class="pl-sequence-tag"></span>' +
                t('Slice ', 'Corte ') +
                '<span class="ct-idx">1</span> / <span class="ct-total">1</span>' +
              '</div>' +
            '</div>' +
            '<div class="pl-toggle-bar">' +
              '<div class="pl-tab-group">' +
                '<span class="pl-tab-group-label">' + t('Region', 'Região') + '</span>' +
                '<div class="pl-tabs" role="tablist">' +
                  '<button type="button" class="pl-tab pl-region-tab" data-region="cervical" aria-pressed="true">' +
                    t('Cervical', 'Cervical') +
                  '</button>' +
                  '<button type="button" class="pl-tab pl-region-tab" data-region="lombar" aria-pressed="false">' +
                    t('Lumbar', 'Lombar') +
                  '</button>' +
                '</div>' +
              '</div>' +
              '<div class="pl-tab-group">' +
                '<span class="pl-tab-group-label">' + t('Plane', 'Plano') + '</span>' +
                '<div class="pl-tabs" role="tablist">' +
                  '<button type="button" class="pl-tab pl-orient-tab" data-orient="axi" aria-pressed="true">AXI</button>' +
                  '<button type="button" class="pl-tab pl-orient-tab" data-orient="cor" aria-pressed="false">COR</button>' +
                  '<button type="button" class="pl-tab pl-orient-tab" data-orient="sag" aria-pressed="false">SAG</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="ct-stage">' +
              '<img class="ct-img" alt="Spine MRI" loading="eager">' +
            '</div>' +
            '<input class="ct-slider" type="range" min="0" max="0" value="0" aria-label="Spine MRI slice">' +
          '</div>' +
        '</div>' +

        '<h3 class="paulo-reports-heading">' +
          t('Radiologist&apos;s reports', 'Laudos do radiologista') +
        '</h3>' +
        '<div class="paulo-reports-grid">' +
          studies.map(buildPauloReportColumn).join('') +
        '</div>' +
      '</div></div>'
    );
  }

  /* ── Cervical & lumbar longitudinal history ─────────────────────
     Three cervical MRIs (2015, 2023, 2026) and two lumbar (2023, 2026)
     all from CETAM. Renders side-by-side timelines so the progression
     of disc-level findings is visible at a glance. */

  function buildPauloHistoryEntry(e) {
    var badgesHtml = (e.badges || []).map(function (b) {
      return '<span class="ph-badge ph-badge-' + b.kind + '">' + t(b.en, b.pt) + '</span>';
    }).join('');
    var pdfHtml = e.pdfHref
      ? '<a class="ph-entry-pdf" href="' + e.pdfHref + '" download>' + t('PDF', 'PDF') + '</a>'
      : '';
    var aiEvolutionHtml = '';
    if (e.aiEvolutionEn || e.aiEvolutionPt) {
      var aiLabelEn = e.isBaseline ? 'Baseline · AI read' : 'Δ vs. previous · AI';
      var aiLabelPt = e.isBaseline ? 'Linha de base · leitura da IA' : 'Δ vs. anterior · IA';
      aiEvolutionHtml =
        '<div class="ph-evolution">' +
          '<div class="ph-evolution-head">' +
            '<span class="ph-evolution-label">' + t(aiLabelEn, aiLabelPt) + '</span>' +
            '<span class="ai-pill">AI</span>' +
          '</div>' +
          '<p class="ph-evolution-body lang-en">' + (e.aiEvolutionEn || '') + '</p>' +
          '<p class="ph-evolution-body lang-pt">' + (e.aiEvolutionPt || '') + '</p>' +
        '</div>';
    }
    return (
      '<div class="ph-entry">' +
        '<div class="ph-entry-date">' + t(e.dateEn, e.datePt) + '</div>' +
        '<div class="ph-entry-meta">' + e.physician + ' · ' + e.provider + '</div>' +
        aiEvolutionHtml +
        '<p class="ph-entry-body lang-en">' + e.bodyEn + '</p>' +
        '<p class="ph-entry-body lang-pt">' + e.bodyPt + '</p>' +
        '<div class="ph-entry-badges">' + badgesHtml + pdfHtml + '</div>' +
      '</div>'
    );
  }

  function buildPauloHistorySection() {
    var cervical = [
      {
        dateEn: 'Nov 2015 · age 54',
        datePt: 'Nov 2015 · 54 anos',
        physician: 'Dr. André Luis Tucci Semeghini',
        provider: 'CETAM',
        isBaseline: true,
        aiEvolutionEn: 'Earliest cervical study on file — sets the starting point. Disease is <strong>focal at C6–C7</strong>: moderate posterocentral protrusion, mild bilateral foraminal narrowing (right-greater), no frank stenosis. Adjacent bulges at C4–C5, C5–C6 and C7–T1 are present but minor. <strong>No extrusions, no cord contact, no axis deviation yet</strong> — none of the secondary features that will appear over the next eleven years.',
        aiEvolutionPt: 'Primeiro estudo cervical do histórico — fixa o ponto de partida. Doença <strong>focal em C6–C7</strong>: protrusão moderada posterocentral, leve redução foraminal bilateral (maior à direita), sem estenose franca. Abaulamentos adjacentes em C4–C5, C5–C6 e C7–T1, mas menores. <strong>Sem extrusões, sem contato medular, sem desvio do eixo</strong> — nenhuma das características secundárias que aparecerão ao longo dos onze anos seguintes.',
        bodyEn: 'Earliest study on file. Incipient cervical spondylopathy with mild C6–C7 disc dehydration. Small posterior bulges at C4–C5, C5–C6 and C7–T1, plus a <strong>moderate posterocentral disc protrusion at C6–C7</strong> compressing the ventral dural sac. Mild bilateral foraminal narrowing at C6–C7 (right-greater) without frank stenosis. No extrusions.',
        bodyPt: 'Primeiro estudo no histórico. Espondilopatia cervical incipiente com leve desidratação discal em C6–C7. Pequenos abaulamentos posteriores em C4–C5, C5–C6 e C7–T1 e <strong>protrusão moderada posterocentral em C6–C7</strong> comprimindo a face ventral do saco dural. Leve redução foraminal bilateral em C6–C7 (maior à direita) sem estenose franca. Sem extrusões.',
        pdfHref: 'scans/paulo-cervical-mri-2015-11-23-report.pdf',
        badges: [
          { kind: 'baseline',  en: 'Baseline',         pt: 'Linha de base' },
          { kind: 'progress',  en: 'C6–C7 dominant',   pt: 'C6–C7 dominante' },
        ],
      },
      {
        dateEn: 'Apr 2023 · age 61',
        datePt: 'Abr 2023 · 61 anos',
        physician: 'Dra. Juliane Giselle Hortolam',
        provider: 'CETAM',
        aiEvolutionEn: '<strong>Δ vs. 2015 (8-year gap).</strong> C6–C7 stabilised — still hypohydrated, still reduced in height — but the <strong>dominance migrated upward</strong>: C5–C6 now carries the dominant median protrusion. Two genuinely new findings absent in 2015: <strong>sinistro-convex axis deviation</strong> (first appearance) and <strong>mild paravertebral muscle hypotrophy</strong> (first mention). Still no cord contact, still no extrusions.',
        aiEvolutionPt: '<strong>Δ vs. 2015 (intervalo de 8 anos).</strong> C6–C7 estabilizou — segue hipohidratado e com altura reduzida — mas a <strong>dominância migrou para cima</strong>: C5–C6 passa a apresentar o componente protruso mediano dominante. Dois achados genuinamente novos, ausentes em 2015: <strong>desvio sinistro-convexo do eixo</strong> (primeira aparição) e <strong>hipotrofia leve da musculatura paravertebral</strong> (primeira menção). Ainda sem contato medular, ainda sem extrusões.',
        bodyEn: '<strong>New sinistro-convex axis deviation</strong> appears for the first time. The C6–C7 picture stabilises (still hypohydrated, still reduced height) but the disease has <strong>spread upward</strong>: C5–C6 now carries the dominant median protrusion impressing the ventral sac. C4–C5 bulge flattens the dural sac. Mild paravertebral muscle hypotrophy noted — first mention.',
        bodyPt: '<strong>Surge pela primeira vez o desvio sinistro-convexo do eixo</strong>. O quadro de C6–C7 estabiliza (segue hipohidratado e com altura reduzida) mas a doença <strong>migrou para níveis superiores</strong>: C5–C6 passa a apresentar o componente protruso mediano dominante, com impressão sob a face ventral do saco dural. C4–C5 abaula e retifica o saco dural. Discreta hipotrofia da musculatura paravertebral — primeira menção.',
        pdfHref: 'scans/paulo-cervical-mri-2023-04-26-report.pdf',
        badges: [
          { kind: 'progress', en: 'Axis deviation new',  pt: 'Desvio do eixo novo' },
          { kind: 'progress', en: 'C5–C6 now dominant',  pt: 'C5–C6 agora dominante' },
        ],
      },
      {
        dateEn: 'May 2026 · age 64',
        datePt: 'Mai 2026 · 64 anos',
        physician: 'Dr. Marco Antonio de Carvalho',
        provider: 'CETAM',
        aiEvolutionEn: '<strong>Δ vs. 2023 (3-year gap).</strong> C5–C6 progressed from a focal median protrusion to a <strong>diffuse disco-osteophytic bulge</strong>, and for the first time <strong>contacts the ventral cord</strong> (cord signal remains normal — no myelopathy). Newly explicit on this report: uncovertebral and facet arthrosis with diffuse ligamentum-flavum thickening at the lower cervical levels. C3–C4 and C4–C5 now also bulge mildly with bilateral foraminal narrowing — the disease envelope keeps widening level by level.',
        aiEvolutionPt: '<strong>Δ vs. 2023 (intervalo de 3 anos).</strong> C5–C6 evoluiu de protrusão mediana focal para <strong>abaulamento disco-osteofitário difuso</strong> e, pela primeira vez, <strong>toca a face ventral da medula</strong> (sinal medular permanece normal — sem mielopatia). Novidades explicitadas neste laudo: artrose uncovertebral e facetária com espessamento difuso do ligamento amarelo nos níveis cervicais inferiores. C3–C4 e C4–C5 também passam a abaular discretamente com redução foraminal bilateral — o envoltório degenerativo segue se ampliando nível a nível.',
        bodyEn: 'Most recent study. The C5–C6 lesion has progressed to a <strong>diffuse disco-osteophytic bulge with ventral cord contact</strong> (no myelopathy) and bilateral foraminal narrowing reaching both exiting roots. Mild C3–C4 and C4–C5 bulging. Uncovertebral / facet arthrosis with ligamentum flavum thickening — explicitly mentioned for the first time. The disease envelope keeps widening level by level.',
        bodyPt: 'Estudo mais recente. A lesão de C5–C6 evoluiu para <strong>abaulamento disco-osteofitário difuso com contato medular ventral</strong> (sem mielopatia) e redução foraminal bilateral tocando ambas as raízes emergentes. Abaulamentos leves em C3–C4 e C4–C5. Artrose uncovertebral / facetária com espessamento do ligamento amarelo — citados pela primeira vez. O envoltório degenerativo segue se ampliando nível a nível.',
        pdfHref: 'scans/paulo-cervical-mri-2026-05-15-report.pdf',
        badges: [
          { kind: 'flag',     en: 'Cord contact',           pt: 'Contato medular' },
          { kind: 'progress', en: 'Multilevel progression', pt: 'Progressão multinível' },
        ],
      },
    ];

    var lumbar = [
      {
        dateEn: 'Apr 2023 · age 61',
        datePt: 'Abr 2023 · 61 anos',
        physician: 'Dra. Juliane Giselle Hortolam',
        provider: 'CETAM',
        isBaseline: true,
        aiEvolutionEn: 'First lumbar MRI on file — fixes the lumbar starting point. The <strong>single most acute lesion of either spine region at this date</strong>: L5–S1 left paramedian / foraminal protrusion combined with facet hypertrophy, compressing the descending left S1 root. Sinistro-convex axis deviation already present here (the cervical only catches up to this in the same year). Secondary findings: L3-over-L4 anterolisthesis, Modic II (fatty) at L4–L5, moderate paravertebral hypotrophy.',
        aiEvolutionPt: 'Primeira RM lombar do histórico — fixa o ponto de partida lombar. A <strong>lesão mais aguda das duas regiões da coluna nesta data</strong>: protrusão paramediana / foraminal esquerda em L5–S1 associada a hipertrofia facetária, comprimindo a raiz descendente esquerda de S1. O desvio sinistro-convexo do eixo já está aqui (a cervical só alcança no mesmo ano). Achados secundários: anterolistese de L3 sobre L4, Modic II (gordura) em L4–L5, hipotrofia paravertebral moderada.',
        bodyEn: 'First lumbar MRI on file. <strong>Discrete L3-over-L4 anterolisthesis</strong>, diffuse disc dehydration and height loss. L4–L5 discopathy with Modic II (fatty) endplate change. Bulges at L1–L2 (rectifies sac), L2–L3, L4–L5 and L3–L4 (touching emerging L3 roots). Most acute: <strong>L5–S1 left paramedian / foraminal protrusion</strong> combined with facet hypertrophy compressing the descending left S1 root. Moderate paravertebral muscle hypotrophy.',
        bodyPt: 'Primeira RM lombar do histórico. <strong>Anterolistese discreta de L3 sobre L4</strong>, hipohidratação discal difusa e redução das alturas. Discopatia degenerativa em L4–L5 com Modic II (gordura). Abaulamentos em L1–L2 (retifica o saco), L2–L3, L4–L5 e L3–L4 (tocando as raízes emergentes de L3). Achado mais agudo: <strong>protrusão paramediana / foraminal esquerda em L5–S1</strong> associada a hipertrofia facetária comprimindo a raiz descendente esquerda de S1. Moderada hipotrofia paravertebral.',
        pdfHref: 'scans/paulo-lombar-mri-2023-04-26-report.pdf',
        badges: [
          { kind: 'baseline', en: 'Baseline',                pt: 'Linha de base' },
          { kind: 'flag',     en: 'L5–S1 S1-root contact',   pt: 'L5–S1 contato raiz S1' },
        ],
      },
      {
        dateEn: 'May 2026 · age 64',
        datePt: 'Mai 2026 · 64 anos',
        physician: 'Dr. Marco Antonio de Carvalho',
        provider: 'CETAM',
        aiEvolutionEn: '<strong>Δ vs. 2023 (3-year gap).</strong> The L5–S1 extrusion is <strong>geometrically stable</strong> — same left-S1 compression pattern, same morphology. Two genuinely new findings absent in 2023: <strong>L3–L4 spinal-canal stenosis</strong> (pseudo-bulge + facet hypertrophy + ligamentum-flavum thickening compressing the anterior descending roots) emerges as a second focus, and <strong>Modic I (active oedema)</strong> signal appears at L1–L2, L2–L3 and L4–L5 plus interspinous-ligament oedema at three levels. Headline reading: the main lesion held its shape; the surrounding disc-bone interface turned <em>active</em>.',
        aiEvolutionPt: '<strong>Δ vs. 2023 (intervalo de 3 anos).</strong> A extrusão em L5–S1 está <strong>geometricamente estável</strong> — mesmo padrão de compressão da S1 à esquerda, mesma morfologia. Dois achados genuinamente novos, ausentes em 2023: <strong>estenose do canal em L3–L4</strong> (pseudo-abaulamento + hipertrofia facetária + espessamento do ligamento amarelo comprimindo as descendentes anteriores) surge como segundo foco e o sinal <strong>Modic I (edema ativo)</strong> aparece em L1–L2, L2–L3 e L4–L5, junto com edema do ligamento interespinhoso em três níveis. Leitura central: a lesão principal manteve a forma; a interface disco-óssea ao redor ficou <em>ativa</em>.',
        bodyEn: 'Three-year follow-up. The L5–S1 extrusion <strong>persists with the same left-sided S1 compression pattern</strong>. New / clarified: L3–L4 spinal canal stenosis from pseudo-bulge + facet hypertrophy + ligamentum flavum thickening, compressing the anterior descending roots. Modic II change at L4–L5 confirmed; <strong>Modic I (active oedema) signal added at L1–L2, L2–L3 and L4–L5</strong>; interspinous-ligament oedema at L2–L3, L3–L4 and L5–S1 — markers of active inflammatory degeneration, not burnt-out disease.',
        bodyPt: 'Seguimento de três anos. A extrusão em L5–S1 <strong>persiste com o mesmo padrão de compressão da raiz S1 à esquerda</strong>. Novo / esclarecido: estenose do canal em L3–L4 por pseudo-abaulamento + hipertrofia facetária + espessamento do ligamento amarelo, comprimindo as raízes descendentes anteriores. Modic II em L4–L5 confirmado; <strong>sinal Modic I (edema ativo) acrescentado em L1–L2, L2–L3 e L4–L5</strong>; edema do ligamento interespinhoso em L2–L3, L3–L4 e L5–S1 — marcadores de degeneração ativa, não de doença encerrada.',
        pdfHref: 'scans/paulo-lombar-mri-2026-05-15-report.pdf',
        badges: [
          { kind: 'flag',     en: 'L3–L4 canal stenosis',  pt: 'L3–L4 estenose do canal' },
          { kind: 'progress', en: 'Modic I — active',      pt: 'Modic I — ativo' },
        ],
      },
    ];

    return (
      '<section class="report-section" id="paulo-history">' +
        '<div class="container">' +
          '<div class="section-label">' +
            t('3 · AI longitudinal analysis', '3 · Análise longitudinal por IA') +
          '</div>' +
          '<h2 class="section-title ph-section-title">' +
            t('How cervical and lumbar findings evolved',
              'Como os achados cervicais e lombares evoluíram') +
            ' <span class="ai-pill">AI</span>' +
          '</h2>' +
          '<p class="section-desc">' +
            t('Three cervical MRIs (2015, 2023, 2026) and two lumbar (2023, 2026), all from CETAM Diagnóstico. Each entry carries an <strong>AI Δ-from-previous read</strong> at the top — what moved, what stabilised, what is genuinely new — followed by the underlying radiologist&apos;s synthesis. Read top-to-bottom to see the dominant lesion migrate and the disease envelope widen level by level.',
              'Três RMs cervicais (2015, 2023, 2026) e duas lombares (2023, 2026), todas do CETAM Diagnóstico. Cada entrada traz uma <strong>leitura Δ-vs.-anterior da IA</strong> no topo — o que mudou, o que estabilizou, o que é genuinamente novo — seguida da síntese do radiologista. Leia de cima para baixo para ver a lesão dominante migrar e o envoltório degenerativo se ampliar nível a nível.') +
          '</p>' +
          '<div class="ph-timeline-grid">' +
            '<div class="ph-timeline">' +
              '<div class="ph-timeline-head">' +
                '<h3 class="ph-timeline-title">' + t('3A · Cervical spine', '3A · Coluna cervical') + '</h3>' +
                '<span class="ph-timeline-span">' + t('2015 → 2026 · 3 studies', '2015 → 2026 · 3 estudos') + '</span>' +
              '</div>' +
              cervical.map(buildPauloHistoryEntry).join('') +
              '<div class="ph-takeaway">' +
                '<span class="lang-en">The dominant lesion <strong>migrated upward</strong> over eleven years — from C6–C7 (2015) to C5–C6 (2023, still dominant in 2026). What was a focal disc protrusion in 2015 became a <strong>diffuse disco-osteophytic bulge with ventral cord contact</strong> by 2026, with explicit involvement of the uncovertebral and facet joints. Cord signal remains normal — no myelopathy, but the cord is being touched.</span>' +
                '<span class="lang-pt">A lesão dominante <strong>migrou cranialmente</strong> ao longo de onze anos — de C6–C7 (2015) para C5–C6 (2023, ainda dominante em 2026). O que era protrusão discal focal em 2015 tornou-se <strong>abaulamento disco-osteofitário difuso com contato medular ventral</strong> em 2026, com envolvimento explícito das articulações uncovertebrais e facetárias. O sinal medular permanece normal — sem mielopatia, mas a medula está sendo tocada.</span>' +
              '</div>' +
            '</div>' +
            '<div class="ph-timeline">' +
              '<div class="ph-timeline-head">' +
                '<h3 class="ph-timeline-title">' + t('3B · Lumbar spine', '3B · Coluna lombar') + '</h3>' +
                '<span class="ph-timeline-span">' + t('2023 → 2026 · 2 studies', '2023 → 2026 · 2 estudos') + '</span>' +
              '</div>' +
              lumbar.map(buildPauloHistoryEntry).join('') +
              '<div class="ph-takeaway is-lumbar">' +
                '<span class="lang-en">The L5–S1 left-S1 compression pattern is <strong>stable across both studies</strong>, but the surrounding picture worsened: <strong>L3–L4 canal stenosis</strong> emerges as a second focus, and the addition of <strong>Modic I (oedema)</strong> signal at multiple levels means the degeneration is currently <em>active</em>, not chronically settled.</span>' +
                '<span class="lang-pt">O padrão de compressão da raiz S1 esquerda em L5–S1 é <strong>estável entre os dois estudos</strong>, mas o quadro ao redor piorou: <strong>estenose do canal em L3–L4</strong> aparece como segundo foco, e o aparecimento de sinal <strong>Modic I (edema)</strong> em múltiplos níveis indica que a degeneração está atualmente <em>ativa</em>, e não cronicamente estabilizada.</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /* ── Other studies on file (report-only) ────────────────────────
     Thirteen report-only studies spanning 2013–2025: peripheral joints
     (shoulder MRI 2015, knee MRI 2019, hand MRI 2025), chest (X-ray
     2019 ×2, CT 2019), abdomen/liver + a four-study urological series
     (abdomen US 2013, abdomen/pelvis CT 2022, abdomen+prostate US 2022,
     kidneys US 2022, urinary+prostate US 2023), and the head/face CTs
     (cranium 2023, face/sinus 2023). Each card carries the radiologist's
     key findings, an AI read, and a link to the original PDF. These are
     report-only — no source imagery to view. */

  function buildPauloOtherStudyCard(c) {
    var findingsHtml = (c.findingsEn || []).map(function (_, i) {
      return (
        '<li><span class="lang-en">' + c.findingsEn[i] + '</span>' +
        '<span class="lang-pt">' + c.findingsPt[i] + '</span></li>'
      );
    }).join('');
    return (
      '<article class="po-card">' +
        '<header class="po-card-head">' +
          '<div>' +
            '<div class="po-card-eyebrow">' + t(c.eyebrowEn, c.eyebrowPt) + '</div>' +
            '<h3 class="po-card-title">' + t(c.titleEn, c.titlePt) + '</h3>' +
            '<div class="po-card-meta">' + c.physician + ' · ' + c.provider + '</div>' +
          '</div>' +
          '<div class="po-card-date">' + t(c.dateEn, c.datePt) + '</div>' +
        '</header>' +
        '<ul class="po-findings">' + findingsHtml + '</ul>' +
        ((c.aiEn || c.aiPt) ?
          '<div class="po-ai">' +
            '<div class="po-ai-head">' +
              '<span class="ai-pill">AI</span>' +
              '<span class="po-ai-label">' + t('AI read', 'Leitura da IA') + '</span>' +
            '</div>' +
            '<p class="po-ai-body lang-en">' + (c.aiEn || '') + '</p>' +
            '<p class="po-ai-body lang-pt">' + (c.aiPt || '') + '</p>' +
          '</div>' : '') +
        '<div class="po-card-foot">' +
          '<span class="po-pending">' +
            (c.reportOnly
              ? t('Report only', 'Somente laudo')
              : t('Imaging not yet uploaded', 'Imagens ainda não carregadas')) +
          '</span>' +
          '<a class="po-pdf" href="' + c.pdfHref + '" download>' +
            t('Report PDF', 'Laudo PDF') +
          '</a>' +
        '</div>' +
      '</article>'
    );
  }

  function buildPauloOtherStudiesSection() {
    var cards = [
      {
        eyebrowEn: '4A · MRI · Right shoulder',
        eyebrowPt: '4A · RM · Ombro direito',
        titleEn:   'Right shoulder MRI',
        titlePt:   'RM do ombro direito',
        dateEn: '23 Nov 2015',
        datePt: '23 nov 2015',
        physician: 'Dr. André Luis Tucci Semeghini',
        provider:  'CETAM',
        pdfHref: 'scans/paulo-right-shoulder-mri-2015-11-23-report.pdf',
        findingsEn: [
          '<strong>Intense hypertrophic acromioclavicular arthropathy</strong> — irregular contours, marginal osteophytes, subchondral cysts, bone oedema / contusion, moderate capsular distension.',
          'Rotator cuff tendons with normal thickness and signal.',
          'Long-head biceps tendon centred in the bicipital groove, normal calibre and signal.',
          'No subacromial-subdeltoid bursal effusion. No joint effusion.',
        ],
        findingsPt: [
          '<strong>Intensa artropatia acromioclavicular hipertrófica</strong> — contornos irregulares, osteófitos marginais, cistos subcondrais, edema / contusão óssea, moderada distensão capsular.',
          'Tendões do manguito rotador com espessuras e sinais normais.',
          'Tendão do cabo longo do bíceps centrado na goteira, calibre e sinal habituais.',
          'Ausência de efusão na bursa subacromial-subdeltoidea. Sem derrame articular.',
        ],
        aiEn: 'Tied with the 2015 cervical MRI as the <strong>earliest study on file</strong>, and the first sign that Paulo&apos;s degeneration is <strong>not spine-only</strong>: the acromioclavicular joint is intensely arthritic (osteophytes, subchondral cysts, bone oedema) while the rotator cuff is intact. So the shoulder pain generator is the AC joint itself, not a tear — a mechanical, point-tender source amenable to local injection. Read alongside the knee (2019) and the dorsolumbar spine, this marks a <strong>systemic osteoarthritic diathesis</strong> rather than a single bad region.',
        aiPt: 'Empatado com a RM cervical de 2015 como o <strong>estudo mais antigo do histórico</strong>, e o primeiro sinal de que a degeneração do Paulo <strong>não se restringe à coluna</strong>: a articulação acromioclavicular está intensamente artrósica (osteófitos, cistos subcondrais, edema ósseo) com manguito rotador íntegro. Logo, o gerador de dor é a própria articulação AC, e não uma ruptura — fonte mecânica, dolorosa à palpação, tratável por infiltração local. Lido junto ao joelho (2019) e à coluna dorsolombar, configura uma <strong>tendência osteoartrósica sistêmica</strong>, não uma região isolada.',
      },
      {
        eyebrowEn: '4B · MRI · Right knee',
        eyebrowPt: '4B · RM · Joelho direito',
        titleEn:   'Right knee MRI',
        titlePt:   'RM do joelho direito',
        dateEn: '01 Aug 2019',
        datePt: '01 ago 2019',
        physician: 'Dra. Carla Catarina Horr',
        provider:  'CETAM',
        pdfHref: 'scans/paulo-right-knee-mri-2019-08-01-report.pdf',
        findingsEn: [
          'Signs suggestive of <strong>anterior tibial spine avulsion</strong> with distal patellar tendon oedema / tendinosis — possible Osgood-Schlatter sequela.',
          'Cicatricial changes of the collateral ligaments and medial patellofemoral ligament — no current ruptures.',
          'Mucinoid degeneration of the medial meniscus (no tear traces in current study).',
          'Free-border amputation at body / posterior-horn transition of the <strong>lateral meniscus</strong> — possible prior radial tear.',
          '<strong>Grade III femoropatellar chondropathy</strong> at the medial articular margin. Moderate joint effusion.',
        ],
        findingsPt: [
          'Sinais sugestivos de <strong>avulsão da espinha tibial anterior</strong> com edema / tendinose na inserção distal do tendão patelar — possível sequela de Osgood-Schlatter.',
          'Alterações cicatriciais dos ligamentos colaterais e do patelofemoral medial — sem rupturas atuais.',
          'Degeneração mucinoide do menisco medial (sem traços de ruptura no estudo atual).',
          'Amputação da borda livre na transição corpo / corno posterior do <strong>menisco lateral</strong> — possível ruptura radial prévia.',
          '<strong>Condropatia femoropatelar grau III</strong> na margem medial da articulação. Moderado derrame articular.',
        ],
        aiEn: 'Four years after the shoulder, a <strong>second load-bearing joint degenerates</strong> — grade III femoropatellar chondropathy, mucinoid meniscal degeneration and a moderate effusion, on a knee already scarred by old injury (likely Osgood-Schlatter sequela, prior lateral-meniscus radial tear). This reinforces the systemic pattern and adds a <strong>lower-limb mechanical burden</strong>: an antalgic, knee-sparing gait would load the already-compromised left lumbar segments and the S1 root further — the knee and the spine are not independent problems.',
        aiPt: 'Quatro anos após o ombro, uma <strong>segunda articulação de carga degenera</strong> — condropatia femoropatelar grau III, degeneração meniscal mucinoide e derrame moderado, num joelho já marcado por lesão antiga (provável sequela de Osgood-Schlatter, ruptura radial prévia do menisco lateral). Reforça o padrão sistêmico e acrescenta uma <strong>sobrecarga mecânica no membro inferior</strong>: uma marcha antálgica, poupando o joelho, sobrecarregaria ainda mais os segmentos lombares esquerdos e a raiz S1 — joelho e coluna não são problemas independentes.',
      },
      {
        eyebrowEn: '4C · CT · Abdomen & pelvis',
        eyebrowPt: '4C · TC · Abdome e pelve',
        titleEn:   'Abdomen & pelvis CT (with contrast)',
        titlePt:   'TC de abdome e pelve (com contraste)',
        dateEn: '31 Mar 2022',
        datePt: '31 mar 2022',
        physician: 'Dr. Rodney Jose Massa Ferro Ferraz',
        provider:  'CETAM',
        pdfHref: 'scans/paulo-abdomen-pelvis-ct-2022-03-31-report.pdf',
        findingsEn: [
          'Liver: lobulated contours, mild right-lobe volume reduction, <strong>tiny 4 mm hypodensity in segment IVb</strong> (cannot rule out small cyst).',
          'Pancreas: moderate adipose substitution. Small atheromatous calcification of the aortic wall.',
          '<strong>Bladder wall thickening with irregular contours</strong>; mildly globose prostate with small calcifications impressing the bladder floor — urology workup recommended.',
          '<strong>Diverticulosis</strong> in descending colon and sigmoid (no pericolic stranding).',
          '<strong>Marked dorsolumbar degenerative changes</strong> with severe L4–L5 discopathy — corroborates the MRI findings below.',
          'Volume reduction of regional musculature (paraspinal + gluteal). Calcified granuloma in left gluteal subcutaneous tissue.',
        ],
        findingsPt: [
          'Fígado: contornos lobulados, discreta redução do lobo direito, <strong>diminuta hipodensidade de 4 mm no segmento IVb</strong> (não se afasta diminuto cisto).',
          'Pâncreas: substituição adiposa moderada. Pequena calcificação ateromatosa na parede da aorta.',
          '<strong>Espessamento das paredes da bexiga com contornos irregulares</strong>; próstata levemente globosa com pequenas calcificações, impressão no assoalho vesical — recomenda-se investigação urológica.',
          '<strong>Diverticulose</strong> no cólon descendente e sigmoide (sem borramento da gordura pericólica).',
          '<strong>Alterações degenerativas acentuadas da coluna dorsolombar</strong> com discopatia L4–L5 grave — corrobora os achados de RM abaixo.',
          'Redução volumétrica da musculatura regional (paravertebral + glútea). Granuloma calcificado no subcutâneo da região glútea esquerda.',
        ],
        aiEn: 'The most clinically actionable non-spine study, on two fronts. First, it <strong>corroborates the spine disease from a different modality</strong> and shows paravertebral <em>and</em> gluteal muscle wasting already in 2022 — four years before the 2026 MRI quantified it, so the deconditioning is long-standing, not recent. Second, genuinely new and <strong>off the musculoskeletal axis</strong>: bladder-wall thickening with a globose prostate (the report itself recommends a <strong>urology workup</strong>) and sigmoid diverticulosis. These deserve a follow-up track of their own and should not get lost behind the spine narrative.',
        aiPt: 'O estudo não-coluna mais acionável, em duas frentes. Primeiro, <strong>corrobora a doença da coluna por outra modalidade</strong> e já mostra atrofia muscular paravertebral <em>e</em> glútea em 2022 — quatro anos antes de a RM de 2026 quantificá-la, ou seja, o descondicionamento é antigo, não recente. Segundo, genuinamente novo e <strong>fora do eixo musculoesquelético</strong>: espessamento da parede vesical com próstata globosa (o próprio laudo recomenda <strong>investigação urológica</strong>) e diverticulose sigmoide. Merecem um acompanhamento próprio e não devem se perder atrás da narrativa da coluna.',
      },
      {
        eyebrowEn: '4D · CT · Cranium',
        eyebrowPt: '4D · TC · Crânio',
        titleEn:   'Cranium CT (non-contrast)',
        titlePt:   'TC de crânio (sem contraste)',
        dateEn: '26 Apr 2023',
        datePt: '26 abr 2023',
        physician: 'Dr. Rodney Jose Massa Ferro Ferraz',
        provider:  'CETAM',
        pdfHref: 'scans/paulo-cranium-ct-2023-04-26-report.pdf',
        findingsEn: [
          'No intracranial haemorrhagic collection. Parenchymal attenuation values normal. Midline structures centred.',
          '<strong>Several small hyperdense foci scattered through the basal cisterns, sella turcica, left sylvian fissure and posterior fossa</strong> — correlate with clinical history of prior <em>myelography</em> (residual contrast).',
          'Mild widening of frontoparietal sulci and sylvian fissures (volumetric, age-appropriate).',
          'Falx and parietal-table-adjacent calcifications. Possible minimal perivascular-space enlargement in the right basal ganglia.',
          'Mild mucosal thickening in the left sphenoid sinus and right maxillary sinus. No fracture.',
        ],
        findingsPt: [
          'Sem coleção hemorrágica intracraniana. Atenuação parenquimatosa normal. Estruturas da linha média centradas.',
          '<strong>Várias pequenas imagens hiperdensas esparsas nas cisternas basais, sela túrcica, fissura sylviana esquerda e fossa posterior</strong> — correlacionar com história clínica de <em>mielografia</em> antiga (resíduo de contraste).',
          'Acentuação discreta dos sulcos frontoparietais e alargamentos discretos das fissuras sylvianas (volumétrico, compatível com a idade).',
          'Calcificações em torno da foice cerebral e adjacentes à tábua óssea parietal. Possível mínimo alargamento de espaço perivascular nos núcleos da base à direita.',
          'Discreto espessamento mucoso no seio esfenoidal esquerdo e no maxilar direito. Sem fratura.',
        ],
        aiEn: 'Largely <strong>reassuring</strong> — no bleed, no mass, no midline shift; the sulcal widening is age-appropriate involution. The one telling detail is the <strong>residual myelography contrast</strong> in the basal cisterns: Paulo underwent invasive contrast imaging of the spinal canal years ago, evidence that his spine disease is <strong>decades-deep</strong> and was once significant enough to warrant a pre-MRI-era investigation. Nothing here demands acute action; it anchors how long the spinal story has been running.',
        aiPt: 'Em geral <strong>tranquilizador</strong> — sem sangramento, sem massa, sem desvio de linha média; o alargamento dos sulcos é involução compatível com a idade. O detalhe revelador é o <strong>resíduo de contraste de mielografia</strong> nas cisternas basais: o Paulo foi submetido, anos atrás, a imagem contrastada invasiva do canal vertebral — prova de que a doença da coluna é <strong>de décadas</strong> e já foi significativa o bastante para justificar uma investigação da era pré-RM. Nada aqui exige ação aguda; situa há quanto tempo a história da coluna corre.',
      },
      {
        eyebrowEn: '4E · CT · Face / sinuses',
        eyebrowPt: '4E · TC · Face / seios',
        titleEn:   'Face & sinuses CT (non-contrast)',
        titlePt:   'TC dos seios da face (sem contraste)',
        dateEn: '14 Mar 2023',
        datePt: '14 mar 2023',
        physician: 'Dr. Ivan de Picoli Dantas (req.)',
        provider:  'CETAM',
        pdfHref: 'scans/paulo-face-sinus-ct-2023-03-14-report.pdf',
        findingsEn: [
          '<strong>Mucosal thickening</strong> in maxillary sinuses, left sphenoid sinus and ethmoid cells — consistent with low-grade chronic sinus inflammation.',
          '<strong>Septal deviation</strong> — irregular, tortuous nasal septum deviating leftward in its mid portion; 4 mm bony thickening on the left lateral septal face.',
          'Irregular contours of the nasal turbinates (normal volume). Osteomeatal complexes patent.',
          'Asymmetric olfactory fossae (Keros type II). Pterygopalatine fossae and parapharyngeal spaces normal.',
          'Incidental: possible residue of old myelography contrast in basal cisterns — cross-references the cranium CT finding above.',
        ],
        findingsPt: [
          '<strong>Espessamento mucoso</strong> nos seios maxilares, esfenoidal esquerdo e células etmoidais — compatível com sinusopatia crônica de baixo grau.',
          '<strong>Desvio do septo nasal</strong> — septo irregular e tortuoso desviando para a esquerda na porção média; espessamento ósseo de 4 mm na face lateral esquerda do septo.',
          'Contornos irregulares dos cornetos nasais (volume normal). Complexos osteomeatais livres.',
          'Fossas olfatórias assimétricas (Keros tipo II). Fossas pterigopalatinas e espaços parafaríngeos normais.',
          'Achado adjacente: possível resíduo de mielografia antiga nas cisternas da base — cruza-se com o achado da TC de crânio acima.',
        ],
        aiEn: 'A <strong>benign, ENT-referable</strong> finding set: low-grade chronic sinus inflammation plus an anatomic septal deviation — together a plausible cause of chronic nasal obstruction / recurrent sinus symptoms, and the kind of fixable structural issue worth surfacing even though it sits well outside the spine story. The same old myelography residue seen on the cranium CT is noted again, cross-confirming it. No aggressive sinonasal disease.',
        aiPt: 'Conjunto <strong>benigno e encaminhável ao otorrino</strong>: sinusopatia crônica de baixo grau somada a um desvio anatômico do septo — juntos, causa plausível de obstrução nasal crônica / sintomas sinusais recorrentes, e um problema estrutural corrigível que vale registrar mesmo estando fora da história da coluna. O mesmo resíduo de mielografia antiga visto na TC de crânio reaparece, confirmando-o de forma cruzada. Sem doença sinonasal agressiva.',
      },
      {
        eyebrowEn: '4F · MRI · Right hand',
        eyebrowPt: '4F · RM · Mão direita',
        titleEn:   'Right hand MRI',
        titlePt:   'RM da mão direita',
        dateEn: '12 Jun 2025',
        datePt: '12 jun 2025',
        physician: 'Req. Renan Radael de Figueiredo',
        provider:  'São Luiz · Campinas',
        pdfHref: 'scans/paulo-right-hand-mri-2025-06-12-report.pdf',
        reportOnly: true,
        findingsEn: [
          '<strong>Degenerative change at the thumb metacarpophalangeal joint</strong> — joint-space narrowing, cartilage thinning, subchondral oedema and sclerosis with a small effusion.',
          'Carpometacarpal narrowing between the capitate and the 3rd metacarpal with a small osteophyte.',
          '<strong>Signal change with a vascular-channel appearance in the heads of the 2nd and 3rd metacarpals</strong>; no fracture or aggressive bone lesion.',
          '<strong>Flexor tendinopathy of the 2nd finger</strong> and <strong>flexor tenosynovitis of the 4th finger</strong> (increased fluid in the flexor sheath). Ligaments intact.',
        ],
        findingsPt: [
          '<strong>Alteração degenerativa na articulação metacarpofalângica do polegar</strong> — redução do espaço articular, afilamento da cartilagem, edema e esclerose subcondrais com pequeno derrame.',
          'Redução do espaço carpometacárpico entre o capitato e o 3º metacarpo, com pequeno osteófito.',
          '<strong>Alteração de sinal com aspecto de canais vasculares nas cabeças dos 2º e 3º metacarpos</strong>; sem fratura ou lesão óssea agressiva.',
          '<strong>Tendinopatia dos flexores do 2º dedo</strong> e <strong>tenossinovite do flexor do 4º dedo</strong> (aumento de líquido na bainha). Complexos ligamentares íntegros.',
        ],
        aiEn: 'A third joint with the same picture: degenerative metacarpophalangeal / carpometacarpal change a decade after the shoulder (2015) and knee (2019). It extends the <strong>systemic osteoarthritic thread into the hand</strong> and adds an active soft-tissue component — flexor tendinopathy plus 4th-finger tenosynovitis — that is itself treatable. As the most recent peripheral study on file (2025), it confirms the diathesis is still progressing outside the spine.',
        aiPt: 'Uma terceira articulação com o mesmo quadro: alteração degenerativa metacarpofalângica / carpometacárpica uma década após o ombro (2015) e o joelho (2019). Estende o <strong>fio osteoartrósico sistêmico até a mão</strong> e acrescenta um componente ativo de partes moles — tendinopatia flexora e tenossinovite do 4º dedo — tratável por si só. Sendo o estudo periférico mais recente do histórico (2025), confirma que a tendência segue progredindo fora da coluna.',
      },
      {
        eyebrowEn: '4G · X-ray · Chest',
        eyebrowPt: '4G · RX · Tórax',
        titleEn:   'Chest X-ray',
        titlePt:   'RX de tórax',
        dateEn: '23 Jan 2019',
        datePt: '23 jan 2019',
        physician: 'Dr. Auro Giorgi Ferreira Nobre · CRM 112526',
        provider:  'Unimed Diagnóstico por Imagem',
        pdfHref: 'scans/paulo-chest-xr-2019-01-23-report.pdf',
        reportOnly: true,
        findingsEn: [
          'Normal transparency of the pleuropulmonary fields.',
          'Cardiac area and great vessels preserved.',
          'Soft tissues and visible bone structures intact; costophrenic sinuses clear.',
        ],
        findingsPt: [
          'Transparência normal dos campos pleuropulmonares.',
          'Área cardíaca e vasos da base conservados.',
          'Partes moles e estruturas ósseas visíveis íntegras; seios costofrênicos livres.',
        ],
        aiEn: 'A <strong>radiologically normal chest</strong> — no infiltrate, effusion or cardiomegaly. Read with the chest CT eight weeks later (also benign) and a second normal chest film in March, it sets a <strong>clean cardiopulmonary baseline</strong> through early 2019: the degenerative burden elsewhere has no thoracic correlate.',
        aiPt: 'Tórax <strong>radiologicamente normal</strong> — sem infiltrado, derrame ou cardiomegalia. Lido junto à TC de tórax oito semanas depois (também benigna) e a um segundo RX de tórax normal em março, fixa uma <strong>linha de base cardiopulmonar limpa</strong> no início de 2019: a carga degenerativa de outras regiões não tem correlato torácico.',
      },
      {
        eyebrowEn: '4H · X-ray · Chest & sinuses',
        eyebrowPt: '4H · RX · Tórax e seios da face',
        titleEn:   'Chest & sinus X-ray',
        titlePt:   'RX de tórax e seios da face',
        dateEn: '05 Mar 2019',
        datePt: '05 mar 2019',
        physician: 'Dr. Diego Armando Effio Solis · CRM 161584',
        provider:  'Hospital São Paulo · Ribeirão Preto',
        pdfHref: 'scans/paulo-chest-sinus-xr-2019-03-05-report.pdf',
        reportOnly: true,
        findingsEn: [
          '<strong>Chest PA + lateral (05 Mar 2019):</strong> intact ribs, normal hila and pulmonary vasculature, no opacity or consolidation, clear costophrenic sinuses, normal cardiac area — radiologically normal.',
          '<strong>Sinus series, 3 views (bundled, 02 Feb 2019):</strong> intact regional bone, normal sinus transparency, tortuous nasal septum — <strong>no evidence of sinus disease</strong>.',
        ],
        findingsPt: [
          '<strong>RX de tórax PA + perfil (05 mar 2019):</strong> arcos costais íntegros, hilos e trama vascular normais, sem opacidades ou consolidações, seios costofrênicos livres, área cardíaca normal — radiologicamente normal.',
          '<strong>RX de seios da face, 3 incidências (anexo, 02 fev 2019):</strong> estruturas ósseas regionais íntegras, transparência normal dos seios, tortuosidade do septo nasal — <strong>sem evidências de sinusopatia</strong>.',
        ],
        aiEn: 'Confirms the normal-chest picture and adds an early plain-film look at the sinuses: <strong>no sinusitis, only a tortuous / deviated nasal septum</strong> — the same septal deviation the 2023 face CT later characterises in detail. The structural nasal finding therefore predates the CT by four years, while inflammatory sinus disease was absent on plain film in 2019.',
        aiPt: 'Confirma o tórax normal e acrescenta um olhar precoce, por radiografia simples, sobre os seios da face: <strong>sem sinusite, apenas septo nasal tortuoso / desviado</strong> — o mesmo desvio que a TC de face de 2023 detalharia depois. O achado estrutural nasal antecede a TC em quatro anos, enquanto a sinusopatia inflamatória estava ausente na radiografia de 2019.',
      },
      {
        eyebrowEn: '4I · CT · Chest',
        eyebrowPt: '4I · TC · Tórax',
        titleEn:   'Chest CT (non-contrast)',
        titlePt:   'TC de tórax (sem contraste)',
        dateEn: '15 Mar 2019',
        datePt: '15 mar 2019',
        physician: 'Dr. José Álvaro Gonçalves Júnior · CRM 38510',
        provider:  'Instituto de Radiologia',
        pdfHref: 'scans/paulo-chest-ct-2019-03-15-report.pdf',
        reportOnly: true,
        findingsEn: [
          'Indication: cough. Fine-slice helical CT with multiplanar / 3D reconstruction, without contrast.',
          'Lung parenchyma normal; no pleural effusion or thickening. Trachea and bronchi patent.',
          'No adenomegaly; small paratracheal, infracarinal and aortopulmonary-window <strong>lymph nodes up to 0.7 cm</strong>. Conclusion: <strong>reactive mediastinal lymph nodes</strong>.',
          'Thoracic aorta and mediastinal vessels normal; normal cardiac area, no pericardial effusion. <strong>Dorsal spondyloarthrosis.</strong>',
        ],
        findingsPt: [
          'Indicação: tosse. TC helicoidal de cortes finos com reconstrução multiplanar / 3D, sem contraste.',
          'Parênquima pulmonar normal; sem derrame ou espessamento pleural. Traqueia e brônquios pérvios.',
          'Ausência de adenomegalias; pequenos linfonodos paratraqueais, infra-carinal e da janela aorto-pulmonar <strong>até 0,7 cm</strong>. Conclusão: <strong>linfonodos reacionais mediastinais</strong>.',
          'Aorta torácica e vasos mediastinais normais; área cardíaca normal, sem derrame pericárdico. <strong>Espondiloartrose dorsal.</strong>',
        ],
        aiEn: 'Worked up for cough and <strong>essentially reassuring</strong>: clean lung parenchyma, only small (≤ 0.7 cm) reactive mediastinal nodes with no mass or adenomegaly. The one cross-link to the dominant story is incidental — <strong>dorsal (thoracic) spondyloarthrosis</strong>, the degenerative spine showing up even on a chest CT and bridging the cervical and lumbar disease across the thoracic segment.',
        aiPt: 'Investigada por tosse e <strong>essencialmente tranquilizadora</strong>: parênquima pulmonar limpo, apenas pequenos linfonodos mediastinais reacionais (≤ 0,7 cm), sem massa ou adenomegalia. O único elo com a história dominante é incidental — <strong>espondiloartrose dorsal (torácica)</strong>, a coluna degenerativa aparecendo até numa TC de tórax e fazendo a ponte entre a doença cervical e a lombar no segmento torácico.',
      },
      {
        eyebrowEn: '4J · Ultrasound · Abdomen',
        eyebrowPt: '4J · US · Abdome',
        titleEn:   'Abdominal ultrasound',
        titlePt:   'Ultrassom de abdome total',
        dateEn: '27 Jul 2013',
        datePt: '27 jul 2013',
        physician: 'Dr. Paulo Tadeu de C. Prado · CRM 04233',
        provider:  'Instituto de Radiologia',
        pdfHref: 'scans/paulo-abdomen-us-2013-07-27-report.pdf',
        reportOnly: true,
        findingsEn: [
          '<strong>Hepatomegaly</strong> — right lobe 16.0 cm, left lobe 8.9 cm — with diffusely increased echogenicity and sound-beam attenuation. Impression: <strong>mild hepatic steatosis</strong>.',
          'Pancreas, spleen and kidneys normal. Bile ducts, gallbladder and common duct normal.',
          'Bladder, prostate and seminal vesicles normal. No solid or cystic abdominal mass.',
        ],
        findingsPt: [
          '<strong>Hepatomegalia</strong> — lobo direito 16,0 cm, lobo esquerdo 8,9 cm — com aumento difuso da ecogenicidade e atenuação do feixe sonoro. Impressão: <strong>esteatose hepática discreta</strong>.',
          'Pâncreas, baço e rins normais. Vias biliares, vesícula e colédoco normais.',
          'Bexiga, próstata e vesículas seminais normais. Sem massas abdominais sólidas ou císticas.',
        ],
        aiEn: 'The <strong>earliest study in Paulo&apos;s entire record (2013)</strong> and the <strong>start of the fatty-liver thread</strong>: hepatomegaly with mild steatosis, still present nine years later on the 2022 abdominal ultrasound. Steatosis tracks with the borderline-atherogenic lipid pattern in his bloodwork, making the liver the clearest metabolic cross-link — and, like the muscle thread, a modifiable one. The prostate was still normal here; its enlargement appears later.',
        aiPt: 'O estudo <strong>mais antigo de todo o histórico do Paulo (2013)</strong> e o <strong>início do fio do fígado gorduroso</strong>: hepatomegalia com esteatose discreta, ainda presente nove anos depois no ultrassom de abdome de 2022. A esteatose acompanha o padrão lipídico limítrofe-aterogênico do sangue, tornando o fígado o elo metabólico mais claro — e, como o fio muscular, modificável. A próstata ainda estava normal aqui; o aumento aparece depois.',
      },
      {
        eyebrowEn: '4K · Ultrasound · Abdomen & prostate',
        eyebrowPt: '4K · US · Abdome e próstata',
        titleEn:   'Abdomen & prostate ultrasound',
        titlePt:   'Ultrassom de abdome e próstata',
        dateEn: '24 Mar 2022',
        datePt: '24 mar 2022',
        physician: 'Dr. Rogério Ximenes · CRM 78585',
        provider:  'Rossetti Diagnóstico por Imagem',
        pdfHref: 'scans/paulo-abdomen-prostate-us-2022-03-24-report.pdf',
        reportOnly: true,
        findingsEn: [
          '<strong>Enlarged prostate</strong> — 4.0 × 4.4 × 4.7 cm, volume 44.2 cm³ (~48.6 g); post-void residual 62 cm³. Heterogeneous parenchyma, no discrete peripheral-zone nodule on the suprapubic view.',
          'Liver: normal size / contour with <strong>diffusely increased echogenicity (steatosis)</strong> and focal-sparing areas near the gallbladder.',
          '<strong>Well-defined 40 × 45 mm hypoechoic nodular area</strong> in the deep medial left lobe (segment I) — nodular lesion vs. focal sparing, to clarify.',
          'Gallbladder, pancreas, spleen, kidneys and bladder otherwise normal. Sensitivity reduced by increased abdominal volume.',
        ],
        findingsPt: [
          '<strong>Próstata aumentada</strong> — 4,0 × 4,4 × 4,7 cm, volume 44,2 cm³ (~48,6 g); resíduo pós-miccional 62 cm³. Parênquima heterogêneo, sem nódulo evidente em zona periférica na via suprapúbica.',
          'Fígado: dimensões / contornos normais com <strong>aumento difuso da ecogenicidade (esteatose)</strong> e áreas de preservação focal junto à vesícula.',
          '<strong>Área nodular hipoecóica bem delimitada de 40 × 45 mm</strong> no lobo esquerdo medial profundo (setor I) — lesão nodular vs. preservação focal, a esclarecer.',
          'Vesícula, pâncreas, baço, rins e bexiga sem outras alterações. Sensibilidade reduzida pelo aumento do volume abdominal.',
        ],
        aiEn: 'Two threads in one study. First, it <strong>opens the urological track</strong>: benign prostatic enlargement (44 cm³) with a measurable post-void residual (62 cm³) — the same picture the abdomen / pelvis CT flagged for urology workup that same year, and that the 2023 ultrasounds follow. Second, the fatty liver persists from 2013, now with a <strong>40 × 45 mm hypoechoic area the report itself cannot call</strong> (nodule vs. focal sparing) — the one finding here that warrants dedicated follow-up imaging rather than reassurance.',
        aiPt: 'Dois fios num só estudo. Primeiro, <strong>abre a trilha urológica</strong>: aumento prostático benigno (44 cm³) com resíduo pós-miccional mensurável (62 cm³) — o mesmo quadro que a TC de abdome / pelve encaminhou para investigação urológica no mesmo ano e que os ultrassons de 2023 acompanham. Segundo, o fígado gorduroso persiste desde 2013, agora com uma <strong>área hipoecóica de 40 × 45 mm que o próprio laudo não define</strong> (nódulo vs. preservação focal) — o único achado aqui que pede imagem de seguimento dedicada, e não tranquilização.',
      },
      {
        eyebrowEn: '4L · Ultrasound · Kidneys & urinary tract',
        eyebrowPt: '4L · US · Rins e vias urinárias',
        titleEn:   'Kidneys & urinary tract ultrasound',
        titlePt:   'Ultrassom de rins e vias urinárias',
        dateEn: '25 Aug 2022',
        datePt: '25 ago 2022',
        physician: 'Dr. Paulo Zanello · CRM 25.363',
        provider:  'Clínica Zanello',
        pdfHref: 'scans/paulo-kidneys-us-2022-08-25-report.pdf',
        reportOnly: true,
        findingsEn: [
          'Right kidney 12.6 × 6.0 × 6.8 cm with a <strong>small 0.7 cm exophytic cortical cyst</strong> (mid third); normal cortex.',
          'Left kidney 12.4 × 7.1 × 5.7 cm, normal. No pelvicalyceal dilation or calculi.',
          'Bladder normal capacity and wall, preserved ureteric jets.',
          'Impression: <strong>small simple cyst in the right kidney</strong>; everything else within normal limits.',
        ],
        findingsPt: [
          'Rim direito 12,6 × 6,0 × 6,8 cm com <strong>pequeno cisto cortical exofítico de 0,7 cm</strong> (terço médio); córtex normal.',
          'Rim esquerdo 12,4 × 7,1 × 5,7 cm, normal. Sem dilatação pielocalicial ou cálculos.',
          'Bexiga de capacidade e paredes normais, jatos ureterais conservados.',
          'Impressão: <strong>pequeno cisto simples no rim direito</strong>; demais estruturas dentro da normalidade.',
        ],
        aiEn: 'The renal half of the urological work-up, five months after the prostate ultrasound: <strong>essentially normal upper tracts</strong>, the only finding a 0.7 cm simple cortical cyst on the right — a benign, no-action incidental. Reassuring that the bladder-outlet picture (BPH, raised residual) has <strong>not yet caused upstream renal or collecting-system damage</strong>.',
        aiPt: 'A metade renal da investigação urológica, cinco meses após o ultrassom de próstata: <strong>vias urinárias altas essencialmente normais</strong>, com o único achado de um cisto cortical simples de 0,7 cm à direita — incidental, benigno, sem conduta. Tranquilizador que o quadro de esvaziamento vesical (HPB, resíduo elevado) <strong>ainda não causou dano renal ou do sistema coletor a montante</strong>.',
      },
      {
        eyebrowEn: '4M · Ultrasound · Urinary tract & prostate',
        eyebrowPt: '4M · US · Vias urinárias e próstata',
        titleEn:   'Urinary tract & prostate ultrasound',
        titlePt:   'Ultrassom de vias urinárias e próstata',
        dateEn: '13 Feb 2023',
        datePt: '13 fev 2023',
        physician: 'Dr. Rafael Azevedo Maychak · CRM-SP 149339',
        provider:  'Santa Bárbara D&apos;Oeste, SP',
        pdfHref: 'scans/paulo-urinary-prostate-us-2023-02-13-report.pdf',
        reportOnly: true,
        findingsEn: [
          'Both kidneys topical, normal size and echotexture (right 12.1 cm, left 11.4 cm). Bladder normal.',
          'Prostate finely heterogeneous, regular contours, volume ~32.5 cm³.',
          '<strong>Post-void residual ~76.9 cm³</strong> (pre-void ~590 cm³).',
          'Impression: study of usual appearance.',
        ],
        findingsPt: [
          'Ambos os rins tópicos, dimensões e ecotextura normais (direito 12,1 cm, esquerdo 11,4 cm). Bexiga normal.',
          'Próstata finamente heterogênea, contornos regulares, volume ~32,5 cm³.',
          '<strong>Resíduo pós-miccional ~76,9 cm³</strong> (pré-miccional ~590 cm³).',
          'Impressão: estudo de aspecto habitual.',
        ],
        aiEn: 'The <strong>most recent urological study</strong> and the natural follow-up to the 2022 pair. Each report reads as &ldquo;usual&rdquo; in isolation, but across the year the <strong>post-void residual rose from 62 to ~77 cm³</strong> — incomplete bladder emptying trending the wrong way even as the kidneys stay normal. This is the through-line the 2022 CT predicted: a slowly-progressive benign-prostatic-obstruction picture that belongs on its own surveillance track, separate from the spine.',
        aiPt: 'O <strong>estudo urológico mais recente</strong> e o seguimento natural do par de 2022. Cada laudo, isolado, é lido como &ldquo;habitual&rdquo;, mas ao longo do ano o <strong>resíduo pós-miccional subiu de 62 para ~77 cm³</strong> — esvaziamento vesical incompleto tendendo na direção errada, ainda que os rins permaneçam normais. É o fio que a TC de 2022 previu: um quadro de obstrução prostática benigna lentamente progressivo, que merece vigilância própria, à parte da coluna.',
      },
    ];

    return (
      '<section class="report-section" id="paulo-other-studies">' +
        '<div class="container">' +
          '<div class="section-label">' +
            t('4 · Other studies on file', '4 · Outros exames disponíveis') +
          '</div>' +
          '<h2 class="section-title">' +
            t('Beyond the spine — thirteen additional reports',
              'Além da coluna — outros treze laudos') +
          '</h2>' +
          '<p class="section-desc">' +
            t('Thirteen additional radiology reports on file, spanning 2013 to 2025 — peripheral joints (shoulder, knee, hand), chest (X-ray and CT), the abdomen / liver and a four-study urological series, plus the head and face CTs. Each card carries the radiologist&apos;s key findings, an AI read, and the full PDF; these are report-only studies, with no source imagery to view.',
              'Treze laudos de radiologia no histórico, de 2013 a 2025 — articulações periféricas (ombro, joelho, mão), tórax (RX e TC), abdome / fígado e uma série urológica de quatro estudos, além das TCs de crânio e face. Cada cartão traz os achados-chave do radiologista, uma leitura da IA e o PDF completo; são estudos somente-laudo, sem imagens de origem para visualizar.') +
          '</p>' +
          '<div class="po-grid">' +
            cards.map(buildPauloOtherStudyCard).join('') +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /* ── Overall clinical evolution · the major cross-study link ──────
     The capstone synthesis. Sections 1–4 each look at one axis (the
     current snapshot, the spine viewer, the per-region longitudinal
     arcs, the isolated studies). This ties ALL eighteen studies — spine,
     peripheral joints, chest, abdomen/urological and systemic CT — into
     one thirteen-year clinical story, and surfaces the non-spine
     follow-up that the spine narrative tends to bury. */

  function buildPauloOverallEvolution() {
    return (
      '<section class="paulo-ai-summary-wrap" id="paulo-overall-evolution">' +
        '<div class="container">' +
          '<div class="paulo-ai-summary">' +
            '<header class="paulo-ai-summary-head">' +
              '<h2>' + t('5 · Overall clinical evolution', '5 · Evolução clínica geral') + '</h2>' +
              '<span class="ai-pill">AI</span>' +
            '</header>' +
            '<div class="paulo-ai-summary-meta">' +
              t('The through-line across all 18 studies · spine, peripheral joints, chest, abdomen / urological and systemic CT · 2013 → 2026 · 13 years',
                'O fio condutor entre os 18 estudos · coluna, articulações periféricas, tórax, abdome / urológico e TC sistêmica · 2013 → 2026 · 13 anos') +
            '</div>' +
            '<div class="paulo-ai-subhead">' +
              t('The one-line read', 'A leitura em uma linha') +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-en">' +
              '<p>Across thirteen years and eighteen studies, the picture is coherent: a <strong>single, slowly-progressive and currently-active systemic degenerative process</strong>, worst in the spine but not confined to it, carrying an unbroken <strong>left-sided radicular burden</strong> and a parallel arc of <strong>muscle deconditioning</strong>. Paulo does not have a bad back and a few unrelated incidental findings — he has a body-wide osteoarthritic diathesis whose most symptomatic site happens to be the spine.</p>' +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-pt">' +
              '<p>Ao longo de treze anos e dezoito estudos, o quadro é coerente: um <strong>único processo degenerativo sistêmico, lentamente progressivo e atualmente ativo</strong>, pior na coluna mas não restrito a ela, com um <strong>encargo radicular à esquerda</strong> ininterrupto e um arco paralelo de <strong>descondicionamento muscular</strong>. O Paulo não tem uma coluna ruim mais alguns achados incidentais soltos — tem uma tendência osteoartrósica de todo o corpo cujo sítio mais sintomático é a coluna.</p>' +
            '</div>' +

            '<div class="paulo-ai-arcs-block">' +
              '<div class="paulo-ai-subhead">' +
                t('Three threads, one process', 'Três fios, um processo') +
              '</div>' +
              '<div class="paulo-ai-arcs">' +
                '<div class="paulo-ai-arc">' +
                  '<div class="paulo-ai-arc-head">' +
                    '<h3 class="paulo-ai-arc-title">' + t('1 · The spine is the spine of the story', '1 · A coluna é a espinha da história') + '</h3>' +
                    '<span class="paulo-ai-arc-span">' + t('5 MRIs · 2015 → 2026', '5 RMs · 2015 → 2026') + '</span>' +
                  '</div>' +
                  '<p class="paulo-ai-arc-body lang-en">The dominant, progressive thread. Cervically the lesion <strong>migrated upward</strong> (C6–C7 → C5–C6) and now <strong>contacts the cord</strong>; lumbarly the L5–S1 left-S1 extrusion held its shape but the surrounding tissue turned <strong>active (Modic I)</strong> and a second focus — L3–L4 canal stenosis — appeared. The constant across both regions and both decades: a <strong>left-sided radicular pattern</strong> (S1 below, C6/C7 above).</p>' +
                  '<p class="paulo-ai-arc-body lang-pt">O fio dominante e progressivo. Na cervical a lesão <strong>migrou para cima</strong> (C6–C7 → C5–C6) e agora <strong>toca a medula</strong>; na lombar a extrusão L5–S1 (raiz S1 esquerda) manteve a forma, mas o tecido ao redor ficou <strong>ativo (Modic I)</strong> e surgiu um segundo foco — estenose do canal em L3–L4. A constante nas duas regiões e nas duas décadas: um <strong>padrão radicular à esquerda</strong> (S1 abaixo, C6/C7 acima).</p>' +
                '</div>' +
                '<div class="paulo-ai-arc">' +
                  '<div class="paulo-ai-arc-head">' +
                    '<h3 class="paulo-ai-arc-title">' + t('2 · Systemic, not focal', '2 · Sistêmico, não focal') + '</h3>' +
                    '<span class="paulo-ai-arc-span">' + t('Shoulder 2015 · Knee 2019 · Hand 2025', 'Ombro 2015 · Joelho 2019 · Mão 2025') + '</span>' +
                  '</div>' +
                  '<p class="paulo-ai-arc-body lang-en">The shoulder (intense AC arthropathy, 2015), the knee (grade III chondropathy + meniscal degeneration, 2019) and now the <strong>right hand (degenerative MCP / CMC change, 2025)</strong> show the <strong>same degenerative diathesis in joint after joint</strong> — the spine is the worst-hit site, not the only one, and the hand confirms it is <strong>still spreading a decade on</strong>. Practically, the lower-limb disease also matters to the spine: a knee-sparing, antalgic gait <strong>reloads the compromised left lumbar segments</strong>, so these are not independent problems.</p>' +
                  '<p class="paulo-ai-arc-body lang-pt">O ombro (artropatia AC intensa, 2015), o joelho (condropatia grau III + degeneração meniscal, 2019) e agora a <strong>mão direita (alteração degenerativa MCF / CMC, 2025)</strong> mostram a <strong>mesma tendência degenerativa em articulação após articulação</strong> — a coluna é o sítio mais afetado, não o único, e a mão confirma que ela <strong>segue se espalhando uma década depois</strong>. Na prática, a doença do membro inferior também importa para a coluna: uma marcha antálgica poupando o joelho <strong>sobrecarrega os segmentos lombares esquerdos comprometidos</strong>, de modo que não são problemas independentes.</p>' +
                '</div>' +
                '<div class="paulo-ai-arc">' +
                  '<div class="paulo-ai-arc-head">' +
                    '<h3 class="paulo-ai-arc-title">' + t('3 · The muscle dimension', '3 · A dimensão muscular') + '</h3>' +
                    '<span class="paulo-ai-arc-span">' + t('Confirmed on MRI + CT', 'Confirmado em RM + TC') + '</span>' +
                  '</div>' +
                  '<p class="paulo-ai-arc-body lang-en">Paravertebral (and, on the 2022 CT, gluteal) <strong>muscle wasting shows up across two modalities four years apart</strong> — so the deconditioning is long-standing, both a consequence and a driver of the pain. It is also the <strong>single most modifiable lever</strong>: targeted strengthening is the one thread on this page Paulo can change without a needle or a scalpel.</p>' +
                  '<p class="paulo-ai-arc-body lang-pt">A <strong>atrofia muscular</strong> paravertebral (e glútea, na TC de 2022) <strong>aparece em duas modalidades com quatro anos de diferença</strong> — logo, o descondicionamento é antigo, ao mesmo tempo consequência e motor da dor. É também a <strong>alavanca mais modificável</strong>: o fortalecimento direcionado é o único fio desta página que o Paulo pode mudar sem agulha nem bisturi.</p>' +
                '</div>' +
              '</div>' +
              '<p class="paulo-ai-arcs-cross lang-en"><strong>Beyond the musculoskeletal — don&apos;t let the spine bury these.</strong> A <strong>urological thread</strong> runs through four studies: the 2022 abdomen / pelvis CT flagged a thickened bladder wall + globose prostate <em>for urology workup</em>, and the ultrasound series that followed confirms benign prostatic enlargement with a <strong>post-void residual climbing from 62 cm³ (Mar 2022) to ~77 cm³ (Feb 2023)</strong> — incomplete emptying trending the wrong way while the kidneys stay normal (only a 0.7 cm simple cyst). A parallel <strong>metabolic thread</strong>: hepatic steatosis is on record from the very first study (2013) through 2022, tracking his borderline-atherogenic lipids — and the 2022 ultrasound leaves a <strong>40 × 45 mm left-lobe area uncharacterised (nodule vs. focal sparing)</strong> that warrants dedicated follow-up. The head and face CTs are reassuring but both show <strong>residual myelography contrast</strong>, proof the spinal disease is decades-deep; the face CT adds a benign, ENT-referable chronic sinus disease with septal deviation. The chest films and CT (2019) are clean. These belong on a <strong>separate follow-up track</strong> from the spine.</p>' +
              '<p class="paulo-ai-arcs-cross lang-pt"><strong>Além do musculoesquelético — não deixe a coluna enterrar estes.</strong> Um <strong>fio urológico</strong> percorre quatro estudos: a TC de abdome / pelve de 2022 sinalizou parede vesical espessada + próstata globosa <em>para investigação urológica</em>, e a série de ultrassons seguinte confirma aumento prostático benigno com <strong>resíduo pós-miccional subindo de 62 cm³ (mar 2022) para ~77 cm³ (fev 2023)</strong> — esvaziamento incompleto tendendo na direção errada, com rins normais (apenas um cisto simples de 0,7 cm). Um <strong>fio metabólico</strong> em paralelo: a esteatose hepática consta desde o primeiro estudo (2013) até 2022, acompanhando os lipídios limítrofe-aterogênicos — e o ultrassom de 2022 deixa uma <strong>área de 40 × 45 mm no lobo esquerdo sem caracterização (nódulo vs. preservação focal)</strong> que pede seguimento dedicado. As TCs de crânio e face são tranquilizadoras, mas ambas mostram <strong>resíduo de mielografia</strong>, prova de que a doença da coluna é de décadas; a TC de face acrescenta uma sinusopatia crônica benigna, encaminhável ao otorrino, com desvio de septo. As radiografias e a TC de tórax (2019) estão limpas. Estes pertencem a um <strong>acompanhamento à parte</strong> do da coluna.</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function wirePauloUnifiedViewer(viewerEl, studies) {
    var img    = viewerEl.querySelector('.ct-img');
    var slider = viewerEl.querySelector('.ct-slider');
    var idxEl  = viewerEl.querySelector('.ct-idx');
    var totEl  = viewerEl.querySelector('.ct-total');
    var seqEl  = viewerEl.querySelector('.pl-sequence-tag');
    var stage  = viewerEl.querySelector('.ct-stage');
    var regionTabs = viewerEl.querySelectorAll('.pl-region-tab');
    var orientTabs = viewerEl.querySelectorAll('.pl-orient-tab');

    // manifests[region] = { axi: [filenames], axi_meta: [{file, series}], ... }
    var manifests = { cervical: null, lombar: null };
    var slugByRegion = {};
    studies.forEach(function (s) {
      // slug is e.g. "paulo-cervical-mri-2026-05-15" → region key = 'cervical' or 'lombar'
      if (/cervical/.test(s.slug)) slugByRegion['cervical'] = s.slug;
      else if (/lombar|lumbar/.test(s.slug)) slugByRegion['lombar'] = s.slug;
    });

    var state = { region: 'cervical', orient: 'axi', cache: new Map() };
    var PRELOAD = 6;

    function currentFiles() {
      var m = manifests[state.region];
      return (m && m[state.orient]) ? m[state.orient] : [];
    }
    function currentMeta() {
      var m = manifests[state.region];
      return (m && m[state.orient + '_meta']) ? m[state.orient + '_meta'] : [];
    }
    function urlFor(i) {
      var files = currentFiles();
      return 'scans/' + slugByRegion[state.region] + '/' + state.orient + '/' + files[i];
    }

    function updateSequenceTag(i) {
      var meta = currentMeta();
      var series = (meta[i] && meta[i].series) ? meta[i].series : '';
      if (seqEl) seqEl.textContent = series;
    }

    function setSlice(i) {
      var files = currentFiles();
      var max = files.length - 1;
      if (max < 0) { idxEl.textContent = '0'; totEl.textContent = '0'; return; }
      i = Math.max(0, Math.min(max, i));
      slider.value = i;
      idxEl.textContent = String(i + 1);
      img.src = urlFor(i);
      updateSequenceTag(i);
      for (var d = 1; d <= PRELOAD; d++) {
        [i + d, i - d].forEach(function (n) {
          if (n < 0 || n > max) return;
          var key = state.region + ':' + state.orient + ':' + n;
          if (state.cache.has(key)) return;
          var im = new Image();
          im.src = 'scans/' + slugByRegion[state.region] + '/' + state.orient + '/' + files[n];
          state.cache.set(key, im);
        });
      }
    }

    function refreshSliderRange() {
      var files = currentFiles();
      var max = Math.max(0, files.length - 1);
      slider.max = String(max);
      totEl.textContent = String(files.length);
      // jump to the middle slice of the new set
      var mid = Math.floor(max / 2);
      setSlice(mid);
    }

    function syncTabPressed() {
      Array.prototype.forEach.call(regionTabs, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-region') === state.region ? 'true' : 'false');
      });
      Array.prototype.forEach.call(orientTabs, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-orient') === state.orient ? 'true' : 'false');
      });
    }

    function switchTo(region, orient) {
      var nextRegion = region || state.region;
      var nextOrient = orient || state.orient;
      var m = manifests[nextRegion];
      if (!m) return;
      // If the requested orientation has no slices for this region, hold the
      // current orient if possible, else pick the first non-empty.
      if (!m[nextOrient] || !m[nextOrient].length) {
        var fallback = ['axi','cor','sag'].find(function (o) { return m[o] && m[o].length; });
        if (!fallback) return;
        nextOrient = fallback;
      }
      state.region = nextRegion;
      state.orient = nextOrient;
      syncTabPressed();
      refreshSliderRange();
    }

    // Wire toggles
    Array.prototype.forEach.call(regionTabs, function (b) {
      b.addEventListener('click', function () { switchTo(b.getAttribute('data-region'), null); });
    });
    Array.prototype.forEach.call(orientTabs, function (b) {
      b.addEventListener('click', function () { switchTo(null, b.getAttribute('data-orient')); });
    });

    // Slider + interaction handlers
    slider.addEventListener('input', function (e) { setSlice(parseInt(e.target.value, 10)); });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var step = Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1);
      setSlice(parseInt(slider.value, 10) + step);
    }, { passive: false });
    var dragging = false, startY = 0, startIdx = 0;
    stage.addEventListener('pointerdown', function (e) {
      dragging = true; startY = e.clientY; startIdx = parseInt(slider.value, 10);
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var delta = Math.round((startY - e.clientY) * 0.5);
      setSlice(startIdx + delta);
    });
    stage.addEventListener('pointerup',     function () { dragging = false; });
    stage.addEventListener('pointercancel', function () { dragging = false; });
    slider.addEventListener('keydown', function (e) {
      var cur = parseInt(slider.value, 10);
      var max = currentFiles().length - 1;
      if (e.key === 'PageUp')   { e.preventDefault(); setSlice(cur + 10); }
      if (e.key === 'PageDown') { e.preventDefault(); setSlice(cur - 10); }
      if (e.key === 'Home')     { e.preventDefault(); setSlice(0); }
      if (e.key === 'End')      { e.preventDefault(); setSlice(max); }
    });

    // Fetch both manifests in parallel
    Promise.all([
      fetch('scans/' + slugByRegion['cervical'] + '-manifest.json').then(function (r) { return r.json(); }),
      fetch('scans/' + slugByRegion['lombar']   + '-manifest.json').then(function (r) { return r.json(); }),
    ]).then(function (results) {
      manifests['cervical'] = results[0];
      manifests['lombar']   = results[1];
      switchTo('cervical', 'axi');
    }).catch(function (err) {
      console.error('Paulo unified MRI manifest load failed', err);
    });
  }

  function buildPauloExamSection(study, idx) {
    var pdfBtn =
      '<a class="export-btn-primary" href="' + study.pdfHref + '" download>' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
          '<polyline points="7 10 12 15 17 10"/>' +
          '<line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg>' +
        t(study.pdfLabelEn, study.pdfLabelPt) +
      '</a>';

    return (
      '<div class="imagery-exam" id="paulo-' + study.slug + '"><div class="container">' +
        '<div class="section-label">' + t(study.labelEn, study.labelPt) + '</div>' +
        '<h2 class="section-title">' + t(study.titleEn, study.titlePt) + '</h2>' +
        '<p class="section-desc">' + t(study.blurbEn, study.blurbPt) + '</p>' +
        '<div class="report-export-row">' + pdfBtn + '</div>' +
        '<div class="ct-grid ct-grid-single">' +
          '<div class="pl-ct-viewer ct-viewer" data-paulo-study="' + study.slug + '">' +
            '<div class="ct-viewer-head">' +
              '<div class="ct-viewer-title">' + t(study.titleEn, study.titlePt) + '</div>' +
              '<div class="pl-view-tabs" role="tablist">' +
                '<button type="button" class="pl-view-tab" data-view="axi" aria-pressed="true">AXI</button>' +
                '<button type="button" class="pl-view-tab" data-view="cor" aria-pressed="false">COR</button>' +
                '<button type="button" class="pl-view-tab" data-view="sag" aria-pressed="false">SAG</button>' +
              '</div>' +
              '<div class="ct-viewer-meta">' +
                t('Slice ', 'Corte ') +
                '<span class="ct-idx">1</span> / <span class="ct-total">1</span>' +
              '</div>' +
            '</div>' +
            '<div class="ct-stage">' +
              '<img class="ct-img" alt="' + escapeHtml(study.titleEn) + '" loading="eager">' +
            '</div>' +
            '<input class="ct-slider" type="range" min="0" max="0" value="0" aria-label="' + escapeHtml(study.titleEn) + ' slice">' +
          '</div>' +
        '</div>' +

        '<h3 style="font-family:\'Raleway\',sans-serif;font-size:20px;font-weight:700;color:var(--blue-800);margin:2.5rem 0 0.75rem;">' +
          t('Radiologist&apos;s report', 'Laudo do radiologista') +
        '</h3>' +

        '<div class="two-col mb-3">' +
          '<div class="list-card">' +
            '<h4>' + t('Identifiers', 'Identificadores') + '</h4>' +
            '<ul class="lang-en">' + study.identsEn.map(pauloLi).join('') + '</ul>' +
            '<ul class="lang-pt">' + study.identsPt.map(pauloLi).join('') + '</ul>' +
          '</div>' +
          '<div class="list-card">' +
            '<h4>' + t('Technique', 'Técnica') + '</h4>' +
            '<ul class="lang-en">' + study.techniqueEn.map(pauloLi).join('') + '</ul>' +
            '<ul class="lang-pt">' + study.techniquePt.map(pauloLi).join('') + '</ul>' +
          '</div>' +
        '</div>' +

        '<div class="list-card mb-3">' +
          '<h4>' + t('Findings', 'Achados') + '</h4>' +
          '<ul class="lang-en">' + study.findingsEn.map(pauloLi).join('') + '</ul>' +
          '<ul class="lang-pt">' + study.findingsPt.map(pauloLi).join('') + '</ul>' +
        '</div>' +

        '<div class="alert alert-warn">' +
          '<span class="lang-en">' + study.conclusionEn + '</span>' +
          '<span class="lang-pt">' + study.conclusionPt + '</span>' +
        '</div>' +
      '</div></div>'
    );
  }

  function wirePauloViewer(viewerEl, study) {
    var manifestUrl = 'scans/' + study.slug + '-manifest.json';
    var img    = viewerEl.querySelector('.ct-img');
    var slider = viewerEl.querySelector('.ct-slider');
    var idxEl  = viewerEl.querySelector('.ct-idx');
    var totEl  = viewerEl.querySelector('.ct-total');
    var stage  = viewerEl.querySelector('.ct-stage');
    var tabs   = viewerEl.querySelectorAll('.pl-view-tab');

    var state = { view: 'axi', files: [], cache: new Map() };
    var manifest = null;
    var PRELOAD = 6;

    function urlFor(i) {
      return 'scans/' + study.slug + '/' + state.view + '/' + state.files[i];
    }

    function setSlice(i) {
      var max = state.files.length - 1;
      if (max < 0) return;
      i = Math.max(0, Math.min(max, i));
      slider.value = i;
      idxEl.textContent = String(i + 1);
      img.src = urlFor(i);
      for (var d = 1; d <= PRELOAD; d++) {
        [i + d, i - d].forEach(function (n) {
          if (n < 0 || n > max) return;
          var key = state.view + ':' + n;
          if (state.cache.has(key)) return;
          var im = new Image();
          im.src = urlFor(n);
          state.cache.set(key, im);
        });
      }
    }

    function switchView(view) {
      if (!manifest || !manifest[view] || manifest[view].length === 0) return;
      state.view = view;
      state.files = manifest[view];
      var max = state.files.length - 1;
      slider.max = String(max);
      totEl.textContent = String(state.files.length);
      Array.prototype.forEach.call(tabs, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
      });
      setSlice(Math.floor(max / 2));
    }

    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener('click', function () {
        switchView(b.getAttribute('data-view'));
      });
    });
    slider.addEventListener('input', function (e) {
      setSlice(parseInt(e.target.value, 10));
    });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var step = Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1);
      setSlice(parseInt(slider.value, 10) + step);
    }, { passive: false });

    var dragging = false, startY = 0, startIdx = 0;
    stage.addEventListener('pointerdown', function (e) {
      dragging = true; startY = e.clientY; startIdx = parseInt(slider.value, 10);
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var delta = Math.round((startY - e.clientY) * 0.5);
      setSlice(startIdx + delta);
    });
    stage.addEventListener('pointerup',     function () { dragging = false; });
    stage.addEventListener('pointercancel', function () { dragging = false; });
    slider.addEventListener('keydown', function (e) {
      var cur = parseInt(slider.value, 10);
      var max = state.files.length - 1;
      if (e.key === 'PageUp')   { e.preventDefault(); setSlice(cur + 10); }
      if (e.key === 'PageDown') { e.preventDefault(); setSlice(cur - 10); }
      if (e.key === 'Home')     { e.preventDefault(); setSlice(0); }
      if (e.key === 'End')      { e.preventDefault(); setSlice(max); }
    });

    fetch(manifestUrl)
      .then(function (r) { return r.json(); })
      .then(function (m) {
        manifest = m;
        // Hide any orientation button whose manifest entry is empty,
        // so future exports with only some sequences degrade gracefully.
        var firstAvailable = null;
        Array.prototype.forEach.call(tabs, function (b) {
          var v = b.getAttribute('data-view');
          if (!m[v] || !m[v].length) {
            b.style.display = 'none';
          } else if (firstAvailable === null) {
            firstAvailable = v;
          }
        });
        switchView(firstAvailable || 'axi');
      })
      .catch(function (err) {
        console.error('Paulo MRI manifest failed', manifestUrl, err);
      });
  }

  /* ── Paulo Silotto · laboratory history ─────────────────────────────
     Reads window.PAULO_LABS (assets/paulo-labs.js): 13 years of blood &
     urine panels reconciled from 26 scanned PDFs. Reuses the generic lab
     helpers (silvanaPanelDetails / silvanaHistoricalComparison /
     silvanaDocsList) — the core .lab-* classes are global in styles.css;
     only the silv-* helper classes need re-scoping under jc-paulo-exams. */
  function injectPauloLabsStyles() {
    if (document.getElementById('paulo-labs-styles')) return;
    var s = document.createElement('style');
    s.id = 'paulo-labs-styles';
    var P = 'main.jc-paulo-exams ';
    s.textContent = [
      P + '.silv-hist { margin-top: 10px; }',
      P + '.silv-hist summary { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.04em; color: #244E6E; cursor: pointer; padding: 6px 8px; background: #F4F1EA; border: 1px solid #E5E2DC; border-radius: 6px; list-style: none; }',
      P + '.silv-hist summary::-webkit-details-marker { display: none; }',
      P + '.silv-hist summary::before { content: "\\25B8"; display: inline-block; width: 12px; margin-right: 4px; transition: transform 0.15s; }',
      P + '.silv-hist[open] summary::before { transform: rotate(90deg); }',
      P + '.silv-hist-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      P + '.silv-hist-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 6px 8px; border-bottom: 1px solid #E5E2DC; }',
      P + '.silv-hist-table td { padding: 6px 8px; border-bottom: 1px solid #EFEBE3; vertical-align: top; color: #1E2D3D; }',
      P + '.silv-hist-row-latest td { background: rgba(184, 149, 74, 0.06); font-weight: 500; }',
      P + '.silv-hist-row-flag .silv-hist-val { color: #7A2E22; }',
      P + '.silv-hist-date { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; white-space: nowrap; }',
      P + '.silv-hist-val { font-family: "IBM Plex Mono", monospace; }',
      P + '.silv-hist-note { font-size: 11px; color: #7A8FA6; }',
      P + '.silv-latest-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',
      P + '.lab-cmp-val[data-flag="high"] { color: #7A2E22; }',
      P + '.lab-cmp-val[data-flag="low"]  { color: #B8862B; }',
      P + '.paulo-labs-panels { margin-top: 8px; }',
      P + '.paulo-labs-docs-head { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; color: #0D1B2A; margin: 28px 0 12px; }',
      P + '.silv-docs { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }',
      P + '.silv-doc-link { display: block; padding: 12px 14px; border: 1px solid #E5E2DC; border-radius: 8px; background: #FFFFFF; color: #0D1B2A; text-decoration: none; transition: border-color 0.12s, transform 0.06s; }',
      P + '.silv-doc-link:hover { border-color: #B8954A; transform: translateY(-1px); }',
      P + '.silv-doc-title { display: block; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 500; margin-bottom: 4px; }',
      P + '.silv-doc-meta { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildPauloLabsAiCard() {
    return (
      '<section class="paulo-ai-summary-wrap">' +
        '<div class="container">' +
          '<div class="paulo-ai-summary">' +
            '<header class="paulo-ai-summary-head">' +
              '<h2>' + t('3 · AI synthesis · Lab history', '3 · Síntese da IA · Histórico laboratorial') + '</h2>' +
              '<span class="ai-pill">AI</span>' +
            '</header>' +
            '<div class="paulo-ai-summary-meta">' +
              t('Synthesised from 26 blood & urine panels · 11+ laboratories · 2011 to 2024',
                'Sintetizado a partir de 26 painéis de sangue e urina · 11+ laboratórios · 2011 a 2024') +
            '</div>' +
            '<div class="paulo-ai-subhead">' +
              t('Most recent draws · April 2024', 'Coletas mais recentes · abril de 2024') +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-en">' +
              '<p>The two April 2024 blood counts tell a short, self-limited story. The <strong>15 Apr (Biolabor) CBC shows transient leukopenia</strong> (WBC 3,190), borderline anaemia and lymphopenia with a reactive monocytosis — set against a <strong>non-reactive dengue NS1 and a negative COVID-19 antigen</strong>, this reads as an acute viral / inflammatory episode, not a chronic cytopenia. The Behring CBC two days earlier (13 Apr) was near-normal, so a single repeat count once recovered would confirm the values have returned to baseline.</p>' +
              '<p>Across thirteen years the durable signal is a <strong>mild cardiometabolic cluster</strong>. <strong>Total cholesterol has sat in the 208–245 mg/dL band on virtually every panel since 2011</strong>, with LDL repeatedly above the 130 mg/dL target (138 mg/dL in 2022) — partly offset by a protective HDL (frequently 60–90 mg/dL). In parallel, <strong>fasting glucose has drifted into the impaired-fasting band (100–115 mg/dL)</strong> from 2017 onward while HbA1c stays sub-diabetic (5.5–5.6%) — a prediabetic trajectory tracking the lipid pattern. <strong>Vitamin D was insufficient</strong> (16.4 ng/mL, 2022).</p>' +
              '<p><strong>Reassuring elsewhere, and consistently so:</strong> renal function (creatinine ~0.9–1.1 mg/dL, eGFR &gt; 60), liver enzymes (AST/ALT/GGT) and thyroid (TSH 2–3 µUI/mL) have stayed in range throughout, and <strong>total PSA has remained under the 4 ng/mL threshold</strong> across the surveillance series. <strong>Recommended next step:</strong> a repeat fasting glucose + HbA1c and a lipid-focused review of the borderline-LDL / impaired-fasting / low-vitamin-D triad, plus one follow-up CBC to confirm the April-2024 viral dip has resolved. Read alongside the spine imaging, the modifiable lever is the same one: cardiometabolic and muscular conditioning.</p>' +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-pt">' +
              '<p>Os dois hemogramas de abril de 2024 contam uma história curta e autolimitada. O <strong>hemograma de 15 abr (Biolabor) mostra leucopenia transitória</strong> (leucócitos 3.190), anemia limítrofe e linfopenia com monocitose reativa — diante de um <strong>dengue NS1 não reagente e antígeno COVID-19 negativo</strong>, lê-se como episódio viral / inflamatório agudo, não uma citopenia crônica. O hemograma da Behring dois dias antes (13 abr) estava quase normal, então um único hemograma de controle após a recuperação confirmaria o retorno aos valores de base.</p>' +
              '<p>Ao longo de treze anos, o sinal persistente é um <strong>leve agrupamento cardiometabólico</strong>. O <strong>colesterol total se mantém na faixa de 208–245 mg/dL em praticamente todos os painéis desde 2011</strong>, com LDL repetidamente acima da meta de 130 mg/dL (138 mg/dL em 2022) — parcialmente compensado por um HDL protetor (frequentemente 60–90 mg/dL). Em paralelo, a <strong>glicemia de jejum derivou para a faixa de glicemia de jejum alterada (100–115 mg/dL)</strong> a partir de 2017, enquanto a HbA1c permanece sub-diabética (5,5–5,6%) — uma trajetória pré-diabética que acompanha o padrão lipídico. A <strong>vitamina D estava insuficiente</strong> (16,4 ng/mL, 2022).</p>' +
              '<p><strong>Tranquilizador no restante, e de forma consistente:</strong> função renal (creatinina ~0,9–1,1 mg/dL, eTFG &gt; 60), enzimas hepáticas (TGO/TGP/GGT) e tireoide (TSH 2–3 µUI/mL) permaneceram dentro da faixa ao longo do tempo, e o <strong>PSA total se manteve abaixo do limite de 4 ng/mL</strong> em toda a série de acompanhamento. <strong>Próximo passo recomendado:</strong> repetir glicemia de jejum + HbA1c e uma revisão lipídica do tripé LDL-limítrofe / glicemia-de-jejum-alterada / vitamina-D-baixa, além de um hemograma de controle para confirmar a resolução da queda viral de abril de 2024. Lido junto às imagens da coluna, a alavanca modificável é a mesma: condicionamento cardiometabólico e muscular.</p>' +
            '</div>' +
            '<p class="paulo-ai-arcs-cross" style="margin-top:14px;">' +
              '<span class="lang-en"><em>AI-generated synthesis over Paulo&apos;s own lab series — for discussion with his clinician, not a diagnosis.</em></span>' +
              '<span class="lang-pt"><em>Síntese gerada por IA sobre a própria série de exames do Paulo — para discussão com o médico, não um diagnóstico.</em></span>' +
            '</p>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /* ── Paulo Silotto · bespoke Mental page — REFLECTIVE PORTRAIT ───────
     NOT a clinical record. A reflective self-knowledge surface assembled
     from reflective_items (migration 0017) via /api/reflective: the son's
     attributed account (source=other) plus a bounded AI synthesis
     (ai_synthesis), organised on a Johari spine. No diagnosis, no symptoms,
     no risk flags. Every third-party + AI item carries a provenance chip and
     a right-to-respond control (POST /api/reflective-respond). The verbatim
     source account (window.PAULO_MENTAL_NARRATIVE) stays available as a
     collapsed disclosure at the foot of the page. */
  function injectPauloMentalStyles() {
    if (document.getElementById('paulo-mental-styles')) return;
    var css = [
      'main.jc-paulo-mental { display: block; background: #F9F7F4; padding: 0 0 64px; }',
      'main.jc-paulo-mental .hero { background: #0A1428; color: #fff; padding: 46px 0 50px; }',
      'main.jc-paulo-mental .hero .container { max-width: 1000px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-paulo-mental .hero-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(244,185,66,0.9); margin-bottom: 10px; }',
      'main.jc-paulo-mental .hero-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 34px; line-height: 1.12; margin: 0 0 10px; }',
      'main.jc-paulo-mental .hero-sub { color: rgba(255,255,255,0.82); font-size: 16px; line-height: 1.6; margin: 0; max-width: 60ch; }',
      'main.jc-paulo-mental .rp-wrap { max-width: 1000px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-paulo-mental .rp-frame { margin: 22px auto 0; }',
      'main.jc-paulo-mental .rp-frame-inner { background: #fff; border: 1px solid #ECE7DD; border-left: 3px solid #F4B942; border-radius: 10px; padding: 15px 19px; font-family: "Mulish", sans-serif; font-size: 14px; line-height: 1.6; color: #3A4654; }',
      'main.jc-paulo-mental .rp-section { margin: 40px auto 0; }',
      'main.jc-paulo-mental .rp-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6BA3C7; margin-bottom: 6px; }',
      'main.jc-paulo-mental .rp-h { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 21px; color: #0A1428; margin: 0 0 4px; }',
      'main.jc-paulo-mental .rp-sub { font-family: "Mulish", sans-serif; font-size: 14px; color: #5A6675; margin: 0 0 18px; line-height: 1.55; }',
      'main.jc-paulo-mental .rp-johari { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }',
      '@media (max-width: 680px) { main.jc-paulo-mental .rp-johari { grid-template-columns: 1fr; } }',
      'main.jc-paulo-mental .rp-jcell { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; padding: 16px 18px; }',
      'main.jc-paulo-mental .rp-jcell.is-empty { background: #F6F4EF; border-style: dashed; }',
      'main.jc-paulo-mental .rp-jhead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 6px; }',
      'main.jc-paulo-mental .rp-jtitle { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; color: #0A1428; }',
      'main.jc-paulo-mental .rp-jcount { font-family: "IBM Plex Mono", monospace; font-size: 18px; font-weight: 600; color: #244E6E; }',
      'main.jc-paulo-mental .rp-jcell.is-empty .rp-jcount { color: #B6AD98; }',
      'main.jc-paulo-mental .rp-jdesc { font-family: "Mulish", sans-serif; font-size: 13px; line-height: 1.5; color: #5A6675; margin: 0; }',
      'main.jc-paulo-mental .rp-cards { display: flex; flex-direction: column; gap: 14px; }',
      'main.jc-paulo-mental .rp-card { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; padding: 16px 18px; }',
      'main.jc-paulo-mental .rp-card.rp-card-warm { border-left: 3px solid #F4B942; }',
      'main.jc-paulo-mental .rp-card.rp-card-care { border-left: 3px solid #6BA3C7; background: #FBFAF7; }',
      'main.jc-paulo-mental .rp-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; flex-wrap: wrap; }',
      'main.jc-paulo-mental .rp-body { font-family: "Mulish", sans-serif; font-size: 15.5px; line-height: 1.62; color: #24323F; margin: 0; }',
      'main.jc-paulo-mental .rp-evidence { font-family: "Mulish", sans-serif; font-size: 13px; font-style: italic; color: #7A8694; margin: 10px 0 0; padding-left: 10px; border-left: 2px solid #E2DCCF; }',
      'main.jc-paulo-mental .rp-chip { display: inline-flex; align-items: center; gap: 5px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid transparent; }',
      'main.jc-paulo-mental .rp-chip-other { background: #EAF2F7; color: #244E6E; border-color: #CFE0EB; }',
      'main.jc-paulo-mental .rp-chip-self { background: #FCF3DC; color: #8A6A18; border-color: #F4DD9C; }',
      'main.jc-paulo-mental .rp-chip-ai { background: #FDF8EC; color: #6B4FA0; border-color: #F4DD9C; }',
      'main.jc-paulo-mental .ai-pill { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; background: #6B4FA0; color: #fff; padding: 1px 5px; border-radius: 4px; }',
      'main.jc-paulo-mental .rp-respond { margin-top: 14px; padding-top: 12px; border-top: 1px dashed #E7E2D8; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      'main.jc-paulo-mental .rp-respond-q { font-family: "Mulish", sans-serif; font-size: 12.5px; color: #7A8694; margin-right: 2px; }',
      'main.jc-paulo-mental .rp-btn { font-family: "Mulish", sans-serif; font-size: 13px; color: #244E6E; background: #fff; border: 1px solid #CFD8DF; border-radius: 999px; padding: 5px 12px; cursor: pointer; transition: all 0.12s; }',
      'main.jc-paulo-mental .rp-btn:hover { border-color: #6BA3C7; }',
      'main.jc-paulo-mental .rp-btn.is-active { background: #244E6E; color: #fff; border-color: #244E6E; }',
      'main.jc-paulo-mental .rp-note-box { flex-basis: 100%; margin-top: 8px; display: flex; gap: 8px; }',
      'main.jc-paulo-mental .rp-note-input { flex: 1; font-family: "Mulish", sans-serif; font-size: 14px; padding: 8px 10px; border: 1px solid #CFD8DF; border-radius: 8px; resize: vertical; min-height: 56px; }',
      'main.jc-paulo-mental .rp-note-save { align-self: flex-start; font-family: "Mulish", sans-serif; font-size: 13px; background: #F4B942; color: #0A1428; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }',
      'main.jc-paulo-mental .rp-status { flex-basis: 100%; font-family: "Mulish", sans-serif; font-size: 12px; color: #3E7D5A; margin-top: 4px; min-height: 14px; }',
      'main.jc-paulo-mental .rp-support { margin-top: 12px; background: #EAF2F7; border: 1px solid #CFE0EB; border-radius: 8px; padding: 10px 12px; font-family: "Mulish", sans-serif; font-size: 13px; line-height: 1.55; color: #244E6E; }',
      'main.jc-paulo-mental details.rp-collapse { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; margin-top: 14px; overflow: hidden; }',
      'main.jc-paulo-mental details.rp-collapse > summary { list-style: none; cursor: pointer; padding: 14px 18px; display: flex; align-items: center; gap: 8px; font-family: "Raleway", sans-serif; font-weight: 600; font-size: 15px; color: #0A1428; }',
      'main.jc-paulo-mental details.rp-collapse > summary::-webkit-details-marker { display: none; }',
      'main.jc-paulo-mental details.rp-collapse[open] > summary { border-bottom: 1px solid #EFEADF; }',
      'main.jc-paulo-mental .rp-collapse-body { padding: 8px 18px 18px; }',
      'main.jc-paulo-mental .rp-dismiss { margin-left: auto; font-family: "Mulish", sans-serif; font-size: 12px; color: #9AA4B0; background: none; border: none; cursor: pointer; }',
      'main.jc-paulo-mental .rp-reading { display: flex; flex-direction: column; gap: 12px; }',
      'main.jc-paulo-mental .rp-q { background: #fff; border: 1px solid #E7E2D8; border-left: 3px solid #6BA3C7; border-radius: 10px; padding: 14px 18px; font-family: "Mulish", sans-serif; font-size: 16px; line-height: 1.55; color: #24323F; }',
      'main.jc-paulo-mental .rp-pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }',
      '@media (max-width: 680px) { main.jc-paulo-mental .rp-pillars { grid-template-columns: 1fr; } }',
      'main.jc-paulo-mental .rp-pillar { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; padding: 16px 18px; }',
      'main.jc-paulo-mental .rp-pillar.is-tbd { background: #F6F4EF; }',
      'main.jc-paulo-mental .rp-pillar-label { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6BA3C7; margin-bottom: 6px; }',
      'main.jc-paulo-mental .rp-pillar.is-tbd .rp-pillar-label { color: #B6AD98; }',
      'main.jc-paulo-mental .rp-pillar-body { font-family: "Mulish", sans-serif; font-size: 14px; line-height: 1.55; color: #3A4654; margin: 0; }',
      'main.jc-paulo-mental .rp-cta { margin: 40px auto 0; }',
      'main.jc-paulo-mental .rp-cta-inner { background: #0A1428; color: #fff; border-radius: 12px; padding: 26px 28px; }',
      'main.jc-paulo-mental .rp-cta-h { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 19px; margin: 0 0 8px; }',
      'main.jc-paulo-mental .rp-cta-p { font-family: "Mulish", sans-serif; font-size: 14.5px; line-height: 1.6; color: rgba(255,255,255,0.85); margin: 0; }',
      'main.jc-paulo-mental .rp-loading { margin: 40px auto; font-family: "Mulish", sans-serif; color: #7A8694; }',
      'main.jc-paulo-mental .pm-transcript p { font-family: "Mulish", sans-serif; font-size: 15px; line-height: 1.7; color: #34414E; margin: 0 0 16px; }'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'paulo-mental-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function renderPauloMental() {
    injectPauloMentalStyles();
    document.title = 'Lumen Health — Mental · Reflective portrait · Paulo Silotto Souza';

    function heroHtml() {
      return '<section class="hero"><div class="container">' +
        '<div class="hero-eyebrow">' + t('Reflective Portrait · 19 June 2026', 'Retrato Reflexivo · 19 de junho de 2026') + '</div>' +
        '<h1 class="hero-title">' + t('Paulo Silotto Souza', 'Paulo Silotto Souza') + '</h1>' +
        '<p class="hero-sub">' + t('Drawn from your own words and the people who know you.',
                                   'A partir das suas próprias palavras e das pessoas que conhecem você.') + '</p>' +
        '</div></section>';
    }

    function confPt(c) { return c === 'high' ? 'alta' : c === 'medium' ? 'média' : c === 'low' ? 'baixa' : c; }
    function firstName(it) {
      var nm = (it.source_meta && it.source_meta.author_name) || '';
      return nm.split(' ')[0] || t('someone close', 'alguém próximo');
    }
    function provChip(it) {
      if (it.source === 'self')
        return '<span class="rp-chip rp-chip-self"><span class="lang-en">From your words</span><span class="lang-pt">Das suas palavras</span></span>';
      if (it.source === 'ai_synthesis') {
        var c = (it.source_meta && it.source_meta.confidence) || '';
        return '<span class="rp-chip rp-chip-ai"><span class="ai-pill">AI</span>' +
          '<span class="lang-en">AI synthesis' + (c ? ' · ' + c + ' confidence' : '') + '</span>' +
          '<span class="lang-pt">Síntese de IA' + (c ? ' · confiança ' + confPt(c) : '') + '</span></span>';
      }
      var nm = escapeHtml(firstName(it));
      return '<span class="rp-chip rp-chip-other"><span class="lang-en">From ' + nm + '’s account</span>' +
        '<span class="lang-pt">Do relato de ' + nm + '</span></span>';
    }
    function statusLabel(react) {
      if (react === 'resonates') return t('You marked this as resonating.', 'Você marcou que isto faz sentido.');
      if (react === 'doesnt')    return t('You marked this as not fitting.', 'Você marcou que isto não combina.');
      if (react === 'note')      return t('Your note is saved.', 'Sua nota está salva.');
      return '';
    }
    function respondHtml(it) {
      var react = it.response_reaction || '';
      var noteVal = it.response_note || '';
      function btn(key, en, pt) {
        return '<button type="button" class="rp-btn' + (react === key ? ' is-active' : '') + '" data-react="' + key + '">' +
          '<span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span></button>';
      }
      return '<div class="rp-respond" data-item="' + escapeHtml(it.id) + '">' +
        '<span class="rp-respond-q"><span class="lang-en">Does this land?</span><span class="lang-pt">Isto faz sentido?</span></span>' +
        btn('resonates', 'Resonates', 'Faz sentido') +
        btn('doesnt', 'Doesn’t fit', 'Não combina') +
        btn('note', 'Add a note', 'Anotar') +
        '<div class="rp-note-box"' + (noteVal ? '' : ' hidden') + '>' +
          '<textarea class="rp-note-input" placeholder="' + t('In your own words…', 'Com suas palavras…') + '">' + escapeHtml(noteVal) + '</textarea>' +
          '<button type="button" class="rp-note-save">' + t('Save', 'Salvar') + '</button>' +
        '</div>' +
        '<div class="rp-status">' + (react ? statusLabel(react) : '') + '</div>' +
      '</div>';
    }
    function supportNote() {
      return '<div class="rp-support">' +
        '<span class="lang-en"><strong>A gentle note.</strong> If this resonates, you don’t have to carry it alone — talking with a doctor, a counsellor, or someone you trust can help. In Brazil, CVV offers free, confidential emotional support any time at <strong>188</strong> (cvv.org.br).</span>' +
        '<span class="lang-pt"><strong>Uma nota cuidadosa.</strong> Se isto faz sentido, você não precisa carregar sozinho — conversar com um médico, um psicólogo ou alguém de confiança pode ajudar. No Brasil, o CVV oferece apoio emocional gratuito e sigiloso a qualquer hora pelo <strong>188</strong> (cvv.org.br).</span>' +
      '</div>';
    }
    function cardHtml(it, canRespond, extraClass) {
      var support = (it.item_key === 'ge-heavy-weight');
      var cls = 'rp-card' + (extraClass ? ' ' + extraClass : '') + (support ? ' rp-card-care' : '');
      var h = '<div class="' + cls + '">' +
        '<div class="rp-card-top">' + provChip(it) + '</div>' +
        '<p class="rp-body"><span class="lang-en">' + escapeHtml(it.content_en) + '</span>' +
          '<span class="lang-pt">' + escapeHtml(it.content_pt) + '</span></p>';
      if (it.evidence)
        h += '<p class="rp-evidence"><span class="lang-en">“' + escapeHtml(it.evidence) + '” — ' + escapeHtml(firstName(it)) + '</span>' +
             '<span class="lang-pt">“' + escapeHtml(it.evidence) + '” — ' + escapeHtml(firstName(it)) + '</span></p>';
      if (support) h += supportNote();
      if (canRespond) h += respondHtml(it);
      h += '</div>';
      return h;
    }
    function block(eyebrowEn, eyebrowPt, hEn, hPt, subEn, subPt, inner) {
      return '<section class="rp-section rp-wrap">' +
        '<div class="rp-eyebrow"><span class="lang-en">' + eyebrowEn + '</span><span class="lang-pt">' + eyebrowPt + '</span></div>' +
        '<h2 class="rp-h"><span class="lang-en">' + hEn + '</span><span class="lang-pt">' + hPt + '</span></h2>' +
        (subEn ? '<p class="rp-sub"><span class="lang-en">' + subEn + '</span><span class="lang-pt">' + subPt + '</span></p>' : '') +
        inner + '</section>';
    }
    function blockCards(items, eyebrowEn, eyebrowPt, hEn, hPt, subEn, subPt, canRespond, cardClass) {
      if (!items || !items.length) return '';
      var inner = '<div class="rp-cards">' + items.map(function (it) { return cardHtml(it, canRespond, cardClass); }).join('') + '</div>';
      return block(eyebrowEn, eyebrowPt, hEn, hPt, subEn, subPt, inner);
    }

    function johariHtml(items) {
      var q = { open: 0, blind: 0, hidden: 0, emerging: 0 };
      items.forEach(function (it) { if (q[it.quadrant] != null) q[it.quadrant]++; });
      function cell(key, titleEn, titlePt, descEn, descPt) {
        var n = q[key]; var empty = n === 0;
        return '<div class="rp-jcell' + (empty ? ' is-empty' : '') + '">' +
          '<div class="rp-jhead"><span class="rp-jtitle"><span class="lang-en">' + titleEn + '</span><span class="lang-pt">' + titlePt + '</span></span>' +
          '<span class="rp-jcount">' + n + '</span></div>' +
          '<p class="rp-jdesc"><span class="lang-en">' + descEn + '</span><span class="lang-pt">' + descPt + '</span></p></div>';
      }
      var grid = '<div class="rp-johari">' +
        cell('open', 'Open', 'Aberto',
          'Things both you and the people close to you see. Empty for now — it fills in when you add your own words.',
          'Coisas que tanto você quanto as pessoas próximas enxergam. Vazio por ora — preenche quando você acrescenta suas palavras.') +
        cell('blind', 'What others notice', 'O que os outros percebem',
          'Things someone close to you sees that you might not have named yourself.',
          'Coisas que alguém próximo vê e que você talvez ainda não tenha nomeado.') +
        cell('hidden', 'What only you know', 'O que só você sabe',
          'Things you know about yourself that others may not see yet. This is yours to add.',
          'Coisas que você sabe sobre si e que os outros talvez ainda não vejam. Este espaço é seu para preencher.') +
        cell('emerging', 'Emerging', 'Emergente',
          'Patterns an AI reading proposes — starting points, not conclusions.',
          'Padrões que uma leitura de IA propõe — pontos de partida, não conclusões.') +
        '</div>';
      return block('The shape of this portrait', 'O formato deste retrato',
        'Four windows', 'Quatro janelas',
        'A simple map of where this portrait stands today. Most of it sits in what others notice, because your own voice isn’t here yet — and that is the one thing only you can add.',
        'Um mapa simples de onde este retrato está hoje. A maior parte está no que os outros percebem, porque a sua própria voz ainda não está aqui — e isso é o que só você pode acrescentar.',
        grid);
    }

    function themesHtml(items, canRespond) {
      if (!items || !items.length) return '';
      var cards = '<div class="rp-cards">' + items.map(function (it) { return cardHtml(it, canRespond, ''); }).join('') + '</div>';
      var inner = '<details class="rp-collapse"><summary><span class="ai-pill">AI</span>' +
        '<span class="lang-en">Recurring themes — tap to open</span><span class="lang-pt">Temas recorrentes — toque para abrir</span></summary>' +
        '<div class="rp-collapse-body">' +
          '<p class="rp-sub"><span class="lang-en">Patterns an AI reading drew across the account. Starting points for reflection, not conclusions.</span>' +
          '<span class="lang-pt">Padrões que uma leitura de IA traçou ao longo do relato. Pontos de partida para reflexão, não conclusões.</span></p>' +
          cards +
        '</div></details>';
      return block('Patterns', 'Padrões', 'Recurring themes', 'Temas recorrentes', '', '', inner);
    }

    function jungianHtml(items) {
      if (!items || !items.length) return '';
      var it = items[0];
      var inner = '<details class="rp-collapse" id="rp-jung"><summary><span class="ai-pill">AI</span>' +
        '<span class="lang-en">A Jungian lens — one way to read this</span><span class="lang-pt">Uma lente junguiana — uma forma de ler isto</span>' +
        '<button type="button" class="rp-dismiss" data-dismiss="rp-jung"><span class="lang-en">dismiss</span><span class="lang-pt">dispensar</span></button></summary>' +
        '<div class="rp-collapse-body">' +
          '<div class="rp-card-top">' + provChip(it) + '</div>' +
          '<p class="rp-body"><span class="lang-en">' + escapeHtml(it.content_en) + '</span><span class="lang-pt">' + escapeHtml(it.content_pt) + '</span></p>' +
        '</div></details>';
      return block('A lens, not a result', 'Uma lente, não um resultado', 'A Jungian lens', 'Uma lente junguiana', '', '', inner);
    }

    function readingHtml(items) {
      if (!items || !items.length) return '';
      var cards = '<div class="rp-reading">' + items.map(function (it) {
        return '<div class="rp-card"><div class="rp-card-top">' + provChip(it) + '</div>' +
          '<p class="rp-body"><span class="lang-en">' + escapeHtml(it.content_en) + '</span><span class="lang-pt">' + escapeHtml(it.content_pt) + '</span></p></div>';
      }).join('') + '</div>';
      return block('Out of curiosity', 'Por curiosidade', 'Recommended reading', 'Leituras sugeridas',
        'A few books, offered as curiosity — not prescription. Each is tied to a theme above.',
        'Alguns livros, oferecidos por curiosidade — não por prescrição. Cada um ligado a um tema acima.', cards);
    }

    function questionsHtml(items) {
      if (!items || !items.length) return '';
      var qs = '<div class="rp-reading">' + items.map(function (it) {
        return '<div class="rp-q"><span class="lang-en">' + escapeHtml(it.content_en) + '</span><span class="lang-pt">' + escapeHtml(it.content_pt) + '</span></div>';
      }).join('') + '</div>';
      return block('To sit with', 'Para refletir', 'Questions worth sitting with', 'Perguntas para sentar com elas',
        'Drawn from the tensions in the account — there are no right answers.',
        'Tiradas das tensões do relato — não há respostas certas.', qs);
    }

    function pillarsHtml() {
      var inner = '<div class="rp-pillars">' +
        '<div class="rp-pillar is-tbd"><div class="rp-pillar-label">' + t('Physical', 'Físico') + '</div>' +
          '<p class="rp-pillar-body"><span class="lang-en">Imaging, labs and stress tests live in the Physical section.</span><span class="lang-pt">Imagens, exames e testes de esforço ficam na seção Físico.</span></p></div>' +
        '<div class="rp-pillar"><div class="rp-pillar-label">' + t('Mental', 'Mental') + '</div>' +
          '<p class="rp-pillar-body"><span class="lang-en">This reflective portrait — assembled from one account and an AI reading. It grows as you add your own words.</span><span class="lang-pt">Este retrato reflexivo — montado a partir de um relato e de uma leitura de IA. Ele cresce conforme você adiciona suas próprias palavras.</span></p></div>' +
        '<div class="rp-pillar is-tbd"><div class="rp-pillar-label">' + t('Spiritual', 'Espiritual') + '</div>' +
          '<p class="rp-pillar-body"><span class="lang-en">To be defined — no values-of-life data captured yet.</span><span class="lang-pt">A definir — ainda sem dados de valores de vida.</span></p></div>' +
        '</div>';
      return block('Three pillars', 'Três pilares', 'Physical · Mental · Spiritual', 'Físico · Mental · Espiritual', '', '', inner);
    }

    function sourceDisclosureHtml() {
      var N = window.PAULO_MENTAL_NARRATIVE;
      var paras = (N && N.account && N.account.paragraphs) || [];
      if (!paras.length) return '';
      var body = paras.map(function (p) { return '<p>' + escapeHtml(p) + '</p>'; }).join('');
      var inner = '<details class="rp-collapse"><summary>' +
        '<span class="rp-chip rp-chip-other"><span class="lang-en">From João’s account</span><span class="lang-pt">Do relato de João</span></span>' +
        '<span class="lang-en">The full account, in his own words</span><span class="lang-pt">O relato completo, nas palavras dele</span></summary>' +
        '<div class="rp-collapse-body"><p class="rp-sub"><span class="lang-en">Recorded 19 June 2026 in English, reproduced verbatim. This is the source the portrait above was drawn from.</span>' +
        '<span class="lang-pt">Gravado em 19 de junho de 2026 em inglês, reproduzido na íntegra. Esta é a fonte de onde o retrato acima foi extraído.</span></p>' +
        '<div class="pm-transcript">' + body + '</div></div></details>';
      return block('The source', 'A fonte', 'Where this came from', 'De onde isto veio', '', '', inner);
    }

    function ctaHtml() {
      return '<section class="rp-cta rp-wrap"><div class="rp-cta-inner">' +
        '<h3 class="rp-cta-h"><span class="lang-en">This portrait grows with you</span><span class="lang-pt">Este retrato cresce com você</span></h3>' +
        '<p class="rp-cta-p"><span class="lang-en">Right now it is built from one loving but partial view. Add a few lines of your own — a diary entry, a memory, what a good day feels like — and the empty windows above begin to fill. The people you trust can add their view too. You own all of it, and you can respond to or remove anything here.</span>' +
        '<span class="lang-pt">Por enquanto ele é feito de uma visão amorosa, porém parcial. Acrescente algumas linhas suas — uma página de diário, uma lembrança, como é um bom dia — e as janelas vazias acima começam a se preencher. As pessoas em quem você confia também podem somar a visão delas. Tudo isto é seu, e você pode responder ou remover qualquer coisa aqui.</span></p>' +
        '</div></section>';
    }

    function buildPortrait(data) {
      var items = data.items || [];
      var canRespond = !!data.can_respond;
      var byCat = {};
      items.forEach(function (it) { (byCat[it.category] = byCat[it.category] || []).push(it); });
      return '<section class="rp-frame rp-wrap"><div class="rp-frame-inner">' +
          '<span class="lang-en"><strong>A reflective portrait, not a diagnosis.</strong> Nothing here is a clinical finding. It is a mirror assembled from your own words and the people who know you — and it is yours. You can respond to anything, or ask for it to be removed.</span>' +
          '<span class="lang-pt"><strong>Um retrato reflexivo, não um diagnóstico.</strong> Nada aqui é um achado clínico. É um espelho montado a partir das suas palavras e das pessoas que conhecem você — e é seu. Você pode responder a qualquer coisa, ou pedir que seja removida.</span>' +
        '</div></section>' +
        johariHtml(items) +
        blockCards(byCat.strength, 'They see this in you', 'Eles veem isto em você',
          'Strengths others see in you', 'Forças que os outros veem em você',
          'What João — who has known you his whole life — sees in you.',
          'O que João — que conhece você a vida toda — vê em você.', canRespond, 'rp-card-warm') +
        blockCards(byCat.growth_edge, 'A perspective', 'Uma perspectiva',
          'Growth edges', 'Pontos de crescimento',
          'Patterns João noticed — offered as perspective, never a verdict. Push back on anything that doesn’t fit.',
          'Padrões que João percebeu — oferecidos como perspectiva, nunca como veredito. Conteste o que não combinar.', canRespond, '') +
        blockCards(byCat.value, 'What you live by', 'O que você vive',
          'What matters to you', 'O que importa para você',
          'What João sees you living by, day to day.',
          'Aquilo que João vê você vivendo, no dia a dia.', canRespond, 'rp-card-warm') +
        themesHtml(byCat.theme, canRespond) +
        jungianHtml(byCat.jungian) +
        readingHtml(byCat.recommendation) +
        questionsHtml(byCat.question) +
        pillarsHtml() +
        sourceDisclosureHtml() +
        ctaHtml();
    }

    function setActive(btns, target) {
      btns.forEach(function (b) { b.classList.remove('is-active'); });
      if (target) target.classList.add('is-active');
    }
    function postResponse(itemId, react, note, statusEl) {
      statusEl.textContent = t('Saving…', 'Salvando…');
      fetch('/api/reflective-respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerkHeader() },
        body: JSON.stringify({ patient_clerk: patient, item_id: itemId, reaction: react, note: note })
      })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function () { statusEl.textContent = statusLabel(react) + ' ' + t('Thank you.', 'Obrigado.'); })
        .catch(function () { statusEl.textContent = t('Could not save — please try again.', 'Não foi possível salvar — tente novamente.'); });
    }
    function wireResponders(root) {
      var groups = root.querySelectorAll('.rp-respond');
      Array.prototype.forEach.call(groups, function (g) {
        var itemId = g.getAttribute('data-item');
        var statusEl = g.querySelector('.rp-status');
        var noteBox = g.querySelector('.rp-note-box');
        var reactBtns = g.querySelectorAll('.rp-btn');
        Array.prototype.forEach.call(reactBtns, function (b) {
          b.addEventListener('click', function () {
            var react = b.getAttribute('data-react');
            if (react === 'note') { noteBox.hidden = !noteBox.hidden; return; }
            setActive(reactBtns, b);
            postResponse(itemId, react, null, statusEl);
          });
        });
        var saveBtn = g.querySelector('.rp-note-save');
        if (saveBtn) saveBtn.addEventListener('click', function () {
          var ta = g.querySelector('.rp-note-input');
          setActive(reactBtns, g.querySelector('.rp-btn[data-react="note"]'));
          postResponse(itemId, 'note', ta.value, statusEl);
        });
      });
      var dismissers = root.querySelectorAll('.rp-dismiss');
      Array.prototype.forEach.call(dismissers, function (d) {
        d.addEventListener('click', function (e) {
          e.preventDefault();
          var el = document.getElementById(d.getAttribute('data-dismiss'));
          if (el) el.style.display = 'none';
        });
      });
    }

    var main = document.createElement('main');
    main.className = 'jc-paulo-mental';
    main.innerHTML = heroHtml() +
      '<div class="rp-loading rp-wrap"><span class="lang-en">Assembling the portrait…</span><span class="lang-pt">Montando o retrato…</span></div>';
    document.body.appendChild(main);

    fetch('/api/reflective?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        main.innerHTML = heroHtml() + buildPortrait(data);
        wireResponders(main);
        injectDangerZone(main);
      })
      .catch(function () {
        main.innerHTML = heroHtml() +
          '<div class="rp-loading rp-wrap"><span class="lang-en">This portrait could not be loaded right now.</span><span class="lang-pt">Não foi possível carregar este retrato agora.</span></div>';
        injectDangerZone(main);
      });
  }

  function renderPauloLabsSection() {
    var L = window.PAULO_LABS;
    if (!L || !L.panels || !L.panels.length) return '';
    injectPauloLabsStyles();
    var nMarkers = L.panels.reduce(function (a, p) { return a + p.markers.length; }, 0);

    var head =
      '<div class="container">' +
        '<div class="section-label">' + t('3 · Laboratory', '3 · Laboratorial') + '</div>' +
        '<h2 class="section-title">' + t('Laboratory exams', 'Exames laboratoriais') + '</h2>' +
        '<p class="section-desc">' +
          t('Thirteen years of blood and urine work (2011-2024), reconciled from 26 scanned reports across 11+ laboratories into ' + nMarkers + ' markers grouped by panel. Each card shows the latest value with its reference bar and an expandable per-marker history; the full side-by-side comparison sits at the bottom, most recent at left. Original reports are linked beneath.',
            'Treze anos de exames de sangue e urina (2011-2024), reconciliados de 26 laudos digitalizados de 11+ laboratórios em ' + nMarkers + ' marcadores agrupados por painel. Cada cartão mostra o valor mais recente com sua barra de referência e um histórico por marcador expansível; a comparação completa lado a lado fica ao final, mais recente à esquerda. Os laudos originais estão linkados abaixo.') +
        '</p>' +
      '</div>';

    var panelsHtml = L.panels.map(silvanaPanelDetails).join('');
    var comparison = silvanaHistoricalComparison(L.panels, L.documents);
    var docsHead =
      '<div class="paulo-labs-docs-head">' +
        t('Source reports', 'Laudos de origem') + ' · ' + L.documents.length +
      '</div>';
    var docsHtml = silvanaDocsList(L.documents);

    return (
      buildPauloLabsAiCard() +
      '<section class="report-section" id="labs">' +
        head +
        '<div class="container paulo-labs-panels">' +
          '<div class="lab-panel-grid">' + panelsHtml + '</div>' +
          comparison +
          docsHead +
          docsHtml +
        '</div>' +
      '</section>'
    );
  }

  /* ── Paulo Silotto · ergometric (exercise stress test) series ─────────
     Reads window.PAULO_ERGOMETRIC (assets/paulo-ergometric.js): 4 stress
     tests 2011 -> 2023 reconciled from scanned reports. Renders a gold AI
     card (reusing .paulo-ai-summary), the latest-exam highlight, and two
     collapsibles (comparison table + per-exam detail). */
  function injectPauloErgoStyles() {
    if (document.getElementById('paulo-ergo-styles')) return;
    var s = document.createElement('style');
    s.id = 'paulo-ergo-styles';
    var P = 'main.jc-paulo-exams ';
    s.textContent = [
      P + '.pl-ergo-latest { background: #FFFFFF; border: 1px solid #E5E2DC; border-left: 3px solid #244E6E; border-radius: 10px; padding: 20px 22px; margin-top: 8px; }',
      P + '.pl-ergo-latest-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 4px; }',
      P + '.pl-ergo-latest-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 17px; color: #0D1B2A; margin: 0; }',
      P + '.pl-ergo-latest-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; letter-spacing: 0.04em; }',
      P + '.pl-ergo-badge { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; }',
      P + '.pl-ergo-badge.is-neg { background: rgba(45, 122, 78, 0.12); color: #1F6E45; }',
      P + '.pl-ergo-badge.is-max { background: rgba(36, 78, 110, 0.10); color: #244E6E; }',
      P + '.pl-ergo-concl { font-size: 14px; line-height: 1.55; color: #1E2D3D; margin: 8px 0 16px; }',
      P + '.pl-ergo-chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }',
      P + '.pl-ergo-chip { background: #F4F1EA; border: 1px solid #E5E2DC; border-radius: 8px; padding: 9px 11px; }',
      P + '.pl-ergo-chip-k { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 3px; }',
      P + '.pl-ergo-chip-v { display: block; font-family: "IBM Plex Sans", sans-serif; font-size: 15px; font-weight: 600; color: #0D1B2A; }',
      P + '.pl-ergo-cmp { width: 100%; border-collapse: collapse; margin-top: 10px; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      P + '.pl-ergo-cmp th, ' + P + '.pl-ergo-cmp td { padding: 7px 9px; border-bottom: 1px solid #EFEBE3; text-align: right; white-space: nowrap; }',
      P + '.pl-ergo-cmp th:first-child, ' + P + '.pl-ergo-cmp td:first-child { text-align: left; }',
      P + '.pl-ergo-cmp thead th { font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: #7A8FA6; border-bottom: 1px solid #E5E2DC; }',
      P + '.pl-ergo-cmp thead th.is-latest { color: #244E6E; }',
      P + '.pl-ergo-cmp .pl-ergo-cmp-proto { font-family: "IBM Plex Mono", monospace; font-size: 9px; color: #B8954A; }',
      P + '.pl-ergo-cmp td:last-child { background: rgba(36, 78, 110, 0.05); font-weight: 500; }',
      P + '.pl-ergo-cmp-metric { font-weight: 500; color: #1E2D3D; }',
      P + '.pl-ergo-cmp-ps { color: #B8954A; }',
      P + '.pl-ergo-cmp-num { font-family: "IBM Plex Mono", monospace; color: #1E2D3D; }',
      P + '.pl-ergo-exam { border: 1px solid #E5E2DC; border-radius: 8px; padding: 14px 16px; margin-top: 10px; background: #FFFFFF; }',
      P + '.pl-ergo-exam-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }',
      P + '.pl-ergo-exam-date { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; color: #0D1B2A; }',
      P + '.pl-ergo-exam-sub { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; }',
      P + '.pl-ergo-exam-concl { font-size: 13px; line-height: 1.5; color: #1E2D3D; margin: 4px 0 0; }',
      P + '.pl-ergo-bundled { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #E5E2DC; }',
      P + '.pl-ergo-bundled-item { font-size: 12px; color: #1E2D3D; margin-top: 4px; }',
      P + '.pl-ergo-bundled-tag { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #7A8FA6; }',
      P + '.pl-ergo-trends { list-style: none; padding: 0; margin: 10px 0 0; }',
      P + '.pl-ergo-trends li { position: relative; padding-left: 16px; font-size: 13px; line-height: 1.5; color: #1E2D3D; margin-bottom: 7px; }',
      P + '.pl-ergo-trends li::before { content: "\\2014"; position: absolute; left: 0; color: #B8954A; }',
      P + '.pl-ergo-revisar { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8862B; background: rgba(184, 149, 74, 0.12); border: 1px solid rgba(184, 149, 74, 0.3); border-radius: 999px; padding: 3px 9px; margin-left: 8px; }',
      P + '#ergometric .silv-hist { margin-top: 18px; }'
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildPauloErgoAiCard(E) {
    var A = E.ai_card;
    var trends = A.trends.map(function (x) {
      return '<li><span class="lang-en">' + x.en + '</span><span class="lang-pt">' + x.pt + '</span></li>';
    }).join('');
    var watch = A.watch.map(function (x) {
      return '<li><span class="lang-en">' + x.en + '</span><span class="lang-pt">' + x.pt + '</span></li>';
    }).join('');
    var notes = A.notes.map(function (x) {
      return '<li><span class="lang-en">' + x.en + '</span><span class="lang-pt">' + x.pt + '</span></li>';
    }).join('');
    return (
      '<section class="paulo-ai-summary-wrap">' +
        '<div class="container">' +
          '<div class="paulo-ai-summary">' +
            '<header class="paulo-ai-summary-head">' +
              '<h2>' + t('4 · AI synthesis · Ergometric series', '4 · Síntese da IA · Série ergométrica') + '</h2>' +
              '<span class="ai-pill">AI</span>' +
            '</header>' +
            '<div class="paulo-ai-summary-meta">' +
              t('Synthesised from 4 exercise stress tests · 4 cardiologists · 2011 to 2023',
                'Sintetizado a partir de 4 testes ergométricos · 4 cardiologistas · 2011 a 2023') +
            '</div>' +
            '<div class="paulo-ai-subhead">' +
              '<span class="lang-en">' + A.headlineEn + '</span>' +
              '<span class="lang-pt">' + A.headlinePt + '</span>' +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-en"><p>' + A.summaryEn + '</p></div>' +
            '<div class="paulo-ai-summary-body lang-pt"><p>' + A.summaryPt + '</p></div>' +
            '<div class="paulo-ai-arcs-block">' +
              '<div class="paulo-ai-subhead">' + t('Trends across the series', 'Tendências ao longo da série') + '</div>' +
              '<ul class="pl-ergo-trends">' + trends + '</ul>' +
            '</div>' +
            '<div class="paulo-ai-arcs-block">' +
              '<div class="paulo-ai-subhead">' + t('Watch items', 'Pontos de atenção') + '</div>' +
              '<ul class="pl-ergo-trends">' + watch + '</ul>' +
            '</div>' +
            '<details class="silv-hist">' +
              '<summary>' + t('Data-quality notes', 'Notas de qualidade dos dados') +
                '<span class="pl-ergo-revisar">' + t('review', 'revisar') + ' · ' + A.notes.length + '</span>' +
              '</summary>' +
              '<ul class="pl-ergo-trends">' + notes + '</ul>' +
            '</details>' +
            '<p class="paulo-ai-arcs-cross" style="margin-top:14px;">' +
              '<span class="lang-en"><em>' + A.disclaimerEn + '</em></span>' +
              '<span class="lang-pt"><em>' + A.disclaimerPt + '</em></span>' +
            '</p>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderPauloErgoSection() {
    var E = window.PAULO_ERGOMETRIC;
    if (!E || !E.exams || !E.exams.length) return '';
    injectPauloErgoStyles();
    var fmt = function (v) { return (v === null || v === undefined) ? '—' : v; };
    var latest = E.exams[E.exams.length - 1];

    // Latest-exam highlight
    var chip = function (k, v) {
      return '<div class="pl-ergo-chip"><span class="pl-ergo-chip-k">' + k + '</span><span class="pl-ergo-chip-v">' + v + '</span></div>';
    };
    var chips =
      chip(t('Peak HR', 'FC máx'), latest.fc_max_bpm + ' <small>(' + latest.fc_max_pct_predicted + '%)</small>') +
      chip('VO₂ ' + t('max', 'máx'), latest.vo2_max + ' <small>ml/kg/min</small>') +
      chip('METs', latest.met_max) +
      chip(t('Peak SBP', 'PAS máx'), latest.pas_max + ' <small>mmHg</small>') +
      chip(t('Duration', 'Duração'), latest.duration_hms.replace(/^00:/, '')) +
      chip(t('Weight', 'Peso'), latest.weight_kg + ' <small>kg</small>');
    var latestCard =
      '<div class="pl-ergo-latest">' +
        '<div class="pl-ergo-latest-head">' +
          '<h3 class="pl-ergo-latest-title">' + t('Latest test', 'Prova mais recente') + ' · ' +
            '<span class="lang-en">' + latest.dateLabelEn + '</span><span class="lang-pt">' + latest.dateLabelPt + '</span>' +
          '</h3>' +
          '<span class="pl-ergo-latest-meta">' + latest.protocol + ' · ' + (latest.performing_doctor || '') + '</span>' +
          '<span class="pl-ergo-badge is-neg">' + t('ST negative', 'ST negativo') + '</span>' +
          '<span class="pl-ergo-badge is-max">' + t('maximal', 'máximo') + '</span>' +
        '</div>' +
        '<p class="pl-ergo-concl"><span class="lang-en">' + latest.conclusionEn + '</span><span class="lang-pt">' + latest.conclusionPt + '</span></p>' +
        '<div class="pl-ergo-chips">' + chips + '</div>' +
      '</div>';

    // Comparison table
    var dates = E.comparison.exam_dates;
    var protoByDate = {};
    E.exams.forEach(function (x) { protoByDate[x.date] = x.protocol; });
    var head = '<th>' + t('Metric', 'Métrica') + '</th>' + dates.map(function (d, i) {
      var isLatest = (i === dates.length - 1);
      var yr = d.slice(0, 4);
      return '<th class="' + (isLatest ? 'is-latest' : '') + '">' + yr +
        '<br><span class="pl-ergo-cmp-proto">' + protoByDate[d] + '</span></th>';
    }).join('');
    var rows = E.comparison.metrics.map(function (m) {
      var label = '<span class="pl-ergo-cmp-metric">' +
        '<span class="lang-en">' + m.labelEn + '</span><span class="lang-pt">' + m.labelPt + '</span>' +
        (m.unit ? ' <small>' + m.unit + '</small>' : '') +
        (m.protocol_sensitive ? ' <span class="pl-ergo-cmp-ps" title="' + t('protocol-sensitive', 'sensível ao protocolo') + '">‡</span>' : '') +
        '</span>';
      var cells = m.values.map(function (v) { return '<td class="pl-ergo-cmp-num">' + fmt(v) + '</td>'; }).join('');
      return '<tr><td>' + label + '</td>' + cells + '</tr>';
    }).join('');
    var cmpTable =
      '<details class="silv-hist">' +
        '<summary>' + t('Comparison table · all metrics × dates', 'Tabela comparativa · todas as métricas × datas') + '</summary>' +
        '<table class="pl-ergo-cmp"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '<p class="silv-hist-note" style="margin-top:8px;">' +
          t('‡ protocol-sensitive — VO₂, METs and duration are estimates that vary with the test protocol; cross-protocol comparison is indicative only.',
            '‡ sensível ao protocolo — VO₂, METs e duração são estimativas que variam conforme o protocolo; a comparação entre protocolos é apenas indicativa.') +
        '</p>' +
      '</details>';

    // Per-exam detail (most recent first)
    var examItems = E.exams.slice().reverse().map(function (x) {
      var bundled = (x.bundled && x.bundled.length)
        ? '<div class="pl-ergo-bundled">' + x.bundled.map(function (b) {
            return '<div class="pl-ergo-bundled-item"><span class="pl-ergo-bundled-tag">' +
              '<span class="lang-en">' + b.labelEn + '</span><span class="lang-pt">' + b.labelPt + '</span></span> · ' +
              '<span class="lang-en">' + b.textEn + '</span><span class="lang-pt">' + b.textPt + '</span></div>';
          }).join('') + '</div>'
        : '';
      var loc = [x.lab, x.city].filter(Boolean).join(' · ') || t('lab not stated', 'laboratório não informado');
      return '<div class="pl-ergo-exam">' +
        '<div class="pl-ergo-exam-head">' +
          '<span class="pl-ergo-exam-date"><span class="lang-en">' + x.dateLabelEn + '</span><span class="lang-pt">' + x.dateLabelPt + '</span></span>' +
          '<span class="pl-ergo-exam-sub">' + x.protocol + ' · ' + x.ergometer + ' · ' + t('age', 'idade') + ' ' + x.age + '</span>' +
          '<span class="pl-ergo-badge is-neg">' + t('ST negative', 'ST negativo') + '</span>' +
        '</div>' +
        '<div class="pl-ergo-exam-sub">' + loc + ' · ' + (x.performing_doctor || '') + (x.crm ? ' · ' + x.crm : '') + '</div>' +
        '<p class="pl-ergo-exam-concl"><span class="lang-en">' + x.conclusionEn + '</span><span class="lang-pt">' + x.conclusionPt + '</span></p>' +
        bundled +
      '</div>';
    }).join('');
    var examList =
      '<details class="silv-hist">' +
        '<summary>' + t('Per-exam detail · 4 tests', 'Detalhe por exame · 4 provas') + '</summary>' +
        examItems +
      '</details>';

    var head2 =
      '<div class="container">' +
        '<div class="section-label">' + t('4 · Cardiac', '4 · Cardíaco') + '</div>' +
        '<h2 class="section-title">' + t('Ergometric stress tests', 'Testes ergométricos') + '</h2>' +
        '<p class="section-desc">' +
          t('Four exercise stress tests over twelve years (2011 → 2023), reconciled from scanned reports across four cardiologists and three protocols (Bruce, Rampa, Ellestad). All four were negative for ischaemia. The latest test is shown first; the comparison table and per-exam detail sit below, collapsed.',
            'Quatro testes ergométricos em doze anos (2011 → 2023), reconciliados de laudos digitalizados de quatro cardiologistas e três protocolos (Bruce, Rampa, Ellestad). As quatro provas foram negativas para isquemia. A prova mais recente aparece primeiro; a tabela comparativa e o detalhe por exame ficam abaixo, recolhidos.') +
        '</p>' +
      '</div>';

    return (
      buildPauloErgoAiCard(E) +
      '<section class="report-section" id="ergometric">' +
        head2 +
        '<div class="container">' +
          latestCard +
          cmpTable +
          examList +
        '</div>' +
      '</section>'
    );
  }

  function renderPauloPhysicalExams() {
    injectPauloExamsStyles();

    document.title = 'Lumen Health — Physical · Imaging exams · Paulo Silotto Souza';

    var hero =
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' + t('Physical → Exams', 'Físico → Exames') + '</div>' +
          '<h1 class="hero-title">' +
            t('Imaging & laboratory exams · Paulo Silotto Souza',
              'Exames de imagem e laboratoriais · Paulo Silotto Souza') +
          '</h1>' +
          '<p class="hero-sub">' +
            t('Eleven years of spine imaging — three cervical MRIs (2015, 2023, 2026) and two lumbar (2023, 2026), all from CETAM Diagnóstico. The latest pair (15 May 2026, Dr. Marco Antonio de Carvalho · CRM-99607) loads in the unified viewer below; each repeated study is commented by AI in the longitudinal section, with the radiologists&apos; original reports rendered in full underneath.',
              'Onze anos de imagens da coluna — três RMs cervicais (2015, 2023, 2026) e duas lombares (2023, 2026), todas do CETAM Diagnóstico. O par mais recente (15 de maio de 2026, Dr. Marco Antonio de Carvalho · CRM-99607) carrega no visualizador unificado abaixo; cada estudo repetido recebe comentário da IA na seção longitudinal, com os laudos originais dos radiologistas renderizados em seguida.') +
          '</p>' +
          '<div class="hero-meta">' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Patient', 'Paciente') + '</span><span>Paulo Silotto Souza</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('DOB · age', 'Nasc. · idade') + '</span>' +
              '<span>' + t('14 Jul 1961 · 64', '14 jul 1961 · 64') + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Imaging arc', 'Arco de imagens') + '</span>' +
              '<span>' + t('2015 → 2026 · 5 MRIs', '2015 → 2026 · 5 RMs') + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Lab arc', 'Arco laboratorial') + '</span>' +
              '<span>' + t('2011 → 2024 · 26 panels', '2011 → 2024 · 26 painéis') + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Latest exam', 'Exame mais recente') + '</span>' +
              '<span>' + t('15 May 2026', '15 mai 2026') + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Provider', 'Prestador') + '</span>' +
              '<span>CETAM Diagnóstico</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    var examsHtml = buildPauloUnifiedSection(PAULO_STUDIES);

    var aiSummary =
      '<section class="paulo-ai-summary-wrap">' +
        '<div class="container">' +
          '<div class="paulo-ai-summary">' +
            '<header class="paulo-ai-summary-head">' +
              '<h2>' + t('1 · AI synthesis · Imaging arc', '1 · Síntese da IA · Arco de imagens') + '</h2>' +
              '<span class="ai-pill">AI</span>' +
            '</header>' +
            '<div class="paulo-ai-summary-meta">' +
              t('Synthesised from 5 spine MRI reports · CETAM Diagnóstico · 2015 → 2026 · plus 13 single-occurrence studies · 2013 → 2025',
                'Sintetizado a partir de 5 laudos de RM da coluna · CETAM Diagnóstico · 2015 → 2026 · mais 13 estudos isolados · 2013 → 2025') +
            '</div>' +
            '<div class="paulo-ai-subhead">' +
              t('Current snapshot · 15 May 2026', 'Quadro atual · 15 de maio de 2026') +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-en">' +
              '<p>Same-day MRI of the cervical and lumbar spine demonstrates <strong>widespread multi-level degenerative disc disease</strong>, with three findings that warrant clinical attention. <strong>L5–S1:</strong> a left paramedian / foraminal disc extrusion compressing the ipsilateral descending S1 nerve root — the most acute finding of the pair. <strong>L3–L4:</strong> spinal canal stenosis from a pseudo-bulge combined with facet joint hypertrophy and ligamentum flavum thickening, compressing the anterior descending roots. <strong>C5–C6:</strong> a diffuse disco-osteophytic bulge with ventral cord compression — no cord signal change (no myelopathy) at this point, but the cord is being contacted.</p>' +
              '<p>Shared across both regions: sinistroconvex axis deviation, marginal osteophytes, diffuse disc dehydration, and paravertebral muscle hypotrophy (mild cervical, moderate lumbar). The lumbar segment additionally shows mild <strong>L3-over-L4 anterolisthesis</strong>, <strong>Modic I (oedema)</strong> signal at L1–L2, L2–L3 and L4–L5, <strong>Modic II (fatty)</strong> at L4–L5, and interspinous ligament oedema at L2–L3, L3–L4 and L5–S1 — markers of active inflammatory degenerative change rather than purely chronic burnt-out disease.</p>' +
              '<p><strong>Recommended next step:</strong> clinical correlation against current radicular symptoms — left-sided S1 territory from the L5–S1 extrusion, C6 / C7 territory from the C5–C6 bulge — and a spine-specialist evaluation to weigh conservative management vs. interventional options given the L3–L4 canal stenosis, multi-level foraminal narrowing, and ventral cord contact at C5–C6.</p>' +
            '</div>' +
            '<div class="paulo-ai-summary-body lang-pt">' +
              '<p>As RM cervical e lombar do mesmo dia demonstram <strong>doença discal degenerativa difusa e multinivelar</strong>, com três achados que merecem atenção clínica. <strong>L5–S1:</strong> extrusão discal paramediana / foraminal esquerda comprimindo a raiz descendente S1 ipsilateral — o achado mais agudo do par. <strong>L3–L4:</strong> estenose do canal vertebral por pseudo-abaulamento associado a hipertrofia facetária e espessamento dos ligamentos amarelos, com compressão das descendentes anteriores. <strong>C5–C6:</strong> abaulamento disco-osteofitário difuso com compressão ventral da medula — sem alteração de sinal medular (sem mielopatia) neste momento, porém com contato medular.</p>' +
              '<p>Achados comuns às duas regiões: desvio sinistro-convexo do eixo, osteófitos marginais, hipohidratação discal difusa e hipotrofia da musculatura paravertebral (discreta na cervical, moderada na lombar). O segmento lombar mostra ainda <strong>anterolistese discreta de L3 sobre L4</strong>, sinal <strong>Modic I (edema)</strong> em L1–L2, L2–L3 e L4–L5, <strong>Modic II (gordura)</strong> em L4–L5 e edema do ligamento interespinhoso em L2–L3, L3–L4 e L5–S1 — marcadores de alteração degenerativa inflamatória ativa, não apenas degeneração crônica encerrada.</p>' +
              '<p><strong>Próximo passo recomendado:</strong> correlação clínica com os sintomas radiculares atuais — território S1 à esquerda a partir da extrusão L5–S1; território C6 / C7 a partir do abaulamento C5–C6 — e avaliação por especialista em coluna para ponderar manejo conservador vs. opções intervencionistas frente à estenose em L3–L4, ao estreitamento foraminal multinível e ao contato medular ventral em C5–C6.</p>' +
            '</div>' +
            '<div class="paulo-ai-arcs-block">' +
              '<div class="paulo-ai-subhead">' +
                t('Longitudinal evolution · how the same exam has changed over time',
                  'Evolução longitudinal · como o mesmo exame mudou ao longo do tempo') +
              '</div>' +
              '<div class="paulo-ai-arcs">' +
                '<div class="paulo-ai-arc">' +
                  '<div class="paulo-ai-arc-head">' +
                    '<h3 class="paulo-ai-arc-title">' + t('Cervical spine', 'Coluna cervical') + '</h3>' +
                    '<span class="paulo-ai-arc-span">' + t('11-year arc · 3 MRIs', 'Arco de 11 anos · 3 RMs') + '</span>' +
                  '</div>' +
                  '<p class="paulo-ai-arc-body lang-en">Three cervical MRIs span eleven years (2015 → 2023 → 2026). Disease progressed by two complementary mechanisms: <strong>cranial migration</strong> — the dominant lesion shifted from C6–C7 (2015) up to C5–C6 (2023, still dominant in 2026) — and <strong>envelope widening</strong> — what began as a focal posterocentral protrusion is now a diffuse disco-osteophytic bulge with explicit uncovertebral / facet arthrosis and ligamentum-flavum thickening. The critical new finding in 2026 is <strong>ventral cord contact at C5–C6</strong> (cord signal still normal — no myelopathy yet). Velocity: slow, but the disease envelope keeps widening level by level.</p>' +
                  '<p class="paulo-ai-arc-body lang-pt">Três RMs cervicais cobrem onze anos (2015 → 2023 → 2026). A doença evoluiu por dois mecanismos complementares: <strong>migração cranial</strong> — a lesão dominante saiu de C6–C7 (2015) e subiu para C5–C6 (2023, ainda dominante em 2026) — e <strong>ampliação do envoltório</strong> — o que começou como protrusão posterocentral focal hoje é abaulamento disco-osteofitário difuso com artrose uncovertebral / facetária e espessamento do ligamento amarelo explicitados. O achado novo crítico em 2026 é <strong>contato medular ventral em C5–C6</strong> (sinal medular ainda normal — sem mielopatia). Velocidade: lenta, mas o envoltório degenerativo segue se ampliando nível a nível.</p>' +
                '</div>' +
                '<div class="paulo-ai-arc">' +
                  '<div class="paulo-ai-arc-head">' +
                    '<h3 class="paulo-ai-arc-title">' + t('Lumbar spine', 'Coluna lombar') + '</h3>' +
                    '<span class="paulo-ai-arc-span">' + t('3-year arc · 2 MRIs', 'Arco de 3 anos · 2 RMs') + '</span>' +
                  '</div>' +
                  '<p class="paulo-ai-arc-body lang-en">Two lumbar MRIs cover three years (2023 → 2026). Pattern differs from the cervical: the headline lesion is <strong>stable</strong> — the L5–S1 left paramedian / foraminal extrusion still compresses the descending S1 root with the same geometry — but the <strong>surrounding tissue is angrier</strong>: a new L3–L4 spinal-canal stenosis appears as a second focus, and <strong>Modic I (active oedema)</strong> signal now lights up at L1–L2, L2–L3 and L4–L5 alongside interspinous-ligament oedema at three levels. The lumbar disease is currently inflammatory, not chronically burnt-out.</p>' +
                  '<p class="paulo-ai-arc-body lang-pt">Duas RMs lombares cobrem três anos (2023 → 2026). Padrão difere do cervical: a lesão principal está <strong>estável</strong> — a extrusão paramediana / foraminal esquerda em L5–S1 continua comprimindo a raiz descendente S1 com a mesma geometria — mas o <strong>tecido ao redor está mais ativo</strong>: surge a estenose do canal em L3–L4 como segundo foco e o sinal <strong>Modic I (edema ativo)</strong> aparece em L1–L2, L2–L3 e L4–L5, junto com edema do ligamento interespinhoso em três níveis. A doença lombar está atualmente inflamatória, não cronicamente encerrada.</p>' +
                '</div>' +
              '</div>' +
              '<p class="paulo-ai-arcs-cross lang-en"><strong>Cross-region pattern.</strong> Sinistro-convex axis deviation appeared in the cervical only in 2023 but was already present in the lumbar 2023 baseline — consistent with whole-spine postural adaptation rather than a focal mechanical event. Paravertebral muscle hypotrophy is present in both regions (mild cervical, moderate lumbar) — a muscular dimension that constrains how far conservative management can go without targeted strengthening.</p>' +
              '<p class="paulo-ai-arcs-cross lang-pt"><strong>Padrão entre regiões.</strong> O desvio sinistro-convexo do eixo só aparece na cervical em 2023 mas já estava presente na lombar de 2023 — compatível com adaptação postural de toda a coluna, e não com evento mecânico focal. A hipotrofia paravertebral está presente nas duas regiões (discreta na cervical, moderada na lombar) — um eixo muscular que limita até onde o manejo conservador pode ir sem fortalecimento direcionado.</p>' +
            '</div>' +
            '<div class="paulo-ai-insights-block">' +
              '<div class="paulo-ai-insights-head">' +
                t('Three holistic insights', 'Três insights holísticos') +
              '</div>' +
              '<div class="paulo-ai-insights">' +
                '<div class="paulo-ai-insight">' +
                  '<div class="paulo-ai-insight-label">' + t('Physical', 'Físico') + '</div>' +
                  '<p class="paulo-ai-insight-body lang-en"><strong>Clinical Pilates + aquatic therapy</strong> as the weekly base — both rebuild the paravertebral musculature flagged as hypotrophic on the MRI without axial loading. Run a <strong>spine-focused physiotherapy programme</strong> in parallel (McKenzie method for the L5–S1 extrusion; cervical traction work for C5–C6). <strong>Avoid</strong> running on hard surfaces, CrossFit-style heavy lifting and contact sports until the left-sided S1 radicular pattern is controlled.</p>' +
                  '<p class="paulo-ai-insight-body lang-pt"><strong>Pilates clínico + hidroterapia</strong> como base semanal — ambos recuperam a musculatura paravertebral hipotrofiada vista na RM sem carga axial. Em paralelo, <strong>programa estruturado de fisioterapia para coluna</strong> (método McKenzie para a extrusão L5–S1; tração cervical para C5–C6). <strong>Evitar</strong> corrida em piso duro, levantamento pesado tipo CrossFit e esportes de contato até o quadro radicular S1 à esquerda estar controlado.</p>' +
                '</div>' +
                '<div class="paulo-ai-insight">' +
                  '<div class="paulo-ai-insight-label">' + t('Mental', 'Mental') + '</div>' +
                  '<p class="paulo-ai-insight-body lang-en">Chronic spine pain has a documented bidirectional link with anxiety and depressive symptoms — pain catastrophizing is one of the strongest predictors of poor outcomes regardless of imaging severity. Recommend <strong>CBT focused on chronic-pain coping</strong> (8–12 sessions to start) and <strong>quarterly follow-up</strong> with a clinical psychologist or psychiatrist while the radicular pattern is being managed. Mindfulness-based stress reduction (MBSR) is a strong adjunct.</p>' +
                  '<p class="paulo-ai-insight-body lang-pt">Dor crônica de coluna tem ligação bidirecional comprovada com ansiedade e sintomas depressivos — catastrofização da dor é um dos maiores preditores de pior evolução, independentemente da gravidade da imagem. Recomenda-se <strong>TCC focada em manejo de dor crônica</strong> (8–12 sessões iniciais) e <strong>acompanhamento trimestral</strong> com psicólogo(a) clínico ou psiquiatra enquanto o quadro radicular estiver em manejo. Mindfulness (MBSR) é um excelente adjuvante.</p>' +
                '</div>' +
                '<div class="paulo-ai-insight is-tbd">' +
                  '<div class="paulo-ai-insight-label">' + t('Spiritual', 'Espiritual') + '</div>' +
                  '<p class="paulo-ai-insight-body lang-en">TBD — no spiritual or values-of-life data captured yet. Once a baseline is recorded (faith practice, meaning-making framework, support community), the AI summary will fold it into the synthesis.</p>' +
                  '<p class="paulo-ai-insight-body lang-pt">A definir — ainda não há dados sobre a dimensão espiritual / valores de vida. Assim que houver um registro inicial (prática de fé, estrutura de significado, comunidade de apoio), o resumo da IA incorporará esses dados à síntese.</p>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    var imagery =
      '<section class="report-section" id="imagery">' +
        '<div class="container">' +
          '<div class="section-label">' +
            t('2 · Imagery', '2 · Imagem') +
          '</div>' +
          '<h2 class="section-title">' +
            t('Imaging exam', 'Exame de imagem') +
          '</h2>' +
          '<p class="section-desc">' +
            t('One same-day MRI session of the spine covering both the cervical and lumbar regions. The single viewer below carries both — pick the anatomical region (Cervical / Lumbar) and the plane (AXI / COR / SAG), then scrub the slider. The two radiologists’ reports follow side-by-side in Portuguese and English.',
              'Uma única sessão de RM da coluna, mesma data, cobrindo a região cervical e a lombar. O visualizador único abaixo carrega as duas — escolha a região anatômica (Cervical / Lombar) e o plano (AXI / COR / SAG) e depois deslize o controle. Os dois laudos seguem lado a lado em português e em inglês.') +
          '</p>' +
        '</div>' +
        examsHtml +
      '</section>';

    var history      = buildPauloHistorySection();
    var otherStudies = buildPauloOtherStudiesSection();
    var overall      = buildPauloOverallEvolution();
    var labs         = renderPauloLabsSection();
    var ergometric   = renderPauloErgoSection();

    var main = document.createElement('main');
    main.className = 'jc-paulo-exams';
    main.innerHTML = hero + aiSummary + imagery + history + otherStudies + overall + labs + ergometric;
    document.body.appendChild(main);

    // Wire the unified viewer (handles both anatomies + orientations)
    var unifiedViewer = main.querySelector('.pl-ct-viewer[data-paulo-study="spine-combined"]');
    if (unifiedViewer) wirePauloUnifiedViewer(unifiedViewer, PAULO_STUDIES);

    // Place the danger zone beneath the new main, mirroring how the
    // jc-overview view does it for other patients.
    injectDangerZone(main);
  }

  /* ── Silvana Creste · bespoke lab-history page ──────────────────────
     Reads window.SILVANA_LABS (loaded via assets/silvana-labs.js) and
     renders an exam page in Joao's style:
       1. Dark hero with patient meta
       2. AI summary card (gold-bordered, with AI pill)
       3. Per-panel <details class="lab-panel"> blocks. Each panel hosts
          one .lab-test card per marker — latest value, status pill,
          horizontal range bar, plus an inline history table for the
          marker.
       4. Single end-of-page historical-comparison table (the same wide
          side-by-side grid Joao's static page uses) populated from
          every marker × every sample.
       5. Source-PDF list with download links. */

  function silvanaLatestPoint(marker) {
    var pts = (marker.points || []).slice();
    pts.sort(function (a, b) { return dateMs(b.date) - dateMs(a.date); });
    return pts[0] || null;
  }

  function silvanaClassify(value, refLow, refHigh, flag) {
    if (flag === 'H' || flag === 'HH' || flag === 'L' || flag === 'LL') return 'flag';
    if (value == null || !isFinite(value)) return 'normal';
    if (refLow  != null && isFinite(refLow)  && value < refLow)  return 'flag';
    if (refHigh != null && isFinite(refHigh) && value > refHigh) return 'flag';
    return 'normal';
  }

  function silvanaBar(value, refLow, refHigh, status) {
    if (value == null || !isFinite(value)) return '';
    var hasLow  = (refLow  != null && isFinite(refLow));
    var hasHigh = (refHigh != null && isFinite(refHigh));
    if (!hasLow && !hasHigh) return '';
    var lo = hasLow  ? refLow  : 0;
    var hi = hasHigh ? refHigh : Math.max(refLow * 2, value * 1.2, refLow + 1);
    if (hi <= lo) return '';
    var pct = 10 + ((value - lo) / (hi - lo)) * 80;
    if (pct < 0) pct = 0; if (pct > 100) pct = 100;
    var markerCls = (status === 'flag') ? 'lab-bar-marker-flag' : 'lab-bar-marker-normal';
    var leftLabel  = hasLow  ? '<span>' + t('min ' + fmtLabNum(refLow),  'mín ' + fmtLabNum(refLow))  + '</span>' : '<span></span>';
    var rightLabel = hasHigh ? '<span>' + t('max ' + fmtLabNum(refHigh), 'máx ' + fmtLabNum(refHigh)) + '</span>' : '<span></span>';
    return (
      '<div class="lab-bar-wrap">' +
        '<div class="lab-bar">' +
          '<div class="lab-bar-bg"></div>' +
          '<div class="lab-bar-range"></div>' +
          '<div class="lab-bar-tick lab-bar-tick-min"></div>' +
          '<div class="lab-bar-tick lab-bar-tick-max"></div>' +
          '<div class="lab-bar-marker ' + markerCls + '" style="left: ' + pct.toFixed(2) + '%;">' +
            '<div class="lab-bar-dot"></div>' +
          '</div>' +
        '</div>' +
        '<div class="lab-bar-labels">' + leftLabel + rightLabel + '</div>' +
      '</div>'
    );
  }

  function silvanaMarkerCard(m) {
    var latest = silvanaLatestPoint(m);
    var v   = latest ? latest.value     : null;
    var vt  = latest ? latest.value_text : null;
    var flg = latest ? latest.flag       : null;
    var status = silvanaClassify(v, m.ref_low, m.ref_high, flg);
    var pillCls = status === 'flag' ? 'pill-flag' : 'pill-ok';
    var valHtml = (v != null && isFinite(v))
      ? '<span class="lab-val-num">' + fmtLabNum(v) + '</span>' +
        (m.unit ? ' <span class="lab-val-unit">' + escapeHtml(m.unit) + '</span>' : '')
      : '<span class="lab-val-num">' + escapeHtml(vt || '—') + '</span>';

    // Per-marker history table (the user's "history table beneath each card")
    var hist = (m.points || []).slice().sort(function (a, b) {
      return dateMs(b.date) - dateMs(a.date);
    });
    var historyHtml = '';
    if (hist.length > 1) {
      var rows = hist.map(function (p, i) {
        var disp = (p.value != null && isFinite(p.value))
          ? fmtLabNum(p.value) + (m.unit ? ' ' + escapeHtml(m.unit) : '')
          : escapeHtml(p.value_text || '—');
        var st = silvanaClassify(p.value, m.ref_low, m.ref_high, p.flag);
        var flgTag = p.flag ? '<span class="lab-flag ' + (p.flag.charAt(0)==='L'?'low':'high') + '">' + escapeHtml(p.flag) + '</span>' : '';
        var cls = 'silv-hist-row' + (i === 0 ? ' silv-hist-row-latest' : '') + (st === 'flag' ? ' silv-hist-row-flag' : '');
        return (
          '<tr class="' + cls + '">' +
            '<td class="silv-hist-date">' + escapeHtml(formatDate(p.date)) + '</td>' +
            '<td class="silv-hist-val">' + disp + ' ' + flgTag + '</td>' +
            (p.note_en || p.note_pt ?
              '<td class="silv-hist-note">' + t(escapeHtml(p.note_en || ''), escapeHtml(p.note_pt || '')) + '</td>'
              : '<td class="silv-hist-note">—</td>') +
          '</tr>'
        );
      }).join('');
      historyHtml =
        '<details class="silv-hist">' +
          '<summary>' + t(hist.length + ' historical samples · click to expand',
                          hist.length + ' amostras anteriores · clique para expandir') + '</summary>' +
          '<table class="silv-hist-table">' +
            '<thead><tr>' +
              '<th>' + t('Date', 'Data') + '</th>' +
              '<th>' + t('Value', 'Valor') + '</th>' +
              '<th>' + t('Note', 'Nota') + '</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</details>';
    }

    var noteHtml = '';
    if (latest && (latest.note_en || latest.note_pt)) {
      noteHtml =
        '<div class="lab-note">' +
          '<span class="lang-en">' + escapeHtml(latest.note_en || '') + '</span>' +
          '<span class="lang-pt">' + escapeHtml(latest.note_pt || '') + '</span>' +
        '</div>';
    }

    var latestDate = latest ? formatDate(latest.date) : '—';

    return (
      '<div class="lab-test lab-test-' + status + '">' +
        '<div class="lab-test-head">' +
          '<div class="lab-test-name">' +
            '<span class="lang-en">' + escapeHtml(m.marker_en) + '</span>' +
            '<span class="lang-pt">' + escapeHtml(m.marker_pt) + '</span>' +
          '</div>' +
          '<div class="lab-test-meta">' +
            '<span class="lab-test-val">' + valHtml + '</span>' +
            '<span class="pill ' + pillCls + '">' +
              (status === 'flag' ? t('Out of range', 'Fora do intervalo') : t('Normal', 'Normal')) +
            '</span>' +
          '</div>' +
        '</div>' +
        silvanaBar(v, m.ref_low, m.ref_high, status) +
        '<div class="lab-test-foot">' +
          '<div class="lab-test-ref">' +
            t('Reference:', 'Referência:') + ' ' +
            '<span class="lang-en">' + escapeHtml(m.ref_text_en || '—') + '</span>' +
            '<span class="lang-pt">' + escapeHtml(m.ref_text_pt || '—') + '</span>' +
          '</div>' +
          '<div class="silv-latest-date">' +
            t('Latest sample: ', 'Última amostra: ') + escapeHtml(latestDate) +
          '</div>' +
        '</div>' +
        noteHtml +
        historyHtml +
      '</div>'
    );
  }

  function silvanaPanelDetails(pn) {
    var body = pn.markers.map(silvanaMarkerCard).join('');
    var n = pn.markers.length;
    var countHtml = n + ' ' + t(n === 1 ? 'marker' : 'markers', n === 1 ? 'marcador' : 'marcadores');
    return (
      '<details class="lab-panel" id="silv-panel-' + pn.slug + '" open>' +
        '<summary class="lab-panel-head">' +
          '<span class="lab-panel-title">' +
            '<span class="lang-en">' + escapeHtml(pn.title_en) + '</span>' +
            '<span class="lang-pt">' + escapeHtml(pn.title_pt) + '</span>' +
          '</span>' +
          '<span class="lab-panel-sub">' +
            '<span class="lang-en">' + escapeHtml(pn.subtitle_en || '') + '</span>' +
            '<span class="lang-pt">' + escapeHtml(pn.subtitle_pt || '') + '</span>' +
          '</span>' +
          '<span class="lab-panel-count">' + countHtml + '</span>' +
        '</summary>' +
        '<div class="lab-panel-body">' + body + '</div>' +
      '</details>'
    );
  }

  function silvanaHistoricalComparison(panels, docs) {
    // Build union of (date, lab, doctor) samples
    var sampleMap = {};
    panels.forEach(function (pn) {
      pn.markers.forEach(function (m) {
        (m.points || []).forEach(function (p) {
          var key = p.date + '|';
          if (!sampleMap[key]) {
            sampleMap[key] = { key: key, date: p.date, ts: dateMs(p.date) || 0 };
          }
        });
      });
    });
    var samples = Object.keys(sampleMap).map(function (k) { return sampleMap[k]; });
    samples.sort(function (a, b) { return b.ts - a.ts; });
    if (samples.length < 2) return '';

    // Decorate each sample with doc / lab from the document list when present
    var docByDate = {};
    (docs || (window.SILVANA_LABS && window.SILVANA_LABS.documents) || []).forEach(function (d) { docByDate[d.date] = d; });
    samples.forEach(function (s) {
      var d = docByDate[s.date];
      if (d) { s.lab = d.laboratory; s.doctor = d.doctor; }
    });

    var headerCols = samples.map(function (s, i) {
      var cls = 'lab-cmp-col-head' + (i === 0 ? ' lab-cmp-col-latest' : '');
      return (
        '<th class="' + cls + '">' +
          '<div class="lab-cmp-date">' + escapeHtml(formatDate(s.date)) + '</div>' +
          '<div class="lab-cmp-lab">' + escapeHtml(s.lab || '—') + '</div>' +
          '<div class="lab-cmp-md">' + escapeHtml(s.doctor || '—') + '</div>' +
        '</th>'
      );
    }).join('');

    var bodyRows = panels.map(function (pn) {
      var rows = pn.markers.map(function (m) {
        var byDate = {};
        (m.points || []).forEach(function (p) { byDate[p.date] = p; });
        var cells = samples.map(function (s, i) {
          var p = byDate[s.date];
          if (!p) return '<td class="lab-cmp-val lab-cmp-empty">—</td>';
          var v = (p.value != null && isFinite(Number(p.value)))
            ? fmtLabNum(Number(p.value))
            : (p.value_text || '—');
          var flagAttr = (p.flag === 'H' || p.flag === 'HH') ? ' data-flag="high"'
                       : (p.flag === 'L' || p.flag === 'LL') ? ' data-flag="low"' : '';
          var cls = 'lab-cmp-val' + (i === 0 ? ' lab-cmp-latest' : '');
          return '<td class="' + cls + '"' + flagAttr + '>' + escapeHtml(String(v)) + '</td>';
        }).join('');
        var unit = m.unit ? ' <small class="lab-cmp-unit">(' + escapeHtml(m.unit) + ')</small>' : '';
        var markerLabel =
          '<span class="lang-en">' + escapeHtml(m.marker_en) + '</span>' +
          '<span class="lang-pt">' + escapeHtml(m.marker_pt) + '</span>';
        return (
          '<tr>' +
            '<th class="lab-cmp-marker">' + markerLabel + unit + '</th>' +
            cells +
          '</tr>'
        );
      }).join('');
      var pnLabel =
        '<span class="lang-en">' + escapeHtml(pn.title_en) + '</span>' +
        '<span class="lang-pt">' + escapeHtml(pn.title_pt) + '</span>';
      return (
        '<tr class="lab-cmp-section"><th colspan="' + (samples.length + 1) + '">' + pnLabel + '</th></tr>' +
        rows
      );
    }).join('');

    var nMarkers = panels.reduce(function (acc, pn) { return acc + pn.markers.length; }, 0);
    var countLine = nMarkers + ' ' + t(nMarkers === 1 ? 'marker' : 'markers', nMarkers === 1 ? 'marcador' : 'marcadores') +
                    ' · ' + samples.length + ' ' + t(samples.length === 1 ? 'sample' : 'samples', samples.length === 1 ? 'amostra' : 'amostras');

    return (
      '<details class="lab-panel" id="silv-comparison" open style="margin-top:18px;">' +
        '<summary class="lab-panel-head">' +
          '<span class="lab-panel-title">' + t('Historical comparison', 'Comparação histórica') + '</span>' +
          '<span class="lab-panel-sub">' +
            t('All samples side-by-side · most recent at left · empty cells where a marker wasn\'t tested',
              'Todas as amostras lado a lado · mais recente à esquerda · células vazias onde um marcador não foi dosado') +
          '</span>' +
          '<span class="lab-panel-count">' + countLine + '</span>' +
        '</summary>' +
        '<div class="lab-panel-body">' +
          '<div class="lab-cmp-wrap">' +
            '<table class="lab-cmp-table">' +
              '<thead><tr>' +
                '<th class="lab-cmp-marker-head">' + t('Marker', 'Marcador') + '</th>' +
                headerCols +
              '</tr></thead>' +
              '<tbody>' + bodyRows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }

  function silvanaDocsList(docs) {
    var items = docs.map(function (d) {
      var href = /^(https?:|\/)/.test(d.pdf) ? d.pdf : 'scans/' + d.pdf;
      return (
        '<li class="silv-doc">' +
          '<a href="' + escapeHtml(href) + '" download class="silv-doc-link">' +
            '<span class="silv-doc-title">' +
              '<span class="lang-en">' + escapeHtml(d.title_en) + '</span>' +
              '<span class="lang-pt">' + escapeHtml(d.title_pt) + '</span>' +
            '</span>' +
            '<span class="silv-doc-meta">' +
              escapeHtml(d.laboratory || '—') +
              (d.doctor ? ' · ' + escapeHtml(d.doctor) : '') +
            '</span>' +
          '</a>' +
        '</li>'
      );
    }).join('');
    return '<ul class="silv-docs">' + items + '</ul>';
  }

  function silvanaStudyCategoryLabel(cat) {
    return ({
      imaging:    ['Imaging', 'Imagem'],
      pathology:  ['Pathology', 'Patologia'],
      endoscopy:  ['Endoscopy', 'Endoscopia'],
      functional: ['Functional', 'Funcional'],
    })[cat] || ['Study', 'Exame'];
  }

  // Imaging / pathology / endoscopy / functional studies — newest first.
  function silvanaStudiesList(studies) {
    var items = (studies || []).slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    }).map(function (s) {
      var cat = silvanaStudyCategoryLabel(s.category);
      var imgs = (s.images || []).map(function (src, i) {
        return '<a href="scans/' + escapeHtml(src) + '" target="_blank" rel="noopener" class="silv-study-src">' +
          t('View source', 'Ver laudo') + (s.images.length > 1 ? ' ' + (i + 1) : '') + '</a>';
      }).join('');
      return (
        '<div class="silv-study silv-study-' + escapeHtml(s.category) + '">' +
          '<div class="silv-study-head">' +
            '<span class="silv-study-cat silv-study-cat-' + escapeHtml(s.category) + '">' + t(cat[0], cat[1]) + '</span>' +
            '<span class="silv-study-date">' + escapeHtml(formatDate(s.date)) + '</span>' +
          '</div>' +
          '<div class="silv-study-title">' +
            '<span class="lang-en">' + escapeHtml(s.title_en) + '</span>' +
            '<span class="lang-pt">' + escapeHtml(s.title_pt) + '</span>' +
          '</div>' +
          '<div class="silv-study-meta">' +
            escapeHtml(s.laboratory || '—') +
            (s.doctor ? ' · ' + escapeHtml(s.doctor) : '') +
            (s.requested_by ? ' · ' + t('req. ', 'sol. ') + escapeHtml(s.requested_by) : '') +
          '</div>' +
          '<p class="silv-study-concl">' +
            '<span class="lang-en">' + escapeHtml(s.conclusion_en) + '</span>' +
            '<span class="lang-pt">' + escapeHtml(s.conclusion_pt) + '</span>' +
          '</p>' +
          (imgs ? '<div class="silv-study-srcs">' + imgs + '</div>' : '') +
        '</div>'
      );
    }).join('');
    return '<div class="silv-studies">' + items + '</div>';
  }

  function silvanaStudyGroupMeta(cat) {
    return ({
      imaging:    { en: 'Imaging', pt: 'Imagem' },
      endoscopy:  { en: 'Endoscopy', pt: 'Endoscopia' },
      pathology:  { en: 'Pathology', pt: 'Patologia' },
      functional: { en: 'Functional', pt: 'Funcional' },
    })[cat] || { en: cat, pt: cat };
  }

  /* Curated AI synthesis per study category — grounded in this patient's own
     studies. Rendered as an amber .ai-insight-card (design-system rule 7a) with
     the purple .ai-pill, one per section. */
  var SILVANA_STUDY_AI = {
    imaging: {
      en: '<p>Nine imaging studies span 2020 to 2026. The <strong>thyroid</strong> has been followed yearly: a small, reduced-volume gland with stable left-lobe nodules. The most recent scan (9 Feb 2026) describes a TIRADS 4 nodule (7.9 x 7.2 x 3.8 mm) alongside a TIRADS 3 nodule, so continued ultrasound surveillance and a clinician discussion about whether fine-needle aspiration is warranted are both reasonable. The <strong>abdominal ultrasound</strong> (Apr 2023) shows mild hepatic steatosis plus a 3.6 mm gallbladder polyp; the steatosis lines up with the borderline-atherogenic lipid pattern in her bloodwork, the clearest cross-domain link, and small gallbladder polyps like this are typically just monitored. <strong>Sinus CT</strong> shows a progressing leftward septal deviation (now with a bony spur) and a left maxillary retention cyst, consistent with the nasal-obstruction complaint. <strong>Mammography</strong> (May 2025) is reassuring at BI-RADS 2 and unchanged.</p>',
      pt: '<p>Nove exames de imagem cobrem de 2020 a 2026. A <strong>tireoide</strong> vem sendo acompanhada anualmente: glandula pequena, de volume reduzido, com nodulos estaveis no lobo esquerdo. O exame mais recente (9 fev 2026) descreve um nodulo TIRADS 4 (7,9 x 7,2 x 3,8 mm) ao lado de um nodulo TIRADS 3, portanto manter a vigilancia por ultrassom e discutir com o medico a necessidade de puncao aspirativa por agulha fina sao condutas razoaveis. O <strong>ultrassom de abdome</strong> (abr 2023) mostra esteatose hepatica discreta e um polipo vesicular de 3,6 mm; a esteatose conversa com o perfil lipidico borderline aterogenico dos exames de sangue, a conexao entre dominios mais clara, e polipos vesiculares pequenos como este costumam apenas ser monitorados. A <strong>TC dos seios da face</strong> mostra desvio do septo para a esquerda em progressao (agora com esporao osseo) e cisto de retencao no seio maxilar esquerdo, compativel com a queixa de obstrucao nasal. A <strong>mamografia</strong> (mai 2025) e tranquilizadora, BI-RADS 2 e sem alteracao.</p>',
    },
    endoscopy: {
      en: '<p>One colonoscopy (18 Apr 2023): a 2 mm sessile sigmoid polyp was removed and proved hyperplastic (benign), with internal hemorrhoids and an otherwise normal exam; a 5-year repeat (around 2028) was advised. Read together with the 2017 sigmoid adenoma in Pathology, this is a reassuring follow-up, but that earlier adenoma is exactly why the surveillance interval matters. Worth making sure the next colonoscopy is scheduled and not missed.</p>',
      pt: '<p>Uma colonoscopia (18 abr 2023): um polipo sessil de 2 mm no sigmoide foi removido e mostrou-se hiperplasico (benigno), com hemorroidas internas e o restante do exame normal; foi indicada repeticao em 5 anos (por volta de 2028). Lida junto com o adenoma de sigmoide de 2017 (em Patologia), e um seguimento tranquilizador, mas e justamente aquele adenoma anterior que torna o intervalo de vigilancia importante. Vale garantir que a proxima colonoscopia seja agendada e nao esquecida.</p>',
    },
    pathology: {
      en: '<p>Two tissue diagnoses. The 2017 sigmoid biopsy showed a <strong>tubular adenoma with low-grade dysplasia</strong>, a removed pre-malignant lesion that establishes a real colorectal-surveillance indication (its benign hyperplastic follow-up in 2023 sits under Endoscopy). The 2025 cervical cytology is benign, an inflammatory and hypotrophic (post-menopausal atrophic) smear, Bethesda / Papanicolaou class II, which is routine. Neither shows malignancy.</p>',
      pt: '<p>Dois diagnosticos de tecido. A biopsia de sigmoide de 2017 mostrou um <strong>adenoma tubular com displasia de baixo grau</strong>, uma lesao pre-maligna removida que estabelece uma indicacao real de vigilancia colorretal (o seguimento hiperplasico benigno de 2023 esta em Endoscopia). A citologia cervical de 2025 e benigna, um esfregaco inflamatorio e hipotrofico (atrofia pos-menopausa), classe II de Bethesda / Papanicolaou, o que e rotineiro. Nenhum mostra malignidade.</p>',
    },
    functional: {
      en: '<p>One urodynamic study (Sep 2022) for urinary urgency: free flow was normal (Qmax 21 mL/s, minimal residue), but the pressure-flow phase suggested infravesical obstruction from vaginal dystopia, with an impression of urethral instability, vaginal dystopia and vesical hyperactivity. That pattern points toward pelvic-floor and urogynecology follow-up rather than a primary bladder-muscle problem.</p>',
      pt: '<p>Um estudo urodinamico (set 2022) por urgencia miccional: o fluxo livre foi normal (Qmax 21 mL/s, residuo minimo), mas a fase de pressao-fluxo sugeriu obstrucao infravesical por distopia vaginal, com parecer de instabilidade uretral, distopia vaginal e hiperatividade vesical. Esse padrao aponta para acompanhamento de assoalho pelvico e uroginecologia, e nao para um problema primario da musculatura vesical.</p>',
    },
  };

  function silvanaStudyAiCard(cat) {
    var ai = SILVANA_STUDY_AI[cat];
    if (!ai) return '';
    return (
      '<div class="ai-insight-card silv-study-ai">' +
        '<div class="silv-study-ai-head">' +
          '<span class="ai-pill">AI</span>' +
          '<span class="silv-study-ai-title">' + t('AI Insights', 'Insights de IA') + '</span>' +
        '</div>' +
        '<div class="silv-study-ai-body lang-en">' + ai.en + '</div>' +
        '<div class="silv-study-ai-body lang-pt">' + ai.pt + '</div>' +
        '<p class="silv-study-ai-disc">' +
          t('AI-generated synthesis over these studies — for discussion with your clinician, not a diagnosis.',
            'Sintese gerada por IA sobre estes exames — para discussao com seu medico, nao um diagnostico.') +
        '</p>' +
      '</div>'
    );
  }

  // Group studies by type into separate sections (Imaging, Endoscopy, Pathology,
  // Functional). Each section: a heading, an amber AI Insights card, then the
  // study cards for that type (newest first).
  function silvanaStudiesSections(studies) {
    var order = ['imaging', 'endoscopy', 'pathology', 'functional'];
    var byCat = {};
    (studies || []).forEach(function (s) { (byCat[s.category] = byCat[s.category] || []).push(s); });
    return order.filter(function (c) { return byCat[c] && byCat[c].length; }).map(function (cat) {
      var meta = silvanaStudyGroupMeta(cat);
      return (
        '<div class="silv-study-group silv-study-group-' + cat + '">' +
          '<h3 class="silv-study-group-head">' + t(meta.en, meta.pt) +
            ' <span class="silv-study-group-count">' + byCat[cat].length + '</span></h3>' +
          silvanaStudyAiCard(cat) +
          silvanaStudiesList(byCat[cat]) +
        '</div>'
      );
    }).join('');
  }

  function injectSilvanaStyles() {
    if (document.getElementById('silvana-exams-styles')) return;
    var s = document.createElement('style');
    s.id = 'silvana-exams-styles';
    s.textContent = [
      'main.jc-silvana-exams { background: var(--surface-base, #F9F7F4); padding: 0 0 96px; }',
      'main.jc-silvana-exams .hero { background: #0D1B2A; color: #FFFFFF; padding: 48px 0 56px; }',
      'main.jc-silvana-exams .hero .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-silvana-exams .hero-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 10px; }',
      'main.jc-silvana-exams .hero-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; line-height: 1.15; color: #FFFFFF; margin: 0 0 12px; }',
      'main.jc-silvana-exams .hero-sub { color: rgba(255,255,255,0.78); font-size: 15px; line-height: 1.6; margin: 0 0 18px; max-width: 72ch; }',
      'main.jc-silvana-exams .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px; margin-top: 8px; }',
      'main.jc-silvana-exams .hero-meta-item { display: flex; flex-direction: column; gap: 2px; font-family: "IBM Plex Mono", monospace; font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0.06em; text-transform: uppercase; }',
      'main.jc-silvana-exams .hero-meta-item > span:last-child { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 400; color: #FFFFFF; text-transform: none; letter-spacing: 0; }',
      'main.jc-silvana-exams #silv-content { padding: 36px 0 16px; }',
      'main.jc-silvana-exams #silv-content > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',

      // AI summary card
      'main.jc-silvana-exams .silv-ai-summary { background: #FFFFFF; border: 1px solid #E5E2DC; border-top: 3px solid #B8954A; border-radius: 10px; padding: 22px 26px; margin-bottom: 24px; }',
      'main.jc-silvana-exams .silv-ai-summary-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }',
      'main.jc-silvana-exams .silv-ai-summary-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0; }',
      'main.jc-silvana-exams .silv-ai-summary-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-bottom: 14px; }',
      'main.jc-silvana-exams .silv-ai-summary-body { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; line-height: 1.65; color: #1E2D3D; }',
      'main.jc-silvana-exams .silv-ai-summary-body p { margin: 0 0 10px; }',
      'main.jc-silvana-exams .silv-ai-summary-body p:last-child { margin-bottom: 0; }',
      'main.jc-silvana-exams .silv-ai-summary-body strong { color: #0D1B2A; }',

      // Three big insights (Physical / Mental / Spiritual)
      'main.jc-silvana-exams .silv-insights { margin-top: 22px; padding-top: 18px; border-top: 1px solid #E5E2DC; }',
      'main.jc-silvana-exams .silv-insights-heading { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0 0 14px; }',
      'main.jc-silvana-exams .silv-insights-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }',
      '@media (max-width: 880px) { main.jc-silvana-exams .silv-insights-grid { grid-template-columns: 1fr; } }',
      'main.jc-silvana-exams .silv-insight { background: #F9F7F4; border: 1px solid #E5E2DC; border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }',
      'main.jc-silvana-exams .silv-insight-physical  { border-top: 3px solid #244E6E; }',
      'main.jc-silvana-exams .silv-insight-mental    { border-top: 3px solid #B8954A; }',
      'main.jc-silvana-exams .silv-insight-spiritual { border-top: 3px solid #7A8FA6; }',
      'main.jc-silvana-exams .silv-insight-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; }',
      'main.jc-silvana-exams .silv-insight-headline { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; line-height: 1.3; color: #0D1B2A; }',
      'main.jc-silvana-exams .silv-insight-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; }',
      'main.jc-silvana-exams .silv-insight-body p { margin: 0 0 8px; }',
      'main.jc-silvana-exams .silv-insight-body p:last-child { margin-bottom: 0; }',
      'main.jc-silvana-exams .silv-insight-body strong { color: #0D1B2A; }',
      'main.jc-silvana-exams .silv-insight-tbd .silv-insight-headline { color: #7A8FA6; font-weight: 300; font-size: 22px; letter-spacing: 0.04em; }',
      'main.jc-silvana-exams .silv-insight-tbd .silv-insight-body { color: #7A8FA6; font-style: italic; }',

      // Per-marker history table
      'main.jc-silvana-exams .silv-hist { margin-top: 10px; }',
      'main.jc-silvana-exams .silv-hist summary { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.04em; color: #244E6E; cursor: pointer; padding: 6px 8px; background: #F4F1EA; border: 1px solid #E5E2DC; border-radius: 6px; list-style: none; }',
      'main.jc-silvana-exams .silv-hist summary::-webkit-details-marker { display: none; }',
      'main.jc-silvana-exams .silv-hist summary::before { content: "▸"; display: inline-block; width: 12px; margin-right: 4px; transition: transform 0.15s; }',
      'main.jc-silvana-exams .silv-hist[open] summary::before { transform: rotate(90deg); }',
      'main.jc-silvana-exams .silv-hist-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      'main.jc-silvana-exams .silv-hist-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 6px 8px; border-bottom: 1px solid #E5E2DC; }',
      'main.jc-silvana-exams .silv-hist-table td { padding: 6px 8px; border-bottom: 1px solid #EFEBE3; vertical-align: top; color: #1E2D3D; }',
      'main.jc-silvana-exams .silv-hist-row-latest td { background: rgba(184, 149, 74, 0.06); font-weight: 500; }',
      'main.jc-silvana-exams .silv-hist-row-flag .silv-hist-val { color: #7A2E22; }',
      'main.jc-silvana-exams .silv-hist-date { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; white-space: nowrap; }',
      'main.jc-silvana-exams .silv-hist-val { font-family: "IBM Plex Mono", monospace; }',
      'main.jc-silvana-exams .silv-hist-note { font-size: 11px; color: #7A8FA6; }',
      'main.jc-silvana-exams .silv-latest-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',

      // Historical comparison table cell coloring
      'main.jc-silvana-exams .lab-cmp-val[data-flag="high"] { color: #7A2E22; }',
      'main.jc-silvana-exams .lab-cmp-val[data-flag="low"]  { color: #B8862B; }',

      // Source PDF list
      'main.jc-silvana-exams .silv-docs { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }',
      'main.jc-silvana-exams .silv-doc-link { display: block; padding: 12px 14px; border: 1px solid #E5E2DC; border-radius: 8px; background: #FFFFFF; color: #0D1B2A; text-decoration: none; transition: border-color 0.12s, transform 0.06s; }',
      'main.jc-silvana-exams .silv-doc-link:hover { border-color: #B8954A; transform: translateY(-1px); }',
      'main.jc-silvana-exams .silv-doc-title { display: block; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 500; margin-bottom: 4px; }',
      'main.jc-silvana-exams .silv-doc-meta { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; }',

      // Imaging & diagnostic studies
      'main.jc-silvana-exams .silv-studies { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }',
      'main.jc-silvana-exams .silv-study { background: #FFFFFF; border: 1px solid #E5E2DC; border-left: 4px solid #7A8FA6; border-radius: 10px; padding: 16px 18px; }',
      'main.jc-silvana-exams .silv-study-imaging    { border-left-color: #244E6E; }',
      'main.jc-silvana-exams .silv-study-pathology  { border-left-color: #7A2E22; }',
      'main.jc-silvana-exams .silv-study-endoscopy  { border-left-color: #B8954A; }',
      'main.jc-silvana-exams .silv-study-functional { border-left-color: #3E7CA3; }',
      'main.jc-silvana-exams .silv-study-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }',
      'main.jc-silvana-exams .silv-study-cat { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: #EEF1F4; color: #566; }',
      'main.jc-silvana-exams .silv-study-cat-imaging    { background: #E7EEF5; color: #244E6E; }',
      'main.jc-silvana-exams .silv-study-cat-pathology  { background: #F4E7E3; color: #7A2E22; }',
      'main.jc-silvana-exams .silv-study-cat-endoscopy  { background: #F7F0DD; color: #8a6d23; }',
      'main.jc-silvana-exams .silv-study-cat-functional { background: #E8F0F4; color: #2c6080; }',
      'main.jc-silvana-exams .silv-study-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',
      'main.jc-silvana-exams .silv-study-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; line-height: 1.25; color: #0D1B2A; margin-bottom: 5px; }',
      'main.jc-silvana-exams .silv-study-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-bottom: 9px; line-height: 1.5; }',
      'main.jc-silvana-exams .silv-study-concl { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.55; color: #1E2D3D; margin: 0 0 10px; }',
      'main.jc-silvana-exams .silv-study-srcs { display: flex; flex-wrap: wrap; gap: 8px; }',
      'main.jc-silvana-exams .silv-study-src { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #244E6E; text-decoration: none; border: 1px solid #E5E2DC; border-radius: 6px; padding: 4px 10px; background: #F4F1EA; }',
      'main.jc-silvana-exams .silv-study-src:hover { border-color: #B8954A; }',

      // Grouped sections (Imaging / Endoscopy / Pathology / Functional) + amber AI card
      'main.jc-silvana-exams .silv-study-group { margin-bottom: 30px; }',
      'main.jc-silvana-exams .silv-study-group-head { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 17px; color: #0D1B2A; margin: 20px 0 12px; display: flex; align-items: center; gap: 9px; }',
      'main.jc-silvana-exams .silv-study-group-count { font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 500; color: #7A8FA6; background: #EEF1F4; border-radius: 999px; padding: 1px 9px; }',
      // amber background + stroke come from the shared .ai-insight-card token rule in styles.css
      'main.jc-silvana-exams .silv-study-ai { border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }',
      'main.jc-silvana-exams .silv-study-ai-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }',
      'main.jc-silvana-exams .silv-study-ai-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: #0D1B2A; }',
      'main.jc-silvana-exams .silv-study-ai-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; }',
      'main.jc-silvana-exams .silv-study-ai-body p { margin: 0; }',
      'main.jc-silvana-exams .silv-study-ai-body strong { color: #0D1B2A; }',
      'main.jc-silvana-exams .silv-study-ai-disc { font-size: 11px; font-style: italic; color: #8a6d23; margin: 8px 0 0; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* Physical → overview landing for Silvana. Two entry cards, modeled
     on Joao's physical.html: Sinais Vitais and Exames. Genetics is
     intentionally out for now — no data uploaded yet. */
  function renderSilvanaPhysicalLanding() {
    injectSilvanaStyles();
    injectSilvanaLandingStyles();
    document.title = 'Lumen Health — Physical · Silvana Creste';

    var hero =
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' + t('Physical', 'Físico') + '</div>' +
          '<h1 class="hero-title">' +
            t('Physical health overview · Silvana Creste',
              'Visão geral da saúde física · Silvana Creste') +
          '</h1>' +
          '<p class="hero-sub">' +
            t('Two views of the same patient — daily and periodic vitals (body composition, future wearables), and point-in-time labs spanning 2019 to 2026.',
              'Duas visões do mesmo paciente — sinais vitais diários e periódicos (composição corporal e, no futuro, wearables) e exames laboratoriais pontuais de 2019 a 2026.') +
          '</p>' +
        '</div>' +
      '</section>';

    var cards =
      '<section class="silv-landing">' +
        '<div class="container">' +
          '<div class="silv-landing-grid">' +
            // Sinais Vitais
            '<a class="silv-landing-card" href="physical-vitals.html">' +
              '<svg class="silv-landing-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<circle cx="32" cy="32" r="22" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
                '<polyline points="14,32 22,32 26,22 30,42 34,28 38,36 42,32 50,32" ' +
                  'stroke="#3E7CA3" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
              '</svg>' +
              '<div class="silv-landing-title">' + t('Vitals', 'Sinais vitais') + '</div>' +
              '<div class="silv-landing-status">' +
                '<span class="pill pill-flag">' + t('Body fat above range', 'Gordura acima da faixa') + '</span>' +
                '<span class="pill pill-watch">' + t('Lower-body lean deficit', 'Déficit muscular nas pernas') + '</span>' +
              '</div>' +
              '<ul class="silv-landing-bullets">' +
                '<li>' + t('InBody120 body composition (11 Feb 2026)',
                           'Composição corporal InBody120 (11 fev 2026)') + '</li>' +
                '<li>' + t('Segmental lean + fat mass · 5 anatomical regions',
                           'Massa magra e gordura segmentar · 5 regiões anatômicas') + '</li>' +
                '<li>' + t('Two-timepoint history with delta',
                           'Histórico com 2 medidas e delta') + '</li>' +
              '</ul>' +
              '<span class="silv-landing-cta">' + t('Open', 'Abrir') + ' →</span>' +
            '</a>' +
            // Exames
            '<a class="silv-landing-card" href="physical-exams.html">' +
              '<svg class="silv-landing-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<line x1="20" y1="8" x2="44" y2="8" stroke="#244E6E" stroke-width="2.5" stroke-linecap="round"/>' +
                '<path d="M22 8 L22 46 C22 52 26 56 32 56 C38 56 42 52 42 46 L42 8 Z" ' +
                  'fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M22 34 L22 46 C22 52 26 56 32 56 C38 56 42 52 42 46 L42 34 Z" fill="#3E7CA3"/>' +
                '<circle cx="28" cy="44" r="2" fill="#FFFFFF" opacity="0.8"/>' +
                '<circle cx="35" cy="50" r="1.5" fill="#FFFFFF" opacity="0.8"/>' +
              '</svg>' +
              '<div class="silv-landing-title">' + t('Exams', 'Exames') + '</div>' +
              '<div class="silv-landing-status">' +
                '<span class="pill pill-watch">' + t('Borderline lipid drift', 'Drift lipídico borderline') + '</span>' +
                '<span class="pill pill-info">' + t('7-year lab history', 'Histórico de 7 anos') + '</span>' +
              '</div>' +
              '<ul class="silv-landing-bullets">' +
                '<li>' + t('Multi-year lab markers · Jun 2019 → Apr 2026',
                           'Marcadores laboratoriais · jun 2019 → abr 2026') + '</li>' +
                '<li>' + t('Side-by-side comparison across every panel',
                           'Comparação lado a lado em todos os painéis') + '</li>' +
                '<li>' + t('AI summary with three pillar insights',
                           'Resumo da IA com três insights por pilar') + '</li>' +
              '</ul>' +
              '<span class="silv-landing-cta">' + t('Open', 'Abrir') + ' →</span>' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</section>';

    var main = document.createElement('main');
    main.className = 'jc-silvana-exams jc-silvana-landing';
    main.innerHTML = hero + cards;
    document.body.appendChild(main);
    injectDangerZone(main);
  }

  function injectSilvanaLandingStyles() {
    if (document.getElementById('silvana-landing-styles')) return;
    var s = document.createElement('style');
    s.id = 'silvana-landing-styles';
    s.textContent = [
      'main.jc-silvana-landing .silv-landing { padding: 36px 0 24px; }',
      'main.jc-silvana-landing .silv-landing > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      'main.jc-silvana-landing .silv-landing-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }',
      '@media (max-width: 880px) { main.jc-silvana-landing .silv-landing-grid { grid-template-columns: 1fr; } }',
      'main.jc-silvana-landing .silv-landing-card { display: flex; flex-direction: column; gap: 12px; padding: 22px 24px; background: #FFFFFF; border: 1px solid #E5E2DC; border-top: 3px solid #244E6E; border-radius: 10px; text-decoration: none; color: inherit; transition: transform 0.12s, border-color 0.12s, box-shadow 0.12s; }',
      'main.jc-silvana-landing .silv-landing-card:hover { transform: translateY(-2px); border-color: #B8954A; box-shadow: 0 6px 18px rgba(13,27,42,0.08); }',
      'main.jc-silvana-landing .silv-landing-icon { width: 56px; height: 56px; }',
      'main.jc-silvana-landing .silv-landing-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 18px; color: #0D1B2A; }',
      'main.jc-silvana-landing .silv-landing-status { display: flex; flex-wrap: wrap; gap: 6px; }',
      'main.jc-silvana-landing .silv-landing-bullets { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; color: #1E2D3D; line-height: 1.45; }',
      'main.jc-silvana-landing .silv-landing-bullets li { position: relative; padding-left: 14px; }',
      'main.jc-silvana-landing .silv-landing-bullets li::before { content: "·"; position: absolute; left: 4px; color: #B8954A; font-weight: 700; }',
      'main.jc-silvana-landing .silv-landing-cta { margin-top: auto; font-family: "IBM Plex Mono", monospace; font-size: 12px; color: #244E6E; letter-spacing: 0.04em; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function renderSilvanaPhysicalExams() {
    if (!window.SILVANA_LABS) {
      console.error('SILVANA_LABS data not loaded — expected via assets/silvana-labs.js');
      renderEmptyShell(patient, 'Silvana Creste', t('Physical → Exams', 'Físico → Exames'));
      return;
    }
    injectSilvanaStyles();
    document.title = 'Lumen Health — Physical · Exams · Silvana Creste';

    var data = window.SILVANA_LABS;
    var dates = [];
    data.panels.forEach(function (pn) {
      pn.markers.forEach(function (m) {
        (m.points || []).forEach(function (p) { if (p.date) dates.push(p.date); });
      });
    });
    dates.sort();
    var firstDate = dates[0];
    var lastDate  = dates[dates.length - 1];

    var hero =
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' + t('Physical → Exams', 'Físico → Exames') + '</div>' +
          '<h1 class="hero-title">' +
            t('Lab history · Silvana Creste',
              'Histórico laboratorial · Silvana Creste') +
          '</h1>' +
          '<p class="hero-sub">' +
            t('Lab markers consolidated from ' + data.documents.length + ' source PDFs spanning ' + formatDate(firstDate) + ' to ' + formatDate(lastDate) + '. Each panel below shows the latest result with reference range and status pill; expand the per-marker history toggle to see every prior sample. A single side-by-side comparison table at the bottom puts every date on one grid.',
              'Marcadores laboratoriais consolidados a partir de ' + data.documents.length + ' PDFs originais, de ' + formatDate(firstDate) + ' a ' + formatDate(lastDate) + '. Cada painel abaixo mostra o resultado mais recente com intervalo de referência e o status; expanda o histórico de cada marcador para ver as amostras anteriores. Uma tabela única no fim coloca todas as datas lado a lado.') +
          '</p>' +
          '<div class="hero-meta">' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Patient', 'Paciente') + '</span><span>' + escapeHtml(data.patient.full_name) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('DOB · age', 'Nasc. · idade') + '</span>' +
              '<span>29 ' + t('Sep', 'set') + ' 1967 · 58</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Date range', 'Intervalo') + '</span>' +
              '<span>' + escapeHtml(formatDate(firstDate)) + ' → ' + escapeHtml(formatDate(lastDate)) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Source PDFs', 'PDFs originais') + '</span>' +
              '<span>' + data.documents.length + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Markers tracked', 'Marcadores') + '</span>' +
              '<span>' + data.panels.reduce(function (acc, pn) { return acc + pn.markers.length; }, 0) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Imaging & studies', 'Imagem & estudos') + '</span>' +
              '<span>' + ((data.studies && data.studies.length) || 0) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    var ai =
      '<section class="silv-ai-summary">' +
        '<header class="silv-ai-summary-head">' +
          '<h2>' + t('AI summary · 7-year lab review', 'Resumo da IA · 7 anos de exames') + '</h2>' +
          '<span class="ai-pill">AI</span>' +
        '</header>' +
        '<div class="silv-ai-summary-meta">' +
          t('Synthesised from ' + data.documents.length + ' source PDFs · ' + formatDate(firstDate) + ' → ' + formatDate(lastDate),
            'Sintetizado a partir de ' + data.documents.length + ' PDFs · ' + formatDate(firstDate) + ' a ' + formatDate(lastDate)) +
        '</div>' +
        '<div class="silv-ai-summary-body lang-en">' +
          '<p>Across 7 years of bloodwork (Jun 2019 → Apr 2026), the dominant clinical pattern is a <strong>persistent borderline atherogenic lipid profile</strong> — total cholesterol has stayed in the 196–233 mg/dL range with triglycerides chronically above 150 mg/dL (peaking at 233 mg/dL in 2023) and non-HDL hovering near or above 160 mg/dL. LDL is creeping up since 2024 and HDL has improved modestly. <strong>Glucose handling is well preserved</strong>: HbA1c has trended down (5.5 → 5.2 → 5.1%) despite the lipid drift, with HOMA-IR 1.05 in 2022 — no insulin resistance.</p>' +
          '<p>The <strong>thyroid axis is mostly stable but variable</strong>: TSH bounced between 2.4 and 4.0 µIU/mL across years, briefly crossing the upper bound at <strong>4.755 µIU/mL on 18 Feb 2026</strong> before returning to 2.7–3.0 µIU/mL six weeks later. T4-free has remained euthyroid throughout. Worth a repeat TSH in 6–12 weeks rather than treating on the single elevated reading. The <strong>full Oct 2025 autoimmune panel was clean</strong> — ANA non-reactive, anti-CCP / anti-SSA / anti-SSB / ANCA all negative, rheumatoid factor 2.5 — but complement C3 ran high at <strong>162.6 mg/dL</strong>, consistent with an acute-phase response rather than active disease. The Dec 2025 allergy panel was uniformly negative (all 9 specific IgEs &lt; 0.10 kU/L; total IgE 21 UI/mL).</p>' +
          '<p>Two functional findings stand out: a <strong>flat lactose tolerance curve in Apr 2022</strong> (Δ glucose 18.5 mg/dL vs. normal &gt; 30 mg/dL) consistent with lactase deficiency, and <strong>moderate diamine oxidase activity (6.99 U/mL, 55 HDU)</strong> in Mar 2026 — within range but at the lower-middle of "moderate", supporting the histamine-intolerance workup Dr. Janaina ordered. Vitamin D climbed steadily from 35.1 (2019) → 61.49 ng/mL (2026), now just above the upper risk-group bound — worth reviewing supplementation. Kidney function had one transient eGFR dip to <strong>58.2 mL/min/1.73m²</strong> on 18 Feb 2026 (creatinine 1.10) but rebounded by 25 Apr (creatinine 1.00).</p>' +
        '</div>' +
        '<div class="silv-ai-summary-body lang-pt">' +
          '<p>Ao longo de 7 anos (jun 2019 → abr 2026), o padrão dominante é um <strong>perfil lipídico persistentemente borderline aterogênico</strong> — colesterol total entre 196 e 233 mg/dL, triglicérides cronicamente acima de 150 mg/dL (pico de 233 mg/dL em 2023) e não-HDL próximo ou acima de 160 mg/dL. LDL em alta desde 2024 e HDL com leve melhora. <strong>O metabolismo glicêmico está bem preservado</strong>: HbA1c em queda (5,5 → 5,2 → 5,1%) apesar do drift lipídico, com HOMA-IR 1,05 em 2022 — sem resistência à insulina.</p>' +
          '<p>O <strong>eixo tireoidiano é majoritariamente estável, mas variável</strong>: TSH oscilou entre 2,4 e 4,0 µIU/mL ao longo dos anos, cruzando brevemente o limite superior em <strong>4,755 µIU/mL em 18 fev 2026</strong> antes de retornar para 2,7–3,0 µIU/mL seis semanas depois. T4 livre permaneceu eutireoidiano. Vale repetir o TSH em 6–12 semanas em vez de tratar com base em uma única medida elevada. O <strong>painel autoimune completo de out 2025 está limpo</strong> — FAN não reagente, anti-CCP / anti-SSA / anti-SSB / ANCA negativos, FR 2,5 — porém o complemento C3 veio alto em <strong>162,6 mg/dL</strong>, compatível com resposta de fase aguda, não doença ativa. O painel de alergia de dez 2025 veio uniformemente negativo (todos os 9 IgE específicos &lt; 0,10 kU/L; IgE total 21 UI/mL).</p>' +
          '<p>Dois achados funcionais se destacam: a <strong>curva de lactose plana em abr 2022</strong> (Δ glicose 18,5 mg/dL vs. normal &gt; 30 mg/dL), compatível com deficiência de lactase, e <strong>atividade da DAO moderada (6,99 U/mL, 55 HDU)</strong> em mar 2026 — dentro do intervalo, mas no terço inferior da faixa "moderada", apoiando a investigação de intolerância à histamina solicitada pela Dra. Janaina. Vitamina D subiu de 35,1 (2019) → 61,49 ng/mL (2026), agora logo acima do limite superior do grupo de risco — vale revisar a suplementação. A função renal teve uma queda transitória da TFG para <strong>58,2 mL/min/1,73m²</strong> em 18 fev 2026 (creatinina 1,10), com recuperação em 25 abr (creatinina 1,00).</p>' +
        '</div>' +

        // ── Three big insights, one per pillar ─────────────────────
        '<div class="silv-insights">' +
          '<div class="silv-insights-heading">' +
            t('Three big insights', 'Três grandes insights') +
          '</div>' +
          '<div class="silv-insights-grid">' +

            // ── Physical ──
            '<div class="silv-insight silv-insight-physical">' +
              '<div class="silv-insight-eyebrow">' + t('Physical', 'Físico') + '</div>' +
              '<div class="silv-insight-headline">' +
                t('Pilates 2× per week + brisk walking 30 min daily',
                  'Pilates 2× por semana + caminhada vigorosa 30 min/dia') +
              '</div>' +
              '<div class="silv-insight-body lang-en">' +
                '<p>The single combination that directly targets the dominant 7-year pattern — chronically borderline-high cholesterol and triglycerides — while protecting post-menopausal bone density and lumbar / core stability. Aerobic load (walking) is the highest-yield intervention for triglycerides and HDL; Pilates loads the spine isometrically and builds the deep stabilisers that matter most after 55.</p>' +
                '<p><strong>Lab-side follow-ups inside this pillar:</strong> repeat TSH in 6–12 weeks to confirm the Feb 2026 spike isn\'t sustained; recheck creatinine in 3 months to rule out a sustained eGFR drop; lipid recheck 6 weeks after starting the routine; reassess Vitamin D dose given the climb to 61.49 ng/mL; advance the histamine-intolerance workup (DAO + clinical) to the dietary trial Dr. Janaina recommended.</p>' +
              '</div>' +
              '<div class="silv-insight-body lang-pt">' +
                '<p>A combinação que ataca o padrão dominante dos últimos 7 anos — colesterol e triglicérides cronicamente acima do alvo — ao mesmo tempo que protege a densidade óssea pós-menopausa e a estabilidade lombar / do core. Carga aeróbica (caminhada) é a intervenção de maior retorno para triglicérides e HDL; o Pilates carrega a coluna de forma isométrica e fortalece os estabilizadores profundos que mais importam após os 55 anos.</p>' +
                '<p><strong>Acompanhamentos laboratoriais deste pilar:</strong> repetir TSH em 6–12 semanas para confirmar se a alta de fev 2026 é sustentada; refazer creatinina em 3 meses para descartar queda sustentada da TFG; novo lipidograma 6 semanas após iniciar a rotina; reavaliar dose de vitamina D após a subida para 61,49 ng/mL; avançar a investigação de intolerância à histamina (DAO + clínica) para o trial dietético recomendado pela Dra. Janaina.</p>' +
              '</div>' +
            '</div>' +

            // ── Mental ──
            '<div class="silv-insight silv-insight-mental">' +
              '<div class="silv-insight-eyebrow">' + t('Mental', 'Mental') + '</div>' +
              '<div class="silv-insight-headline">' +
                t('Quarterly clinical-psychology check-in + annual cognitive baseline',
                  'Check-in trimestral com psicólogo clínico + avaliação cognitiva anual') +
              '</div>' +
              '<div class="silv-insight-body lang-en">' +
                '<p>No mental-health data has been ingested yet, which is itself the strongest argument for a structured baseline. The post-menopausal life-phase transition (mood, sleep architecture, executive function) deserves a dedicated channel rather than being absorbed into routine medical visits. A quarterly cadence is enough to catch drift without medicalising normal variation, and an annual cognitive screen establishes a reference point now (while measurement is easy) for any future comparison.</p>' +
                '<p>The Feb 2024 morning cortisol of <strong>5.93 µg/dL</strong> (below the 7–21 µg/dL window) is the one biological signal in this dataset that touches the stress / HPA axis — it would be worth a single repeat alongside the next routine bloodwork, especially if sleep or energy is a current complaint.</p>' +
              '</div>' +
              '<div class="silv-insight-body lang-pt">' +
                '<p>Nenhum dado de saúde mental foi ingerido ainda — o que é, em si, o argumento mais forte para uma avaliação de base estruturada. A transição da pós-menopausa (humor, arquitetura do sono, função executiva) merece um canal próprio, em vez de ser absorvida nas consultas médicas de rotina. Uma cadência trimestral basta para captar drift sem medicalizar variação normal, e uma triagem cognitiva anual estabelece desde já uma referência (enquanto a medida é fácil) para qualquer comparação futura.</p>' +
                '<p>O cortisol matinal de fev 2024 em <strong>5,93 µg/dL</strong> (abaixo da janela 7–21 µg/dL) é o único sinal biológico deste conjunto que toca o eixo HPA / estresse — vale uma única repetição junto da próxima coleta de rotina, sobretudo se houver queixa atual de sono ou energia.</p>' +
              '</div>' +
            '</div>' +

            // ── Spiritual ──
            '<div class="silv-insight silv-insight-spiritual silv-insight-tbd">' +
              '<div class="silv-insight-eyebrow">' + t('Spiritual', 'Espiritual') + '</div>' +
              '<div class="silv-insight-headline">TBD</div>' +
              '<div class="silv-insight-body lang-en">' +
                '<p>No spiritual / values data ingested yet — no life-event log, no wheel-of-life self-assessment, no journal or writing samples. Until any of those exist for this patient, this pillar stays empty by design rather than being filled with generic copy.</p>' +
                '<p>The moment a wheel-of-life CSV, a life-event timeline or a few journal entries are added via <em>Add data</em>, the AI will surface alignment patterns and meaning-related insights here in the same shape as the other two pillars.</p>' +
              '</div>' +
              '<div class="silv-insight-body lang-pt">' +
                '<p>Nenhum dado espiritual / de valores foi ingerido ainda — sem registro de eventos de vida, sem autoavaliação da roda da vida, sem amostras de diário ou escrita. Enquanto nada disso existir para a paciente, este pilar fica intencionalmente vazio em vez de ser preenchido com texto genérico.</p>' +
                '<p>No momento em que um CSV da roda da vida, uma linha do tempo de eventos ou algumas entradas de diário forem adicionados em <em>Adicionar dados</em>, a IA vai trazer aqui padrões de alinhamento e insights de sentido no mesmo formato dos outros dois pilares.</p>' +
              '</div>' +
            '</div>' +

          '</div>' +
        '</div>' +
      '</section>';

    var imagery =
      '<section id="silv-content">' +
        '<div class="container">' +
          ai +
          '<div class="section-label">' + t('09A · Labs', '09A · Exames') + '</div>' +
          '<h2 class="section-title">' + t('Lab panels', 'Painéis laboratoriais') + '</h2>' +
          '<p class="section-desc">' +
            t('Each panel shows the latest result with its reference bar and status pill. Click "historical samples" beneath each marker to see every prior value. The historical comparison table near the bottom puts every date side-by-side.',
              'Cada painel mostra o resultado mais recente com a barra de referência e o status. Clique em "amostras anteriores" abaixo de cada marcador para ver todos os valores. A tabela de comparação histórica ao final coloca todas as datas lado a lado.') +
          '</p>' +
          '<div class="lab-panel-grid">' +
            data.panels.map(silvanaPanelDetails).join('') +
          '</div>' +
          silvanaHistoricalComparison(data.panels) +
          (data.studies && data.studies.length ?
            '<div class="section-label" style="margin-top:32px;">' + t('09B · Imaging & studies', '09B · Imagem & estudos') + '</div>' +
            '<h2 class="section-title">' + t('Imaging & diagnostic studies', 'Estudos de imagem e diagnósticos') + '</h2>' +
            '<p class="section-desc">' +
              t('Non-lab diagnostic exams grouped by type — Imaging, Endoscopy, Pathology and Functional. Each group opens with an AI Insights synthesis; the cards beneath it are newest-first and link their original report.',
                'Exames diagnósticos não laboratoriais agrupados por tipo — Imagem, Endoscopia, Patologia e Funcional. Cada grupo abre com uma síntese de Insights de IA; os cartões abaixo vêm dos mais recentes aos mais antigos e trazem o laudo original.') +
            '</p>' +
            silvanaStudiesSections(data.studies)
          : '') +
          '<div class="section-label" style="margin-top:32px;">' + t('Source PDFs', 'PDFs originais') + '</div>' +
          '<h2 class="section-title">' + t('Original lab reports', 'Laudos originais') + '</h2>' +
          '<p class="section-desc">' +
            t('All ' + data.documents.length + ' source PDFs are available below. Click any to download the original lab report.',
              'Todos os ' + data.documents.length + ' PDFs originais estão disponíveis abaixo. Clique para baixar o laudo original.') +
          '</p>' +
          silvanaDocsList(data.documents) +
        '</div>' +
      '</section>';

    var main = document.createElement('main');
    main.className = 'jc-silvana-exams';
    main.innerHTML = hero + imagery;
    document.body.appendChild(main);

    injectDangerZone(main);
  }

  /* Cristina imaging studies — full report text (verbatim PT + EN), the
     plain-language AI synthesis card, and source-scan links. Reuses the
     Silvana study-card / AI-card classes; .cris-rep-block styles the
     findings/impression sub-lists. Report-only studies (no slice stacks),
     so there is no viewer — the laudo itself is the whole view. */
  function cristinaReportBlock(labelEn, labelPt, en, pt) {
    if (!en || !en.length) return '';
    var li = function (x) { return '<li>' + escapeHtml(x) + '</li>'; };
    return (
      '<div class="cris-rep-block">' +
        '<h4>' + t(labelEn, labelPt) + '</h4>' +
        '<ul class="lang-en">' + en.map(li).join('') + '</ul>' +
        '<ul class="lang-pt">' + pt.map(li).join('') + '</ul>' +
      '</div>'
    );
  }

  function cristinaStudyCard(s) {
    var src = (s.images || []).map(function (img) {
      return '<a href="scans/' + escapeHtml(img) + '" target="_blank" rel="noopener" class="silv-study-src">' +
        t('View source laudo', 'Ver laudo original') + '</a>';
    }).join('');
    var tech = s.technique_en
      ? '<p class="silv-study-concl"><strong>' + t('Technique', 'Técnica') + ':</strong> ' +
          '<span class="lang-en">' + escapeHtml(s.technique_en) + '</span>' +
          '<span class="lang-pt">' + escapeHtml(s.technique_pt) + '</span></p>'
      : '';
    return (
      '<div class="silv-study silv-study-imaging">' +
        '<div class="silv-study-head">' +
          '<span class="silv-study-cat silv-study-cat-imaging">' +
            t('Imaging', 'Imagem') + ' · ' + escapeHtml(s.modality) + '</span>' +
          '<span class="silv-study-date">' + escapeHtml(formatDate(s.date)) + '</span>' +
        '</div>' +
        '<div class="silv-study-title">' +
          '<span class="lang-en">' + escapeHtml(s.title_en) + '</span>' +
          '<span class="lang-pt">' + escapeHtml(s.title_pt) + '</span>' +
        '</div>' +
        '<div class="silv-study-meta">' +
          escapeHtml(s.laboratory || '—') +
          (s.doctor ? ' · ' + escapeHtml(s.doctor) : '') +
          (s.requested_by ? ' · ' + t('req. ', 'sol. ') + escapeHtml(s.requested_by) : '') +
        '</div>' +
        tech +
        cristinaReportBlock('Findings', 'Análise', s.findings_en, s.findings_pt) +
        cristinaReportBlock('Impression', 'Impressão diagnóstica', s.impression_en, s.impression_pt) +
        (src ? '<div class="silv-study-srcs">' + src + '</div>' : '') +
      '</div>'
    );
  }

  function cristinaImagingSection(data) {
    var studies = (data.studies || []).filter(function (s) { return s.category === 'imaging'; });
    if (!studies.length) return '';
    var ai = data.imaging_ai;
    var aiCard = !ai ? '' : (
      '<div class="ai-insight-card silv-study-ai">' +
        '<div class="silv-study-ai-head">' +
          '<span class="ai-pill">AI</span>' +
          '<span class="silv-study-ai-title">' + t('AI Insights', 'Insights de IA') + '</span>' +
        '</div>' +
        '<div class="silv-study-ai-body lang-en">' + ai.en + '</div>' +
        '<div class="silv-study-ai-body lang-pt">' + ai.pt + '</div>' +
        '<p class="silv-study-ai-disc">' +
          t('AI-generated summary of the radiologist’s report — for discussion with your doctor, not a diagnosis.',
            'Resumo gerado por IA do laudo do radiologista — para discussão com seu médico, não um diagnóstico.') +
        '</p>' +
      '</div>'
    );
    return (
      '<style>' +
        '.jc-cristina-exams .cris-rep-block{margin:10px 0 0;}' +
        '.jc-cristina-exams .cris-rep-block h4{margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;opacity:.7;}' +
        '.jc-cristina-exams .cris-rep-block ul{margin:0;padding-left:18px;}' +
        '.jc-cristina-exams .cris-rep-block li{margin:2px 0;line-height:1.5;}' +
      '</style>' +
      '<div class="section-label">' + t('Imaging studies', 'Estudos de imagem') + '</div>' +
      '<h2 class="section-title">' + t('Right-shoulder MRI', 'RM do ombro direito') +
        ' <span class="ov-count-inline">' + studies.length + '</span></h2>' +
      '<p class="section-desc">' +
        t('A single DIAGi report (15 Jun 2026) with two reads: an MRI of the right shoulder and a plain X-ray of both shoulders. Each card shows the radiologist’s full report; the AI card explains it in plain language.',
          'Um único laudo da DIAGi (15 jun 2026) com duas leituras: a RM do ombro direito e o raio-X dos dois ombros. Cada cartão traz o laudo completo do radiologista; o cartão de IA explica em linguagem simples.') +
      '</p>' +
      aiCard +
      '<div class="silv-studies">' + studies.map(cristinaStudyCard).join('') + '</div>'
    );
  }

  /* ── Cristina Cresti · bespoke lab-history page ─────────────────────
     Reads window.CRISTINA_LABS (loaded via assets/cristina-labs.js) and
     reuses the Silvana exam scaffolding (styles + panel/marker/doc
     helpers). Carries a thyroid-autoantibody panel plus a shoulder MRI
     imaging study (full report text + AI synthesis). */
  function renderCristinaPhysicalExams() {
    if (!window.CRISTINA_LABS) {
      console.error('CRISTINA_LABS data not loaded — expected via assets/cristina-labs.js');
      renderEmptyShell(patient, 'Cristina Cresti', t('Physical → Exams', 'Físico → Exames'));
      return;
    }
    injectSilvanaStyles();
    document.title = 'Lumen Health — Physical · Exams · Cristina Cresti';

    var data = window.CRISTINA_LABS;
    var nMarkers = data.panels.reduce(function (acc, pn) { return acc + pn.markers.length; }, 0);
    var nStudies = (data.studies || []).length;
    var doc = (data.documents && data.documents[0]) || {};
    var examDate = doc.date || '2026-03-11';

    var hero =
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' + t('Physical → Exams', 'Físico → Exames') + '</div>' +
          '<h1 class="hero-title">' +
            t('Exams · Cristina Cresti', 'Exames · Cristina Cresti') +
          '</h1>' +
          '<p class="hero-sub">' +
            t('The newest exam is a right-shoulder MRI (DIAGi, 15 Jun 2026) showing a full-thickness rotator-cuff tear — the radiologist’s full report and a plain-language explanation are below. A thyroid-autoantibody panel follows, with each marker’s reference range and status. As more reports are added they appear here automatically.',
              'O exame mais recente é uma RM do ombro direito (DIAGi, 15 jun 2026) que mostra uma rotura de espessura completa do manguito rotador — o laudo completo do radiologista e uma explicação em linguagem simples estão abaixo. Em seguida vem um painel de autoanticorpos tireoidianos, com o intervalo de referência e o status de cada marcador. À medida que novos laudos forem adicionados, eles aparecem aqui automaticamente.') +
          '</p>' +
          '<div class="hero-meta">' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Patient', 'Paciente') + '</span><span>' + escapeHtml(data.patient.full_name) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Latest document', 'Documento mais recente') + '</span>' +
              '<span>' + escapeHtml(formatDate(examDate)) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Imaging studies', 'Exames de imagem') + '</span>' +
              '<span>' + nStudies + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Lab markers', 'Marcadores') + '</span>' +
              '<span>' + nMarkers + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Source documents', 'Documentos') + '</span>' +
              '<span>' + (data.documents ? data.documents.length : 0) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';

    var ai =
      '<section class="silv-ai-summary">' +
        '<header class="silv-ai-summary-head">' +
          '<h2>' + t('AI summary · thyroid autoantibody panel', 'Resumo da IA · painel de autoanticorpos tireoidianos') + '</h2>' +
          '<span class="ai-pill">AI</span>' +
        '</header>' +
        '<div class="silv-ai-summary-meta">' +
          t('Synthesised from 1 source document · ' + formatDate(examDate),
            'Sintetizado a partir de 1 documento · ' + formatDate(examDate)) +
        '</div>' +
        '<div class="silv-ai-summary-body lang-en">' +
          '<p>The first ingested exam is a <strong>thyroid-autoantibody screen</strong>. Both markers are <strong>negative (non-reactive)</strong>: anti-microsomal / anti-TPO &lt; 0.25 UI/mL (reference &lt; 9.00) and anti-thyroglobulin &lt; 0.90 UI/mL (reference &lt; 4.00). Each result sits well below its upper reference limit, with no autoantibody signal detected.</p>' +
          '<p>This argues <strong>against autoimmune thyroid disease</strong> (e.g. Hashimoto\'s thyroiditis), the most common cause of which is anti-TPO positivity. Note this panel measures <strong>antibodies only</strong> — it does not assess thyroid <em>function</em>. A normal antibody result does not rule out a functional abnormality. To complete the picture, correlate with <strong>TSH and free T4</strong> if not already on file. A registry / source-document birth-date discrepancy is flagged for the maintainer (see source card).</p>' +
        '</div>' +
        '<div class="silv-ai-summary-body lang-pt">' +
          '<p>O primeiro exame ingerido é uma <strong>triagem de autoanticorpos tireoidianos</strong>. Ambos os marcadores estão <strong>negativos (não reagentes)</strong>: anti-microssomal / anti-TPO &lt; 0,25 UI/mL (referência &lt; 9,00) e anti-tireoglobulina &lt; 0,90 UI/mL (referência &lt; 4,00). Cada resultado está bem abaixo do limite superior de referência, sem sinal de autoanticorpos.</p>' +
          '<p>Isso fala <strong>contra doença tireoidiana autoimune</strong> (ex.: tireoidite de Hashimoto), cuja causa mais comum é a positividade do anti-TPO. Observe que este painel avalia <strong>apenas anticorpos</strong> — não avalia a <em>função</em> tireoidiana. Um resultado de anticorpos normal não exclui alteração funcional. Para completar a avaliação, correlacione com <strong>TSH e T4 livre</strong>, se ainda não houver. Há uma divergência de data de nascimento entre o cadastro e o laudo, sinalizada ao mantenedor (ver cartão do documento).</p>' +
        '</div>' +
      '</section>';

    var content =
      '<section id="silv-content">' +
        '<div class="container">' +
          cristinaImagingSection(data) +
          ai +
          '<div class="section-label">' + t('09A · Labs', '09A · Exames') + '</div>' +
          '<h2 class="section-title">' + t('Lab panels', 'Painéis laboratoriais') + '</h2>' +
          '<p class="section-desc">' +
            t('Each panel shows the latest result with its reference bar and status pill. Sub-threshold antibody results are shown as reported by the lab ("< value").',
              'Cada painel mostra o resultado mais recente com a barra de referência e o status. Resultados de anticorpos abaixo do limite são exibidos como reportados pelo laboratório ("< valor").') +
          '</p>' +
          '<div class="lab-panel-grid">' +
            data.panels.map(silvanaPanelDetails).join('') +
          '</div>' +
          '<div class="section-label" style="margin-top:32px;">' + t('Source documents', 'Documentos originais') + '</div>' +
          '<h2 class="section-title">' + t('Original lab report', 'Laudo original') + '</h2>' +
          '<p class="section-desc">' +
            t('The photographed source report is available below. Click to download the original.',
              'O laudo original fotografado está disponível abaixo. Clique para baixar.') +
          '</p>' +
          silvanaDocsList(data.documents || []) +
        '</div>' +
      '</section>';

    var main = document.createElement('main');
    main.className = 'jc-silvana-exams jc-cristina-exams';
    main.innerHTML = hero + content;
    document.body.appendChild(main);

    injectDangerZone(main);
  }

  /* ── Silvana Creste · bespoke Physical → Vitals view ─────────────
     Body composition from a single InBody120 panel (11 Feb 2026) plus
     one prior baseline (18 Nov 2025) for the history chart. Hand-curated
     because the InBody printout is an image, not structured data — the
     extractor would mangle it. Latest values rendered as .lab-test
     cards with the same range bars used everywhere else; segmental
     analysis rendered as two SVG silhouettes with overlaid badges.   */

  var SILVANA_INBODY = {
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

  function silvanaVitalsHero(data) {
    var dateLabel = formatDate(data.date);
    return (
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' + t('Physical → Vitals', 'Físico → Sinais Vitais') + '</div>' +
          '<h1 class="hero-title">' +
            t('Body composition · Silvana Creste',
              'Composição corporal · Silvana Creste') +
          '</h1>' +
          '<p class="hero-sub">' +
            t('Bio-impedance panel on the ' + data.device + ' (' + dateLabel + ') ordered by ' + data.nutritionist + '. Three primary findings: weight above the recommended range (70.1 kg vs. 46.9–63.4), body-fat percentage well above the female reference (41.9% vs. 18–28%), and a clear lower-body lean-mass deficit — both legs are below the InBody norm (~81% of expected) while arms and trunk are within range.',
              'Painel de bioimpedância no ' + data.device + ' (' + dateLabel + ') solicitado pelo ' + data.nutritionist + '. Três achados principais: peso acima da faixa recomendada (70,1 kg vs. 46,9–63,4), percentual de gordura corporal bem acima da referência feminina (41,9% vs. 18–28%), e um déficit claro de massa magra nas pernas — ambas estão abaixo da norma InBody (~81% do esperado) enquanto braços e tronco estão dentro da faixa.') +
          '</p>' +
          '<div class="hero-meta">' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Patient', 'Paciente') + '</span><span>Silvana Creste</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('DOB · age', 'Nasc. · idade') + '</span>' +
              '<span>29 ' + t('Sep', 'set') + ' 1967 · ' + data.age + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Date', 'Data') + '</span>' +
              '<span>' + escapeHtml(dateLabel) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Device', 'Aparelho') + '</span>' +
              '<span>' + escapeHtml(data.device) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Nutritionist', 'Nutricionista') + '</span>' +
              '<span>' + escapeHtml(data.nutritionist) + ' · ' + escapeHtml(data.crn) + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('InBody score', 'Pontuação InBody') + '</span>' +
              '<span>' + data.score + '<small style="color:rgba(255,255,255,0.55);font-weight:300;"> / 100</small></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  // Wrap an InBody marker into the shape renderLabTest() expects.
  // The InBody printout is Portuguese; we keep the PT name as the
  // canonical `marker` (used by classifyLab fallbacks etc.) and emit
  // a paired EN/PT span via marker_html so the lang toggle works.
  function silvanaVitalsAsLabMarker(row) {
    var en = row.marker_en || row.marker_pt;
    var pt = row.marker_pt || row.marker_en;
    return {
      marker: pt,
      marker_html: t(escapeHtml(en), escapeHtml(pt)),
      latest_value: row.value,
      unit: row.unit,
      ref_low: row.ref_low,
      ref_high: row.ref_high,
      flag: null, // classifyLab() infers from value vs. bounds
    };
  }

  function silvanaVitalsPanel(titleHtml, subtitleHtml, rows) {
    var body = rows.map(function (r) { return renderLabTest(silvanaVitalsAsLabMarker(r)); }).join('');
    var n = rows.length;
    var countHtml = n + ' ' + t(n === 1 ? 'marker' : 'markers', n === 1 ? 'marcador' : 'marcadores');
    return (
      '<details class="lab-panel" open style="margin-bottom:18px;">' +
        '<summary class="lab-panel-head">' +
          '<span class="lab-panel-title">' + titleHtml + '</span>' +
          '<span class="lab-panel-sub">' + (subtitleHtml || '') + '</span>' +
          '<span class="lab-panel-count">' + countHtml + '</span>' +
        '</summary>' +
        '<div class="lab-panel-body">' + body + '</div>' +
      '</details>'
    );
  }

  function silvanaVitalsSilhouetteSvg() {
    // Stylized androgynous figure. viewBox 220 × 380, drawn so it fits
    // inside a position:relative wrapper that overlays HTML badges.
    // Thin (1.4px) strokes + smooth Bézier curves for a softer feel.
    return (
      '<svg class="silv-fig" viewBox="0 0 220 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<g fill="#E8F0F7" stroke="#7A95B5" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">' +
          // Head
          '<circle cx="110" cy="34" r="20"/>' +
          // Neck (soft trapezoid)
          '<path d="M101 54 Q110 60 119 54 Q121 64 118 68 Q110 70 102 68 Q99 64 101 54 Z"/>' +
          // Torso (rounded shoulders, slight waist, hips at bottom)
          '<path d="M70 70 Q 64 96 68 130 Q 72 162 74 180 Q 70 200 68 220 L 152 220 Q 150 200 146 180 Q 148 162 152 130 Q 156 96 150 70 Q 110 76 70 70 Z"/>' +
          // Left arm (curving outward then inward, narrowing at wrist)
          '<path d="M70 70 Q 48 78 42 102 Q 36 142 38 190 Q 42 212 52 214 Q 60 208 64 192 Q 68 158 70 130 Q 70 100 70 70 Z"/>' +
          // Right arm (mirror)
          '<path d="M150 70 Q 172 78 178 102 Q 184 142 182 190 Q 178 212 168 214 Q 160 208 156 192 Q 152 158 150 130 Q 150 100 150 70 Z"/>' +
          // Left leg (tapering toward ankle)
          '<path d="M68 220 Q 66 270 70 320 Q 74 350 78 360 Q 90 364 100 358 Q 102 320 104 270 Q 106 240 108 220 Q 88 222 68 220 Z"/>' +
          // Right leg (mirror)
          '<path d="M112 220 Q 114 240 116 270 Q 118 320 120 358 Q 130 364 142 360 Q 146 350 150 320 Q 154 270 152 220 Q 132 222 112 220 Z"/>' +
        '</g>' +
      '</svg>'
    );
  }

  function silvanaVitalsLimbBadge(r) {
    var statusCls = (r.status === 'normal') ? 'silv-fig-status-normal' : 'silv-fig-status-flag';
    var statusLbl = (r.status === 'normal') ? t('Normal',  'Normal')
                   : (r.status === 'below') ? t('Below',   'Abaixo')
                   :                          t('Above',   'Acima');
    return (
      '<div class="silv-fig-label silv-fig-label-' + r.limb.replace('_','-') + '">' +
        '<div class="silv-fig-val">' + fmtLabNum(r.kg) + ' kg</div>' +
        '<div class="silv-fig-pct">' + fmtLabNum(r.pct) + '%</div>' +
        '<span class="silv-fig-status ' + statusCls + '">' + statusLbl + '</span>' +
      '</div>'
    );
  }

  function silvanaVitalsSegmentalFigure(titleHtml, rows) {
    var badges = rows.map(silvanaVitalsLimbBadge).join('');
    return (
      '<div class="silv-segmental">' +
        '<h3 class="silv-segmental-title">' + titleHtml + '</h3>' +
        '<div class="silv-figure-wrap">' + silvanaVitalsSilhouetteSvg() + badges + '</div>' +
      '</div>'
    );
  }

  function silvanaVitalsSegmentalSection(data) {
    return (
      '<details class="lab-panel" open style="margin-bottom:18px;">' +
        '<summary class="lab-panel-head">' +
          '<span class="lab-panel-title">' +
            t('Segmental analysis', 'Análise segmentar') +
          '</span>' +
          '<span class="lab-panel-sub">' +
            t('Lean mass and fat distribution per limb · five anatomical regions',
              'Massa magra e gordura por membro · cinco regiões anatômicas') +
          '</span>' +
          '<span class="lab-panel-count">10 ' + t('regions', 'regiões') + '</span>' +
        '</summary>' +
        '<div class="lab-panel-body">' +
          '<div class="silv-segmental-grid">' +
            silvanaVitalsSegmentalFigure(
              t('Lean mass by limb', 'Análise da Massa Magra Segmentar'),
              data.lean_segmental) +
            silvanaVitalsSegmentalFigure(
              t('Fat mass by limb', 'Análise da Gordura Segmentar'),
              data.fat_segmental) +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }

  function silvanaVitalsMiniLineChart(opts) {
    // Single-series sparkline. svgLineChart shares its Y bounds across
    // all series, so mixing kg with % distorts the layout — easier to
    // emit three small charts side-by-side.
    var points = (opts.points || []).slice().sort(function (a, b) { return dateMs(a.date) - dateMs(b.date); });
    return svgLineChart({
      series: [{ marker: opts.marker, unit: opts.unit, color: opts.color, points: points }],
      width: 320, height: 160,
    });
  }

  function silvanaVitalsHistoryPanel(data) {
    var weightPts = data.history.map(function (h) { return { date: h.date, value: h.weight }; });
    var smmPts    = data.history.map(function (h) { return { date: h.date, value: h.smm    }; });
    var pbfPts    = data.history.map(function (h) { return { date: h.date, value: h.pbf    }; });

    var chartsHtml =
      '<div class="silv-history-charts">' +
        '<div class="silv-history-chart">' +
          '<div class="silv-history-chart-title">' + t('Weight', 'Peso') + ' <small>(kg)</small></div>' +
          silvanaVitalsMiniLineChart({ marker: 'Peso', unit: 'kg', color: '#244E6E', points: weightPts }) +
        '</div>' +
        '<div class="silv-history-chart">' +
          '<div class="silv-history-chart-title">' + t('Skeletal Muscle Mass', 'Massa Muscular Esquelética') + ' <small>(kg)</small></div>' +
          silvanaVitalsMiniLineChart({ marker: 'SMM', unit: 'kg', color: '#3F7A4F', points: smmPts }) +
        '</div>' +
        '<div class="silv-history-chart">' +
          '<div class="silv-history-chart-title">' + t('Body fat %', 'PGC') + ' <small>(%)</small></div>' +
          silvanaVitalsMiniLineChart({ marker: 'PGC', unit: '%', color: '#7A2E22', points: pbfPts }) +
        '</div>' +
      '</div>';

    // Compact delta table beneath the charts
    var dates = data.history.map(function (h) { return h.date; });
    var head =
      '<tr>' +
        '<th class="silv-hist-cmp-marker">' + t('Metric', 'Métrica') + '</th>' +
        dates.map(function (d) { return '<th>' + escapeHtml(formatDate(d)) + '</th>'; }).join('') +
        '<th>Δ</th>' +
      '</tr>';
    function row(labelHtml, key, unit) {
      var vals = data.history.map(function (h) { return h[key]; });
      var first = vals[0], last = vals[vals.length - 1];
      var delta = last - first;
      var sign = delta > 0 ? '+' : (delta < 0 ? '−' : '');
      var deltaStr = sign + Math.abs(delta).toFixed(1) + (unit ? ' ' + unit : '');
      var cells = vals.map(function (v) { return '<td>' + fmtLabNum(v) + (unit ? ' ' + unit : '') + '</td>'; }).join('');
      return '<tr><th class="silv-hist-cmp-marker">' + labelHtml + '</th>' + cells + '<td class="silv-hist-cmp-delta">' + deltaStr + '</td></tr>';
    }
    var table =
      '<table class="silv-history-table">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' +
          row(t('Weight', 'Peso'), 'weight', 'kg') +
          row(t('Skeletal Muscle Mass', 'MM Esquelética'), 'smm', 'kg') +
          row(t('Body fat %', 'PGC'), 'pbf', '%') +
        '</tbody>' +
      '</table>';

    return (
      '<details class="lab-panel" open style="margin-bottom:18px;">' +
        '<summary class="lab-panel-head">' +
          '<span class="lab-panel-title">' + t('Body composition history', 'Histórico da Composição Corporal') + '</span>' +
          '<span class="lab-panel-sub">' + t('Weight, skeletal muscle mass and body-fat % across all InBody panels on file', 'Peso, massa muscular esquelética e PGC ao longo de todos os painéis InBody no histórico') + '</span>' +
          '<span class="lab-panel-count">' + data.history.length + ' ' + t('timepoints', 'pontos') + '</span>' +
        '</summary>' +
        '<div class="lab-panel-body">' +
          chartsHtml +
          table +
        '</div>' +
      '</details>'
    );
  }

  function silvanaVitalsAdditionalPanel(data) {
    var rows = [
      { marker_en: 'Basal Metabolic Rate', marker_pt: 'Taxa Metabólica Basal',  value: data.additional.basal_metabolic_rate.value, unit: data.additional.basal_metabolic_rate.unit, ref_low: data.additional.basal_metabolic_rate.ref_low, ref_high: data.additional.basal_metabolic_rate.ref_high },
      { marker_en: 'Visceral Fat Level',   marker_pt: 'Nível de Gordura Visceral', value: data.additional.visceral_fat_level.value, unit: data.additional.visceral_fat_level.unit, ref_low: data.additional.visceral_fat_level.ref_low, ref_high: data.additional.visceral_fat_level.ref_high },
      { marker_en: 'Obesity Degree',       marker_pt: 'Grau de Obesidade',      value: data.additional.obesity_degree.value, unit: data.additional.obesity_degree.unit, ref_low: data.additional.obesity_degree.ref_low, ref_high: data.additional.obesity_degree.ref_high },
    ];
    return silvanaVitalsPanel(
      t('Additional metrics', 'Dados adicionais'),
      t('Derived from the same bio-impedance read', 'Derivados da mesma medição de bioimpedância'),
      rows
    );
  }

  function injectSilvanaVitalsStyles() {
    if (document.getElementById('silvana-vitals-styles')) return;
    var s = document.createElement('style');
    s.id = 'silvana-vitals-styles';
    s.textContent = [
      // Composition + Muscle-Fat panels share a 2-column row
      'main.jc-silvana-vitals .silv-vitals-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }',
      'main.jc-silvana-vitals .silv-vitals-pair > .lab-panel { margin-bottom: 0 !important; }',
      '@media (max-width: 880px) { main.jc-silvana-vitals .silv-vitals-pair { grid-template-columns: 1fr; } }',

      // Segmental analysis grid — two figures side by side
      'main.jc-silvana-vitals .silv-segmental-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }',
      '@media (max-width: 880px) { main.jc-silvana-vitals .silv-segmental-grid { grid-template-columns: 1fr; } }',
      'main.jc-silvana-vitals .silv-segmental { display: flex; flex-direction: column; align-items: center; }',
      'main.jc-silvana-vitals .silv-segmental-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; color: #244E6E; margin: 0 0 8px; text-align: center; }',
      'main.jc-silvana-vitals .silv-figure-wrap { position: relative; width: 100%; max-width: 360px; aspect-ratio: 220 / 380; }',
      'main.jc-silvana-vitals .silv-fig { position: absolute; inset: 0; width: 100%; height: 100%; }',
      'main.jc-silvana-vitals .silv-fig-label { position: absolute; min-width: 72px; padding: 4px 8px; background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 6px; font-family: "IBM Plex Mono", monospace; line-height: 1.35; text-align: center; box-shadow: 0 1px 3px rgba(13,27,42,0.06); }',
      'main.jc-silvana-vitals .silv-fig-val { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; font-weight: 600; color: #0D1B2A; }',
      'main.jc-silvana-vitals .silv-fig-pct { font-size: 10px; color: #7A8FA6; margin: 1px 0 3px; }',
      'main.jc-silvana-vitals .silv-fig-status { display: inline-block; padding: 1px 6px; border-radius: 4px; font-family: "IBM Plex Sans", sans-serif; font-size: 9px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }',
      'main.jc-silvana-vitals .silv-fig-status-normal { background: #E6F4EA; color: #2D5F3F; border: 1px solid #85B595; }',
      'main.jc-silvana-vitals .silv-fig-status-flag   { background: #FBE9E7; color: #7A2E22; border: 1px solid #E5B5AB; }',
      // Label positions relative to wrapper
      'main.jc-silvana-vitals .silv-fig-label-left-arm  { top: 22%; left: -4px; }',
      'main.jc-silvana-vitals .silv-fig-label-right-arm { top: 22%; right: -4px; }',
      'main.jc-silvana-vitals .silv-fig-label-trunk     { top: 44%; left: 50%; transform: translateX(-50%); background: rgba(255,255,255,0.92); }',
      'main.jc-silvana-vitals .silv-fig-label-left-leg  { top: 72%; left: -4px; }',
      'main.jc-silvana-vitals .silv-fig-label-right-leg { top: 72%; right: -4px; }',

      // History panel — three sparkline charts in a row
      'main.jc-silvana-vitals .silv-history-charts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 14px; }',
      '@media (max-width: 880px) { main.jc-silvana-vitals .silv-history-charts { grid-template-columns: 1fr; } }',
      'main.jc-silvana-vitals .silv-history-chart { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 8px; padding: 12px 14px; }',
      'main.jc-silvana-vitals .silv-history-chart-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 12px; letter-spacing: 0.04em; color: #244E6E; margin-bottom: 4px; }',
      'main.jc-silvana-vitals .silv-history-chart-title small { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; font-weight: 400; }',

      // Delta table
      'main.jc-silvana-vitals .silv-history-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      'main.jc-silvana-vitals .silv-history-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 6px 8px; border-bottom: 1px solid #E5E2DC; }',
      'main.jc-silvana-vitals .silv-history-table td { padding: 6px 8px; border-bottom: 1px solid #EFEBE3; vertical-align: middle; color: #1E2D3D; font-family: "IBM Plex Mono", monospace; }',
      'main.jc-silvana-vitals .silv-history-table .silv-hist-cmp-marker { font-family: "IBM Plex Sans", sans-serif; color: #0D1B2A; font-weight: 500; }',
      'main.jc-silvana-vitals .silv-history-table .silv-hist-cmp-delta { font-weight: 600; color: #244E6E; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function silvanaVitalsAiSummary() {
    // Synthesis card — ties the 11 Feb 2026 InBody panel to the
    // 7-year lab history rendered on the Exams page. Three pillars at
    // the bottom: a specific Physical recommendation, Mental as TBD
    // pending therapy contact, Spiritual as TBD (no data yet).
    return (
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
  }

  function renderSilvanaVitals() {
    injectSilvanaStyles();
    injectSilvanaVitalsStyles();
    document.title = 'Lumen Health — Vitals · Silvana Creste';

    var data = SILVANA_INBODY;

    var content =
      '<section id="silv-content">' +
        '<div class="container">' +
          silvanaVitalsAiSummary() +
          '<div class="silv-vitals-pair">' +
            silvanaVitalsPanel(
              t('Body composition analysis', 'Análise da Composição Corporal'),
              t('Water, protein, mineral, fat and total weight against the InBody reference range', 'Água, proteína, mineral, gordura e peso total comparados à faixa de referência do InBody'),
              data.composition) +
            silvanaVitalsPanel(
              t('Muscle-Fat analysis', 'Análise Músculo-Gordura'),
              t('Weight, skeletal muscle mass and body-fat mass on the InBody scale', 'Peso, massa muscular esquelética e massa de gordura na escala InBody'),
              data.muscle_fat) +
          '</div>' +
          silvanaVitalsPanel(
            t('Obesity analysis', 'Análise de Obesidade'),
            t('BMI and body-fat percentage', 'IMC e percentual de gordura corporal'),
            data.obesity) +
          silvanaVitalsSegmentalSection(data) +
          silvanaVitalsHistoryPanel(data) +
          silvanaVitalsAdditionalPanel(data) +
        '</div>' +
      '</section>';

    var main = document.createElement('main');
    main.className = 'jc-silvana-exams jc-silvana-vitals';
    main.innerHTML = silvanaVitalsHero(data) + content;
    document.body.appendChild(main);
    injectDangerZone(main);
  }
})();
